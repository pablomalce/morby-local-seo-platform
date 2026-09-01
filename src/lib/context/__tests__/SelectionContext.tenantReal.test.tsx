// @vitest-environment jsdom
//
// El entorno se declara por archivo, igual que en `SelectionContext.test.tsx` y
// por el mismo motivo: un glob de configuración decide en silencio contra qué
// corre un archivo.

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un negocio real llegue de la base y el selector lo descarte.
 *
 * Es un archivo aparte y no un caso más del otro porque los dobles son
 * incompatibles: aquél monta el proveedor SIN sesión —que es el camino de la
 * selección guardada— y éste lo monta CON sesión y con tenants de la base.
 * `vi.mock` es por archivo, así que mezclarlos obligaría a un doble que cambia
 * de opinión según el test, y entonces ninguno de los dos mediría el camino que
 * dice medir.
 *
 * EL DEFECTO QUE LO MOTIVA, Y CÓMO SE VEÍA
 *
 * La organización «activa» salía siempre de `@/lib/mock/universal`, así que el
 * filtro comparaba el `organizationId` de negocios REALES contra el id de una
 * organización sembrada. No coinciden nunca: el desplegable quedaba vacío.
 *
 * Lo que lo vuelve caro de encontrar es que TODO lo demás anda. La petición
 * sale, la base contesta 200 y devuelve el negocio; los datos llegan al
 * navegador y la interfaz los tira. Medido en producción el 2026-09-01 contra
 * los logs de Supabase, después de descartar la sesión, la RLS, la membresía y
 * los privilegios uno por uno.
 */

import { JSDOM } from "jsdom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Un tenant de verdad: uuid, y NO uno de los `org-*` sembrados. */
const ORG_REAL = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const NEGOCIO_REAL = "7d703707-4f9d-43bf-9305-6bc22eddf45f";

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    loading: false,
    user: { id: "9720b91a-0b6e-4b3d-8c09-2f926733c270" },
    session: { access_token: "no-es-un-token-real" },
  }),
}));

vi.mock("@/lib/store/supabaseTenantStore", () => ({
  fetchMyBusinesses: vi.fn(async () => ({
    organizationId: ORG_REAL,
    businesses: [
      {
        id: NEGOCIO_REAL,
        organizationId: ORG_REAL,
        name: "Vulkan Studios",
        website: "https://vulkan-studios.com",
        industry: "other",
        brandTone: "",
        primaryLocale: "en",
        valueProposition: "",
        logoColor: "#EF4C24",
        createdAt: "2026-09-01T20:00:00.000Z",
      },
    ],
    locations: [],
    services: [],
  })),
  createTenantInDb: vi.fn(),
  deleteBusinessFromDb: vi.fn(),
}));

import { SelectionProvider, useSelection } from "@/lib/context/SelectionContext";

/** Lo que el desplegable ofrece, que es exactamente lo que se está midiendo. */
function Probe() {
  const { businessesForOrg } = useSelection();
  return (
    <span data-testid="opciones">
      {businessesForOrg.length === 0 ? "(vacío)" : businessesForOrg.map((b) => b.id).join(",")}
    </span>
  );
}

// Mismo motivo que en el otro archivo: bajo `@vitest-environment jsdom` esta
// runtime deja `window.localStorage` sin definir, y el proveedor lo toca.
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
});

afterEach(() => {
  cleanup();
});

describe("con sesión y tenants de la base", () => {
  it("ofrece el negocio real, y no lo filtra contra una organización sembrada", async () => {
    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>
    );

    // Se espera al valor y no a que el elemento exista: el proveedor arranca con
    // los datos de demostración y recién en un commit posterior llegan los de la
    // base. Afirmar sobre el primer render mediría el estado intermedio.
    await waitFor(() =>
      expect(screen.getByTestId("opciones").textContent).toBe(NEGOCIO_REAL)
    );
  });

  it("no ofrece los negocios sembrados cuando hay sesión", async () => {
    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>
    );

    // La otra mitad de la misma afirmación: con sesión, la lista es la de la base
    // y NADA de la demostración se cuela. Sin esto, un filtro que dejara pasar
    // todo pasaría el test de arriba.
    await waitFor(() => {
      const texto = screen.getByTestId("opciones").textContent ?? "";
      expect(texto).toBe(NEGOCIO_REAL);
      expect(texto).not.toContain("biz-");
    });
  });
});
