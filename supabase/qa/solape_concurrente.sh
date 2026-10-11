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
#
# Escribe filas de verdad (las dos sesiones tienen que confirmar para medir algo)
# en dos organizaciones propias, y las borra al salir, pase lo que pase.

set -euo pipefail

CONTAINER="${CONTAINER:-growthos-replica}"
PSQL="${PSQL:-docker exec -i $CONTAINER psql -U postgres -d growthos}"

sql() { $PSQL -v ON_ERROR_STOP=1 -qAt "$@"; }

U1="34990000-0034-4034-8034-000000000001"
U2="34990000-0034-4034-8034-000000000002"
U3="34990000-0034-4034-8034-000000000003"
U4="34990000-0034-4034-8034-000000000004"
U5="34990000-0034-4034-8034-000000000005"

limpiar() {
    sql -c "DELETE FROM public.organizations WHERE id IN (
                SELECT organization_id FROM public.org_members WHERE user_id IN ('$U1', '$U2', '$U3', '$U4', '$U5'));
            DELETE FROM auth.users WHERE id IN ('$U1', '$U2', '$U3', '$U4', '$U5');" >/dev/null 2>&1 || true
}
trap limpiar EXIT
limpiar

# Tres organizaciones, por el alta de verdad (`handle_new_user()`). La tercera
# es la del punto 2, para que su resultado no dependa del 1: si B entrara, ORG2
# ya tendría un mapeo vivo y el punto 2 mediría la unicidad de la 0017.
sql -c "INSERT INTO auth.users (id, email) VALUES ('$U1', 'conc34-1@example.test'),
        ('$U2', 'conc34-2@example.test'), ('$U3', 'conc34-3@example.test'),
        ('$U4', 'conc34-4@example.test'), ('$U5', 'conc34-5@example.test')" >/dev/null
ORG1="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U1'")"
ORG2="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U2'")"
ORG3="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U3'")"
ORG4="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U4'")"
ORG5="$(sql -c "SELECT organization_id FROM public.org_members WHERE user_id = '$U5'")"
[[ -n "$ORG1" && -n "$ORG2" && -n "$ORG3" && -n "$ORG4" && -n "$ORG5" \
   && "$ORG1" != "$ORG2" && "$ORG2" != "$ORG3" && "$ORG3" != "$ORG4" && "$ORG4" != "$ORG5" ]] \
    || { echo "no se crearon las cinco organizaciones" >&2; exit 1; }

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
esperar() { # <caso> <esperado> <medido>
    if [[ "$2" == "$3" ]]; then
        echo "  ok    $1: $3"
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

if [[ "$fallas" -gt 0 ]]; then
    echo "$fallas garantía(s) de la 0034 en rojo" >&2
    exit 1
fi
echo "las 7 en verde"
