/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un cuerpo que no se entiende se lea como un cliente con cero clics.
 *
 * Es la diferencia entre cero y nada, y es la que se pierde sola:
 * `rows?.[0]?.clicks ?? 0` compila, corre, y contesta lo mismo en los dos casos.
 * Un cero no llama la atención de nadie.
 */
import { describe, expect, it } from "vitest";
import { fetchSearchConsoleTotals, readSearchAnalytics, ventana } from "../searchConsole";

const AHORA = new Date("2026-09-01T12:00:00.000Z");
const CUANDO = AHORA.toISOString();

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

describe("la ventana", () => {
  it("termina tres días atrás, porque Search Console publica con demora", () => {
    expect(ventana(AHORA).endDate).toBe("2026-08-29");
  });

  it("y cubre veintiocho días contando el último", () => {
    expect(ventana(AHORA).startDate).toBe("2026-08-02");
  });
});

describe("readSearchAnalytics", () => {
  it("sin `rows` es una property sin tráfico: ceros, y la fuente está viva", () => {
    const r = readSearchAnalytics({}, CUANDO);
    expect(r.outcome).toEqual({ kind: "ok" });
    expect(r.totals).toEqual({
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      fetchedAt: CUANDO,
    });
  });

  it("con `rows` vacío, lo mismo", () => {
    expect(readSearchAnalytics({ rows: [] }, CUANDO).outcome).toEqual({ kind: "ok" });
  });

  it("con `rows` que no es una lista, el cuerpo no se entiende", () => {
    const r = readSearchAnalytics({ rows: { clicks: 1 } }, CUANDO);
    expect(r.outcome).toEqual({ kind: "malformed" });
    expect(r.totals).toBeNull();
  });

  it("una fila sin uno de los cuatro campos NO es cero", () => {
    const r = readSearchAnalytics({ rows: [{ clicks: 10, impressions: 100, ctr: 0.1 }] }, CUANDO);
    expect(r.outcome).toEqual({ kind: "malformed" });
    expect(r.totals).toBeNull();
  });

  it("un campo que viene como texto tampoco: Google los manda como números", () => {
    const r = readSearchAnalytics(
      { rows: [{ clicks: "10", impressions: 100, ctr: 0.1, position: 8.4 }] },
      CUANDO
    );
    expect(r.outcome).toEqual({ kind: "malformed" });
  });

  it("los cuatro campos completos llegan tal cual, sin redondear", () => {
    const r = readSearchAnalytics(
      { rows: [{ clicks: 128, impressions: 4021, ctr: 0.0318, position: 8.44 }] },
      CUANDO
    );
    expect(r.totals).toEqual({
      clicks: 128,
      impressions: 4021,
      ctr: 0.0318,
      position: 8.44,
      fetchedAt: CUANDO,
    });
  });

  it("un cuerpo que no es un objeto no se lee como property vacía", () => {
    expect(readSearchAnalytics("[]", CUANDO).outcome).toEqual({ kind: "malformed" });
    expect(readSearchAnalytics(null, CUANDO).outcome).toEqual({ kind: "malformed" });
  });
});

describe("fetchSearchConsoleTotals", () => {
  it("pide la ventana al endpoint de la property, con el token en la cabecera", async () => {
    const registro: { url?: string; body?: string; headers?: HeadersInit } = {};
    await fetchSearchConsoleTotals({
      accessToken: "ACCESO-sintetico",
      propertyRef: "sc-domain:ejemplo.test",
      ahora: AHORA,
      fetcher: fetchQueContesta({ ok: true, status: 200, json: async () => ({}) }, registro),
    });

    expect(registro.url).toBe(
      "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aejemplo.test/searchAnalytics/query"
    );
    expect((registro.headers as Record<string, string>).authorization).toBe(
      "Bearer ACCESO-sintetico"
    );
    expect(JSON.parse(registro.body ?? "{}")).toEqual({
      startDate: "2026-08-02",
      endDate: "2026-08-29",
      rowLimit: 1,
    });
  });

  it("codifica la property: una URL cruda parte la ruta en dos", async () => {
    const registro: { url?: string } = {};
    await fetchSearchConsoleTotals({
      accessToken: "t",
      propertyRef: "https://ejemplo.test/",
      ahora: AHORA,
      fetcher: fetchQueContesta({ ok: true, status: 200, json: async () => ({}) }, registro),
    });
    expect(registro.url).toContain("https%3A%2F%2Fejemplo.test%2F");
  });

  it("un 401 viaja con su número adentro, para que `status.ts` decida", async () => {
    const r = await fetchSearchConsoleTotals({
      accessToken: "t",
      propertyRef: "https://ejemplo.test/",
      ahora: AHORA,
      fetcher: fetchQueContesta({ ok: false, status: 401, json: async () => ({}) }),
    });
    expect(r.outcome).toEqual({ kind: "http", status: 401 });
    expect(r.totals).toBeNull();
  });

  it("un fetch que tira es `network`, que no es lo mismo que un rechazo", async () => {
    const r = await fetchSearchConsoleTotals({
      accessToken: "t",
      propertyRef: "https://ejemplo.test/",
      ahora: AHORA,
      fetcher: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(r.outcome).toEqual({ kind: "network" });
  });

  it("un 200 con cuerpo ilegible es `malformed`", async () => {
    const r = await fetchSearchConsoleTotals({
      accessToken: "t",
      propertyRef: "https://ejemplo.test/",
      ahora: AHORA,
      fetcher: fetchQueContesta({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token");
        },
      }),
    });
    expect(r.outcome).toEqual({ kind: "malformed" });
  });
});
