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
/** El segundo negocio de ORG_A: una agencia con dos clientes es lo normal. */
const NEGOCIO_A2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
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
  redirecciones: new Map<string, string>(),
  /** Lo que pasa en el mundo MIENTRAS la ruta está afuera: corre en el primer pedido HTTP. */
  alSalir: null as null | (() => void),
  /** Si no es null, cuántas filas dice haber tocado cada UPDATE (un trigger que saltea, una fila borrada). */
  cuentaEscrita: null as number | null,
  rpcs: [] as Array<{ nombre: string; args: Record<string, unknown> }>,
  /** Modo demo: sin las envs de Supabase, construir el cliente de sesión tira. */
  sinProveedor: false,
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
    const tocadas = estado.cuentaEscrita === null ? filas : filas.slice(0, estado.cuentaEscrita);
    for (const f of tocadas) Object.assign(f, valores);
    estado.escrituras.push({ tabla, valores: { ...valores }, filtros: [...filtros], filas: tocadas.length });
    return { data: null, error: null, count: opciones?.count === "exact" ? tocadas.length : null };
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
  createSupabaseServerClient: async () => {
    // Lo que tira `createServerClient` de verdad con las envs sin poner.
    if (estado.sinProveedor) {
      throw new Error("Your project's URL and Key are required to create a Supabase client!");
    }
    return clienteDeSesion();
  },
}));

function clienteDeSesion() {
  return {
    auth: { getUser: async () => ({ data: { user: estado.usuario }, error: null }) },
    from: (tabla: string) => consulta(tabla, true),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ nombre, args });
      const error = estado.errores[`rpc:${nombre}`];
      if (error) return { data: null, error };
      if (nombre === "url_host") return { data: urlHost(args.p_url as string), error: null };
      return { data: null, error: { code: "PGRST202", message: "no existe" } };
    },
  };
}

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
      const alSalir = estado.alSalir;
      estado.alSalir = null;
      alSalir?.();
      const status = estado.sitios.get(p.url) ?? 404;
      const destino = estado.redirecciones.get(p.url) ?? null;
      return { tipo: "respuesta", status: destino ? 301 : status, location: destino };
    },
    sufijoAleatorio: () => "abcdef0123456789",
  }),
}));

const { POST } = await import("../route");

let ip = 0;
function pedido(cuerpo: unknown, desde?: string): Request {
  ip += 1;
  return new Request("http://localhost/api/profile/evidence-check", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": desde ?? `10.14.${Math.floor(ip / 250)}.${ip % 250}`,
    },
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
  estado.redirecciones = new Map();
  estado.alSalir = null;
  estado.cuentaEscrita = null;
  estado.rpcs = [];
  estado.sinProveedor = false;
  estado.tablas = {
    org_members: [
      { organization_id: ORG_A, user_id: ALICIA, state: "active" },
      { organization_id: ORG_B, user_id: BRUNO, state: "active" },
      { organization_id: ORG_A, user_id: CARLA, state: "archived" },
    ],
    businesses: [
      { id: NEGOCIO_A, organization_id: ORG_A, website: "https://www.ejemplo-a.com" },
      { id: NEGOCIO_A2, organization_id: ORG_A, website: "https://otra-a.com" },
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

  it("sin sesión, un cuerpo que zod rechaza también es 401: la sesión va antes del esquema", async () => {
    // P2. MEDIDO EN PRODUCCIÓN el 2026-10-07: anónimo con `{}` -> 400 «Request
    // could not be processed.», anónimo con cuerpo bien formado -> 401. El test
    // de arriba manda un cuerpo válido y por eso no lo veía.
    estado.usuario = null;
    const noJson = new Request("http://localhost/api/profile/evidence-check", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.98.0.1" },
      body: "esto no es json {",
    });
    for (const [nombre, req] of [
      ["{}", pedido({})],
      ["un businessId que no es uuid", pedido({ businessId: "no-es-un-uuid" })],
      ["un cuerpo que no es JSON", noJson],
      ["un cuerpo bien formado", pedido({ businessId: NEGOCIO_A })],
    ] as const) {
      const res = await POST(req);
      expect(res.status, nombre).toBe(401);
      expect(await res.json(), nombre).toEqual({ error: "not authenticated" });
      // P4. «401 y nada más» incluye no LEER el cuerpo: un refutador puso
      // `await req.json()` arriba de la sesión, validó después, y el status de
      // arriba seguía en 401.
      expect(req.bodyUsed, `${nombre}: el cuerpo de un anónimo no se lee`).toBe(false);
    }
    expect(estado.lecturas).toEqual([]);
    expect(estado.red).toEqual([]);
    expect(estado.adminCreado).toBe(0);
  });

  it("sin sesión, el rate limit no corre: siete anónimos desde una IP son siete 401, no 429", async () => {
    // P3. El limitador deja pasar cinco por minuto. Consultado ANTES de la
    // sesión, un refutador midió `[401,401,401,401,401,429,429]`: el sexto
    // anónimo ya no recibía la negación de identidad sino un 429, y gastaba el
    // cupo de quien sí tiene sesión desde esa IP.
    estado.usuario = null;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await POST(pedido({ businessId: NEGOCIO_A }, "10.97.0.1"))).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401]);
  });

  it("sin proveedor de identidad (modo demo), 401 y no el 500 del catch", async () => {
    // P5. MEDIDO el 2026-10-07: sin las envs de Supabase construir el cliente
    // tira, y con la sesión dentro del try del trabajo ese throw caía en
    // `apiError(error, 500)`. La pregunta vive en `quienLlama`, que falla
    // cerrado.
    estado.sinProveedor = true;
    const req = pedido({ businessId: NEGOCIO_A });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "not authenticated" });
    expect(req.bodyUsed).toBe(false);
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

  it("5 corridas por minuto: la sexta desde la misma IP es 429, sin leer ni salir", async () => {
    // Mutación R16: sin el rate limit, una ruta que sale a URLs cargadas por
    // usuarios no tiene tope. El resto del archivo usa una IP por pedido a
    // propósito; acá es una sola.
    const desde = "10.99.0.1";
    for (let i = 0; i < 5; i++) {
      expect((await POST(pedido({ businessId: NEGOCIO_A }, desde))).status, `corrida ${i + 1}`).toBe(200);
    }
    estado.red = [];
    estado.lecturas = [];
    const res = await POST(pedido({ businessId: NEGOCIO_A }, desde));
    expect(res.status).toBe(429);
    expect(estado.lecturas).toEqual([]);
    expect(estado.red).toEqual([]);
  });
});

describe("la ficha es la de ESTE negocio", () => {
  it("otro negocio de la MISMA organización sin versión publicada: N = 0, no la ficha del hermano", async () => {
    // Mutación R12: sin `.eq("business_id")`, la lectura toma la ficha
    // publicada de NEGOCIO_A, contesta verde con N = 2, juzga el origen propio
    // contra el website equivocado y escribe con service_role en la evidencia
    // del otro negocio.
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A2 }))).json();
    expect(cuerpo.n).toBe(0);
    expect(cuerpo.version).toBeNull();
    expect(cuerpo.motivosRojo).toContain("n-cero");
    expect(cuerpo.verde).toBe(false);
    expect(estado.escrituras).toEqual([]);
    expect(fila("ev-a1").last_checked_at).toBeNull();
  });

  it("y si el hermano también tiene su versión publicada, se mide la suya y la del otro no se toca", async () => {
    estado.tablas.company_profiles.push({
      id: "perfil-a2-1",
      organization_id: ORG_A,
      business_id: NEGOCIO_A2,
      version: 1,
      status: "published",
    });
    estado.tablas.profile_objectives.push({ id: "obj-a2-1", organization_id: ORG_A, profile_id: "perfil-a2-1", kind: "claim" });
    estado.tablas.profile_evidence.push(evidencia("ev-a2-1", ORG_A, "obj-a2-1", "https://fuente-hermana.org/z"));
    sitio("https://fuente-hermana.org/z");

    const res = await POST(pedido({ businessId: NEGOCIO_A2 }));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.n).toBe(1);
    expect(cuerpo.version).toBe(1);
    expect(cuerpo.contraprueba.propia.url).toBe("https://otra-a.com/");
    expect(fila("ev-a2-1").last_status).toBe(200);
    expect(fila("ev-a1").last_checked_at, "la evidencia del hermano no se toca").toBeNull();
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

describe("lo que se compara es la columna de la base, no un host recalculado", () => {
  it("una URL donde url_host lee el PROPIO dominio y Node lee otro host: url-ambigua, rojo, y no sale a la red", async () => {
    // Mutación R13: `hostFuente: new URL(f.url).hostname` en vez de la columna
    // generada. El acuerdo entre los dos parsers se vuelve tautológico, la
    // fuente sale, contesta 200 y queda RESUELTA aunque la base diga que es
    // del propio dominio.
    const url = "https://fuente-uno.org\\@ejemplo-a.com/x";
    const ambigua = evidencia("ev-amb", ORG_A, "obj-a1", url);
    expect(ambigua.source_host).toBe("ejemplo-a.com");
    expect(new URL(url).hostname).toBe("fuente-uno.org");
    estado.tablas.profile_evidence.push(ambigua);
    estado.sitios.set(new URL(url).toString(), 200);

    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();
    expect(cuerpo.fuentes.find((f: { id: string }) => f.id === "ev-amb")).toMatchObject({
      cubeta: "no-resuelve",
      motivo: "url-ambigua",
    });
    expect(cuerpo.verde).toBe(false);
    expect(transporte().some((r) => r.includes("@ejemplo-a.com"))).toBe(false);
    expect(fila("ev-amb").last_checked_at, "no se midió, no se escribe").toBeNull();
  });
});

describe("lo que se escribe es lo que decidió la fuente", () => {
  it("un 404 se guarda como 404, y un 301 hacia el propio sitio como NULL, no como 3xx", async () => {
    // Mutación R14: `last_status` desde `f.status` en vez de `statusMedido`:
    // el 301 quedaría escrito y una auditoría con «2xx o 3xx» la contaría
    // resuelta. Mutación R15: sólo las resueltas con status, y el 404 queda
    // NULL — indistinguible de un DNS caído.
    estado.tablas.profile_evidence = [
      evidencia("ev-a1", ORG_A, "obj-a1", "https://fuente-uno.org/informe"),
      evidencia("ev-rota", ORG_A, "obj-a2", "https://fuente-rota.org/x"),
      evidencia("ev-vuelve", ORG_A, "obj-a2", "https://acortador.io/x"),
    ];
    sitio("https://fuente-rota.org/x", 404);
    sitio("https://acortador.io/x");
    estado.redirecciones.set("https://acortador.io/x", "https://www.ejemplo-a.com/");

    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();
    expect(cuerpo.fuentes.find((f: { id: string }) => f.id === "ev-vuelve")).toMatchObject({
      motivo: "origen-propio",
      status: 301,
    });
    expect(fila("ev-a1")).toMatchObject({ last_status: 200, last_checked_at: cuerpo.ejecutadoEn });
    expect(fila("ev-rota")).toMatchObject({ last_status: 404, last_checked_at: cuerpo.ejecutadoEn });
    expect(fila("ev-vuelve")).toMatchObject({ last_status: null, last_checked_at: cuerpo.ejecutadoEn });
  });
});

describe("lo que se leyó antes de la red se vuelve a leer antes de escribir", () => {
  it("si mientras corría se publicó otra versión, la superada no recibe la medición", async () => {
    // Mutación R17: sin la recomprobación, service_role escribe en la v2 ya
    // superada —la 0027 lo deja— y la respuesta informa la v2 como vigente.
    estado.alSalir = () => {
      estado.tablas.company_profiles = estado.tablas.company_profiles.map((p) =>
        p.id === "perfil-a-2" ? { ...p, status: "superseded" } : p
      );
      estado.tablas.company_profiles.push({
        id: "perfil-a-3",
        organization_id: ORG_A,
        business_id: NEGOCIO_A,
        version: 3,
        status: "published",
      });
    };
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();
    expect(estado.red.length).toBeGreaterThan(0);
    expect(cuerpo.guardado).toEqual({ ok: false, filas: 0, esperadas: 2, motivo: "version-superada" });
    expect(estado.adminCreado).toBe(0);
    expect(fila("ev-a1").last_checked_at).toBeNull();
  });

  it("si mientras corría archivaron a quien la pidió, la escritura privilegiada no sale", async () => {
    // Mutación R18: la recomprobación sin la membresía.
    estado.alSalir = () => {
      for (const m of estado.tablas.org_members) {
        if (m.user_id === ALICIA) m.state = "archived";
      }
    };
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();
    expect(cuerpo.guardado).toMatchObject({ ok: false, filas: 0, motivo: "membresia-vencida" });
    expect(estado.adminCreado).toBe(0);
    expect(estado.escrituras).toEqual([]);
  });

  it("una recomprobación que no se pudo leer tampoco escribe, y sin el texto de Postgres", async () => {
    estado.alSalir = () => {
      estado.errores.org_members = { code: "XX000", message: SECRETO_DE_POSTGRES };
    };
    const res = await POST(pedido({ businessId: NEGOCIO_A }));
    const texto = await res.text();
    expect(JSON.parse(texto).guardado).toMatchObject({ ok: false, motivo: "recomprobacion-ilegible" });
    expect(texto).not.toContain("constraint_secreta");
    expect(estado.escrituras).toEqual([]);
  });
});

describe("el navegador no recibe un mapa del DNS interno", () => {
  it("«no existe» y «resuelve a una IP interna» llegan como el mismo motivo, `red`", async () => {
    // Mutación R19: el motivo de cada fuente tal cual. Quien carga URLs podría
    // enumerar qué nombres son internos vistos desde la IP de la plataforma.
    estado.tablas.profile_evidence = [
      evidencia("ev-no-existe", ORG_A, "obj-a1", "https://no-existe.org/x"),
      evidencia("ev-interna", ORG_A, "obj-a2", "https://intranet.cliente.org/x"),
      evidencia("ev-puerto", ORG_A, "obj-a2", "https://fuente-dos.org:8443/dato"),
    ];
    estado.dns.set("intranet.cliente.org", ["10.0.0.7"]);
    const texto = await (await POST(pedido({ businessId: NEGOCIO_A }))).text();
    const cuerpo = JSON.parse(texto);
    const motivo = (id: string) => cuerpo.fuentes.find((f: { id: string }) => f.id === id).motivo;
    expect(motivo("ev-no-existe")).toBe("red");
    expect(motivo("ev-interna")).toBe("red");
    // Lo que sale de la URL misma no dice nada de adentro, y sigue tal cual.
    expect(motivo("ev-puerto")).toBe("puerto");
    expect(texto).not.toContain("ip-no-publica");
  });

  it("y la respuesta trae N y M por tipo de afirmación", async () => {
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();
    expect(cuerpo.porTipo).toEqual({ claim: { n: 1, m: 0 }, goal: { n: 1, m: 0 } });
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

  it("menos filas escritas que las pedidas también es no haber guardado", async () => {
    // Mutación R20: sin comparar filas con esperadas, un UPDATE que toca una de
    // dos (una fila borrada en el medio, un trigger que la saltea) se informa
    // como guardado.
    estado.cuentaEscrita = 1;
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO_A }))).json();
    expect(cuerpo.guardado).toEqual({ ok: false, filas: 1, esperadas: 2 });
  });

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
