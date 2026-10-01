import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * El guardia del reporte, medido en los tres estados en que puede estar la
 * identidad — y el tercero es el que costó un 500.
 *
 * QUÉ AGUJERO CIERRA ESTE ARCHIVO
 *
 * `POST /api/reports/generate` es la ruta que gasta: un Places y dos PageSpeed
 * por llamada. Hasta el 2026-09-19 no tenía guardia; ahora pide sesión antes
 * del rate limit y de zod. El barrido (`precondicionRutas.test.ts`) mide eso,
 * pero lo mide con `@/lib/supabase/server` MOCKEADO, y el mock siempre
 * construye un cliente: por eso no podía ver el tercer estado.
 *
 * El tercer estado es el "modo demo" que el propio middleware documenta —sin
 * `NEXT_PUBLIC_SUPABASE_URL` el sitio público sigue en pie—: ahí
 * `createSupabaseServerClient()` pasa las envs como `undefined!` y `getUser()`
 * tira. Con el guardia fuera de un try, eso era un 500 para un anónimo. Un 500
 * sin sesión es el defecto que el barrido nombra, y además se lee como "se
 * rompió" en vez de "no te conozco".
 *
 * Los tres estados, y lo que este archivo fija de cada uno:
 *
 *   sesión           -> pasa al trabajo (el orquestador se llama)
 *   sin sesión       -> 401, y el orquestador NO se llama
 *   sin proveedor    -> 401 también, no 500, y el orquestador NO se llama
 *
 * El "no se llama" importa tanto como el status: el orquestador es quien sale
 * a Places y a PageSpeed, así que un 401 con el orquestador ya disparado
 * seguiría gastando.
 */

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/reports/orchestrator", () => ({ generateReport: vi.fn() }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: vi.fn(() => null) }));

import { generateReport } from "@/lib/reports/orchestrator";
import { rateLimit } from "@/lib/api/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "../route";

const pedido = () =>
  POST(
    new Request("http://localhost/api/reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: "biz-1" }),
    }),
  );

/** El cliente que devuelve una sesión, ninguna, o el que ni se puede construir. */
const clienteCon = (user: { id: string } | null) =>
  ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) as never;

afterEach(() => vi.clearAllMocks());

describe("POST /api/reports/generate — el guardia va antes del gasto", () => {
  it("sin sesión contesta 401 y no llega al orquestador (defecto: cada anónimo gastaba un Places y dos PageSpeed)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(clienteCon(null));

    const res = await pedido();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "not authenticated" });
    expect(vi.mocked(generateReport)).not.toHaveBeenCalled();
  });

  it("y ni siquiera consume el limitador: el guardia va primero (defecto: gastar cupo de rate limit por una llamada que se va a negar)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(clienteCon(null));

    await pedido();

    expect(vi.mocked(rateLimit)).not.toHaveBeenCalled();
  });

  it("en modo demo, sin proveedor de identidad, contesta 401 y NO 500 (defecto medido: createSupabaseServerClient tira con las envs sin poner y la excepción salía sin atrapar)", async () => {
    vi.mocked(createSupabaseServerClient).mockRejectedValue(
      new TypeError("Invalid URL"), // lo que tira `createServerClient(undefined!, …)`
    );

    const res = await pedido();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "not authenticated" });
    expect(vi.mocked(generateReport)).not.toHaveBeenCalled();
  });

  it("y tampoco si el que tira es getUser() (la misma ausencia, un renglón más adentro)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: async () => {
          throw new TypeError("fetch failed");
        },
      },
    } as never);

    expect((await pedido()).status).toBe(401);
    expect(vi.mocked(generateReport)).not.toHaveBeenCalled();
  });

  it("con sesión sí llega al trabajo (prevenir de más también es un defecto: el guardia no puede cerrarle la puerta a quien tiene sesión)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(clienteCon({ id: "u-1" }));
    vi.mocked(generateReport).mockResolvedValue({ id: "r-1" } as never);

    const res = await pedido();

    expect(res.status).toBe(200);
    expect(vi.mocked(generateReport)).toHaveBeenCalledWith({ businessId: "biz-1", clientSnapshot: undefined });
  });
});
