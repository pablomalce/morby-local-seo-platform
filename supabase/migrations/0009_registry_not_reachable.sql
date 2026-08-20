-- 0009_registry_not_reachable.sql — sacarle a los roles de aplicación la tabla
-- que la 0008 les dejó puesta.
--
-- QUÉ CIERRA, Y ES UN DEFECTO QUE INTRODUJO LA 0008
--
-- La 0008 crea `schema_migrations` con RLS activo y sin policies, y ahí se
-- detuvo. Sobre una PostgreSQL pelada eso alcanza. Sobre Supabase no: hay
-- default privileges que le otorgan a `anon`, `authenticated` y `service_role`
-- los siete privilegios sobre cada tabla nueva de `public`, y nadie los pidió.
--
-- Medido sobre `tpqiltnskfeycnybczgz` después de aplicar la 0008:
--
--   21 grants sobre schema_migrations — los tres roles, siete privilegios cada
--   uno, incluido anon con INSERT, UPDATE, DELETE y TRUNCATE
--
-- RLS sin policies frena el SELECT, el INSERT, el UPDATE y el DELETE de `anon`.
-- **TRUNCATE no pasa por RLS.** Es el mismo hallazgo que el bloque 6 de la
-- suite de Lead Engine mide y anota, y acá aplicaba a la tabla que dice qué
-- migraciones tiene la base: con la llave pública del bundle se podía vaciar el
-- registro y dejar a la base afirmando que no tiene ninguna.
--
-- Además la réplica local no tiene esos default privileges, así que la tabla
-- nacía distinta en cada lado — que es la clase de deriva que
-- supabase/qa/schema_fingerprint.sql existe para encontrar, y es como se
-- encontró ésta.
--
-- Ningún rol de aplicación la necesita, `service_role` incluido: la lee quien
-- aplica migraciones, que se conecta como dueño y no pasa por estos grants.

\set ON_ERROR_STOP on

REVOKE ALL ON public.schema_migrations FROM anon, authenticated, service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0009_registry_not_reachable')
ON CONFLICT (version) DO NOTHING;
