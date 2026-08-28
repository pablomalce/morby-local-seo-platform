#!/usr/bin/env bash
#
# Prueba que la vuelta atrás de una migración deje el esquema como estaba.
#
#   ./supabase/qa/rollback.sh
#
# Qué hace, en este orden:
#
#   1. Construye una base con las migraciones ANTERIORES a la que se prueba.
#   2. Toma la huella. Ése es el estado al que hay que poder volver.
#   3. Aplica la migración, y después su .down.
#   4. Toma la huella otra vez y la compara con la primera.
#
# Por qué existe. El proyecto hosted de este repositorio vive en la misma
# organización de plan free que el de Lead Engine, y el tier gratuito de Supabase
# no tiene backups automáticos ni PITR. El .down no es una formalidad: es la
# única ruta de retorno que existe, y un .down que nadie corrió es una ruta de
# retorno que nadie probó.
#
# Mismo espíritu que schema-canonico/qa_pares.sh en Vulkan OS, y por el mismo
# motivo: lo que agrega un runner, lo quita el runner — pero eso hay que
# medirlo, no afirmarlo.
#
# DE DÓNDE SALIÓ ESTE ARCHIVO. Es el rollback.sh de Lead Engine, portado el
# 2026-08-28 con tres cambios: el nombre del contenedor, la migración por
# defecto, y nada más. Se porta ahora porque
# ~/vulkan-os/PROMPT_SIGUIENTE_SESION.md le pide a la sesión de F2 que pruebe el
# .down de su migración nueva "con ./supabase/qa/rollback.sh", y ese comando no
# existía acá: la instrucción apuntaba al otro repositorio. Este repo no tenía el
# script, ni el directorio, ni un solo .down escrito en trece migraciones.
#
# Los .down viven en supabase/rollback/ y NO en supabase/migrations/ a
# propósito. Tres lugares recorren migrations/*.sql —replica.sh, el job de CI y
# el de deriva— y un .down ahí adentro se aplicaría solo, deshaciendo la
# migración de la línea anterior. Sacarlos del directorio no depende de que los
# tres se acuerden de excluirlos.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="${CONTAINER:-growthos-replica}"
DB="rollback_test"
MIG="${1:-0013_org_member_archive}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "El contenedor $CONTAINER no está andando. Corré primero ./supabase/qa/replica.sh" >&2
    exit 1
fi

psql_db() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 "$@"; }

aplicar() {
    docker cp "$1" "$CONTAINER:/tmp/paso.sql" >/dev/null
    docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f /tmp/paso.sql >/dev/null
}

huella() {
    docker cp "$REPO_ROOT/supabase/qa/schema_fingerprint.sql" "$CONTAINER:/tmp/huella.sql" >/dev/null
    docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAf /tmp/huella.sql
}

echo "==> base limpia"
docker exec "$CONTAINER" psql -U postgres -d postgres -q \
    -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null

# El Vault, igual que replica.sh. Las extensiones son POR BASE, así que una base
# recién creada no lo tiene aunque el contenedor sí. Lo pidió la 0014, que
# referencia vault.secrets: sin esta línea el script muere con
# `schema "vault" does not exist` al aplicarla, y el .down de cualquier migración
# posterior a ella deja de poder probarse.
docker exec "$CONTAINER" psql -U postgres -d "$DB" -q \
    -c "CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE" >/dev/null

echo "==> migraciones anteriores a $MIG"
aplicar "$REPO_ROOT/supabase/qa/auth_stub.sql"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
    nombre="$(basename "$f" .sql)"
    [ "$nombre" \< "$MIG" ] || continue
    echo "    $nombre"
    aplicar "$f"
done
aplicar "$REPO_ROOT/supabase/qa/app_role.sql"

ANTES="$(huella)"

echo "==> $MIG"
aplicar "$REPO_ROOT/supabase/migrations/$MIG.sql"
DESPUES="$(huella)"

if [ "$ANTES" = "$DESPUES" ]; then
    # Sin esto, un .down vacío pasaría: si la migración no cambió nada, volver
    # atrás tampoco, y las dos huellas coincidirían por un motivo que no tiene
    # nada que ver con que el .down funcione.
    echo
    echo "corrida vacua: $MIG no cambió el esquema, así que esta prueba no puede" >&2
    echo "distinguir un .down que anda de uno que no hace nada." >&2
    exit 1
fi

echo "==> $MIG.down"
aplicar "$REPO_ROOT/supabase/rollback/$MIG.down.sql"
VUELTA="$(huella)"

# El registro, aparte de la huella, y no es redundante: `schema_fingerprint.sql`
# compara OBJETOS del esquema, no el contenido de las tablas, así que un .down
# que se olvide de borrar su fila de schema_migrations pasa la comparación sin
# problema. Lo dijo una mutación, no una lectura.
#
# El agujero que eso deja es el peor posible en este repositorio: `check_drift.sh`
# lee esa tabla para decidir qué falta aplicar. Con la fila puesta y el esquema
# revertido, el job de deriva informa "no falta ninguna" sobre una base que sí
# volvió atrás — que es exactamente la clase de mentira silenciosa por la que
# existe el job.
#
# Y se saltea cuando la tabla todavía no existe, que es el caso de toda migración
# ANTERIOR a la 0008 — la que la crea. Sin esta guarda, el script no podía probar
# el .down de ninguna de las siete primeras: moría acá con
# `relation "public.schema_migrations" does not exist` DESPUÉS de haber
# comprobado el esquema, o sea informando un error sobre una vuelta atrás que
# había funcionado.
echo "==> ¿el registro quedó limpio?"
HAY_REGISTRO="$(psql_db -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")"
if [ "$HAY_REGISTRO" != "t" ]; then
    echo "    (no aplica: schema_migrations no existe antes de la 0008)"
    REGISTRADA=0
else
    REGISTRADA="$(psql_db -tAc "SELECT count(*) FROM public.schema_migrations WHERE version = '$MIG'")"
fi
if [ "$REGISTRADA" != "0" ]; then
    echo
    echo "la vuelta atrás revirtió el esquema pero dejó $MIG en schema_migrations." >&2
    echo "check_drift.sh leería esa fila y diría que no falta ninguna migración." >&2
    exit 1
fi

echo "==> ¿el esquema volvió a como estaba?"
if [ "$ANTES" = "$VUELTA" ]; then
    echo
    echo "la vuelta atrás de $MIG deja el esquema idéntico: $(echo "$ANTES" | wc -l | tr -d ' ') objetos."
    docker exec "$CONTAINER" psql -U postgres -d postgres -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null
else
    echo
    echo "la vuelta atrás NO deja el esquema como estaba:" >&2
    echo "  '<' estaba antes y falta después, '>' quedó de más" >&2
    diff <(echo "$ANTES") <(echo "$VUELTA") | grep -E '^[<>]' | sed 's/^/  /' >&2
    exit 1
fi
