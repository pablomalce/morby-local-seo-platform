// @vitest-environment jsdom
//
// Por archivo, por el mismo motivo que los otros dos: un glob de configuración
// decide en silencio contra qué corre un archivo.

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la ventana entre «hay sesión» y «llegaron los tenants de la base» se
 * anuncie como datos del usuario mientras muestra los sembrados.
 *
 * Es un archivo aparte de `SelectionContext.tenantReal.test.tsx` porque los
 * dobles son incompatibles: aquél resuelve `fetchMyBusinesses` y mide el estado
 * FINAL; éste lo deja COLGADO a propósito y mide el intermedio. `vi.mock` es por
 * archivo, así que un doble que cambie de opinión según el test no mediría
 * ninguno de los dos caminos.
 *
 * EL DEFECTO QUE LO MOTIVA
 *
 * `isUserCreatedBusiness: isAuthenticated ? true : isUserCreated(business.id)`.
 * Con sesión contestaba `true` sin mirar el negocio, y en esta ventana el
 * negocio es Mörby: `allBusinesses` son los sembrados hasta que `dbState` llega,
 * y `localStorage` puede traer una selección de la demostración de antes de
 * iniciar sesión.
 *
 * POR QUÉ EL `fetch` NO RESUELVE NUNCA
 *
 * Para que la ventana sea determinista. Con una promesa que resuelve, el commit
 * con los datos de la base puede ganarle a la afirmación y el test mediría el
 * estado final —el que ya mide el otro archivo— pasando por el motivo
 * equivocado.
 */

import { JSDOM } from "jsdom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    loading: false,
    user: { id: "9720b91a-0b6e-4b3d-8c09-2f926733c270" },
    session: { access_token: "no-es-un-token-real" },
  }),
}));

vi.mock("@/lib/store/supabaseTenantStore", () => ({
  // Colgada a propósito: `dbState` se queda en `null` durante todo el test.
  fetchMyBusinesses: vi.fn(() => new Promise(() => {})),
  createTenantInDb: vi.fn(),
  deleteBusinessFromDb: vi.fn(),
}));

import { SelectionProvider, useSelection } from "@/lib/context/SelectionContext";
import { marcaDeDatos } from "@/lib/demo/marcaDeDatos";

/** El negocio sembrado que se ve en la pantalla, escrito a mano. */
const MORBY = "biz-morby";

function Probe() {
  const { business, isUserCreatedBusiness } = useSelection();
  return (
    <span data-testid="estado">
      {business.id}|{String(isUserCreatedBusiness)}|{marcaDeDatos(business.id)}
    </span>
  );
}

beforeAll(() => {
  if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
    const dom = new JSDOM("", { url: "http://localhost:3000" });
    Object.defineProperty(window, "localStorage", {
      value: dom.window.localStorage,
      configurable: true,
    });
  }
});

beforeEach(() => {
  window.localStorage.clear();
  // La selección que dejó la demostración pública antes de iniciar sesión.
  window.localStorage.setItem(
    "lg.selection",
    JSON.stringify({ organizationId: "org-northgrowth", businessId: MORBY, serviceId: null, locationId: null })
  );
});

afterEach(() => {
  cleanup();
});

describe("con sesión, pero antes de que lleguen los tenants de la base", () => {
  it("lo que se ve es el negocio SEMBRADO, que es la mitad incómoda del caso", () => {
    // Sin esta afirmación, la de abajo pasaría sobre una pantalla vacía y no
    // mediría nada: la ventana existe porque el proveedor MUESTRA la demo.
    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>
    );

    return waitFor(() =>
      expect(screen.getByTestId("estado").textContent?.startsWith(`${MORBY}|`)).toBe(true)
    );
  });

  it("NO lo marca como del usuario, aunque haya sesión", async () => {
    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("estado").textContent).toBe(`${MORBY}|false|sembrado`)
    );
  });
});
