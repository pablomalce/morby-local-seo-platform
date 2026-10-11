/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el reporte de una organización sin token propio y sin mapeo se arme con
 * el token de la agencia — o con la property de otra.
 *
 * Es la puerta que la Espina pide para «el fallback silencioso al token de la
 * agencia», medida en el reporte y no en la regla suelta:
 * `servicioCompartido.test.ts` prueba la regla; esto prueba que
 * `generateReport` la use y no tenga un segundo camino al lado.
 *
 * CUATRO ORGANIZACIONES, UN SOLO TOKEN
 *
 *   AGENCIA    tiene el token (el único de `integration_tokens`) y su propio
 *              sitio mapeado en Search Console;
 *   CLIENTE_A  sin token propio, mapeada en Search Console y GA4: la agencia la
 *              sirve con SU token y sobre las properties de A (H4.4);
 *   CLIENTE_B  sembrada SIN token y SIN mapeo: el caso que antes resolvía el
 *              token de la agencia igual;
 *   CLIENTE_C  a mitad del alta, sólo GA4 mapeado: lo que le falta no se
 *              completa con las properties de la agencia.
 *
 * LOS DOBLES REGISTRAN QUÉ TOKEN Y QUÉ PROPERTY
 *
 * Ninguna llamada sale a Google. `fetch` es un espía que anota la URL —donde va
 * la property— y la cabecera `Authorization` —donde va el token—. El cliente
 * admin anota de QUÉ organización se leyó el secreto. La sesión modela la RLS
 * de verdad: devuelve las filas de las organizaciones de las que el usuario es
 * miembro Y aplica los filtros que el código manda, ni más ni menos; si el
 * código pierde su filtro por organización, el doble devuelve lo que la base
 * devolvería — las filas de todas sus organizaciones.
 *
 * Y EL DOBLE RECORRE EL ARRANQUE (R13)
 *
 * El token de la agencia está VENCIDO: resolverlo es leer el secreto, pedir un
 * access token nuevo a `oauth2.googleapis.com/token` y guardarlo. Así «se
 * resolvió el token» deja huella en tres lugares, y el caso de A —donde SÍ se
 * resuelve— demuestra que el doble la registra. Un token `active` desde el
 * primer instante haría invisible el refresco, que es justamente el uso de la
 * credencial que una organización sin mapeo no puede disparar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const lookupPageSpeed = vi.fn();
const lookupPlace = vi.fn();
vi.mock("@/lib/integrations/google/pagespeed", () => ({ lookupPageSpeed }));
vi.mock("@/lib/integrations/google/places", () => ({ lookupPlace }));

const AGENCIA = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const CLIENTE_A = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00";
const CLIENTE_B = "0b0b0b0b-1111-4222-8333-444455556666";
/** Un cliente a mitad del alta: sólo GA4 mapeado. */
const CLIENTE_C = "0c0c0c0c-1111-4222-8333-444455556666";

const NEGOCIO = {
  [AGENCIA]: "aaaa0000-0000-4000-8000-00000000000a",
  [CLIENTE_A]: "aaaa0000-0000-4000-8000-0000000000a1",
  [CLIENTE_B]: "aaaa0000-0000-4000-8000-0000000000b1",
  [CLIENTE_C]: "aaaa0000-0000-4000-8000-0000000000c1",
} as const;

const SITIO_AGENCIA = "https://vulkan.test/";
const SITIO_A = "https://cliente-a.test/";
const GA4_A = "properties/111111111";
const GA4_C = "properties/333333333";

/** `integration_properties`, vivos. B no tiene ninguno. */
const MAPEOS = [
  { organization_id: AGENCIA, provider: "search_console", property_ref: SITIO_AGENCIA, unmapped_at: null },
  { organization_id: CLIENTE_A, provider: "search_console", property_ref: SITIO_A, unmapped_at: null },
  { organization_id: CLIENTE_A, provider: "ga4", property_ref: GA4_A, unmapped_at: null },
  { organization_id: CLIENTE_C, provider: "ga4", property_ref: GA4_C, unmapped_at: null },
];

/** `integration_tokens`: UNA fila, la de la agencia, vencida. Ningún cliente tiene token propio. */
const TOKENS: Record<string, { expires_at: string; revoked_at: string | null; secret: string }> = {
  [AGENCIA]: {
    expires_at: "2026-01-01T00:00:00.000Z",
    revoked_at: null,
    secret: JSON.stringify({ refresh_token: "REFRESCO-de-la-agencia", access_token: "ACCESO-viejo-de-la-agencia" }),
  },
};

const ACCESO_NUEVO = "ACCESO-refrescado-de-la-agencia";

/** De qué organizaciones es miembro quien pide el reporte. Lo que la RLS deja ver. */
let miembroDe: string[] = [];

/** Lo que los dobles registran. */
let salidas: { url: string; autorizacion: string | null }[] = [];
let secretosLeidos: string[] = [];
let tokensLeidos: string[] = [];
let refrescosGuardados: string[] = [];
let sondas: { organization_id: string; provider: string; property_ref: string }[] = [];

function negocioEnBase(org: string) {
  return {
    id: NEGOCIO[org as keyof typeof NEGOCIO],
    organization_id: org,
    name: `Negocio de ${org.slice(0, 4)}`,
    website: org === AGENCIA ? SITIO_AGENCIA : org === CLIENTE_A ? SITIO_A : `https://cliente-${org.slice(1, 2)}.test/`,
    industry: "other",
    brand_tone: "",
    primary_locale: "es",
    value_proposition: "",
    logo_color: "#EF4C24",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

/** Las filas de una tabla que la RLS deja ver, con los filtros que el código mandó. */
function bajoRls(tabla: string, filtros: Record<string, unknown>) {
  if (tabla === "integration_properties") {
    return MAPEOS.filter(
      (f) =>
        miembroDe.includes(f.organization_id) &&
        Object.entries(filtros).every(([col, val]) => (f as Record<string, unknown>)[col] === val)
    );
  }
  if (tabla === "businesses") {
    return Object.keys(NEGOCIO)
      .map(negocioEnBase)
      .filter(
        (b) =>
          miembroDe.includes(b.organization_id) &&
          Object.entries(filtros).every(([col, val]) => (b as Record<string, unknown>)[col] === val)
      );
  }
  return [];
}

const createSupabaseServerClient = vi.fn(async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
  from(tabla: string) {
    const filtros: Record<string, unknown> = {};
    const filas = () => bajoRls(tabla, filtros);
    const cadena = {
      select: () => cadena,
      eq: (col: string, val: unknown) => {
        filtros[col] = val;
        return cadena;
      },
      is: (col: string, val: unknown) => {
        filtros[col] = val;
        return cadena;
      },
      single: async () => {
        const f = filas();
        return f.length === 1 ? { data: f[0], error: null } : { data: null, error: { code: "PGRST116" } };
      },
      maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
      insert: async () => ({ data: null, error: null }),
      then: (resolver: (v: unknown) => unknown) => Promise.resolve({ data: filas(), error: null }).then(resolver),
    };
    return cadena;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

/** `service_role`: sin RLS. Modela `integration_tokens`, las RPC de la 0021 y la sonda. */
const createSupabaseAdminClient = vi.fn(() => ({
  from(tabla: string) {
    const filtros: Record<string, unknown> = {};
    const cadena = {
      select: () => cadena,
      eq: (col: string, val: unknown) => {
        filtros[col] = val;
        return cadena;
      },
      order: () => cadena,
      limit: async () => {
        const org = String(filtros.organization_id);
        tokensLeidos.push(org);
        const t = TOKENS[org];
        return { data: t ? [{ expires_at: t.expires_at, revoked_at: t.revoked_at }] : [], error: null };
      },
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (fila: { organization_id: string; provider: string; property_ref: string }) => {
        if (tabla === "integration_probe") sondas.push(fila);
        return { data: null, error: null };
      },
    };
    return cadena;
  },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    if (fn === "integration_token_state") {
      const vencido = new Date(String(args.p_expires_at)).getTime() < Date.now();
      return { data: args.p_revoked_at ? "revoked" : vencido ? "expired" : "active", error: null };
    }
    if (fn === "integration_token_secret") {
      const org = String(args.p_organization_id);
      secretosLeidos.push(org);
      return { data: TOKENS[org]?.secret ?? null, error: null };
    }
    if (fn === "refresh_integration_token") {
      refrescosGuardados.push(String(args.p_organization_id));
      return { data: true, error: null };
    }
    return { data: null, error: null };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

/** Google, del otro lado: contesta, y deja anotado qué se le pidió y con qué token. */
function googleContesta() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const cabeceras = new Headers(init?.headers);
    salidas.push({ url: String(url), autorizacion: cabeceras.get("authorization") });
    const u = String(url);
    const cuerpo = u.startsWith("https://oauth2.googleapis.com/token")
      ? { access_token: ACCESO_NUEVO, expires_in: 3600 }
      : u.includes("searchconsole.googleapis.com")
        ? { rows: [{ clicks: 9, impressions: 90, ctr: 0.1, position: 3 }] }
        : {
            metricHeaders: [{ name: "sessions" }, { name: "keyEvents" }],
            rows: [{ metricValues: [{ value: "7" }, { value: "1" }] }],
          };
    return { ok: true, status: 200, json: async () => cuerpo } as unknown as Response;
  });
}

async function reporteDe(org: string) {
  const { generateReport } = await import("@/lib/reports/orchestrator");
  return generateReport({ businessId: NEGOCIO[org as keyof typeof NEGOCIO], locale: "es" });
}

const aGoogleDatos = () => salidas.filter((s) => !s.url.startsWith("https://oauth2.googleapis.com/"));
const aRefrescar = () => salidas.filter((s) => s.url.startsWith("https://oauth2.googleapis.com/token"));
/** Toda property que viajó en una URL de datos, en la forma en que viaja. */
const propertiesEnviadas = () => aGoogleDatos().map((s) => decodeURIComponent(s.url));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  lookupPlace.mockReset();
  lookupPageSpeed.mockReset();
  lookupPlace.mockResolvedValue({ status: "no-match" });
  lookupPageSpeed.mockResolvedValue({ status: "missing-key" });
  salidas = [];
  secretosLeidos = [];
  tokensLeidos = [];
  refrescosGuardados = [];
  sondas = [];
  miembroDe = [];
  // La plataforma entera conectada: si algo no sale, no es por falta de
  // credenciales.
  process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
  process.env.GOOGLE_REDIRECT_URI = "https://ejemplo.test/api/auth/google/callback";
  process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
  // Y las tres variables de la agencia que `.env.example` todavía declara y
  // nada lee. Puestas a propósito, con los valores de la AGENCIA: el fallback
  // más corto que existe es leerlas cuando el cliente no tiene mapeo.
  process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = SITIO_AGENCIA;
  process.env.GA4_PROPERTY_ID = "properties/999999999";
  process.env.GOOGLE_BUSINESS_LOCATION_ID = "locations/999999999";
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PAGESPEED_API_KEY;
  googleContesta();
});

afterEach(() => {
  for (const v of [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "VULKAN_AGENCY_ORG_ID",
    "GOOGLE_SEARCH_CONSOLE_SITE_URL",
    "GA4_PROPERTY_ID",
    "GOOGLE_BUSINESS_LOCATION_ID",
  ]) {
    delete process.env[v];
  }
  vi.unstubAllGlobals();
});

describe("lo legítimo: la agencia sirve a A con su token, sobre las properties de A", () => {
  it("el token es el de la agencia, refrescado; las properties, las de A y ninguna otra", async () => {
    miembroDe = [CLIENTE_A];

    const rep = await reporteDe(CLIENTE_A);

    // El arranque, recorrido: se leyó el estado del token DE LA AGENCIA, su
    // secreto, se refrescó en Google y se guardó. Es la huella que en B no
    // puede aparecer.
    expect(tokensLeidos).toEqual([AGENCIA]);
    expect(secretosLeidos).toEqual([AGENCIA]);
    expect(aRefrescar()).toHaveLength(1);
    expect(refrescosGuardados).toEqual([AGENCIA]);

    // Las dos consultas de datos, con el token de la agencia y la property de A.
    expect(aGoogleDatos()).toHaveLength(2);
    for (const s of aGoogleDatos()) expect(s.autorizacion).toBe(`Bearer ${ACCESO_NUEVO}`);
    const enviadas = propertiesEnviadas().join("\n");
    expect(enviadas).toContain(SITIO_A);
    expect(enviadas).toContain(GA4_A);
    expect(enviadas).not.toContain(SITIO_AGENCIA);
    expect(enviadas).not.toContain("999999999");

    expect(rep!.dataSourceHealth.searchConsole).toBe("live");
    expect(rep!.dataSourceHealth.ga4).toBe("live");
    // Los números de A llegan a SU reporte. Es lo que le da dientes a la
    // afirmación contraria en el de B, más abajo.
    expect(rep!.kpis.map((k) => k.currentValue)).toEqual(expect.arrayContaining(["9", "7"]));
    // Y la sonda queda a nombre de A, sobre las properties de A.
    expect(sondas.map((s) => [s.organization_id, s.property_ref]).sort()).toEqual(
      [
        [CLIENTE_A, GA4_A],
        [CLIENTE_A, SITIO_A],
      ].sort()
    );
  });
});

describe("el fallback: B, sembrada sin token y sin mapeo", () => {
  it("no resuelve el token de la agencia, no llama a Google, y dice «sin conectar»", async () => {
    miembroDe = [CLIENTE_B];

    const rep = await reporteDe(CLIENTE_B);

    // Ni el estado, ni el secreto, ni el refresco: el token de la agencia no se
    // tocó. Antes de la regla, este reporte leía el secreto de la agencia y lo
    // refrescaba contra Google sin haber nada que consultar.
    expect(tokensLeidos).toEqual([]);
    expect(secretosLeidos).toEqual([]);
    expect(refrescosGuardados).toEqual([]);
    expect(salidas, "salió algo a Google por una organización sin mapeo").toEqual([]);

    expect(rep!.dataSourceHealth.searchConsole).toBe("missing");
    expect(rep!.dataSourceHealth.ga4).toBe("missing");
    expect(rep!.dataSourceHealth.gbp).toBe("missing");
    expect(sondas).toEqual([]);
  });

  it("y el reporte de B no trae los números de A ni los de la agencia", async () => {
    // Primero A, para que haya números de A dando vueltas si algo los cachea o
    // los reusa; después B.
    miembroDe = [CLIENTE_A];
    await reporteDe(CLIENTE_A);
    salidas = [];
    secretosLeidos = [];
    miembroDe = [CLIENTE_B];

    const rep = await reporteDe(CLIENTE_B);

    expect(salidas).toEqual([]);
    expect(secretosLeidos).toEqual([]);
    const valores = rep!.kpis.map((k) => k.currentValue);
    expect(valores).not.toContain("9"); // los clics de A
    expect(valores).not.toContain("7"); // las sesiones de A
  });
});

describe("a mitad del alta: lo que no está mapeado no se completa con lo de la agencia", () => {
  it("C con sólo GA4: el token se presta para SU GA4, y Search Console no se consulta", async () => {
    // C tiene un mapeo, así que el token de la agencia SÍ se le presta — para
    // lo que tiene. `GOOGLE_SEARCH_CONSOLE_SITE_URL` está puesta con el sitio
    // de la agencia: un «si no está mapeado, usá el de la variable» metería los
    // clics de la agencia en el reporte de C, con el token de la agencia.
    miembroDe = [CLIENTE_C];

    const rep = await reporteDe(CLIENTE_C);

    expect(secretosLeidos).toEqual([AGENCIA]);
    expect(aGoogleDatos()).toHaveLength(1);
    expect(propertiesEnviadas()[0]).toContain(GA4_C);
    expect(aGoogleDatos().some((s) => s.url.includes("searchconsole"))).toBe(false);
    expect(rep!.dataSourceHealth.ga4).toBe("live");
    expect(rep!.dataSourceHealth.searchConsole).toBe("missing");
  });
});

describe("la agencia misma: se sirve con SUS mapeos, nunca con los de un cliente", () => {
  it("un operador miembro de la agencia Y de A: el reporte de la agencia lleva sólo su sitio", async () => {
    // Bajo la RLS, este usuario ve los mapeos de las dos organizaciones. El
    // reporte de la agencia tiene que pedir el suyo y nada más.
    miembroDe = [AGENCIA, CLIENTE_A];

    const rep = await reporteDe(AGENCIA);

    const enviadas = propertiesEnviadas().join("\n");
    expect(enviadas).toContain(SITIO_AGENCIA);
    expect(enviadas).not.toContain(SITIO_A);
    expect(enviadas).not.toContain(GA4_A);
    // GA4 de la agencia no está mapeado: no se consulta, aunque A tenga uno y
    // la variable `GA4_PROPERTY_ID` esté puesta.
    expect(aGoogleDatos().some((s) => s.url.includes("analyticsdata"))).toBe(false);
    expect(rep!.dataSourceHealth.ga4).toBe("missing");
    expect(sondas.every((s) => s.organization_id === AGENCIA)).toBe(true);
  });

  it("y el mismo operador pidiendo el reporte de B: nada de A ni de la agencia", async () => {
    miembroDe = [AGENCIA, CLIENTE_A, CLIENTE_B];

    await reporteDe(CLIENTE_B);

    expect(salidas).toEqual([]);
    expect(secretosLeidos).toEqual([]);
  });
});
