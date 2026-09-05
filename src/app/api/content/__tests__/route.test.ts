/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que crear un asset escriba en la organización equivocada, o que nazca
 * aprobado.
 *
 * Se afirma sobre lo que se ESCRIBE, no sobre el código HTTP: un 201 es un 201
 * con la organización de quien pide o con la del negocio, y desde afuera se ven
 * iguales.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NEGOCIO = "7d703707-4f9d-43bf-9305-6bc22eddf45f";
const ORG_DEL_NEGOCIO = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";

let usuario: { id: string } | null = { id: "9720b91a-0b6e-4b3d-8c09-2f926733c270" };
let negocio: { id: string; organization_id: string } | null = null;
let errorLectura: { message: string } | null = null;
let filaEscrita: Record<string, unknown> | null = null;
let devuelve: { id: string; status: string } | null = null;
let errorEscritura: { message?: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: negocio, error: errorLectura }) }),
      }),
      insert: (valores: Record<string, unknown>) => {
        filaEscrita = valores;
        return {
          select: () => ({ maybeSingle: async () => ({ data: devuelve, error: errorEscritura }) }),
        };
      },
    }),
  }),
}));

const { POST } = await import("../route");

let n = 0;
function pedido(cuerpo: unknown): Request {
  n += 1;
  return new Request("http://localhost/api/content", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.2.0.${n}` },
    body: JSON.stringify(cuerpo),
  });
}

const VALIDO = { businessId: NEGOCIO, kind: "gbp_post", body: "Texto del posteo" };

beforeEach(() => {
  usuario = { id: "9720b91a-0b6e-4b3d-8c09-2f926733c270" };
  negocio = { id: NEGOCIO, organization_id: ORG_DEL_NEGOCIO };
  errorLectura = null;
  errorEscritura = null;
  filaEscrita = null;
  devuelve = { id: "asset-1", status: "draft" };
});

describe("qué se escribe al crear", () => {
  it("la organización sale del NEGOCIO, no del pedido", async () => {
    const res = await POST(
      pedido({ ...VALIDO, organizationId: "00000000-0000-4000-8000-000000000000" })
    );
    expect(res.status).toBe(201);
    expect(filaEscrita).toMatchObject({
      organization_id: ORG_DEL_NEGOCIO,
      business_id: NEGOCIO,
      status: "draft",
    });
  });

  it("nace en `draft` aunque pidan otro estado", async () => {
    // Aprobar es un acto con autor y fecha, y tiene su propia ruta. Un asset que
    // nace aprobado no tiene quién lo aprobó.
    await POST(pedido({ ...VALIDO, status: "approved" }));
    expect(filaEscrita?.status).toBe("draft");
  });

  it("no escribe ningún sello: el hash y el autor son de la ruta de aprobación", async () => {
    await POST(pedido({ ...VALIDO, approvedHash: "0".repeat(32), approvedBy: "x" }));
    expect(filaEscrita).not.toHaveProperty("approved_hash");
    expect(filaEscrita).not.toHaveProperty("approved_by");
  });

  it("el idioma por defecto es `en`, y sólo acepta los de la aplicación", async () => {
    await POST(pedido(VALIDO));
    expect(filaEscrita?.locale).toBe("en");

    filaEscrita = null;
    const res = await POST(pedido({ ...VALIDO, locale: "pt" }));
    expect(res.status).toBe(400);
    expect(filaEscrita).toBeNull();
  });

  it("un cuerpo vacío no llega a la base", async () => {
    // `body` es NOT NULL y es lo que se publica: un asset sin texto es una fila
    // que nadie puede aprobar y que ensucia la lista.
    const res = await POST(pedido({ ...VALIDO, body: "   " }));
    expect(res.status).toBe(400);
    expect(filaEscrita).toBeNull();
  });
});

describe("cuándo NO se escribe", () => {
  it("sin sesión: 401", async () => {
    usuario = null;
    const res = await POST(pedido(VALIDO));
    expect(res.status).toBe(401);
    expect(filaEscrita).toBeNull();
  });

  it("un no-miembro no puede crear sobre el negocio de otra organización", async () => {
    negocio = null;
    const res = await POST(pedido(VALIDO));
    expect(res.status).toBe(404);
    expect(filaEscrita).toBeNull();
  });

  it("si la lectura del negocio falla, no escribe ni inventa un 404", async () => {
    errorLectura = { message: "connection reset" };
    const res = await POST(pedido(VALIDO));
    expect(res.status).toBe(502);
    expect(filaEscrita).toBeNull();
  });

  it("sin error y sin fila es la RLS negando el INSERT: 404, no «creado»", async () => {
    devuelve = null;
    const res = await POST(pedido(VALIDO));
    expect(res.status).toBe(404);
  });
});
