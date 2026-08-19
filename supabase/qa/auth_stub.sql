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
