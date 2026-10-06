/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Cuatro cosas, y las cuatro cuestan plata o mienten:
 *
 * 1. QUE EL CACHÉ DEJE DE AHORRAR. PageSpeed comparte cuota y es lento (15-40 s).
 *    Si una entrada fresca deja de servirse, cada reporte vuelve a pegarle a la
 *    API. Eso no rompe nada visible: el reporte sale igual, sólo que más lento y
 *    consumiendo cuota. Es el tipo de regresión que nadie nota hasta que llega
 *    la factura o el rate limit.
 *
 * 2. QUE EL CACHÉ DEJE DE VENCER. El espejo del anterior, y peor: si una entrada
 *    vencida se sigue sirviendo, el reporte muestra métricas viejas como si
 *    fueran de hoy. Nadie se entera nunca.
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
 * NO se toca Supabase ni la red: todo va con dobles. Eso tiene un límite que hay
 * que decir en voz alta — R9: verificar por la vía real. Estos tests prueban la
 * LÓGICA del caché y QUÉ CLIENTE usa, no que la tabla le niegue algo a alguien:
 * eso lo miden los bloques 136 a 141 de `supabase/qa/defects_test.sql`, contra el
 * esquema de verdad. La excepción es el test del modo demo, que usa el
 * `createSupabaseAdminClient` REAL sin variables, con `fetch` espiado.
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

/** Fila que devuelve el caché, o null. Cada test la define. */
let filaCacheada: { result: unknown; fetched_at: string } | null = null;
/** Todo lo que se intentó escribir en pagespeed_cache, por el cliente de servicio. */
let escrituras: Record<string, unknown>[] = [];
/** Cuántas veces se LEYÓ pagespeed_cache por el cliente de servicio. */
let lecturasDeServicio = 0;
/** Cada vez que la SESIÓN tocó pagespeed_cache. Desde la 0030 no pasa nunca. */
let tocadasPorSesion: string[] = [];
/** Lo que el cliente de servicio contesta al leer o escribir, cuando el test pide un fallo. */
let errorDeLectura: ErrorDePostgrest | null = null;
let errorDeEscritura: ErrorDePostgrest | null = null;
/** El test del modo demo usa el cliente de servicio REAL, sin variables. */
let usarClienteDeServicioReal = false;

/** Lo que la base de la 0030 le contesta a una sesión que toca la caché. */
const DENEGADO: ErrorDePostgrest = {
  code: "42501",
  message: "permission denied for table pagespeed_cache",
};

const createSupabaseServerClient = vi.fn(async () => ({
  auth: { getUser: async () => ({ data: { user: null } }) },
  from(tabla: string) {
    const esCache = tabla === "pagespeed_cache";
    const encadenable = {
      select: () => {
        if (esCache) tocadasPorSesion.push("select");
        return encadenable;
      },
      eq: () => encadenable,
      maybeSingle: async () => (esCache ? { data: null, error: DENEGADO } : { data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      upsert: async () => {
        if (esCache) tocadasPorSesion.push("upsert");
        return { data: null, error: esCache ? DENEGADO : null };
      },
      insert: async () => ({ data: null, error: null }),
    };
    return encadenable;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

const createSupabaseAdminClient = vi.fn(() => ({
  from(tabla: string) {
    const esCache = tabla === "pagespeed_cache";
    const encadenable = {
      select: () => encadenable,
      eq: () => encadenable,
      maybeSingle: async () => {
        if (esCache) lecturasDeServicio++;
        return errorDeLectura ? { data: null, error: errorDeLectura } : { data: filaCacheada, error: null };
      },
      upsert: async (fila: Record<string, unknown>) => {
        if (esCache) escrituras.push(fila);
        return { data: null, error: errorDeEscritura };
      },
    };
    return encadenable;
  },
}));
vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/supabase/admin")>();
  return {
    createSupabaseAdminClient: () =>
      usarClienteDeServicioReal ? real.createSupabaseAdminClient() : createSupabaseAdminClient(),
  };
});

const AHORA = new Date("2026-08-18T12:00:00.000Z");
const VITALS_BUENOS = {
  lcp: 2100,
  inp: 180,
  cls: 0.05,
  lighthouseScore: 88,
  fetchedAt: "2026-08-18T00:00:00.000Z",
};

/** Un negocio semilla, para que loadSnapshot encuentre algo sin tocar la base. */
async function negocioSemilla() {
  const { businesses } = await import("@/lib/mock/universal");
  return businesses[0];
}

async function generar() {
  const { generateReport } = await import("@/lib/reports/orchestrator");
  return generateReport({ businessId: (await negocioSemilla()).id, locale: "es" });
}

/** Lo que se escribió en el log con el prefijo del caché. */
let avisos: ReturnType<typeof vi.spyOn>;
const avisosDelCache = () =>
  avisos.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith("[pagespeed-cache]"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  filaCacheada = null;
  escrituras = [];
  lecturasDeServicio = 0;
  tocadasPorSesion = [];
  errorDeLectura = null;
  errorDeEscritura = null;
  usarClienteDeServicioReal = false;
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
  it("con una entrada FRESCA no llama a la API", async () => {
    // 1 hora de antigüedad: dentro del TTL.
    filaCacheada = {
      result: VITALS_BUENOS,
      fetched_at: new Date(AHORA.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    };

    const rep = await generar();

    // Esta es la aserción que ahorra plata. Si cae, cada reporte gasta cuota.
    expect(lookupPageSpeed).not.toHaveBeenCalled();
    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
  });

  it("con una entrada VENCIDA sí llama a la API", async () => {
    // 25 horas: pasado el TTL.
    filaCacheada = {
      result: VITALS_BUENOS,
      fetched_at: new Date(AHORA.getTime() - 25 * 60 * 60 * 1000).toISOString(),
    };
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS });

    await generar();

    // Si cae, servimos métricas viejas como si fueran de hoy, para siempre.
    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
  });

  it("a las 24 h exactas ya está vencida", async () => {
    // El borde. La condición es `ahora - fetched_at < TTL`, así que exactamente
    // 24 h NO es fresca. Un `<=` acá alarga el caché un instante; lo que importa
    // es que el borde esté cubierto y que nadie lo cambie sin querer.
    filaCacheada = {
      result: VITALS_BUENOS,
      fetched_at: new Date(AHORA.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    };
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS });

    await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
  });

  it("sin entrada en el caché llama a la API y guarda el resultado bueno", async () => {
    filaCacheada = null;
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS });

    await generar();

    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(escrituras).toHaveLength(1);
  });
});

describe("caché de PageSpeed — un fallo no se cachea ni se disfraza", () => {
  it("NO guarda nada cuando la API falla", async () => {
    filaCacheada = null;
    lookupPageSpeed.mockResolvedValue({ status: "error" });

    await generar();

    // Cachear un fallo lo congela 24 h: el sitio se arregla y el reporte sigue
    // roto hasta el día siguiente.
    expect(escrituras).toHaveLength(0);
  });

  it("reporta 'error' cuando la API falla — no 'live' ni 'missing'", async () => {
    filaCacheada = null;
    lookupPageSpeed.mockResolvedValue({ status: "error" });

    const rep = await generar();

    // "missing" significa "falta configurar la integración" y le diría al
    // usuario que conecte algo que ya está conectado. "live" sería directamente
    // presentar cifras sintéticas como reales.
    expect(rep?.dataSourceHealth.pagespeed).toBe("error");
  });

  it("el fallo llega hasta el texto que el usuario lee", async () => {
    filaCacheada = null;
    lookupPageSpeed.mockResolvedValue({ status: "error" });

    const rep = await generar();

    // El campo `pagespeed: "error"` no lo lee nadie: lo que se muestra es la
    // nota. Si el fallo no llega hasta ahí, para el usuario no ocurrió.
    // Con el nombre de producto, no con la clave del objeto: la nota es prosa
    // que lee el cliente. Esta aserción decía `"pagespeed"` y pasaba porque la
    // nota se armaba con las claves — clavaba el defecto, no el requisito.
    expect(rep?.dataSourceHealth.note).toContain(DATA_SOURCE_LABELS.pagespeed);
  });

  it("distingue 'sin API key' de 'la API falló'", async () => {
    filaCacheada = null;
    lookupPageSpeed.mockResolvedValue({ status: "missing-key" });

    const rep = await generar();

    // Son dos problemas distintos con dos arreglos distintos: uno se resuelve
    // configurando, el otro reintentando o investigando.
    expect(rep?.dataSourceHealth.pagespeed).toBe("missing");
  });

  it("NO da 'live' si la respuesta viene sin lighthouseScore", async () => {
    filaCacheada = null;
    // Respuesta a medias: status bueno, cuerpo incompleto. Es el caso que se
    // cuela cuando la API cambia de forma o responde parcialmente.
    lookupPageSpeed.mockResolvedValue({ status: "live", lcp: 2100 });

    const rep = await generar();

    expect(rep?.dataSourceHealth.pagespeed).not.toBe("live");
    expect(escrituras).toHaveLength(0);
  });
});

describe("caché de PageSpeed — sólo el servidor la toca (0030)", () => {
  it("la LEE con el cliente de servicio y la sesión no la toca", async () => {
    filaCacheada = {
      result: VITALS_BUENOS,
      fetched_at: new Date(AHORA.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    };

    const rep = await generar();

    // Anti-vacuidad: hubo una lectura, y fue la que sirvió el reporte. Sin esto,
    // «la sesión no la tocó» pasaría también con un orquestador que no lee nada.
    expect(lecturasDeServicio).toBe(1);
    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    // Con la sesión, la 0030 contesta 42501: el caché dejaría de servir sin
    // que nada se cayera, y cada reporte volvería a gastar cuota.
    expect(tocadasPorSesion).toEqual([]);
  });

  it("la ESCRIBE con el cliente de servicio, y lo que escribe es lo que contestó Google", async () => {
    const negocio = await negocioSemilla();
    // Números que no están en ninguna semilla: si la fila los lleva, salieron
    // de la respuesta de Google a este servidor y de ningún otro lado.
    const DE_GOOGLE = { lcp: 3456, inp: 321, cls: 0.17, lighthouseScore: 63, fetchedAt: "2026-08-18T03:04:05.000Z" };
    lookupPageSpeed.mockResolvedValue({ status: "live", ...DE_GOOGLE });

    const rep = await generar();

    expect(lookupPageSpeed).toHaveBeenCalledWith({ url: negocio.website, strategy: "mobile" });
    expect(escrituras).toEqual([
      { url: negocio.website, strategy: "mobile", result: DE_GOOGLE, fetched_at: DE_GOOGLE.fetchedAt },
    ]);
    expect(tocadasPorSesion).toEqual([]);
    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
  });

  it("una LECTURA que falla no tumba el reporte, va a Google, y queda en el log con el código", async () => {
    errorDeLectura = DENEGADO;
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS });

    const rep = await generar();

    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(avisosDelCache()).toContain("[pagespeed-cache] lectura: 42501");
    // El mensaje puede nombrar tablas: al log va el código (la lección de #104).
    expect(avisos.mock.calls.flat().join(" ")).not.toContain(DENEGADO.message);
  });

  it("una ESCRITURA que falla no tumba el reporte, y queda en el log con el código", async () => {
    errorDeEscritura = DENEGADO;
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS });

    const rep = await generar();

    expect(escrituras).toHaveLength(1);
    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    expect(rep?.dataSourceHealth.pagespeed).not.toBe("error");
    expect(avisosDelCache()).toContain("[pagespeed-cache] escritura: 42501");
    expect(avisos.mock.calls.flat().join(" ")).not.toContain(DENEGADO.message);
  });

  it("con todo en orden, el caché no escribe nada en el log", async () => {
    // El control de los dos de arriba: si el aviso saliera siempre, «queda en el
    // log» no diría nada sobre un fallo.
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS });

    await generar();

    expect(escrituras).toHaveLength(1);
    expect(avisosDelCache()).toEqual([]);
  });

  it("modo demo, sin las variables de Supabase: el reporte sale igual, sin red, y el log lo dice", async () => {
    // El cliente de servicio REAL, sin URL ni clave: `createClient` tira al
    // crearse. Es el estado de un deploy sin `SUPABASE_SERVICE_ROLE_KEY`, o de
    // la demo sin Supabase. La ruta ni siquiera llega acá sin sesión (#103);
    // lo que se mide es que el caché, si se alcanza así, no se lleve el reporte.
    usarClienteDeServicioReal = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const red = vi.fn(async () => {
      throw new Error("el test del modo demo no puede salir a la red");
    });
    vi.stubGlobal("fetch", red);
    lookupPageSpeed.mockResolvedValue({ status: "live", ...VITALS_BUENOS });

    const rep = await generar();

    expect(rep?.dataSourceHealth.pagespeed).toBe("live");
    expect(lookupPageSpeed).toHaveBeenCalledTimes(1);
    expect(red).not.toHaveBeenCalled();
    expect(avisosDelCache()).toEqual([
      "[pagespeed-cache] lectura: el cliente de servicio no se pudo crear o tiró",
      "[pagespeed-cache] escritura: el cliente de servicio no se pudo crear o tiró",
    ]);
  });
});
