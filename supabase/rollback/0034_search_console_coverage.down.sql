-- Revierte la 0034.
--
-- QUÉ SE REABRE
--
-- Que dos organizaciones vivas lean el mismo tráfico de Search Console con el
-- token de la agencia. Sin el trigger vuelve lo medido el 2026-10-11 en la
-- revisión del #118: `sc-domain:ejemplo.com` en X y `https://www.ejemplo.com/`,
-- `https://ejemplo.com/` o `http://ejemplo.com/blog/` en Y conviven vivos, porque
-- la unicidad de la 0017 compara texto y no lo que cada propiedad cubre.
-- `property-actions.ts` sigue traduciendo el 23P01, que simplemente deja de
-- llegar.
--
-- QUÉ NO TOCA
--
-- Los datos. Todo mapeo que entró con la 0034 puesta es una fila válida para la
-- 0017 sin ella: no hay nada que deshacer en las filas.
--
-- EL ORDEN: el trigger antes que su función, y la función del trigger antes que
-- la de solape, que la usa. `DROP FUNCTION` sin CASCADE falla nombrando la
-- dependencia si alguien colgó otra cosa de ellas, que es lo que tiene que pasar.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_integration_properties_search_console_coverage ON public.integration_properties;
DROP FUNCTION IF EXISTS public.integration_properties_search_console_coverage();
DROP FUNCTION IF EXISTS public.search_console_overlap(text, text);

DELETE FROM public.schema_migrations WHERE version = '0034_search_console_coverage';

COMMIT;
