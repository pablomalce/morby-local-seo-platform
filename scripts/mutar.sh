#!/usr/bin/env bash
#
# mutar.sh — verificar un test rompiendo a propósito lo que dice medir.
#
# QUÉ IMPIDE ESTE ARCHIVO
#
# Que una mutación que NO probó nada se reporte igual que una que sí. Las tres
# formas de falso positivo ya pasaron en este proyecto, y las tres se ven como
# un rojo:
#
#   1. la mutación NO SE APLICÓ — el texto buscado no estaba en el archivo, y el
#      comando midió el código sin tocar. Se separa comprobando que el reemplazo
#      ocurrió, y cuántas veces, ANTES de correr nada;
#   2. la mutación ROMPIÓ LA CARGA — el archivo dejó de parsear o de importar, así
#      que la suite entera falló y ningún test llegó a evaluar nada. Se separa
#      comparando cuántos tests SE EJECUTARON contra la línea de base: un rojo
#      con menos tests corridos no es una aserción que falló;
#   3. la mutación CAYÓ POR UN BLOQUE VIEJO — algo se puso en rojo, y no fue el
#      test que se estaba verificando. Se separa nombrando QUÉ test cayó, y con
#      `--espera` diciéndolo explícitamente cuando el que cae vive en otro archivo.
#
# Un cuarto resultado, que es el único que hay que arreglar: SOBREVIVIÓ. El
# código cambió, la suite siguió verde, y entonces el test está mal — salvo que
# el mutante sea equivalente, y en ese caso hay que escribir POR QUÉ lo es al
# lado del código.
#
# USO
#
#   ./scripts/mutar.sh --linea-base
#   ./scripts/mutar.sh <archivo> <texto-buscado> <texto-nuevo> [--espera <archivo-de-test>]
#
# El reemplazo es LITERAL, no una expresión regular: lo que se escribe es lo que
# se busca.
#
# El archivo se restaura siempre, incluso si el comando se interrumpe.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASE_FILE=".mutacion-linea-base.json"
OUT_FILE="$(mktemp -t mutacion)"
trap 'rm -f "$OUT_FILE"' EXIT

correr_suite() {
    # La vía real: el mismo runner que `npm test`. Un script propio mediría otra
    # cosa. El reportero JSON es lo único que cambia, y sólo para poder leer
    # cuántos tests corrieron y cuáles cayeron sin adivinar sobre el texto.
    npx vitest run --reporter=json --outputFile="$OUT_FILE" >/dev/null 2>&1 || true
}

if [[ "${1:-}" == "--linea-base" ]]; then
    echo "==> línea de base, con el árbol sin tocar"
    correr_suite
    python3 - "$OUT_FILE" "$BASE_FILE" <<'PY'
import json, sys
datos = json.load(open(sys.argv[1]))
if datos.get("numFailedTests", 0) or not datos.get("success", False):
    sys.exit("la línea de base NO está en verde: medir mutaciones contra un rojo no dice nada")
base = {"tests": datos["numTotalTests"], "archivos": len(datos["testResults"])}
json.dump(base, open(sys.argv[2], "w"))
print(f"    {base['tests']} tests en {base['archivos']} archivos, todos en verde")
PY
    exit 0
fi

if [[ $# -lt 3 ]]; then
    sed -n '/^# USO/,/^# El archivo se restaura/p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
fi

ARCHIVO="$1"; BUSCAR="$2"; NUEVO="$3"; shift 3
ESPERA=""
if [[ "${1:-}" == "--espera" ]]; then ESPERA="${2:?--espera necesita un archivo}"; fi

[[ -f "$ARCHIVO" ]] || { echo "no existe: $ARCHIVO"; exit 2; }
[[ -f "$BASE_FILE" ]] || { echo "falta la línea de base: corré ./scripts/mutar.sh --linea-base"; exit 2; }

RESPALDO="$(mktemp -t mutar-respaldo)"
cp "$ARCHIVO" "$RESPALDO"
restaurar() { cp "$RESPALDO" "$ARCHIVO"; rm -f "$RESPALDO"; }
trap 'restaurar; rm -f "$OUT_FILE"' EXIT

# 1. ¿Se aplicó? Se comprueba ANTES de correr nada, que es lo único que separa
#    una mutación de un comando que midió el código intacto.
VECES=$(python3 - "$ARCHIVO" "$BUSCAR" "$NUEVO" <<'PY'
import sys
ruta, buscar, nuevo = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(ruta).read()
n = s.count(buscar)
if n:
    open(ruta, "w").write(s.replace(buscar, nuevo))
print(n)
PY
)

if [[ "$VECES" == "0" ]]; then
    echo "NO APLICADA  $ARCHIVO"
    echo "    el texto buscado no está en el archivo; no se corrió nada"
    exit 3
fi

echo "==> mutación aplicada ${VECES}x en $ARCHIVO"
correr_suite
restaurar
trap 'rm -f "$OUT_FILE"' EXIT

python3 - "$OUT_FILE" "$BASE_FILE" "$ESPERA" <<'PY'
import json, os, sys

salida, base_file, espera = sys.argv[1], sys.argv[2], sys.argv[3]
base = json.load(open(base_file))

if not os.path.exists(salida) or os.path.getsize(salida) == 0:
    print("NO CARGA")
    print("    el runner no llegó a producir un informe: la mutación rompió la carga,")
    print("    no una aserción. No cuenta como mutación caída.")
    sys.exit(4)

datos = json.load(open(salida))
corridos = datos.get("numTotalTests", 0)

# 2. ¿Corrió lo mismo que la línea de base? Menos tests EJECUTADOS quiere decir
#    que algún archivo no se pudo cargar. Un rojo así no es una aserción que
#    falló: es un archivo que no llegó a existir.
if corridos < base["tests"]:
    print("NO CARGA")
    print(f"    corrieron {corridos} tests contra {base['tests']} de la línea de base:")
    print("    la mutación rompió la carga de algún archivo, no una aserción.")
    sys.exit(4)

fallados = []
for archivo in datos["testResults"]:
    for a in archivo.get("assertionResults", []):
        if a.get("status") == "failed":
            fallados.append((archivo.get("name", "?"), a.get("fullName", "?")))

if not fallados:
    print("SOBREVIVIÓ")
    print(f"    {corridos} tests, todos en verde, con el código cambiado.")
    print("    El test está mal, no la mutación — salvo que el mutante sea equivalente,")
    print("    y entonces hay que escribir POR QUÉ al lado del código.")
    sys.exit(1)

# 3. ¿Cayó donde tenía que caer? Se nombra siempre, y con `--espera` se dice
#    explícitamente cuando el que cae vive en otro archivo.
print(f"CAYÓ  {len(fallados)} test(s), sobre {corridos} corridos")
raiz = os.getcwd() + os.sep
ajenos = []
for archivo, nombre in fallados:
    corto = archivo.replace(raiz, "")
    marca = ""
    if espera and os.path.abspath(archivo) != os.path.abspath(espera):
        marca = "  <-- OTRO ARCHIVO"
        ajenos.append(corto)
    print(f"    {corto}\n      {nombre}{marca}")

if espera and not any(os.path.abspath(a) == os.path.abspath(espera) for a, _ in fallados):
    print()
    print("    NINGUNO de los que cayeron está en el archivo esperado:")
    print(f"    {espera}")
    print("    Esto NO verifica ese test: cayó un bloque viejo.")
    sys.exit(5)
PY
