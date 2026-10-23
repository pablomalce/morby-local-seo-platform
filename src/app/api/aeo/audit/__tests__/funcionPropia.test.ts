/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la ruta de auditoría AEO —la única que lleva Chromium, ~70 MB— vuelva a
 * compartir función de Vercel con otras rutas (RV-3).
 *
 * El builder de Vercel junta en una sola función las rutas con la misma
 * configuración. MEDIDO con `vercel inspect` sobre la preview del PR #119: con
 * `maxDuration = 60`, esta ruta y `geo/grid`, `profile/evidence-check` y
 * `reports/generate` (las tres con 60) salían con el mismo `functionName`, de
 * 72,8 MB, y esas tres habían pesado 2,0 MB en producción. El agrupamiento lo
 * hace Vercel y no se puede correr acá; lo que SÍ se puede fijar acá es su
 * condición: que ninguna otra ruta declare el mismo `maxDuration`, ni sea el
 * que toma una ruta que no declara ninguno (300 con Fluid compute).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.join(process.cwd(), "src", "app");
const AEO = "api/aeo/audit/route.ts";
/** El `maxDuration` de una función que no declara ninguno, con Fluid compute. */
const POR_DEFECTO = 300;

function rutas(directorio: string): string[] {
  return readdirSync(directorio).flatMap((entrada) => {
    const completo = path.join(directorio, entrada);
    if (statSync(completo).isDirectory()) return entrada === "__tests__" ? [] : rutas(completo);
    return /^route\.(ts|tsx|js|jsx)$/.test(entrada) ? [completo] : [];
  });
}

function maxDuration(archivo: string): number | null {
  const m = readFileSync(archivo, "utf8").match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

describe("RV-3: la ruta con Chromium es una función de Vercel propia", () => {
  const todas = rutas(APP).map((a) => ({ ruta: path.relative(APP, a).replace(/\\/g, "/"), maxDuration: maxDuration(a) }));
  const aeo = todas.find((r) => r.ruta === AEO);

  it("el barrido ve las rutas que agrupaba Vercel, y la de la auditoría", () => {
    // Anti-vacuidad: un barrido que no encuentra nada pasa cualquier afirmación.
    expect(aeo).toBeDefined();
    for (const r of ["api/geo/grid/route.ts", "api/profile/evidence-check/route.ts", "api/reports/generate/route.ts"]) {
      expect(todas.map((x) => x.ruta)).toContain(r);
    }
  });

  it("declara un maxDuration que no tiene ninguna otra ruta, ni el de una ruta sin declarar", () => {
    expect(aeo?.maxDuration, "sin maxDuration propio, cae con todas las que no declaran").not.toBeNull();
    expect(aeo?.maxDuration).not.toBe(POR_DEFECTO);
    const iguales = todas.filter((r) => r.ruta !== AEO && r.maxDuration === aeo?.maxDuration).map((r) => r.ruta);
    expect(iguales, "estas rutas caerían en la misma función que Chromium").toEqual([]);
  });
});
