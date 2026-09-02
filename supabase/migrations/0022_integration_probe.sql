-- 0022_integration_probe.sql — el motivo de un fallo, donde alguien pueda leerlo.
--
-- QUÉ IMPIDE ESTA MIGRACIÓN
--
-- Que la única copia de «por qué falló» viva en un log que nadie va a mirar.
--
-- La #67 hizo que el servidor ESCRIBA el motivo. No alcanzó, y se midió por qué:
-- el proyecto está en el plan Hobby de Vercel, donde los logs de función son
-- efímeros. El 2026-09-02, con GA4 fallando de verdad, el panel contestó «There
-- are no request logs in this time range» sobre la ventana en que había pasado.
-- Un motivo que se evapora en minutos no es un motivo: es una anécdota.
--
-- Así que el resultado de cada consulta se guarda acá, y la pantalla de
-- integraciones lo muestra al lado de la fuente que falló. Deja de hacer falta
-- ser quien opera la plataforma —y estar mirando en el momento justo— para saber
-- si un `error` fue un permiso, un identificador o la red.
--
-- POR QUÉ UNA FILA POR ORGANIZACIÓN Y PROVEEDOR, Y NO UN HISTORIAL
--
-- Porque la pregunta que contesta es «¿qué pasa AHORA con esta integración?», y
-- para eso la última respuesta es la única que importa. Un historial es otra cosa
-- —cuánto lleva rota, con qué frecuencia falla— y pide decisiones que nadie tomó:
-- cuánto guardar, quién lo borra, qué pasa cuando crece. Se escribe con UPSERT
-- sobre una unicidad, así que el día que haga falta el historial, quitar esa
-- unicidad es una migración de una línea; al revés, sacar filas acumuladas con
-- policies colgando, no.
--
-- EL EJE DE TENANT ES EL MISMO DE SIEMPRE, Y ACÁ IMPORTA MÁS QUE EN OTRAS
--
-- `property_ref` dice a qué property de Google apunta un cliente. Es el dato que
-- el modelo de agencia usa para separar a un cliente de otro, así que una fila
-- visible de más le muestra a alguien el identificador de la property de otro.
-- Por eso `organization_id NOT NULL`, RLS con ENABLE y FORCE, permisiva más
-- RESTRICTIVE, y `authenticated` con SELECT y nada más: escribir esto es
-- consecuencia de una consulta que hizo el servidor, nunca de un clic.

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS public.integration_probe (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- El eje de tenant. NOT NULL desde el principio: una fila sin organización no
    -- la puede ver nadie y no la puede arreglar nadie.
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- El mismo vocabulario que la 0017, para que una superficie nueva tenga que
    -- agregarse en los dos lados a la vez.
    provider        text NOT NULL
        CHECK (provider IN ('ga4', 'search_console', 'google_business_profile')),

    -- Cómo terminó el intento, con las mismas palabras que `status.ts` usa en
    -- TypeScript. Si esa unión crece y este CHECK no, la escritura falla — que es
    -- la manera de que los dos vocabularios no se separen en silencio.
    outcome         text NOT NULL
        CHECK (outcome IN ('ok', 'http', 'timeout', 'network', 'malformed', 'no-credentials')),

    -- El código, y SÓLO cuando hubo respuesta. El CHECK lo obliga en las dos
    -- direcciones: sin `http` no puede haber código —inventaría una respuesta que
    -- no existió— y con `http` no puede faltar, que es justamente el número que
    -- distingue un permiso de un identificador mal puesto.
    --
    -- Y se escribe con CASE y no con `(A AND B) OR (C AND D)`, que fue la primera
    -- versión y NO servía: con `outcome = 'http'` y el código nulo, la primera
    -- rama da NULL, la segunda da FALSE, y `NULL OR FALSE` es NULL. **Un CHECK
    -- que evalúa a NULL acepta la fila** — sólo rechaza cuando da FALSE. Lo
    -- encontró el bloque 66 en su primera corrida, sobre esta misma migración.
    http_status     int
        CHECK (
            CASE
                WHEN outcome = 'http'
                    THEN http_status IS NOT NULL AND http_status BETWEEN 100 AND 599
                ELSE http_status IS NULL
            END
        ),

    -- Contra qué se consultó. Se guarda aunque el mapeo cambie después: leer «403
    -- sobre la property que ya no está mapeada» es lo que explica por qué alguien
    -- vio un error que ya no puede reproducir.
    property_ref    text NOT NULL DEFAULT '',

    checked_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integration_probe IS
    'El resultado de la ÚLTIMA consulta a cada superficie de Google, por organización. No es un historial: es el estado de ahora, para que la pantalla pueda decir por qué algo falla.';

-- Una fila por organización y proveedor: es lo que hace que el UPSERT reemplace
-- en vez de acumular. Sin esto, cada reporte agrega una fila y la tabla crece sin
-- que nadie lo note hasta que pesa.
CREATE UNIQUE INDEX IF NOT EXISTS integration_probe_one_per_provider
    ON public.integration_probe (organization_id, provider);

ALTER TABLE public.integration_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_probe FORCE ROW LEVEL SECURITY;

CREATE POLICY "probe_read_member" ON public.integration_probe
    FOR SELECT TO authenticated
    USING (organization_id IN (SELECT public.current_user_org_ids()));

-- La RESTRICTIVA es la que sigue valiendo el día que alguien agregue una
-- permisiva de más: las permisivas se suman, las restrictivas se multiplican.
CREATE POLICY "probe_tenant_axis" ON public.integration_probe
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

-- `FROM PUBLIC` no alcanza: los default privileges de Supabase otorgan por
-- NOMBRE. Se revoca a los tres y se otorga lo justo.
REVOKE ALL ON public.integration_probe FROM PUBLIC, anon, authenticated, service_role;

-- La sesión de navegador LEE y no escribe. Escribir esto es consecuencia de una
-- consulta que hizo el servidor; una sesión que pudiera escribirlo podría
-- declarar «todo bien» sobre una integración rota, que es peor que no tener nada.
GRANT SELECT ON public.integration_probe TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_probe TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0022_integration_probe')
ON CONFLICT (version) DO NOTHING;
