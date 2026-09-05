// @vitest-environment jsdom
//
// Por archivo, igual que los otros tres del proveedor: `vi.mock` no cambia de
// opinión según el test.

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la selección de un negocio REAL se borre sola al cambiar de página.
 *
 * EL DEFECTO, MEDIDO EN PRODUCCIÓN EL 2026-09-05
 *
 * Se elige Vulkan Studios en `/app/integrations`, se navega a `/reports`, y el
 * encabezado vuelve a decir «Selecciona un negocio». No es que se pierda la
 * memoria: `localStorage` pasó de `businessId: "7d703707-…"` a `businessId: ""`.
 * La selección se BORRA y el vacío se persiste encima.
 *
 * Con sesión y antes de que conteste la base, `allBusinesses` son los
 * SEMBRADOS. El uuid restaurado no está entre ellos, así que el efecto que
 * limpia selecciones muertas lo leía como «este negocio ya no existe».
 *
 * Y el orden de los efectos no protegía nada: los dos `setState` caen en el
 * mismo lote y el actualizador del efecto de limpieza recibe el estado YA
 * restaurado.
 *
 * POR QUÉ EL DOBLE SÍ RESUELVE ACÁ
 *
 * Al revés que `marcaAntesDeLaBase.test.tsx`, que cuelga el `fetch` para medir
 * la ventana. Acá lo que hay que probar es lo que queda DESPUÉS: que la
 * selección haya sobrevivido a la ventana y el negocio real se resuelva cuando
 * los tenants llegan. Colgar el `fetch` mediría el estado intermedio, donde el
 * negocio todavía no puede resolverse ni con el arreglo puesto.
 */

import { JSDOM } from "jsdom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

function Probe() {
  const { business } = useSelection();
  return <span data-testid="negocio">{business.id === "" ? "(sin negocio)" : business.id}</span>;
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
});

afterEach(() => {
  cleanup();
});

/** Lo que deja en el disco haber elegido el negocio antes de navegar. */
function selecciónGuardada(businessId: string) {
  window.localStorage.setItem(
    "lg.selection",
    JSON.stringify({ organizationId: "org-northgrowth", businessId, serviceId: null, locationId: null })
  );
}

describe("la selección guardada de un negocio real", () => {
  it("sobrevive a la ventana en la que sólo hay datos sembrados", async () => {
    selecciónGuardada(NEGOCIO_REAL);

    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>
    );

    await waitFor(() => expect(screen.getByTestId("negocio").textContent).toBe(NEGOCIO_REAL));

    // La otra mitad, y es la que mide el defecto: el vacío no puede haberse
    // escrito NUNCA. Sin esto, un arreglo que limpiara y volviera a poner el
    // negocio pasaría el `waitFor` de arriba y en la aplicación real dejaría el
    // disco en `""`, que es lo que se midió en producción.
    const guardado = JSON.parse(window.localStorage.getItem("lg.selection") ?? "{}");
    expect(guardado.businessId).toBe(NEGOCIO_REAL);
  });

  it("sí se limpia cuando la base contesta y el negocio de verdad no está", async () => {
    // La mitad que impide que el arreglo sea «no limpiar nunca». Un negocio
    // borrado tiene que dejar de estar seleccionado.
    selecciónGuardada("00000000-0000-4000-8000-000000000000");

    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>
    );

    // Se afirma sobre lo que quedó GUARDADO, y no sólo sobre lo que se ve.
    //
    // Mirar la pantalla no medía nada: un uuid que no está en la lista no
    // resuelve a ningún negocio, así que el marcador de posición aparece igual
    // con la limpieza puesta que sin ella. La mutación «no limpiar nunca»
    // SOBREVIVIÓ a la versión anterior de este test por eso exacto. Lo único
    // que distingue las dos es el estado que se persiste.
    await waitFor(() => {
      const guardado = JSON.parse(window.localStorage.getItem("lg.selection") ?? "{}");
      expect(guardado.businessId).toBe("");
    });
    expect(screen.getByTestId("negocio").textContent).toBe("(sin negocio)");
  });
});
