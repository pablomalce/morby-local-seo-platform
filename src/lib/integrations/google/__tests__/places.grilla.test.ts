/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que `posicionEnPunto` —la única llamada a Google de la grilla de H2-GO-3—
 * pregunte sin la coordenada del punto, cachee, pida más de 20 resultados, o
 * convierta un fallo en «no aparece».
 *
 * EL ORÁCULO DEL CONTRATO SALE DE GOOGLE (R11), no de este código: la URL, las
 * dos cabeceras, `pageSize` (no `maxResultCount`, que la referencia de
 * `places.searchText` marca «Deprecated: Use pageSize instead») y la forma de
 * `locationBias.circle` están escritas acá como las publica
 * developers.google.com/maps/documentation/places/web-service, leídas el
 * 2026-10-08. Si alguien cambia el código Y el test a la vez, el test sigue
 * diciendo qué publica Google.
 *
 * El transporte es un doble: ninguna llamada sale a Google.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { posicionEnPunto, type ConsultaDePunto } from "../places";
import { googleGeografico, type PedidoVisto } from "@/lib/geo/__tests__/googleGeografico";

const OBJETIVO = "ChIJobjetivoDeLaGrilla01";

const consulta: ConsultaDePunto = {
  keyword: "fotvård Stockholm",
  targetPlaceId: OBJETIVO,
  lat: 59.3293,
  lng: 18.0686,
  radiusM: 1200,
};

function lista(ids: string[]): Response {
  return new Response(JSON.stringify({ places: ids.map((id) => ({ id, displayName: { text: id } })) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const otros = (n: number) => Array.from({ length: n }, (_, i) => `ChIJotro${String(i).padStart(4, "0")}xxxxxx`);

const envPrevio = process.env.GOOGLE_PLACES_API_KEY;
beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "clave-falsa-de-places";
});
afterEach(() => {
  if (envPrevio === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = envPrevio;
});

describe("posicionEnPunto: el pedido es el que Google publica (R11)", () => {
  it("POST a places:searchText, con la clave y la máscara mínima en cabeceras", async () => {
    const google = googleGeografico([], { responder: () => lista([OBJETIVO]) });
    await posicionEnPunto(consulta, google.transporte);

    expect(google.pedidos).toHaveLength(1);
    const [p] = google.pedidos as [PedidoVisto];
    expect(p.url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(p.metodo).toBe("POST");
    expect(p.cabeceras["x-goog-api-key"]).toBe("clave-falsa-de-places");
    // Exacta, no «contiene»: una máscara más ancha cambia el SKU que se paga.
    expect(p.cabeceras["x-goog-fieldmask"]).toBe("places.id,places.displayName");
  });

  it("el cuerpo lleva la palabra, pageSize 20 y locationBias.circle con la coordenada DEL PUNTO", async () => {
    const google = googleGeografico([], { responder: () => lista([]) });
    await posicionEnPunto(consulta, google.transporte);

    expect(google.pedidos[0].cuerpo).toEqual({
      textQuery: "fotvård Stockholm",
      pageSize: 20,
      locationBias: {
        circle: { center: { latitude: 59.3293, longitude: 18.0686 }, radius: 1200 },
      },
    });
    expect(google.pedidos[0].cuerpo).not.toHaveProperty("maxResultCount");
  });

  it("no cachea: cada punto es una pregunta nueva a Google, no la respuesta de la corrida anterior", async () => {
    const google = googleGeografico([], { responder: () => lista([]) });
    await posicionEnPunto(consulta, google.transporte);

    const init = google.pedidos[0].init as RequestInit & { next?: unknown };
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sin clave no sale a la red y el punto es failed/missing_key, no absent", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const google = googleGeografico([]);

    await expect(posicionEnPunto(consulta, google.transporte)).resolves.toEqual({
      outcome: "failed",
      errorCode: "missing_key",
    });
    expect(google.pedidos).toHaveLength(0);
  });
});

describe("posicionEnPunto: la posición es el índice 1..20 del lugar en la respuesta", () => {
  it("primero es 1, quinto es 5, vigésimo es 20", async () => {
    for (const [antes, esperada] of [
      [0, 1],
      [4, 5],
      [19, 20],
    ] as const) {
      const google = googleGeografico([], { responder: () => lista([...otros(antes), OBJETIVO, ...otros(3)]) });
      await expect(posicionEnPunto(consulta, google.transporte)).resolves.toEqual({
        outcome: "position",
        position: esperada,
      });
    }
  });

  it("si no está entre los 20 es absent, aunque Google mande de más", async () => {
    const google = googleGeografico([], { responder: () => lista([...otros(20), OBJETIVO]) });
    await expect(posicionEnPunto(consulta, google.transporte)).resolves.toEqual({ outcome: "absent" });
  });

  it("una respuesta viva sin lugares —`{}`, `places: []`— es absent, no failed", async () => {
    for (const cuerpo of ["{}", '{"places":[]}']) {
      const google = googleGeografico([], {
        responder: () => new Response(cuerpo, { status: 200, headers: { "content-type": "application/json" } }),
      });
      await expect(posicionEnPunto(consulta, google.transporte)).resolves.toEqual({ outcome: "absent" });
    }
  });

  it("el id se compara exacto: un id que sólo lo contiene no es el lugar", async () => {
    const google = googleGeografico([], { responder: () => lista([`${OBJETIVO}x`, `x${OBJETIVO}`]) });
    await expect(posicionEnPunto(consulta, google.transporte)).resolves.toEqual({ outcome: "absent" });
  });
});

describe("posicionEnPunto: un fallo es failed con su código, NUNCA absent", () => {
  it("un status que no es 2xx es http_<status>: 429, 403, 400, 500, 503", async () => {
    for (const status of [429, 403, 400, 500, 503]) {
      const google = googleGeografico([], {
        responder: () =>
          new Response(JSON.stringify({ error: { code: status, status: "RESOURCE_EXHAUSTED" } }), { status }),
      });
      await expect(posicionEnPunto(consulta, google.transporte)).resolves.toEqual({
        outcome: "failed",
        errorCode: `http_${status}`,
      });
    }
  });

  it("la red cortada es network", async () => {
    const google = googleGeografico([], { cortarDesde: 1 });
    await expect(posicionEnPunto(consulta, google.transporte)).resolves.toEqual({
      outcome: "failed",
      errorCode: "network",
    });
  });

  it("un Google que no contesta a tiempo es timeout, y el pedido se aborta", async () => {
    const google = googleGeografico([], { retener: true });
    await expect(posicionEnPunto(consulta, google.transporte, 20)).resolves.toEqual({
      outcome: "failed",
      errorCode: "timeout",
    });
    expect(google.pedidos[0].init.signal?.aborted).toBe(true);
  });

  it("una respuesta 200 que no es una lista de lugares es invalid_response", async () => {
    const formas = [
      "esto no es json {",
      "[]",
      "null",
      '{"places": {"id": "ChIJobjetivoDeLaGrilla01"}}',
      '{"places": [{"displayName": {"text": "sin id"}}]}',
      `{"places": [{"id": ""}, {"id": "${OBJETIVO}"}]}`,
    ];
    for (const cuerpo of formas) {
      const google = googleGeografico([], { responder: () => new Response(cuerpo, { status: 200 }) });
      await expect(posicionEnPunto(consulta, google.transporte), cuerpo).resolves.toEqual({
        outcome: "failed",
        errorCode: "invalid_response",
      });
    }
  });
});
