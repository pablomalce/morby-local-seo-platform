/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el alta de un cliente cree una organización a nombre de otro, o que un
 * fallo a mitad de camino se lea como éxito.
 *
 * Se afirma sobre lo que se LLAMA y lo que se ESCRIBE: un 201 es un 201 con el
 * negocio creado y sin él.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_NUEVA = "11111111-1111-4111-8111-111111111111";

let usuario: { id: string } | null = { id: "u1" };
let rpcs: { fn: string; args: Record<string, unknown> }[] = [];
let rpcDevuelve: unknown = ORG_NUEVA;
let rpcError: { message: string } | null = null;
let filaNegocio: Record<string, unknown> | null = null;
let negocioDevuelve: { id: string } | null = { id: "b1" };
let negocioError: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: rpcDevuelve, error: rpcError };
    },
    from: () => ({
      insert: (valores: Record<string, unknown>) => {
        filaNegocio = valores;
        return {
          select: () => ({
            maybeSingle: async () => ({ data: negocioDevuelve, error: negocioError }),
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
  return new Request("http://localhost/api/organizations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.3.0.${n}` },
    body: JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  usuario = { id: "u1" };
  rpcs = [];
  rpcDevuelve = ORG_NUEVA;
  rpcError = null;
  filaNegocio = null;
  negocioDevuelve = { id: "b1" };
  negocioError = null;
});

describe("dar de alta un cliente", () => {
  it("llama a la función de la base y crea el negocio en la organización NUEVA", async () => {
    const res = await POST(pedido({ name: "Cliente Ejemplo", website: "https://ejemplo.com" }));

    expect(res.status).toBe(201);
    expect(rpcs).toEqual([{ fn: "create_client_organization", args: { p_name: "Cliente Ejemplo" } }]);
    expect(filaNegocio).toMatchObject({
      organization_id: ORG_NUEVA,
      name: "Cliente Ejemplo",
      website: "https://ejemplo.com",
    });
  });

  it("NO le manda un usuario a la función: la membresía la decide `auth.uid()`", async () => {
    // Si la ruta pudiera decir a nombre de quién, dar de alta un cliente sería
    // fabricar membresías ajenas.
    await POST(pedido({ name: "Cliente", userId: "otro" }));
    expect(rpcs[0].args).toEqual({ p_name: "Cliente" });
  });

  it("guarda el insumo estratégico, que es para lo que se pide", async () => {
    await POST(
      pedido({
        name: "Cliente",
        industry: "restaurant",
        valueProposition: "Cocina de mercado",
        brandTone: "cercano",
        locale: "es",
      })
    );
    expect(filaNegocio).toMatchObject({
      industry: "restaurant",
      value_proposition: "Cocina de mercado",
      brand_tone: "cercano",
      primary_locale: "es",
    });
  });

  it("si el negocio falla, DICE que la organización existe y devuelve su id", async () => {
    // Contestar «no se pudo» a secas mandaría a crearla de nuevo, y la segunda
    // tendría slug `cliente-1`.
    negocioDevuelve = null;
    negocioError = { message: "boom" };
    const res = await POST(pedido({ name: "Cliente" }));

    expect(res.status).toBe(207);
    expect(await res.json()).toEqual({
      ok: false,
      motivo: "organizacion-creada-sin-negocio",
      organizationId: ORG_NUEVA,
    });
  });

  it("si la función falla, no intenta crear el negocio", async () => {
    rpcDevuelve = null;
    rpcError = { message: "permission denied" };
    const res = await POST(pedido({ name: "Cliente" }));

    expect(res.status).toBe(502);
    expect(filaNegocio).toBeNull();
  });

  it("sin sesión no llama a nada", async () => {
    usuario = null;
    const res = await POST(pedido({ name: "Cliente" }));
    expect(res.status).toBe(401);
    expect(rpcs).toHaveLength(0);
  });

  it("un nombre vacío no llega a la base", async () => {
    const res = await POST(pedido({ name: "   " }));
    expect(res.status).toBe(400);
    expect(rpcs).toHaveLength(0);
  });
});
