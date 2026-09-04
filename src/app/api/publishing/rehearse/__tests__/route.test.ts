/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el transporte vuelva a ser un módulo que nadie llama, y que esta ruta lo
 * llame MAL.
 *
 * `transport.test.ts` prueba el camino del ledger con 19 tests, y seguiría
 * entero en verde con `route.ts` borrado: no puede ver el cableado. Lo que se
 * afirma acá es lo que sólo se rompe en el enganche —con qué se llamó, en qué
 * modo, y cuándo NO se llamó— porque el defecto que este proyecto ya se comió es
 * exactamente ése.
 *
 * EL DOBLE DEL TRANSPORTE ES UN ESPÍA, NO UN SIMULACRO
 *
 * Guarda los argumentos. Sin eso, un test que sólo mirara el código HTTP pasaría
 * con una ruta que llama `publicar` con el hash que mandó el cliente, o en
 * `en-vivo`, o sobre la organización equivocada — las tres cosas que este
 * archivo existe para impedir.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_DEL_ASSET = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const ASSET = "7d703707-4f9d-43bf-9305-6bc22eddf45f";
const HASH_APROBADO = "9e107d9d372bb6826bd81d3542a419d6";

/** Quién dice ser el usuario. */
let usuario: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };

/**
 * Lo que la RLS deja ver de `content_assets`, y si la lectura falló.
 *
 * Van por separado a propósito: un doble que devolviera `data: null` JUNTO con el
 * error no mediría la rama del error —caería por la fila ausente, que es otra
 * línea—. El caso que importa es el que trae error Y algo en `data`.
 */
let fila: { id: string; organization_id: string; approved_hash: string | null } | null = null;
let errorLectura: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: fila, error: errorLectura }),
        }),
      }),
    }),
  }),
}));

/** Cada llamada al transporte, con TODOS sus argumentos. */
let llamadas: unknown[][] = [];
let respuesta: unknown = { ok: true, estado: "ensayado", publicationId: "pub-1" };

vi.mock("@/lib/publishing/transport", () => ({
  publicar: async (...args: unknown[]) => {
    llamadas.push(args);
    return respuesta;
  },
}));

const { POST } = await import("../route");

function pedido(cuerpo: unknown): Request {
  return new Request("http://localhost/api/publishing/rehearse", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${llamadas.length + 1}` },
    body: JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  usuario = { id: "11111111-1111-4111-8111-111111111111" };
  fila = { id: ASSET, organization_id: ORG_DEL_ASSET, approved_hash: HASH_APROBADO };
  errorLectura = null;
  llamadas = [];
  respuesta = { ok: true, estado: "ensayado", publicationId: "pub-1" };
});

describe("quién llama al transporte", () => {
  it("lo llama con el hash del ASSET, en `dry-run`, y sin publicador", async () => {
    const res = await POST(pedido({ assetId: ASSET }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, estado: "ensayado", publicationId: "pub-1" });

    expect(llamadas).toHaveLength(1);
    const [entrada, modo, publicador] = llamadas[0];
    expect(entrada).toEqual({
      organizationId: ORG_DEL_ASSET,
      assetId: ASSET,
      approvedHash: HASH_APROBADO,
      destino: "google_business_profile",
    });
    // El modo es un literal de quien llama. Si algún día llega en el cuerpo del
    // pedido, esta línea es la que lo tiene que impedir.
    expect(modo).toBe("dry-run");
    // Y nunca un publicador: un ensayo que pudiera publicar no es un ensayo.
    expect(publicador).toBeUndefined();
  });

  it("toma la organización del asset y NO la que mande quien llama", async () => {
    // El cuerpo trae una organización ajena. Si la ruta la usara, la reserva
    // quedaría escrita en la organización de quien pide, sobre el asset de otro.
    await POST(pedido({ assetId: ASSET, organizationId: "00000000-0000-4000-8000-000000000000" }));

    expect((llamadas[0][0] as { organizationId: string }).organizationId).toBe(ORG_DEL_ASSET);
  });
});

describe("cuándo NO se llama al transporte", () => {
  it("sin sesión: 401, y el ledger no se toca", async () => {
    usuario = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(401);
    expect(llamadas).toHaveLength(0);
  });

  it("un no-miembro no puede ensayar sobre el asset de otra organización", async () => {
    // La RLS de la `0014` le esconde la fila: la lectura vuelve vacía, igual que
    // con un id inventado. Por eso son 404 y no 403 — quien no es miembro no se
    // entera de que el asset existe.
    fila = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(404);
    // Lo que de verdad se está midiendo: NO se reservó ninguna fila a su nombre.
    expect(llamadas).toHaveLength(0);
  });

  it("un asset sin aprobar: 409, y sin mandar un hash que no existe", async () => {
    fila = { id: ASSET, organization_id: ORG_DEL_ASSET, approved_hash: null };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, motivo: "no-aprobado" });
    expect(llamadas).toHaveLength(0);
  });

  it("si la lectura del asset falla, no publica ni inventa un 404", async () => {
    errorLectura = { message: "connection reset" };
    fila = { id: ASSET, organization_id: ORG_DEL_ASSET, approved_hash: HASH_APROBADO };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(502);
    expect(llamadas).toHaveLength(0);
  });

  it("un assetId que no es uuid no llega a la base", async () => {
    const res = await POST(pedido({ assetId: "no-es-un-uuid" }));
    expect(res.status).toBe(400);
    expect(llamadas).toHaveLength(0);
  });
});

describe("lo que contesta cuando el transporte dice que no", () => {
  it("`no-aprobado` es 409 y nunca 200", async () => {
    respuesta = { ok: false, motivo: "no-aprobado" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, motivo: "no-aprobado" });
  });

  it("`ledger-ilegible` es 502 y nunca 200", async () => {
    respuesta = { ok: false, motivo: "ledger-ilegible", detalle: "sin conexión" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(502);
  });

  it("un motivo que acá no debería pasar tampoco se lee como éxito", async () => {
    // `sin-transporte` no puede ocurrir en `dry-run`. Si ocurriera, sería que el
    // modo dejó de ser el que esta ruta cree: 500, no 200.
    respuesta = { ok: false, motivo: "sin-transporte" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });

  it("`ya-publicado` es un 200, y no reintenta nada", async () => {
    respuesta = { ok: true, estado: "ya-publicado", publicationId: "pub-1", externalId: "gbp-9" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      estado: "ya-publicado",
      publicationId: "pub-1",
      externalId: "gbp-9",
    });
    expect(llamadas).toHaveLength(1);
  });
});
