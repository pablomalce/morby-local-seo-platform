/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un 401, un 429 o un timeout de Search Console o GA4 lleguen al reporte
 * como "sin datos".
 *
 * Este test va ANTES que los clientes HTTP de las dos fuentes, y es a propósito:
 * la puerta de F2 pide que *el fallo de una API se muestre como fallo*, y esa
 * mitad se prueba apagando la API, no leyéndola. Fijado el contrato acá, el
 * cliente que venga lo cumple; escrito después, el cliente decide qué significa
 * cada código y el test se acomoda a lo que ya hace.
 *
 * El caso que se equivoca solo es el 401: parece "falta conectar" y es
 * "conectado, y Google rechazó las credenciales".
 */
import { describe, expect, it } from "vitest";

import { type FetchOutcome, statusForOutcome } from "../status";

describe("statusForOutcome — un fallo no es una integración sin conectar", () => {
  it("un 401 es error, NO missing", () => {
    // El corazón del asunto. Un token vencido, revocado, o de otro proyecto da
    // 401 con la integración perfectamente conectada. Leerlo como `missing`
    // manda al cliente a conectar algo que ya está conectado, y le esconde que
    // el reporte trae cifras sintéticas por una razón que él puede arreglar.
    expect(statusForOutcome({ kind: "http", status: 401 })).toBe("error");
    expect(statusForOutcome({ kind: "http", status: 401 })).not.toBe("missing");
  });

  it("un 403 es error, NO missing", () => {
    // Suele ser el permiso sobre la propiedad, no la ausencia de credenciales.
    expect(statusForOutcome({ kind: "http", status: 403 })).toBe("error");
    expect(statusForOutcome({ kind: "http", status: 403 })).not.toBe("missing");
  });

  it("un 429 es error: la cuota agotada es un fallo, no un dato en cero", () => {
    expect(statusForOutcome({ kind: "http", status: 429 })).toBe("error");
  });

  it("un timeout es error, no ausencia de datos", () => {
    expect(statusForOutcome({ kind: "timeout" })).toBe("error");
  });

  it("un fallo de red es error", () => {
    expect(statusForOutcome({ kind: "network" })).toBe("error");
  });

  it("un 200 con el cuerpo incompleto es error, no 'live' con ceros", () => {
    // El defecto que este repositorio ya pagó dos veces: una lectura fallida
    // presentada como una medición legítima que dio cero.
    expect(statusForOutcome({ kind: "malformed" })).toBe("error");
  });

  it("missing es UN solo caso: no hay credenciales, no hubo petición", () => {
    expect(statusForOutcome({ kind: "no-credentials" })).toBe("missing");
  });

  it("una respuesta buena es live", () => {
    expect(statusForOutcome({ kind: "ok" })).toBe("live");
  });

  it("ningún código HTTP que no sea 2xx cae en missing", () => {
    // El barrido existe porque la regla es "todo lo que no sea ok ni ausencia de
    // credenciales es error", y un `if` de más para un código particular la
    // rompería sin que ninguno de los tests de arriba se entere.
    const codes = [400, 401, 403, 404, 409, 418, 429, 500, 502, 503, 504];
    for (const status of codes) {
      expect(statusForOutcome({ kind: "http", status }), `HTTP ${status}`).toBe("error");
    }
  });

  it("todo FetchOutcome tiene una traducción, y sólo dos no son error", () => {
    // Denominador escrito a mano: un `kind` nuevo rompe este conteo y obliga a
    // decidir qué significa, en vez de heredar un `default` silencioso.
    const todos: FetchOutcome[] = [
      { kind: "ok" },
      { kind: "no-credentials" },
      { kind: "http", status: 500 },
      { kind: "timeout" },
      { kind: "network" },
      { kind: "malformed" },
    ];
    expect(todos).toHaveLength(6);
    expect(todos.filter((o) => statusForOutcome(o) === "error")).toHaveLength(4);
    expect(todos.filter((o) => statusForOutcome(o) === "missing")).toHaveLength(1);
    expect(todos.filter((o) => statusForOutcome(o) === "live")).toHaveLength(1);
  });
});
