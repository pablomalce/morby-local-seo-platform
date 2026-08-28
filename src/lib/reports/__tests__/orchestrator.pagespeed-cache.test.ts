/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Tres cosas, y las tres cuestan plata o mienten:
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
 * NO se toca Supabase ni la red: todo va con dobles. Eso tiene un límite que hay
 * que decir en voz alta — R9: verificar por la vía real. Estos tests prueban la
 * LÓGICA del caché, no que la consulta a `pagespeed_cache` funcione contra
 * PostgREST. Eso queda pendiente hasta que la base salga de INACTIVE, y no está
 * cubierto acá.
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

/** Fila que devuelve el caché, o null. Cada test la define. */
let filaCacheada: { result: unknown; fetched_at: string } | null = null;
/** Todo lo que se intentó escribir en pagespeed_cache. */
let escrituras: unknown[] = [];

const createSupabaseServerClient = vi.fn(async () => ({
  auth: { getUser: async () => ({ data: { user: null } }) },
  from(tabla: string) {
    const encadenable = {
      select: () => encadenable,
      eq: () => encadenable,
      maybeSingle: async () => ({ data: filaCacheada, error: null }),
      single: async () => ({ data: null, error: null }),
      upsert: async (fila: unknown) => {
        if (tabla === "pagespeed_cache") escrituras.push(fila);
        return { data: null, error: null };
      },
      insert: async () => ({ data: null, error: null }),
    };
    return encadenable;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

const AHORA = new Date("2026-08-18T12:00:00.000Z");
const VITALS_BUENOS = {
  lcp: 2100,
  inp: 180,
  cls: 0.05,
  lighthouseScore: 88,
  fetchedAt: "2026-08-18T00:00:00.000Z",
};

/** Un negocio semilla, para que loadSnapshot encuentre algo sin tocar la base. */
async function idDeNegocioSemilla() {
  const { businesses } = await import("@/lib/mock/universal");
  return businesses[0].id;
}

async function generar() {
  const { generateReport } = await import("@/lib/reports/orchestrator");
  return generateReport({ businessId: await idDeNegocioSemilla(), locale: "es" });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  filaCacheada = null;
  escrituras = [];
  lookupPageSpeed.mockReset();
  lookupPlace.mockReset();
  // Places siempre neutro: acá se prueba PageSpeed.
  lookupPlace.mockResolvedValue({ status: "no-match" });
  process.env.GOOGLE_PAGESPEED_API_KEY = "clave-de-prueba";
  process.env.GOOGLE_PLACES_API_KEY = "clave-de-prueba";
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
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
