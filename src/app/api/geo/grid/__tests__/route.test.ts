/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que `POST /api/geo/grid` —la corrida paga de H2-GO-3— gaste sin sesión, sin
 * rol, sin una aprobación de gasto, por encima del cupo aprobado o del tope de
 * puntos, con un punto fuera del mapa o sobre el negocio de otra organización;
 * que escriba con una organización que no es la del negocio; que guarde un
 * fallo como «no aparece» o una observación fuera de su celda; o que su
 * respuesta publique un denominador distinto del que quedó en la base. Y que
 * `GET /api/geo/grid` muestre una corrida ajena o calcule la distancia y el
 * veredicto de otra forma que la puerta.
 *
 * LOS DOS DOBLES RECORREN LA SECUENCIA (R13)
 *
 * El de la base guarda TABLAS, aplica los `eq`/`in` que la ruta manda, y del
 * lado de la sesión aplica una RLS (sólo las organizaciones donde quien llama es
 * miembro ACTIVO); `rlsRota` la apaga para medir lo único que la RLS no puede
 * probar: que la ruta verifica la organización EN CÓDIGO antes de escribir con
 * `service_role`. Sus escrituras imitan las constraints de la 0032 —el tope, la
 * FK de la aprobación con su cupo y su única, la coherencia del resultado, la
 * celda contra el N de su corrida y la coordenada contra la de su celda—, con
 * la cuenta de la 0032 TRANSCRITA acá y no importada de `grilla.ts`: si la
 * ruta escribiera una coordenada que no es la de su celda, el doble contesta el
 * 23514 que daría la base. `antesDeInsertar` deja meter una escritura ajena
 * entre la lectura del cupo y la escritura de la corrida: la carrera.
 *
 * El de Google es `googleGeografico`: ordena por distancia al centro del sesgo
 * de cada pedido, y con `ruido` intercambia unos pocos vecinos por respuesta,
 * para que una repetición salga parecida y no igual. Y los dos escriben en la
 * MISMA lista de eventos, así que el test afirma el orden: la corrida se
 * escribe ANTES del primer pedido a Google, las observaciones DESPUÉS del
 * último.
 *
 * Ninguna llamada sale a Google: `globalThis.fetch` es el doble en cada test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desplazar } from "@/lib/geo/grilla";
import { googleGeografico, lugaresAlrededor, sorteo } from "@/lib/geo/__tests__/googleGeografico";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** La organización que el alta abierta le da a un desconocido (handle_new_user, 0001). */
const ORG_X = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NEGOCIO_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const NEGOCIO_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const NEGOCIO_X = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const APROBACION_A = "e0e0e0e0-e0e0-4e0e-8e0e-0000000000a1";
/** owner de A */
const ALICIA = "11111111-1111-4111-8111-111111111111";
/** owner de B, sin nada en A */
const BRUNO = "22222222-2222-4222-8222-222222222222";
/** viewer de A, sin otra membresía */
const CARLA = "33333333-3333-4333-8333-333333333333";
/** owner de B y viewer de A: tiene rol que corre, pero no en la organización del negocio */
const DIEGO = "44444444-4444-4444-8444-444444444444";
/** manager de A, ARCHIVADA */
const ELENA = "55555555-5555-4555-8555-555555555555";
/** se registró ayer: owner de SU organización, con SU negocio, y nadie le aprobó nada */
const EXTRANO = "99999999-9999-4999-8999-999999999999";

const C = { lat: 59.3293, lng: 18.0686 };
const LUGARES = lugaresAlrededor(C, 60);
const OBJETIVO = LUGARES[0].id;

type Fila = Record<string, unknown>;
type Filtro = { op: "eq" | "in"; col: string; val: unknown };
type Violacion = { code: string; message: string };

const estado = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
  sinProveedor: false,
  tablas: {} as Record<string, Fila[]>,
  rlsRota: false,
  errores: {} as Record<string, { code: string; message: string }>,
  eventos: [] as string[],
  escrituras: [] as Array<{ cliente: "sesion" | "admin"; tabla: string; op: string; filas: Fila[]; filtros: Filtro[] }>,
  secuencia: 0,
  antesDeInsertar: null as null | ((tabla: string) => void),
}));

function orgsActivas(usuario: string | undefined): string[] {
  return (estado.tablas.org_members ?? [])
    .filter((m) => m.user_id === usuario && m.state === "active")
    .map((m) => m.organization_id as string);
}

/**
 * El punto de una celda según el CHECK `geo_grid_observations_coordinate_on_grid`
 * de la 0032, transcrito: norte ((√N − 1)/2 − fila) × paso, este (columna −
 * (√N − 1)/2) × paso sobre cos(lat del centro), en una esfera de 6 371 008,8 m.
 */
function puntoDeLaCelda(n: number, lat: number, lng: number, paso: number, fila: number, col: number) {
  const mitad = (Math.sqrt(n) - 1) / 2;
  const grados = (rad: number) => (rad * 180) / Math.PI;
  return {
    lat: lat + grados(((mitad - fila) * paso) / 6371008.8),
    lng: lng + grados(((col - mitad) * paso) / (6371008.8 * Math.cos((lat * Math.PI) / 180))),
  };
}

/** Las constraints de la 0032 que una escritura de la ruta podría violar. `null` si ninguna. */
function violacion(tabla: string, fila: Fila, lote: Fila[]): Violacion | null {
  const mal = (code: string, constraint: string) => ({ code, message: `violates constraint "${constraint}"` });
  if (tabla === "geo_grid_runs") {
    if (![1, 4, 9].includes(fila.n_points as number)) return mal("23514", "geo_grid_runs_n_points_check");
    if (fila.approval_id == null) return mal("23502", "approval_id");
    const tope = fila.approval_max_runs as number;
    const cupo = fila.approval_slot as number;
    if (!(cupo >= 1 && cupo <= tope)) return mal("23514", "geo_grid_runs_approval_slot_check");
    const aprobacion = (estado.tablas.geo_grid_spend_approvals ?? []).find(
      (a) => a.organization_id === fila.organization_id && a.id === fila.approval_id && a.max_runs === tope
    );
    if (!aprobacion) return mal("23503", "geo_grid_runs_approval_fkey");
    const tomados = [...(estado.tablas.geo_grid_runs ?? []), ...lote.filter((f) => f !== fila)];
    if (tomados.some((r) => r.approval_id === fila.approval_id && r.approval_slot === cupo)) {
      return mal("23505", "geo_grid_runs_approval_slot_key");
    }
    return null;
  }
  if (tabla === "geo_grid_observations") {
    const { outcome, position, error_code } = fila;
    const coherente =
      (outcome === "position" && typeof position === "number" && position >= 1 && position <= 20 && error_code === null) ||
      (outcome === "absent" && position === null && error_code === null) ||
      (outcome === "failed" && position === null && typeof error_code === "string");
    const forma = error_code === null || /^(http_[1-5][0-9]{2}|timeout|network|invalid_response|missing_key)$/.test(String(error_code));
    if (!coherente || !forma || fila.source !== "google_places_text_search") {
      return mal("23514", "geo_grid_observations_outcome_coherent");
    }
    const corrida = (estado.tablas.geo_grid_runs ?? []).find(
      (r) =>
        r.organization_id === fila.organization_id &&
        r.id === fila.run_id &&
        r.n_points === fila.run_n_points &&
        r.center_lat === fila.run_center_lat &&
        r.center_lng === fila.run_center_lng &&
        r.step_m === fila.run_step_m
    );
    if (!corrida) return mal("23503", "geo_grid_observations_run_fkey");
    const n = fila.run_n_points as number;
    const f = fila.grid_row as number;
    const c = fila.grid_col as number;
    if (!(f >= 0 && c >= 0 && (f + 1) ** 2 <= n && (c + 1) ** 2 <= n)) return mal("23514", "geo_grid_observations_cell_check");
    const p = puntoDeLaCelda(n, fila.run_center_lat as number, fila.run_center_lng as number, fila.run_step_m as number, f, c);
    const dLng = Math.abs(((((fila.lng as number) - p.lng + 540) % 360) + 360) % 360 - 180);
    if (!(Math.abs((fila.lat as number) - p.lat) <= 1e-6 && dLng <= 1e-6)) {
      return mal("23514", "geo_grid_observations_coordinate_on_grid");
    }
    const otras = [...(estado.tablas.geo_grid_observations ?? []), ...lote.filter((o) => o !== fila)];
    if (otras.some((o) => o.run_id === fila.run_id && o.grid_row === f && o.grid_col === c)) {
      return mal("23505", "geo_grid_observations_cell_key");
    }
    return null;
  }
  return null;
}

function consulta(tabla: string, cliente: "sesion" | "admin") {
  const filtros: Filtro[] = [];
  let opciones: { count?: string } | undefined;
  let op: "select" | "insert" | "update" = "select";
  let valores: Fila | Fila[] | null = null;
  let devolver = false;

  const visibles = () => {
    let filas = estado.tablas[tabla] ?? [];
    if (cliente === "sesion" && !estado.rlsRota) {
      const orgs = orgsActivas(estado.usuario?.id);
      filas = filas.filter((f) => orgs.includes(f.organization_id as string));
    }
    return filas.filter((f) =>
      filtros.every((c) => (c.op === "eq" ? f[c.col] === c.val : (c.val as unknown[]).includes(f[c.col])))
    );
  };

  const ejecutar = () => {
    const error = estado.errores[`${op}:${tabla}`];
    if (error) return { data: null, error, count: null };
    if (op === "select") {
      const filas = visibles();
      return { data: filas.map((f) => ({ ...f })), error: null, count: opciones?.count === "exact" ? filas.length : null };
    }
    if (op === "insert") {
      estado.antesDeInsertar?.(tabla);
      const filas = (Array.isArray(valores) ? valores : [valores]) as Fila[];
      for (const f of filas) {
        const v = violacion(tabla, f, filas);
        if (v) return { data: null, error: v, count: null };
      }
      const guardadas = filas.map((f) => ({
        ...(tabla === "geo_grid_runs"
          ? {
              id: `0c0c0c0c-0c0c-4c0c-8c0c-${String(++estado.secuencia).padStart(12, "0")}`,
              started_at: new Date(Date.parse("2026-10-08T10:00:00.000Z") + estado.secuencia * 60_000).toISOString(),
              finished_at: null,
            }
          : {}),
        ...f,
      }));
      (estado.tablas[tabla] ??= []).push(...guardadas);
      estado.eventos.push(`insert:${tabla}`);
      estado.escrituras.push({ cliente, tabla, op, filas: guardadas, filtros: [] });
      return { data: guardadas, error: null, count: opciones?.count === "exact" ? guardadas.length : null };
    }
    const filas = visibles();
    for (const f of filas) Object.assign(f, valores);
    estado.eventos.push(`update:${tabla}`);
    estado.escrituras.push({ cliente, tabla, op, filas: [{ ...(valores as Fila) }], filtros: [...filtros] });
    return { data: null, error: null, count: opciones?.count === "exact" ? filas.length : null };
  };

  const q = {
    select(_c?: string, o?: { count?: string }) {
      if (op === "select") opciones = o;
      devolver = true;
      return q;
    },
    insert(v: Fila | Fila[], o?: { count?: string }) {
      op = "insert";
      valores = v;
      opciones = o;
      return q;
    },
    update(v: Fila, o?: { count?: string }) {
      op = "update";
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
      const r = ejecutar();
      if (r.error) return { data: null, error: r.error };
      const filas = (r.data ?? []) as Fila[];
      if (filas.length > 1) return { data: null, error: { code: "PGRST116", message: "varias filas" } };
      return { data: filas[0] ?? null, error: null };
    },
    async single() {
      const r = ejecutar();
      if (r.error) return { data: null, error: r.error };
      const filas = (r.data ?? []) as Fila[];
      if (filas.length !== 1) return { data: null, error: { code: "PGRST116", message: "no una fila" } };
      return { data: filas[0], error: null };
    },
    then(ok: (v: unknown) => unknown, mal?: (e: unknown) => unknown) {
      void devolver;
      return Promise.resolve(ejecutar()).then(ok, mal);
    },
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (estado.sinProveedor) throw new Error("Your project's URL and Key are required to create a Supabase client!");
    return {
      auth: { getUser: async () => ({ data: { user: estado.usuario }, error: null }) },
      from: (tabla: string) => consulta(tabla, "sesion"),
    };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: (tabla: string) => consulta(tabla, "admin") }),
}));

import { GET, POST } from "../route";

const fetchOriginal = globalThis.fetch;
const envPrevio = process.env.GOOGLE_PLACES_API_KEY;
let google: ReturnType<typeof googleGeografico>;
let ip = 0;

/** Una aprobación de gasto: lo que escribe a mano una persona con `service_role`. */
function aprobacion(id: string, organizacion: string, maxRuns = 3, extra: Fila = {}): Fila {
  const ahora = Date.now();
  return {
    id,
    organization_id: organizacion,
    max_runs: maxRuns,
    approved_by: "Pablo, sesión directora",
    approved_at: new Date(ahora - 60_000).toISOString(),
    expires_at: new Date(ahora + 3 * 60 * 60 * 1000).toISOString(),
    ...extra,
  };
}

function sembrar() {
  estado.tablas = {
    org_members: [
      { organization_id: ORG_A, user_id: ALICIA, role: "owner", state: "active" },
      { organization_id: ORG_B, user_id: BRUNO, role: "owner", state: "active" },
      { organization_id: ORG_A, user_id: CARLA, role: "viewer", state: "active" },
      { organization_id: ORG_B, user_id: DIEGO, role: "owner", state: "active" },
      { organization_id: ORG_A, user_id: DIEGO, role: "viewer", state: "active" },
      { organization_id: ORG_A, user_id: ELENA, role: "manager", state: "archived" },
      // Lo que deja el alta abierta (medido en la réplica el 2026-10-09):
      // owner/active de su organización, y el negocio que inserta él.
      { organization_id: ORG_X, user_id: EXTRANO, role: "owner", state: "active" },
    ],
    businesses: [
      { id: NEGOCIO_A, organization_id: ORG_A, name: "Mörby" },
      { id: NEGOCIO_B, organization_id: ORG_B, name: "Bruno Co" },
      { id: NEGOCIO_X, organization_id: ORG_X, name: "Negocio cualquiera" },
    ],
    geo_grid_spend_approvals: [aprobacion(APROBACION_A, ORG_A)],
    geo_grid_runs: [],
    geo_grid_observations: [],
  };
}

beforeEach(() => {
  sembrar();
  estado.usuario = { id: ALICIA };
  estado.sinProveedor = false;
  estado.rlsRota = false;
  estado.errores = {};
  estado.eventos = [];
  estado.escrituras = [];
  estado.secuencia = 0;
  estado.antesDeInsertar = null;
  process.env.GOOGLE_PLACES_API_KEY = "clave-falsa-de-places";
  google = googleGeografico(LUGARES, { eventos: estado.eventos });
  globalThis.fetch = google.transporte;
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = fetchOriginal;
  if (envPrevio === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = envPrevio;
});

const cuerpoValido = (extra: Record<string, unknown> = {}) => ({
  businessId: NEGOCIO_A,
  keyword: "fotvård Stockholm",
  targetPlaceId: OBJETIVO,
  center: C,
  radiusM: 1000,
  stepM: 1500,
  gridSize: 3,
  declaredShiftM: 8000,
  ...extra,
});

/** Una IP por pedido: el limitador es por IP, y su propio test usa una fija. */
function pedirPost(cuerpo: unknown, ipFija?: string) {
  return new Request("https://growth-os.test/api/geo/grid", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ipFija ?? `10.0.0.${++ip}` },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

function pedirGet(query: Record<string, string>) {
  const url = new URL("https://growth-os.test/api/geo/grid");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url, { method: "GET" });
}

const escriturasAdmin = () => estado.escrituras.filter((e) => e.cliente === "admin");

/** La distancia en metros entre dos coordenadas, con la fórmula de este test (haversine). */
function metros(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (g: number) => (g * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

describe("POST /api/geo/grid: quién puede gastar", () => {
  it("sin sesión: 401, sin leer el cuerpo, sin red y sin escribir", async () => {
    estado.usuario = null;
    const pedido = pedirPost(cuerpoValido());
    const res = await POST(pedido);
    expect(res.status).toBe(401);
    expect(pedido.bodyUsed).toBe(false);
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("sin proveedor de identidad (modo demo): 401, no 500", async () => {
    estado.sinProveedor = true;
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(401);
    expect(google.pedidos).toHaveLength(0);
  });

  it("un viewer: 403 ANTES de leer el cuerpo, sin red y sin escribir", async () => {
    estado.usuario = { id: CARLA };
    const pedido = pedirPost(cuerpoValido());
    const res = await POST(pedido);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ motivo: "rol-insuficiente" });
    expect(pedido.bodyUsed).toBe(false);
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("una manager ARCHIVADA no corre: 403", async () => {
    estado.usuario = { id: ELENA };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(403);
    expect(google.pedidos).toHaveLength(0);
  });

  it("owner en otra organización y viewer en la del negocio: 403 por el rol EN ESA organización", async () => {
    estado.usuario = { id: DIEGO };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(403);
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("el negocio de otra organización: 404, como uno inventado", async () => {
    estado.usuario = { id: BRUNO };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(404);
    expect(google.pedidos).toHaveLength(0);
  });

  it("SI LA RLS DEJARA VER el negocio ajeno, la ruta igual se niega: la organización se mira en código", async () => {
    estado.rlsRota = true;
    estado.usuario = { id: BRUNO };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(404);
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("la tercera corrida por minuto desde la misma IP pasa, la cuarta es 429 sin salir a la red", async () => {
    for (let i = 0; i < 3; i++) expect((await POST(pedirPost(cuerpoValido(), "10.9.9.9"))).status).toBe(200);
    const antes = google.pedidos.length;
    const res = await POST(pedirPost(cuerpoValido(), "10.9.9.9"));
    expect(res.status).toBe(429);
    expect(google.pedidos.length).toBe(antes);
  });
});

describe("POST /api/geo/grid: EL GASTO APROBADO, y nada más", () => {
  it("UN DESCONOCIDO QUE SE REGISTRÓ es owner de su organización y tiene un negocio: 403 sin aprobación, sin red", async () => {
    // La revisión del 2026-10-09: tres corridas, 27 pedidos pagos con la clave
    // de la plataforma, sin que nadie de la agencia lo supiera.
    estado.usuario = { id: EXTRANO };
    const respuestas = [];
    for (let i = 0; i < 3; i++) respuestas.push(await POST(pedirPost(cuerpoValido({ businessId: NEGOCIO_X }))));
    for (const res of respuestas) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden", motivo: "sin-aprobacion-de-gasto" });
    }
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("la aprobación de OTRA organización no le paga, ni con la RLS rota", async () => {
    estado.usuario = { id: EXTRANO };
    estado.rlsRota = true;
    const res = await POST(pedirPost(cuerpoValido({ businessId: NEGOCIO_X })));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ motivo: "sin-aprobacion-de-gasto" });
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("una aprobación vencida no paga", async () => {
    estado.tablas.geo_grid_spend_approvals = [
      aprobacion(APROBACION_A, ORG_A, 3, { expires_at: new Date(Date.now() - 1000).toISOString() }),
    ];
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ motivo: "sin-aprobacion-de-gasto" });
    expect(google.pedidos).toHaveLength(0);
  });

  it("TRES CORRIDAS Y LA CUARTA NO: misma IP, una ventana del rate limit por corrida, y 27 pedidos, no 36", async () => {
    // El caso de la revisión: una corrida cada 61 s desde la misma IP pasaba
    // siempre el rate limit, que era el único freno.
    let ahora = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => ahora);
    const estados: number[] = [];
    const cuerpos: Array<{ motivo?: string; run?: { approvalSlot: number } }> = [];
    for (let i = 0; i < 4; i++) {
      const res = await POST(pedirPost(cuerpoValido(), "10.7.7.7"));
      estados.push(res.status);
      cuerpos.push(await res.json());
      ahora += 61_000;
    }
    expect(estados).toEqual([200, 200, 200, 403]);
    expect(cuerpos.slice(0, 3).map((c) => c.run?.approvalSlot)).toEqual([1, 2, 3]);
    expect(cuerpos[3]).toMatchObject({ motivo: "aprobacion-agotada" });
    expect(google.pedidos).toHaveLength(27);
    expect(estado.tablas.geo_grid_runs).toHaveLength(3);
  });

  it("con diez IPs distintas en el mismo minuto, igual: tres corridas", async () => {
    const estados: number[] = [];
    for (let i = 0; i < 10; i++) estados.push((await POST(pedirPost(cuerpoValido(), `203.0.113.${i}`))).status);
    expect(estados.filter((s) => s === 200)).toHaveLength(3);
    expect(google.pedidos).toHaveLength(27);
  });

  it("LA CARRERA POR EL ÚLTIMO CUPO: si otro pedido lo toma entre la lectura y la escritura, 409 y nada sale a la red", async () => {
    estado.antesDeInsertar = (tabla) => {
      if (tabla !== "geo_grid_runs") return;
      estado.antesDeInsertar = null;
      // Otro pedido, en otra instancia, escribió su corrida con el cupo 1.
      estado.tablas.geo_grid_runs.push({
        id: "0c0c0c0c-0c0c-4c0c-8c0c-999999999999",
        organization_id: ORG_A,
        approval_id: APROBACION_A,
        approval_max_runs: 3,
        approval_slot: 1,
      });
    };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, motivo: "cupo-tomado" });
    expect(google.pedidos).toHaveLength(0);
    expect(escriturasAdmin()).toHaveLength(0);
  });

  it("dos aprobaciones vivas: se gasta primero la más vieja, cupo por cupo", async () => {
    const vieja = "e0e0e0e0-e0e0-4e0e-8e0e-0000000000b2";
    estado.tablas.geo_grid_spend_approvals = [
      aprobacion(APROBACION_A, ORG_A, 2),
      aprobacion(vieja, ORG_A, 1, { approved_at: new Date(Date.now() - 3_600_000).toISOString() }),
    ];
    const cupos = [];
    for (let i = 0; i < 3; i++) {
      const cuerpo = await (await POST(pedirPost(cuerpoValido()))).json();
      cupos.push([cuerpo.run.approvalId, cuerpo.run.approvalSlot]);
    }
    expect(cupos).toEqual([
      [vieja, 1],
      [APROBACION_A, 1],
      [APROBACION_A, 2],
    ]);
    expect((await POST(pedirPost(cuerpoValido()))).status).toBe(403);
  });
});

describe("POST /api/geo/grid: el pedido, EL TOPE y el mapa", () => {
  it("un cuerpo que zod rechaza es 400 sin red", async () => {
    for (const malo of [{}, "esto no es json {", cuerpoValido({ targetPlaceId: "places/ChIJconPrefijo01" })]) {
      const res = await POST(pedirPost(malo));
      expect(res.status).toBe(400);
    }
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("16 puntos (lado 4): 400 tope-de-puntos ANTES de leer el negocio, sin red y sin escribir", async () => {
    const res = await POST(pedirPost(cuerpoValido({ gridSize: 4 })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, motivo: "tope-de-puntos", pedidos: 16, tope: 9 });
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("UN PUNTO FUERA DEL MAPA: a 89,9° con 50 km de paso, 400 sin red y sin escribir", async () => {
    // Antes: 200, nueve pedidos (seis facturables) y la base rechazaba el lote
    // entero de observaciones.
    const res = await POST(pedirPost(cuerpoValido({ center: { lat: 89.9, lng: 18 }, stepM: 50_000 })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, motivo: "punto-fuera-del-mapa", fila: 0 });
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });

  it("9 puntos (lado 3): exactamente nueve pedidos a Google", async () => {
    const res = await POST(pedirPost(cuerpoValido({ gridSize: 3 })));
    expect(res.status).toBe(200);
    expect(google.pedidos).toHaveLength(9);
  });

  it("4 puntos (lado 2): cuatro pedidos, n_points 4 en la corrida y en cada observación", async () => {
    const res = await POST(pedirPost(cuerpoValido({ gridSize: 2 })));
    expect(res.status).toBe(200);
    expect(google.pedidos).toHaveLength(4);
    const [corrida, observaciones] = escriturasAdmin();
    expect(corrida.filas[0]).toMatchObject({ n_points: 4 });
    expect(observaciones.filas).toHaveLength(4);
    for (const o of observaciones.filas) expect(o).toMatchObject({ run_n_points: 4 });
    const cuerpo = await res.json();
    expect(cuerpo.denominador).toMatchObject({ puntos: 4, devolvieronDato: 4, sinObservacion: 0, fueraDeLaGrilla: 0 });
  });

  it("el «no aparece» DECLARADO en el pedido es el que se guarda, y el que usa la distancia", async () => {
    const res = await POST(pedirPost(cuerpoValido({ unmatchedValue: 30 })));
    const cuerpo = await res.json();
    expect(escriturasAdmin()[0].filas[0]).toMatchObject({ unmatched_value: 30 });
    expect(cuerpo.run.unmatchedValue).toBe(30);
    const otra = await (await POST(pedirPost(cuerpoValido()))).json();
    const { distancia } = await (await GET(pedirGet({ runId: cuerpo.run.id, compareTo: otra.run.id }))).json();
    expect(distancia).toEqual({ estado: "incomparable", motivo: "valor-no-aparece-distinto" });
  });

  it("sin la clave de Places: 503, nada escrito y nada pedido", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(503);
    expect(google.pedidos).toHaveLength(0);
    expect(estado.escrituras).toHaveLength(0);
  });
});

describe("POST /api/geo/grid: lo que escribe, en qué orden, y el denominador", () => {
  it("la corrida se escribe ANTES del primer pedido, las observaciones DESPUÉS del último, y el fin al final", async () => {
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(200);
    expect(estado.eventos).toEqual([
      "insert:geo_grid_runs",
      ...Array.from({ length: 9 }, (_, i) => `fetch#${i + 1}`),
      "insert:geo_grid_observations",
      "update:geo_grid_runs",
    ]);
  });

  it("escribe con service_role, con la organización DEL NEGOCIO, quién la corrió, la grilla declarada y su cupo", async () => {
    await POST(pedirPost(cuerpoValido({ organizationId: ORG_B, organization_id: ORG_B })));
    const [corrida, observaciones, fin] = escriturasAdmin();
    expect(estado.escrituras.every((e) => e.cliente === "admin")).toBe(true);
    expect(corrida.tabla).toBe("geo_grid_runs");
    expect(corrida.filas[0]).toMatchObject({
      organization_id: ORG_A,
      business_id: NEGOCIO_A,
      created_by: ALICIA,
      keyword: "fotvård Stockholm",
      target_place_id: OBJETIVO,
      center_lat: C.lat,
      center_lng: C.lng,
      radius_m: 1000,
      step_m: 1500,
      n_points: 9,
      unmatched_value: 21,
      declared_shift_m: 8000,
      approval_id: APROBACION_A,
      approval_max_runs: 3,
      approval_slot: 1,
    });
    expect(observaciones.tabla).toBe("geo_grid_observations");
    expect(observaciones.filas).toHaveLength(9);
    for (const o of observaciones.filas) {
      expect(o).toMatchObject({
        organization_id: ORG_A,
        run_id: corrida.filas[0].id,
        run_n_points: 9,
        run_center_lat: C.lat,
        run_center_lng: C.lng,
        run_step_m: 1500,
        source: "google_places_text_search",
      });
    }
    expect(fin.filtros).toEqual(
      expect.arrayContaining([
        { op: "eq", col: "id", val: corrida.filas[0].id },
        { op: "eq", col: "organization_id", val: ORG_A },
      ])
    );
  });

  it("cada observación lleva la coordenada que se le mandó a Google en SU pedido", async () => {
    await POST(pedirPost(cuerpoValido()));
    const observaciones = escriturasAdmin()[1].filas;
    expect(observaciones.map((o) => ({ latitude: o.lat, longitude: o.lng }))).toEqual(
      google.pedidos.map((p) => p.cuerpo.locationBias?.circle?.center)
    );
  });

  it("Y ESA COORDENADA ES LA DE SU CELDA: nueve distintas, el centro en la (1,1), los vecinos a un paso", async () => {
    // El mutante que consultaba el centro en los nueve puntos pasaba el test de
    // arriba —fila y pedido decían lo mismo: el centro— y la suite entera.
    await POST(pedirPost(cuerpoValido()));
    const obs = escriturasAdmin()[1].filas as Array<{ grid_row: number; grid_col: number; lat: number; lng: number }>;
    expect(new Set(obs.map((o) => `${o.lat},${o.lng}`)).size).toBe(9);
    const celda = (f: number, c: number) => obs.find((o) => o.grid_row === f && o.grid_col === c) as { lat: number; lng: number };
    expect(metros(celda(1, 1), C)).toBeLessThan(0.01);
    expect(metros(celda(1, 1), celda(1, 2))).toBeCloseTo(1500, 0);
    expect(metros(celda(1, 1), celda(0, 1))).toBeCloseTo(1500, 0);
    expect(celda(0, 1).lat).toBeGreaterThan(C.lat);
    expect(celda(1, 0).lng).toBeLessThan(C.lng);
  });

  it("la respuesta publica el denominador: 9 puntos, cuántos devolvieron dato y cuántos fallaron", async () => {
    const res = await POST(pedirPost(cuerpoValido()));
    const cuerpo = await res.json();
    expect(cuerpo.denominador.puntos).toBe(9);
    expect(cuerpo.denominador.fallaron).toBe(0);
    expect(cuerpo.denominador.devolvieronDato).toBe(9);
    expect(cuerpo.denominador.fueraDeLaGrilla).toBe(0);
    expect(cuerpo.denominador.aparece + cuerpo.denominador.noAparece).toBe(9);
    expect(cuerpo.respuestasDeGoogle.denominador).toEqual(cuerpo.denominador);
    expect(cuerpo.guardado).toEqual({ ok: true, observaciones: 9, esperadas: 9 });
  });

  it("LA RED SE CORTA A MITAD DE CORRIDA: sube «fallaron» y en la base son failed/network, no absent", async () => {
    const entera = await (await POST(pedirPost(cuerpoValido()))).json();

    sembrar();
    estado.escrituras = [];
    google = googleGeografico(LUGARES, { cortarDesde: 5 });
    globalThis.fetch = google.transporte;
    const cortada = await (await POST(pedirPost(cuerpoValido()))).json();

    expect(entera.denominador.fallaron).toBe(0);
    expect(cortada.denominador.fallaron).toBe(5);
    expect(cortada.denominador.devolvieronDato).toBe(4);
    expect(cortada.denominador.noAparece).toBeLessThanOrEqual(entera.denominador.noAparece);
    const escritas = escriturasAdmin()[1].filas;
    expect(escritas.filter((o) => o.outcome === "failed")).toHaveLength(5);
    for (const o of escritas.filter((f) => f.outcome === "failed")) {
      expect(o).toMatchObject({ position: null, error_code: "network" });
    }
    expect(cortada.guardado.ok).toBe(true);
  });

  it("SI LAS OBSERVACIONES NO SE ESCRIBEN, el denominador es el de la base —nueve sin observación— y Google va aparte", async () => {
    // Antes: el POST publicaba nueve datos devueltos (de memoria) y el GET de la
    // misma corrida, nueve sin observación.
    estado.errores["insert:geo_grid_observations"] = { code: "08006", message: "secreto de postgres" };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.guardado).toMatchObject({ ok: false, motivo: "observaciones-no-guardadas" });
    expect(cuerpo.denominador).toMatchObject({ puntos: 9, devolvieronDato: 0, fallaron: 0, sinObservacion: 9 });
    expect(cuerpo.observaciones).toEqual([]);
    expect(cuerpo.respuestasDeGoogle.denominador).toMatchObject({ puntos: 9, devolvieronDato: 9 });
    expect(cuerpo.respuestasDeGoogle.observaciones).toHaveLength(9);
    expect(JSON.stringify(cuerpo)).not.toContain("secreto de postgres");

    delete estado.errores["insert:geo_grid_observations"];
    const leida = await (await GET(pedirGet({ runId: cuerpo.run.id }))).json();
    expect(leida.denominador).toEqual(cuerpo.denominador);
  });

  it("si la base no deja releer, el denominador es null —no uno de memoria— y guardado.ok = false", async () => {
    estado.errores["select:geo_grid_observations"] = { code: "57014", message: "statement timeout" };
    const cuerpo = await (await POST(pedirPost(cuerpoValido()))).json();
    expect(cuerpo.denominador).toBeNull();
    expect(cuerpo.guardado).toMatchObject({ ok: false, motivo: "relectura-fallida" });
    expect(cuerpo.respuestasDeGoogle.denominador.devolvieronDato).toBe(9);
  });

  it("si la corrida no se puede escribir, no se sale a la red: 502 y cero pedidos", async () => {
    estado.errores["insert:geo_grid_runs"] = { code: "42501", message: "permission denied" };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(502);
    expect(google.pedidos).toHaveLength(0);
  });
});

describe("GET /api/geo/grid: la corrida, la distancia y el veredicto", () => {
  async function correr(centro = C, extra: Record<string, unknown> = {}) {
    const res = await POST(pedirPost(cuerpoValido({ center: centro, ...extra })));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    return cuerpo.run.id as string;
  }

  /** A (C), A' (C) y B (C + 8 km al este), en ese orden. */
  async function trio(extra: Record<string, unknown> = {}) {
    const a = await correr(C, extra);
    const a2 = await correr(C, extra);
    const b = await correr(desplazar(C, 0, 8000), extra);
    return { a, a2, b };
  }

  const veredictoDe = async (runId: string, repeatId: string, shiftedId: string) =>
    (await (await GET(pedirGet({ runId, repeatId, shiftedId }))).json()).veredicto;

  it("sin sesión: 401", async () => {
    estado.usuario = null;
    const res = await GET(pedirGet({ runId: "0c0c0c0c-0c0c-4c0c-8c0c-000000000001" }));
    expect(res.status).toBe(401);
  });

  it("la corrida propia, con sus nueve observaciones y su denominador", async () => {
    const id = await correr();
    const res = await GET(pedirGet({ runId: id }));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.observaciones).toHaveLength(9);
    expect(cuerpo.denominador).toMatchObject({ puntos: 9, fallaron: 0, sinObservacion: 0, fueraDeLaGrilla: 0 });
  });

  it("la corrida de otra organización es 404", async () => {
    const id = await correr();
    estado.usuario = { id: BRUNO };
    const res = await GET(pedirGet({ runId: id }));
    expect(res.status).toBe(404);
  });

  it("A, A' y B (8 km al este), por HTTP, con el doble determinista: d(A,A') = 0, d(A,B) > 0 y verde", async () => {
    const { a, a2, b } = await trio();
    const veredicto = await veredictoDe(a, a2, b);
    expect(veredicto.motivos).toEqual([]);
    expect(veredicto.verde).toBe(true);
    expect(veredicto.ruido).toMatchObject({ estado: "numero", valor: 0, comparables: 9 });
    expect(veredicto.geografia.estado).toBe("numero");
    expect(veredicto.geografia.valor).toBeGreaterThan(0);
    expect(veredicto.desplazamientoMedidoM).toBeCloseTo(8000, 0);
  });

  it("CON RUIDO, A' sale parecida y no igual: d(A,A') > 0, y la geografía igual le gana por más de tres", async () => {
    google = googleGeografico(LUGARES, { ruido: { semilla: 7, intercambios: 2 } });
    globalThis.fetch = google.transporte;
    const { a, a2, b } = await trio();
    const veredicto = await veredictoDe(a, a2, b);
    expect(veredicto.ruido.estado).toBe("numero");
    expect(veredicto.ruido.valor).toBeGreaterThan(0);
    expect(3 * veredicto.ruido.valor).toBeLessThan(veredicto.geografia.valor);
    expect(veredicto.motivos).toEqual([]);
    expect(veredicto.verde).toBe(true);
  });

  it("LA TRAMPA DE LAS DOS CORRIDAS: repeatId = runId es rojo, con el mismo ruido que daba verde", async () => {
    google = googleGeografico(LUGARES, { ruido: { semilla: 7, intercambios: 2 } });
    globalThis.fetch = google.transporte;
    const { a, b } = await trio();
    const veredicto = await veredictoDe(a, a, b);
    expect(veredicto.verde).toBe(false);
    expect(veredicto.motivos).toContain("corridas-repetidas");
    expect(veredicto.motivos).toContain("repeticion-no-es-posterior");
    expect(veredicto.ruido).toMatchObject({ estado: "numero", valor: 0 });
  });

  it("UN CLIENTE QUE IGNORA LA COORDENADA y contesta al azar: el trío honesto es rojo, y la trampa también", async () => {
    // El modo de fallo que la corrección del crítico vino a cerrar. Medido por
    // la revisión el 2026-10-09: honesto rojo (ruido 5,11, geografía 8,56) y la
    // trampa verde.
    const azar = sorteo(12345);
    google = googleGeografico(LUGARES, {
      responder: () => {
        const ids = LUGARES.slice(0, 30).map((l) => l.id);
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(azar() * (i + 1));
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        return new Response(JSON.stringify({ places: ids.slice(0, 20).map((id) => ({ id })) }), { status: 200 });
      },
    });
    globalThis.fetch = google.transporte;
    const { a, a2, b } = await trio();
    const honesto = await veredictoDe(a, a2, b);
    expect(honesto.verde).toBe(false);
    expect(honesto.motivos).toEqual(["geografia-no-supera-al-ruido"]);
    const trampa = await veredictoDe(a, a, b);
    expect(trampa.verde).toBe(false);
    expect(trampa.motivos).toContain("corridas-repetidas");
  });

  it("TRES CORRIDAS DE UN PUNTO —un llamado cada una— no cruzan la puerta: rojo, grilla-no-es-la-de-la-puerta", async () => {
    const { a, a2, b } = await trio({ gridSize: 1 });
    const veredicto = await veredictoDe(a, a2, b);
    expect(veredicto.verde).toBe(false);
    expect(veredicto.motivos).toEqual(["grilla-no-es-la-de-la-puerta"]);
  });

  it("un trío pagado con DOS aprobaciones no arma la puerta: rojo, aprobacion-distinta", async () => {
    estado.tablas.geo_grid_spend_approvals = [
      aprobacion("e0e0e0e0-e0e0-4e0e-8e0e-0000000000c3", ORG_A, 2, {
        approved_at: new Date(Date.now() - 3_600_000).toISOString(),
      }),
      aprobacion(APROBACION_A, ORG_A, 3),
    ];
    const { a, a2, b } = await trio();
    const veredicto = await veredictoDe(a, a2, b);
    expect(veredicto.verde).toBe(false);
    expect(veredicto.motivos).toEqual(["aprobacion-distinta"]);
  });

  it("la distancia excluye las celdas fallidas y las cuenta aparte", async () => {
    const a = await correr(C);
    google = googleGeografico(LUGARES, { cortarDesde: 7 });
    globalThis.fetch = google.transporte;
    const b = await correr(C);

    const { distancia } = await (await GET(pedirGet({ runId: a, compareTo: b }))).json();
    expect(distancia).toEqual({
      estado: "numero",
      valor: 0,
      comparables: 6,
      excluidasPorFallo: 3,
      sinObservacion: 0,
      fueraDeLaGrilla: 0,
      puntos: 9,
    });
  });

  it("con la mitad o más de las celdas fallidas, la distancia es insuficiente, no un número", async () => {
    const a = await correr(C);
    google = googleGeografico(LUGARES, { cortarDesde: 5 });
    globalThis.fetch = google.transporte;
    const b = await correr(C);

    const { distancia } = await (await GET(pedirGet({ runId: a, compareTo: b }))).json();
    expect(distancia).toMatchObject({ estado: "insuficiente", comparables: 4, excluidasPorFallo: 5, minimo: 5 });
  });

  it("repeatId sin shiftedId es 400", async () => {
    const a = await correr(C);
    const res = await GET(pedirGet({ runId: a, repeatId: a }));
    expect(res.status).toBe(400);
  });
});
