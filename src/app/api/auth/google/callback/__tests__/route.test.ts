/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que las decisiones estén bien y el CABLEADO no.
 *
 * `oauth.test.ts` prueba que el `state` se lea, y `tokenStore.test.ts` que el
 * token se resuelva. Ninguno de los dos puede probar lo que esta ruta tiene que
 * garantizar: que el `state` se compare ANTES de canjear el código, que la
 * membresía de la agencia se mire aunque la cookie coincida, que la cookie se
 * borre pase lo que pase, y que guardar sea UNA llamada.
 *
 * Es el defecto que este repositorio ya se comió dos veces: un módulo con treinta
 * y un tests que nadie invocaba. Por eso acá se afirma sobre QUÉ se llamó y en
 * qué orden, y no sólo sobre a dónde redirige.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const ESTADO = "a".repeat(64);

/** La cookie, con lo que se le pidió: es parte de lo que se afirma. */
let cookieGuardada: string | undefined;
let cookieBorrada = false;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nombre: string) =>
      nombre === "vulkan_google_oauth_state" && cookieGuardada !== undefined
        ? { value: cookieGuardada }
        : undefined,
    delete: () => {
      cookieBorrada = true;
    },
    set: () => {},
  }),
}));

/** Quién dice ser el usuario, y de qué organización es miembro. */
let usuario: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };
let membresias: { organization_id: string }[] = [{ organization_id: ORG }];
/**
 * Y si la consulta de membresía falló. Va aparte de `membresias` a propósito: un
 * doble que devolviera `data: null` JUNTO con el error no mediría esta rama —
 * fallaría por la lista vacía, que es otra línea. El caso que importa es el que
 * trae filas Y error.
 */
let errorMembresia: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: async () => ({ data: membresias, error: errorMembresia }),
          }),
        }),
      }),
    }),
  }),
}));

/** Cada RPC con sus argumentos. Es lo que dice si se guardó, y cómo. */
let rpcs: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22", error: null };
    },
  }),
}));

const { GET } = await import("../route");

/** Cuántas veces se llamó al endpoint de tokens de Google. */
let canjes = 0;

function pedido(query: string): Request {
  return new Request(`https://ejemplo.test/api/auth/google/callback?${query}`);
}

function destino(respuesta: Response): string {
  const url = new URL(respuesta.headers.get("location") ?? "", "https://ejemplo.test");
  return url.pathname + url.search;
}

beforeEach(() => {
  cookieGuardada = ESTADO;
  cookieBorrada = false;
  usuario = { id: "11111111-1111-4111-8111-111111111111" };
  membresias = [{ organization_id: ORG }];
  errorMembresia = null;
  rpcs = [];
  canjes = 0;

  process.env.VULKAN_AGENCY_ORG_ID = ORG;
  process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "no-es-un-secreto-real";
  process.env.GOOGLE_REDIRECT_URI = "https://ejemplo.test/api/auth/google/callback";

  vi.stubGlobal("fetch", async () => {
    canjes += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: "ACCESO-sintetico-9f4a", refresh_token: "REFRESCO-sintetico-2b6d", expires_in: 3600 }),
    } as unknown as Response;
  });
});

describe("el camino completo", () => {
  it("canjea, guarda con UNA llamada, y vuelve diciendo que conectó", async () => {
    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));

    expect(canjes).toBe(1);
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe("store_integration_token");
    expect(rpcs[0].args.p_organization_id).toBe(ORG);
    expect(rpcs[0].args.p_provider).toBe("google");
    expect(JSON.parse(String(rpcs[0].args.p_secret))).toEqual({
      refresh_token: "REFRESCO-sintetico-2b6d",
      access_token: "ACCESO-sintetico-9f4a",
    });
    expect(destino(r)).toBe("/app/integrations?google=connected");
  });

  it("el secreto que se guarda NO viaja en la respuesta", async () => {
    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));
    expect(r.headers.get("location")).not.toContain("REFRESCO-sintetico-2b6d");
    expect(r.headers.get("location")).not.toContain("ACCESO-sintetico-9f4a");
  });
});

describe("el state, que es lo único que separa esto de un CSRF", () => {
  it("un state que no coincide NO llega a canjear nada", async () => {
    const r = await GET(pedido("code=el-codigo&state=" + "b".repeat(64)));

    expect(canjes).toBe(0);
    expect(rpcs).toHaveLength(0);
    expect(destino(r)).toBe("/app/integrations?google=bad-state");
  });

  it("sin cookie tampoco, aunque el state venga bien formado", async () => {
    cookieGuardada = undefined;
    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));

    expect(canjes).toBe(0);
    expect(destino(r)).toBe("/app/integrations?google=bad-state");
  });

  it("un state de otro largo se rechaza sin explotar", async () => {
    const r = await GET(pedido("code=el-codigo&state=corto"));
    expect(destino(r)).toBe("/app/integrations?google=bad-state");
  });

  it("la cookie se borra aunque el intento haya sido rechazado", async () => {
    await GET(pedido("code=el-codigo&state=" + "b".repeat(64)));
    expect(cookieBorrada).toBe(true);
  });

  it("y también cuando todo sale bien: un state vale una sola vez", async () => {
    await GET(pedido(`code=el-codigo&state=${ESTADO}`));
    expect(cookieBorrada).toBe(true);
  });
});

describe("quién vuelve", () => {
  it("alguien que no es de la agencia no guarda nada, ni se entera de que la ruta existe", async () => {
    membresias = [];
    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));

    expect(r.status).toBe(404);
    expect(canjes).toBe(0);
    expect(rpcs).toHaveLength(0);
  });

  it("sin sesión se manda al login y no se canjea", async () => {
    usuario = null;
    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));

    expect(canjes).toBe(0);
    expect(destino(r)).toBe("/login?redirectTo=/app/integrations");
  });

  it("una consulta de membresía que FALLÓ no es una membresía", async () => {
    // Las filas dicen que sí y el error dice que la respuesta no vale. Sin la
    // comprobación del error, una caída de Supabase se convierte en un permiso:
    // cualquiera con sesión escribiría el token de la plataforma.
    errorMembresia = { message: "la consulta falló" };

    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));

    expect(r.status).toBe(404);
    expect(canjes).toBe(0);
    expect(rpcs).toHaveLength(0);
  });

  it("la membresía se mira DESPUÉS del state, no en lugar de él", async () => {
    membresias = [];
    const r = await GET(pedido("code=el-codigo&state=" + "b".repeat(64)));
    // Con el orden invertido esto contestaría 404 en vez del rechazo del state, y
    // un CSRF contra un operador legítimo pasaría igual.
    expect(destino(r)).toBe("/app/integrations?google=bad-state");
  });
});

describe("lo que vuelve de Google", () => {
  it("un rechazo del operador se dice como rechazo", async () => {
    const r = await GET(pedido("error=access_denied&state=" + ESTADO));
    expect(destino(r)).toBe("/app/integrations?google=denied");
    expect(canjes).toBe(0);
  });

  it("una vuelta sin código no llega a la base", async () => {
    const r = await GET(pedido(`state=${ESTADO}`));
    expect(destino(r)).toBe("/app/integrations?google=incomplete");
    expect(rpcs).toHaveLength(0);
  });

  it("un canje sin refresh token lleva motivo propio y NO se guarda", async () => {
    vi.stubGlobal("fetch", async () => {
      canjes += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "at", expires_in: 3600 }),
      } as unknown as Response;
    });

    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));
    expect(rpcs).toHaveLength(0);
    expect(destino(r)).toBe("/app/integrations?google=no-refresh-token");
  });

  it("un 400 del endpoint de tokens no escribe nada", async () => {
    vi.stubGlobal("fetch", async () => {
      canjes += 1;
      return { ok: false, status: 400, json: async () => ({}) } as unknown as Response;
    });

    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));
    expect(rpcs).toHaveLength(0);
    expect(destino(r)).toBe("/app/integrations?google=exchange-failed");
  });
});

describe("sin credenciales de plataforma", () => {
  it("no se canjea nada y el motivo lo dice", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const r = await GET(pedido(`code=el-codigo&state=${ESTADO}`));

    expect(canjes).toBe(0);
    expect(destino(r)).toBe("/app/integrations?google=not-configured");
  });
});
