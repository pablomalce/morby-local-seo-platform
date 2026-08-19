#!/usr/bin/env bash
#
# Stands up a local replica of the Growth OS schema, from Growth OS's own
# migrations, on a throwaway PostgreSQL in Docker.
#
#   ./supabase/qa/replica.sh
#
# Why this exists: the Supabase project is the only place the schema has ever
# lived, so every claim about it has been a reading of the SQL rather than a
# measurement. A claim about isolation that has never been executed is a claim,
# not a fact. This makes it executable without touching the hosted database.
#
# The replica is faithful in the only two places it could have drifted: the
# migrations are applied verbatim, and the two Supabase objects they depend on —
# auth.uid() and auth.users — are stubbed rather than emulated. Nothing else
# about Supabase is reproduced, and nothing else is needed: `grep -oh 'auth\.[a-z_]*'`
# over supabase/migrations returns exactly those two.
#
# What it is NOT: the hosted database. Row data, extensions Supabase installs on
# its own, and PostgREST are all absent. It reproduces the SCHEMA, which is what
# every structural claim in ESQUEMA_CANONICO.md is about.

set -euo pipefail

CONTAINER="${CONTAINER:-growthos-replica}"
IMAGE="${IMAGE:-postgres:16}"
PORT="${PORT:-55433}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> throwaway postgres on :$PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=growthos -e POSTGRES_DB=growthos \
    -p "$PORT:5432" "$IMAGE" >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

owner() { docker exec "$CONTAINER" psql -U postgres -d growthos -v ON_ERROR_STOP=1 -q "$@"; }

# ── The two Supabase objects the migrations reach for ────────────────────────
#
# auth.uid() reads the JWT subject. Supabase populates it per request; here it
# reads a GUC so a test can say "now I am this user" and have every policy in
# the schema believe it. That is the whole point: the policies are exercised as
# written, with the identity swapped underneath them.
echo "==> auth stub"
owner -c "
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
AS \$\$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
\$\$;
" >/dev/null

echo "==> growth os migrations, verbatim"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
    echo "    $(basename "$f")"
    docker cp "$f" "$CONTAINER:/tmp/m.sql" >/dev/null
    owner -f /tmp/m.sql >/dev/null
done

# The application connects as a role that is neither the owner nor a superuser.
# A superuser bypasses RLS unconditionally, and the table owner is exempt
# wherever FORCE is missing — which, per defect 5, is every table. Asserting
# isolation as either of them would be asserting nothing.
echo "==> non-superuser application role"
owner -c "
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'growthos_app') THEN
        CREATE ROLE growthos_app LOGIN PASSWORD 'growthos' NOSUPERUSER NOBYPASSRLS;
    END IF;
END
\$\$;
GRANT USAGE ON SCHEMA public, auth TO growthos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO growthos_app;
GRANT SELECT ON auth.users TO growthos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO growthos_app;
" >/dev/null

TABLES=$(owner -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo
echo "replica up: $TABLES tables in public"
echo "  owner:  docker exec $CONTAINER psql -U postgres -d growthos"
echo "  app:    PGPASSWORD=growthos psql -h localhost -p $PORT -U growthos_app -d growthos"
