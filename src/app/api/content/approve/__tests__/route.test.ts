/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que aprobar sea sellar cualquier cosa.
 *
 * Lo que se afirma es el CABLEADO —con qué se escribe, de dónde sale el hash, y
 * cuándo NO se escribe— porque las tres maneras de romper esto se ven iguales
 * desde afuera: un 200 es un 200.
 *
 * El doble es un espía: guarda lo que se le mandó. Sin eso, un test que sólo
 * mirara el código HTTP pasaría con una ruta que sella el hash que manda el
 * cliente, que es exactamente lo que no puede pasar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ASSET = "7d703707-4f9d-43bf-9305-6bc22eddf45f";
const USUARIO = "9720b91a-0b6e-4b3d-8c09-2f926733c270";
/** El hash que la BASE calculó, en la columna generada. */
const HUELLA_DE_LA_BASE = "9e107d9d372bb6826bd81d3542a419d6";

let usuario: { id: string } | null = { id: USUARIO };
let fila: { id: string; status: string; payload_hash: string | null } | null = null;
let errorLectura: { message: string } | null = null;
let errorEscritura: { code?: string; message?: string } | null = null;
let filaEscrita: Record<string, unknown> | null = null;
/** Lo que la escritura devuelve. `null` sin error es la RLS negando el UPDATE. */
let devuelveTrasEscribir: { id: string; status: string; approved_hash: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: fila, error: errorLectura }) }),
      }),
      update: (valores: Record<string, unknown>) => {
        filaEscrita = valores;
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: devuelveTrasEscribir, error: errorEscritura }),
            }),
          }),
        };
      },
    }),
  }),
}));

const { POST } = await import("../route");

let n = 0;
function pedido(cuerpo: unknown): Request {
  n += 1;
  return new Request("http://localhost/api/content/approve", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${n}` },
    body: JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  usuario = { id: USUARIO };
  fila = { id: ASSET, status: "draft", payload_hash: HUELLA_DE_LA_BASE };
  errorLectura = null;
  errorEscritura = null;
  filaEscrita = null;
  devuelveTrasEscribir = { id: ASSET, status: "approved", approved_hash: HUELLA_DE_LA_BASE };
});

describe("de dónde sale el sello", () => {
  it("sella la huella que calculó LA BASE, y anota quién y cuándo", async () => {
    const res = await POST(pedido({ assetId: ASSET }));

    expect(res.status).toBe(200);
    expect(filaEscrita).toMatchObject({
      status: "approved",
      approved_hash: HUELLA_DE_LA_BASE,
      approved_by: USUARIO,
    });
    expect(typeof filaEscrita?.approved_at).toBe("string");
  });

  it("ignora cualquier hash que mande quien llama", async () => {
    // Un hash elegido por el cliente es una aprobación elegida por el cliente:
    // se podría sellar el texto de ayer sobre el cuerpo de hoy.
    await POST(pedido({ assetId: ASSET, approvedHash: "00000000000000000000000000000000" }));

    expect(filaEscrita?.approved_hash).toBe(HUELLA_DE_LA_BASE);
  });

  it("no sella a nombre de otro: `approved_by` es quien tiene la sesión", async () => {
    await POST(pedido({ assetId: ASSET, approvedBy: "11111111-1111-4111-8111-111111111111" }));

    expect(filaEscrita?.approved_by).toBe(USUARIO);
  });
});

describe("cuándo NO se escribe", () => {
  it("sin sesión: 401 y no se toca la fila", async () => {
    usuario = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(401);
    expect(filaEscrita).toBeNull();
  });

  it("un no-miembro no puede aprobar el asset de otra organización", async () => {
    // La RLS le esconde la fila: la lectura vuelve vacía, igual que con un id
    // inventado. Por eso 404 y no 403.
    fila = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(404);
    expect(filaEscrita).toBeNull();
  });

  it("si la lectura falla, no aprueba ni inventa un 404", async () => {
    errorLectura = { message: "connection reset" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(502);
    expect(filaEscrita).toBeNull();
  });

  it("sin huella no sella nada", async () => {
    fila = { id: ASSET, status: "draft", payload_hash: null };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(502);
    expect(filaEscrita).toBeNull();
  });

  it("un assetId que no es uuid no llega a la base", async () => {
    const res = await POST(pedido({ assetId: "no-es-un-uuid" }));
    expect(res.status).toBe(400);
    expect(filaEscrita).toBeNull();
  });
});

describe("lo que contesta cuando la base dice que no", () => {
  it("si el texto cambió entre la lectura y la escritura, 409 y no 200", async () => {
    // Es el CHECK de la 0015 haciendo su trabajo: `approved_hash` ya no coincide
    // con el `payload_hash` nuevo. Sólo la base puede saberlo.
    errorEscritura = { code: "23514", message: "content_assets_approval_check" };
    devuelveTrasEscribir = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, motivo: "el-texto-cambio" });
  });

  it("otro error de escritura es 502, y nunca un éxito", async () => {
    errorEscritura = { code: "08006", message: "connection failure" };
    devuelveTrasEscribir = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });

  it("sin error y sin fila es la RLS negando el UPDATE: 404, no «aprobado»", async () => {
    // Alcanzó a LEER y no a escribir. Decir «aprobado» acá es el peor caso de
    // esta ruta: el ledger después reservaría contra un sello que no existe.
    devuelveTrasEscribir = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(404);
  });
});
