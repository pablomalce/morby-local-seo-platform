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
 * POR QUÉ LAS TRES FUENTES DAN `error` CUANDO TODO ESTÁ EN ORDEN
 *
 * Porque el cliente HTTP de Search Console y GA4 no existe todavía: es F2 y
 * depende del OAuth, que está trabado. Con las precondiciones cumplidas el
 * reporte no consiguió el dato, y eso es lo que dice.
 *
 * Las otras dos opciones son peores y conviene dejar escrito por qué. `live`
 * afirmaría cifras que nadie trajo. `missing` diría «conectá esto» sobre una
 * integración conectada y mapeada, que es el defecto que arregló el #46 leído al
 * revés — y reintroducirlo desde el otro lado sería peor que no haber tocado
 * nada, porque ahora habría un mecanismo entero dando la respuesta equivocada.
 *
 * El día que el cliente exista, esta expectativa cambia a `live` o a lo que
 * `statusForOutcome()` devuelva. Que cambie es la señal de que la costura se
 * usó, no de que este test estaba mal.
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
  vi.resetModules();
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

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
    // Y tampoco `live`: nadie trajo un dato. Ver el encabezado.
    expect(rep!.dataSourceHealth.ga4).toBe("error");
    expect(rep!.dataSourceHealth.searchConsole).toBe("error");
    expect(rep!.dataSourceHealth.gbp).toBe("error");
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
