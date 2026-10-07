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

# Los archivos de la carrera del .down con datos (ver abajo), fuera del
# repositorio.
TMPDIR_CARRERA="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_CARRERA"' EXIT

aplicar() {
    docker cp "$1" "$CONTAINER:/tmp/paso.sql" >/dev/null
    docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f /tmp/paso.sql >/dev/null
}

huella() {
    docker cp "$REPO_ROOT/supabase/qa/schema_fingerprint.sql" "$CONTAINER:/tmp/huella.sql" >/dev/null
    docker exec "$CONTAINER" psql -U postgres -d "${1:-$DB}" -tAf /tmp/huella.sql
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

# EL .down CON DATOS, cuando la migración declara qué tiene que negarse a borrar.
#
# La corrida de abajo aplica el .down sobre una base VACÍA, y ahí un .down que se
# niega con datos y uno que borra sin preguntar son idénticos: los dos revierten.
# Medido el 2026-10-06 sobre la `0029`: con su negativa quitada, este script
# seguía verde y el .down tiraba un tablero poblado sin pedir nada, en un
# proyecto hosted de tier gratuito, sin backups ni PITR. La negativa sólo estaba
# medida a mano.
#
# Si existe `supabase/qa/down_con_datos/<MIG>.sql`, se siembra una COPIA de la
# base ya migrada —la base de la prueba de abajo no se toca— y sobre ella el
# .down tiene que:
#   1. NEGARSE sin permiso, dejando la huella como estaba;
#   2. NEGARSE con el permiso en PGOPTIONS, nombrándolo —ése sobrevive al RESET
#      y valdría para todas las corridas—, dejando la huella como estaba;
#   3. NEGARSE con un permiso que no es 'si' —`SET <guc> = 'no'`—, dejando la
#      huella como estaba. El permiso se pide con todas las letras: un .down que
#      aceptara cualquier valor no vacío borraba el tablero con un 'no', y los
#      pasos 1, 2 y 4 no lo distinguían de 'si';
#   4. REVERTIR con el permiso dado con SET en la sesión, dejando la huella como
#      antes de la migración —es el control: sin él, un .down que no corre nunca
#      pasaría 1, 2 y 3—, SIN su fila en `schema_migrations` —el chequeo del
#      registro de más abajo corre sobre la base VACÍA, y el camino poblado es el
#      que va a recorrer hosted— y CONSUMIENDO el permiso: en la MISMA sesión,
#      después del .down, el permiso tiene que estar vacío. Cada paso de este
#      script es un `psql` nuevo, así que la sesión moría con el permiso adentro y
#      nadie miraba si el .down lo había consumido; sin su RESET, una sesión que
#      se reusa —interactiva, o de un pool— borraba un segundo tablero poblado
#      sin que nadie volviera a pedirlo.
# Y aparte, sobre OTRA copia, con el tablero vacío:
#   5. NEGARSE a una tarjeta que se CONFIRMA MIENTRAS el .down corre. Una sesión
#      corre la siembra en una transacción abierta y espera, sin confirmar, a que
#      el .down quede esperando un lock; ahí confirma. Un .down que cuenta ANTES
#      de tomar el lock cuenta cero —la fila todavía no está confirmada—, sigue,
#      y su DROP espera, recibe la tarjeta ya confirmada y la borra: medido, sin
#      el LOCK los pasos 1 a 4 seguían en verde y se perdía una tarjeta sin
#      permiso. Uno que toma el lock primero espera la confirmación, cuenta una y
#      se niega. Por el lock que espera el .down y no por un reloj: con un
#      `pg_sleep`, en una máquina cargada la tarjeta puede confirmarse antes de
#      que el .down arranque, y la prueba pasaría sin haber medido la carrera.
# La siembra dice el nombre del permiso en una línea `-- permiso: <guc>`.
SIEMBRA="$REPO_ROOT/supabase/qa/down_con_datos/$MIG.sql"
if [ -f "$SIEMBRA" ]; then
    COPIA="${DB}_con_datos"
    PERMISO="$(sed -n 's/^-- permiso: *\([a-z_.]*\) *$/\1/p' "$SIEMBRA" | head -1)"
    if [ -z "$PERMISO" ]; then
        echo "$SIEMBRA no dice el permiso: falta la línea '-- permiso: <guc>'." >&2
        exit 1
    fi
    echo "==> $MIG.down sobre una copia con datos"
    docker exec "$CONTAINER" psql -U postgres -d postgres -q \
        -c "DROP DATABASE IF EXISTS $COPIA" -c "CREATE DATABASE $COPIA TEMPLATE $DB" >/dev/null
    docker cp "$SIEMBRA" "$CONTAINER:/tmp/siembra.sql" >/dev/null
    docker exec "$CONTAINER" psql -U postgres -d "$COPIA" -v ON_ERROR_STOP=1 -q -f /tmp/siembra.sql >/dev/null
    docker cp "$REPO_ROOT/supabase/rollback/$MIG.down.sql" "$CONTAINER:/tmp/down.sql" >/dev/null
    SEMBRADA="$(huella "$COPIA")"

    echo "    sin permiso: tiene que negarse"
    if docker exec "$CONTAINER" psql -U postgres -d "$COPIA" -v ON_ERROR_STOP=1 -q \
            -f /tmp/down.sql >/dev/null 2>&1; then
        echo "el .down de $MIG revirtió una base CON DATOS sin que nadie lo pidiera." >&2
        exit 1
    fi
    if [ "$(huella "$COPIA")" != "$SEMBRADA" ]; then
        echo "el .down de $MIG se negó, pero dejó el esquema cambiado." >&2
        exit 1
    fi

    echo "    con el permiso en PGOPTIONS: tiene que negarse, nombrándolo"
    if SALIDA="$(docker exec -e PGOPTIONS="-c $PERMISO=si" "$CONTAINER" \
            psql -U postgres -d "$COPIA" -v ON_ERROR_STOP=1 -q -f /tmp/down.sql 2>&1)"; then
        echo "el .down de $MIG aceptó un permiso que viene de PGOPTIONS: sobrevive al RESET." >&2
        exit 1
    fi
    if ! echo "$SALIDA" | grep -q "PGOPTIONS"; then
        echo "el .down de $MIG se negó con PGOPTIONS, pero no por el origen del permiso:" >&2
        echo "$SALIDA" | sed 's/^/  /' >&2
        exit 1
    fi
    if [ "$(huella "$COPIA")" != "$SEMBRADA" ]; then
        echo "el .down de $MIG se negó con PGOPTIONS, pero dejó el esquema cambiado." >&2
        exit 1
    fi

    echo "    con un permiso que no es 'si' en la sesión: tiene que negarse"
    if docker exec "$CONTAINER" psql -U postgres -d "$COPIA" -v ON_ERROR_STOP=1 -q \
            -c "SET $PERMISO = 'no'" -f /tmp/down.sql >/dev/null 2>&1; then
        echo "el .down de $MIG revirtió una base CON DATOS con $PERMISO = 'no': acepta cualquier permiso no vacío." >&2
        exit 1
    fi
    if [ "$(huella "$COPIA")" != "$SEMBRADA" ]; then
        echo "el .down de $MIG se negó con un permiso que no es 'si', pero dejó el esquema cambiado." >&2
        exit 1
    fi

    echo "    con el permiso en la sesión: tiene que revertir, sacar su registro y consumir el permiso"
    if ! SALIDA="$(docker exec "$CONTAINER" psql -U postgres -d "$COPIA" -v ON_ERROR_STOP=1 -q -tA \
            -c "SET $PERMISO = 'si'" -f /tmp/down.sql \
            -c "SELECT 'permiso=[' || coalesce(current_setting('$PERMISO', true), '') || ']'")"; then
        echo "el .down de $MIG no revierte ni con el permiso en la sesión: la negativa no depende del permiso." >&2
        exit 1
    fi
    if [ "$(huella "$COPIA")" != "$ANTES" ]; then
        echo "con el permiso, el .down de $MIG no dejó el esquema como estaba antes de la migración." >&2
        exit 1
    fi
    if [ "$(echo "$SALIDA" | grep '^permiso=' | tail -1)" != "permiso=[]" ]; then
        echo "el .down de $MIG revirtió pero no consumió el permiso: en la misma sesión quedó $(echo "$SALIDA" | grep '^permiso=' | tail -1)." >&2
        echo "una sesión que se reusa borraría el próximo tablero poblado sin que nadie lo vuelva a pedir." >&2
        exit 1
    fi
    if [ "$(docker exec "$CONTAINER" psql -U postgres -d "$COPIA" -tAc \
            "SELECT count(*) FROM public.schema_migrations WHERE version = '$MIG'")" != "0" ]; then
        echo "con el permiso, el .down de $MIG revirtió una base CON DATOS pero dejó $MIG en schema_migrations." >&2
        echo "check_drift.sh leería esa fila y diría que no falta ninguna migración." >&2
        exit 1
    fi
    docker exec "$CONTAINER" psql -U postgres -d postgres -q -c "DROP DATABASE IF EXISTS $COPIA" >/dev/null

    echo "    una tarjeta que se confirma mientras el .down corre, sin permiso: tiene que negarse"
    CARRERA="${DB}_carrera"
    docker exec "$CONTAINER" psql -U postgres -d postgres -q \
        -c "DROP DATABASE IF EXISTS $CARRERA" -c "CREATE DATABASE $CARRERA TEMPLATE $DB" >/dev/null
    # La sesión que siembra no confirma hasta ver al .down esperando un lock.
    # Con límite: si el .down nunca espera, la siembra muere y la prueba se dice
    # vacua.
    printf '%s\n' \
        "DO \$\$" \
        "DECLARE" \
        "    marca text := 'qa_carrera_espera';" \
        "    t0    timestamptz := clock_timestamp();" \
        "BEGIN" \
        "    LOOP" \
        "        PERFORM pg_stat_clear_snapshot();" \
        "        EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity" \
        "                           WHERE application_name = 'qa_carrera_down' AND wait_event_type = 'Lock');" \
        "        IF clock_timestamp() - t0 > interval '60 seconds' THEN" \
        "            RAISE EXCEPTION 'qa_carrera: el .down nunca quedó esperando un lock';" \
        "        END IF;" \
        "        PERFORM pg_sleep(0.05);" \
        "    END LOOP;" \
        "END" \
        "\$\$;" > "$TMPDIR_CARRERA/espera.sql"
    docker cp "$TMPDIR_CARRERA/espera.sql" "$CONTAINER:/tmp/carrera_espera.sql" >/dev/null
    docker exec -e PGAPPNAME=qa_carrera_tarjeta "$CONTAINER" \
        psql -U postgres -d "$CARRERA" -v ON_ERROR_STOP=1 -q \
        -c "BEGIN" -f /tmp/siembra.sql -f /tmp/carrera_espera.sql -c "COMMIT" \
        >"$TMPDIR_CARRERA/tarjeta.log" 2>&1 &
    TARJETA_PID=$!
    lista=0
    for _ in $(seq 1 120); do
        if [ "$(docker exec "$CONTAINER" psql -U postgres -d postgres -tAc \
                "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'qa_carrera_tarjeta' AND state = 'active' AND query LIKE '%qa_carrera_espera%'")" = "1" ]; then
            lista=1
            break
        fi
        sleep 0.5
    done
    if [ "$lista" != "1" ]; then
        wait "$TARJETA_PID" || true
        echo "carrera vacua: la sesión que siembra nunca quedó con la tarjeta sin confirmar:" >&2
        sed 's/^/  /' "$TMPDIR_CARRERA/tarjeta.log" >&2
        exit 1
    fi
    if SALIDA="$(docker exec -e PGAPPNAME=qa_carrera_down "$CONTAINER" \
            psql -U postgres -d "$CARRERA" -v ON_ERROR_STOP=1 -q -f /tmp/down.sql 2>&1)"; then
        DOWN_OK=1
    else
        DOWN_OK=0
    fi
    if ! wait "$TARJETA_PID"; then
        echo "carrera vacua: la sesión que siembra no llegó al COMMIT:" >&2
        sed 's/^/  /' "$TMPDIR_CARRERA/tarjeta.log" >&2
        exit 1
    fi
    if [ "$DOWN_OK" = "1" ]; then
        echo "el .down de $MIG revirtió, sin permiso, una base en la que otra sesión confirmó una tarjeta mientras" >&2
        echo "corría: contó antes de tomar el lock, y la tarjeta se perdió sin que nadie lo pidiera." >&2
        exit 1
    fi
    if echo "$SALIDA" | grep -qiE "deadlock|lock timeout|canceling statement"; then
        echo "el .down de $MIG falló en la carrera, pero por el lock y no por la negativa:" >&2
        echo "$SALIDA" | sed 's/^/  /' >&2
        exit 1
    fi
    if [ "$(huella "$CARRERA")" != "$DESPUES" ]; then
        echo "el .down de $MIG se negó en la carrera, pero dejó el esquema cambiado." >&2
        exit 1
    fi
    docker exec "$CONTAINER" psql -U postgres -d postgres -q -c "DROP DATABASE IF EXISTS $CARRERA" >/dev/null
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
