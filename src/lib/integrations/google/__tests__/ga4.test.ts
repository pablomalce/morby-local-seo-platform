/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un cuerpo raro de GA4 se convierta en un cero creíble, y que las sesiones
 * de un cliente se muestren como sus conversiones.
 *
 * Las dos son propias de esta API. La primera porque devuelve los números como
 * TEXTO, y `Number("")` es 0: un valor vacío se vuelve un cero que nadie va a
 * cuestionar. La segunda porque los valores vienen en una lista posicional, así
 * que leer por índice funciona hasta el día que alguien agregue una métrica en el
 * medio del pedido.
 */
import { describe, expect, it } from "vitest";
import { fetchGa4Totals, readRunReport } from "../ga4";

const AHORA = new Date("2026-09-01T12:00:00.000Z");
const CUANDO = AHORA.toISOString();

const ENCABEZADOS = [{ name: "sessions" }, { name: "conversions" }];

function fetchQueContesta(
  respuesta: { ok: boolean; status: number; json: () => Promise<unknown> },
  registro: { url?: string; body?: string; headers?: HeadersInit } = {}
) {
  return async (url: string, init: RequestInit) => {
    registro.url = url;
    registro.body = String(init.body);
    registro.headers = init.headers;
    return respuesta as unknown as Response;
  };
}

describe("readRunReport", () => {
  it("convierte el texto que GA4 devuelve en números", () => {
    const r = readRunReport(
      { metricHeaders: ENCABEZADOS, rows: [{ metricValues: [{ value: "512" }, { value: "17" }] }] },
      CUANDO
    );
    expect(r.outcome).toEqual({ kind: "ok" });
    expect(r.totals).toEqual({ sessions: 512, conversions: 17, fetchedAt: CUANDO });
  });

  it("lee por NOMBRE, así que el orden del pedido puede cambiar sin mentir", () => {
    const r = readRunReport(
      {
        metricHeaders: [{ name: "conversions" }, { name: "sessions" }],
        rows: [{ metricValues: [{ value: "17" }, { value: "512" }] }],
      },
      CUANDO
    );
    expect(r.totals).toEqual({ sessions: 512, conversions: 17, fetchedAt: CUANDO });
  });

  it("sin `rows` es una property sin sesiones: ceros de verdad", () => {
    const r = readRunReport({ metricHeaders: ENCABEZADOS }, CUANDO);
    expect(r.outcome).toEqual({ kind: "ok" });
    expect(r.totals).toEqual({ sessions: 0, conversions: 0, fetchedAt: CUANDO });
  });

  it("con filas y sin encabezados no se sabe cuál número es cuál", () => {
    const r = readRunReport(
      { rows: [{ metricValues: [{ value: "512" }, { value: "17" }] }] },
      CUANDO
    );
    expect(r.outcome).toEqual({ kind: "malformed" });
    expect(r.totals).toBeNull();
  });

  it("un valor vacío NO es cero", () => {
    const r = readRunReport(
      { metricHeaders: ENCABEZADOS, rows: [{ metricValues: [{ value: "" }, { value: "17" }] }] },
      CUANDO
    );
    expect(r.outcome).toEqual({ kind: "malformed" });
  });

  it("un valor que no es un número tampoco: «NaN» impreso es peor que un error", () => {
    const r = readRunReport(
      { metricHeaders: ENCABEZADOS, rows: [{ metricValues: [{ value: "abc" }, { value: "17" }] }] },
      CUANDO
    );
    expect(r.outcome).toEqual({ kind: "malformed" });
  });

  it("una métrica que falta en la respuesta es un cuerpo incompleto", () => {
    const r = readRunReport(
      { metricHeaders: [{ name: "sessions" }], rows: [{ metricValues: [{ value: "512" }] }] },
      CUANDO
    );
    expect(r.outcome).toEqual({ kind: "malformed" });
  });

  it("un cuerpo que no es un objeto no se lee como property vacía", () => {
    expect(readRunReport(null, CUANDO).outcome).toEqual({ kind: "malformed" });
    expect(readRunReport("{}", CUANDO).outcome).toEqual({ kind: "malformed" });
  });
});

describe("fetchGa4Totals", () => {
  it("pide las dos métricas sobre la misma ventana que Search Console", async () => {
    const registro: { url?: string; body?: string; headers?: HeadersInit } = {};
    await fetchGa4Totals({
      accessToken: "ACCESO-sintetico",
      propertyRef: "properties/123456789",
      ahora: AHORA,
      fetcher: fetchQueContesta(
        { ok: true, status: 200, json: async () => ({ metricHeaders: ENCABEZADOS }) },
        registro
      ),
    });

    expect(registro.url).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties%2F123456789:runReport"
    );
    expect((registro.headers as Record<string, string>).authorization).toBe(
      "Bearer ACCESO-sintetico"
    );
    expect(JSON.parse(registro.body ?? "{}")).toEqual({
      dateRanges: [{ startDate: "2026-08-02", endDate: "2026-08-29" }],
      metrics: [{ name: "sessions" }, { name: "conversions" }],
    });
  });

  it("un 403 viaja con su número: suele ser el permiso de la property", async () => {
    const r = await fetchGa4Totals({
      accessToken: "t",
      propertyRef: "properties/1",
      ahora: AHORA,
      fetcher: fetchQueContesta({ ok: false, status: 403, json: async () => ({}) }),
    });
    expect(r.outcome).toEqual({ kind: "http", status: 403 });
  });

  it("una caída de red es `network`", async () => {
    const r = await fetchGa4Totals({
      accessToken: "t",
      propertyRef: "properties/1",
      ahora: AHORA,
      fetcher: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    expect(r.outcome).toEqual({ kind: "network" });
  });
});
