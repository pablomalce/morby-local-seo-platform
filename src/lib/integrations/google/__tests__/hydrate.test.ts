/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la causa de más arriba se pierda, y que una manera de no tener token se
 * muestre como otra.
 *
 * Las seis maneras de no tener token no son intercambiables: cuatro son «no hay
 * nada que mandar» —que el reporte llama `missing`— y dos son «no se pudo
 * averiguar», que es `error` porque el token puede estar vivo. Mostrarlas todas
 * igual manda a rehacer un OAuth que está hecho, o a esperar un reintento que
 * nunca va a servir.
 */
import { describe, expect, it, vi } from "vitest";
import { type HydrateDeps, hydrateGoogle, statusForTokenFailure } from "../hydrate";
import type { PropertyMapping } from "../sources";

const ENV = {
  GOOGLE_CLIENT_ID: "no-es-real.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "no-es-un-secreto-real",
} as unknown as NodeJS.ProcessEnv;

const MAPEO_COMPLETO: PropertyMapping[] = [
  { provider: "search_console", propertyRef: "https://ejemplo.test/" },
  { provider: "ga4", propertyRef: "properties/123456789" },
  { provider: "google_business_profile", propertyRef: "locations/123456789" },
];

const CUANDO = "2026-09-01T12:00:00.000Z";

function deps(over: Partial<HydrateDeps> = {}): HydrateDeps {
  return {
    mappings: MAPEO_COMPLETO,
    token: { ok: true, accessToken: "ACCESO-sintetico" },
    env: ENV,
    fetchSearchConsole: async () => ({
      outcome: { kind: "ok" },
      totals: { clicks: 128, impressions: 4021, ctr: 0.03, position: 8.4, fetchedAt: CUANDO },
    }),
    fetchGa4: async () => ({
      outcome: { kind: "ok" },
      totals: { sessions: 512, conversions: 17, fetchedAt: CUANDO },
    }),
    ...over,
  };
}

describe("con todo en orden", () => {
  it("las dos fuentes con cliente HTTP quedan vivas, y traen sus números", async () => {
    const r = await hydrateGoogle(deps());

    expect(r.searchConsole).toBe("live");
    expect(r.ga4).toBe("live");
    expect(r.searchConsoleTotals?.clicks).toBe(128);
    expect(r.ga4Totals?.sessions).toBe(512);
  });

  it("Business Profile no se consulta, así que no dice estar vivo", async () => {
    const fetchSearchConsole = vi.fn(deps().fetchSearchConsole);
    const r = await hydrateGoogle(deps({ fetchSearchConsole }));

    expect(r.gbp).toBe("error");
    // Y cada fuente se consulta una sola vez: nadie pregunta por Search Console
    // para contestar por GBP.
    expect(fetchSearchConsole).toHaveBeenCalledTimes(1);
  });

  it("cada cliente recibe la property de SU superficie", async () => {
    const fetchSearchConsole = vi.fn(deps().fetchSearchConsole);
    const fetchGa4 = vi.fn(deps().fetchGa4);
    await hydrateGoogle(deps({ fetchSearchConsole, fetchGa4 }));

    expect(fetchSearchConsole).toHaveBeenCalledWith("ACCESO-sintetico", "https://ejemplo.test/");
    expect(fetchGa4).toHaveBeenCalledWith("ACCESO-sintetico", "properties/123456789");
  });
});

describe("la causa de más arriba gana", () => {
  it("sin credenciales de plataforma no se llama a nadie", async () => {
    const fetchSearchConsole = vi.fn(deps().fetchSearchConsole);
    const r = await hydrateGoogle(deps({ env: {} as NodeJS.ProcessEnv, fetchSearchConsole }));

    expect(fetchSearchConsole).not.toHaveBeenCalled();
    expect(r.searchConsole).toBe("missing");
    expect(r.ga4).toBe("missing");
  });

  it("una superficie sin mapear no se consulta, y las otras sí", async () => {
    const fetchGa4 = vi.fn(deps().fetchGa4);
    const r = await hydrateGoogle(
      deps({
        mappings: [{ provider: "search_console", propertyRef: "https://ejemplo.test/" }],
        fetchGa4,
      })
    );

    expect(fetchGa4).not.toHaveBeenCalled();
    expect(r.ga4).toBe("missing");
    expect(r.searchConsole).toBe("live");
  });

  it("sin token no se llama a Google, aunque el mapeo esté completo", async () => {
    const fetchSearchConsole = vi.fn(deps().fetchSearchConsole);
    const fetchGa4 = vi.fn(deps().fetchGa4);

    await hydrateGoogle(
      deps({
        token: { ok: false, reason: "absent", detail: "la agencia no tiene token" },
        fetchSearchConsole,
        fetchGa4,
      })
    );

    expect(fetchSearchConsole).not.toHaveBeenCalled();
    expect(fetchGa4).not.toHaveBeenCalled();
  });

  it("y una superficie sin mapear conserva SU motivo, no el del token", async () => {
    const r = await hydrateGoogle(
      deps({
        mappings: [],
        token: { ok: false, reason: "unreadable", detail: "la consulta falló" },
      })
    );

    // El token es ilegible —que sería `error`— y estas fuentes ni siquiera están
    // mapeadas: lo que se arregla primero es el mapeo, en la pantalla.
    expect(r.searchConsole).toBe("missing");
    expect(r.ga4).toBe("missing");
  });
});

describe("cada motivo del token dice lo que es", () => {
  it("no saber nada del token es `error`, nunca «sin conectar»", () => {
    expect(statusForTokenFailure("agency-unresolved")).toBe("error");
    expect(statusForTokenFailure("unreadable")).toBe("error");
  });

  it("no tener nada que mandar es `missing`", () => {
    expect(statusForTokenFailure("platform-not-configured")).toBe("missing");
    expect(statusForTokenFailure("absent")).toBe("missing");
    expect(statusForTokenFailure("revoked")).toBe("missing");
    expect(statusForTokenFailure("refresh-rejected")).toBe("missing");
  });
});

/**
 * La negativa del servicio compartido y el motivo de cada fuente.
 *
 * Hasta la revisión del #118 (2026-10-11) `not-mapped` era un motivo del TOKEN y
 * `statusForTokenFailure` tenía un `case` para él que ningún reporte alcanzaba:
 * la regla sólo lo devuelve con la lista de mapeos vacía, y con la lista vacía
 * las tres fuentes ya salían `client-not-mapped` antes de mirar el token. El
 * reporte de una organización sin ningún mapeo era idéntico, en lo visible, al de
 * una plataforma sin credenciales. Ahora la negativa es de la organización y se
 * decide antes que el mapeo de cada superficie, y cada fuente que no se consultó
 * dice por qué.
 */
describe("la negativa del servicio compartido, y el motivo de cada fuente", () => {
  it("sin ningún mapeo: las tres `missing` con `not-mapped`, no con `client-not-mapped`", async () => {
    const fetchSearchConsole = vi.fn(deps().fetchSearchConsole);
    const r = await hydrateGoogle(
      deps({
        mappings: [],
        token: { ok: false, reason: "not-mapped", detail: "sin mapeo" },
        fetchSearchConsole,
      })
    );

    expect([r.searchConsole, r.ga4, r.gbp]).toEqual(["missing", "missing", "missing"]);
    expect(r.motivos).toEqual({ searchConsole: "not-mapped", ga4: "not-mapped", gbp: "not-mapped" });
    expect(fetchSearchConsole).not.toHaveBeenCalled();
  });

  it("con el mapeo ilegible: `error`, no «sin conectar», y no se llama a nadie", async () => {
    const fetchSearchConsole = vi.fn(deps().fetchSearchConsole);
    const fetchGa4 = vi.fn(deps().fetchGa4);
    const r = await hydrateGoogle(
      deps({
        mappings: [],
        token: { ok: false, reason: "mapping-unreadable", detail: "57014" },
        fetchSearchConsole,
        fetchGa4,
      })
    );

    expect([r.searchConsole, r.ga4, r.gbp]).toEqual(["error", "error", "error"]);
    expect(r.motivos).toEqual({
      searchConsole: "mapping-unreadable",
      ga4: "mapping-unreadable",
      gbp: "mapping-unreadable",
    });
    expect(fetchSearchConsole).not.toHaveBeenCalled();
    expect(fetchGa4).not.toHaveBeenCalled();
  });

  it("la negativa le gana al mapeo aunque lleguen mapeos: nunca se consulta con ella", async () => {
    // Un llamador que mezcle los mapeos de una lectura con la negativa de otra
    // es un contrato roto; lo seguro es no consultar.
    const fetchSearchConsole = vi.fn(deps().fetchSearchConsole);
    const r = await hydrateGoogle(
      deps({ token: { ok: false, reason: "not-mapped", detail: "sin mapeo" }, fetchSearchConsole })
    );

    expect(fetchSearchConsole).not.toHaveBeenCalled();
    expect(r.motivos.searchConsole).toBe("not-mapped");
  });

  it("sin credenciales de plataforma, ése es el motivo, aunque además no haya mapeo", async () => {
    const r = await hydrateGoogle(
      deps({
        env: {} as NodeJS.ProcessEnv,
        mappings: [],
        token: { ok: false, reason: "not-mapped", detail: "sin mapeo" },
      })
    );

    expect(r.motivos).toEqual({
      searchConsole: "platform-not-connected",
      ga4: "platform-not-connected",
      gbp: "platform-not-connected",
    });
  });

  it("con mapeos, la superficie que falta dice `client-not-mapped`, y las consultadas no tienen motivo", async () => {
    const r = await hydrateGoogle(
      deps({ mappings: [{ provider: "ga4", propertyRef: "properties/123456789" }] })
    );

    expect(r.ga4).toBe("live");
    expect(r.motivos).toEqual({ searchConsole: "client-not-mapped", gbp: "client-not-mapped" });
  });

  it("mapeada y sin token de la agencia: `agency-token`, sin el motivo fino", async () => {
    const r = await hydrateGoogle(
      deps({ token: { ok: false, reason: "revoked", detail: "la autorización fue revocada" } })
    );

    expect(r.searchConsole).toBe("missing");
    expect(r.motivos).toEqual({
      searchConsole: "agency-token",
      ga4: "agency-token",
      gbp: "agency-token",
    });
  });
});

describe("lo que Google contesta lo traduce `status.ts`", () => {
  it("un 401 es `error`: hay credenciales y las rechazó", async () => {
    const r = await hydrateGoogle(
      deps({
        fetchSearchConsole: async () => ({
          outcome: { kind: "http", status: 401 },
          totals: null,
        }),
      })
    );

    expect(r.searchConsole).toBe("error");
    expect(r.searchConsoleTotals).toBeNull();
  });

  it("un cuerpo incompleto es `error` y NO deja números a medias", async () => {
    const r = await hydrateGoogle(
      deps({ fetchGa4: async () => ({ outcome: { kind: "malformed" }, totals: null }) })
    );

    expect(r.ga4).toBe("error");
    expect(r.ga4Totals).toBeNull();
    // Y la otra fuente no se contagia: son dos consultas independientes.
    expect(r.searchConsole).toBe("live");
  });
});
