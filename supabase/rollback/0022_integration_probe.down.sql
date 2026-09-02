-- 0022_integration_probe.down.sql — la vuelta atrás de la 0022.
--
-- LO QUE SE PIERDE, Y HAY QUE LEERLO ANTES
--
-- El último resultado de cada integración, de todas las organizaciones. No es
-- irrecuperable —lo vuelve a escribir el próximo reporte de cada cliente— pero
-- hasta que ese reporte ocurra, la pantalla no puede decir por qué una fuente
-- falla, y se vuelve al estado del 2026-09-02: el motivo sólo en un log que en el
-- plan Hobby dura minutos.
--
-- El `DROP TABLE` se lleva sus dos policies, su índice único y su foránea. Nada
-- fuera de la tabla depende de ella: `integration_properties` guarda el mapeo y
-- no toca esto.
--
-- Después de correr esto hay que sacar también la lectura del lado de la
-- aplicación, o la pantalla va a consultar una tabla que no existe. Es lo mismo
-- que advierte la 0019 sobre su función: la vuelta atrás del esquema no es la
-- vuelta atrás del código.

\set ON_ERROR_STOP on

DROP TABLE IF EXISTS public.integration_probe;

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0022_integration_probe';
