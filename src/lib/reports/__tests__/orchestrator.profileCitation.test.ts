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
 *
 * MEDIDO ROMPIENDO EL CÓDIGO, CON `scripts/mutar.sh` (2026-09-30). Cada
 * mutación, sola, contra el árbol entero (731 tests); todas CAYERON y todas en
 * este archivo. La revisión adversarial señaló que la primera ronda —catorce—
 * no estaba escrita en ningún lado; ésta es la lista.
 *
 *   orchestrator.ts                                         cae
 *   ─────────────────────────────────────────────────────── ────────
 *   la columna viaja como null en vez del id                 1, 3
 *   la consulta sin `.eq("organization_id", …)`              2
 *   `.eq("status", "draft")` en vez de `published`           2
 *   `.single()` en vez de `.maybeSingle()`                   2, 5
 *   un error de lectura se devuelve como `none`              5
 *   `reason` lleva el error entero (con el mensaje)          5
 *   sin cita, la columna viaja como `null`                   4, 5
 *   el INSERT fallido no se levanta                          7
 *   la excepción lleva el mensaje en vez del código          7
 *   la rama de semillas cita `none` en vez de `demo`         6
 *   `buildReport` no recibe la cita                          1, 3, 4, 5
 *   el `select` pide `business_id` en vez de `id`            1, 2, 3
 *   la rama `clientSnapshot` cita `none` en vez de `demo`    6b
 *
 * La del `select` sin `id` es la que la revisión encontró viva: el doble
 * devolvía la fila entera y el test comparaba la proyección por substring.
 *
 * DESDE H1.3 la lectura vive en `src/lib/profile/fichaPublicada.ts`, la misma
 * que sirve la ficha al Lead Engine, y el reporte muestra el ICP DE LA VERSIÓN
 * QUE CITA. Los casos 8 a 11 nombran sus modos de fallo:
 *
 * 8. El ICP se busca por otra cosa que el id de la versión citada (la empresa,
 *    «el más nuevo»): el texto y la cita se separan.
 * 9. Cambiar el ICP —publicar otra versión— y regenerar no cambia el texto del
 *    reporte: es la mitad de Growth OS de la puerta H1.3, con un nonce.
 * 10. Una lectura del ICP que falla se presenta como «la versión no tiene ICP».
 * 11. Una versión sin ICP inventa uno, o deja de citarse.
 *
 * Las mutaciones de este tramo están en el bloque de esos casos.
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

/**
 * La fila de `company_profiles`. Sin `organization_id` ni `business_id`, es la
 * del par que se pidió —como con los filtros puestos—; el test 12 la pone de
 * OTRO par para simular una consulta que perdió el filtro.
 */
type Fila = {
  id: string;
  version: number;
  published_at: string;
  organization_id?: string;
  business_id?: string;
};

/** La versión publicada que `company_profiles` devuelve. Cada test la define. */
let publicada: Fila | null = null;
/** Un fallo de lectura de la ficha, cuando el test lo pide. */
let errorDeFicha: { code?: string; message: string } | null = null;
/** Un fallo del INSERT de `reports`, cuando el test lo pide. */
let errorDeInsert: { code?: string; message: string } | null = null;

type FilaIcp = {
  definition: string;
  disqualifiers: string | null;
  buying_trigger: string | null;
  budget_band: string | null;
};
/**
 * Las filas de `profile_icp`, por id de VERSIÓN. El doble sólo devuelve la de
 * la versión que la consulta pide con `.eq("profile_id", …)`, como la base: un
 * ICP buscado por otra cosa no encuentra nada, o encuentra el de otra versión.
 */
let icpPorVersion: Record<string, FilaIcp> = {};
/** Un fallo de lectura del ICP, cuando el test lo pide. */
let errorDeIcp: { code?: string; message: string } | null = null;
/** Cada consulta al ICP: sus filtros, en orden, y cómo terminó. */
let consultasAlIcp: { filtros: [string, unknown][]; columnas?: string; terminal?: string }[] = [];
let haySesion = true;

/** Cada consulta a la ficha: sus filtros, en orden, y cómo terminó. */
let consultasALaFicha: { filtros: [string, unknown][]; columnas?: string; terminal?: string }[] = [];
/** Cada fila que se intentó insertar en `reports`. */
let insertados: Record<string, unknown>[] = [];

/** Las columnas de un `select("a, b, c")`, como tokens y no como texto. */
function columnasDe(proyeccion: string | undefined): string[] {
  return (proyeccion ?? "*")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function proyectar(fila: Fila | null, proyeccion: string | undefined): Record<string, unknown> | null {
  if (!fila) return null;
  const completa: Fila = { organization_id: ORG, business_id: NEGOCIO, ...fila };
  const columnas = columnasDe(proyeccion);
  if (columnas.includes("*")) return { ...completa };
  return Object.fromEntries(
    columnas.filter((c) => c in completa).map((c) => [c, completa[c as keyof Fila]])
  );
}

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
    if (tabla === "profile_icp") consultasAlIcp.push(consulta);

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
          if (errorDeFicha) return { data: null, error: errorDeFicha };
          // El doble devuelve SÓLO las columnas que la consulta pidió, como
          // PostgREST. La primera versión devolvía la fila entera fuera cual
          // fuera la proyección, así que un `select("business_id, version,
          // published_at")` —sin `id`— dejaba los siete tests verdes y en
          // producción citaba `undefined`. Lo encontró la revisión adversarial.
          return { data: proyectar(publicada, consulta.columnas), error: null };
        }
        if (tabla === "profile_icp") {
          if (errorDeIcp) return { data: null, error: errorDeIcp };
          // Como la base: el ICP de la versión que pide el filtro, y sólo si el
          // filtro de tenant es el de la organización del negocio.
          const filtros = Object.fromEntries(consulta.filtros);
          if (filtros.organization_id !== ORG) return { data: null, error: null };
          return { data: icpPorVersion[String(filtros.profile_id)] ?? null, error: null };
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
  icpPorVersion = {};
  errorDeIcp = null;
  consultasAlIcp = [];
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
      icp: null,
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
    // Por TOKENS y no por substring: la primera versión hacía
    // `toContain("id")` sobre el texto, y "business_id" lo satisfacía.
    // Y el par de la fila, que `leerFichaPublicada` compara con el pedido.
    expect(columnasDe(consulta.columnas).sort()).toEqual([
      "business_id",
      "id",
      "organization_id",
      "published_at",
      "version",
    ]);
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

  it("6b. un reporte del tenant que vive sólo en el navegador (clientSnapshot) tampoco", async () => {
    // La tercera rama de `loadSnapshot`: sin sesión, con el negocio que el
    // navegador manda. La revisión adversarial encontró que ningún test pasaba
    // por acá, así que mutar su cita a `none` quedaba verde.
    haySesion = false;
    const { businesses } = await import("@/lib/mock/universal");
    const local = { ...businesses[0], id: "local-solo-en-el-navegador" };
    const { generateReport } = await import("@/lib/reports/orchestrator");

    const report = await generateReport({
      businessId: local.id,
      clientSnapshot: { business: local, locations: [], services: [] },
      locale: "es",
    });

    expect(report).not.toBeNull();
    expect(report?.businessId).toBe(local.id);
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

/**
 * EL REPORTE MUESTRA EL ICP DE LA VERSIÓN QUE CITA (H1.3)
 *
 * MEDIDO CON `scripts/mutar.sh` (2026-10-07), cada una sola contra el árbol
 * entero (832 tests); todas CAYERON. Lo que cayó en este archivo; las que
 * además cayeron en la ruta (`src/app/api/profile/published`) están en la
 * tabla de su test:
 *
 *   fichaPublicada.ts / orchestrator.ts                       cae acá
 *   ───────────────────────────────────────────────────────── ─────────────
 *   el ICP se busca sin el filtro de `organization_id`         8, 9
 *   el ICP se busca por `business_id` y no por la versión      8, 9
 *   `.maybeSingle()` del ICP pasa a `.single()`                1, 8, 9, 10, 11
 *   un error del ICP se ignora                                 10
 *   el fallo lleva el error entero y no el código              5, 10
 *   la cita no lleva el ICP (`icp: null` fijo)                 8, 9
 *   un fallo de la ficha se cita como `none`                   5, 10
 *   la versión se busca sin `organization_id`                  2
 *   la versión publicada pasa a ser la borrador                2
 *
 * El `.single()` hace caer el 1 porque, como PostgREST, cero filas con
 * `single` es un error: una versión sin ICP dejaría de citarse.
 */
describe("el reporte muestra el ICP de la versión que cita (H1.3)", () => {
  const NONCE_A = "nonce-a-3b9e0c71-icp-de-la-version-1";
  const NONCE_B = "nonce-b-c5d2e8f4-icp-de-la-version-2";

  function icp(definition: string): FilaIcp {
    return { definition, disqualifiers: null, buying_trigger: "abre otra sede", budget_band: null };
  }

  async function markdownDe(report: Awaited<ReturnType<typeof generar>>) {
    const { reportToMarkdown } = await import("@/lib/reports/markdown");
    return reportToMarkdown(report!);
  }

  it("8. el ICP se lee por el id de la versión citada y con el tenant, y va dentro de la cita", async () => {
    publicada = { id: V1, version: 1, published_at: "2026-09-01T10:00:00.000Z" };
    icpPorVersion = { [V1]: icp(NONCE_A), [V2]: icp(NONCE_B) };

    const report = await generar();

    expect(consultasAlIcp).toHaveLength(1);
    const [consulta] = consultasAlIcp;
    expect(Object.fromEntries(consulta.filtros)).toEqual({ organization_id: ORG, profile_id: V1 });
    expect(consulta.filtros).toHaveLength(2);
    expect(consulta.terminal).toBe("maybeSingle");
    expect(report?.profileCitation).toEqual({
      status: "cited",
      versionId: V1,
      version: 1,
      publishedAt: "2026-09-01T10:00:00.000Z",
      icp: { definition: NONCE_A, disqualifiers: null, buyingTrigger: "abre otra sede", budgetBand: null },
    });
    // Y lo que se guarda en la base dice lo mismo que lo que se muestra.
    expect(JSON.parse(insertados[0].content as string).profileCitation.icp.definition).toBe(NONCE_A);
  });

  it("9. cambiar el ICP —publicar otra versión— y regenerar cambia el texto del reporte (nonce)", async () => {
    publicada = { id: V1, version: 1, published_at: "2026-09-01T10:00:00.000Z" };
    icpPorVersion = { [V1]: icp(NONCE_A) };
    const a = await markdownDe(await generar());

    // Cambiar el ICP, desde la `0027`, es publicar la versión 2 con otro ICP:
    // la fila de la 1 no se puede editar.
    publicada = { id: V2, version: 2, published_at: "2026-09-15T10:00:00.000Z" };
    icpPorVersion = { [V1]: icp(NONCE_A), [V2]: icp(NONCE_B) };
    const b = await markdownDe(await generar());

    expect(a).toContain(NONCE_A);
    expect(a).not.toContain(NONCE_B);
    expect(b).toContain(NONCE_B);
    expect(b).not.toContain(NONCE_A);
    expect(b).toContain(V2);
  });

  it("10. si el ICP no se puede leer, el reporte no cita: `error` con el código, y no «sin ICP»", async () => {
    publicada = { id: V1, version: 1, published_at: "2026-09-01T10:00:00.000Z" };
    errorDeIcp = { code: "42501", message: 'permission denied for table "profile_icp"' };

    const report = await generar();

    expect(report?.profileCitation).toEqual({ status: "error", reason: "42501" });
    expect(insertados[0]).not.toHaveProperty("profile_version_id");
    expect(JSON.stringify(report)).not.toContain("permission denied");
  });

  it("11. una versión publicada sin ICP se cita igual, y el texto dice que no tiene", async () => {
    publicada = { id: V1, version: 1, published_at: "2026-09-01T10:00:00.000Z" };
    icpPorVersion = { [V2]: icp(NONCE_B) };

    const report = await generar();
    const md = await markdownDe(report);

    expect(report?.profileCitation.status).toBe("cited");
    expect(insertados[0].profile_version_id).toBe(V1);
    expect(md).toContain("has no ideal customer profile");
    // El ICP de OTRA versión no se cuela.
    expect(md).not.toContain(NONCE_B);
  });

  it("12. si la fila leída no es de ESTA empresa (una consulta sin filtro), el reporte no la cita: `error`", async () => {
    // La lectura es la misma que sirve al Lead Engine, así que la comparación
    // del par también protege al reporte (revisión del 2026-10-07).
    publicada = {
      id: V1,
      version: 4,
      published_at: "2026-09-01T10:00:00.000Z",
      business_id: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1d33",
    };
    icpPorVersion = { [V1]: icp(NONCE_A) };

    const report = await generar();

    expect(report?.profileCitation).toEqual({ status: "error", reason: "fila-de-otro-par" });
    expect(insertados[0]).not.toHaveProperty("profile_version_id");
    expect(JSON.stringify(report)).not.toContain(NONCE_A);
  });
});
