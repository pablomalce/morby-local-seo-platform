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

/** El vector del contrato, calculado con `openssl dgst -sha256 -hmac`. */
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

function consultar(tabla: string) {
  const q = { tabla, columnas: "*", filtros: [] as [string, unknown][], terminal: "" };
  const resolver = (unica: boolean) => {
    consultas.push(q);
    if (errores[tabla]) return { data: null, error: errores[tabla] };
    const filas = (base[tabla] ?? [])
      .filter((f) => q.filtros.every(([col, val]) => f[col] === val))
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

  it("firmado, pero con un id que no es uuid: 400 y sin crear el cliente de servicio", async () => {
    const r = await pedir({ negocio: "no-es-un-uuid" });

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
      "id",
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
    base.profile_icp = [icp(V2, "el ICP de otra versión")];

    const r = await pedir();

    expect(r.status).toBe(200);
    expect(r.cuerpo.version_id).toBe(V1);
    expect(r.cuerpo.icp).toBeNull();
    expect(r.texto).not.toContain("otra versión");
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
 */
