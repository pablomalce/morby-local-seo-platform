/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el resolvedor de fuentes exista y nadie lo llame.
 *
 * `sources.test.ts` prueba la decisión: qué estado y qué razón corresponden a
 * cada combinación de plataforma y mapeo. Lo que NO puede probar es que el
 * reporte la use — y ése es exactamente el defecto que este proyecto ya se comió
 * en la ruta de leads del Lead Engine: treinta y un tests de un módulo que nadie
 * invocaba, todos en verde.
 *
 * Un resolvedor perfecto al lado de un `"missing"` escrito a mano es lo mismo
 * que no haber escrito nada, y se lee igual de bien.
 *
 * LA EXPECTATIVA QUE CAMBIÓ, Y POR QUÉ ESO ERA LA SEÑAL
 *
 * Hasta el cliente HTTP, este archivo afirmaba que las tres fuentes daban
 * `error` con todo en orden: las precondiciones se cumplían y nadie había traído
 * el dato. Decía, textual, que el día que el cliente existiera la expectativa
 * cambiaría a `live`, y que ese cambio sería la señal de que la costura se usó y
 * no de que el test estaba mal.
 *
 * Ese día es hoy. Con token vivo y Google contestando, Search Console y GA4 dan
 * `live` y sus números llegan al reporte. Lo que NO cambió es todo lo demás: sin
 * credenciales de plataforma, sin mapeo, o sin token, siguen diciendo lo que
 * decían y por los mismos motivos.
 *
 * Google Business Profile sigue en `error` con todo mapeado, y eso también es a
 * propósito: su API no tiene cuota aprobada, así que no hay llamada — y decir
 * `live` sin haber preguntado sería la respuesta correcta por el motivo
 * equivocado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` explota fuera de un React Server Component. Es un centinela de
// build, no lógica: se neutraliza para poder ejercitar el módulo.
vi.mock("server-only", () => ({}));

const lookupPageSpeed = vi.fn();
const lookupPlace = vi.fn();
vi.mock("@/lib/integrations/google/pagespeed", () => ({ lookupPageSpeed }));
vi.mock("@/lib/integrations/google/places", () => ({ lookupPlace }));

const ORG = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00";
const NEGOCIO = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c11";

/** Las filas que `integration_properties` devuelve. Cada test la define. */
let filasDeMapeo: { provider: string; property_ref: string }[] = [];
/** Un fallo de lectura del mapeo, cuando el test lo pide. */
let errorDeMapeo: { message: string } | null = null;
/** Hay sesión, o el reporte es de demostración. */
let haySesion = true;
/** Cada consulta que se hizo, para poder afirmar que el mapeo se pidió y CÓMO. */
let consultas: { tabla: string; filtros: Record<string, unknown> }[] = [];

const NEGOCIO_EN_BASE = {
  id: NEGOCIO,
  organization_id: ORG,
  name: "Cliente de prueba",
  website: "https://ejemplo.test",
  industry: "other",
  brand_tone: "",
  primary_locale: "es",
  value_proposition: "",
  logo_color: "#EF4C24",
  created_at: "2026-01-01T00:00:00.000Z",
};

/**
 * Un doble de Supabase por TABLA, y no uno solo encadenable para todas.
 *
 * El orquestador le pide siete tablas distintas en una sola generación, y un
 * doble que conteste lo mismo a todas haría que `integration_properties`
 * devolviera las filas de `businesses` — o peor, que devolviera lo correcto por
 * casualidad y el test pasara sin que la consulta al mapeo se haya hecho nunca.
 * `consultas` es lo que cierra ese agujero: dice qué se pidió, no sólo qué se
 * contestó.
 */
const createSupabaseServerClient = vi.fn(async () => ({
  auth: {
    getUser: async () => ({ data: { user: haySesion ? { id: "u" } : null } }),
  },
  from(tabla: string) {
    const filtros: Record<string, unknown> = {};
    const registrar = () => consultas.push({ tabla, filtros: { ...filtros } });

    const respuesta = () => {
      if (tabla === "integration_properties") {
        return { data: errorDeMapeo ? null : filasDeMapeo, error: errorDeMapeo };
      }
      if (tabla === "businesses") return { data: NEGOCIO_EN_BASE, error: null };
      return { data: [], error: null };
    };

    const encadenable = {
      select: () => encadenable,
      eq: (col: string, val: unknown) => {
        filtros[col] = val;
        registrar();
        return encadenable;
      },
      is: (col: string, val: unknown) => {
        filtros[col] = val;
        registrar();
        return Promise.resolve(respuesta());
      },
      single: async () => respuesta(),
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async () => ({ data: null, error: null }),
      insert: async () => ({ data: null, error: null }),
      // El orquestador hace `await supabase.from(x).select().eq()` para las
      // colecciones: el encadenable tiene que ser esperable.
      then: (resolver: (v: unknown) => unknown) => Promise.resolve(respuesta()).then(resolver),
    };
    return encadenable;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

/**
 * El token de la agencia, del lado del servicio.
 *
 * Va por el cliente ADMIN y no por el de sesión, y eso no es un detalle del
 * doble: es la decisión de `agencyToken.ts`. Quien mira un reporte puede no ser
 * miembro de la organización de la agencia, así que leerlo como el usuario
 * devolvería cero filas y diría «no hay token» sobre uno que anda.
 */
let tokenVivo: { expires_at: string; revoked_at: string | null } | null = null;
let estadoDelToken = "active";
let secretoGuardado: string | null = null;

const createSupabaseAdminClient = vi.fn(() => ({
  from: () => {
    const encadenable = {
      select: () => encadenable,
      eq: () => encadenable,
      order: () => encadenable,
      limit: async () => ({ data: tokenVivo ? [tokenVivo] : [], error: null }),
    };
    return encadenable;
  },
  rpc: async (fn: string) => {
    if (fn === "integration_token_state") return { data: estadoDelToken, error: null };
    if (fn === "integration_token_secret") return { data: secretoGuardado, error: null };
    return { data: null, error: null };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

async function generar() {
  const { generateReport } = await import("@/lib/reports/orchestrator");
  return generateReport({ businessId: NEGOCIO, locale: "es" });
}

/** Las consultas que se hicieron contra el mapeo. */
const consultasAlMapeo = () => consultas.filter((c) => c.tabla === "integration_properties");

beforeEach(() => {
  filasDeMapeo = [];
  errorDeMapeo = null;
  haySesion = true;
  consultas = [];
  lookupPageSpeed.mockReset();
  lookupPlace.mockReset();
  lookupPlace.mockResolvedValue({ status: "no-match" });
  lookupPageSpeed.mockResolvedValue({ status: "missing-key" });
  // Sin credenciales por defecto: es el estado real de la plataforma hoy, y un
  // test que arranque desde el estado que no existe mide otro sistema.
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PAGESPEED_API_KEY;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.VULKAN_AGENCY_ORG_ID;
  tokenVivo = null;
  estadoDelToken = "active";
  secretoGuardado = null;
  llamadasAGoogle = [];
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.VULKAN_AGENCY_ORG_ID;
  vi.unstubAllGlobals();
});

/** Cada URL que se le pidió a Google. Es lo que dice si se llamó, y a quién. */
let llamadasAGoogle: string[] = [];

/** La plataforma entera conectada: credenciales, agencia, token vivo y secreto. */
function plataformaConectada() {
  process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
  process.env.GOOGLE_REDIRECT_URI = "https://ejemplo.test/api/auth/google/callback";
  process.env.VULKAN_AGENCY_ORG_ID = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
  tokenVivo = { expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null };
  estadoDelToken = "active";
  secretoGuardado = JSON.stringify({
    refresh_token: "REFRESCO-sintetico",
    access_token: "ACCESO-sintetico",
  });
}

/** Google contestando bien a las dos consultas. */
function googleContesta(cuerpos: { searchConsole?: unknown; ga4?: unknown } = {}) {
  vi.stubGlobal("fetch", async (url: string) => {
    llamadasAGoogle.push(String(url));
    const esSearchConsole = String(url).includes("searchconsole.googleapis.com");
    const cuerpo = esSearchConsole
      ? (cuerpos.searchConsole ?? {
          rows: [{ clicks: 128, impressions: 4021, ctr: 0.0318, position: 8.4 }],
        })
      : (cuerpos.ga4 ?? {
          metricHeaders: [{ name: "sessions" }, { name: "conversions" }],
          rows: [{ metricValues: [{ value: "512" }, { value: "17" }] }],
        });
    return { ok: true, status: 200, json: async () => cuerpo } as unknown as Response;
  });
}

describe("las tres fuentes de Google salen del mapeo, no de una palabra", () => {
  it("pide el mapeo vivo de la organización del reporte", async () => {
    // La afirmación del cableado. Sin esto, todo lo demás de este archivo puede
    // pasar con el `"missing"` escrito a mano de vuelta en su lugar.
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";

    await generar();

    const alMapeo = consultasAlMapeo();
    expect(alMapeo.length, "no se consultó integration_properties").toBeGreaterThan(0);
    const ultima = alMapeo[alMapeo.length - 1];
    expect(ultima.filtros.organization_id).toBe(ORG);
    // Los desmapeados son registro, no configuración: leer uno muerto es
    // atribuirle a un cliente una property que ya no es suya.
    expect(ultima.filtros.unmapped_at).toBeNull();
  });

  it("con la plataforma conectada y el cliente mapeado, deja de decir «sin conectar»", async () => {
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    filasDeMapeo = [
      { provider: "ga4", property_ref: "properties/123456789" },
      { provider: "search_console", property_ref: "https://ejemplo.test/" },
      { provider: "google_business_profile", property_ref: "locations/123456789" },
    ];

    const rep = await generar();

    expect(rep!.dataSourceHealth.ga4).not.toBe("missing");
    expect(rep!.dataSourceHealth.searchConsole).not.toBe("missing");
    expect(rep!.dataSourceHealth.gbp).not.toBe("missing");
    // Y tampoco `live`: acá falta `VULKAN_AGENCY_ORG_ID`, así que no se sabe a
    // quién pertenece el token — y eso NO dice nada del token, que puede estar
    // vivo. Es `error` por la misma razón por la que `agency.ts` no llama
    // `absent` a `unset`.
    expect(rep!.dataSourceHealth.ga4).toBe("error");
    expect(rep!.dataSourceHealth.searchConsole).toBe("error");
    expect(rep!.dataSourceHealth.gbp).toBe("error");
  });

  it("con token vivo y Google contestando, las dos fuentes están VIVAS", async () => {
    plataformaConectada();
    googleContesta();
    filasDeMapeo = [
      { provider: "ga4", property_ref: "properties/123456789" },
      { provider: "search_console", property_ref: "https://ejemplo.test/" },
      { provider: "google_business_profile", property_ref: "locations/123456789" },
    ];

    const rep = await generar();

    expect(rep!.dataSourceHealth.searchConsole).toBe("live");
    expect(rep!.dataSourceHealth.ga4).toBe("live");
    // Y GBP no: su API no tiene cuota, así que no hubo llamada. Decir `live`
    // sobre una fuente que nadie consultó es lo que este archivo impide.
    expect(rep!.dataSourceHealth.gbp).toBe("error");

    expect(llamadasAGoogle.some((u) => u.includes("searchconsole.googleapis.com"))).toBe(true);
    expect(llamadasAGoogle.some((u) => u.includes("analyticsdata.googleapis.com"))).toBe(true);
    expect(llamadasAGoogle.some((u) => u.includes("mybusiness"))).toBe(false);
  });

  it("y los números llegan al reporte, que es la puerta de F2", async () => {
    plataformaConectada();
    googleContesta();
    filasDeMapeo = [
      { provider: "ga4", property_ref: "properties/123456789" },
      { provider: "search_console", property_ref: "https://ejemplo.test/" },
    ];

    const rep = await generar();

    const etiquetas = rep!.kpis.map((k) => k.currentValue);
    expect(etiquetas, "los clics de Search Console no llegaron").toContain("128");
    expect(etiquetas, "la posición media no llegó").toContain("8.4");
    expect(etiquetas, "las sesiones de GA4 no llegaron").toContain("512");
    expect(etiquetas, "las conversiones de GA4 no llegaron").toContain("17");
  });

  it("una property sin tráfico son ceros de verdad, y una consulta rota no", async () => {
    plataformaConectada();
    googleContesta({ searchConsole: {}, ga4: { rows: [{ metricValues: [] }] } });
    filasDeMapeo = [
      { provider: "ga4", property_ref: "properties/123456789" },
      { provider: "search_console", property_ref: "https://ejemplo.test/" },
    ];

    const rep = await generar();

    // Search Console sin `rows` es una property sin tráfico: `live` con ceros.
    expect(rep!.dataSourceHealth.searchConsole).toBe("live");
    expect(rep!.kpis.map((k) => k.currentValue)).toContain("0");
    // GA4 con filas y sin encabezados es un cuerpo que no se entiende: `error`,
    // y NINGÚN número. Un cero inventado se suma; un fallo se ve.
    expect(rep!.dataSourceHealth.ga4).toBe("error");
  });

  it("un 401 de Google es `error` y nunca «sin conectar»", async () => {
    plataformaConectada();
    vi.stubGlobal("fetch", async (url: string) => {
      llamadasAGoogle.push(String(url));
      return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
    });
    filasDeMapeo = [{ provider: "search_console", property_ref: "https://ejemplo.test/" }];

    const rep = await generar();

    // Hay credenciales, se mandaron, y Google las rechazó. `missing` diría
    // «conectá esto» sobre una integración conectada — el defecto del #46.
    expect(rep!.dataSourceHealth.searchConsole).toBe("error");
  });

  it("sin token de agencia no se llama a Google, y el motivo no es un fallo", async () => {
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    process.env.GOOGLE_REDIRECT_URI = "https://ejemplo.test/api/auth/google/callback";
    process.env.VULKAN_AGENCY_ORG_ID = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
    tokenVivo = null; // la agencia existe y no hizo el OAuth todavía
    googleContesta();
    filasDeMapeo = [{ provider: "search_console", property_ref: "https://ejemplo.test/" }];

    const rep = await generar();

    expect(llamadasAGoogle).toHaveLength(0);
    // `missing` y no `error`: no hay credenciales que mandar, que es el único
    // caso que `status.ts` deja llamar así.
    expect(rep!.dataSourceHealth.searchConsole).toBe("missing");
  });

  it("un token revocado tampoco llama, y se distingue de uno ilegible", async () => {
    plataformaConectada();
    estadoDelToken = "revoked";
    googleContesta();
    filasDeMapeo = [{ provider: "search_console", property_ref: "https://ejemplo.test/" }];

    const rep = await generar();

    expect(llamadasAGoogle).toHaveLength(0);
    expect(rep!.dataSourceHealth.searchConsole).toBe("missing");
  });

  it("un secreto guardado que no se puede leer es `error`, no «sin conectar»", async () => {
    plataformaConectada();
    secretoGuardado = "{esto no es json";
    googleContesta();
    filasDeMapeo = [{ provider: "search_console", property_ref: "https://ejemplo.test/" }];

    const rep = await generar();

    expect(llamadasAGoogle).toHaveLength(0);
    // El token puede estar perfectamente vivo del lado de Google: lo que se
    // rompió es nuestra manera de guardarlo, y mandar a reconectar por eso hace
    // rehacer un OAuth que estaba bien.
    expect(rep!.dataSourceHealth.searchConsole).toBe("error");
  });

  it("mapea cada superficie por separado, no todas de una", async () => {
    // A mitad de un onboarding esto es lo normal, y es donde un `length > 0`
    // daría las tres por listas.
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    filasDeMapeo = [{ provider: "ga4", property_ref: "properties/123456789" }];

    const rep = await generar();

    expect(rep!.dataSourceHealth.ga4).toBe("error");
    expect(rep!.dataSourceHealth.searchConsole).toBe("missing");
    expect(rep!.dataSourceHealth.gbp).toBe("missing");
  });

  it("sin credenciales de plataforma dice «sin conectar» aunque el mapeo esté completo", async () => {
    filasDeMapeo = [
      { provider: "ga4", property_ref: "properties/123456789" },
      { provider: "search_console", property_ref: "https://ejemplo.test/" },
    ];

    const rep = await generar();

    expect(rep!.dataSourceHealth.ga4).toBe("missing");
    expect(rep!.dataSourceHealth.searchConsole).toBe("missing");
  });

  it("un fallo al leer el mapeo no tumba el reporte", async () => {
    // Las otras dos fuentes y el motor entero siguen sirviendo. La pérdida
    // aceptada está escrita en `readPropertyMappings`: las tres salen como si no
    // hubiera mapeo, que es menos preciso y no es falso.
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    errorDeMapeo = { message: "la lectura falló" };

    const rep = await generar();

    expect(rep, "el reporte se cayó entero por una integración").not.toBeNull();
    expect(rep!.dataSourceHealth.ga4).toBe("missing");
  });

  it("en modo demostración no pregunta por el mapeo de nadie", async () => {
    // Sin sesión no hay organización, así que no hay mapeo que leer — y una
    // consulta igual sería una consulta por tenant nulo contra una tabla cuyo
    // eje es el tenant.
    haySesion = false;
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    const { businesses } = await import("@/lib/mock/universal");
    const { generateReport } = await import("@/lib/reports/orchestrator");

    const rep = await generateReport({ businessId: businesses[0].id, locale: "es" });

    expect(consultasAlMapeo()).toHaveLength(0);
    expect(rep!.dataSourceHealth.ga4).toBe("missing");
  });
});
