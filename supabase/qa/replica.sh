#!/usr/bin/env bash
#
# Stands up a local replica of the Growth OS schema, from Growth OS's own
# migrations, on a throwaway PostgreSQL in Docker.
#
#   ./supabase/qa/replica.sh
#   docker exec growthos-replica psql -U postgres -d growthos \
#       -v ON_ERROR_STOP=1 -f /tmp/defects_test.sql
#
# Why this exists: the schema only ever lived inside the hosted Supabase
# project, so every claim about it was a reading of the SQL rather than a
# measurement. A claim about isolation that has never been executed is a claim.
# This makes it executable without touching the hosted database.
#
# The replica is faithful where it could have drifted: the migrations are
# applied verbatim, and the two Supabase objects they depend on are stubbed from
# supabase/qa/auth_stub.sql — the same file the CI schema job uses, so the local
# run and the CI run cannot disagree about what was proved.
#
# What it is NOT: the hosted database. Row data, extensions Supabase installs on
# its own, and PostgREST are all absent. It reproduces the SCHEMA, which is what
# every structural claim about isolation is about.

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

apply() {
    docker cp "$1" "$CONTAINER:/tmp/apply.sql" >/dev/null
    docker exec "$CONTAINER" psql -U postgres -d growthos -v ON_ERROR_STOP=1 -q -f /tmp/apply.sql >/dev/null
}

echo "==> auth stub"
apply "$REPO_ROOT/supabase/qa/auth_stub.sql"

echo "==> growth os migrations, verbatim"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
    echo "    $(basename "$f")"
    apply "$f"
done

# NOLOGIN and passwordless, here as everywhere else: the assertions reach it
# with SET ROLE, so the replica has no reason to be laxer than a real database.
echo "==> non-superuser application role"
apply "$REPO_ROOT/supabase/qa/app_role.sql"

# Left in the container so the assertions can be run against it directly.
docker cp "$REPO_ROOT/supabase/qa/defects_test.sql" "$CONTAINER:/tmp/defects_test.sql" >/dev/null

TABLES=$(docker exec "$CONTAINER" psql -U postgres -d growthos -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")

echo
echo "replica up: $TABLES tables in public"
echo "  assertions:  docker exec $CONTAINER psql -U postgres -d growthos -v ON_ERROR_STOP=1 -f /tmp/defects_test.sql"
echo "  as the app:  PGPASSWORD=growthos psql -h localhost -p $PORT -U postgres -d growthos"
echo "               then: SET ROLE growthos_app;"
