/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el reporte diga contra qué versión de la ficha se escribió… y no lo diga
 * de verdad. La puerta H1.2 tiene tres mitades; la `0027` es la (a) y la `0028`
 * el esquema de la (b). Esto es la (b) y la (c) del lado de la aplicación:
 *
 *   (b) un reporte generado cita un version_id que resuelve a esa fila exacta;
 *   (c) cambiar la ficha y regenerar el MISMO reporte cita un version_id
 *       distinto.
 *
 * Los modos de fallo que cada caso nombra, en orden:
 *
 * 1. La cita del JSON y la de la base dicen cosas distintas. El reporte guarda
 *    la cita dos veces —en `content`, para el lector, y en
 *    `profile_version_id`, con FK, para la base— y si salen de dos variables se
 *    separan.
 * 2. La consulta no nombra el tenant, o pide cualquier versión y no la
 *    publicada, o usa `single()` y convierte «no hay ficha» en un error.
 * 3. Regenerar cita siempre la primera versión (un cache, una variable de
 *    módulo): la mitad (c).
 * 4. Sin versión publicada, la columna viaja como `null`. En una base sin la
 *    `0028` eso rompe TODOS los reportes con 42703; ver la `0028`, «QUÉ NO HACE».
 * 5. Un error de lectura se presenta como «no hay ficha», o filtra el mensaje de
 *    Postgres al JSON que va al navegador.
 * 6. Un reporte de demostración consulta la ficha de alguien, o guarda algo.
 * 7. El INSERT falla y el reporte vuelve como si se hubiera guardado — que era
 *    el comportamiento hasta H1.2, y que desde H1.2 significa que la cita no
 *    existe y nadie se entera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const lookupPageSpeed = vi.fn();
const lookupPlace = vi.fn();
vi.mock("@/lib/integrations/google/pagespeed", () => ({ lookupPageSpeed }));
vi.mock("@/lib/integrations/google/places", () => ({ lookupPlace }));

const ORG = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00";
const NEGOCIO = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c11";
const V1 = "0d270000-0027-4027-8027-0000000000a1";
const V2 = "0d270000-0027-4027-8027-0000000000a2";

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

type Fila = { id: string; version: number; published_at: string };

/** La versión publicada que `company_profiles` devuelve. Cada test la define. */
let publicada: Fila | null = null;
/** Un fallo de lectura de la ficha, cuando el test lo pide. */
let errorDeFicha: { code?: string; message: string } | null = null;
/** Un fallo del INSERT de `reports`, cuando el test lo pide. */
let errorDeInsert: { code?: string; message: string } | null = null;
let haySesion = true;

/** Cada consulta a la ficha: sus filtros, en orden, y cómo terminó. */
let consultasALaFicha: { filtros: [string, unknown][]; columnas?: string; terminal?: string }[] = [];
/** Cada fila que se intentó insertar en `reports`. */
let insertados: Record<string, unknown>[] = [];

const createSupabaseServerClient = vi.fn(async () => ({
  auth: {
    getUser: async () => ({ data: { user: haySesion ? { id: "u" } : null } }),
  },
  from(tabla: string) {
    const consulta = {
      filtros: [] as [string, unknown][],
      columnas: undefined as string | undefined,
      terminal: undefined as string | undefined,
    };
    if (tabla === "company_profiles") consultasALaFicha.push(consulta);

    const respuesta = () => {
      if (tabla === "businesses") return { data: NEGOCIO_EN_BASE, error: null };
      return { data: [], error: null };
    };

    const encadenable = {
      select: (columnas?: string) => {
        consulta.columnas = columnas;
        return encadenable;
      },
      eq: (col: string, val: unknown) => {
        consulta.filtros.push([col, val]);
        return encadenable;
      },
      is: () => Promise.resolve(respuesta()),
      single: async () => {
        consulta.terminal = "single";
        return respuesta();
      },
      maybeSingle: async () => {
        consulta.terminal = "maybeSingle";
        if (tabla === "company_profiles") {
          return errorDeFicha ? { data: null, error: errorDeFicha } : { data: publicada, error: null };
        }
        return { data: null, error: null };
      },
      upsert: async () => ({ data: null, error: null }),
      insert: async (fila: Record<string, unknown>) => {
        if (tabla === "reports") insertados.push(fila);
        return { data: null, error: tabla === "reports" ? errorDeInsert : null };
      },
      then: (resolver: (v: unknown) => unknown) => Promise.resolve(respuesta()).then(resolver),
    };
    return encadenable;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

// El token de la agencia: ausente. Este archivo no mide Google.
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const e = {
        select: () => e,
        eq: () => e,
        order: () => e,
        limit: async () => ({ data: [], error: null }),
      };
      return e;
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

async function generar(businessId = NEGOCIO) {
  const { generateReport } = await import("@/lib/reports/orchestrator");
  return generateReport({ businessId, locale: "es" });
}

beforeEach(() => {
  publicada = null;
  errorDeFicha = null;
  errorDeInsert = null;
  haySesion = true;
  consultasALaFicha = [];
  insertados = [];
  lookupPlace.mockReset();
  lookupPageSpeed.mockReset();
  lookupPlace.mockResolvedValue({ status: "no-match" });
  lookupPageSpeed.mockResolvedValue({ status: "missing-key" });
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.VULKAN_AGENCY_ORG_ID;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el reporte cita la versión publicada de la ficha (H1.2)", () => {
  it("1. cita la publicada, y la base recibe el MISMO id que el JSON", async () => {
    publicada = { id: V1, version: 3, published_at: "2026-09-01T10:00:00.000Z" };

    const report = await generar();

    expect(report?.profileCitation).toEqual({
      status: "cited",
      versionId: V1,
      version: 3,
      publishedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(insertados).toHaveLength(1);
    expect(insertados[0].profile_version_id).toBe(V1);
    // Y lo que el lector se lleva guardado dice lo mismo que la columna.
    const guardado = JSON.parse(insertados[0].content as string);
    expect(guardado.profileCitation.versionId).toBe(insertados[0].profile_version_id);
  });

  it("2. la consulta nombra el tenant, la empresa y el estado, y cero filas no es un error", async () => {
    publicada = { id: V1, version: 1, published_at: "2026-09-01T10:00:00.000Z" };

    await generar();

    // Anti-vacuidad: si la consulta no se hiciera, las aserciones de abajo no
    // tendrían nada que mirar y pasarían.
    expect(consultasALaFicha).toHaveLength(1);
    const [consulta] = consultasALaFicha;
    expect(Object.fromEntries(consulta.filtros)).toEqual({
      organization_id: ORG,
      business_id: NEGOCIO,
      status: "published",
    });
    // Exactamente tres filtros: uno de más —otra columna, otro valor— también
    // cambia qué fila se cita.
    expect(consulta.filtros).toHaveLength(3);
    expect(consulta.terminal).toBe("maybeSingle");
    expect(consulta.columnas).toContain("id");
    expect(consulta.columnas).toContain("version");
    expect(consulta.columnas).toContain("published_at");
  });

  it("3. cambiar la ficha y regenerar el MISMO reporte cita un id distinto (la mitad c)", async () => {
    publicada = { id: V1, version: 1, published_at: "2026-09-01T10:00:00.000Z" };
    const a = await generar();

    // Cambiar la ficha, desde la `0027`, es publicar otra versión: la 1 pasa a
    // superada y la publicada es la 2.
    publicada = { id: V2, version: 2, published_at: "2026-09-15T10:00:00.000Z" };
    const b = await generar();

    expect(a?.profileCitation.status).toBe("cited");
    expect(b?.profileCitation.status).toBe("cited");
    const idA = a?.profileCitation.status === "cited" ? a.profileCitation.versionId : null;
    const idB = b?.profileCitation.status === "cited" ? b.profileCitation.versionId : null;
    expect(idA).toBe(V1);
    expect(idB).toBe(V2);
    expect(idA).not.toBe(idB);
    // Cada uno se guardó con SU cita.
    expect(insertados.map((f) => f.profile_version_id)).toEqual([V1, V2]);
  });

  it("4. sin versión publicada: `none`, y la columna NO viaja (ni como null)", async () => {
    publicada = null;

    const report = await generar();

    expect(report?.profileCitation).toEqual({ status: "none" });
    expect(insertados).toHaveLength(1);
    expect(insertados[0]).not.toHaveProperty("profile_version_id");
  });

  it("5. la lectura falla: `error` y no `none`, con el código y sin el mensaje de Postgres", async () => {
    // El caso normal en hosted hoy: la `0026` no está aplicada.
    errorDeFicha = { code: "42P01", message: 'relation "public.company_profiles" does not exist' };

    const report = await generar();

    expect(report?.profileCitation).toEqual({ status: "error", reason: "42P01" });
    // El reporte se genera y se guarda igual: la ficha no es una fuente de la
    // que dependa el resto del reporte.
    expect(insertados).toHaveLength(1);
    expect(insertados[0]).not.toHaveProperty("profile_version_id");
    // Y el mensaje, que nombra la tabla, no llega al JSON que va al navegador.
    expect(JSON.stringify(report)).not.toContain("does not exist");
    expect(JSON.stringify(report)).not.toContain("relation");
  });

  it("6. un reporte de demostración no consulta la ficha de nadie ni guarda nada", async () => {
    haySesion = false;
    const { businesses } = await import("@/lib/mock/universal");

    const report = await generar(businesses[0].id);

    expect(report).not.toBeNull();
    expect(report?.profileCitation).toEqual({ status: "demo" });
    expect(consultasALaFicha).toHaveLength(0);
    expect(insertados).toHaveLength(0);
  });

  it("7. si el INSERT falla, no vuelve un reporte como si se hubiera guardado", async () => {
    publicada = { id: V1, version: 1, published_at: "2026-09-01T10:00:00.000Z" };
    errorDeInsert = {
      code: "23503",
      message: 'insert or update on table "reports" violates foreign key constraint "reports_profile_version_fkey"',
    };

    const intento = generar();

    await expect(intento).rejects.toThrow(/23503/);
    // El código sí, la constraint no: el mensaje de la excepción termina en el
    // log del servidor y no hay por qué nombrar el esquema ahí tampoco.
    await expect(intento).rejects.not.toThrow(/reports_profile_version_fkey/);
    expect(insertados).toHaveLength(1);
  });
});
