/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que `POST /api/geo/grid` —la corrida paga de H2-GO-3— gaste sin sesión, sin
 * rol, por encima del tope o sobre el negocio de otra organización; que escriba
 * con una organización que no es la del negocio; que guarde un fallo como «no
 * aparece»; o que su respuesta no publique el denominador. Y que
 * `GET /api/geo/grid` muestre una corrida ajena o calcule la distancia y el
 * veredicto de otra forma que la puerta.
 *
 * LOS DOS DOBLES RECORREN LA SECUENCIA (R13)
 *
 * El de la base guarda TABLAS, aplica los `eq`/`in` que la ruta manda, y del
 * lado de la sesión aplica una RLS (sólo las organizaciones donde quien llama es
 * miembro ACTIVO); `rlsRota` la apaga para medir lo único que la RLS no puede
 * probar: que la ruta verifica la organización EN CÓDIGO antes de escribir con
 * `service_role`. Sus escrituras imitan los CHECK de la 0032 —un resultado con
 * lo de otro, o más de nueve puntos, es el 23514 que daría la base—.
 *
 * El de Google es `googleGeografico`: ordena por distancia al centro del sesgo
 * de cada pedido. Y los dos escriben en la MISMA lista de eventos, así que el
 * test afirma el orden: la corrida se escribe ANTES del primer pedido a Google,
 * las observaciones DESPUÉS del último.
 *
 * Ninguna llamada sale a Google: `globalThis.fetch` es el doble en cada test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desplazar } from "@/lib/geo/grilla";
import { googleGeografico, lugaresAlrededor } from "@/lib/geo/__tests__/googleGeografico";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEGOCIO_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const NEGOCIO_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
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

const C = { lat: 59.3293, lng: 18.0686 };
const LUGARES = lugaresAlrededor(C, 60);
const OBJETIVO = LUGARES[0].id;

type Fila = Record<string, unknown>;
type Filtro = { op: "eq" | "in"; col: string; val: unknown };

const estado = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
  sinProveedor: false,
  tablas: {} as Record<string, Fila[]>,
  rlsRota: false,
  errores: {} as Record<string, { code: string; message: string }>,
  eventos: [] as string[],
  escrituras: [] as Array<{ cliente: "sesion" | "admin"; tabla: string; op: string; filas: Fila[]; filtros: Filtro[] }>,
  secuencia: 0,
}));

function orgsActivas(usuario: string | undefined): string[] {
  return (estado.tablas.org_members ?? [])
    .filter((m) => m.user_id === usuario && m.state === "active")
    .map((m) => m.organization_id as string);
}

/** Los CHECK de la 0032 que una escritura de la ruta podría violar. */
function violaCheck(tabla: string, fila: Fila): boolean {
  if (tabla === "geo_grid_runs") return ![1, 4, 9].includes(fila.n_points as number);
  if (tabla === "geo_grid_observations") {
    const { outcome, position, error_code } = fila;
    const coherente =
      (outcome === "position" && typeof position === "number" && position >= 1 && position <= 20 && error_code === null) ||
      (outcome === "absent" && position === null && error_code === null) ||
      (outcome === "failed" && position === null && typeof error_code === "string");
    const forma = error_code === null || /^(http_[1-5][0-9]{2}|timeout|network|invalid_response|missing_key)$/.test(String(error_code));
    return !coherente || !forma || fila.source !== "google_places_text_search";
  }
  return false;
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
      const filas = (Array.isArray(valores) ? valores : [valores]) as Fila[];
      if (filas.some((f) => violaCheck(tabla, f))) {
        return { data: null, error: { code: "23514", message: "violates check constraint" }, count: null };
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

function sembrar() {
  estado.tablas = {
    org_members: [
      { organization_id: ORG_A, user_id: ALICIA, role: "owner", state: "active" },
      { organization_id: ORG_B, user_id: BRUNO, role: "owner", state: "active" },
      { organization_id: ORG_A, user_id: CARLA, role: "viewer", state: "active" },
      { organization_id: ORG_B, user_id: DIEGO, role: "owner", state: "active" },
      { organization_id: ORG_A, user_id: DIEGO, role: "viewer", state: "active" },
      { organization_id: ORG_A, user_id: ELENA, role: "manager", state: "archived" },
    ],
    businesses: [
      { id: NEGOCIO_A, organization_id: ORG_A, name: "Mörby" },
      { id: NEGOCIO_B, organization_id: ORG_B, name: "Bruno Co" },
    ],
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
  process.env.GOOGLE_PLACES_API_KEY = "clave-falsa-de-places";
  google = googleGeografico(LUGARES, { eventos: estado.eventos });
  globalThis.fetch = google.transporte;
});

afterEach(() => {
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

describe("POST /api/geo/grid: el pedido y EL TOPE", () => {
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

  it("9 puntos (lado 3): exactamente nueve pedidos a Google", async () => {
    const res = await POST(pedirPost(cuerpoValido({ gridSize: 3 })));
    expect(res.status).toBe(200);
    expect(google.pedidos).toHaveLength(9);
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

  it("escribe con service_role, con la organización DEL NEGOCIO, quién la corrió y la grilla declarada", async () => {
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
    });
    expect(observaciones.tabla).toBe("geo_grid_observations");
    expect(observaciones.filas).toHaveLength(9);
    for (const o of observaciones.filas) {
      expect(o).toMatchObject({ organization_id: ORG_A, run_id: corrida.filas[0].id, source: "google_places_text_search" });
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

  it("la respuesta publica el denominador: 9 puntos, cuántos devolvieron dato y cuántos fallaron", async () => {
    const res = await POST(pedirPost(cuerpoValido()));
    const cuerpo = await res.json();
    expect(cuerpo.denominador.puntos).toBe(9);
    expect(cuerpo.denominador.fallaron).toBe(0);
    expect(cuerpo.denominador.devolvieronDato).toBe(9);
    expect(cuerpo.denominador.aparece + cuerpo.denominador.noAparece).toBe(9);
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

  it("si las observaciones no se pueden escribir, la plata ya se gastó: 200 con todo y guardado.ok = false", async () => {
    estado.errores["insert:geo_grid_observations"] = { code: "23514", message: "secreto de postgres" };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.guardado).toMatchObject({ ok: false, motivo: "observaciones-no-guardadas" });
    expect(cuerpo.denominador.puntos).toBe(9);
    expect(JSON.stringify(cuerpo)).not.toContain("secreto de postgres");
  });

  it("si la corrida no se puede escribir, no se sale a la red: 502 y cero pedidos", async () => {
    estado.errores["insert:geo_grid_runs"] = { code: "42501", message: "permission denied" };
    const res = await POST(pedirPost(cuerpoValido()));
    expect(res.status).toBe(502);
    expect(google.pedidos).toHaveLength(0);
  });
});

describe("GET /api/geo/grid: la corrida, la distancia y el veredicto", () => {
  async function correr(centro = C) {
    const cuerpo = await (await POST(pedirPost(cuerpoValido({ center: centro })))).json();
    return cuerpo.run.id as string;
  }

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
    expect(cuerpo.denominador).toMatchObject({ puntos: 9, fallaron: 0, sinObservacion: 0 });
  });

  it("la corrida de otra organización es 404", async () => {
    const id = await correr();
    estado.usuario = { id: BRUNO };
    const res = await GET(pedirGet({ runId: id }));
    expect(res.status).toBe(404);
  });

  it("A, A' y B (8 km al este), por HTTP: d(A,A') = 0, d(A,B) > 0 y verde", async () => {
    const a = await correr(C);
    const a2 = await correr(C);
    const b = await correr(desplazar(C, 0, 8000));

    const res = await GET(pedirGet({ runId: a, repeatId: a2, shiftedId: b }));
    expect(res.status).toBe(200);
    const { veredicto } = await res.json();
    expect(veredicto.motivos).toEqual([]);
    expect(veredicto.verde).toBe(true);
    expect(veredicto.ruido).toMatchObject({ estado: "numero", valor: 0, comparables: 9 });
    expect(veredicto.geografia.estado).toBe("numero");
    expect(veredicto.geografia.valor).toBeGreaterThan(0);
    expect(veredicto.desplazamientoMedidoM).toBeCloseTo(8000, 0);
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
