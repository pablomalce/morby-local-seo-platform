-- 0017_expand_property_mapping.sql — el mapeo de propiedades, que es el eje de
-- tenant una capa más arriba del token.
--
-- QUÉ CAMBIÓ EN EL PRODUCTO, Y POR QUÉ ESTO NO ES CONFIGURACIÓN
--
-- Growth OS vende SEO/GEO/AEO a varios clientes a la vez, y el acceso a Google es
-- de **agencia con acceso delegado**: hay UN SOLO token OAuth —el de la cuenta de
-- Vulkan— y cada cliente le da a esa cuenta permiso sobre su propiedad de Search
-- Console, su propiedad de GA4 y su ficha de Google Business Profile.
--
-- La 0014 dio por supuesto lo contrario: un token POR organización, o sea que el
-- token era además la frontera. Que sea o no así deja de importar acá, porque en
-- el modelo de agencia la credencial ya no separa a nadie — la misma cuenta llega
-- a los datos de todos los clientes. Lo único que decide de quién son los números
-- que entran en un reporte es qué property ID se consultó.
--
-- La consecuencia es la que define esta migración: **si el mapeo se equivoca, el
-- reporte de un cliente muestra los datos de otro.** No es un defecto de
-- presentación. Es una fuga entre clientes, de la misma clase que la que la RLS
-- existe para impedir, sólo que ocurre afuera de la base: PostgreSQL entrega la
-- fila correcta y la fila correcta contiene el identificador equivocado.
--
-- Por eso esto no es una tabla de ajustes. Es el eje de tenant una capa más
-- arriba, y recibe el mismo trato que el eje de abajo: NOT NULL con FK, RLS con
-- ENABLE y FORCE, permisiva más RESTRICTIVE, privilegios declarados, y —lo que
-- ninguna tabla de configuración tiene— una unicidad GLOBAL que impide que una
-- misma property quede mapeada a dos organizaciones vivas a la vez.
--
-- ESA UNICIDAD ES LA RESTRICCIÓN, Y TIENE QUE SER UNA RESTRICCIÓN
--
-- "Comprobar que nadie más tenga esta property" es una consulta seguida de un
-- INSERT, y dos onboardings concurrentes pasan los dos por el `if` — el mismo
-- argumento que la 0016 hace sobre la idempotencia de publicar, con un precio
-- peor: allá el cliente ve un post repetido, acá ve las métricas de otro.
--
-- Y es global a propósito, no por organización. Una unicidad `(organization_id,
-- property_ref)` deja pasar exactamente el caso que hay que impedir: dos
-- organizaciones distintas apuntando al mismo lugar.
--
-- EL SECRETO NO VIVE ACÁ Y ESTA TABLA NO LO TOCA
--
-- Nada cifrado entra en estas columnas. El token sigue donde lo puso la 0014: en
-- `vault.secrets`, referenciado por `public.integration_tokens`. Esta tabla es la
-- mitad NO secreta de la integración, y por eso `authenticated` puede leerla —
-- una pantalla de ajustes tiene que poder mostrar a qué propiedad está conectado
-- el cliente— mientras que el bloque 22 de la suite sigue exigiendo que el
-- secreto no exista en `public` de ninguna forma.
--
-- Tampoco hay FK contra `integration_tokens`, y es deliberado: en el modelo de
-- agencia el token no es por organización, así que amarrar cada mapeo a una fila
-- de tokens de su propio tenant modelaría el mundo anterior y estorbaría en éste.
-- Lo que sí es cierto en los dos modelos es que el mapeo pertenece a una
-- organización, y eso es lo que la FK de abajo dice.
--
-- POR QUÉ EL PROVEEDOR ACÁ NO ES 'google'
--
-- La 0014 usa `provider = 'google'` porque lo que guarda es UNA credencial de UNA
-- cuenta. Acá lo que se guarda es a qué objeto de cada superficie apunta esa
-- credencial, y son tres objetos distintos con tres formatos distintos: una
-- property de GA4, un sitio de Search Console y una location de GBP. Un solo
-- 'google' obligaría a tres columnas nullable, y tres columnas nullable no se
-- pueden restringir con una unicidad sola — que es justamente lo único que acá
-- hace falta que sea imposible de saltear.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La tabla
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integration_properties (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- El eje, NOT NULL desde el primer día, igual que en la 0014 y por el mismo
    -- motivo: la tabla nace vacía, así que no hay ninguna fila sin tenant que
    -- tolerar mientras tanto y el paso expand/contract no tiene nada que hacer.
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- La superficie de Google, no la cuenta. Ver el encabezado.
    provider        text NOT NULL,

    -- El identificador tal como lo devuelve la API que lo produjo, en su forma
    -- canónica. Se guarda como texto y no partido en pedazos porque es lo que
    -- viaja tal cual al pedido: `properties/123456` es lo que GA4 espera, y
    -- reconstruirlo desde partes es una oportunidad más de reconstruirlo mal.
    property_ref    text NOT NULL,

    -- NULL = mapeo vivo. Desmapear no borra, por el mismo argumento que la 0014
    -- hace con `revoked_at`: el historial es lo que permite contestar "¿de quién
    -- eran estos números el mes pasado?", y esa pregunta se hace justamente
    -- cuando se sospecha que un reporte mostró lo que no era.
    unmapped_at     timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT integration_properties_provider_check
        CHECK (provider IN ('ga4', 'search_console', 'google_business_profile')),

    -- La forma canónica, y no es prolijidad: es lo que hace que la unicidad de
    -- más abajo signifique algo.
    --
    -- Una unicidad sobre texto libre se saltea escribiendo lo mismo de otra
    -- manera. `123456` y `properties/123456` son la misma property de GA4 para
    -- Google y dos filas distintas para PostgreSQL, así que sin esta restricción
    -- dos organizaciones pueden quedar mapeadas al mismo lugar sin que ningún
    -- índice se entere. La fuga entra por la ortografía.
    --
    -- Los tres formatos son los que devuelven las APIs, no una convención de este
    -- repositorio:
    --
    --   ga4                      properties/123456789
    --   search_console           https://ejemplo.com/   |  sc-domain:ejemplo.com
    --   google_business_profile  locations/123456789
    --
    -- El caso de Search Console es el que más se escribe mal: la API devuelve las
    -- propiedades de prefijo de URL SIEMPRE con la barra final, y
    -- `https://ejemplo.com` sin barra es un valor que ninguna respuesta produce
    -- pero que un humano escribe todo el tiempo.
    --
    -- ELSE false y no ELSE true: un CHECK que devuelve NULL PASA. Con el ELSE al
    -- revés, un `provider` nuevo agregado mañana al vocabulario entraría sin
    -- ninguna comprobación de forma y nada lo diría.
    CONSTRAINT integration_properties_ref_shape_check
        CHECK (
            CASE provider
                WHEN 'ga4'
                    THEN property_ref ~ '^properties/[0-9]+$'
                WHEN 'search_console'
                    THEN property_ref ~ '^(sc-domain:[a-z0-9.-]+|https?://[^[:space:]]+/)$'
                WHEN 'google_business_profile'
                    THEN property_ref ~ '^locations/[0-9]+$'
                ELSE false
            END
        )
);

COMMENT ON TABLE public.integration_properties IS
    'A qué property de Google apunta cada organización. Con un token de agencia, esto ES la frontera entre clientes.';
COMMENT ON COLUMN public.integration_properties.property_ref IS
    'El identificador en la forma que devuelve la API: properties/N, https://sitio/ o sc-domain:host, locations/N.';
COMMENT ON COLUMN public.integration_properties.unmapped_at IS
    'NULL = mapeo vivo. Desmapear no borra: el historial es lo que permite auditar de quién eran los números de un reporte viejo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La unicidad que impide la fuga
-- ─────────────────────────────────────────────────────────────────────────────
-- Una property viva pertenece a UNA organización. Esto es lo que hace que un
-- error de mapeo sea imposible en vez de improbable.
--
-- `lower()` y no la columna pelada. Los hosts de Search Console no distinguen
-- mayúsculas —`https://Ejemplo.com/` y `https://ejemplo.com/` son el mismo sitio
-- para Google— y sin normalizar, la unicidad se saltea con la tecla de bloqueo de
-- mayúsculas. Alcanza a la ruta también, que sí distingue: dos rutas que sólo
-- difieren en mayúsculas se rechazan aunque técnicamente podrían ser distintas.
-- Es la dirección correcta del error: rechazar un mapeo es una molestia de
-- onboarding, compartirlo es una fuga entre clientes.
--
-- PARCIAL, `WHERE unmapped_at IS NULL`, por la misma razón que la 0014 hace
-- parcial la suya: un cliente que se va y otro que hereda su ficha de GBP es un
-- caso real, y una unicidad total dejaría esa property inmapeable para siempre
-- por culpa de una fila histórica. Lo que no puede haber son dos mapeos VIVOS;
-- los muertos son registro.
CREATE UNIQUE INDEX IF NOT EXISTS integration_properties_one_org_per_property
    ON public.integration_properties (provider, lower(property_ref))
    WHERE unmapped_at IS NULL;

-- Y del otro lado: un mapeo vivo por organización y proveedor. Sin esto, una
-- organización con dos properties de GA4 vivas deja al código eligiendo una de
-- las dos —"el mapeo de esta organización" no identifica nada— y la mitad de los
-- reportes salen con los números del sitio equivocado del mismo cliente.
CREATE UNIQUE INDEX IF NOT EXISTS integration_properties_one_live_per_provider
    ON public.integration_properties (organization_id, provider)
    WHERE unmapped_at IS NULL;

CREATE INDEX IF NOT EXISTS integration_properties_org_idx
    ON public.integration_properties (organization_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS: una permisiva que da acceso y una RESTRICTIVE que fija el eje
-- ─────────────────────────────────────────────────────────────────────────────
-- Las dos, como en la 0014 y en la 0016, y el motivo se repite porque el error se
-- repite: una RESTRICTIVE sola no deja ver NADA —se combinan con AND sobre lo que
-- alguna permisiva permitió, y sin permisiva no hay nada que restringir— y una
-- permisiva sola se anula agregando OTRA permisiva más laxa, que es como esto se
-- rompe de verdad: alguien agrega una policy para un caso nuevo y ensancha el
-- acceso sin darse cuenta. Una restrictiva sobrevive a la próxima policy.
ALTER TABLE public.integration_properties ENABLE ROW LEVEL SECURITY;
-- FORCE además de ENABLE, como las otras: sin él el dueño queda exento por el
-- solo hecho de serlo, que es el defecto 6 de la suite.
ALTER TABLE public.integration_properties FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "properties_rw_member" ON public.integration_properties;
CREATE POLICY "properties_rw_member" ON public.integration_properties
    FOR ALL
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "properties_tenant_axis" ON public.integration_properties;
CREATE POLICY "properties_tenant_axis" ON public.integration_properties
    AS RESTRICTIVE
    FOR ALL
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Los privilegios, que no se heredan: se declaran
-- ─────────────────────────────────────────────────────────────────────────────
-- Una tabla nueva en `public` NACE con los siete privilegios para `anon`,
-- `authenticated` y `service_role`, por los default privileges que Supabase deja
-- puestos. O sea que sin estas líneas la llave que viaja en el bundle del
-- navegador podría escribir acá. Ya pasó dos veces con `schema_migrations`, una
-- en cada repo, y es lo que mide el bloque 14 de la suite.
REVOKE ALL ON public.integration_properties FROM anon, authenticated, service_role;

-- `authenticated` sólo LEE, y sólo lo suyo por RLS. Que no escriba es más
-- importante acá que en la 0014, no menos: una sesión de navegador capaz de
-- INSERTAR un mapeo puede apuntar SU organización a la property de OTRO cliente,
-- y a partir de ahí el token de agencia —que llega a las dos— le sirve los datos
-- ajenos sin que ninguna policy tenga nada que objetar. La fila es suya; el
-- contenido, de otro. Es una escalada que ninguna RLS puede ver.
GRANT SELECT ON public.integration_properties TO authenticated;

-- El servidor. Mapear es un acto de la agencia durante el onboarding, con una
-- lista de propiedades que sólo la cuenta de Vulkan puede enumerar.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_properties TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0017_expand_property_mapping')
ON CONFLICT (version) DO NOTHING;
