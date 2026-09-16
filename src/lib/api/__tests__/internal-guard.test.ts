import { afterEach, describe, expect, it } from "vitest";
import { requireInternalSecret } from "../internal-guard";

/**
 * El guardia interno falla cerrado, ejercitado de los tres lados.
 *
 * QUÉ AGUJERO CIERRA
 *
 * Medido el 2026-09-10 llamando a cada handler sin sesión: siete rutas
 * contestaban 200 a cualquiera porque este guardia contestaba «pasá» cuando la
 * variable no estaba, y la variable no estaba en ningún lado. El barrido de
 * `precondicionRutas.test.ts` las tenía en `ABIERTAS_HOY`; este archivo es lo
 * que permite sacarlas de ahí, y es el que se pone rojo si alguien vuelve a
 * hacer el guardia opt-in.
 *
 * Los tres casos importan por separado. Sin variable es el que estaba roto.
 * Con variable y header equivocado es lo que siempre funcionó. Con variable y
 * header correcto es el que impide que «falla cerrado» se convierta en «falla
 * siempre» — un guardia que nunca deja pasar no es un guardia, es una ruta
 * apagada.
 */
describe("requireInternalSecret", () => {
  const previo = process.env.INTERNAL_API_SECRET;
  afterEach(() => {
    if (previo === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = previo;
  });

  const pedido = (header?: string) =>
    new Request("https://growth-os.test/api/interna", {
      headers: header === undefined ? {} : { "x-internal-secret": header },
    });

  it("niega cuando la variable no está, aunque el llamador mande un header", () => {
    delete process.env.INTERNAL_API_SECRET;

    expect(requireInternalSecret(pedido())?.status).toBe(401);
    expect(
      requireInternalSecret(pedido("cualquier-cosa"))?.status,
      "sin secreto configurado no hay nada contra qué comparar: ningún header puede abrir"
    ).toBe(401);
  });

  it("niega cuando la variable está y el header no coincide o falta", () => {
    process.env.INTERNAL_API_SECRET = "secreto-de-prueba";

    expect(requireInternalSecret(pedido())?.status).toBe(401);
    expect(requireInternalSecret(pedido("otro-secreto"))?.status).toBe(401);
  });

  it("deja pasar cuando la variable está y el header coincide", () => {
    process.env.INTERNAL_API_SECRET = "secreto-de-prueba";

    expect(
      requireInternalSecret(pedido("secreto-de-prueba")),
      "un guardia que nunca deja pasar no es un guardia: es una ruta apagada"
    ).toBeNull();
  });
});
