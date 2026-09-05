// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la selección se borre en el instante ANTERIOR a saber si hay sesión.
 *
 * EL DEFECTO, Y POR QUÉ SOBREVIVIÓ A UN ARREGLO
 *
 * `SelectionContext.seleccionRestaurada.test.tsx` ya cubría la ventana «hay
 * sesión y la base no contestó», y su arreglo se mergeó y se desplegó. Medido en
 * producción el 2026-09-05 DESPUÉS de ese despliegue: la selección se seguía
 * borrando, `lg.selection.businessId` en `""` con sólo navegar.
 *
 * Porque la ventana empieza antes. Al montar, el proveedor de auth todavía no
 * contestó: `loading` es `true` y `user` es `null`, así que `isAuthenticated` es
 * **false** y una guarda que sólo mira `isAuthenticated` no se aplica. El efecto
 * limpia, y el de persistencia escribe el vacío encima — todo antes de que
 * exista la sesión que la guarda esperaba ver.
 *
 * El test que no lo vio empezaba la historia después del momento que rompía: su
 * doble devolvía `{ loading: false, user }` desde el primer render. Éste arranca
 * donde arranca la aplicación de verdad, y por eso el doble CAMBIA de respuesta
 * a mitad de camino.
 */

import { JSDOM } from "jsdom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_REAL = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const NEGOCIO_REAL = "7d703707-4f9d-43bf-9305-6bc22eddf45f";

/** La sesión, tal como la ve el proveedor: primero no se sabe, después sí. */
const sesion = vi.hoisted(() => ({
  valor: { loading: true, user: null as { id: string } | null, session: null as unknown },
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => sesion.valor,
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
  window.localStorage.setItem(
    "lg.selection",
    JSON.stringify({
      organizationId: "org-northgrowth",
      businessId: NEGOCIO_REAL,
      serviceId: null,
      locationId: null,
    })
  );
  sesion.valor = { loading: true, user: null, session: null };
});

afterEach(() => {
  cleanup();
});

const guardado = () => JSON.parse(window.localStorage.getItem("lg.selection") ?? "{}").businessId;

describe("mientras el proveedor de auth todavía no contestó", () => {
  it("no borra la selección guardada", async () => {
    const { rerender } = render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>
    );

    // Ésta es la línea que estaba en rojo en producción y en verde en el test
    // anterior: acá `isAuthenticated` es false porque la sesión no se resolvió,
    // no porque no la haya.
    await waitFor(() => expect(guardado()).toBe(NEGOCIO_REAL));

    // Y cuando la sesión aparece y la base contesta, el negocio real se resuelve:
    // la guarda posterga la limpieza, no la cancela.
    await act(async () => {
      sesion.valor = {
        loading: false,
        user: { id: "9720b91a-0b6e-4b3d-8c09-2f926733c270" },
        session: { access_token: "no-es-un-token-real" },
      };
      rerender(
        <SelectionProvider>
          <Probe />
        </SelectionProvider>
      );
    });

    await waitFor(() => expect(screen.getByTestId("negocio").textContent).toBe(NEGOCIO_REAL));
    expect(guardado()).toBe(NEGOCIO_REAL);
  });

  it("y sin sesión, cuando ya se sabe que no la hay, limpia lo que no existe", async () => {
    // La mitad que impide que el arreglo sea «no limpiar nunca». Sin sesión
    // resuelta, un uuid que no está entre los sembrados tiene que irse.
    await act(async () => {
      sesion.valor = { loading: false, user: null, session: null };
    });

    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>
    );

    await waitFor(() => expect(guardado()).toBe(""));
  });
});
