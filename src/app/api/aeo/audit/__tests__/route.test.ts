/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría salga a internet con una URL que mandó quien llama, y que un
 * fallo de red se lea como un hallazgo.
 *
 * El render en Chromium corre con el `medirRenderizado` DE VERDAD y un
 * navegador, un transporte y un DNS dobles (`navegadorDoble.ts`): lo que se
 * prueba acá es que la ruta lo llame con el sitio del negocio, que el número
 * llegue a la lectura y al hallazgo, y que un render que falla no tumbe la
 * auditoría ni se lea como verde.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  navegadorDoble,
  resolvedorDoble,
  transporteDoble,
  type OpcionesDoble,
} from "@/lib/aeo/__tests__/navegadorDoble";
import type { DependenciasRender, PedidoHttp, RespuestaHttp } from "@/lib/aeo/renderizado";
import { esIpPublica } from "@/lib/profile/evidenceCheck";

const NEGOCIO = "7d703707-4f9d-43bf-9305-6bc22eddf45f";

let usuario: { id: string } | null = { id: "u1" };
let negocio: { id: string; organization_id: string; website: string | null } | null = null;
let errorLectura: { message: string } | null = null;
/** Los archivos que la ruta pidió con su propio user-agent: robots, portada, llms. */
let pedidos: string[] = [];
/** Qué contesta cada URL a la ruta. `null` = 404. Un objeto, un status (con o sin redirección) o un error de red. */
let respuestas: Record<
  string,
  string | null | { status: number; location?: string } | { error: "timeout" | "sin-respuesta" }
> = {};
/**
 * TODO pedido que salió por el transporte, de quien sea —la ruta, los agentes o
 * el navegador—, con la dirección a la que se conectó. Es lo que los casos de
 * SSRF miran: ninguna de estas direcciones puede ser interna.
 */
let salidas: Array<{ url: string; ip: string; ua: string }> = [];
/** `fetch` no se usa: todo sale por el transporte examinado. Lo que llegue acá es una fuga. */
let fetchLlamados: string[] = [];

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

// El render: lo que el navegador doble «descarga» por el transporte doble.
let paginasRender: Record<string, { cuerpo?: string; status?: number }> = {};
let opcionesNavegador: OpcionesDoble = {};
let navegador = navegadorDoble();
let redRender = transporteDoble({});

let porAgente: string[] = [];
let statusParaAgente: (ua: string) => number = () => 200;
/** Para un agente, una redirección en vez de un status: `null` = no redirige. */
let redireccionParaAgente: (ua: string) => string | null = () => null;
/** Un WAF que deja colgados a los rastreadores: ningún agente recibe respuesta. */
let agentesSinRespuesta = false;

const AGENTE_DE_LA_RUTA = "VulkanGrowthOS/1.0 (auditoria AEO)";

/**
 * Un solo transporte para todo, como en producción. Se reparte por quién
 * pide: la ruta con su user-agent pide archivos; un agente de IA pregunta
 * «¿y a éste cómo lo tratás?»; el resto es el navegador doble dibujando.
 */
async function transporte(pedido: PedidoHttp): Promise<RespuestaHttp> {
  const ua = pedido.encabezados["user-agent"] ?? "";
  salidas.push({ url: pedido.url, ip: pedido.ip, ua });
  if (ua === AGENTE_DE_LA_RUTA) {
    pedidos.push(pedido.url);
    const r = respuestas[pedido.url];
    if (r === null || r === undefined) return { tipo: "respuesta", status: 404, encabezados: {}, cuerpo: Buffer.from("") };
    if (typeof r === "string") {
      return { tipo: "respuesta", status: 200, encabezados: { "content-type": "text/html" }, cuerpo: Buffer.from(r) };
    }
    if ("error" in r) return { tipo: "error", motivo: r.error };
    return { tipo: "respuesta", status: r.status, encabezados: r.location ? { location: r.location } : {}, cuerpo: Buffer.from("") };
  }
  if (ua !== "doble") {
    porAgente.push(ua);
    if (agentesSinRespuesta) return { tipo: "error", motivo: "timeout" };
    const destino = redireccionParaAgente(ua);
    if (destino) return { tipo: "respuesta", status: 302, encabezados: { location: destino }, cuerpo: Buffer.from("") };
    return { tipo: "respuesta", status: statusParaAgente(ua), encabezados: {}, cuerpo: Buffer.from("") };
  }
  return redRender.transporte(pedido);
}

const DNS = {
  "ejemplo.com": ["93.184.216.34"],
  "www.ejemplo.com": ["93.184.216.35"],
  "otro-sitio.com": ["151.101.1.1"],
  "interno.test": ["10.0.0.7"],
  "mixto.test": ["93.184.216.34", "127.0.0.1"],
};

vi.mock("@/lib/aeo/chromium", () => ({
  dependenciasDeProduccion: (): DependenciasRender => {
    navegador = navegadorDoble(opcionesNavegador);
    redRender = transporteDoble(paginasRender);
    return {
      abrirNavegador: navegador.abrirNavegador,
      transporte,
      resolver: resolvedorDoble(DNS).resolver,
    };
  },
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
  salidas = [];
  fetchLlamados = [];
  porAgente = [];
  statusParaAgente = () => 200;
  redireccionParaAgente = () => null;
  agentesSinRespuesta = false;
  respuestas = {
    "https://ejemplo.com/robots.txt": "User-agent: *\nDisallow:",
    "https://ejemplo.com/": HTML_SANO,
    "https://ejemplo.com/llms.txt": "# llms",
  };
  // Por defecto, el navegador ve la misma portada que la ruta: una página SSR.
  paginasRender = { "https://ejemplo.com/": { cuerpo: HTML_SANO } };
  opcionesNavegador = {};
  navegador = navegadorDoble();
  redRender = transporteDoble({});
  vi.stubGlobal("fetch", async (url: string) => {
    fetchLlamados.push(String(url));
    throw new Error("la ruta no usa fetch: todo pedido pasa por el transporte examinado");
  });
});

afterEach(() => {
  // En TODOS los casos: `fetch` sigue redirecciones y resuelve el nombre por
  // su cuenta, sin examen. Un solo pedido por ahí es la fuga de SEC-1.
  expect(fetchLlamados, "un pedido salió por fetch, sin examen de la dirección").toEqual([]);
  // Y lo que salió por el transporte, salió a una dirección pública.
  expect(
    salidas.filter((x) => !esIpPublica(x.ip)),
    "un pedido se conectó a una dirección que no es pública"
  ).toEqual([]);
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

describe("el DOM renderizado: la otra mitad del punto «contenido sin JavaScript»", () => {
  it("renderiza el sitio del NEGOCIO y devuelve los dos números en la lectura", async () => {
    const res = await POST(pedido({ businessId: NEGOCIO, url: "https://otro-sitio.com" }));
    const cuerpo = (await res.json()) as {
      lectura: { caracteresSinJs: number; caracteresRenderizados: { estado: string; caracteres?: number } };
      hallazgos: unknown[];
    };

    expect(redRender.pedidos.map((p) => p.url)).toEqual(["https://ejemplo.com/"]);
    expect(cuerpo.lectura.caracteresRenderizados.estado).toBe("medido");
    expect(cuerpo.lectura.caracteresRenderizados.caracteres).toBeGreaterThan(500);
    expect(cuerpo.lectura.caracteresSinJs).toBeGreaterThan(500);
    expect(cuerpo.hallazgos).toEqual([]);
    expect(navegador.registro.cierres).toBe(navegador.registro.aperturas);
  });

  it("un sitio que sirve vacío y dibuja con JavaScript sale ROJO, con los dos números", async () => {
    const vacio = `<html><body><div id="app"></div><script src="/app.js"></script>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script></body></html>`;
    respuestas["https://ejemplo.com/"] = vacio;
    paginasRender = {
      "https://ejemplo.com/": { cuerpo: vacio },
      "https://ejemplo.com/app.js": { cuerpo: "Texto que sólo dibuja el JavaScript. ".repeat(40) },
    };

    const cuerpo = (await (await POST(pedido({ businessId: NEGOCIO }))).json()) as {
      lectura: { caracteresSinJs: number; caracteresRenderizados: { estado: string; caracteres: number } };
      hallazgos: Array<{ gravedad: string; quePasa: string; donde: string }>;
    };
    const { caracteresSinJs, caracteresRenderizados } = cuerpo.lectura;
    expect(caracteresSinJs).toBeLessThan(10);
    expect(caracteresRenderizados.caracteres).toBeGreaterThan(1_000);
    const h = cuerpo.hallazgos.find((x) => /renderizado/.test(x.donde));
    expect(h?.gravedad).toBe("bloqueante");
    expect(h?.quePasa).toContain(String(caracteresRenderizados.caracteres));
  });

  it("un render que falla NO tumba la auditoría y se dice «no medido», no verde", async () => {
    opcionesNavegador = { arranqueFalla: true };
    const res = await POST(pedido({ businessId: NEGOCIO }));
    const cuerpo = (await res.json()) as {
      ok: boolean;
      lectura: { caracteresRenderizados: unknown };
      hallazgos: Array<{ gravedad: string; quePasa: string }>;
    };

    expect(res.status).toBe(200);
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.lectura.caracteresRenderizados).toEqual({ estado: "fallo", codigo: "sin-navegador" });
    expect(cuerpo.hallazgos.map((h) => h.gravedad)).toEqual(["no-medido"]);
    expect(cuerpo.hallazgos[0].quePasa).toContain("sin-navegador");
  });

  it("sin sesión, sin negocio o sin portada no se arranca ningún navegador", async () => {
    usuario = null;
    await POST(pedido({ businessId: NEGOCIO }));
    usuario = { id: "u1" };
    negocio = null;
    await POST(pedido({ businessId: NEGOCIO }));
    negocio = { id: NEGOCIO, organization_id: "org-1", website: "https://ejemplo.com" };
    respuestas["https://ejemplo.com/"] = null;
    await POST(pedido({ businessId: NEGOCIO }));

    expect(navegador.registro.aperturas).toBe(0);
    expect(redRender.pedidos).toHaveLength(0);
  });
});

/**
 * SEC-1. El sitio sale de `businesses.website`, y esa columna la escribe
 * cualquier miembro de la organización: que venga del negocio no la vuelve
 * segura. Antes, el `robots.txt`, la portada, el `llms.txt` y los cinco
 * pedidos por agente iban por `fetch` con `redirect: "follow"` y sin mirar la
 * dirección —reproducido con un canario: la portada trajo el cuerpo de un
 * servicio interno detrás de un 302, y los cinco agentes devolvieron su status,
 * que es un escáner de puertos—. Ahora cada salto pasa por el examen.
 */
describe("SEC-1: ningún pedido de la ruta llega a una dirección que no es pública", () => {
  it.each([
    ["http://127.0.0.1/", "red-no-publica"],
    ["http://127.0.0.1:58602/secret", "puerto"],
    ["http://169.254.169.254/latest/meta-data/", "red-no-publica"],
    ["http://10.0.0.7/", "red-no-publica"],
    ["http://[::1]/", "red-no-publica"],
    ["http://2130706433/", "red-no-publica"],
    ["http://interno.test/", "red-no-publica"],
    ["http://mixto.test/", "red-no-publica"],
    ["http://admin:clave@ejemplo.com/", "credenciales"],
  ])("un negocio con el sitio en %s: 422 `destino-rechazado`, y CERO pedidos", async (sitio, motivo) => {
    negocio = { id: NEGOCIO, organization_id: "org-1", website: sitio };
    const res = await POST(pedido({ businessId: NEGOCIO }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, motivo: "destino-rechazado", detalle: motivo });
    expect(salidas, "ni robots, ni portada, ni llms, ni agentes, ni navegador").toEqual([]);
    expect(navegador.registro.aperturas).toBe(0);
  });

  it("un sitio PÚBLICO que redirige la portada a la metadata: el destino no se pide", async () => {
    respuestas["https://ejemplo.com/"] = { status: 302, location: "http://169.254.169.254/latest/meta-data/" };
    const res = await POST(pedido({ businessId: NEGOCIO }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, motivo: "destino-rechazado", detalle: "red-no-publica" });
    expect(salidas.some((x) => x.url.includes("169.254.169.254"))).toBe(false);
    expect(navegador.registro.aperturas).toBe(0);
  });

  it("una redirección a un NOMBRE que resuelve adentro se examina por su dirección, no por su nombre", async () => {
    respuestas["https://ejemplo.com/"] = { status: 301, location: "http://interno.test/admin" };
    const res = await POST(pedido({ businessId: NEGOCIO }));
    expect((await res.json()).motivo).toBe("destino-rechazado");
    expect(salidas.some((x) => x.url.includes("interno.test"))).toBe(false);
  });

  it("los AGENTES que el sitio redirige adentro quedan sin código: no hay oráculo de status", async () => {
    // El caso del canario: el sitio público contesta 302 a un servicio
    // interno sólo a los rastreadores. Antes, los cinco devolvían el status
    // del servicio interno en `lectura.statusPorAgente`.
    redireccionParaAgente = () => "http://127.0.0.1:58602/secret";
    const res = await POST(pedido({ businessId: NEGOCIO }));
    const cuerpo = (await res.json()) as { lectura: { statusPorAgente: Record<string, number | null> } };
    expect(res.status).toBe(200);
    expect(Object.values(cuerpo.lectura.statusPorAgente)).toEqual([null, null, null, null, null]);
    expect(porAgente).toHaveLength(5);
    expect(salidas.some((x) => x.url.includes("58602"))).toBe(false);
  });

  it("un `robots.txt` que redirige adentro no se lee, y dice por qué", async () => {
    respuestas["https://ejemplo.com/robots.txt"] = { status: 302, location: "http://10.0.0.7/robots.txt" };
    const cuerpo = await (await POST(pedido({ businessId: NEGOCIO }))).json();
    expect(cuerpo.robotsLeido).toBe(false);
    expect(cuerpo.motivoRobots).toBe("red-no-publica");
    expect(salidas.some((x) => x.url.includes("10.0.0.7"))).toBe(false);
  });

  it("una redirección SANA se sigue, y su destino también pasa por el examen", async () => {
    respuestas["https://ejemplo.com/"] = { status: 301, location: "/inicio" };
    respuestas["https://ejemplo.com/inicio"] = HTML_SANO;
    const res = await POST(pedido({ businessId: NEGOCIO }));
    expect(res.status).toBe(200);
    expect(pedidos).toEqual(expect.arrayContaining(["https://ejemplo.com/", "https://ejemplo.com/inicio"]));
  });
});

/**
 * P1. El robots se lee para la página que se audita: la del ÚLTIMO salto de la
 * portada, con el `robots.txt` de SU origen. Antes se leía en "/" del sitio
 * cargado, y una página bloqueada que no fuera la raíz salía con todos adentro.
 */
describe("P1: el acceso se decide para la URL final, con el robots de su origen", () => {
  it("un sitio cargado con ruta: el robots se pregunta por ESA ruta, no por la raíz", async () => {
    negocio = { id: NEGOCIO, organization_id: "org-1", website: "https://ejemplo.com/blog" };
    respuestas["https://ejemplo.com/blog"] = HTML_SANO;
    respuestas["https://ejemplo.com/robots.txt"] = "User-agent: GPTBot\nDisallow: /blog\n\nUser-agent: *\nDisallow:";
    const cuerpo = (await (await POST(pedido({ businessId: NEGOCIO }))).json()) as {
      lectura: { acceso: Record<string, boolean> };
      hallazgos: Array<{ gravedad: string; quePasa: string }>;
    };
    expect(cuerpo.lectura.acceso.gptbot).toBe(false);
    expect(cuerpo.lectura.acceso.claudebot).toBe(true);
    expect(cuerpo.hallazgos.some((h) => h.gravedad === "bloqueante" && /Bloqueados: gptbot/.test(h.quePasa))).toBe(true);
  });

  it("una portada que redirige a otro origen: manda el robots del DESTINO, y su ruta", async () => {
    respuestas["https://ejemplo.com/"] = { status: 301, location: "https://www.ejemplo.com/inicio" };
    respuestas["https://www.ejemplo.com/inicio"] = HTML_SANO;
    // El origen cargado deja entrar a todos; el que sirve la página, no a GPTBot.
    respuestas["https://www.ejemplo.com/robots.txt"] = "User-agent: GPTBot\nDisallow: /inicio";
    respuestas["https://www.ejemplo.com/llms.txt"] = "# llms";
    const cuerpo = (await (await POST(pedido({ businessId: NEGOCIO }))).json()) as {
      urlFinal: string;
      lectura: { acceso: Record<string, boolean>; tieneLlmsTxt: boolean };
    };
    expect(cuerpo.urlFinal).toBe("https://www.ejemplo.com/inicio");
    expect(cuerpo.lectura.acceso.gptbot).toBe(false);
    expect(cuerpo.lectura.tieneLlmsTxt).toBe(true);
    expect(pedidos).toEqual(
      expect.arrayContaining(["https://www.ejemplo.com/robots.txt", "https://www.ejemplo.com/llms.txt"])
    );
    expect(pedidos).not.toContain("https://ejemplo.com/robots.txt");
  });
});

/**
 * P3, por la ruta. Reproducido: con los cinco pedidos por agente caídos y el
 * robots en timeout, la ruta devolvía `hallazgos: []` y la pantalla decía «los
 * rastreadores entran».
 */
describe("P3: lo que no se midió en el acceso sale «no medido», por la ruta", () => {
  type Cuerpo = {
    estadoRobots: string;
    legible: boolean | null;
    lectura: { acceso: Record<string, boolean | null> };
    hallazgos: Array<{ gravedad: string; quePasa: string }>;
  };

  it("el reproducido: agentes sin respuesta y robots en timeout — no medido, y `legible` es null", async () => {
    agentesSinRespuesta = true;
    respuestas["https://ejemplo.com/robots.txt"] = { error: "timeout" };
    const cuerpo = (await (await POST(pedido({ businessId: NEGOCIO }))).json()) as Cuerpo;
    expect(cuerpo.estadoRobots).toBe("no-medido");
    expect(Object.values(cuerpo.lectura.acceso)).toEqual([null, null, null, null, null]);
    expect(cuerpo.hallazgos.length).toBeGreaterThan(0);
    expect(cuerpo.hallazgos.every((h) => h.gravedad === "no-medido")).toBe(true);
    expect(cuerpo.hallazgos.some((h) => h.quePasa.includes("timeout"))).toBe(true);
    expect(cuerpo.legible).toBeNull();
  });

  it("un robots con 5xx es «no medido», no «permite»", async () => {
    respuestas["https://ejemplo.com/robots.txt"] = { status: 503 };
    const cuerpo = (await (await POST(pedido({ businessId: NEGOCIO }))).json()) as Cuerpo;
    expect(cuerpo.estadoRobots).toBe("no-medido");
    expect(cuerpo.hallazgos.map((h) => h.gravedad)).toEqual(["no-medido"]);
    expect(cuerpo.hallazgos[0].quePasa).toContain("http 503");
    expect(cuerpo.legible).toBeNull();
  });

  it("un robots con 404 SÍ es una respuesta: «no hay robots», deja entrar a todos, y el sitio sano queda verde", async () => {
    respuestas["https://ejemplo.com/robots.txt"] = null;
    const cuerpo = (await (await POST(pedido({ businessId: NEGOCIO }))).json()) as Cuerpo;
    expect(cuerpo.estadoRobots).toBe("ausente");
    expect(Object.values(cuerpo.lectura.acceso).every((v) => v === true)).toBe(true);
    expect(cuerpo.hallazgos).toEqual([]);
    expect(cuerpo.legible).toBe(true);
  });
});
