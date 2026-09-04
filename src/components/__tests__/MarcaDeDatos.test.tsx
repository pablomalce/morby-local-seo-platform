// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la marca esté enganchada donde corresponde y DIGA lo que no es.
 *
 * `marcaEnLaCascara.test.ts` sostiene el cableado —que la marca cuelgue de la
 * cáscara y que la decida el dato— pero no mira el texto: con esa pared sola,
 * cambiar `TEXTO` para que los tres estados dijeran «LIVE DATA» seguiría verde.
 * Esto mira lo que lee la persona.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const seleccion = vi.hoisted(() => ({ businessId: "" }));

vi.mock("@/lib/context/SelectionContext", () => ({
  useSelection: () => ({ business: { id: seleccion.businessId } }),
}));

import { MarcaDeDatos } from "@/components/MarcaDeDatos";

afterEach(() => {
  cleanup();
});

function marcaVisible() {
  const el = screen.getByTestId("marca-de-datos");
  return { texto: el.textContent?.trim(), marca: el.getAttribute("data-marca") };
}

describe("lo que la marca le dice a la persona", () => {
  it("sobre el negocio sembrado dice que son datos de demostración", () => {
    seleccion.businessId = "biz-morby";
    render(<MarcaDeDatos />);
    expect(marcaVisible()).toEqual({ texto: "DEMO DATA", marca: "sembrado" });
  });

  it("sobre un negocio de la base dice que son datos reales", () => {
    seleccion.businessId = "7d703707-4f9d-43bf-9305-6bc22eddf45f";
    render(<MarcaDeDatos />);
    expect(marcaVisible()).toEqual({ texto: "LIVE DATA", marca: "real" });
  });

  it("sin selección no dice ninguna de las dos cosas", () => {
    seleccion.businessId = "";
    render(<MarcaDeDatos />);
    expect(marcaVisible()).toEqual({ texto: "NO BUSINESS", marca: "sin-negocio" });
  });

  it("los tres estados no dicen lo mismo", () => {
    // Sin esto, un `TEXTO` con el mismo valor tres veces pasaría los tres casos
    // de arriba si alguien los actualizara juntos, y la marca dejaría de marcar.
    const textos = new Set<string>();
    for (const id of ["biz-morby", "7d703707-4f9d-43bf-9305-6bc22eddf45f", ""]) {
      seleccion.businessId = id;
      const { unmount } = render(<MarcaDeDatos />);
      textos.add(marcaVisible().texto ?? "");
      unmount();
    }
    expect(textos.size).toBe(3);
  });
});
