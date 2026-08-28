-- 0010_explicit_table_grants.down.sql
--
-- La 0010 declaró los privilegios de tabla en vez de heredarlos, y de paso le
-- sacó a `anon` INSERT, UPDATE y DELETE sobre todo `public`. Volver atrás se los
-- devuelve: la llave que viaja en el bundle del navegador vuelve a poder escribir
-- en las tablas de todos los clientes.
--
-- Hoy las policies igual lo detienen —el comentario de la 0010 registra esa
-- medición, y por eso la migración es defensa en profundidad y no un arreglo—,
-- pero devolver el privilegio deja una sola capa donde había dos.
--
-- LO QUE NO SE DEVUELVE, Y POR QUÉ
--
--   * TRUNCATE: se lo había sacado la 0005, no la 0010. Devolverlo acá sería
--     deshacer otra migración;
--   * nada sobre `pagespeed_cache`: la 0005 le revocó a `anon` INSERT, UPDATE y
--     DELETE sobre esa tabla en particular, cinco migraciones antes. Lo dijo
--     `rollback.sh` y no una lectura: `conteo grants: 327` antes y `330` después,
--     con las tres filas de más nombradas una por una;
--   * nada sobre `schema_migrations`: la 0009 le revocó ALL a los tres roles, así
--     que el REVOKE que la 0010 repite sobre esa tabla es un no-op. Un
--     `ON ALL TABLES` la alcanzaría y otorgaría un privilegio que esa base no
--     tenía — el mismo error que `rollback.sh` rechazó en el .down de la 0011.

\set ON_ERROR_STOP on

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename NOT IN ('schema_migrations', 'pagespeed_cache')
  LOOP
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO anon', t.tablename);
  END LOOP;
END
$$;

DELETE FROM public.schema_migrations WHERE version = '0010_explicit_table_grants';
