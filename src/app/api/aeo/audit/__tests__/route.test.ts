/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría salga a internet con una URL que mandó quien llama, y que un
 * fallo de red se lea como un hallazgo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NEGOCIO = "7d703707-4f9d-43bf-9305-6bc22eddf45f";

let usuario: { id: string } | null = { id: "u1" };
let negocio: { id: string; website: string | null } | null = null;
let errorLectura: { message: string } | null = null;
let pedidos: string[] = [];
/** Qué contesta cada URL. `null` = falla la petición. */
let respuestas: Record<string, string | null> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: negocio, error: errorLectura }) }),
      }),
    }),
  }),
}));

const { POST } = await import("../route");

let n = 0;
function pedido(cuerpo: unknown): Request {
  n += 1;
  return new Request("http://localhost/api/aeo/audit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.4.0.${n}` },
    body: JSON.stringify(cuerpo),
  });
}

const HTML_SANO = `<html><body><p>${"contenido real ".repeat(80)}</p>
  <script type="application/ld+json">{"@type":"Organization"}</script>
  <script type="application/ld+json">{"@type":"LocalBusiness"}</script>
  <script type="application/ld+json">{"@type":"FAQPage"}</script></body></html>`;

beforeEach(() => {
  usuario = { id: "u1" };
  negocio = { id: NEGOCIO, website: "https://ejemplo.com" };
  errorLectura = null;
  pedidos = [];
  respuestas = {
    "https://ejemplo.com/robots.txt": "User-agent: *\nDisallow:",
    "https://ejemplo.com/": HTML_SANO,
    "https://ejemplo.com/llms.txt": "# llms",
  };
  vi.stubGlobal("fetch", async (url: string) => {
    pedidos.push(url);
    const cuerpo = respuestas[url];
    if (cuerpo === null || cuerpo === undefined) {
      return { ok: false, status: 404, text: async () => "" } as Response;
    }
    return { ok: true, status: 200, text: async () => cuerpo } as Response;
  });
});

describe("qué audita, y de dónde saca la URL", () => {
  it("audita el sitio del NEGOCIO, no el que mande quien llama", async () => {
    // Sin esto, la ruta sería un rastreador de sitios ajenos con la IP de la
    // plataforma.
    const res = await POST(pedido({ businessId: NEGOCIO, url: "https://otro-sitio.com" }));
    expect(res.status).toBe(200);
    expect(pedidos.every((u) => u.startsWith("https://ejemplo.com"))).toBe(true);
    expect(pedidos.some((u) => u.includes("otro-sitio"))).toBe(false);
  });

  it("pide los tres archivos que necesita", async () => {
    await POST(pedido({ businessId: NEGOCIO }));
    expect(pedidos.sort()).toEqual([
      "https://ejemplo.com/",
      "https://ejemplo.com/llms.txt",
      "https://ejemplo.com/robots.txt",
    ]);
  });

  it("un sitio sano no devuelve hallazgos", async () => {
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO }))).json();
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.hallazgos).toEqual([]);
  });

  it("un sitio que bloquea a las IA lo dice como bloqueante", async () => {
    respuestas["https://ejemplo.com/robots.txt"] = "User-agent: *\nDisallow: /";
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO }))).json();
    expect(cuerpo.hallazgos[0].gravedad).toBe("bloqueante");
  });
});

describe("cuándo NO audita, y qué dice", () => {
  it("un `robots.txt` que no se pudo traer NO se lee como «permite», se informa", async () => {
    // Es la distinción de `integration_probe`: no saber no es estar bien.
    respuestas["https://ejemplo.com/robots.txt"] = null;
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO }))).json();
    expect(cuerpo.robotsLeido).toBe(false);
    expect(cuerpo.motivoRobots).toBeTruthy();
  });

  it("si la portada no responde, no inventa hallazgos", async () => {
    // Sin portada no hay ni schema ni texto que medir: devolver ceros inventaría
    // dos hallazgos que nadie midió.
    respuestas["https://ejemplo.com/"] = null;
    const res = await POST(pedido({ businessId: NEGOCIO }));
    expect(res.status).toBe(502);
    expect((await res.json()).motivo).toBe("sitio-inalcanzable");
  });

  it("un negocio sin sitio no es un sitio con problemas", async () => {
    negocio = { id: NEGOCIO, website: "" };
    const res = await POST(pedido({ businessId: NEGOCIO }));
    expect(res.status).toBe(409);
    expect((await res.json()).motivo).toBe("sin-sitio");
    expect(pedidos).toHaveLength(0);
  });

  it("sin sesión no sale a internet", async () => {
    usuario = null;
    const res = await POST(pedido({ businessId: NEGOCIO }));
    expect(res.status).toBe(401);
    expect(pedidos).toHaveLength(0);
  });

  it("un no-miembro no puede auditar el sitio de otra organización", async () => {
    negocio = null;
    const res = await POST(pedido({ businessId: NEGOCIO }));
    expect(res.status).toBe(404);
    expect(pedidos).toHaveLength(0);
  });

  it("un sitio sin esquema se completa con https en vez de fallar", async () => {
    negocio = { id: NEGOCIO, website: "ejemplo.com" };
    await POST(pedido({ businessId: NEGOCIO }));
    expect(pedidos.every((u) => u.startsWith("https://ejemplo.com"))).toBe(true);
  });
});
