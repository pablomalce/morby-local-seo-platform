// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que las frases estén bien y la pantalla siga imprimiendo la jerga.
 *
 * `porQueFalloElEnlace.test.ts` prueba las cuatro traducciones y seguiría entero
 * en verde con esta pantalla mostrando `decodeURIComponent(errorParam)` como
 * antes: no puede ver el cableado. Acá se afirma sobre lo que LEE una persona.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const parametros = vi.hoisted(() => ({ valor: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => parametros.valor,
}));

vi.mock("@/lib/auth/actions", () => ({
  signInWithEmail: vi.fn(async () => ({ ok: true, message: "no se usa acá" })),
}));

import LoginPage from "../page";

afterEach(() => {
  cleanup();
  parametros.valor = new URLSearchParams();
});

/** La pantalla como la deja el callback cuando el canje falló. */
function conError(crudo: string) {
  parametros.valor = new URLSearchParams({ error: crudo });
  render(<LoginPage />);
}

describe("lo que lee quien llega con un enlace que falló", () => {
  it("no le muestra la jerga de Supabase, le muestra qué hacer", () => {
    conError("code challenge does not match previously saved code verifier");

    const caja = screen.getByTestId("fallo-del-enlace");
    expect(caja.textContent).toMatch(/mismo navegador/i);
    // Lo que de verdad se está impidiendo: que esa frase llegue a la pantalla.
    expect(caja.textContent).not.toContain("code verifier");
    expect(screen.queryByTestId("fallo-crudo")).toBeNull();
  });

  it("un fallo que el traductor no conoce se muestra igual, sin taparlo", () => {
    conError("database is on fire");

    expect(screen.getByTestId("fallo-crudo").textContent).toBe("database is on fire");
  });

  it("sin `error` en la URL no dibuja ninguna caja de fallo", () => {
    render(<LoginPage />);
    expect(screen.queryByTestId("fallo-del-enlace")).toBeNull();
  });
});
