-- Revierte la 0024.
--
-- Sacar la función devuelve la base al estado anterior EXACTO: dar de alta un
-- cliente vuelve a ser imposible desde la aplicación, que es lo que había.
--
-- No hay datos que revertir: la función no crea nada por sí sola. Las
-- organizaciones que se hayan creado con ella SIGUEN EXISTIENDO, y está bien —
-- son clientes reales, no un efecto de la migración. Borrarlas acá convertiría un
-- rollback de esquema en una pérdida de datos.

\set ON_ERROR_STOP on

DROP FUNCTION IF EXISTS public.create_client_organization(text);

DELETE FROM public.schema_migrations WHERE version = '0024_create_client_organization';
