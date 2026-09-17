import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El middleware falla CERRADO donde hay puerta, y sigue abierto donde no la hay.
 *
 * QUÉ AGUJERO CIERRA
 *
 * Medido el 2026-09-16 por un refutador del barrido de rutas: el `catch` del
 * middleware dejaba pasar cualquier pedido cuando Supabase fallaba —«para no
 * tirar el sitio»— y lo mismo cuando faltaban las variables. Para `/overview`
 * es correcto: nunca necesitó sesión. Para `/app/*` era la puerta abierta: una
 * caída de Supabase, o un deploy sin variables, y todo el área privada se
 * servía a cualquiera. «No pude comprobar la sesión» no es «la comprobé y
 * está bien».
 *
 * CÓMO FALLA
 *
 * Volver el `catch` a `NextResponse.next()` pone en rojo los dos casos de
 * `/app`; volver el chequeo de variables a `next()` pone en rojo el primero.
 * Los públicos siguen pasando en los dos casos, que es la otra mitad de la
 * garantía: cerrar de más también sería un defecto.
 */
const supabase = vi.hoisted(() => ({ modo: "sin-usuario" as "sin-usuario" | "tira" | "con-usuario" }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    if (supabase.modo === "tira") throw new Error("supabase caído");
    return {
      auth: {
        getUser: async () => ({
          data: { user: supabase.modo === "con-usuario" ? { id: "u1" } : null },
        }),
      },
    };
  },
}));

const { middleware } = await import("../middleware");

const pedido = (ruta: string) => new NextRequest(new URL(ruta, "https://growth-os.test"));
const destino = (res: Response) => new URL(res.headers.get("location") ?? "https://x/", "https://x");

describe("el middleware falla cerrado donde hay puerta", () => {
  const envPrevio = { ...process.env };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    supabase.modo = "sin-usuario";
  });
  afterEach(() => {
    process.env = { ...envPrevio };
  });

  it("sin variables, /app va al login con el motivo; lo público pasa", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const privada = await middleware(pedido("/app/integrations"));
    expect(privada.status).toBe(307);
    expect(destino(privada).pathname).toBe("/login");
    expect(destino(privada).searchParams.get("motivo")).toBe("supabase-sin-configurar");
    expect(destino(privada).searchParams.get("redirectTo")).toBe("/app/integrations");

    const publica = await middleware(pedido("/overview"));
    expect(publica.status, "una caída de auth no tira el sitio público").not.toBe(307);
  });

  it("si Supabase tira, /app va al login; lo público pasa", async () => {
    supabase.modo = "tira";

    const privada = await middleware(pedido("/app/publishing"));
    expect(privada.status).toBe(307);
    expect(destino(privada).pathname).toBe("/login");
    expect(destino(privada).searchParams.get("motivo")).toBe("supabase-fallo");

    const publica = await middleware(pedido("/dashboard"));
    expect(publica.status).not.toBe(307);
  });

  it("sin sesión, /app va al login (lo de siempre); con sesión, entra", async () => {
    const sinSesion = await middleware(pedido("/app/content"));
    expect(sinSesion.status).toBe(307);
    expect(destino(sinSesion).pathname).toBe("/login");

    supabase.modo = "con-usuario";
    const conSesion = await middleware(pedido("/app/content"));
    expect(conSesion.status, "cerrar de más también es un defecto").not.toBe(307);
  });
});
