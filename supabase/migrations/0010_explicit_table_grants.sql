-- 0010_explicit_table_grants.sql — los grants de tabla, en el repositorio y sin
-- escritura para la llave pública.
--
-- QUÉ CIERRA
--
-- Hosted tenía 282 grants de tabla a `anon`, `authenticated` y `service_role`
-- que ninguna migración de este repositorio crea: son los default privileges de
-- Supabase, que le entregan cada tabla nueva de `public` a los tres roles. La
-- réplica, una PostgreSQL pelada, tenía cero. El esquema del repositorio y el
-- de la base venían distintos desde el primer día y nadie lo veía.
--
-- LO QUE ESTO NO ES
--
-- No es cerrar una fuga abierta, y conviene decirlo antes de que el nombre del
-- archivo sugiera otra cosa. Medido sobre la réplica con los 282 grants
-- puestos, entrando como `anon` sin sesión:
--
--   lee organizations        0 filas
--   INSERT en businesses     rechazado
--   UPDATE en organizations  rechazado
--   DELETE en organizations  no falla, borra 0 filas
--
-- Las policies ya lo frenan. Lo que pasa es que son lo ÚNICO que lo frena: no
-- hay ninguna policy que nombre a `anon`, pero sí dieciocho a PUBLIC, y PUBLIC
-- incluye a `anon`. Lo que lo detiene es que `current_user_org_ids()` devuelve
-- vacío sin `auth.uid()`. Una capa, y depende de una función.
--
-- Sacarle la escritura agrega la segunda: para escribir haría falta que la
-- función se rompa Y que alguien le devuelva el permiso.
--
-- QUÉ SE LE DEJA A CADA UNO
--
--   anon           SELECT, REFERENCES, TRIGGER — lo mismo que dejó la 0002 de
--                  Lead Engine. REFERENCES y TRIGGER son inertes para un
--                  cliente que entra por PostgREST, y quitarlos movería más
--                  superficie de la necesaria en un solo paso.
--   authenticated  los seis, sin TRUNCATE, que el #21 ya había revocado.
--   service_role   los siete. Es el rol con el que corre el trabajo del
--                  servidor y bypassea RLS por diseño.
--
-- Reproducirlos acá es lo que devuelve la deriva a cero: a partir de ahora la
-- réplica nace con lo mismo que la base.
--
-- LO QUE ESTO NO ARREGLA SOLO
--
-- La próxima tabla que se cree en `public` va a volver a recibir los siete
-- privilegios para los tres roles, porque los default privileges de Supabase
-- siguen ahí. Ya pasó dos veces con `schema_migrations`. El bloque 14 de
-- supabase/qa/defects_test.sql es lo que hace que la próxima vez se note.

\set ON_ERROR_STOP on

-- Explícito y no heredado del default: lo que el catálogo debe tener queda
-- dicho acá, y la réplica lo reproduce.
GRANT SELECT, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Y lo que no debe tener. Va después de los GRANT porque `GRANT ... ON ALL
-- TABLES` alcanza a todas, incluidas las que la llave pública no tiene por qué
-- escribir.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- schema_migrations queda fuera del alcance de los tres, como la dejó la 0009:
-- el `GRANT ... ON ALL TABLES` de arriba se la había devuelto.
REVOKE ALL ON public.schema_migrations FROM anon, authenticated, service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0010_explicit_table_grants')
ON CONFLICT (version) DO NOTHING;
