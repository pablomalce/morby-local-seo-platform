/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el motor determinista de reportes adquiera una dependencia de runtime.
 *
 * Hoy `engine.ts` importa SÓLO tipos: corre sin red, sin Supabase y sin las
 * APIs que facturan por request (Places y PageSpeed facturan; OpenAI también).
 * Esa pureza es la razón por la que se puede testear las ~25 reglas con
 * fixtures y sin gastar un centavo.
 *
 * Si alguien agrega `import { lookupPlace } from "@/lib/integrations/..."`
 * dentro del motor, tres cosas se rompen a la vez y ninguna avisa:
 *   1. generar un reporte pasa a costar dinero por request;
 *   2. el resultado deja de ser determinista — la misma entrada da distinta
 *      salida según lo que conteste la API;
 *   3. cualquier test del motor se vuelve una llamada viva.
 *
 * El lugar donde SÍ va la E/S es `orchestrator.ts`, que ya importa esos
 * clientes y es quien administra el caché de 24 h y el DataSourceHealth.
 *
 * Este test cae ANTES de que eso llegue a main.
 *
 * LA REGLA CAMBIÓ DE FORMA, NO DE FUERZA — 2026-08-28.
 *
 * Antes decía "cero imports de runtime", que es una forma sintáctica de decir
 * "cero dependencias". Se quedó corta en los dos sentidos. Corta de más: un mapa
 * de constantes sin dependencias propias no cuesta un centavo, no toca la red y
 * no mueve el determinismo, y prohibirlo empuja a copiar sus cinco cadenas
 * dentro del motor — que es EXACTAMENTE el defecto que este frente vino a
 * arreglar, tres copias del mismo mapa de nombres y la nota del reporte
 * escribiendo `searchConsole` en la cara del cliente. Y corta de menos: sólo
 * miraba `engine.ts`, así que un módulo local que a su vez importara Supabase
 * pasaba limpio.
 *
 * Ahora la regla es la que siempre se quiso: **el motor sólo puede importar en
 * runtime módulos locales que a su vez no importen nada en runtime.** Se sigue
 * la cadena, no la forma de la línea. Cualquier especificador de paquete —
 * `@/lib/integrations/...`, `@supabase/...`, `node:fs`— cae igual que antes, y
 * ahora también cae el intermediario que los esconda.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildReport } from "@/lib/reports/engine";

const ENGINE_PATH = fileURLToPath(new URL("../engine.ts", import.meta.url));
const source = readFileSync(ENGINE_PATH, "utf8");

/** Sentencias `import` en columna 0 — las declaraciones de módulo reales. */
const importStatements = source.match(/^import\b.*/gm) ?? [];

/** Las de runtime: `import type` no llega al bundle ni se evalúa. */
function runtimeImports(src: string): string[] {
  return (src.match(/^import\b.*/gm) ?? []).filter((line) => !/^import\s+type\b/.test(line));
}

/** El especificador entre comillas de una sentencia `import`. */
function specifierOf(line: string): string | null {
  return line.match(/from\s+["']([^"']+)["']/)?.[1] ?? null;
}

/**
 * Un import local (`./x`, `../x`) resuelto a un archivo que exista. Devuelve
 * `null` para cualquier especificador de paquete, que es lo que se prohíbe.
 */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // seguir probando
    }
  }
  return null;
}

/**
 * Recorre la cadena desde `engine.ts` y devuelve cada import de runtime que
 * rompe la regla, con el camino por el que llegó. Vacío = el motor es puro.
 */
function impureChain(entry: string, seen = new Set<string>(), trail: string[] = []): string[] {
  if (seen.has(entry)) return [];
  seen.add(entry);
  const src = readFileSync(entry, "utf8");
  const rota: string[] = [];
  for (const line of runtimeImports(src)) {
    const spec = specifierOf(line);
    const camino = [...trail, spec ?? line].join(" -> ");
    const local = spec ? resolveLocal(entry, spec) : null;
    if (!local) {
      rota.push(camino);
      continue;
    }
    rota.push(...impureChain(local, seen, [...trail, spec as string]));
  }
  return rota;
}

describe("engine.ts — pureza del motor determinista", () => {
  it("tiene imports que este test puede ver", () => {
    // Anti-vacuidad: si el regex deja de matchear, los dos tests de abajo
    // pasarían sobre una lista vacía y no impedirían nada. Un test que no
    // puede fallar es peor que ninguno, porque además tranquiliza.
    expect(importStatements.length).toBeGreaterThan(0);
  });

  it("no alcanza ninguna dependencia de runtime, ni directa ni por intermediario", () => {
    // Se sigue la cadena entera. Un import local está permitido sólo mientras él
    // mismo no importe nada en runtime; en cuanto la cadena llega a un paquete
    // —una integración, Supabase, `node:fs`— este test lo reporta con el camino
    // por el que llegó, que es el dato que hace falta para arreglarlo.
    expect(impureChain(ENGINE_PATH)).toEqual([]);
  });

  it("el rastreo de la cadena no es vacuo: ve los imports locales que hay", () => {
    // Anti-vacuidad, la misma preocupación que el test de arriba. Si
    // `resolveLocal` dejara de resolver, `impureChain` reportaría TODO como
    // roto y el test anterior fallaría ruidosamente; el riesgo inverso es que
    // `runtimeImports` deje de matchear y todo pase sobre una lista vacía.
    expect(runtimeImports(source).length).toBeGreaterThan(0);
    for (const line of runtimeImports(source)) {
      const spec = specifierOf(line);
      expect(spec, `no se pudo leer el especificador de: ${line}`).not.toBeNull();
      expect(resolveLocal(ENGINE_PATH, spec as string), `${spec} no resolvió`).not.toBeNull();
    }
  });

  it("no esquiva la regla con require() ni con import() dinámico", () => {
    const escapeHatches = source
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /\brequire\s*\(|\bimport\s*\(/.test(line))
      .map(({ line, n }) => `${n}: ${line}`);
    expect(escapeHatches).toEqual([]);
  });

  it("evalúa sin red ni credenciales y expone buildReport", () => {
    // Que este import de arriba no haya explotado ya es la mitad de la prueba:
    // el módulo se evalúa en un proceso Node pelado, sin env ni sesión.
    expect(typeof buildReport).toBe("function");
  });
});
