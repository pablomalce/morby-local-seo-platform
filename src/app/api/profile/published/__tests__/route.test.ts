/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la lectura de servicio de la ficha (H1.3, decisión 8a) deje leer a quien
 * no firmó, o que le sirva al Lead Engine algo distinto de la versión publicada
 * de ESE par (organización, empresa).
 *
 * Los modos de fallo, en el orden de los bloques:
 *
 * 1. El verificador no implementa EL CONTRATO sino otra cosa parecida. El
 *    oráculo no es este repositorio: es el vector calculado con `openssl` que
 *    está en el encabezado de `profileReadSignature.ts`, y una firma hecha acá
 *    con `node:crypto` siguiendo el TEXTO del contrato, sin importar nada del
 *    módulo que se prueba (R11). El Lead Engine hace lo mismo del otro lado.
 * 2. Sin secreto de este lado, la ruta deja pasar —la lección de
 *    `requireInternalSecret`— o contesta 401 y manda a buscar el problema al
 *    Lead Engine.
 * 3. La firma no cubre algo que debería: un id cambiado en la query, la hora,
 *    un pedido viejo repetido.
 * 4. La ruta lee antes de verificar: el cliente de servicio se crea sin firma.
 * 5. La lectura no filtra por el par entero, o sirve una versión que no es la
 *    publicada, o el ICP de otra versión.
 * 6. Ausencia y fallo se confunden, o el fallo filtra el detalle de Postgres.
 * 7. Cambiar el ICP —publicar otra versión— no cambia lo que lee el Lead
 *    Engine; y sin versión publicada la ruta devuelve algo que se pueda usar
 *    como ICP en vez de un 404 con nombre. Es la mitad de Growth OS de la
 *    puerta H1.3, con nonce.
 * 8. (Revisión del 2026-10-07.) La consulta pierde el filtro de tenant y la
 *    ruta sirve el ICP de OTRO cliente con los ids de la query, así que el
 *    chequeo de eco del Lead Engine no lo ve.
 * 9. (Revisión del 2026-10-07.) La ruta contesta algo que el contrato no tiene
 *    —un 500 porque algo tiró, un campo de más, un status que el bloque no
 *    nombra—. El oráculo es el bloque del contrato, el mismo texto que copia el
 *    Lead Engine (su SHA-256 lo fija `contratoDeLectura.test.ts`), transcripto
 *    acá a una validación que NO importa nada de la ruta.
 *
 * EL DOBLE DE LA BASE recorre la secuencia que recorre PostgREST (R13): filtra
 * las filas por cada `.eq` que la ruta pide, proyecta SÓLO las columnas del
 * `select`, y `maybeSingle` con dos filas es PGRST116. Un doble que devolviera
 * la fila pedida sin mirar los filtros dejaría verde una consulta sin tenant.
 *
 * Las mutaciones medidas están al final, en el bloque «la medición».
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// ─── el contrato, copiado del TEXTO (no del módulo) ──────────────────────────

/**
 * Así firma el Lead Engine, escrito desde el encabezado de
 * `profileReadSignature.ts` y NO importado de él: si este test usara la función
 * del módulo para firmar, un error en el módulo firmaría y verificaría igual de
 * mal y el test quedaría verde.
 */
function firmarComoLeadEngine(org: string, negocio: string, ts: string, secreto: string): string {
  const mensaje = "GET\n/api/profile/published\n" + org + "\n" + negocio + "\n" + ts;
  return createHmac("sha256", secreto).update(mensaje, "utf8").digest("hex");
}

/**
 * El vector con el que firma el test de contrato del Lead Engine
 * (`lib/__tests__/growthosProfileContract.test.ts`), recalculado acá con
 * `openssl dgst -sha256 -hmac` el 2026-10-07. Es un oráculo del OTRO lado: si
 * este verificador y aquel firmante no aceptan el mismo vector, el contrato se
 * rompe entre los dos repositorios aunque cada uno esté verde.
 */
const VECTOR_DEL_LEAD_ENGINE = {
  secreto: "h13-vector-de-contrato",
  org: "0190a0b0-0000-7000-8000-000000000001",
  negocio: "0190a0b0-0000-7000-8000-000000000002",
  ts: "1767225600",
  firma: "f4700c30da933a647db89d88cac0bcca441d6474ffdebf8e9e2683edc7ba7bed",
};

/** El vector de `openssl` que está DENTRO del bloque del contrato; con él se siembran estos tests. */
const VECTOR = {
  secreto: "secreto-de-ejemplo-del-contrato-h13",
  org: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00",
  negocio: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c11",
  ts: "1790000000",
  firma: "ee4a08307808b8196b96fc65b7ca25276b695458cd19d75e150d9fa48cc41fe6",
};

// ─── el doble de la base ──────────────────────────────────────────────────────

const SECRETO = VECTOR.secreto;
const ORG = VECTOR.org;
const NEGOCIO = VECTOR.negocio;
const OTRA_ORG = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1b22";
const OTRO_NEGOCIO = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1d33";
const AHORA = 1_790_000_000;
const V1 = "0d270000-0027-4027-8027-0000000000b1";
const V2 = "0d270000-0027-4027-8027-0000000000b2";

type Fila = Record<string, unknown>;

/** Las tablas que la ruta puede leer, con sus filas. Cada test las siembra. */
let base: Record<string, Fila[]> = {};
/** Un fallo de lectura por tabla, cuando el test lo pide. */
let errores: Record<string, { code: string; message: string }> = {};
/** Cada consulta que llegó a la base: tabla, columnas, filtros y cómo terminó. */
let consultas: { tabla: string; columnas: string; filtros: [string, unknown][]; terminal: string }[] = [];

function columnasDe(proyeccion: string): string[] {
  return proyeccion
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Las filas que la base deja pasar por cada `.eq`, sin mirarlos. Ver el bloque 8. */
let filtrosIgnorados = false;

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un `.eq` como lo resuelve Postgres: un uuid se compara sin mayúsculas (la
 * entrada `0190A…` y la columna `0190a…` son el mismo valor) y la columna
 * vuelve siempre en minúsculas; todo lo demás, exacto.
 */
function igualEnPostgres(columna: unknown, valor: unknown): boolean {
  if (filtrosIgnorados) return true;
  if (typeof columna === "string" && typeof valor === "string" && FORMA_UUID.test(valor)) {
    return columna.toLowerCase() === valor.toLowerCase();
  }
  return columna === valor;
}

function consultar(tabla: string) {
  const q = { tabla, columnas: "*", filtros: [] as [string, unknown][], terminal: "" };
  const resolver = (unica: boolean) => {
    consultas.push(q);
    if (errores[tabla]) return { data: null, error: errores[tabla] };
    const filas = (base[tabla] ?? [])
      .filter((f) => q.filtros.every(([col, val]) => igualEnPostgres(f[col], val)))
      .map((f) => {
        const cols = columnasDe(q.columnas);
        return cols.includes("*") ? { ...f } : Object.fromEntries(cols.map((c) => [c, f[c]]));
      });
    if (!unica) return { data: filas, error: null };
    if (filas.length > 1) {
      return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple rows returned" } };
    }
    return { data: filas[0] ?? null, error: null };
  };
  const cadena = {
    select(columnas: string) {
      q.columnas = columnas;
      return cadena;
    },
    eq(col: string, val: unknown) {
      q.filtros.push([col, val]);
      return cadena;
    },
    async maybeSingle() {
      q.terminal = "maybeSingle";
      return resolver(true);
    },
    async single() {
      q.terminal = "single";
      const r = resolver(true);
      if (!r.error && r.data === null) {
        return { data: null, error: { code: "PGRST116", message: "JSON object requested, 0 rows returned" } };
      }
      return r;
    },
    then(ok: (v: unknown) => unknown, mal?: (e: unknown) => unknown) {
      q.terminal = "await";
      return Promise.resolve(resolver(false)).then(ok, mal);
    },
  };
  return cadena;
}

const createSupabaseAdminClient = vi.fn(() => ({ from: (tabla: string) => consultar(tabla) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

/** El cliente de SESIÓN no tiene nada que hacer acá: si se usa, el test cae diciendo eso. */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    throw new Error("la lectura de servicio usó el cliente de SESIÓN");
  },
}));

// ─── sembrar ──────────────────────────────────────────────────────────────────

function version(id: string, n: number, status: string, org = ORG, negocio = NEGOCIO): Fila {
  return {
    id,
    organization_id: org,
    business_id: negocio,
    version: n,
    status,
    published_at: status === "draft" ? null : `2026-09-${String(n).padStart(2, "0")}T10:00:00+00:00`,
  };
}

function icp(profileId: string, definition: string, org = ORG): Fila {
  return {
    organization_id: org,
    profile_id: profileId,
    definition,
    disqualifiers: "cadenas de más de 20 sedes",
    buying_trigger: "abren una segunda sede",
    budget_band: "2-5k SEK/mes",
  };
}

function oferta(profileId: string, name: string, position: number, org = ORG): Fila {
  return {
    organization_id: org,
    profile_id: profileId,
    name,
    description: `descripción de ${name}`,
    price_band: "media",
    promise: `promesa de ${name}`,
    position,
  };
}

// ─── llamar ───────────────────────────────────────────────────────────────────

interface Pedido {
  org?: string | null;
  negocio?: string | null;
  ts?: string | null;
  firma?: string | null;
}

/** Un GET firmado como el Lead Engine, salvo lo que el caso pise. */
async function pedir(p: Pedido = {}) {
  const org = p.org === undefined ? ORG : p.org;
  const negocio = p.negocio === undefined ? NEGOCIO : p.negocio;
  const ts = p.ts === undefined ? String(AHORA) : p.ts;
  const firma =
    p.firma === undefined ? firmarComoLeadEngine(org ?? "", negocio ?? "", ts ?? "", SECRETO) : p.firma;

  const url = new URL("https://growthos.test/api/profile/published");
  if (org !== null) url.searchParams.set("organization_id", org);
  if (negocio !== null) url.searchParams.set("business_id", negocio);
  const h = new Headers();
  if (ts !== null) h.set("x-vulkan-timestamp", ts);
  if (firma !== null) h.set("x-vulkan-signature", firma);

  const { GET } = await import("@/app/api/profile/published/route");
  const res = await GET(new Request(url.toString(), { method: "GET", headers: h }));
  const texto = await res.text();
  return {
    status: res.status,
    texto,
    cuerpo: JSON.parse(texto) as Record<string, unknown>,
    cacheControl: res.headers.get("cache-control"),
  };
}

beforeEach(() => {
  base = {
    company_profiles: [version(V1, 1, "published")],
    profile_icp: [icp(V1, "Clínicas dentales de Estocolmo con dos sedes")],
    // Sembradas en un orden que NO es el de `position`, y con dos empates en
    // `position` cuyo orden alfabético tampoco es el de inserción: así «sin
    // ordenar», «sólo por nombre» y «sin desempate» dan, cada uno, otra lista.
    // La primera siembra tenía el orden alfabético igual al de `position`, y la
    // mutación que sacaba el orden por `position` SOBREVIVIÓ (M25, 2026-10-07).
    profile_offers: [
      oferta(V1, "Auditoría GBP", 2),
      oferta(V1, "SEO local", 1),
      oferta(V1, "Contenido", 1),
    ],
  };
  errores = {};
  consultas = [];
  filtrosIgnorados = false;
  createSupabaseAdminClient.mockImplementation(() => ({ from: (tabla: string) => consultar(tabla) }));
  createSupabaseAdminClient.mockClear();
  process.env.VULKAN_PROFILE_READ_SECRET = SECRETO;
  vi.spyOn(Date, "now").mockReturnValue(AHORA * 1000);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VULKAN_PROFILE_READ_SECRET;
});

// ─── 1. el contrato ───────────────────────────────────────────────────────────

describe("1. el verificador implementa EL CONTRATO, medido con oráculos de afuera", () => {
  it("el vector de openssl del contrato verifica, por la función y por la ruta", async () => {
    const { verificarFirmaDeLectura } = await import(
      "@/lib/integrations/leadEngine/profileReadSignature"
    );
    expect(
      verificarFirmaDeLectura({
        organizationId: VECTOR.org,
        businessId: VECTOR.negocio,
        timestamp: VECTOR.ts,
        firma: VECTOR.firma,
        secreto: VECTOR.secreto,
        ahoraSegundos: Number(VECTOR.ts),
      })
    ).toEqual({ ok: true });

    const r = await pedir({ firma: VECTOR.firma });
    expect(r.status).toBe(200);
  });

  it("el vector con el que firma el test del Lead Engine verifica, por la función y por la ruta", async () => {
    const { verificarFirmaDeLectura } = await import(
      "@/lib/integrations/leadEngine/profileReadSignature"
    );
    const v = VECTOR_DEL_LEAD_ENGINE;
    expect(firmarComoLeadEngine(v.org, v.negocio, v.ts, v.secreto)).toBe(v.firma);
    expect(
      verificarFirmaDeLectura({
        organizationId: v.org,
        businessId: v.negocio,
        timestamp: v.ts,
        firma: v.firma,
        secreto: v.secreto,
        ahoraSegundos: Number(v.ts),
      })
    ).toEqual({ ok: true });

    process.env.VULKAN_PROFILE_READ_SECRET = v.secreto;
    vi.spyOn(Date, "now").mockReturnValue(Number(v.ts) * 1000);
    base.company_profiles = [version(V1, 1, "published", v.org, v.negocio)];
    base.profile_icp = [icp(V1, "ICP del vector", v.org)];
    const r = await pedir({ org: v.org, negocio: v.negocio, ts: v.ts, firma: v.firma });
    expect(r.status).toBe(200);
    expect(r.cuerpo.organization_id).toBe(v.org);
  });

  it("la firma escrita desde el texto del contrato es la del vector (el test no se engaña a sí mismo)", () => {
    // Si `firmarComoLeadEngine` estuviera mal copiada del contrato, todo lo de
    // abajo mediría contra una firma inventada. Se ata al vector de openssl.
    expect(firmarComoLeadEngine(VECTOR.org, VECTOR.negocio, VECTOR.ts, VECTOR.secreto)).toBe(
      VECTOR.firma
    );
  });

  it("el path y los saltos de línea son parte del mensaje", async () => {
    // Sin el path, o con otro separador, la firma del Lead Engine no verifica.
    const sinPath = createHmac("sha256", SECRETO)
      .update(`GET\n${ORG}\n${NEGOCIO}\n${AHORA}`, "utf8")
      .digest("hex");
    const otroSeparador = createHmac("sha256", SECRETO)
      .update(`GET /api/profile/published ${ORG} ${NEGOCIO} ${AHORA}`, "utf8")
      .digest("hex");

    expect((await pedir({ firma: sinPath })).status).toBe(401);
    expect((await pedir({ firma: otroSeparador })).status).toBe(401);
  });
});

// ─── 2. falla cerrado ─────────────────────────────────────────────────────────

describe("2. sin secreto de este lado, 503 y no se lee nada", () => {
  it.each([
    ["ausente", undefined],
    ["vacío", ""],
    ["en blanco", "   "],
  ])("secreto %s: 503 «sin-secreto», y el cliente de servicio no se crea", async (_caso, valor) => {
    if (valor === undefined) delete process.env.VULKAN_PROFILE_READ_SECRET;
    else process.env.VULKAN_PROFILE_READ_SECRET = valor;

    // Firmado con el secreto vacío, que es lo que un atacante probaría primero.
    const r = await pedir({ firma: firmarComoLeadEngine(ORG, NEGOCIO, String(AHORA), valor ?? "") });

    expect(r.status).toBe(503);
    expect(r.cuerpo).toEqual({ error: "sin-secreto" });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(consultas).toHaveLength(0);
  });
});

// ─── 3 y 4. lo que la firma cubre, y que se mira antes de leer ────────────────

describe("3. lo que la firma cubre, y 4. que se verifica ANTES de crear el cliente de servicio", () => {
  const casos: Array<[string, Pedido]> = [
    ["sin cabeceras", { ts: null, firma: null }],
    ["sin firma", { firma: null }],
    ["sin timestamp", { ts: null, firma: firmarComoLeadEngine(ORG, NEGOCIO, "", SECRETO) }],
    ["firmada con otro secreto", { firma: firmarComoLeadEngine(ORG, NEGOCIO, String(AHORA), "otro") }],
    [
      "firmada para otro negocio (la query cambió)",
      { firma: firmarComoLeadEngine(ORG, OTRO_NEGOCIO, String(AHORA), SECRETO) },
    ],
    [
      "firmada para otra organización (la query cambió)",
      { firma: firmarComoLeadEngine(OTRA_ORG, NEGOCIO, String(AHORA), SECRETO) },
    ],
    [
      "firmada para otra hora que la de la cabecera",
      { firma: firmarComoLeadEngine(ORG, NEGOCIO, String(AHORA - 1), SECRETO) },
    ],
    [
      "con el prefijo `sha256=` del webhook",
      { firma: "sha256=" + firmarComoLeadEngine(ORG, NEGOCIO, String(AHORA), SECRETO) },
    ],
    [
      "en mayúsculas",
      { firma: firmarComoLeadEngine(ORG, NEGOCIO, String(AHORA), SECRETO).toUpperCase() },
    ],
    ["recortada", { firma: firmarComoLeadEngine(ORG, NEGOCIO, String(AHORA), SECRETO).slice(2) }],
    ["con milisegundos en vez de segundos", { ts: String(AHORA * 1000) }],
    ["con un timestamp que no es un número", { ts: "ayer" }],
  ];

  it.each(casos)("%s: 401, el mismo cuerpo, y la base ni se toca", async (_caso, pedido) => {
    const r = await pedir(pedido);

    expect(r.status).toBe(401);
    // Un solo cuerpo para todos los motivos: decir cuál falló es dar el mapa.
    expect(r.cuerpo).toEqual({ error: "firma-rechazada" });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(consultas).toHaveLength(0);
  });

  it("la ventana es de 300 s, en los dos sentidos, con los bordes adentro", async () => {
    // Anti-vacuidad: la misma firma, en el centro de la ventana, pasa.
    expect((await pedir()).status).toBe(200);

    for (const [desfase, esperado] of [
      [-300, 200],
      [300, 200],
      [-301, 401],
      [301, 401],
    ] as const) {
      const ts = String(AHORA + desfase);
      const r = await pedir({ ts });
      expect(r.status, `timestamp ${desfase} s respecto del reloj`).toBe(esperado);
    }
  });

  it("un pedido capturado no se repite seis minutos después", async () => {
    const capturada = firmarComoLeadEngine(ORG, NEGOCIO, String(AHORA), SECRETO);
    expect((await pedir({ firma: capturada })).status).toBe(200);

    vi.spyOn(Date, "now").mockReturnValue((AHORA + 360) * 1000);
    expect((await pedir({ firma: capturada })).status).toBe(401);
  });

  it.each<[string, Pedido]>([
    ["un id que no es uuid", { negocio: "no-es-un-uuid" }],
    ["sin business_id", { negocio: null }],
    ["sin organization_id", { org: null }],
  ])("firmado, con %s: 400 «parametros-invalidos», y sin crear el cliente de servicio", async (_caso, pedido) => {
    const r = await pedir(pedido);

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual({ error: "parametros-invalidos" });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

// ─── 5. qué lee ───────────────────────────────────────────────────────────────

describe("5. lee la versión publicada de ESE par, y el ICP y la oferta de ESA versión", () => {
  it("200 con la forma exacta del contrato, la oferta ordenada por `position`, y `no-store`", async () => {
    const r = await pedir();

    expect(r.status).toBe(200);
    expect(r.cacheControl).toBe("no-store");
    expect(r.cuerpo).toEqual({
      organization_id: ORG,
      business_id: NEGOCIO,
      version_id: V1,
      version: 1,
      published_at: "2026-09-01T10:00:00+00:00",
      icp: {
        definition: "Clínicas dentales de Estocolmo con dos sedes",
        disqualifiers: "cadenas de más de 20 sedes",
        buying_trigger: "abren una segunda sede",
        budget_band: "2-5k SEK/mes",
      },
      offers: [
        {
          name: "Contenido",
          description: "descripción de Contenido",
          price_band: "media",
          promise: "promesa de Contenido",
        },
        {
          name: "SEO local",
          description: "descripción de SEO local",
          price_band: "media",
          promise: "promesa de SEO local",
        },
        {
          name: "Auditoría GBP",
          description: "descripción de Auditoría GBP",
          price_band: "media",
          promise: "promesa de Auditoría GBP",
        },
      ],
    });
  });

  it("las tres consultas nombran el tenant; la versión, el par y el estado; las hijas, la versión", async () => {
    await pedir();

    const porTabla = Object.fromEntries(consultas.map((c) => [c.tabla, c]));
    expect(consultas.map((c) => c.tabla).sort()).toEqual([
      "company_profiles",
      "profile_icp",
      "profile_offers",
    ]);

    expect(porTabla.company_profiles.filtros).toEqual([
      ["organization_id", ORG],
      ["business_id", NEGOCIO],
      ["status", "published"],
    ]);
    expect(porTabla.company_profiles.terminal).toBe("maybeSingle");
    expect(columnasDe(porTabla.company_profiles.columnas).sort()).toEqual([
      "business_id",
      "id",
      "organization_id",
      "published_at",
      "version",
    ]);

    for (const hija of ["profile_icp", "profile_offers"]) {
      expect(Object.fromEntries(porTabla[hija].filtros), hija).toEqual({
        organization_id: ORG,
        profile_id: V1,
      });
      expect(porTabla[hija].filtros, hija).toHaveLength(2);
    }
    expect(porTabla.profile_icp.terminal).toBe("maybeSingle");
  });

  it("un negocio que no es de esa organización es indistinguible de uno inexistente: 404", async () => {
    // La ficha existe, pero es del negocio en OTRA organización. Firmado bien.
    base.company_profiles = [version(V1, 1, "published", OTRA_ORG, NEGOCIO)];
    base.profile_icp = [icp(V1, "el ICP de otra organización", OTRA_ORG)];

    const ajeno = await pedir();
    const inexistente = await pedir({ negocio: OTRO_NEGOCIO });

    expect(ajeno.status).toBe(404);
    expect(ajeno.cuerpo).toEqual({ error: "sin-version-publicada" });
    expect(ajeno.texto).toBe(inexistente.texto);
    expect(ajeno.texto).not.toContain("otra organización");
  });

  it("sólo la PUBLICADA: un borrador y una superada no se sirven", async () => {
    base.company_profiles = [version(V1, 1, "superseded"), version(V2, 2, "draft")];
    base.profile_icp = [icp(V1, "ICP superado"), icp(V2, "ICP en borrador")];

    const r = await pedir();

    expect(r.status).toBe(404);
    expect(r.cuerpo).toEqual({ error: "sin-version-publicada" });
    // Sin versión no se buscan las hijas: no hay id del que colgarlas.
    expect(consultas.map((c) => c.tabla)).toEqual(["company_profiles"]);
  });

  it("una versión publicada sin ICP se sirve con `icp: null`, nunca con un ICP inventado", async () => {
    // Hay un ICP, pero de OTRA versión: no se toma prestado.
    base.profile_icp = [icp(V2, "el ICP de otra versión")];

    const r = await pedir();

    expect(r.status).toBe(200);
    expect(r.cuerpo.version_id).toBe(V1);
    expect(r.cuerpo.icp).toBeNull();
    expect(r.texto).not.toContain("otra versión");
  });

  it("un `definition` en blanco se sirve tal cual: este lado no lo rellena ni lo vuelve null", async () => {
    // El bloque dice que `icp` es null SÓLO sin fila. Con fila y definición en
    // blanco, quien le pone nombre (`sin-icp`) es el Lead Engine; si este lado
    // la cambiara por otra cosa, la cita del reporte y la del prompt dirían
    // versiones distintas de la misma ficha.
    base.profile_icp = [icp(V1, "  \n\t ")];

    const r = await pedir();

    expect(r.status).toBe(200);
    expect((r.cuerpo.icp as Record<string, unknown>).definition).toBe("  \n\t ");
  });

  it("una oferta sin nombre se sirve tal cual, y no tumba la ficha", async () => {
    // `profile_offers.name` es NOT NULL y admite `''`. Qué hacer con ella lo
    // decide el consumidor (el Lead Engine la deja afuera); este lado no
    // esconde filas de la versión que cita.
    base.profile_offers = [oferta(V1, "SEO local", 1), oferta(V1, "", 2)];

    const r = await pedir();

    expect(r.status).toBe(200);
    expect((r.cuerpo.icp as Record<string, unknown>).definition).toBe(
      "Clínicas dentales de Estocolmo con dos sedes"
    );
    expect((r.cuerpo.offers as Array<{ name: string }>).map((o) => o.name)).toEqual(["SEO local", ""]);
  });
});

// ─── 6. ausencia no es fallo ──────────────────────────────────────────────────

describe("6. un fallo de lectura es 502, no 404, y no lleva el detalle de Postgres", () => {
  it.each(["company_profiles", "profile_icp", "profile_offers"])(
    "falla %s: 502 «lectura-fallida», sin código ni mensaje",
    async (tabla) => {
      errores[tabla] = { code: "42P01", message: `relation "public.${tabla}" does not exist` };

      const r = await pedir();

      expect(r.status).toBe(502);
      expect(r.cuerpo).toEqual({ error: "lectura-fallida" });
      expect(r.texto).not.toContain("42P01");
      expect(r.texto).not.toContain("relation");
      expect(r.texto).not.toContain(tabla);
    }
  );

  it("dos versiones publicadas —imposible por índice— son un fallo, no una elegida al azar", async () => {
    base.company_profiles.push(version(V2, 2, "published"));

    const r = await pedir();

    expect(r.status).toBe(502);
    expect(r.cuerpo).toEqual({ error: "lectura-fallida" });
  });

  it("falta SUPABASE_SERVICE_ROLE_KEY y crear el cliente TIRA: 502 «lectura-fallida», no un 500 ni el mensaje", async () => {
    // Es lo que hace `createClient` de supabase-js sin la clave (medido por la
    // revisión del 2026-10-07 con el módulo real: ver sinLlaveDeServicio.test.ts).
    createSupabaseAdminClient.mockImplementation(() => {
      throw new Error("supabaseKey is required.");
    });

    const r = await pedir();

    expect(r.status).toBe(502);
    expect(r.cuerpo).toEqual({ error: "lectura-fallida" });
    expect(r.texto).not.toContain("supabaseKey");
  });

  it("si la consulta misma tira (no devuelve `error`, TIRA): también 502", async () => {
    createSupabaseAdminClient.mockImplementation(() => ({
      from: () => {
        throw new TypeError("fetch failed");
      },
    }));

    const r = await pedir();

    expect(r.status).toBe(502);
    expect(r.cuerpo).toEqual({ error: "lectura-fallida" });
    expect(r.texto).not.toContain("fetch failed");
  });
});

// ─── 7. la puerta H1.3, del lado de Growth OS ─────────────────────────────────

describe("7. cambiar el ICP una vez cambia lo que lee el Lead Engine (nonce)", () => {
  it("publicar otra versión con otro ICP cambia el ICP y el version_id servidos", async () => {
    const nonceA = `nonce-${Math.random().toString(36).slice(2)}-a`;
    const nonceB = `nonce-${Math.random().toString(36).slice(2)}-b`;
    base.profile_icp = [icp(V1, `ICP ${nonceA}`)];

    const a = await pedir();
    expect(a.status).toBe(200);
    expect(a.texto).toContain(nonceA);
    expect(a.cuerpo.version_id).toBe(V1);

    // Cambiar el ICP, desde la `0027`, es publicar una versión nueva: la 1 pasa
    // a superada (su fila no se edita) y la 2 lleva el ICP nuevo.
    base.company_profiles = [version(V1, 1, "superseded"), version(V2, 2, "published")];
    base.profile_icp = [icp(V1, `ICP ${nonceA}`), icp(V2, `ICP ${nonceB}`)];

    const b = await pedir();
    expect(b.status).toBe(200);
    expect(b.texto).toContain(nonceB);
    expect(b.texto).not.toContain(nonceA);
    expect(b.cuerpo.version_id).toBe(V2);
    expect(b.cuerpo.version).toBe(2);
  });

  it("sin versión publicada, 404 con nombre: nada que el Lead Engine pueda usar como ICP", async () => {
    base.company_profiles = [];

    const r = await pedir();

    expect(r.status).toBe(404);
    expect(r.cuerpo).toEqual({ error: "sin-version-publicada" });
    expect(r.cuerpo).not.toHaveProperty("icp");
  });
});

// ─── 8. la fila es del par pedido ─────────────────────────────────────────────

describe("8. la fila tiene que ser del par pedido, y los ids del 200 son los de la FILA", () => {
  it("si la base deja de filtrar por tenant, 502 y nunca el ICP de otro cliente", async () => {
    // El escenario de la revisión del 2026-10-07: sin los `.eq`, la única
    // versión publicada que hay es la de OTRO cliente. Antes: 200 con su ICP y
    // con los ids de la query, que el chequeo de eco del Lead Engine aceptaba.
    filtrosIgnorados = true;
    base.company_profiles = [version(V1, 5, "published", OTRA_ORG, OTRO_NEGOCIO)];
    base.profile_icp = [icp(V1, "ICP AJENO FOREIGN-NONCE-55", OTRA_ORG)];
    base.profile_offers = [];

    const r = await pedir();

    expect(r.status).toBe(502);
    expect(r.cuerpo).toEqual({ error: "lectura-fallida" });
    expect(r.texto).not.toContain("FOREIGN-NONCE");
  });

  it("tampoco pasa la fila de la misma organización y OTRO negocio", async () => {
    filtrosIgnorados = true;
    base.company_profiles = [version(V1, 5, "published", ORG, OTRO_NEGOCIO)];
    base.profile_icp = [icp(V1, "ICP DE OTRO NEGOCIO-NONCE-56")];

    const r = await pedir();

    expect(r.status).toBe(502);
    expect(r.texto).not.toContain("NONCE-56");
  });

  it("ni la de OTRA organización con el mismo negocio: se comparan los dos ids, no uno", async () => {
    // Con la FK compuesta de la `0026` esta fila no puede existir; lo que se
    // mide es que la comparación mire el par entero.
    filtrosIgnorados = true;
    base.company_profiles = [version(V1, 5, "published", OTRA_ORG, NEGOCIO)];
    base.profile_icp = [icp(V1, "ICP DE OTRA ORGANIZACION-NONCE-57", OTRA_ORG)];

    const r = await pedir();

    expect(r.status).toBe(502);
    expect(r.texto).not.toContain("NONCE-57");
  });

  it("anti-vacuidad: con la misma base que no filtra y la fila SÍ del par, se sirve", async () => {
    // Si el 502 de arriba saliera de otra cosa que la comparación del par, esto
    // también daría 502.
    filtrosIgnorados = true;

    const r = await pedir();

    expect(r.status).toBe(200);
    expect(r.cuerpo.version_id).toBe(V1);
  });

  it("pedida en mayúsculas, vuelve con los ids como los guarda Postgres: los de la fila, no los de la query", async () => {
    const r = await pedir({ org: ORG.toUpperCase(), negocio: NEGOCIO.toUpperCase() });

    expect(r.status).toBe(200);
    expect(r.cuerpo.organization_id).toBe(ORG);
    expect(r.cuerpo.business_id).toBe(NEGOCIO);
    // Anti-vacuidad: la query de verdad iba en mayúsculas.
    expect(ORG.toUpperCase()).not.toBe(ORG);
  });
});

// ─── 9. nada fuera del contrato ───────────────────────────────────────────────

/**
 * El 200 del bloque del contrato, transcripto a una validación desde el TEXTO
 * (no importa la ruta): los siete campos, `icp` como objeto o `null`, cada
 * oferta con sus cuatro campos, y nada más (`strict`). Los opcionales del ICP
 * y de la oferta pueden ser null porque sus columnas lo son.
 */
const CUERPO_DEL_CONTRATO = z
  .object({
    organization_id: z.string().uuid(),
    business_id: z.string().uuid(),
    version_id: z.string().min(1),
    version: z.number().int().positive(),
    published_at: z.string().min(1),
    icp: z
      .object({
        definition: z.string(),
        disqualifiers: z.string().nullable(),
        buying_trigger: z.string().nullable(),
        budget_band: z.string().nullable(),
      })
      .strict()
      .nullable(),
    offers: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().nullable(),
          price_band: z.string().nullable(),
          promise: z.string().nullable(),
        })
        .strict()
    ),
  })
  .strict();

/**
 * Los otros status del bloque, cada uno con el único cuerpo que el bloque le
 * da. 401 y 503 también están en el bloque; estos estados no los alcanzan
 * (los miden los bloques 2 y 3).
 */
const ERRORES_DEL_CONTRATO: Record<number, string> = {
  400: "parametros-invalidos",
  404: "sin-version-publicada",
  502: "lectura-fallida",
};

describe("9. todo lo que la ruta contesta está DENTRO del contrato", () => {
  const sinNulos = (f: Fila): Fila => ({ ...f, disqualifiers: null, buying_trigger: null, budget_band: null });
  const estados: Array<[string, () => void, Pedido?]> = [
    ["la ficha completa", () => {}],
    ["sin fila de ICP", () => (base.profile_icp = [])],
    ["ICP con definition vacío", () => (base.profile_icp = [icp(V1, "")])],
    ["ICP con definition en blanco", () => (base.profile_icp = [icp(V1, " \t ")])],
    ["ICP con los opcionales en null", () => (base.profile_icp = [sinNulos(icp(V1, "ICP mínimo"))])],
    ["sin ofertas", () => (base.profile_offers = [])],
    [
      "ofertas sin nombre y con opcionales en null",
      () =>
        (base.profile_offers = [
          { ...oferta(V1, "", 1), description: null, price_band: null, promise: null },
          { ...oferta(V1, "Sólo nombre", 2), description: null, price_band: null, promise: null },
          oferta(V1, " ", 3),
        ]),
    ],
    ["sin versión publicada", () => (base.company_profiles = [version(V1, 1, "draft")])],
    ["el negocio de otra organización", () => (base.company_profiles = [version(V1, 1, "published", OTRA_ORG)])],
    [
      "la base no filtra y la única fila es de otro cliente",
      () => {
        filtrosIgnorados = true;
        base.company_profiles = [version(V1, 1, "published", OTRA_ORG, OTRO_NEGOCIO)];
      },
    ],
    ["falla la lectura del ICP", () => (errores.profile_icp = { code: "XX000", message: "x" })],
    ["dos publicadas", () => base.company_profiles.push(version(V2, 2, "published"))],
    [
      "crear el cliente tira",
      () =>
        createSupabaseAdminClient.mockImplementation(() => {
          throw new Error("supabaseKey is required.");
        }),
    ],
    ["un id que no es uuid", () => {}, { negocio: "abc" }],
    ["en mayúsculas", () => {}, { org: ORG.toUpperCase(), negocio: NEGOCIO.toUpperCase() }],
  ];

  it.each(estados)("%s", async (_caso, preparar, pedido) => {
    preparar();

    const r = await pedir(pedido);

    if (r.status === 200) {
      const forma = CUERPO_DEL_CONTRATO.safeParse(r.cuerpo);
      expect(forma.success, forma.success ? "" : forma.error.message).toBe(true);
      // Y es la ficha que se pidió: el chequeo de eco del Lead Engine.
      expect(String(r.cuerpo.organization_id)).toBe(ORG);
      expect(String(r.cuerpo.business_id)).toBe(NEGOCIO);
    } else {
      expect(Object.keys(ERRORES_DEL_CONTRATO)).toContain(String(r.status));
      expect(r.cuerpo).toEqual({ error: ERRORES_DEL_CONTRATO[r.status] });
    }
  });

  it("anti-vacuidad: la tabla de estados pasa por 200, 400, 404 y 502", async () => {
    const vistos = new Set<number>();
    for (const [, preparar, pedido] of estados) {
      base = {
        company_profiles: [version(V1, 1, "published")],
        profile_icp: [icp(V1, "Clínicas dentales de Estocolmo con dos sedes")],
        profile_offers: [oferta(V1, "SEO local", 1)],
      };
      errores = {};
      filtrosIgnorados = false;
      createSupabaseAdminClient.mockImplementation(() => ({ from: (tabla: string) => consultar(tabla) }));
      preparar();
      vistos.add((await pedir(pedido)).status);
    }
    expect([...vistos].sort()).toEqual([200, 400, 404, 502]);
  });
});

/**
 * LA MEDICIÓN — `scripts/mutar.sh`, 2026-10-07, cada mutación sola contra el
 * árbol entero (832 tests, 85 archivos). Bloque que cae en ESTE archivo, y
 * aparte el barrido de superficie (`precondicionRutas.test.ts`) cuando cae:
 *
 *   profileReadSignature.ts                                  cae
 *   ──────────────────────────────────────────────────────── ───────────────
 *   sin secreto devuelve `{ ok: true }`                      2 (los tres)
 *   un secreto en blanco cuenta como secreto                 2 (en blanco)
 *   el borde de la ventana queda afuera (> pasa a >=)        3 (ventana)
 *   la ventana de un solo sentido (sin Math.abs)             3 (ventana)
 *   el path sale del mensaje firmado                         1, 3, 5, 6, 7
 *   el business_id sale del mensaje firmado                  1, 3, 5, 6, 7
 *   acepta hex en mayúsculas                                 3 (mayúsculas)
 *   `timingSafeEqual` pasa a `Buffer.equals`                 sólo el barrido
 *                                                            (la huella): el
 *                                                            comportamiento
 *                                                            es igual y el
 *                                                            tiempo no se mide
 *   el tope del timestamp sube a 13 dígitos                  SOBREVIVE:
 *                                                            equivalente, la
 *                                                            ventana ya lo
 *                                                            rechaza (dicho
 *                                                            al lado del código)
 *
 *   route.ts                                                 cae
 *   ──────────────────────────────────────────────────────── ───────────────
 *   la ruta no mira el veredicto                             2, 3 y el barrido
 *   el cliente de servicio se crea antes de verificar        2, 3 y el barrido
 *   sin secreto contesta 401 y no 503                        2
 *   sin la validación de uuid                                3 (uuid)
 *   un fallo de lectura se presenta como 404                 6
 *   el 502 lleva el código de Postgres                       6
 *   sin `no-store`                                           5 (forma)
 *   la respuesta no lleva el version_id leído                5, 7
 *
 *   fichaPublicada.ts (la lectura que comparte con el reporte)
 *   ──────────────────────────────────────────────────────── ───────────────
 *   la versión se busca sin `organization_id`                5 (consultas, par ajeno)
 *   la versión publicada pasa a ser la borrador              1, 3, 5, 6, 7
 *   el ICP se busca sin el tenant                            5 (consultas)
 *   el ICP se busca por la empresa y no por la versión       5, 7
 *   `.maybeSingle()` del ICP pasa a `.single()`              5 (consultas, sin ICP)
 *   un error del ICP se ignora                               6 (profile_icp)
 *   un error de la oferta se ignora                          6 (profile_offers)
 *   la oferta sin ordenar por `position`                     5 (forma) *
 *   sin desempate por nombre                                 5 (forma)
 *   la oferta tal como llega, sin `sort`                     5 (forma)
 *
 * (*) Ésta SOBREVIVIÓ en la primera corrida: la siembra tenía el orden
 * alfabético igual al de `position`, así que ordenar sólo por nombre daba la
 * misma lista. Se cambió la siembra (ver `beforeEach`) y se volvió a medir.
 *
 * LA REVISIÓN — `scripts/mutar.sh`, 2026-10-08, cada mutación sola contra el
 * árbol entero (875 tests, 88 archivos). Lo que agregaron los hallazgos:
 *
 *   route.ts                                                 cae
 *   ──────────────────────────────────────────────────────── ───────────────
 *   G-R1 la lectura sale del `try` (crear el cliente tira)   6 (los dos que
 *                                                            tiran), 9 (tira y
 *                                                            anti-vacuidad) y
 *                                                            sinLlaveDeServicio
 *   G-R2 el 502 del `catch` lleva el mensaje                 6 (los dos), 9 y
 *                                                            sinLlaveDeServicio
 *   G-R3 `organization_id` del 200 sale de la query          8 y 9 (mayúsculas)
 *   G-R4 `business_id` del 200 sale de la query              8 y 9 (mayúsculas)
 *
 *   fichaPublicada.ts
 *   ──────────────────────────────────────────────────────── ───────────────
 *   G-F1 sin la comparación del par                          8 (los tres
 *                                                            ajenos), 9 y el
 *                                                            orquestador (12)
 *   G-F2 el par se compara sólo por organización             8 (otro negocio)
 *                                                            y orquestador (12)
 *   G-F3 el par se compara sólo por negocio                  8 (otra org.)
 *   G-F4 el par se compara con mayúsculas                    8 (mayúsculas)
 *   G-F5 la versión se lee sin su par                        20: 1, 3, 5, 7, 8,
 *                                                            9 y el orquestador
 *
 * Y antes del arreglo, en 836f89f, los bloques 6, 8 y 9 de este archivo daban
 * 11 rojos (copiados sobre ese árbol el 2026-10-08): el 500 de «supabaseKey is
 * required.», el 200 con el ICP de otro cliente y los ids de la query.
 */
