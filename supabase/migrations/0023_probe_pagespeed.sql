-- 0023_probe_pagespeed.sql — PageSpeed también deja dicho por qué falló.
--
-- QUÉ IMPIDE ESTA MIGRACIÓN
--
-- Que quede UNA fuente cuyo `error` siga sin motivo después de la 0022.
--
-- La 0022 le dio a Search Console y a GA4 un lugar donde el motivo sobrevive al
-- log. PageSpeed quedó afuera, y no por una razón: su CHECK de `provider` copió
-- el vocabulario de la 0017, que es el de las superficies que se MAPEAN por
-- cliente. PageSpeed no se mapea —sale del `website` del negocio— así que nunca
-- estuvo en esa lista.
--
-- El costo de esa omisión está medido. En los dos reportes reales que existen
-- —2026-09-01 20:41 y 2026-09-02 05:12 UTC— PageSpeed salió `error` las dos
-- veces, y no hay manera de saber cuál de los cuatro fue: `missing-key` es un
-- estado aparte, así que la clave ESTÁ y la llamada falló. Un 403 es la API sin
-- habilitar en el proyecto, un 429 es la cuota agotada, un timeout es Lighthouse
-- sobre un sitio lento. Tres arreglos distintos detrás de la misma palabra, y la
-- única salida disponible hoy es adivinar y probar.
--
-- POR QUÉ ACÁ Y NO EN LA LISTA DE LA 0017
--
-- Porque son dos vocabularios distintos que hasta ahora coincidían. `provider` en
-- `integration_properties` responde «¿qué se puede mapear?»; acá responde «¿qué
-- se consultó?», y eso incluye fuentes que no se mapean. Separarlos es lo que
-- deja entrar a PageSpeed sin inventarle un mapeo que nadie va a llenar.
--
-- La fila de PageSpeed no la muestra la pantalla de integraciones, que lista las
-- tres superficies mapeables. Se lee con un SELECT, que es exactamente para lo
-- que la 0022 existe: que el motivo esté en algún lado cuando alguien lo busque.

\set ON_ERROR_STOP on

ALTER TABLE public.integration_probe
    DROP CONSTRAINT IF EXISTS integration_probe_provider_check;

ALTER TABLE public.integration_probe
    ADD CONSTRAINT integration_probe_provider_check
    CHECK (provider IN ('ga4', 'search_console', 'google_business_profile', 'pagespeed'));

COMMENT ON COLUMN public.integration_probe.provider IS
    'Qué se consultó. Incluye fuentes que NO se mapean por cliente —pagespeed sale del website del negocio—, así que esta lista es más larga que la de integration_properties a propósito.';

INSERT INTO public.schema_migrations (version) VALUES ('0023_probe_pagespeed')
ON CONFLICT (version) DO NOTHING;
