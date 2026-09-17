/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría salga a internet con una URL que mandó quien llama, y que un
 * fallo de red se lea como un hallazgo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NEGOCIO = "7d703707-4f9d-43bf-9305-6bc22eddf45f";

let usuario: { id: string } | null = { id: "u1" };
let negocio: { id: string; organization_id: string; website: string | null } | null = null;
let errorLectura: { message: string } | null = null;
let pedidos: string[] = [];
/** Qué contesta cada URL. `null` = falla la petición. */
let respuestas: Record<string, string | null> = {};

// Lo que la ruta escribió en `aeo_audits`, para afirmar que la tabla que el
// #93 creó tiene por fin quien la escriba, y con qué.
let guardadas: Array<Record<string, unknown>> = [];
let errorGuardado: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: negocio, error: errorLectura }) }),
      }),
      insert: async (fila: Record<string, unknown>) => {
        if (tabla === "aeo_audits") guardadas.push(fila);
        return { error: errorGuardado };
      },
    }),
  }),
}));

const { POST } = await import("../route");

let porAgente: string[] = [];
let statusParaAgente: (ua: string) => number = () => 200;
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
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness"}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage"}</script></body></html>`;
// Los tres bloques llevan @context desde que existe el validador: sin él no
// son JSON-LD sino JSON, y el «sitio sano» de este fixture no lo era. El
// validador nuevo lo dijo antes que nadie — que es para lo que está.

beforeEach(() => {
  usuario = { id: "u1" };
  negocio = { id: NEGOCIO, organization_id: "org-1", website: "https://ejemplo.com" };
  errorLectura = null;
  guardadas = [];
  errorGuardado = null;
  pedidos = [];
  porAgente = [];
  statusParaAgente = () => 200;
  respuestas = {
    "https://ejemplo.com/robots.txt": "User-agent: *\nDisallow:",
    "https://ejemplo.com/": HTML_SANO,
    "https://ejemplo.com/llms.txt": "# llms",
  };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const ua = init ? new Headers(init.headers).get("user-agent") : null;
    // Las peticiones por agente se registran aparte: no son «archivos que
    // pide», son «cómo lo tratan», y un test de abajo las cuenta. Se
    // distinguen por el user-agent: el propio de la auditoría pide archivos;
    // cualquier otro es la ruta preguntando «¿y a éste cómo lo tratás?».
    if (ua && !ua.startsWith("VulkanGrowthOS/")) {
      porAgente.push(ua);
      return { ok: true, status: statusParaAgente(ua), text: async () => "" } as Response;
    }
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
    negocio = { id: NEGOCIO, organization_id: "org-1", website: "" };
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
    negocio = { id: NEGOCIO, organization_id: "org-1", website: "ejemplo.com" };
    await POST(pedido({ businessId: NEGOCIO }));
    expect(pedidos.every((u) => u.startsWith("https://ejemplo.com"))).toBe(true);
  });
});

describe("lo que la puerta H2-GO-1 exige de la ruta", () => {
  it("hace una petición real por cada agente, con su user-agent, y devuelve el código", async () => {
    statusParaAgente = (ua) => (ua.includes("GPTBot") ? 403 : 200);

    const res = await POST(pedido({ businessId: NEGOCIO }));
    const cuerpo = (await res.json()) as {
      lectura: { statusPorAgente: Record<string, number | null> };
      hallazgos: Array<{ gravedad: string; donde: string }>;
    };

    expect(porAgente.length, "una petición por agente declarado").toBe(5);
    expect(cuerpo.lectura.statusPorAgente.gptbot).toBe(403);
    expect(cuerpo.lectura.statusPorAgente.claudebot).toBe(200);
    // Robots abierto + 403 al user-agent = bloqueante, y apunta al CDN. Es el
    // caso que leer el robots no ve nunca.
    expect(cuerpo.hallazgos.some((h) => h.gravedad === "bloqueante" && /CDN/.test(h.donde))).toBe(true);
  });

  it("guarda una fila en aeo_audits por corrida, con los datos crudos", async () => {
    const res = await POST(pedido({ businessId: NEGOCIO }));
    const cuerpo = (await res.json()) as { guardada: boolean };

    expect(cuerpo.guardada).toBe(true);
    expect(guardadas).toHaveLength(1);
    const fila = guardadas[0];
    expect(fila.organization_id).toBe("org-1");
    expect(fila.business_id).toBe(NEGOCIO);
    expect(fila.url).toBe("https://ejemplo.com/");
    expect(fila.robots_leido).toBe(true);
    expect((fila.acceso as { http: Record<string, number> }).http.gptbot).toBe(200);
    expect(typeof fila.caracteres_sin_js).toBe("number");
    expect((fila.schema_encontrado as { tipos: string[] }).tipos).toEqual([
      "FAQPage",
      "LocalBusiness",
      "Organization",
    ]);
  });

  it("si guardar falla, la auditoría igual se devuelve y lo dice", async () => {
    errorGuardado = { message: "rls" };

    const res = await POST(pedido({ businessId: NEGOCIO }));
    const cuerpo = (await res.json()) as { ok: boolean; guardada: boolean };

    expect(res.status).toBe(200);
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.guardada).toBe(false);
  });
});
