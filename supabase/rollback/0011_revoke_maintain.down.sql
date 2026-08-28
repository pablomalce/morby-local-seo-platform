-- 0011_revoke_maintain.down.sql
--
-- La 0011 le sacó MAINTAIN a `anon` y `authenticated`. MAINTAIN existe desde
-- PostgreSQL 17 y permite VACUUM, ANALYZE, REINDEX y CLUSTER: no lee datos, pero
-- deja tomar bloqueos pesados sobre las tablas de todos los clientes.
--
-- Volver atrás se lo devuelve, que es reabrir esa puerta.

\set ON_ERROR_STOP on

-- Tabla por tabla y NO `ON ALL TABLES`, salteando `schema_migrations`.
--
-- Antes de la 0011 esa tabla no tenía MAINTAIN para nadie: la 0009 y la 0010 le
-- habían revocado ALL. Un `ON ALL TABLES` se lo devolvería, o sea otorgaría un
-- privilegio que esa base nunca tuvo. Lo dijo `rollback.sh`, no una lectura:
-- `conteo grants: 285` antes y `287` después, con las dos filas de más nombradas.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
  LOOP
    EXECUTE format('GRANT MAINTAIN ON public.%I TO anon, authenticated', t.tablename);
  END LOOP;
END
$$;

DELETE FROM public.schema_migrations WHERE version = '0011_revoke_maintain';
