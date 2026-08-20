#!/usr/bin/env bash
#
# ¿La base hosted tiene lo que dice el repositorio?
#
#   DATABASE_URL='postgresql://...' ./supabase/qa/check_drift.sh
#
# Responde dos preguntas y falla si alguna sale mal:
#
#   1. ¿Hay migraciones en supabase/migrations/ que la base no tiene?
#   2. ¿El esquema de la base es el mismo que construyen esas migraciones,
#      objeto por objeto?
#
# POR QUÉ EXISTE
#
# Nada aplica las migraciones a la base hosted. El job de CI las aplica a un
# PostgreSQL descartable para poder correr las aserciones, y ahí termina; a
# `tpqiltnskfeycnybczgz` las aplica una persona.
#
# Eso ya costó dos veces. La 0006 estuvo mergeada y en verde mientras la base no
# la tenía, y en Lead Engine la migración que cierra la superficie de `anon`
# estuvo así durante semanas, con datos reales adentro. En los dos casos el CI
# decía que todo estaba bien, porque desde donde el CI miraba, todo estaba bien.
#
# Este script mira desde el otro lado. NO APLICA NADA: sólo lee. Aplicar sin que
# nadie mire es otra decisión y no es ésta.
#
# QUÉ NECESITA
#
# DATABASE_URL con permiso de lectura sobre la base. En CI viene de un secreto
# del repositorio; sin él el script avisa y no falla, porque romper cada corrida
# de main hasta que alguien configure un secreto es una manera segura de que el
# aviso deje de leerse.
#
# REPLICA_URL es opcional y por defecto apunta a la base que levanta
# supabase/qa/replica.sh. En CI apunta al servicio postgres del job.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS="$REPO_ROOT/supabase/migrations"
FINGERPRINT="$REPO_ROOT/supabase/qa/schema_fingerprint.sql"

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "==> DATABASE_URL no está definida."
    echo
    echo "    Sin ella no se puede mirar la base hosted, así que esta corrida no"
    echo "    comprueba nada. No falla a propósito: lo que falta es el secreto,"
    echo "    y hasta que exista, este aviso es el estado real."
    echo
    echo "    Para configurarlo:"
    echo "      gh secret set SUPABASE_DB_URL --repo <owner>/<repo>"
    echo
    exit 0
fi

# Nada de lo que se imprima acá puede venir del valor. La primera versión de
# este bloque mostraba sus primeros doce caracteres para que un error fuera
# reconocible, y funcionó demasiado bien: alguien guardó la contraseña sola en
# vez de la cadena entera, y esos doce caracteres eran doce caracteres de la
# contraseña, impresos en el log del workflow. GitHub tampoco los enmascara,
# porque enmascara el secreto completo y no un prefijo suyo.
#
# La longitud y la ausencia del prefijo alcanzan para diagnosticar, y no revelan
# nada.
#
# Que el valor sea una cadena de conexión, antes de intentar usarlo. psql acepta
# cualquier cosa como nombre de base y cae al socket local, así que un secreto
# mal copiado no se reporta como "el secreto está mal" sino como un error de
# socket que manda a buscar el problema donde no está. Medido en la primera
# corrida con secreto: los dos repos fallaron con
# `connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed`,
# que no dice nada sobre lo que había que arreglar.
if [[ ! "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
    echo "==> DATABASE_URL no parece una cadena de conexión."
    echo
    echo "    Tiene que empezar con postgresql:// o postgres://."
    echo "    Lo guardado mide ${#DATABASE_URL} caracteres y no tiene ese prefijo."
    echo
    echo "    En el dashboard de Supabase, Project Settings → Database →"
    echo "    Connection string, hay varias pestañas. La que sirve es URI."
    echo "    Las otras dan un comando de psql o una cadena de JDBC, que no"
    echo "    son esto. Y si la cadena todavía dice [YOUR-PASSWORD], hay que"
    echo "    reemplazarlo por la contraseña real de la base."
    exit 1
fi

REPLICA_URL="${REPLICA_URL:-postgresql://postgres:growthos@localhost:55433/growthos}"

fallos=0

# ─────────────────────────────────────────────────────────────────────────────
# 1 · Migraciones pendientes
# ─────────────────────────────────────────────────────────────────────────────
# Comparar los nombres de archivo contra las filas de schema_migrations es la
# pregunta directa, y sólo se puede hacer desde que existe esa tabla. Antes
# había que deducirlo de un diff de catálogos, que sirve para investigar y no
# para que un job decida.

echo "==> migraciones pendientes"

# Conectar primero, y como su propio paso. La versión anterior de esto mandaba
# la consulta con `2>/dev/null || true` y trataba cualquier respuesta vacía como
# "la base no tiene schema_migrations": medido en la primera corrida real, con
# el secreto ya puesto, eso convirtió un error de conexión en un diagnóstico
# equivocado sobre el esquema. Un mensaje de error tragado no es un mensaje.
if ! error_conexion="$(psql "$DATABASE_URL" -tAc "SELECT 1" 2>&1 >/dev/null)"; then
    echo "    no se pudo conectar a la base:"
    echo "$error_conexion" | sed 's/^/      /'
    echo
    echo
    # Desglose de la forma, nunca del contenido. Un fallo de autenticación no
    # dice cuál de las cuatro cosas está mal, y sin esto la única salida es
    # probar de nuevo a ciegas. Nada de lo que sigue revela la credencial:
    # longitudes, presencia o ausencia, y el host, que no es secreto.
    # Por el ÚLTIMO arroba, que es como separa libpq. Cortar por el primero
    # trunca la contraseña cuando tiene un arroba adentro — justo el caso que
    # este desglose tiene que detectar.
    sin_esquema="${DATABASE_URL#*://}"
    credenciales="${sin_esquema%@*}"
    servidor="${sin_esquema##*@}"
    usuario="${credenciales%%:*}"
    clave="${credenciales#*:}"
    arrobas="$(tr -cd '@' <<< "$sin_esquema" | wc -c | tr -d ' ')"

    echo "    Cómo está formada la cadena guardada:"
    echo "      usuario:     $usuario"
    echo "      servidor:    $servidor"
    echo "      contraseña:  ${#clave} caracteres"

    if [[ "$usuario" != *.* ]]; then
        echo
        echo "    El usuario no tiene el punto con el ref del proyecto. El"
        echo "    pooler lo necesita para saber a qué proyecto ir."
    fi
    if [[ "$arrobas" -gt 1 ]]; then
        echo
        echo "    La contraseña tiene un arroba sin percent-encodear (%40), que"
        echo "    parte la URI en el lugar equivocado."
    fi
    # `case` y no `=~`: la versión anterior de esta comprobación usaba una clase
    # de caracteres con barras invertidas adentro y NO DISPARABA NUNCA — probada
    # con /, :, # y %, las cuatro pasaban de largo. Una rama que promete
    # detectar algo y nunca lo detecta es peor que no tenerla, porque su
    # silencio se lee como "esto está bien".
    #
    # `%` queda fuera a propósito: una contraseña correctamente percent-encodeada
    # lo contiene, así que incluirlo convertiría el caso correcto en un aviso.
    case "$clave" in
        *[/:?\#\&\[\]]*)
            echo
            echo "    La contraseña tiene caracteres que hay que percent-encodear"
            echo "    (@ : / ? # & [ ]) o rompen la URI. Lo más simple es"
            echo "    resetearla a una sólo alfanumérica."
            ;;
    esac
    if [[ "$clave" == *"YOUR-PASSWORD"* ]]; then
        echo
        echo "    Quedó el marcador [YOUR-PASSWORD] sin reemplazar."
    fi
    if [[ "$clave" =~ [[:space:]] ]]; then
        echo
        echo "    La contraseña tiene un espacio o un salto de línea, que casi"
        echo "    siempre se cuela al copiar."
    fi

    echo
    echo "    Si la forma de arriba es correcta, entonces la contraseña no es"
    echo "    la de esa base: reseteala en Project Settings → Database →"
    echo "    Reset database password y volvé a guardar la cadena entera."
    exit 1
fi

aplicadas="$(psql "$DATABASE_URL" -tAc \
    "SELECT version FROM public.schema_migrations ORDER BY version")"

if [[ -z "$aplicadas" ]]; then
    echo "    la base no tiene schema_migrations, o está vacía."
    echo "    Si es la primera vez, aplicá las migraciones y volvé a correr esto."
    fallos=$((fallos + 1))
else
    en_el_repo="$(cd "$MIGRATIONS" && ls -1 ./*.sql | sed -e 's#^\./##' -e 's/\.sql$//' | sort)"
    pendientes="$(comm -23 <(echo "$en_el_repo") <(echo "$aplicadas" | sort) || true)"

    # También al revés: una versión en la base que el repositorio no tiene
    # significa que alguien aplicó algo sin versionar, o que un archivo se
    # renombró después de haberse aplicado.
    desconocidas="$(comm -13 <(echo "$en_el_repo") <(echo "$aplicadas" | sort) || true)"

    if [[ -n "$pendientes" ]]; then
        echo "    FALTAN en la base:"
        echo "$pendientes" | sed 's/^/      /'
        fallos=$((fallos + 1))
    fi
    if [[ -n "$desconocidas" ]]; then
        echo "    la base tiene versiones que el repositorio no:"
        echo "$desconocidas" | sed 's/^/      /'
        fallos=$((fallos + 1))
    fi
    if [[ -z "$pendientes" && -z "$desconocidas" ]]; then
        echo "    ninguna: $(echo "$aplicadas" | wc -l | tr -d ' ') aplicadas, las mismas que el repositorio"
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2 · Deriva del esquema
# ─────────────────────────────────────────────────────────────────────────────
# El registro dice qué se aplicó. La huella dice si el resultado es el mismo, y
# no es la misma pregunta: una migración puede haber corrido a medias, o alguien
# puede haber tocado la base por afuera. Los grants de Supabase llegaron así.

echo
echo "==> deriva del esquema"

hosted="$(mktemp)"; local_fp="$(mktemp)"
trap 'rm -f "$hosted" "$local_fp"' EXIT

psql "$DATABASE_URL" -tAf "$FINGERPRINT" | sed 's/[[:space:]]*$//' | sort > "$hosted"
psql "$REPLICA_URL"  -tAf "$FINGERPRINT" | sed 's/[[:space:]]*$//' | sort > "$local_fp"

if diff -q "$local_fp" "$hosted" >/dev/null; then
    echo "    ninguna: $(wc -l < "$local_fp" | tr -d ' ') objetos idénticos"
else
    echo "    el esquema de la base no es el que construyen las migraciones."
    echo "    '<' está sólo en el repositorio, '>' sólo en la base:"
    diff "$local_fp" "$hosted" | grep '^[<>]' | head -40 | sed 's/^/      /'
    total="$(diff "$local_fp" "$hosted" | grep -c '^[<>]' || true)"
    [[ "$total" -gt 40 ]] && echo "      ... y $((total - 40)) diferencias más"
    fallos=$((fallos + 1))
fi

echo
if [[ "$fallos" -gt 0 ]]; then
    echo "La base hosted no es lo que dice el repositorio."
    echo "Los cuatro pasos para aplicar están en el README, sección"
    echo "'Asking a database what it has'."
    exit 1
fi

echo "La base hosted es lo que dice el repositorio."
