// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el formulario se dibuje y no dé de alta nada, y que el caso a medias se
 * trague.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AltaDeCliente } from "../client";

const empujar = vi.hoisted(() => vi.fn());
const refrescar = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: empujar, refresh: refrescar }) }));

let llamadas: { url: string; body: Record<string, unknown> }[] = [];
let respuesta: { ok: boolean; status: number; cuerpo?: unknown } = { ok: true, status: 201 };

beforeEach(() => {
  llamadas = [];
  respuesta = { ok: true, status: 201 };
  empujar.mockClear();
  refrescar.mockClear();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    llamadas.push({ url, body: JSON.parse(String(init.body)) });
    return {
      ok: respuesta.ok,
      status: respuesta.status,
      json: async () => respuesta.cuerpo ?? {},
    } as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function completarYEnviar(nombre = "Cliente Ejemplo") {
  render(<AltaDeCliente />);
  fireEvent.change(screen.getByRole("textbox", { name: /nombre del cliente/i }), {
    target: { value: nombre },
  });
  fireEvent.click(screen.getByTestId("crear-cliente"));
}

describe("el alta de cliente", () => {
  it("llama a la ruta con el nombre", async () => {
    completarYEnviar();
    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].url).toBe("/api/organizations");
    expect(llamadas[0].body.name).toBe("Cliente Ejemplo");
  });

  it("NO manda un usuario ni una organización: eso lo decide el servidor", async () => {
    completarYEnviar();
    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].body).not.toHaveProperty("userId");
    expect(llamadas[0].body).not.toHaveProperty("organizationId");
  });

  it("al crear, lleva al tablero y refresca", async () => {
    completarYEnviar();
    await waitFor(() => expect(empujar).toHaveBeenCalledWith("/app/dashboard"));
    expect(refrescar).toHaveBeenCalled();
  });

  it("el caso a medias DICE que la organización existe, y no manda a rehacerla", async () => {
    // Es el estado incómodo: la organización se creó y su negocio no. Ocultarlo
    // haría que alguien la creara otra vez, con slug `cliente-1`.
    respuesta = {
      ok: false,
      status: 207,
      cuerpo: { ok: false, motivo: "organizacion-creada-sin-negocio", organizationId: "org-9" },
    };
    completarYEnviar();

    await waitFor(() => {
      const texto = screen.getByTestId("error-alta").textContent ?? "";
      expect(texto).toContain("org-9");
      expect(texto).toMatch(/no la vuelvas a crear/i);
    });
    expect(empujar).not.toHaveBeenCalled();
  });

  it("un fallo se muestra y no navega", async () => {
    respuesta = { ok: false, status: 502 };
    completarYEnviar();
    await waitFor(() => expect(screen.getByTestId("error-alta")).toBeTruthy());
    expect(empujar).not.toHaveBeenCalled();
  });
});
