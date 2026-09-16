// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que los avisos estén bien calculados y la pantalla no los muestre, y que el
 * panel se abra solo con cinco advertencias sobre cosas que todavía no pasan.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AvisosDeEscala } from "../AvisosDeEscala";
import { CLIENTES_PARA_BUSCADOR } from "@/lib/limites/avisos";

afterEach(() => cleanup());

describe("el panel de límites", () => {
  it("nace PLEGADO: un panel abierto con advertencias que no aplican enseña a ignorarlo", () => {
    render(<AvisosDeEscala clientes={1} />);
    expect(screen.queryByTestId("detalle-avisos")).toBeNull();
  });

  it("con un cliente dice que ningún límite aplica todavía", () => {
    render(<AvisosDeEscala clientes={1} />);
    expect(screen.getByTestId("resumen-avisos").textContent).toMatch(/ningún límite aplica/i);
  });

  it("con varios cuenta cuántos YA aplican, y no cuántos hay en total", () => {
    // La foto fechada de los planes no es un límite que aplique: contarla infla
    // el resumen y lo vuelve ruido.
    render(<AvisosDeEscala clientes={3} />);
    const texto = screen.getByTestId("resumen-avisos").textContent ?? "";
    expect(texto).toContain("3 clientes");
    expect(texto).toMatch(/2 límites ya aplican/);
  });

  it("se abre al pedirlo, y muestra cada aviso con dónde se resuelve", () => {
    render(<AvisosDeEscala clientes={CLIENTES_PARA_BUSCADOR} />);
    fireEvent.click(screen.getByTestId("abrir-avisos"));

    const avisos = screen.getAllByTestId("aviso");
    expect(avisos.length).toBeGreaterThan(3);
    for (const a of avisos) expect(a.textContent).toMatch(/se resuelve en:/);
  });

  it("y se vuelve a cerrar", () => {
    render(<AvisosDeEscala clientes={2} />);
    fireEvent.click(screen.getByTestId("abrir-avisos"));
    expect(screen.getByTestId("detalle-avisos")).toBeTruthy();
    fireEvent.click(screen.getByTestId("abrir-avisos"));
    expect(screen.queryByTestId("detalle-avisos")).toBeNull();
  });

  it("la foto de los planes se muestra como FOTO, no como estado vivo", () => {
    render(<AvisosDeEscala clientes={1} />);
    fireEvent.click(screen.getByTestId("abrir-avisos"));
    const fechado = screen.getAllByTestId("aviso").find((a) => a.dataset.clase === "fechado");
    expect(fechado?.textContent).toContain("FOTO");
    expect(fechado?.textContent).toMatch(/no el estado de hoy/i);
  });
});
