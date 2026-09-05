/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla del ledger funda cinco situaciones en tres palabras.
 *
 * Las dos que más cuesta distinguir comparten `status`: `pending` con cero
 * intentos es una reserva —el ensayo llegó al borde— y `pending` con intentos es
 * una fila que quedó abierta después de llamar a la red, que es el caso en que
 * el contenido PUEDE estar publicado sin haberse podido anotar. Se arreglan en
 * lugares opuestos y la columna cruda las muestra igual.
 */
import { describe, expect, it } from "vitest";
import { leerFila, type FilaLedger } from "../ledgerView";

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

describe("cómo se lee una fila del ledger", () => {
  it("pendiente con cero intentos es una RESERVA, y no hay nada que hacer", () => {
    const l = leerFila(fila());
    expect(l.clase).toBe("reservada");
    expect(l.queHacer).toBeNull();
  });

  it("pendiente CON intentos es otra cosa, y manda a mirar el destino antes de reintentar", () => {
    // Es el caso del transporte «se publicó y no se pudo anotar». Reintentar a
    // ciegas acá publica dos veces en la ficha de un cliente.
    const l = leerFila(fila({ attempts: 2 }));
    expect(l.clase).toBe("intento-perdido");
    expect(l.queHacer).toMatch(/mirar en el destino/i);
  });

  it("publicada muestra el id que devolvió la red", () => {
    const l = leerFila(
      fila({ status: "published", externalId: "gbp-9", publishedAt: "2026-09-05T12:01:00.000Z" })
    );
    expect(l.clase).toBe("publicada");
    expect(l.quePaso).toContain("gbp-9");
    expect(l.queHacer).toBeNull();
  });

  it("publicada SIN id de red se dice rota, y no se dibuja como una publicación", () => {
    // El CHECK `publications_published_is_complete` lo prohíbe. Si aparece, la
    // garantía se cayó, y una fila verde encima lo esconde.
    const l = leerFila(fila({ status: "published", publishedAt: "2026-09-05T12:01:00.000Z" }));
    expect(l.clase).toBe("incoherente");
    expect(l.queHacer).toMatch(/no publicar encima/i);
  });

  it("publicada sin FECHA también, no sólo sin id", () => {
    // Las dos mitades del CHECK. Sin este caso, media garantía rota pasaría.
    expect(leerFila(fila({ status: "published", externalId: "gbp-9" })).clase).toBe("incoherente");
  });

  it("fallada dice cuántas veces, y que el reintento no duplica", () => {
    const l = leerFila(fila({ status: "failed", attempts: 1 }));
    expect(l.clase).toBe("fallada");
    expect(l.quePaso).toContain("1");
    expect(l.queHacer).toMatch(/no cree otra/i);
  });

  it("un estado que el CHECK no permite se dice, en vez de dibujarse como algo conocido", () => {
    expect(leerFila(fila({ status: "scheduled" })).clase).toBe("incoherente");
  });

  it("las cinco clases dicen cosas distintas", () => {
    // Sin esto, un módulo que devolviera la misma frase pasaría casi todo lo de
    // arriba y la pantalla dejaría de distinguir nada.
    const frases = new Set(
      [
        fila(),
        fila({ attempts: 2 }),
        fila({ status: "published", externalId: "g", publishedAt: "x" }),
        fila({ status: "failed" }),
        fila({ status: "scheduled" }),
      ].map((f) => leerFila(f).quePaso)
    );
    expect(frases.size).toBe(5);
  });
});
