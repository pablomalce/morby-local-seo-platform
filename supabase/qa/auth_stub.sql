-- The two Supabase objects the Growth OS migrations reach for.
--
-- Grepping supabase/migrations for auth.* returns exactly auth.uid and
-- auth.users, so this stub is complete rather than approximate. Nothing else
-- about Supabase is reproduced, and nothing else is needed to exercise the
-- schema.
--
-- auth.uid() reads the JWT subject. Supabase fills it per request; here it
-- reads a GUC, so a test can say "now I am this user" and have every policy in
-- the schema believe it. That is the point: the policies run exactly as
-- written, with the identity swapped underneath them.
--
-- Used by both supabase/qa/replica.sh and the schema job in CI. One file rather
-- than two copies: a stub that drifts between the local run and the CI run
-- would make them disagree about what was proved.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text UNIQUE,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Los roles que Supabase trae de fábrica y que las policies nombran desde
-- 0005. Sin ellos, `create policy ... to authenticated` falla acá y el esquema
-- que se prueba deja de ser el que corre en producción. NOLOGIN: en la réplica
-- nadie se conecta con ellos, sólo se los nombra.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    -- El tercero faltaba, y se notó recién cuando 0007 le otorgó EXECUTE: la
    -- réplica abortó con `role "service_role" does not exist` mientras hosted
    -- lo tiene desde siempre. Un rol que está en producción y no en la réplica
    -- es una diferencia que aparece sólo el día que alguien lo nombra.
    -- BYPASSRLS porque así es allá, y omitirlo haría que cualquier aserción
    -- sobre él midiera un rol que no es el que corre.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END
$$;
