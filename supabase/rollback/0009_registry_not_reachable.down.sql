-- 0009_registry_not_reachable.down.sql
--
-- La 0009 sacó a los tres roles de `schema_migrations`, que es la tabla que dice
-- qué defensas tiene la base. Volver atrás la vuelve a exponer.
--
-- Se devuelve ALL a los tres porque eso es lo que tenían: los default privileges
-- de Supabase le dan los siete privilegios a los tres roles sobre toda tabla
-- nueva en `public`, y la 0008 la creó bajo esa regla.

\set ON_ERROR_STOP on

GRANT ALL ON public.schema_migrations TO anon, authenticated, service_role;

DELETE FROM public.schema_migrations WHERE version = '0009_registry_not_reachable';
