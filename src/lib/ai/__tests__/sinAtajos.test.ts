/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que alguien llame a un modelo sin pasar por `egress.ts`.
 *
 * `egress.ts` garantiza la contabilidad de lo que pasa POR ÉL. Lo que no puede
 * garantizar es que sea la única puerta — eso no es una propiedad del módulo,
 * es una propiedad del árbol de archivos, y sólo un test que mire el árbol la
 * puede sostener.
 *
 * Sin esto, R5 queda cumplido en apariencia: un módulo de egreso perfecto y un
 * `fetch` a `api.openai.com` en cualquier ruta nueva, que gasta y no anota. Es la
 * misma forma del defecto que este proyecto ya se comió — un módulo con treinta y
 * un tests al que nadie llamaba — sólo que al revés: acá el módulo está bien y lo
 * que falla es que se lo puede saltear.
 *
 * ES ESTÁTICO, Y TIENE QUE SERLO. El fallo que previene ocurre en un archivo que
 * todavía no existe, así que no hay nada que ejecutar: se lee el árbol.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");
/** El único lugar donde se puede hablar con un proveedor de IA. */
const PUERTA = path.join(SRC, "lib", "ai");

/**
 * Las señales de que un archivo habla con una API de modelos.
 *
 * Son los HOSTS y los paquetes, no las palabras. `"openai"` a secas aparece en
 * `platformStatus.ts` como nombre de una integración y en este mismo archivo como
 * texto; lo que delata una llamada es el endpoint o el import del SDK.
 */
const SENALES: readonly { patron: RegExp; que: string }[] = [
  { patron: /api\.openai\.com/, que: "el endpoint de OpenAI" },
  { patron: /api\.anthropic\.com/, que: "el endpoint de Anthropic" },
  { patron: /generativelanguage\.googleapis\.com/, que: "el endpoint de Gemini" },
  { patron: /from\s+["']openai["']/, que: "el SDK de OpenAI" },
  { patron: /from\s+["']@anthropic-ai\//, que: "el SDK de Anthropic" },
  { patron: /from\s+["']@google\/generative-ai["']/, que: "el SDK de Gemini" },
];

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("la puerta de egreso es la única", () => {
  it("ningún archivo fuera de src/lib/ai habla con una API de modelos", () => {
    const culpables: string[] = [];

    for (const f of archivos(SRC)) {
      if (f.startsWith(PUERTA + path.sep)) continue;
      const texto = readFileSync(f, "utf8");
      for (const s of SENALES) {
        if (s.patron.test(texto)) {
          culpables.push(`${path.relative(process.cwd(), f)} — ${s.que}`);
        }
      }
    }

    expect(
      culpables,
      "estos archivos llaman a un modelo sin pasar por src/lib/ai/egress.ts, " +
        "así que gastan sin quedar registrados en agent_runs:\n  " +
        culpables.join("\n  ")
    ).toEqual([]);
  });

  it("y el test sabe reconocer una señal cuando la ve", () => {
    // Anti-vacuidad. Sin esto, un patrón mal escrito —o una lista vacía— haría
    // que el bloque de arriba pasara para siempre sin mirar nada, que es
    // exactamente la clase de verde que este proyecto persigue.
    const falso = 'const r = await fetch("https://api.openai.com/v1/responses");';
    expect(SENALES.some((s) => s.patron.test(falso))).toBe(true);
    expect(SENALES.length).toBeGreaterThanOrEqual(6);
  });

  it("recorre archivos de verdad, y bastantes", () => {
    // La otra mitad de la anti-vacuidad: si `archivos()` devolviera una lista
    // vacía —una ruta mal armada, por ejemplo— el bloque principal pasaría sin
    // haber leído nada.
    const todos = archivos(SRC);
    expect(todos.length).toBeGreaterThan(50);
    expect(todos.some((f) => f.endsWith("egress.ts"))).toBe(true);
  });
});
