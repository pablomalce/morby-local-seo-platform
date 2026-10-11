// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la acción de baja vuelva con un motivo con nombre y la pantalla no lo
 * muestre: que lo cambie por un «Delete failed» genérico, o que se calle.
 * `deleteMyAccount` puede devolver un estado A MEDIAS —ya salió de las demás,
 * ya se borraron las propias— y la frase que lo dice es la única forma en que
 * la persona se entera.
 *
 * Y las dos maneras de que la acción NO devuelva nada:
 *
 *   * RECHAZA porque la red o el servidor fallaron. Antes salía de la
 *     transición como una excepción sin atajar —no hay `error.tsx` bajo
 *     `src/app`— y la pantalla no decía nada;
 *   * RECHAZA porque TERMINÓ. En Next 15.3.8 el `redirect` de una acción llega
 *     al cliente como un rechazo con el error de redirect
 *     (`server-action-reducer`), que el `RedirectBoundary` convierte en
 *     navegación. Un `catch` que lo atajara mostraría un error sobre una cuenta
 *     ya borrada y se quedaría en esta pantalla.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRASE_SIN_RESPUESTA } from "@/lib/auth/porQueNoSeBorro";

const accion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/account-actions", () => ({
  deleteMyAccount: accion,
  exportMyData: vi.fn(),
  signOutAction: vi.fn(),
}));

const { DeleteAccountButton, pedirLaBaja } = await import("../client");

/** El error que tira `redirect("/")`: el mismo que Next le entrega al cliente cuando la acción termina. */
function errorDeRedirect(): unknown {
  try {
    redirect("/");
  } catch (e) {
    return e;
  }
  throw new Error("redirect no lanzó");
}

// Con llaves a propósito: `mockReset()` devuelve el mock, y vitest toma una
// FUNCIÓN devuelta por `beforeEach` como su limpieza y la llama después del
// test. Sin llaves, cada test terminaba llamando a la acción una vez más.
beforeEach(() => {
  accion.mockReset();
});
afterEach(() => cleanup());

function confirmar() {
  render(<DeleteAccountButton />);
  fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));
  fireEvent.change(screen.getByPlaceholderText("DELETE"), { target: { value: "DELETE" } });
  fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
}

describe("la baja de cuenta en pantalla", () => {
  it("muestra la frase y el motivo que devolvió la acción, sin reemplazarlos", async () => {
    const frase =
      "Your account was not fully deleted: we could not delete your login. Already done: you were removed from 1 organization that is not only yours; 1 organization that was only yours was deleted with everything in it. Your login is still there. Try again: the deletion resumes where it stopped.";
    accion.mockResolvedValue({
      ok: false,
      motivo: "no-se-pudo-borrar-el-acceso",
      yaBorrado: { ajenas: 1, propias: 1 },
      message: frase,
    });
    confirmar();
    const aviso = await screen.findByRole("alert");
    expect(accion).toHaveBeenCalledTimes(1);
    expect(aviso.textContent).toBe(frase);
    expect(aviso.getAttribute("data-motivo")).toBe("no-se-pudo-borrar-el-acceso");
  });

  it("la acción RECHAZA (red, servidor): la pantalla lo dice con nombre, sin inventar qué se borró", async () => {
    accion.mockRejectedValue(new Error("fetch failed"));
    confirmar();
    const aviso = await screen.findByRole("alert");
    expect(aviso.getAttribute("data-motivo")).toBe("sin-respuesta");
    expect(aviso.textContent).toBe(FRASE_SIN_RESPUESTA);
    expect(aviso.textContent).not.toContain("fetch failed");
  });

  it("CONTROL: la acción resuelve sin respuesta: no inventa un error", async () => {
    accion.mockResolvedValue(undefined);
    confirmar();
    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("pedirLaBaja — lo que vuelve de la acción, a la pantalla", () => {
  it("la baja que TERMINÓ (rechazo con el error de redirect) no se ataja: vuelve a Next tal cual", async () => {
    const terminada = errorDeRedirect();
    // anti-vacuidad: es el error de Next, no uno cualquiera.
    expect(String((terminada as { digest?: unknown }).digest)).toMatch(/^NEXT_REDIRECT;/);
    await expect(pedirLaBaja(() => Promise.reject(terminada))).rejects.toBe(terminada);
  });

  it("un rechazo que no es de Next vuelve como «sin-respuesta»", async () => {
    await expect(pedirLaBaja(() => Promise.reject(new Error("fetch failed")))).resolves.toEqual({
      motivo: "sin-respuesta",
      message: FRASE_SIN_RESPUESTA,
    });
  });

  it("un fallo con motivo pasa con su motivo y su frase", async () => {
    const r = await pedirLaBaja(async () => ({
      ok: false,
      motivo: "firma-en-otra-organizacion",
      yaBorrado: { ajenas: 0, propias: 0 },
      message: "frase",
    }));
    expect(r).toEqual({ motivo: "firma-en-otra-organizacion", message: "frase" });
  });
});
