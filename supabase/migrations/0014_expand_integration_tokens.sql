-- 0014_expand_integration_tokens.sql — la custodia de los tokens del cliente.
--
-- QUÉ ABRE
--
-- La primera pieza de F2. El reporte necesita datos de Search Console y GA4, y
-- para eso hay que guardar un token de cada cliente. Va ANTES del OAuth a
-- propósito: un token guardado en claro es el mismo defecto de clase que la
-- `0002` de Lead Engine, y construir la custodia DESPUÉS de tener tokens reales
-- no es diseñar secretos, es migrarlos.
--
-- EL SECRETO NO VIVE ACÁ, Y ESO ES EL DISEÑO ENTERO
--
-- Esta tabla no tiene una columna con el token. Tiene `secret_id`, que apunta a
-- `vault.secrets`, donde Supabase lo guarda cifrado. Medido en la réplica: lo
-- que queda en la fila es `mcJMZ6SR5khEfXE7h/UutWnN7ltEZn9Ht...` y no el texto.
--
-- La consecuencia que importa no es "está cifrado" sino DÓNDE no está: no hay
-- ninguna columna en `public` que se pueda leer de más. Y el esquema `vault` no
-- le está otorgado ni a `anon` ni a `authenticated` —ni USAGE— así que la llave
-- que viaja en el bundle del navegador no tiene ruta hasta el secreto, ni
-- siquiera una mal cerrada. Sólo `postgres` y `service_role` llegan.
--
-- La alternativa era `pgp_sym_encrypt` con la clave por GUC, y se descartó: la
-- clave viajaría en la cadena de conexión y aparecería en `pg_stat_activity` y
-- en los logs. Vault la guarda donde no sale.
--
-- VENCIDO Y REVOCADO NO SON LO MISMO, Y EL ESQUEMA TIENE QUE SABERLO
--
-- Son dos columnas separadas y no un `is_valid`, porque piden acciones
-- opuestas:
--
--   vencido   el token caducó          -> acción: refrescarlo, solo, sin el cliente
--   revocado  alguien lo dio de baja   -> acción: que el cliente vuelva a conectar
--
-- Confundirlos es el mismo bug que #46 arregló una capa más arriba, donde una
-- API caída se leía como una integración sin conectar. Allá el precio era un
-- cartel tranquilizador; acá es un reintento infinito contra un token que
-- ninguna cantidad de refrescos va a resucitar.
--
-- Por eso la revocación DOMINA: un token revocado y además vencido es
-- 'revoked', no 'expired'. Lo que decide el estado es qué hay que hacer, y lo
-- que hay que hacer es reconectar.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La tabla
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integration_tokens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- El eje, NOT NULL desde el primer día. Las tablas de la 0003 llegaron a
    -- NOT NULL en dos pasos porque ya tenían filas sin tenant; ésta nace sin
    -- ninguna, así que no hay nada que tolerar mientras tanto.
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    provider        text NOT NULL,

    -- El secreto, por referencia. ON DELETE RESTRICT y no CASCADE: borrar un
    -- secreto del Vault dejaría esta fila apuntando al vacío, y una fila que
    -- dice "hay un token" sin token es peor que no tenerla — el código la lee
    -- como una conexión viva.
    secret_id       uuid NOT NULL REFERENCES vault.secrets(id) ON DELETE RESTRICT,

    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT integration_tokens_provider_check
        CHECK (provider IN ('google'))
);

COMMENT ON TABLE public.integration_tokens IS
    'Un token OAuth por organización y proveedor. El secreto vive cifrado en vault.secrets; acá sólo su id.';
COMMENT ON COLUMN public.integration_tokens.revoked_at IS
    'NULL = no revocado. Distinto de vencido: un revocado no se refresca, se vuelve a conectar.';

-- Una conexión viva por organización y proveedor, y las revocadas se acumulan.
-- Parcial y no total a propósito: el historial de revocaciones es lo que
-- permite auditar quién tuvo acceso y hasta cuándo, y una restricción total lo
-- obligaría a borrarse.
CREATE UNIQUE INDEX IF NOT EXISTS integration_tokens_one_live_per_provider
    ON public.integration_tokens (organization_id, provider)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS integration_tokens_org_idx
    ON public.integration_tokens (organization_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El estado, modelado y no deducido en cada lugar que pregunte
-- ─────────────────────────────────────────────────────────────────────────────
-- Una función y no tres `if` repartidos por la aplicación. El predicado de
-- `envNumber()` en Lead Engine estaba en tres copias y probar una dejaba las
-- otras dos sin cubrir; acá hay una sola desde el principio.
--
-- STABLE y no IMMUTABLE: lee `now()`. Marcarla IMMUTABLE dejaría que PostgreSQL
-- cachee el resultado en un índice y un token vencido seguiría leyéndose activo.
CREATE OR REPLACE FUNCTION public.integration_token_state(
    p_expires_at timestamptz,
    p_revoked_at timestamptz
) RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_revoked_at IS NOT NULL THEN 'revoked'
        WHEN p_expires_at <= now()    THEN 'expired'
        ELSE 'active'
    END;
$$;

COMMENT ON FUNCTION public.integration_token_state(timestamptz, timestamptz) IS
    'active | expired | revoked. La revocación domina: revocado y vencido es revocado, porque la acción es reconectar y no refrescar.';

-- Explícito, como hace la 0007 con las demás: CREATE FUNCTION le da EXECUTE a
-- PUBLIC, y depender de eso es depender de un default.
REVOKE ALL ON FUNCTION public.integration_token_state(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.integration_token_state(timestamptz, timestamptz)
    TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS: una permisiva que da acceso y una RESTRICTIVE que fija el eje
-- ─────────────────────────────────────────────────────────────────────────────
-- Las dos, y no sólo la restrictiva. Una RESTRICTIVE sola no deja ver NADA: las
-- restrictivas se combinan con AND sobre lo que alguna permisiva haya
-- permitido, y sin permisiva no hay nada que restringir. Es un error fácil de
-- cometer y difícil de ver, porque el síntoma —cero filas— se parece a que el
-- aislamiento funciona.
--
-- Y la restrictiva no es redundante con la permisiva aunque hoy digan lo mismo.
-- La permisiva se puede anular agregando OTRA permisiva más laxa, que es como
-- se rompe esto en la práctica: alguien agrega una policy para un caso nuevo y
-- ensancha el acceso sin querer. Una restrictiva no se puede anular agregando
-- policies; sobrevive a la próxima.
ALTER TABLE public.integration_tokens ENABLE ROW LEVEL SECURITY;
-- FORCE además de ENABLE, como las otras dieciséis: sin él el dueño queda
-- exento por el solo hecho de serlo, que es el defecto 6 de la suite.
ALTER TABLE public.integration_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tokens_rw_member" ON public.integration_tokens;
CREATE POLICY "tokens_rw_member" ON public.integration_tokens
    FOR ALL
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "tokens_tenant_axis" ON public.integration_tokens;
CREATE POLICY "tokens_tenant_axis" ON public.integration_tokens
    AS RESTRICTIVE
    FOR ALL
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Los privilegios, que no se heredan: se declaran
-- ─────────────────────────────────────────────────────────────────────────────
-- Una tabla nueva en `public` NACE con los siete privilegios para los tres
-- roles, por los default privileges que Supabase deja puestos. O sea que sin
-- estas líneas `anon` —la llave que viaja en el bundle del navegador— podría
-- escribir acá. Ya pasó dos veces con `schema_migrations`, una en cada repo, y
-- es exactamente lo que mide el bloque 14 de la suite.
REVOKE ALL ON public.integration_tokens FROM anon, authenticated, service_role;

-- `authenticated` sólo LEE, y sólo lo suyo por RLS: la pantalla necesita
-- mostrar "conectado / vencido / revocado" y nada más. Escribir un token es
-- consecuencia de un intercambio OAuth, que ocurre en el servidor.
GRANT SELECT ON public.integration_tokens TO authenticated;

-- El servidor. Es el único que además llega al Vault, porque es el único con
-- USAGE sobre ese esquema.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_tokens TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0014_expand_integration_tokens')
ON CONFLICT (version) DO NOTHING;
