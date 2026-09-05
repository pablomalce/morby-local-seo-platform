// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el próximo paso esté bien calculado y la pantalla no lo muestre.
 *
 * `proximoPaso.test.ts` prueba las seis decisiones y seguiría verde con este
 * componente dibujando un texto fijo.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductoResumen } from "../client";
import type { EstadoDelProducto } from "@/lib/product/proximoPaso";

afterEach(() => cleanup());

const COMPLETA: EstadoDelProducto = {
  negocios: 1,
  mapeos: 3,
  fuentesFallando: 0,
  reportes: 2,
  contenidoAprobado: 1,
  publicaciones: 0,
};

describe("el resumen del producto", () => {
  it("muestra el próximo paso Y a dónde lleva", () => {
    render(
      <ProductoResumen
        organizacion="Vulkan Studios"
        negocios={[]}
        estado={{ ...COMPLETA, negocios: 0 }}
      />
    );
    expect(screen.getByTestId("proximo-paso").dataset.donde).toBe("/onboarding/new-business");
  });

  it("cambia de paso cuando cambia el estado, y no dibuja uno fijo", () => {
    const { rerender } = render(
      <ProductoResumen organizacion="V" negocios={[]} estado={{ ...COMPLETA, negocios: 0 }} />
    );
    const primero = screen.getByTestId("proximo-paso").dataset.donde;

    rerender(<ProductoResumen organizacion="V" negocios={[]} estado={{ ...COMPLETA, mapeos: 0 }} />);
    expect(screen.getByTestId("proximo-paso").dataset.donde).not.toBe(primero);
  });

  it("cuando no falta nada lo dice, y no inventa un paso", () => {
    render(<ProductoResumen organizacion="V" negocios={[]} estado={COMPLETA} />);
    expect(screen.queryByTestId("proximo-paso")).toBeNull();
    expect(screen.getByTestId("nada-pendiente")).toBeTruthy();
  });

  it("una organización sin negocios lo dice en vez de dibujar una lista vacía", () => {
    render(<ProductoResumen organizacion="V" negocios={[]} estado={COMPLETA} />);
    expect(screen.getByTestId("sin-negocios")).toBeTruthy();
  });

  it("dibuja los negocios reales con sus cuentas", () => {
    render(
      <ProductoResumen
        organizacion="Vulkan Studios"
        negocios={[{ id: "b1", nombre: "Vulkan Studios", ubicaciones: 2, servicios: 3 }]}
        estado={COMPLETA}
      />
    );
    const fila = screen.getByTestId("negocio");
    expect(fila.textContent).toContain("Vulkan Studios");
    expect(fila.textContent).toContain("2 loc");
    expect(fila.textContent).toContain("3 svc");
  });

  it("avisa cuando hay fuentes fallando", () => {
    render(
      <ProductoResumen organizacion="V" negocios={[]} estado={{ ...COMPLETA, fuentesFallando: 2 }} />
    );
    expect(screen.getByTestId("fuentes-fallando").textContent).toContain("2 FAILING");
  });
});
