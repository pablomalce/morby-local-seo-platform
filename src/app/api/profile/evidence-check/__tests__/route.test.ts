/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que `POST /api/profile/evidence-check` —la corrida a mano de H1.4— salga a la
 * red sin sesión, chequee o escriba la ficha de otra organización, cuente un
 * denominador que no es el de PostgreSQL, o le muestre al navegador un error de
 * Postgres.
 *
 * EL DOBLE DE LA BASE RECORRE LA CONSULTA (R13)
 *
 * No contesta «la fila que el test quiere»: guarda TABLAS, aplica los `eq` y los
 * `in` que la ruta manda, calcula `count: "exact"` sobre lo filtrado, y del lado
 * de la sesión aplica una RLS (sólo las organizaciones donde quien llama es
 * miembro ACTIVO). Así, si la ruta se olvida de un filtro, el doble lo nota: la
 * respuesta cambia. Y `rlsRota` apaga esa RLS para medir lo único que la RLS no
 * puede probar: que la ruta verifica la organización EN CÓDIGO antes de escribir
 * con `service_role` (§12.3 del director).
 *
 * La escritura del doble de `service_role` imita la decisión 9 de la `0027`: en
 * `profile_evidence` sólo entran `last_checked_at` y `last_status`; cualquier
 * otra columna es el 45002 del guard.
 *
 * `url_host` del doble es la misma expresión que la función SQL de la `0026`,
 * traducida. Su oráculo es la función de verdad: los casos que este archivo usa
 * se midieron contra la réplica (ver el commit).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEGOCIO_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const NEGOCIO_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const ALICIA = "11111111-1111-4111-8111-111111111111";
const BRUNO = "22222222-2222-4222-8222-222222222222";
const CARLA = "33333333-3333-4333-8333-333333333333";
const IP_PUBLICA = "93.184.216.34";
const SECRETO_DE_POSTGRES = 'violates check constraint "constraint_secreta" of relation "profile_evidence"';

type Fila = Record<string, unknown>;
type Filtro = { op: "eq" | "in"; col: string; val: unknown };

const estado = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
  tablas: {} as Record<string, Fila[]>,
  rlsRota: false,
  errores: {} as Record<string, { code: string; message: string }>,
  recortes: {} as Record<string, number>,
  sinCount: {} as Record<string, boolean>,
  lecturas: [] as string[],
  escrituras: [] as Array<{ tabla: string; valores: Fila; filtros: Filtro[]; filas: number }>,
  adminCreado: 0,
  red: [] as string[],
  dns: new Map<string, string[]>(),
  sitios: new Map<string, number>(),
  rpcs: [] as Array<{ nombre: string; args: Record<string, unknown> }>,
}));

/** La `url_host` de la 0026, traducida expresión por expresión. */
function urlHost(url: string | null): string {
  const tras = (url ?? "").split("://")[1] ?? "";
  return tras.split("/")[0].replace(/^[^@/]*@/, "").split(":")[0].toLowerCase();
}

function orgsActivas(usuario: string | undefined): string[] {
  return (estado.tablas.org_members ?? [])
    .filter((m) => m.user_id === usuario && m.state === "active")
    .map((m) => m.organization_id as string);
}

function consulta(tabla: string, conRls: boolean) {
  const filtros: Filtro[] = [];
  let opciones: { count?: string } | undefined;
  let valores: Fila | null = null;

  const visibles = () => {
    let filas = estado.tablas[tabla] ?? [];
    if (conRls && !estado.rlsRota) {
      const orgs = orgsActivas(estado.usuario?.id);
      filas = filas.filter((f) => orgs.includes(f.organization_id as string));
    }
    return filas.filter((f) =>
      filtros.every((c) => (c.op === "eq" ? f[c.col] === c.val : (c.val as unknown[]).includes(f[c.col])))
    );
  };

  const leer = () => {
    estado.lecturas.push(tabla);
    const error = estado.errores[tabla];
    if (error) return { data: null, error, count: null };
    const todas = visibles();
    const recorte = estado.recortes[tabla];
    const devueltas = recorte === undefined ? todas : todas.slice(0, recorte);
    const count = opciones?.count === "exact" && !estado.sinCount[tabla] ? todas.length : null;
    return { data: devueltas.map((f) => ({ ...f })), error: null, count };
  };

  const escribir = () => {
    const error = estado.errores[`update:${tabla}`];
    if (error) return { data: null, error, count: null };
    // La decisión 9 de la 0027: sobre la evidencia, sólo la medición.
    const permitidas = ["last_checked_at", "last_status"];
    if (tabla === "profile_evidence" && Object.keys(valores ?? {}).some((k) => !permitidas.includes(k))) {
      return { data: null, error: { code: "45002", message: "profile_evidence de una version publicada" }, count: null };
    }
    const filas = visibles();
    for (const f of filas) Object.assign(f, valores);
    estado.escrituras.push({ tabla, valores: { ...valores }, filtros: [...filtros], filas: filas.length });
    return { data: null, error: null, count: opciones?.count === "exact" ? filas.length : null };
  };

  const q = {
    select(_columnas: string, o?: { count?: string }) {
      opciones = o;
      return q;
    },
    update(v: Fila, o?: { count?: string }) {
      valores = v;
      opciones = o;
      return q;
    },
    eq(col: string, val: unknown) {
      filtros.push({ op: "eq", col, val });
      return q;
    },
    in(col: string, val: unknown[]) {
      filtros.push({ op: "in", col, val });
      return q;
    },
    async maybeSingle() {
      const r = leer();
      if (r.error) return { data: null, error: r.error };
      if ((r.data ?? []).length > 1) return { data: null, error: { code: "PGRST116", message: "varias filas" } };
      return { data: (r.data ?? [])[0] ?? null, error: null };
    },
    then(ok: (v: unknown) => unknown, mal?: (e: unknown) => unknown) {
      return Promise.resolve(valores ? escribir() : leer()).then(ok, mal);
    },
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuario }, error: null }) },
    from: (tabla: string) => consulta(tabla, true),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ nombre, args });
      const error = estado.errores[`rpc:${nombre}`];
      if (error) return { data: null, error };
      if (nombre === "url_host") return { data: urlHost(args.p_url as string), error: null };
      return { data: null, error: { code: "PGRST202", message: "no existe" } };
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    estado.adminCreado++;
    return { from: (tabla: string) => consulta(tabla, false) };
  },
}));

vi.mock("@/lib/profile/nodeTransport", () => ({
  dependenciasDeProduccion: () => ({
    resolver: async (host: string) => {
      estado.red.push(`dns ${host}`);
      const ips = estado.dns.get(host);
      return ips ? { ok: true, direcciones: ips } : { ok: false };
    },
    transporte: async (p: { metodo: string; url: string }) => {
      estado.red.push(`${p.metodo} ${p.url}`);
      return { tipo: "respuesta", status: estado.sitios.get(p.url) ?? 404, location: null };
    },
    sufijoAleatorio: () => "abcdef0123456789",
  }),
}));

const { POST } = await import("../route");

let ip = 0;
function pedido(cuerpo: unknown): Request {
  ip += 1;
  return new Request("http://localhost/api/profile/evidence-check", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.14.${Math.floor(ip / 250)}.${ip % 250}` },
    body: JSON.stringify(cuerpo),
  });
}

function evidencia(id: string, org: string, objetivo: string, url: string, extra: Fila = {}): Fila {
  return {
    id,
    organization_id: org,
    objective_id: objetivo,
    kind: "http",
    url,
    source_host: urlHost(url),
    verified_at: null,
    verified_by: null,
    last_checked_at: null,
    last_status: null,
    ...extra,
  };
}

function sitio(url: string, status = 200) {
  estado.dns.set(new URL(url).hostname, [IP_PUBLICA]);
  estado.sitios.set(url, status);
}

beforeEach(() => {
  estado.usuario = { id: ALICIA };
  estado.rlsRota = false;
  estado.errores = {};
  estado.recortes = {};
  estado.sinCount = {};
  estado.lecturas = [];
  estado.escrituras = [];
  estado.adminCreado = 0;
  estado.red = [];
  estado.dns = new Map();
  estado.sitios = new Map();
  estado.rpcs = [];
  estado.tablas = {
    org_members: [
      { organization_id: ORG_A, user_id: ALICIA, state: "active" },
      { organization_id: ORG_B, user_id: BRUNO, state: "active" },
      { organization_id: ORG_A, user_id: CARLA, state: "archived" },
    ],
    businesses: [
      { id: NEGOCIO_A, organization_id: ORG_A, website: "https://www.ejemplo-a.com" },
      { id: NEGOCIO_B, organization_id: ORG_B, website: "https://ejemplo-b.com" },
    ],
    company_profiles: [
      { id: "perfil-a-1", organization_id: ORG_A, business_id: NEGOCIO_A, version: 1, status: "superseded" },
      { id: "perfil-a-2", organization_id: ORG_A, business_id: NEGOCIO_A, version: 2, status: "published" },
      { id: "perfil-b-1", organization_id: ORG_B, business_id: NEGOCIO_B, version: 1, status: "published" },
    ],
    profile_objectives: [
      { id: "obj-a1", organization_id: ORG_A, profile_id: "perfil-a-2", kind: "claim" },
      { id: "obj-a2", organization_id: ORG_A, profile_id: "perfil-a-2", kind: "goal" },
      { id: "obj-viejo", organization_id: ORG_A, profile_id: "perfil-a-1", kind: "claim" },
      { id: "obj-b1", organization_id: ORG_B, profile_id: "perfil-b-1", kind: "claim" },
    ],
    profile_evidence: [
      evidencia("ev-a1", ORG_A, "obj-a1", "https://fuente-uno.org/informe"),
      evidencia("ev-a2", ORG_A, "obj-a2", "https://fuente-dos.org/dato"),
      evidencia("ev-viejo", ORG_A, "obj-viejo", "https://fuente-vieja.org/x"),
      evidencia("ev-b1", ORG_B, "obj-b1", "https://fuente-b.org/y"),
    ],
  };
  sitio("https://fuente-uno.org/informe");
  sitio("https://fuente-dos.org/dato");
  sitio("https://fuente-vieja.org/x");
  sitio("https://fuente-b.org/y");
});

const fila = (id: string) => (estado.tablas.profile_evidence ?? []).find((f) => f.id === id) as Fila;
const transporte = () => estado.red.filter((r) => !r.startsWith("dns "));

// ─────────────────────────────────────────────────────────────────────────────

describe("quién puede correrlo", () => {
  it("sin sesión: 401 antes de leer nada y antes de salir a la red", async () => {
    estado.usuario = null;
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(401);
    expect(estado.lecturas).toEqual([]);
    expect(estado.red).toEqual([]);
    expect(estado.adminCreado).toBe(0);
  });

  it("un businessId que no es uuid es 400, sin salir", async () => {
    const res = await POST(pedido({ businessId: "no-es-un-uuid" }));
    expect(res.status).toBe(400);
    expect(estado.red).toEqual([]);
  });

  it("el negocio de otra organización: 404, igual que un id inventado, sin red ni escritura", async () => {
    estado.usuario = { id: BRUNO };
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(404);
    expect(estado.red).toEqual([]);
    expect(estado.adminCreado).toBe(0);
    expect(fila("ev-a1").last_checked_at).toBeNull();
  });

  it("si la RLS dejara ver el negocio ajeno, la membresía EN CÓDIGO igual contesta 404 y no escribe", async () => {
    // §12.3: la ruta escribe con service_role, así que la organización se
    // verifica en código. Con la RLS apagada, esto es lo único que queda.
    estado.rlsRota = true;
    estado.usuario = { id: BRUNO };
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(404);
    expect(estado.red).toEqual([]);
    expect(estado.adminCreado).toBe(0);
    expect(estado.escrituras).toEqual([]);
  });

  it("una membresía ARCHIVADA no alcanza, tampoco con la RLS apagada", async () => {
    estado.rlsRota = true;
    estado.usuario = { id: CARLA };
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(404);
    expect(estado.adminCreado).toBe(0);
  });
});

describe("la corrida", () => {
  it("verde: N del count de la versión PUBLICADA, la línea, y la contraprueba en la misma corrida", async () => {
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();

    expect(cuerpo.motivosRojo).toEqual([]);
    expect(cuerpo.verde).toBe(true);
    // La versión 1 (superada) tiene su propio objetivo y no cuenta.
    expect(cuerpo.n).toBe(2);
    expect(cuerpo.version).toBe(2);
    expect(cuerpo.linea.startsWith("2 afirmaciones, 0 sin evidencia resoluble")).toBe(true);
    expect(cuerpo.contraprueba).toMatchObject({ ok: true, subioNoResuelve: 2 });
    expect(estado.red).toContain("dns evidencia-inventada-abcdef0123456789.invalid");
    expect(transporte().sort()).toEqual(["HEAD https://fuente-dos.org/dato", "HEAD https://fuente-uno.org/informe"]);
    expect(cuerpo.ejecutadoPor).toBe(ALICIA);
  });

  it("escribe SÓLO last_checked_at y last_status, sólo de las filas leídas, con la organización en el filtro", async () => {
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    const cuerpo = await res.json();

    expect(estado.adminCreado).toBe(1);
    expect(estado.escrituras).toHaveLength(1);
    const [escritura] = estado.escrituras;
    expect(Object.keys(escritura.valores).sort()).toEqual(["last_checked_at", "last_status"]);
    expect(escritura.valores.last_status).toBe(200);
    expect(escritura.filtros).toContainEqual({ op: "eq", col: "organization_id", val: ORG_A });
    expect(escritura.filtros).toContainEqual({ op: "in", col: "id", val: ["ev-a1", "ev-a2"] });

    expect(fila("ev-a1")).toMatchObject({ last_status: 200, last_checked_at: cuerpo.ejecutadoEn });
    expect(fila("ev-viejo").last_checked_at, "la versión superada no se toca").toBeNull();
    expect(fila("ev-b1").last_checked_at, "la otra organización no se toca").toBeNull();
    expect(cuerpo.guardado).toEqual({ ok: true, filas: 2, esperadas: 2 });
  });

  it("lo que no se midió no se escribe; lo medido sin respuesta se escribe con status NULL", async () => {
    estado.tablas.profile_evidence = [
      evidencia("ev-a1", ORG_A, "obj-a1", "https://fuente-uno.org/informe"),
      evidencia("ev-sin-dns", ORG_A, "obj-a2", "https://no-existe.org/x"),
      evidencia("ev-manual", ORG_A, "obj-a2", "https://detras-de-login.org/x", {
        kind: "manual",
        verified_at: "2026-10-01T10:00:00Z",
        verified_by: ALICIA,
      }),
      evidencia("ev-propia", ORG_A, "obj-a2", "https://ejemplo-a.com/casos"),
    ];
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();

    const escritas = estado.escrituras.flatMap((e) => (e.filtros.find((f) => f.col === "id")?.val as string[]) ?? []);
    expect(escritas.sort()).toEqual(["ev-a1", "ev-sin-dns"]);
    expect(fila("ev-sin-dns")).toMatchObject({ last_status: null });
    expect(fila("ev-sin-dns").last_checked_at).toBe(cuerpo.ejecutadoEn);
    expect(fila("ev-manual").last_checked_at).toBeNull();
    expect(fila("ev-propia").last_checked_at).toBeNull();
    expect(cuerpo.verde).toBe(false);
    expect(cuerpo.m).toBe(1);
  });

  it("sin versión publicada: N = 0, rojo, y no escribe", async () => {
    estado.tablas.company_profiles = estado.tablas.company_profiles.map((p) =>
      p.id === "perfil-a-2" ? { ...p, status: "draft" } : p
    );
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.n).toBe(0);
    expect(cuerpo.verde).toBe(false);
    expect(cuerpo.motivosRojo).toContain("n-cero");
    expect(cuerpo.version).toBeNull();
    expect(estado.escrituras).toEqual([]);
  });

  it("website vacío: rojo por dominio propio desconocido, y NINGUNA fuente sale a la red", async () => {
    estado.tablas.businesses[0].website = "";
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();
    expect(cuerpo.verde).toBe(false);
    expect(cuerpo.motivosRojo).toContain("dominio-propio-desconocido");
    expect(estado.red).toEqual([]);
    expect(estado.escrituras).toEqual([]);
  });

  it("website sin esquema: la MISMA url_host, con https:// delante, y el propio dominio se reconoce", async () => {
    estado.tablas.businesses[0].website = "ejemplo-a.com";
    estado.tablas.profile_evidence.push(evidencia("ev-propia", ORG_A, "obj-a1", "https://www.ejemplo-a.com/casos"));
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();

    expect(estado.rpcs).toEqual([
      { nombre: "url_host", args: { p_url: "ejemplo-a.com" } },
      { nombre: "url_host", args: { p_url: "https://ejemplo-a.com" } },
    ]);
    expect(cuerpo.fuentes.find((f: { id: string }) => f.id === "ev-propia")).toMatchObject({
      cubeta: "no-resuelve",
      motivo: "origen-propio",
    });
    expect(cuerpo.contraprueba.propia.url).toBe("https://ejemplo-a.com/");
    expect(transporte().some((r) => r.includes("ejemplo-a.com"))).toBe(false);
  });
});

describe("ausencia, cero y fallo", () => {
  it("una página de evidencia cortada es 502 lectura-incompleta, no una afirmación sin evidencia", async () => {
    estado.recortes.profile_evidence = 1;
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, motivo: "lectura-incompleta" });
    expect(estado.red).toEqual([]);
    expect(estado.escrituras).toEqual([]);
  });

  it("una página de afirmaciones cortada también: el denominador es el count, no las filas que llegaron", async () => {
    estado.recortes.profile_objectives = 1;
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(502);
    expect((await res.json()).motivo).toBe("lectura-incompleta");
    expect(estado.red).toEqual([]);
  });

  it("un count que no vino es un fallo, no un cero", async () => {
    estado.sinCount.profile_objectives = true;
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(502);
    expect((await res.json()).motivo).toBe("afirmaciones-ilegibles");
  });

  for (const [donde, motivo] of [
    ["businesses", "negocio-ilegible"],
    ["org_members", "membresia-ilegible"],
    ["company_profiles", "ficha-ilegible"],
    ["profile_objectives", "afirmaciones-ilegibles"],
    ["profile_evidence", "evidencia-ilegible"],
    ["rpc:url_host", "dominio-propio-ilegible"],
  ] as const) {
    it(`un error leyendo ${donde} es 502 «${motivo}», sin el texto de Postgres`, async () => {
      estado.errores[donde] = { code: "XX000", message: SECRETO_DE_POSTGRES };
      const res = await POST(pedido({ businessId: NEGOCIO_A }));
      expect(res.status).toBe(502);
      const texto = await res.text();
      expect(JSON.parse(texto)).toEqual({ ok: false, motivo });
      expect(texto).not.toContain("constraint_secreta");
      expect(estado.escrituras).toEqual([]);
    });
  }

  it("una escritura rechazada no cambia el veredicto, se informa, y sin el texto de Postgres", async () => {
    estado.errores["update:profile_evidence"] = { code: "45002", message: SECRETO_DE_POSTGRES };
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    expect(res.status).toBe(200);
    const texto = await res.text();
    const cuerpo = JSON.parse(texto);
    expect(cuerpo.verde).toBe(true);
    expect(cuerpo.guardado).toMatchObject({ ok: false, filas: 0, esperadas: 2 });
    expect(texto).not.toContain("constraint_secreta");
  });
});
