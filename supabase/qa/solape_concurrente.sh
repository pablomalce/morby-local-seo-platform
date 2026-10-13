#!/usr/bin/env bash
#
# solape_concurrente.sh — lo de la 0034 que `defects_test.sql` no puede medir.
#
#   CONTAINER=growthos-replica ./supabase/qa/solape_concurrente.sh   # réplica local
#   PSQL="psql -h localhost -U postgres -d growthos" ./supabase/qa/solape_concurrente.sh   # CI
#
# QUÉ IMPIDE ESTE ARCHIVO
#
# Que la regla de solape de Search Console sea un `if` con dos onboardings
# concurrentes pasando los dos por él. `defects_test.sql` corre entero en UNA
# transacción, así que no puede tener dos a la vez ni cambiar su aislamiento: las
# dos garantías que dependen de eso se miden acá.
#
#   1. CONCURRENCIA. La sesión A mapea `sc-domain:concurrente34.test` y se queda
#      con la transacción abierta tres segundos. La sesión B, mientras tanto,
#      mapea `https://www.concurrente34.test/` en otra organización. Con el
#      candado de la 0034, B espera a que A confirme, la ve, y muere con 23P01:
#      queda UN mapeo vivo. Sin el candado, la consulta de B no ve la fila sin
#      confirmar de A y quedan DOS.
#   2. AISLAMIENTO. En REPEATABLE READ la foto es la del principio de la
#      transacción y el candado no alcanza: el trigger no decide y rechaza con
#      45007. Con la contraprueba de que en READ COMMITTED el mismo INSERT, sin
#      solape, entra.
#   3. EL REMAPEO, CONCURRENTE. Lo que `mapProperty()` hace de verdad: la
#      sesión A remapea su organización a `sc-domain:remapconc34.test` y se
#      queda abierta; B, que ya tenía un mapeo vivo propio, se remapea por
#      `remap_integration_property()` a `https://www.remapconc34.test/`. B
#      espera, muere con 23P01, y CONSERVA su mapeo anterior: el desmapeo que la
#      función hizo antes del INSERT se revierte con él. Con el remapeo en dos
#      llamadas (hasta la segunda revisión del #118), B quedaba sin ninguno.
#   4. LA MIGRACIÓN, CON UN ONBOARDING ABIERTO. Lo que la guarda de la 0034 no
#      puede dejar pasar: un INSERT que se solapa con un mapeo vivo, sin
#      confirmar MIENTRAS corre la migración. Se revierte la 0034 (su .down), la
#      organización 6 tiene `https://www.toctou34.test/` vivo, la sesión A
#      inserta `sc-domain:toctou34.test` en la 7 y confirma a los tres segundos,
#      y en el medio se aplica el archivo de la migración. Con la guarda DESPUÉS
#      del trigger, el candado del DROP/CREATE TRIGGER espera a A, la guarda ve
#      el par y la 0034 NO se aplica. Con la guarda antes (hasta la tercera
#      revisión del #118), contaba antes de que A confirmara y la 0034 quedaba
#      aplicada con el par vivo. Contraprueba: sin el par, se aplica.
#   5. LA MIGRACIÓN, FUERA DE READ COMMITTED. En REPEATABLE READ la foto de la
#      guarda es anterior al candado, así que el punto 4 deja de valer: la
#      guarda rechaza. Contraprueba: en READ COMMITTED, se aplica.
#
# Escribe filas de verdad (las dos sesiones tienen que confirmar para medir algo)
# en organizaciones propias, y las borra al salir, pase lo que pase. Los puntos 4
# y 5 revierten y vuelven a aplicar la 0034 sobre la misma base: al salir, pase
# lo que pase, la deja aplicada (con el archivo del repositorio) y con los EXECUTE
# que tenían sus funciones. La migración sola no los da todos: en CI y en la
# réplica, `app_role.sql` le da EXECUTE a `growthos_app` sobre TODAS las funciones
# DESPUÉS de las migraciones, y revertir y reaplicar se los sacaba (medido: la
# huella perdía `growthos_app=X` en las cuatro). Se guardan antes de revertir, se
# devuelven después, y el último chequeo compara los permisos con los de antes.

set -euo pipefail

CONTAINER="${CONTAINER:-growthos-replica}"
PSQL="${PSQL:-docker exec -i $CONTAINER psql -U postgres -d growthos}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRACION="$REPO_ROOT/supabase/migrations/0034_search_console_coverage.sql"
VUELTA="$REPO_ROOT/supabase/rollback/0034_search_console_coverage.down.sql"

sql() { $PSQL -v ON_ERROR_STOP=1 -qAt "$@"; }

U1="34990000-0034-4034-8034-000000000001"
U2="34990000-0034-4034-8034-000000000002"
U3="34990000-0034-4034-8034-000000000003"
U4="34990000-0034-4034-8034-000000000004"
U5="34990000-0034-4034-8034-000000000005"
U6="34990000-0034-4034-8034-000000000006"
U7="34990000-0034-4034-8034-000000000007"
USUARIOS="'$U1', '$U2', '$U3', '$U4', '$U5', '$U6', '$U7'"

# ¿Está la 0034? Su fila en el registro, y el estado de su trigger ('-' si no hay).
registro() { sql -c "SELECT count(*) FROM public.schema_migrations WHERE version = '0034_search_console_coverage'"; }
disparo() {
    sql -c "SELECT coalesce((SELECT tgenabled::text FROM pg_trigger
                              WHERE tgrelid = 'public.integration_properties'::regclass
                                AND tgname = 'trg_integration_properties_search_console_coverage'), '-')"
}
aplicada() { if [[ "$(registro)" == "1" ]]; then echo "aplicada, trigger $(disparo)"; else echo "sin aplicar, trigger $(disparo)"; fi; }

# Los EXECUTE de las cuatro funciones de la 0034, y los GRANT que los devuelven.
FUNCIONES="'search_console_canonical', 'search_console_overlap',
           'integration_properties_search_console_coverage', 'remap_integration_property'"
permisos() {
    sql -c "SELECT string_agg(p.proname || ' ' || coalesce(array_to_string(p.proacl::text[], ' '), 'default'),
                              ' | ' ORDER BY p.proname)
              FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ($FUNCIONES)"
}
grants_de_hoy() {
    sql -c "SELECT coalesce(string_agg(format('GRANT EXECUTE ON FUNCTION %s TO %s;', p.oid::regprocedure,
                                              CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                                   ELSE quote_ident(pg_get_userbyid(a.grantee)) END),
                                       ' ' ORDER BY p.proname, a.o), '')
              FROM pg_proc p
              CROSS JOIN LATERAL aclexplode(p.proacl) WITH ORDINALITY AS a(grantor, grantee, privilege_type, is_grantable, o)
             WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ($FUNCIONES)
               AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner"
}
DEVOLVER=""
reaplicar() {
    $PSQL -v ON_ERROR_STOP=1 -q < "$MIGRACION" >/dev/null 2>&1 || true
    if [[ -n "$DEVOLVER" && "$(registro)" == "1" ]]; then sql -c "$DEVOLVER" >/dev/null; fi
}

limpiar() {
    sql -c "DELETE FROM public.organizations WHERE id IN (
                SELECT organization_id FROM public.org_members WHERE user_id IN ($USUARIOS));
            DELETE FROM auth.users WHERE id IN ($USUARIOS);" >/dev/null 2>&1 || true
    # Los puntos 4 y 5 revierten la 0034: la base queda como la encontraron.
    if [[ "$(registro 2>/dev/null)" == "0" ]]; then reaplicar; fi
}
trap limpiar EXIT
limpiar

# Tres organizaciones, por el alta de verdad (`handle_new_user()`). La tercera
# es la del punto 2, para que su resultado no dependa del 1: si B entrara, ORG2
# ya tendría un mapeo vivo y el punto 2 mediría la unicidad de la 0017.
sql -c "INSERT INTO auth.users (id, email) VALUES ('$U1', 'conc34-1@example.test'),
        ('$U2', 'conc34-2@example.test'), ('$U3', 'conc34-3@example.test'),
        ('$U4', 'conc34-4@example.test'), ('$U5', 'conc34-5@example.test'),
        ('$U6', 'conc34-6@example.test'), ('$U7', 'conc34-7@example.test')" >/dev/null
ORG1="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U1'")"
ORG2="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U2'")"
ORG3="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U3'")"
ORG4="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U4'")"
ORG5="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U5'")"
ORG6="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U6'")"
ORG7="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U7'")"
[[ -n "$ORG1" && -n "$ORG2" && -n "$ORG3" && -n "$ORG4" && -n "$ORG5" && -n "$ORG6" && -n "$ORG7" \
   && "$(printf '%s\n' "$ORG1" "$ORG2" "$ORG3" "$ORG4" "$ORG5" "$ORG6" "$ORG7" | sort -u | wc -l | tr -d ' ')" == "7" ]] \
    || { echo "no se crearon las siete organizaciones" >&2; exit 1; }
[[ "$(aplicada)" == "aplicada, trigger A" ]] \
    || { echo "la 0034 no está aplicada en esta base: $(aplicada)" >&2; exit 1; }
PERMISOS_ANTES="$(permisos)"
DEVOLVER="$(grants_de_hoy)"

# Un INSERT como `service_role` (como `property-actions.ts`), que dice con qué
# SQLSTATE murió en vez de abortar.
mapear() { # <organización> <ref>
    cat <<SQL
SET ROLE service_role;
DO \$\$
BEGIN
    INSERT INTO public.integration_properties (organization_id, provider, property_ref)
    VALUES ('$1', 'search_console', '$2');
    RAISE NOTICE 'RESULTADO ok';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'RESULTADO %', SQLSTATE;
END
\$\$;
SQL
}

# Lo mismo, por la función de remapeo de la 0034, que es como mapea la app.
remapear() { # <organización> <ref>
    cat <<SQL
SET ROLE service_role;
DO \$\$
BEGIN
    PERFORM public.remap_integration_property('$1', 'search_console', '$2');
    RAISE NOTICE 'RESULTADO ok';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'RESULTADO %', SQLSTATE;
END
\$\$;
SQL
}

fallas=0
verdes=0
esperar() { # <caso> <esperado> <medido>
    if [[ "$2" == "$3" ]]; then
        echo "  ok    $1: $3"
        verdes=$((verdes + 1))
    else
        echo "  ROJO  $1: $3 (se esperaba $2)"
        fallas=$((fallas + 1))
    fi
}

echo "==> 1. dos onboardings concurrentes que se solapan"
{ echo "BEGIN;"; mapear "$ORG1" "sc-domain:concurrente34.test"; echo "SELECT pg_sleep(3); COMMIT;"; } \
    | $PSQL -v ON_ERROR_STOP=1 -qAt >/dev/null 2>&1 &
A=$!
sleep 1
B="$(mapear "$ORG2" "https://www.concurrente34.test/" | $PSQL -qAt 2>&1 | sed -n 's/.*RESULTADO //p')"
wait "$A"
VIVOS="$(sql -c "SELECT count(*) FROM public.integration_properties
                 WHERE provider = 'search_console' AND unmapped_at IS NULL
                   AND property_ref LIKE '%concurrente34.test%'")"
esperar "B, mientras A no confirmó" "23P01" "$B"
esperar "mapeos vivos sobre concurrente34.test" "1" "$VIVOS"

echo "==> 2. fuera de READ COMMITTED el trigger no decide"
RR="$({ echo "BEGIN ISOLATION LEVEL REPEATABLE READ;"; mapear "$ORG3" "https://aislado34.test/"; echo "ROLLBACK;"; } \
      | $PSQL -qAt 2>&1 | sed -n 's/.*RESULTADO //p')"
RC="$({ echo "BEGIN;"; mapear "$ORG3" "https://aislado34.test/"; echo "ROLLBACK;"; } \
      | $PSQL -qAt 2>&1 | sed -n 's/.*RESULTADO //p')"
esperar "REPEATABLE READ, sin solape" "45007" "$RR"
esperar "READ COMMITTED, el mismo INSERT (contraprueba)" "ok" "$RC"

echo "==> 3. un remapeo concurrente que se solapa no deja a nadie sin mapeo"
PREVIO="$(remapear "$ORG4" "https://previo-remapconc34.example/" | $PSQL -qAt 2>&1 | sed -n 's/.*RESULTADO //p')"
{ echo "BEGIN;"; remapear "$ORG5" "sc-domain:remapconc34.test"; echo "SELECT pg_sleep(3); COMMIT;"; } \
    | $PSQL -v ON_ERROR_STOP=1 -qAt >/dev/null 2>&1 &
A=$!
sleep 1
B="$(remapear "$ORG4" "https://www.remapconc34.test/" | $PSQL -qAt 2>&1 | sed -n 's/.*RESULTADO //p')"
wait "$A"
VIVO_B="$(sql -c "SELECT coalesce(string_agg(property_ref, ','), '-') FROM public.integration_properties
                  WHERE organization_id = '$ORG4' AND provider = 'search_console' AND unmapped_at IS NULL")"
esperar "el mapeo previo de B" "ok" "$PREVIO"
esperar "B se remapea mientras A no confirmó" "23P01" "$B"
esperar "B conserva su mapeo anterior" "https://previo-remapconc34.example/" "$VIVO_B"

echo "==> 4. la migración, con un onboarding solapado abierto"
$PSQL -v ON_ERROR_STOP=1 -q < "$VUELTA" >/dev/null
esperar "la 0034, revertida para medir" "sin aplicar, trigger -" "$(aplicada)"
VIGENTE="$(mapear "$ORG6" "https://www.toctou34.test/" | $PSQL -qAt 2>&1 | sed -n 's/.*RESULTADO //p')"
{ echo "BEGIN;"; mapear "$ORG7" "sc-domain:toctou34.test"; echo "SELECT pg_sleep(3); COMMIT;"; } \
    | $PSQL -v ON_ERROR_STOP=1 -qAt >/dev/null 2>&1 &
A=$!
sleep 1
SALIDA="$($PSQL -v ON_ERROR_STOP=1 -q < "$MIGRACION" 2>&1)" || true
wait "$A"
VIVOS="$(sql -c "SELECT count(*) FROM public.integration_properties
                 WHERE provider = 'search_console' AND unmapped_at IS NULL
                   AND property_ref LIKE '%toctou34.test%'")"
R4="$(aplicada)"
[[ "$R4" == sin* ]] && grep -q "se solapan" <<<"$SALIDA" && R4="rechazada: el par solapado"
esperar "el mapeo vivo de la organización 6" "ok" "$VIGENTE"
esperar "A confirmó su mapeo solapado mientras la migración esperaba" "2" "$VIVOS"
esperar "la 0034, aplicada en el medio" "rechazada: el par solapado" "$R4"
sql -c "UPDATE public.integration_properties SET unmapped_at = now()
        WHERE organization_id = '$ORG7' AND unmapped_at IS NULL" >/dev/null
reaplicar
esperar "la 0034, sin el par (contraprueba)" "aplicada, trigger A" "$(aplicada)"

echo "==> 5. la migración fuera de READ COMMITTED"
$PSQL -v ON_ERROR_STOP=1 -q < "$VUELTA" >/dev/null
SALIDA="$({ echo "SET default_transaction_isolation = 'repeatable read';"; cat "$MIGRACION"; } \
          | $PSQL -v ON_ERROR_STOP=1 -q 2>&1)" || true
R5="$(aplicada)"
[[ "$R5" == sin* ]] && grep -q "solo cuenta en READ COMMITTED" <<<"$SALIDA" && R5="rechazada: el aislamiento"
esperar "la 0034 en REPEATABLE READ" "rechazada: el aislamiento" "$R5"
reaplicar
esperar "la 0034 en READ COMMITTED (contraprueba)" "aplicada, trigger A" "$(aplicada)"
esperar "los EXECUTE de sus cuatro funciones, como estaban" "$PERMISOS_ANTES" "$(permisos)"

if [[ "$fallas" -gt 0 ]]; then
    echo "$fallas garantía(s) de la 0034 en rojo" >&2
    exit 1
fi
echo "las $verdes en verde"
