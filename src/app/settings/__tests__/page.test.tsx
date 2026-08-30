/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que `platformStatus()` exista y la pantalla siga renderizando una constante.
 *
 * Es el defecto que este proyecto ya se comió tres veces, y la tercera fue
 * justamente esta pantalla. `platformStatus.test.ts` prueba la medición; lo que
 * no puede probar es que la pantalla la use.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import type { PlatformIntegrationStatus } from "@/lib/integrations/platformStatus";

/** Los nodos del árbol devuelto cuyo componente se llama `nombre`. */
function nodos(raiz: unknown, nombre: string): { props: Record<string, unknown> }[] {
  const encontrados: { props: Record<string, unknown> }[] = [];
  const visitar = (nodo: unknown): void => {
    if (Array.isArray(nodo)) return void nodo.forEach(visitar);
    if (!nodo || typeof nodo !== "object") return;
    const el = nodo as ReactElement & { props?: Record<string, unknown> };
    const tipo = el.type as unknown;
    if (typeof tipo === "function" && (tipo as { name?: string }).name === nombre) {
      encontrados.push({ props: (el.props ?? {}) as Record<string, unknown> });
    }
    if (el.props) Object.values(el.props).forEach(visitar);
  };
  visitar(raiz);
  return encontrados;
}

async function pantalla(): Promise<PlatformIntegrationStatus[]> {
  const mod = await import("@/app/settings/page");
  const vistas = nodos(mod.default(), "SettingsView");
  expect(vistas, "la pantalla no renderiza SettingsView").toHaveLength(1);
  return vistas[0].props.status as PlatformIntegrationStatus[];
}

const CLAVES = [
  "OPENAI_API_KEY",
  "OPENAI_IMAGE_MODEL",
  "GOOGLE_PLACES_API_KEY",
  "GOOGLE_PAGESPEED_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
  "RESEND_API_KEY",
  "SENTRY_DSN",
  "POSTHOG_KEY",
  "GROWTH_OS_WEBHOOK_SECRET",
];

function limpiar() {
  for (const k of CLAVES) delete process.env[k];
}

beforeEach(limpiar);
afterEach(limpiar);

describe("la pantalla mide, no afirma", () => {
  it("con el entorno vacío, todas salen sin configurar", async () => {
    const s = await pantalla();
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((i) => i.state === "not-configured")).toBe(true);
  });

  it("poner una variable CAMBIA lo que la pantalla recibe", async () => {
    // Ésta es la afirmación del cableado. Con la lista clavada de vuelta en su
    // lugar, todo lo demás de este archivo pasaría igual menos esto.
    process.env.RESEND_API_KEY = "re_no_es_real";
    const s = await pantalla();
    expect(s.find((i) => i.name === "Resend")!.state).toBe("ready");
  });

  it("las tres de Google llegan como `per-client`, no como `ready`", async () => {
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    const s = await pantalla();
    for (const n of ["Google Search Console", "Google Analytics GA4", "Google Business Profile"]) {
      expect(s.find((i) => i.name === n)!.state, n).toBe("per-client");
    }
  });

  it("no le pasa ningún valor de variable a la vista", async () => {
    // Lo que cruza al cliente termina en el HTML. Un secreto ahí es un secreto
    // en el historial del navegador de quien abrió la pantalla.
    process.env.RESEND_API_KEY = "re_un_secreto_muy_reconocible";
    const s = await pantalla();
    expect(JSON.stringify(s)).not.toContain("re_un_secreto_muy_reconocible");
  });
});
