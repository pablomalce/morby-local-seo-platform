// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que las lecturas estén bien y la pantalla las tire.
 *
 * `ledgerView.test.ts` prueba las cinco lecturas y seguiría verde con este
 * componente mostrando `status` crudo: no puede ver el cableado.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Ledger } from "../client";
import type { FilaLedger } from "@/lib/publishing/ledgerView";

afterEach(() => cleanup());

function fila(parcial: Partial<FilaLedger> = {}): FilaLedger {
  return {
    id: "pub-1",
    assetId: "7d703707-4f9d-43bf-9305-6bc22eddf45f",
    destination: "google_business_profile",
    status: "pending",
    externalId: null,
    attempts: 0,
    createdAt: "2026-09-05T12:00:00.000Z",
    publishedAt: null,
    ...parcial,
  };
}

describe("el ledger dibujado", () => {
  it("sin filas dice qué falta, y no sólo que está vacío", () => {
    // Un ledger vacío acá significa algo concreto: no hay contenido APROBADO
    // sobre el que ensayar. Decir «todavía nada» deja a alguien esperando.
    render(<Ledger filas={[]} />);
    expect(screen.getByTestId("ledger-vacio").textContent).toMatch(/aprobado/i);
    expect(screen.queryByTestId("ledger-fila")).toBeNull();
  });

  it("distingue la reserva del intento perdido, que es lo que la columna cruda funde", () => {
    render(<Ledger filas={[fila({ id: "a" }), fila({ id: "b", attempts: 3 })]} />);

    const clases = screen.getAllByTestId("ledger-fila").map((e) => e.dataset.clase);
    expect(clases).toEqual(["reservada", "intento-perdido"]);
    // Y las dos son `pending` en la base: si la pantalla mostrara `status`, se
    // verían idénticas.
    expect(screen.getByText(/mirar en el destino/i)).toBeTruthy();
  });

  it("una fila rota se ve como rota, no como una publicación", () => {
    render(<Ledger filas={[fila({ status: "published", publishedAt: "x" })]} />);
    expect(screen.getByTestId("ledger-fila").dataset.clase).toBe("incoherente");
    expect(screen.getByText("LEDGER BROKEN")).toBeTruthy();
  });

  it("una publicada muestra el id de la red", () => {
    render(<Ledger filas={[fila({ status: "published", externalId: "gbp-9", publishedAt: "x" })]} />);
    expect(screen.getByTestId("ledger-fila").textContent).toContain("gbp-9");
  });
});
