// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la acción de baja vuelva con un motivo con nombre y la pantalla no lo
 * muestre: que lo cambie por un «Delete failed» genérico, o que se calle.
 * `deleteMyAccount` puede devolver un estado A MEDIAS —ya salió de las ajenas,
 * ya se borraron las propias— y la frase que lo dice es la única forma en que
 * la persona se entera.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/account-actions", () => ({
  deleteMyAccount: accion,
  exportMyData: vi.fn(),
  signOutAction: vi.fn(),
}));

const { DeleteAccountButton } = await import("../client");

beforeEach(() => accion.mockReset());
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
      "Your account was not fully deleted: we could not delete your login. Already done: you were removed from 1 organization you do not own; 1 organization you owned was deleted with everything in it. Your login is still there. Try again: the deletion resumes where it stopped.";
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

  it("CONTROL: sin respuesta (la acción redirigió) no inventa un error", async () => {
    accion.mockResolvedValue(undefined);
    confirmar();
    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
