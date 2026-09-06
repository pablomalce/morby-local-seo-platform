// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el selector se dibuje y no cambie nada.
 *
 * Es el defecto que este proyecto ya se comió cinco veces —un módulo que nadie
 * llama— así que acá se afirma sobre la LLAMADA: a dónde va, con qué cuerpo, y
 * qué hace cuando falla.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectorDeOrganizacion } from "../SelectorDeOrganizacion";

const refrescar = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

const AGENCIA = { id: "df6743a9-6f98-400e-8efb-fdcc37b3cb45", name: "Vulkan Studios" };
const CLIENTE = { id: "2c655774-c624-49cb-ba61-87c582f56881", name: "Cliente Uno" };

let llamadas: { url: string; body: unknown }[] = [];
let respuesta = { ok: true, status: 200 };

beforeEach(() => {
  llamadas = [];
  respuesta = { ok: true, status: 200 };
  refrescar.mockClear();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    llamadas.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: respuesta.ok, status: respuesta.status, json: async () => ({}) } as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("el selector de organización", () => {
  it("con una sola organización no se dibuja", () => {
    // Un selector de un elemento sugiere una elección que no existe.
    render(<SelectorDeOrganizacion actual={AGENCIA.id} disponibles={[AGENCIA]} />);
    expect(screen.queryByTestId("selector-organizacion")).toBeNull();
  });

  it("con dos, marca cuál está activa", () => {
    render(<SelectorDeOrganizacion actual={AGENCIA.id} disponibles={[AGENCIA, CLIENTE]} />);
    const activas = screen
      .getAllByTestId("opcion-organizacion")
      .map((e) => e.dataset.activa);
    expect(activas).toEqual(["si", "no"]);
  });

  it("al elegir otra, la guarda y refresca", async () => {
    render(<SelectorDeOrganizacion actual={AGENCIA.id} disponibles={[AGENCIA, CLIENTE]} />);
    fireEvent.click(screen.getByText("Cliente Uno"));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].url).toBe("/api/organizations/active");
    expect(llamadas[0].body).toEqual({ organizationId: CLIENTE.id });
    await waitFor(() => expect(refrescar).toHaveBeenCalled());
  });

  it("elegir la que ya está activa no llama a nada", async () => {
    render(<SelectorDeOrganizacion actual={AGENCIA.id} disponibles={[AGENCIA, CLIENTE]} />);
    fireEvent.click(screen.getByText("Vulkan Studios"));
    await new Promise((r) => setTimeout(r, 20));
    expect(llamadas).toHaveLength(0);
  });

  it("un fallo se MUESTRA y no refresca", async () => {
    respuesta = { ok: false, status: 409 };
    render(<SelectorDeOrganizacion actual={AGENCIA.id} disponibles={[AGENCIA, CLIENTE]} />);
    fireEvent.click(screen.getByText("Cliente Uno"));

    await waitFor(() => expect(screen.getByTestId("error-cambio")).toBeTruthy());
    expect(refrescar).not.toHaveBeenCalled();
  });
});
