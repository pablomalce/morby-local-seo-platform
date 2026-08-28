-- 0016_expand_publication_ledger.down.sql — la vuelta atrás de la 0016.
--
-- LO QUE SE LLEVA, Y ES LO MÁS CARO DE ESTA VUELTA ATRÁS
--
-- El registro de qué salió publicado y con qué id de la red. Los posts SIGUEN
-- publicados —están en la cuenta del cliente, del otro lado— y la base deja de
-- saberlo. O sea que después de esto, un reintento SÍ duplica: la unicidad que lo
-- impedía se fue con la tabla, y nada recuerda que ese asset ya salió.
--
-- No es un defecto de este archivo, es lo que significa revertir esta migración.
-- Pero es la clase de cosa que hay que leer ANTES y no descubrir después, así que
-- antes de correrlo sobre una base con publicaciones reales:
--
--     CREATE TABLE publicaciones_respaldo AS SELECT * FROM public.publications;
--
-- El índice único de `content_assets` se va también: lo creó la 0016 para poder
-- referenciar `(id, approved_hash)` y nadie más lo usa. Dejarlo puesto haría que
-- la huella no volviera a su estado anterior, que es lo único que `rollback.sh`
-- puede comprobar.

\set ON_ERROR_STOP on

-- La tabla se lleva sus policies, sus tres índices, sus tres CHECK y sus dos FK.
DROP TABLE IF EXISTS public.publications;

-- Después de la tabla: mientras la FK exista, este índice no se puede tirar.
DROP INDEX IF EXISTS public.content_assets_id_approved_hash_key;

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0016_expand_publication_ledger';
