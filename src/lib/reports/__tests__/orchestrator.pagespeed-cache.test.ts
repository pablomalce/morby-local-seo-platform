/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Seis cosas, y las seis cuestan plata o mienten:
 *
 * 1. QUE EL CACHÉ DEJE DE AHORRAR. PageSpeed comparte cuota y es lento (15-40 s).
 *    Si una entrada fresca deja de servirse, cada reporte vuelve a pegarle a la
 *    API. Eso no rompe nada visible: el reporte sale igual, sólo que más lento y
 *    consumiendo cuota. Es el tipo de regresión que nadie nota hasta que llega
 *    la factura o el rate limit.
 *
 * 2. QUE EL CACHÉ DEJE DE VENCER. El espejo del anterior, y peor: si una entrada
 *    vencida se sigue sirviendo, el reporte muestra métricas viejas como si
 *    fueran de hoy. Nadie se entera nunca. Incluye la fila con `fetched_at` en el
 *    FUTURO: hasta la `0030` cualquiera la escribía, y con el año 2999 la cuenta
 *    de la edad da negativo y la fila queda «fresca» para siempre.
 *
 * 3. QUE UN FALLO SE CACHEE O SE DISFRACE. Si un error de la API se guarda en
 *    `pagespeed_cache`, queda envenenado 24 h. Y si se reporta como algo
 *    distinto de "error", el usuario lee cifras sintéticas creyendo que son
 *    reales. El orchestrator sólo debe cachear resultados BUENOS.
 *
 * 4. QUE EL CACHÉ VUELVA A PASAR POR LA SESIÓN (la `0030`). Medido en producción
 *    el 2026-10-06: con la sesión de por medio, la tabla tenía que estar abierta
 *    a `anon` para leer —la lista de URLs de los clientes— y a `authenticated`
 *    para escribir, con el alta abierta: cualquiera envenenaba el reporte de un
 *    cliente por 24 h. La `0030` se la saca a los dos, así que acá la SESIÓN
 *    contesta lo que contestaría esa base —42501 en `pagespeed_cache`— y el
 *    caché sólo anda por el cliente de servicio. Volver a la sesión no tira
 *    nada: el caché deja de servir y deja de guardar, en silencio, y por eso hay
 *    tests que lo dicen con todas las letras. Y como un fallo de caché sigue sin
 *    tumbar el reporte pero ya no se traga, también se mide que quede en el log
 *    con el código y sin el mensaje.
 *
 * 5. QUE EL CACHÉ CRUCE ORGANIZACIONES. Con el servidor como único lector y la
 *    clave por URL sola, una cuenta recién registrada le preguntaba AL SERVIDOR
 *    por la URL de un cliente ajeno y el servidor le contestaba desde la caché
 *    del cliente: sin Google, en milisegundos, con el `fetchedAt` del último
 *    reporte del cliente. Medido el 2026-10-07 por `clientSnapshot` y por un
 *    negocio propio con esa web. La clave es `(organization_id, url, strategy)`,
 *    y sin organización —demo, `clientSnapshot`— no hay caché.
 *
 * 6. QUE EL DOBLE MIENTA SOBRE LA CLAVE. El doble anterior del cliente de
 *    servicio ignoraba los argumentos de `eq()` y las opciones de `upsert()`, y
 *    dos mutaciones con consecuencia real vivían con la suite entera en verde:
 *    sacar el filtro por URL (con una fila en la tabla, el reporte de CUALQUIER
 *    sitio servía los números de otro) y `ignoreDuplicates: true` (la fila
 *    vencida no se renovaba nunca). El doble de abajo es una tabla de verdad:
 *    filtra por lo que se le pide, choca por la clave primaria de la `0030`, y
 *    rechaza un `onConflict` que no sea esa clave como lo haría PostgreSQL
 *    (42P10).
 *
 * NO se toca Supabase ni la red: todo va con dobles. Eso tiene un límite que hay
 * que decir en voz alta — R9: verificar por la vía real. Estos tests prueban la
 * LÓGICA del caché, QUÉ CLIENTE usa y CON QUÉ CLAVE, no que la tabla le niegue
 * algo a alguien: eso lo miden los bloques 136 a 143 de
 * `supabase/qa/defects_test.sql`, contra el esquema de verdad. La excepción es
 * el test del modo demo, que usa el `createSupabaseAdminClient` REAL sin
 * variables, con `fetch` espiado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_SOURCE_LABELS } from "@/lib/reports/dataSources";

// `server-only` explota fuera de un React Server Component. Es un centinela de
// build, no lógica: se neutraliza para poder ejercitar el módulo.
vi.mock("server-only", () => ({}));

const lookupPageSpeed = vi.fn();
const lookupPlace = vi.fn();
vi.mock("@/lib/integrations/google/pagespeed", () => ({ lookupPageSpeed }));
vi.mock("@/lib/integrations/google/places", () => ({ lookupPlace }));

type ErrorDePostgrest = { code?: string; message: string };

const ORG = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00";
const OTRA_ORG = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1b00";
const NEGOCIO = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c11";
const WEB = "https://cliente-de-la-agencia.test";
/** La clave primaria de `pagespeed_cache` desde la `0030`. */
const CLAVE = "organization_id,url,strategy";

/** El negocio que la sesión lee de `businesses`, bajo su RLS. */
const NEGOCIO_EN_BASE = {
  id: NEGOCIO,
  organization_id: ORG,
  name: "Cliente de prueba",
  website: WEB,
  industry: "other",
  brand_tone: "",
  primary_locale: "es",
  value_proposition: "",
  logo_color: "#EF4C24",
  created_at: "2026-01-01T00:00:00.000Z",
};

/** Hay sesión, y la sesión ve el negocio pedido. */
let haySesion = true;
let negocioVisible = true;
/** Cada vez que la SESIÓN tocó pagespeed_cache. Desde la 0030 no pasa nunca. */
let tocadasPorSesion: string[] = [];

/** Lo que la base de la 0030 le contesta a una sesión que toca la caché. */
const DENEGADO: ErrorDePostgrest = {
  code: "42501",
  message: "permission denied for table pagespeed_cache",
};

const createSupabaseServerClient = vi.fn(async () => ({
  auth: { getUser: async () => ({ data: { user: haySesion ? { id: "u" } : null } }) },
  from(tabla: string) {
    if (tabla === "pagespeed_cache") {
      const cache = {
        select: () => {
          tocadasPorSesion.push("select");
          return cache;
        },
        eq: () => cache,
        maybeSingle: async () => ({ data: null, error: DENEGADO }),
        upsert: async () => {
          tocadasPorSesion.push("upsert");
          return { data: null, error: DENEGADO };
        },
      };
      return cache;
    }
    const respuesta = () => {
      if (tabla === "businesses") return { data: negocioVisible ? NEGOCIO_EN_BASE : null, error: null };
      return { data: [], error: null };
    };
    const encadenable = {
      select: () => encadenable,
      eq: () => encadenable,
      is: async () => respuesta(),
      single: async () => respuesta(),
      maybeSingle: async () => ({ data: null, error: null }),
      insert: async () => ({ data: null, error: null }),
      // El orquestador hace `await supabase.from(x).select().eq()` para las
      // colecciones: el encadenable tiene que ser esperable.
      then: (resolver: (v: unknown) => unknown) => Promise.resolve(respuesta()).then(resolver),
    };
    return encadenable;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

type FilaDeCache = {
  organization_id: string;
  url: string;
  strategy: string;
  result: unknown;
  fetched_at: string;
};

/** La tabla `pagespeed_cache`, del lado del cliente de servicio. */
let tabla: FilaDeCache[] = [];
/** Los filtros de cada LECTURA de la caché por el cliente de servicio. */
let lecturas: Record<string, unknown>[] = [];
/** Cada upsert a la caché por el cliente de servicio, con sus opciones. */
let upserts: { fila: Record<string, unknown>; opciones: unknown }[] = [];
/** Lo que el cliente de servicio contesta al leer o escribir, cuando el test pide un fallo. */
let errorDeLectura: ErrorDePostgrest | null = null;
let errorDeEscritura: ErrorDePostgrest | null = null;
/** El cliente de servicio TIRA al tocar la caché. */
let cacheTira = false;
/** El test del modo demo usa el cliente de servicio REAL, sin variables. */
let usarClienteDeServicioReal = false;
/** Cuántas veces se CREÓ un cliente de servicio, real o doble. */
let clientesDeServicio = 0;

/**
 * El doble del cliente de servicio. Para `pagespeed_cache` es una tabla con la
 * clave de la `0030`; para el resto —la sonda, el token de la agencia— contesta
 * neutro, porque acá no se mide eso.
 */
const createSupabaseAdminClient = vi.fn(() => ({
  from(nombre: string) {
    if (nombre !== "pagespeed_cache") {
      const neutro = {
        select: () => neutro,
        eq: () => neutro,
        order: () => neutro,
        limit: async () => ({ data: [], error: null }),
        upsert: async () => ({ data: null, error: null }),
      };
      return neutro;
    }
    if (cacheTira) throw new Error("el cliente de servicio tiró");
    const filtros: Record<string, unknown> = {};
    const consulta = {
      select: () => consulta,
      eq: (columna: string, valor: unknown) => {
        filtros[columna] = valor;
        return consulta;
      },
      maybeSingle: async () => {
        lecturas.push({ ...filtros });
        if (errorDeLectura) return { data: null, error: errorDeLectura };
        const halladas = tabla.filter((f) =>
          Object.entries(filtros).every(([c, v]) => f[c as keyof FilaDeCache] === v)
        );
        // Lo que contesta PostgREST a un maybeSingle con dos o más filas.
        if (halladas.length > 1) {
          return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
        }
        const fila = halladas[0];
        return { data: fila ? { result: fila.result, fetched_at: fila.fetched_at } : null, error: null };
      },
      upsert: async (fila: Record<string, unknown>, opciones?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        upserts.push({ fila, opciones });
        if (errorDeEscritura) return { data: null, error: errorDeEscritura };
        // PostgreSQL: un ON CONFLICT que no nombra una clave única no corre.
        if (opciones?.onConflict && opciones.onConflict !== CLAVE) {
          return { data: null, error: { code: "42P10", message: "no unique constraint matching" } };
        }
        const columnas = CLAVE.split(",") as (keyof FilaDeCache)[];
        const existente = tabla.find((f) => columnas.every((c) => f[c] === fila[c]));
        if (!existente) tabla.push({ ...(fila as FilaDeCache) });
        else if (!opciones?.ignoreDuplicates) Object.assign(existente, fila);
        return { data: null, error: null };
      },
    };
    return consulta;
  },
  rpc: async () => ({ data: null, error: null }),
}));
vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/supabase/admin")>();
  return {
    createSupabaseAdminClient: () => {
      clientesDeServicio++;
      return usarClienteDeServicioReal ? real.createSupabaseAdminClient() : createSupabaseAdminClient();
    },
  };
});

const AHORA = new Date("2026-08-18T12:00:00.000Z");
const HORA = 60 * 60 * 1000;
const VITALS_BUENOS = {
  lcp: 2100,
  inp: 180,
  cls: 0.05,
  lighthouseScore: 88,
  fetchedAt: "2026-08-18T00:00:00.000Z",
};
/**
 * Lo que `lookupPageSpeed` devuelve junto al resultado. Con organización, el
 * orquestador lo lee para la sonda (`describirFallo`), así que el doble lo trae.
 */
const OK = { kind: "ok" } as const;
/** Lo que contesta Google en los tests que tienen que distinguirlo de lo cacheado. */
const DE_GOOGLE = { lcp: 3456, inp: 321, cls: 0.17, lighthouseScore: 63, fetchedAt: "2026-08-18T11:59:30.000Z" };

/** Una fila de la caché, por defecto la de este negocio, de hace una hora. */
function fila(cambios: Partial<FilaDeCache> = {}): FilaDeCache {
  return {
    organization_id: ORG,
    url: WEB,
    strategy: "mobile",
    result: VITALS_BUENOS,
    fetched_at: new Date(AHORA.getTime() - 1 * HORA).toISOString(),
    ...cambios,
  };
}

/** El reporte del negocio de la base, con sesión: el único camino con caché. */
async function generar() {
  const { generateReport } = await import("@/lib/reports/orchestrator");
  return generateReport({ businessId: NEGOCIO, locale: "es" });
}

/** Un negocio semilla, para el reporte de demostración. */
async function negocioSemilla() {
  const { businesses } = await import("@/lib/mock/universal");
  return businesses[0];
}

/** Lo que se escribió en el log con el prefijo del caché. */
let avisos: ReturnType<typeof vi.spyOn>;
const avisosDelCache = () =>
  avisos.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith("[pagespeed-cache]"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  haySesion = true;
  negocioVisible = true;
  tocadasPorSesion = [];
  tabla = [];
  lecturas = [];
  upserts = [];
  errorDeLectura = null;
  errorDeEscritura = null;
  cacheTira = false;
  usarClienteDeServicioReal = false;
  clientesDeServicio = 0;
  lookupPageSpeed.mockReset();
  lookupPlace.mockReset();
  // Places siempre neutro: acá se prueba PageSpeed.
  lookupPlace.mockResolvedValue({ status: "no-match" });
  process.env.GOOGLE_PAGESPEED_API_KEY = "clave-de-prueba";
  process.env.GOOGLE_PLACES_API_KEY = "clave-de-prueba";
  avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  avisos.mockRestore();
});

describe("caché de PageSpeed — 24 h", () => {
  it("con una entrada FRESCA no llama a la API, y sirve lo cacheado", async () => {
    tabla = [fila()];

    const rep = await generar();

    // Esta es la aserción que ahorra plata. Si cae, cada reporte gasta cuota.
    expect(lookupPageSpeed).not.toHaveBeenCalled();
    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    expect(rep?.state.webVitals).toEqual(VITALS_BUENOS);
  });

  it("con una entrada VENCIDA sí llama a la API", async () => {
    tabla = [fila({ fetched_at: new Date(AHORA.getTime() - 25 * HORA).toISOString() })];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS, outcome: OK });

    await generar();

    // Si cae, servimos métricas viejas como si fueran de hoy, para siempre.
    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
  });

  it("a las 24 h exactas ya está vencida", async () => {
    // El borde. La condición es `ahora - fetched_at < TTL`, así que exactamente
    // 24 h NO es fresca. Un `<=` acá alarga el caché un instante; lo que importa
    // es que el borde esté cubierto y que nadie lo cambie sin querer.
    tabla = [fila({ fetched_at: new Date(AHORA.getTime() - 24 * HORA).toISOString() })];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS, outcome: OK });

    await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
  });

  it("sin entrada en el caché llama a la API y guarda el resultado bueno", async () => {
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS, outcome: OK });

    await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(upserts).toHaveLength(1);
    expect(tabla).toHaveLength(1);
  });

  it("una entrada VENCIDA se RENUEVA con lo que contestó Google, no se deja como estaba", async () => {
    // Con `ignoreDuplicates` el upsert es un ON CONFLICT DO NOTHING: la fila
    // vencida no se pisa nunca y, pasadas las primeras 24 h, cada reporte llama
    // a Google sin error ni log. Esto es lo que lo ve.
    tabla = [fila({ fetched_at: new Date(AHORA.getTime() - 25 * HORA).toISOString() })];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE, outcome: OK });

    await generar();

    expect(tabla).toEqual([fila({ result: DE_GOOGLE, fetched_at: DE_GOOGLE.fetchedAt })]);
  });
});

describe("caché de PageSpeed — una fila con fecha futura no se sirve", () => {
  it("un fetched_at en el año 2999 va a Google, se pisa, y queda en el log", async () => {
    // Lo que cualquier cuenta podía escribir antes de la 0030. Con la cuenta de
    // la edad sola, `ahora - 2999` es negativo, o sea «fresca», para siempre.
    const ENVENENADO = { lcp: 99999, inp: 9999, cls: 9, lighthouseScore: 1, fetchedAt: "2999-01-01T00:00:00.000Z" };
    tabla = [fila({ result: ENVENENADO, fetched_at: "2999-01-01T00:00:00.000Z" })];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE, outcome: OK });

    const rep = await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(rep?.state.webVitals).toEqual(DE_GOOGLE);
    expect(tabla).toEqual([fila({ result: DE_GOOGLE, fetched_at: DE_GOOGLE.fetchedAt })]);
    // Sin la URL: el log no es lugar para la lista de clientes.
    expect(avisosDelCache()).toEqual(["[pagespeed-cache] lectura: fetched_at futuro o ilegible, se ignora la fila"]);
  });

  it("un fetched_at ilegible tampoco se sirve", async () => {
    tabla = [fila({ fetched_at: "no-es-una-fecha" })];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE, outcome: OK });

    const rep = await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(rep?.state.webVitals).toEqual(DE_GOOGLE);
  });

  it("unos minutos en el futuro SÍ se sirve: es el margen para el reloj de otra instancia", async () => {
    // El control del primero: sin él, «toda fecha futura va a Google» pasaría
    // igual, y una instancia con el reloj adelantado un segundo vaciaría el
    // caché para las otras.
    tabla = [fila({ fetched_at: new Date(AHORA.getTime() + 4 * 60 * 1000).toISOString() })];

    const rep = await generar();

    expect(lookupPageSpeed).not.toHaveBeenCalled();
    expect(rep?.state.webVitals).toEqual(VITALS_BUENOS);
    expect(avisosDelCache()).toEqual([]);
  });
});

describe("caché de PageSpeed — un fallo no se cachea ni se disfraza", () => {
  it("NO guarda nada cuando la API falla", async () => {
    lookupPageSpeed.mockResolvedValue({ status: "error", outcome: { kind: "http", status: 500 } });

    await generar();

    // Cachear un fallo lo congela 24 h: el sitio se arregla y el reporte sigue
    // roto hasta el día siguiente.
    expect(upserts).toHaveLength(0);
  });

  it("reporta 'error' cuando la API falla — no 'live' ni 'missing'", async () => {
    lookupPageSpeed.mockResolvedValue({ status: "error", outcome: { kind: "http", status: 500 } });

    const rep = await generar();

    // "missing" significa "falta configurar la integración" y le diría al
    // usuario que conecte algo que ya está conectado. "live" sería directamente
    // presentar cifras sintéticas como reales.
    expect(rep?.dataSourceHealth.pagespeed).toBe("error");
  });

  it("el fallo llega hasta el texto que el usuario lee", async () => {
    lookupPageSpeed.mockResolvedValue({ status: "error", outcome: { kind: "http", status: 500 } });

    const rep = await generar();

    // El campo `pagespeed: "error"` no lo lee nadie: lo que se muestra es la
    // nota. Si el fallo no llega hasta ahí, para el usuario no ocurrió.
    // Con el nombre de producto, no con la clave del objeto: la nota es prosa
    // que lee el cliente. Esta aserción decía `"pagespeed"` y pasaba porque la
    // nota se armaba con las claves — clavaba el defecto, no el requisito.
    expect(rep?.dataSourceHealth.note).toContain(DATA_SOURCE_LABELS.pagespeed);
  });

  it("distingue 'sin API key' de 'la API falló'", async () => {
    lookupPageSpeed.mockResolvedValue({ status: "missing-key", outcome: { kind: "no-credentials" } });

    const rep = await generar();

    // Son dos problemas distintos con dos arreglos distintos: uno se resuelve
    // configurando, el otro reintentando o investigando.
    expect(rep?.dataSourceHealth.pagespeed).toBe("missing");
  });

  it("NO da 'live' si la respuesta viene sin lighthouseScore", async () => {
    // Respuesta a medias: status bueno, cuerpo incompleto. Es el caso que se
    // cuela cuando la API cambia de forma o responde parcialmente.
    lookupPageSpeed.mockResolvedValue({ status: "live", lcp: 2100, outcome: OK });

    const rep = await generar();

    expect(rep?.dataSourceHealth.pagespeed).not.toBe("live");
    expect(upserts).toHaveLength(0);
  });
});

describe("caché de PageSpeed — sólo el servidor la toca (0030)", () => {
  it("la LEE con el cliente de servicio, por la clave entera, y la sesión no la toca", async () => {
    tabla = [fila()];

    const rep = await generar();

    // Anti-vacuidad: hubo una lectura, y fue la que sirvió el reporte. Sin esto,
    // «la sesión no la tocó» pasaría también con un orquestador que no lee nada.
    expect(lecturas).toEqual([{ organization_id: ORG, url: WEB, strategy: "mobile" }]);
    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    // Con la sesión, la 0030 contesta 42501: el caché dejaría de servir sin
    // que nada se cayera, y cada reporte volvería a gastar cuota.
    expect(tocadasPorSesion).toEqual([]);
  });

  it("la ESCRIBE con el cliente de servicio, por la clave de la 0030, y lo que escribe es lo que contestó Google", async () => {
    // Números que no están en ninguna semilla: si la fila los lleva, salieron
    // de la respuesta de Google a este servidor y de ningún otro lado.
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE, outcome: OK });

    const rep = await generar();

    expect(lookupPageSpeed).toHaveBeenCalledWith({ url: WEB, strategy: "mobile" });
    expect(upserts).toEqual([
      {
        fila: { organization_id: ORG, url: WEB, strategy: "mobile", result: DE_GOOGLE, fetched_at: DE_GOOGLE.fetchedAt },
        opciones: { onConflict: CLAVE },
      },
    ]);
    expect(tocadasPorSesion).toEqual([]);
    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
  });

  it("una LECTURA que falla no tumba el reporte, va a Google, y queda en el log con el código", async () => {
    errorDeLectura = DENEGADO;
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS, outcome: OK });

    const rep = await generar();

    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(avisosDelCache()).toContain("[pagespeed-cache] lectura: 42501");
    // El mensaje puede nombrar tablas: al log va el código (la lección de #104).
    expect(avisos.mock.calls.flat().join(" ")).not.toContain(DENEGADO.message);
  });

  it("una ESCRITURA que falla no tumba el reporte, y queda en el log con el código", async () => {
    errorDeEscritura = DENEGADO;
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS, outcome: OK });

    const rep = await generar();

    expect(upserts).toHaveLength(1);
    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    expect(rep?.dataSourceHealth.pagespeed).not.toBe("error");
    expect(avisosDelCache()).toContain("[pagespeed-cache] escritura: 42501");
    expect(avisos.mock.calls.flat().join(" ")).not.toContain(DENEGADO.message);
  });

  it("con todo en orden, el caché no escribe nada en el log", async () => {
    // El control de los dos de arriba: si el aviso saliera siempre, «queda en el
    // log» no diría nada sobre un fallo.
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS, outcome: OK });

    await generar();

    expect(upserts).toHaveLength(1);
    expect(avisosDelCache()).toEqual([]);
  });

  it("un cliente de servicio que TIRA no se lleva el reporte, y el log lo dice", async () => {
    // Es el estado de un deploy sin `SUPABASE_SERVICE_ROLE_KEY`, del lado de la
    // caché: `createClient` tira, y el `try` de las dos funciones lo contiene.
    cacheTira = true;
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS, outcome: OK });

    const rep = await generar();

    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(avisosDelCache()).toEqual([
      "[pagespeed-cache] lectura: el cliente de servicio no se pudo crear o tiró",
      "[pagespeed-cache] escritura: el cliente de servicio no se pudo crear o tiró",
    ]);
  });
});

describe("caché de PageSpeed — cada organización con la suya (0030)", () => {
  it("la fila FRESCA de OTRA organización para la misma URL no se sirve, ni se toca", async () => {
    // El oráculo, desde el lado de quien pregunta: si esto se sirviera, el
    // reporte diría sin Google y en milisegundos que la URL es cliente de otro.
    const AJENA = fila({ organization_id: OTRA_ORG, result: { ...VITALS_BUENOS, lighthouseScore: 91 } });
    tabla = [AJENA];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE, outcome: OK });

    const rep = await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(rep?.state.webVitals).toEqual(DE_GOOGLE);
    expect(tabla).toEqual([AJENA, fila({ result: DE_GOOGLE, fetched_at: DE_GOOGLE.fetchedAt })]);
  });

  it("la fila fresca de OTRA URL de la misma organización no se sirve", async () => {
    // Sin el filtro por URL, con una sola fila en la tabla, el reporte de
    // cualquier sitio de la organización serviría los números de otro.
    tabla = [fila({ url: "https://otro-sitio.test" })];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE, outcome: OK });

    const rep = await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(rep?.state.webVitals).toEqual(DE_GOOGLE);
  });

  it("la fila fresca de la misma URL con OTRA estrategia no se sirve", async () => {
    tabla = [fila({ strategy: "desktop" })];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE, outcome: OK });

    const rep = await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(rep?.state.webVitals).toEqual(DE_GOOGLE);
  });

  it("un pedido con clientSnapshot no lee ni escribe la caché, aunque la URL sea de un cliente", async () => {
    // El repro del 2026-10-07: sesión cualquiera, un businessId que no ve, y la
    // web del cliente en el cuerpo. El `organizationId` del snapshot lo escribe
    // quien pide, así que no puede decidir qué caché se lee.
    negocioVisible = false;
    tabla = [fila()];
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE, outcome: OK });
    const { generateReport } = await import("@/lib/reports/orchestrator");

    const rep = await generateReport({
      businessId: "b-sonda",
      clientSnapshot: {
        business: {
          id: "b-sonda",
          organizationId: ORG,
          name: "Sonda",
          website: WEB,
          industry: "dental_clinic",
          brandTone: "",
          primaryLocale: "es",
          valueProposition: "",
          logoColor: "#EF4C24",
          createdAt: AHORA.toISOString(),
        },
        locations: [],
        services: [],
      },
    });

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(rep?.state.webVitals).toEqual(DE_GOOGLE);
    expect(lecturas).toEqual([]);
    expect(upserts).toEqual([]);
    expect(tabla).toEqual([fila()]);
  });

  it("modo demo, sin las variables de Supabase: sin caché, sin cliente de servicio, sin red, y el reporte sale igual", async () => {
    // El cliente de servicio REAL, sin URL ni clave: si alguien lo llamara,
    // `createClient` tiraría. Un reporte de demostración no tiene organización,
    // así que no tiene caché, y no debería crearlo para nada.
    haySesion = false;
    usarClienteDeServicioReal = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const red = vi.fn(async () => {
      throw new Error("el test del modo demo no puede salir a la red");
    });
    vi.stubGlobal("fetch", red);
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS, outcome: OK });
    const { generateReport } = await import("@/lib/reports/orchestrator");

    const rep = await generateReport({ businessId: (await negocioSemilla()).id, locale: "es" });

    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(clientesDeServicio).toBe(0);
    expect(red).not.toHaveBeenCalled();
    expect(avisosDelCache()).toEqual([]);
  });
});
