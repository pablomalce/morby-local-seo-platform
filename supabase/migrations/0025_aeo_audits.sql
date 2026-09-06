-- 0025_aeo_audits.sql — la auditoría de legibilidad por IA deja de perderse.
--
-- QUÉ CIERRA
--
-- Que la auditoría se corra, se vea y se pierda al cerrar la pestaña. Sin
-- historia no hay con qué comparar, y lo único que se puede decir es cómo está
-- hoy — cuando lo que un cliente necesita oír es **qué cambió**.
--
-- POR QUÉ HISTORIA Y NO ESTADO, A DIFERENCIA DE LA 0022
--
-- `integration_probe` guarda UNA fila por organización y proveedor: es el estado
-- actual de una conexión, y el anterior no dice nada útil. Acá es al revés. Un
-- sitio que bloqueaba a los rastreadores y hoy no los bloquea es exactamente el
-- resultado del trabajo, y con una sola fila esa mejora sería invisible.
--
-- Por eso NO hay índice único por organización: cada corrida es una fila.
--
-- EL ACCESO SE GUARDA POR AGENTE, NO COMO UN BOOLEANO
--
-- Permitir a GPTBot y bloquear a ClaudeBot es un estado real y frecuente.
-- Aplastarlo a «bloqueado: sí/no» pierde justamente el dato que dice qué línea
-- del `robots.txt` hay que tocar.
--
-- Y SE GUARDA SI EL `robots.txt` SE PUDO LEER
--
-- Sin esa columna, «no se pudo traer» y «no tiene reglas» quedan idénticos en la
-- base: los dos darían acceso permitido para los cinco agentes. Son cosas
-- distintas, y la primera no es una medición.

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS public.aeo_audits (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

    -- La URL efectivamente auditada, ya normalizada. Se guarda porque el sitio
    -- del negocio puede cambiar, y una auditoria vieja describe el sitio viejo.
    url             text NOT NULL,

    -- Si el robots.txt se pudo traer. Ver el encabezado: sin esto, no haberlo
    -- podido leer se confunde con no tener reglas.
    robots_leido    boolean NOT NULL,
    -- Por agente: {"gptbot": true, "claudebot": false, ...}
    acceso          jsonb   NOT NULL,

    caracteres_sin_js integer NOT NULL,
    -- Los tipos hallados: ["FAQPage", "Organization"]
    schema_encontrado jsonb   NOT NULL,
    llms_txt          boolean NOT NULL,

    auditado_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT aeo_audits_caracteres_no_negativos CHECK (caracteres_sin_js >= 0)
);

COMMENT ON TABLE public.aeo_audits IS
    'Una fila por corrida, no por sitio: la historia es el producto. Ver el encabezado de la 0025.';

COMMENT ON COLUMN public.aeo_audits.robots_leido IS
    'Si el robots.txt se pudo traer. Sin esto, "no se pudo leer" y "no tiene reglas" son indistinguibles.';

-- Se consulta siempre por organizacion y por fecha: la ultima corrida, y la
-- anterior para comparar.
CREATE INDEX IF NOT EXISTS aeo_audits_org_fecha_idx
    ON public.aeo_audits (organization_id, auditado_at DESC);

ALTER TABLE public.aeo_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aeo_audits FORCE ROW LEVEL SECURITY;

-- `DROP ... IF EXISTS` antes de cada `CREATE POLICY`, como la 0016: sin eso la
-- migración falla al reaplicarse, y el `CREATE TABLE IF NOT EXISTS` de arriba sí
-- pasa — o sea que una corrida repetida se cae a la mitad, con la tabla creada y
-- sin políticas. Ese estado es peor que fallar entero.
DROP POLICY IF EXISTS "aeo_read_member" ON public.aeo_audits;
CREATE POLICY "aeo_read_member" ON public.aeo_audits
    FOR SELECT TO authenticated
    USING (organization_id IN (SELECT public.current_user_org_ids()));

-- La RESTRICTIVA es la que sigue valiendo el dia que alguien agregue una
-- permisiva de mas: las permisivas se suman, las restrictivas se multiplican.
DROP POLICY IF EXISTS "aeo_tenant_axis" ON public.aeo_audits;
CREATE POLICY "aeo_tenant_axis" ON public.aeo_audits
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

-- `FROM PUBLIC` no alcanza: los default privileges de Supabase otorgan por
-- NOMBRE. Se revoca a los tres y se otorga lo justo.
REVOKE ALL ON public.aeo_audits FROM PUBLIC, anon, authenticated, service_role;

-- La sesion de navegador LEE y no escribe, igual que con la sonda. Escribir esto
-- es consecuencia de peticiones que hizo el servidor; una sesion que pudiera
-- escribirlo podria declarar «el sitio esta bien» sin haber mirado nada.
GRANT SELECT ON public.aeo_audits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aeo_audits TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0025_aeo_audits')
ON CONFLICT (version) DO NOTHING;
