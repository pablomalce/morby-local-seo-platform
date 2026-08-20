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

aplicadas="$(psql "$DATABASE_URL" -tAc \
    "SELECT version FROM public.schema_migrations ORDER BY version" 2>/dev/null || true)"

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
