-- 0002_pagespeed_cache.down.sql
--
-- La 0002 sólo crea la tabla del caché de PageSpeed, así que volver atrás es
-- tirarla. Se lleva con ella sus tres policies y su RLS.
--
-- LO QUE SE PIERDE: el caché. No son datos del cliente sino resultados de
-- Lighthouse guardados 24 h, así que el costo de perderlos es volver a pedirlos
-- a la API — que es gratis pero lento. Nada que respaldar antes.

\set ON_ERROR_STOP on

DROP TABLE IF EXISTS public.pagespeed_cache;

-- `schema_migrations` no existe todavía en este punto de la historia: la crea la
-- 0008. Sin la guarda, `rollback.sh` muere con `relation "public.schema_migrations"
-- does not exist` y este .down no se puede probar nunca.
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM public.schema_migrations WHERE version = '0002_pagespeed_cache';
  END IF;
END
$$;
