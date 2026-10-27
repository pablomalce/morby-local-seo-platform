#!/usr/bin/env bash
#
# La baja de cuenta con DOS SESIONES de verdad: lo que `defects_test.sql`, que
# es una sola transacción, no puede medir.
#
#   ./supabase/qa/baja_concurrente.sh                    # contra growthos-replica
#   CONTAINER=otra ./supabase/qa/baja_concurrente.sh
#   PSQL='psql -h localhost -U postgres -d growthos' ./supabase/qa/baja_concurrente.sh   # CI
#
# QUÉ MIDE. `delete_account_organizations` (0035) promete que la clasificación
# —«¿de cuáles es la única owner activa?»— se hace con los locks puestos y que la
# pregunta la contesta el mismo DELETE. Hasta #117 (`faade08`) eran pedidos
# sueltos de PostgREST, y entre uno y otro la base no prometía nada. Cada
# escenario pone a otra sesión a cambiar las membresías A MITAD de la baja y mira
# el estado que queda:
#
#   1. dos co-owners se dan de baja a la vez: la segunda espera, y como queda
#      única owner, se lleva la organización. Nunca queda una sin nadie;
#   2. alguien se suma como owner a la propia ANTES (sin confirmar): la baja
#      espera su COMMIT y lo ve; la organización queda con la nueva owner;
#   3. la baja va primero: el INSERT de la owner nueva espera, y muere con 23503
#      porque la organización ya no está. No queda una membresía colgada;
#   4. a un admin lo suben a owner a mitad de la baja: la baja espera el UPDATE
#      y lo ve; la organización queda. Desde la 0036 sólo lo sube un owner
#      activo o el servidor (antes se subía solo, por `members_owner_write`);
#      la sesión de acá escribe como `postgres`, que es el servidor;
#   5. a la persona la suben a owner de una organización que no estaba entre las
#      bloqueadas mientras esperaba: la baja se niega (40001) sin borrar nada;
#   6. fuera de READ COMMITTED la baja se niega (45009): su clasificación
#      depende de leer una instantánea nueva en cada sentencia;
#   7. un lock que no llega en 5 s: la baja se niega (55P03) sin borrar nada.
#
# CÓMO SABE QUE HUBO CARRERA. No por tiempos: cada escenario exige ver a la
# sesión que tiene que esperar ESPERANDO un lock (`pg_stat_activity`,
# `wait_event_type = 'Lock'`) mientras la otra tiene la transacción abierta, y
# recién ahí confirma la otra. Una baja que no esperó es un rojo aunque el estado
# final saliera bien por suerte.
#
# Cada escenario es independiente y usa sus propias personas (`d0350000-…-a035-…`);
# se limpian al empezar y al terminar. Sale con 1 si alguno da rojo, y los corre
# todos igual: un rojo no tapa a otro.

set -uo pipefail

CONTAINER="${CONTAINER:-growthos-replica}"
if [ -n "${PSQL:-}" ]; then
    BASE="$PSQL"
else
    BASE="docker exec -i $CONTAINER psql -U postgres -d growthos"
fi
# Los -v posteriores pisan a los del $PSQL del CI (que trae ON_ERROR_STOP=1):
# una sesión tiene que sobrevivir a su propio error para poder contarlo.
SESION="$BASE -X -q -At -v ON_ERROR_STOP=0 -v VERBOSITY=verbose"
UNA="$BASE -X -q -At -v ON_ERROR_STOP=1"

DIR="$(mktemp -d)"
FALLAS=0
trap 'rm -rf "$DIR"' EXIT

u() { printf 'd0350000-0035-4035-a035-%012d' "$1"; }
PERSONAS=""
for i in $(seq 1 14); do PERSONAS="$PERSONAS,'$(u "$i")'"; done
PERSONAS="${PERSONAS#,}"

consulta() { $UNA -c "$1"; }

limpiar() {
    consulta "DELETE FROM public.organizations WHERE id IN
                (SELECT organization_id FROM public.org_members WHERE user_id IN ($PERSONAS));
              DELETE FROM auth.users WHERE id IN ($PERSONAS);" >/dev/null
}

# ── Sesiones ────────────────────────────────────────────────────────────────
# Un psql por sesión, leyendo de un FIFO: la transacción queda abierta entre
# un comando y el siguiente, que es lo que hace falta para intercalar. Dos
# sesiones, con descriptores fijos (7 y 8): el bash de macOS es 3.2 y no tiene
# `exec {fd}>`.
abrir() {
    local n=$1 fd
    case "$n" in s1) fd=7 ;; s2) fd=8 ;; *) echo "sesión desconocida: $n" >&2; exit 2 ;; esac
    rm -f "$DIR/$n.in" "$DIR/$n.out"
    mkfifo "$DIR/$n.in"
    : >"$DIR/$n.out"
    # Sin heredar el extremo de escritura del FIFO de la OTRA sesión: si lo
    # hereda, esa otra nunca ve EOF y su psql no termina.
    $SESION <"$DIR/$n.in" >"$DIR/$n.out" 2>&1 7>&- 8>&- &
    eval "PID_$n=$!"
    eval "exec $fd>\"\$DIR/$n.in\""
    eval "FD_$n=$fd"
    enviar "$n" "SET application_name = 'baja35_$n';"
    # Los errores vuelven como DATOS (`SQLSTATE | mensaje`) y todo lo que el
    # script lee sale por stderr con `\warn`: el stdout de psql por un pipe va
    # con buffer, y el orden entre un resultado, un error y una marca dejaba de
    # ser el de los comandos. El bloque EXCEPTION es una subtransacción: si la
    # llamada pasa, sus locks quedan en la transacción de afuera hasta el COMMIT.
    enviar "$n" "CREATE FUNCTION pg_temp.baja(p uuid) RETURNS text LANGUAGE plpgsql AS \$f\$ BEGIN RETURN 'ok ' || public.delete_account_organizations(p)::text; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' | ' || SQLERRM; END \$f\$;"
    enviar "$n" "CREATE FUNCTION pg_temp.correr(q text) RETURNS text LANGUAGE plpgsql AS \$f\$ BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' | ' || SQLERRM; END \$f\$;"
}

enviar() {
    local fd
    eval "fd=\$FD_$1"
    printf '%s\n' "$2" >&"$fd"
}

# Espera a que la sesión haya procesado todo lo enviado.
listo() {
    local n=$1 lim=${2:-20} m i=0
    m="__listo_${n}_${RANDOM}${RANDOM}"
    enviar "$n" "\\warn $m"
    until grep -q -- "$m" "$DIR/$n.out"; do
        sleep 0.1
        i=$((i + 1))
        [ "$i" -ge $((lim * 10)) ] && return 1
    done
    return 0
}

cerrar() {
    local fd pid
    eval "fd=\${FD_$1:-}"
    eval "pid=\${PID_$1:-}"
    [ -n "$fd" ] && { enviar "$1" "ROLLBACK;" 2>/dev/null; eval "exec $fd>&-"; }
    [ -n "$pid" ] && wait "$pid" 2>/dev/null
    eval "unset FD_$1 PID_$1"
}

# ¿La sesión está esperando un lock? Hasta 15 s.
espera_lock() {
    local w i
    for i in $(seq 1 150); do
        w=$(consulta "SELECT coalesce(wait_event_type, '') FROM pg_stat_activity
                       WHERE application_name = 'baja35_$1'")
        [ "$w" = "Lock" ] && return 0
        sleep 0.1
    done
    return 1
}

# Lo que devolvió una llamada o una sentencia de la sesión: `ok …` o `SQLSTATE | mensaje`.
entre() {
    grep "^RES_$2=" "$DIR/$1.out" | sed "s/^RES_$2=//"
}

# La baja, con su resultado o su error como dato.
llamar() {
    enviar "$1" "SELECT pg_temp.baja('$3') AS r_$2 \\gset"
    enviar "$1" "\\warn RES_$2=:r_$2"
}

# Una sentencia cualquiera, igual.
correr() {
    enviar "$1" "SELECT pg_temp.correr(\$q\$$3\$q\$) AS r_$2 \\gset"
    enviar "$1" "\\warn RES_$2=:r_$2"
}

org_de() {
    consulta "SELECT organization_id FROM public.org_members
               WHERE user_id = '$1' AND role = 'owner' AND state = 'active'"
}

rojo() {
    FALLAS=$((FALLAS + 1))
    echo "ROJO  $1"
    shift
    for x in "$@"; do echo "      $x"; done
    for f in "$DIR"/*.out; do [ -s "$f" ] && sed 's/^/      | /' "$f" | head -20; done
}

verde() { echo "verde $1"; }

personas() {
    local vals="" i
    for i in "$@"; do vals="$vals,('$(u "$i")', 'b35c-$i@example.test')"; done
    consulta "INSERT INTO auth.users (id, email) VALUES ${vals#,};" >/dev/null
}

echo "==> la baja de cuenta con dos sesiones (0035)"
consulta "SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.delete_account_organizations(uuid)')" \
    | grep -qx 1 || { echo "falta public.delete_account_organizations(uuid): ¿se aplicó la 0035?" >&2; exit 1; }
limpiar

# ── 1. Dos co-owners a la vez ───────────────────────────────────────────────
personas 1 2
A=$(u 1); B=$(u 2); X=$(org_de "$A")
consulta "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ('$X', '$B', 'owner');" >/dev/null

abrir s1; abrir s2
enviar s1 "BEGIN;"; llamar s1 r "$A"; listo s1
llamar s2 r "$B"
if espera_lock s2; then espero=si; else espero=no; fi
enviar s1 "COMMIT;"; listo s1; listo s2
R1=$(entre s1 r); R2=$(entre s2 r)
cerrar s1; cerrar s2
ESTADO=$(consulta "SELECT format('x_existe=%s membresias=%s',
                     EXISTS (SELECT 1 FROM public.organizations WHERE id = '$X'),
                     (SELECT count(*) FROM public.org_members WHERE user_id IN ('$A', '$B')))")
if [ "$espero" = si ] && [ "$ESTADO" = "x_existe=f membresias=0" ] \
   && grep -q "\"left_organizations\": \[\"$X\"\]" <<<"$R1" \
   && grep -q "\"deleted_organizations\": \[.*\"$X\"" <<<"$R2"; then
    verde "1. dos co-owners a la vez: la segunda esperó, quedó única owner y se llevó X ($ESTADO)"
else
    rojo "1. dos co-owners a la vez" "esperó: $espero" "estado: $ESTADO" "alicia: $R1" "beto: $R2"
fi

# ── 2. Una owner nueva, sin confirmar, antes de la baja ─────────────────────
personas 3 4
C=$(u 3); D=$(u 4); P=$(org_de "$C")
abrir s2; abrir s1
enviar s2 "BEGIN;"
enviar s2 "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ('$P', '$D', 'owner');"
listo s2
llamar s1 r "$C"
if espera_lock s1; then espero=si; else espero=no; fi
enviar s2 "COMMIT;"; listo s2; listo s1
R1=$(entre s1 r)
cerrar s1; cerrar s2
ESTADO=$(consulta "SELECT format('p_existe=%s owners=%s de_c=%s',
                     EXISTS (SELECT 1 FROM public.organizations WHERE id = '$P'),
                     (SELECT string_agg(CASE user_id WHEN '$D' THEN 'd' WHEN '$C' THEN 'c' END, ',')
                        FROM public.org_members WHERE organization_id = '$P' AND role = 'owner' AND state = 'active'),
                     (SELECT count(*) FROM public.org_members WHERE user_id = '$C'))")
if [ "$espero" = si ] && [ "$ESTADO" = "p_existe=t owners=d de_c=0" ] \
   && grep -q "\"left_organizations\": \[\"$P\"\]" <<<"$R1" \
   && grep -q '"deleted_organizations": \[\]' <<<"$R1"; then
    verde "2. owner nueva antes de la baja: la baja esperó su COMMIT, la vio, y P quedó con ella ($ESTADO)"
else
    rojo "2. owner nueva antes de la baja" "esperó: $espero" "estado: $ESTADO" "baja: $R1"
fi

# ── 3. La baja primero; la owner nueva llega tarde ──────────────────────────
personas 5 6
C=$(u 5); D=$(u 6); P=$(org_de "$C")
abrir s1; abrir s2
enviar s1 "BEGIN;"; llamar s1 r "$C"; listo s1
correr s2 i "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ('$P', '$D', 'owner')"
if espera_lock s2; then espero=si; else espero=no; fi
enviar s1 "COMMIT;"; listo s1; listo s2
R1=$(entre s1 r); I2=$(entre s2 i)
cerrar s1; cerrar s2
ESTADO=$(consulta "SELECT format('p_existe=%s membresias_en_p=%s',
                     EXISTS (SELECT 1 FROM public.organizations WHERE id = '$P'),
                     (SELECT count(*) FROM public.org_members WHERE organization_id = '$P'))")
if [ "$espero" = si ] && [ "$ESTADO" = "p_existe=f membresias_en_p=0" ] \
   && grep -q "^23503 |" <<<"$I2" \
   && grep -q "\"deleted_organizations\": \[\"$P\"\]" <<<"$R1"; then
    verde "3. la baja primero: el INSERT esperó y murió con 23503; no quedó membresía colgada ($ESTADO)"
else
    rojo "3. la baja primero" "esperó: $espero" "estado: $ESTADO" "baja: $R1" "insert: $I2"
fi

# ── 4. A un admin lo suben a owner a mitad de la baja ───────────────────────
personas 7 8
E=$(u 7); F=$(u 8); Q=$(org_de "$E")
consulta "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ('$Q', '$F', 'admin');" >/dev/null
abrir s2; abrir s1
enviar s2 "BEGIN;"
enviar s2 "UPDATE public.org_members SET role = 'owner' WHERE organization_id = '$Q' AND user_id = '$F';"
listo s2
llamar s1 r "$E"
if espera_lock s1; then espero=si; else espero=no; fi
enviar s2 "COMMIT;"; listo s2; listo s1
R1=$(entre s1 r)
cerrar s1; cerrar s2
ESTADO=$(consulta "SELECT format('q_existe=%s owners=%s de_e=%s',
                     EXISTS (SELECT 1 FROM public.organizations WHERE id = '$Q'),
                     (SELECT string_agg(CASE user_id WHEN '$F' THEN 'f' WHEN '$E' THEN 'e' END, ',')
                        FROM public.org_members WHERE organization_id = '$Q' AND role = 'owner' AND state = 'active'),
                     (SELECT count(*) FROM public.org_members WHERE user_id = '$E'))")
if [ "$espero" = si ] && [ "$ESTADO" = "q_existe=t owners=f de_e=0" ] \
   && grep -q "\"left_organizations\": \[\"$Q\"\]" <<<"$R1"; then
    verde "4. admin al que suben a owner a mitad: la baja esperó el UPDATE, lo vio, y Q quedó con él ($ESTADO)"
else
    rojo "4. admin al que suben a owner a mitad" "esperó: $espero" "estado: $ESTADO" "baja: $R1"
fi

# ── 5. La suben a owner de una organización no bloqueada mientras espera ────
personas 9 10
G=$(u 9); H=$(u 10); PG=$(org_de "$G"); R=$(org_de "$H")
consulta "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ('$R', '$G', 'manager');" >/dev/null
abrir s2; abrir s1
enviar s2 "BEGIN;"
enviar s2 "UPDATE public.org_members SET role = 'owner' WHERE organization_id = '$R' AND user_id = '$G';"
listo s2
llamar s1 r "$G"
if espera_lock s1; then espero=si; else espero=no; fi
enviar s2 "COMMIT;"; listo s2; listo s1
R1=$(entre s1 r)
cerrar s1; cerrar s2
ESTADO=$(consulta "SELECT format('suya_existe=%s membresias_de_g=%s',
                     EXISTS (SELECT 1 FROM public.organizations WHERE id = '$PG'),
                     (SELECT count(*) FROM public.org_members WHERE user_id = '$G'))")
if [ "$espero" = si ] && grep -q "^40001 |" <<<"$R1" && [ "$ESTADO" = "suya_existe=t membresias_de_g=2" ]; then
    verde "5. owner nueva fuera de lo bloqueado: la baja se negó con 40001 y no borró nada ($ESTADO)"
else
    rojo "5. owner nueva fuera de lo bloqueado" "esperó: $espero" "estado: $ESTADO" "baja: $R1"
fi

# ── 6. Fuera de READ COMMITTED ──────────────────────────────────────────────
personas 11
I=$(u 11); PI=$(org_de "$I")
abrir s1
enviar s1 "BEGIN ISOLATION LEVEL REPEATABLE READ;"; llamar s1 r "$I"; enviar s1 "ROLLBACK;"; listo s1
R1=$(entre s1 r)
cerrar s1
ESTADO=$(consulta "SELECT format('suya_existe=%s', EXISTS (SELECT 1 FROM public.organizations WHERE id = '$PI'))")
if grep -q "^45009 |" <<<"$R1" && [ "$ESTADO" = "suya_existe=t" ]; then
    verde "6. en REPEATABLE READ la baja se niega con 45009 ($ESTADO)"
else
    rojo "6. en REPEATABLE READ" "estado: $ESTADO" "baja: $R1"
fi

# ── 7. Un lock que no llega ─────────────────────────────────────────────────
# Hasta 12 s: la función corta a los 5. Sin su `lock_timeout` esperaría a que
# la otra sesión confirme, y eso es lo que da rojo.
personas 12
J=$(u 12); PJ=$(org_de "$J")
abrir s2; abrir s1
enviar s2 "BEGIN;"; enviar s2 "SELECT 1 FROM public.organizations WHERE id = '$PJ' FOR UPDATE;"; listo s2
llamar s1 r "$J"
if listo s1 12; then corto=si; else corto=no; fi
enviar s2 "COMMIT;"; listo s2; listo s1
R1=$(entre s1 r)
cerrar s1; cerrar s2
ESTADO=$(consulta "SELECT format('suya_existe=%s', EXISTS (SELECT 1 FROM public.organizations WHERE id = '$PJ'))")
if [ "$corto" = si ] && grep -q "^55P03 |" <<<"$R1" && [ "$ESTADO" = "suya_existe=t" ]; then
    verde "7. un lock que no llega: la baja cortó sola con 55P03 y no borró nada ($ESTADO)"
else
    rojo "7. un lock que no llega" "cortó sola: $corto" "estado: $ESTADO" "baja: $R1"
fi

limpiar

if [ "$FALLAS" -gt 0 ]; then
    echo "$FALLAS de 7 escenarios en rojo"
    exit 1
fi
echo "Los 7 escenarios en verde."
