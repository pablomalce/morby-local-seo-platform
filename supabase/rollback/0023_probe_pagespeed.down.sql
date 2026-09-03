-- 0023_probe_pagespeed.down.sql — la vuelta atrás de la 0023.
--
-- LO QUE HAY QUE HACER ANTES, Y SI NO ESTO FALLA
--
-- Borrar las filas de `pagespeed` que ya estén guardadas. El CHECK viejo no las
-- admite, así que restaurarlo con esas filas presentes aborta — y aborta bien:
-- un CHECK que se agrega sin validar dejaría datos que la definición dice que no
-- pueden existir. El DELETE va acá arriba, explícito, para que quede escrito que
-- se pierde el último motivo de PageSpeed de cada organización.
--
-- Igual que la 0022: la vuelta atrás del esquema no es la vuelta atrás del
-- código. Si el orquestador sigue anotando PageSpeed, el próximo reporte va a
-- fallar esa escritura — sin tumbar el reporte, porque `guardarSonda` traga su
-- error a propósito, pero el motivo se pierde otra vez.

\set ON_ERROR_STOP on

DELETE FROM public.integration_probe WHERE provider = 'pagespeed';

ALTER TABLE public.integration_probe
    DROP CONSTRAINT IF EXISTS integration_probe_provider_check;

ALTER TABLE public.integration_probe
    ADD CONSTRAINT integration_probe_provider_check
    CHECK (provider IN ('ga4', 'search_console', 'google_business_profile'));

DELETE FROM public.schema_migrations WHERE version = '0023_probe_pagespeed';
