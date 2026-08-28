-- 0005_lock_pagespeed_cache.down.sql
--
-- La 0005 cerró el caché de PageSpeed a `anon` y le sacó TRUNCATE a todo el
-- mundo. Volver atrás REABRE las dos cosas, que es lo que significa revertirla:
-- la llave del navegador vuelve a poder escribir en el caché.
--
-- Se restauran las policies sin el `TO authenticated`, como las dejó la 0002:
-- una policy sin rol se aplica a PUBLIC.

\set ON_ERROR_STOP on

DROP POLICY IF EXISTS "pagespeed_cache_insert" ON public.pagespeed_cache;
CREATE POLICY "pagespeed_cache_insert" ON public.pagespeed_cache
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "pagespeed_cache_update" ON public.pagespeed_cache;
CREATE POLICY "pagespeed_cache_update" ON public.pagespeed_cache
  FOR UPDATE USING (true) WITH CHECK (true);

GRANT INSERT, UPDATE, DELETE ON public.pagespeed_cache TO anon;

-- El TRUNCATE que la 0005 sacó de todas las tablas. Se devuelve tabla por tabla
-- igual que se sacó, y no con ON ALL TABLES, para que alcance exactamente a las
-- mismas que existían entonces.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('GRANT TRUNCATE ON public.%I TO anon, authenticated', t.tablename);
  END LOOP;
END
$$;

-- `schema_migrations` no existe todavía en este punto de la historia: la crea la
-- 0008. Sin la guarda, `rollback.sh` muere con `relation "public.schema_migrations"
-- does not exist` y este .down no se puede probar nunca.
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM public.schema_migrations WHERE version = '0005_lock_pagespeed_cache';
  END IF;
END
$$;
