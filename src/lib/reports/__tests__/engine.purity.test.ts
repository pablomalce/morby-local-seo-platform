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
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildReport } from "@/lib/reports/engine";

const ENGINE_PATH = fileURLToPath(new URL("../engine.ts", import.meta.url));
const source = readFileSync(ENGINE_PATH, "utf8");

/** Sentencias `import` en columna 0 — las declaraciones de módulo reales. */
const importStatements = source.match(/^import\b.*/gm) ?? [];

describe("engine.ts — pureza del motor determinista", () => {
  it("tiene imports que este test puede ver", () => {
    // Anti-vacuidad: si el regex deja de matchear, los dos tests de abajo
    // pasarían sobre una lista vacía y no impedirían nada. Un test que no
    // puede fallar es peor que ninguno, porque además tranquiliza.
    expect(importStatements.length).toBeGreaterThan(0);
  });

  it("no importa nada en runtime — sólo tipos", () => {
    const runtime = importStatements.filter(
      (line) => !/^import\s+type\b/.test(line),
    );
    expect(runtime).toEqual([]);
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
