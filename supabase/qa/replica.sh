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
# La imagen de Supabase, no una PostgreSQL pelada. 17, como el proyecto hosted:
# verificar sobre una mayor distinta prueba otro motor — en el job de deriva un
# 16 producía 45 diferencias de `MAINTAIN`, un privilegio que sólo existe desde
# el 17, y ninguna era deriva de verdad.
#
# POR QUÉ CAMBIÓ, el 2026-08-28. La custodia de tokens de F2 guarda el secreto
# del cliente en Supabase Vault, que hosted tiene instalado —`supabase_vault`
# 0.3.1, esquema `vault`, medido sobre tpqiltnskfeycnybczgz— y `postgres:17` no
# tiene, ni él ni `pgsodium`. Una migración que lo use aplicaría en hosted y
# rompería esta réplica, que es la única verificación local que hay.
#
# La salida barata era un doble a mano del esquema `vault`. Es la peor: un
# `create_secret` de mentira que guarde el texto en claro haría PASAR el test de
# cifrado. Un doble que no implementa lo que el código llama no falla — hace que
# el código parezca correcto.
#
# Y la imagen no sólo trae el Vault. Trae los roles reales, y con eso la réplica
# deja de ser MÁS LAXA que producción en dos lugares que importan:
#
#   * `postgres` acá NO es superusuario, igual que en hosted. Hasta ahora las
#     migraciones se aplicaban como superusuario, así que cualquier privilegio
#     que faltara pasaba inadvertido;
#   * `service_role` viene con BYPASSRLS de fábrica. `auth_stub.sql` lo suponía y
#     lo creaba a mano; ahora es el de verdad y la suposición sobra.
#
# Es la tercera vez que esta réplica se acerca a hosted en vez de alejarse: Lead
# Engine #68 y Growth OS #44 le pusieron los default privileges por el mismo
# motivo.
IMAGE="${IMAGE:-supabase/postgres:17.4.1.075}"
PORT="${PORT:-55433}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> throwaway postgres on :$PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
# Sin POSTGRES_DB: la imagen de Supabase crearía esa base con `supabase_admin`
# de dueño, y entonces `postgres` —que acá no es superusuario— no puede ni crear
# un esquema adentro. La crea `postgres` unas líneas más abajo, y así la posee.
docker run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=growthos \
    -p "$PORT:5432" "$IMAGE" >/dev/null
# Esperar a que la BASE responda, no a que el servidor acepte conexiones. No es
# lo mismo: la imagen de postgres levanta un servidor temporal para correr su
# init y después reinicia con la configuración final, así que hay una ventana en
# la que `pg_isready` dice que sí y `growthos` todavía no existe o el servidor
# está por reiniciarse.
#
# Medido el 2026-08-26, y no es teórico: con la máquina cargada este script
# falló DOS VECES SEGUIDAS con `FATAL: database "growthos" does not exist`, y
# tres de tres bien después con la máquina tranquila. Intermitente, y es el
# PRIMER comando que `PROMPT_SIGUIENTE_SESION.md` le pide a la sesión siguiente
# — un arranque que falla bajo carga se lee como un esquema roto.
#
# Con límite y no en un `until` pelado: si algo está mal de verdad, esperar para
# siempre esconde el motivo.
# POR TCP, y no por el socket. El servidor temporal del init escucha SÓLO en el
# socket unix —`listen_addresses` vacío—, así que `docker exec psql` se conecta a
# ÉL y da verde mientras el init todavía corre; después el servidor se reinicia y
# el comando siguiente se encuentra con `the database system is shutting down`.
#
# Medido acá el 2026-08-28, al cambiar de imagen: la versión anterior esperaba a
# que existiera la base `growthos` —que la creaba el init, o sea que no existía
# hasta el final— y por eso no se topaba con esto. Sacada esa condición, el
# agujero quedó a la vista en la primera corrida.
#
# Es la misma trampa que el comentario de `pg_isready` de más arriba, en otra
# forma: la pregunta tiene que ser una que sólo el servidor FINAL pueda contestar.
espera=0
until docker exec -e PGPASSWORD=growthos "$CONTAINER" \
        psql -U postgres -h 127.0.0.1 -d postgres -c 'SELECT 1' >/dev/null 2>&1; do
    sleep 2
    espera=$((espera + 2))
    if [[ "$espera" -ge 60 ]]; then
        echo "la base postgres no respondió en 60 s. Últimas líneas del contenedor:" >&2
        docker logs --tail 20 "$CONTAINER" >&2
        exit 1
    fi
done

# La base del esquema, creada por `postgres` para que `postgres` la posea.
echo "==> base growthos, creada por postgres"
docker exec "$CONTAINER" psql -U postgres -d postgres -q -c "CREATE DATABASE growthos" >/dev/null

# El Vault, que en hosted ya está instalado y acá hay que pedirlo. `postgres`
# puede: no es superusuario, pero la imagen le deja crear esta extensión, igual
# que el editor SQL de Supabase.
echo "==> supabase_vault"
docker exec "$CONTAINER" psql -U postgres -d growthos -q \
    -c "CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE" >/dev/null

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
