/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que guardar la organización activa guarde cualquier cosa, o que falle en
 * silencio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";

let usuario: { id: string } | null = { id: "u1" };
let membresia: { organization_id: string; state: string | null } | null = null;
let errorLectura: { message: string } | null = null;
let cookieGuardada: { nombre: string; valor: string; opciones: Record<string, unknown> } | null = null;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (nombre: string, valor: string, opciones: Record<string, unknown>) => {
      cookieGuardada = { nombre, valor, opciones };
    },
    get: () => undefined,
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: membresia, error: errorLectura }) }),
        }),
      }),
    }),
  }),
}));

const { POST } = await import("../route");

function pedido(cuerpo: unknown): Request {
  return new Request("http://localhost/api/organizations/active", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  usuario = { id: "u1" };
  membresia = { organization_id: ORG, state: "active" };
  errorLectura = null;
  cookieGuardada = null;
});

describe("guardar la organización activa", () => {
  it("la guarda cuando es una membresía activa del usuario", async () => {
    const res = await POST(pedido({ organizationId: ORG }));
    expect(res.status).toBe(200);
    expect(cookieGuardada?.valor).toBe(ORG);
  });

  it("la cookie NO es httpOnly, porque el navegador tiene que elegir lo mismo", async () => {
    // Si lo fuera, `fetchMyBusinesses` no podría leerla y la mitad cliente de la
    // aplicación elegiría OTRA organización que la de las pantallas de servidor.
    await POST(pedido({ organizationId: ORG }));
    expect(cookieGuardada?.opciones.httpOnly).toBe(false);
  });

  it("sin sesión no guarda nada", async () => {
    usuario = null;
    expect((await POST(pedido({ organizationId: ORG }))).status).toBe(401);
    expect(cookieGuardada).toBeNull();
  });

  it("una organización de la que no es miembro: 404 y sin guardar", async () => {
    membresia = null;
    expect((await POST(pedido({ organizationId: ORG }))).status).toBe(404);
    expect(cookieGuardada).toBeNull();
  });

  it("una membresía archivada: 409 y sin guardar", async () => {
    // Guardarla dejaría a alguien apretando un selector que después se ignora.
    membresia = { organization_id: ORG, state: "archived" };
    expect((await POST(pedido({ organizationId: ORG }))).status).toBe(409);
    expect(cookieGuardada).toBeNull();
  });

  it("un fallo de lectura no es «no sos miembro»", async () => {
    errorLectura = { message: "connection reset" };
    expect((await POST(pedido({ organizationId: ORG }))).status).toBe(502);
    expect(cookieGuardada).toBeNull();
  });

  it("un id que no es uuid no llega a la base", async () => {
    expect((await POST(pedido({ organizationId: "x" }))).status).toBe(400);
    expect(cookieGuardada).toBeNull();
  });
});
