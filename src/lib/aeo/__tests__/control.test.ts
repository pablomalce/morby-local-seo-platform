import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { contenidoSinJs, hallazgos, type Hallazgo, type LecturaDelSitio, type PuntosDeLaPuerta } from "../hallazgos";
import {
  accesoDeLasIA,
  erroresDeSchema,
  MINIMO_DE_TEXTO,
  textoSinJavaScript,
  tiposDeSchema,
} from "../lectura";
import { bloqueadoPorHttp, statusPorAgente, USER_AGENTS } from "../peticion";
import { crearRedExaminada } from "../red";
import type { DependenciasRender, PedidoHttp, RespuestaHttp, Transporte } from "../renderizado";
import { navegadorDoble, relojVirtual, resolvedorDoble } from "./navegadorDoble";

/**
 * H2-GO-1 — la auditoría contra una página que TIENE que salir en rojo.
 *
 * QUÉ AGUJERO CIERRA
 *
 * Una auditoría que nunca vio una página rota no se sabe si mide algo. La
 * puerta lo dice: si el auditor lee el DOM renderizado, la página «sólo JS»
 * sale verde; si resuelve el acceso leyendo robots.txt sin pedir con ese
 * user-agent, la bloqueada sale verde; si el JSON-LD sólo se comprueba por
 * presencia, el inválido sale verde. La página de control está en
 * `public/aeo-control/index.html`, rota en los tres ejes, y se lee de ahí —
 * del disco, la misma que despliega Vercel— para que este test y la URL
 * pública no puedan divergir.
 *
 * CÓMO FALLA
 *
 * Tres mutaciones, una por eje: que `erroresDeSchema` vuelva a ignorar el
 * bloque que no parsea; que `hallazgos` deje de mirar `statusPorAgente`; que
 * `textoSinJavaScript` cuente lo que hay dentro de <script>. Cada una pone
 * uno de los tres «rojo» en verde y este archivo lo nombra.
 */
const RAIZ = process.cwd();
const CONTROL = readFileSync(path.join(RAIZ, "public", "aeo-control", "index.html"), "utf8");
const SANA = readFileSync(path.join(RAIZ, "public", "aeo-sana", "index.html"), "utf8");
const ROBOTS = readFileSync(path.join(RAIZ, "public", "robots.txt"), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// El despliegue, como contesta de verdad (medido con curl el 2026-10-11 contra
// https://morby-local-seo-platform.vercel.app): `/aeo-control/` da 308 a
// `/aeo-control`, que da 200 con este mismo HTML, el `robots.txt` es el de
// `public/`, y no hay `llms.txt`. Vercel no bloquea a nadie: lo único que
// contesta distinto según el user-agent es NUESTRO middleware, y por eso el
// middleware de verdad corre acá antes que los archivos —como en Vercel,
// después de la redirección de la barra— (GATE-6: 403 a PerplexityBot).
// ─────────────────────────────────────────────────────────────────────────────

const ORIGEN = "https://morby-local-seo-platform.vercel.app";

/** El `robots.txt` que sirve el despliegue: el de `public/`, salvo en el caso de GATE-4. */
let robotsDelDespliegue = ROBOTS;

// El middleware pregunta por la sesión: acá no hay ninguna, y no sale a la red.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

async function despliegue(pedido: PedidoHttp): Promise<RespuestaHttp> {
  const vacio = Buffer.alloc(0);
  for (const ruta of ["/aeo-control", "/aeo-sana"]) {
    if (pedido.url === `${ORIGEN}${ruta}/`) {
      return { tipo: "respuesta", status: 308, encabezados: { location: ruta }, cuerpo: vacio };
    }
  }
  const delMiddleware = await middleware(new NextRequest(pedido.url, { headers: pedido.encabezados }));
  if (delMiddleware.headers.get("x-middleware-next") !== "1") {
    return {
      tipo: "respuesta",
      status: delMiddleware.status,
      encabezados: Object.fromEntries(delMiddleware.headers),
      cuerpo: Buffer.from(await delMiddleware.arrayBuffer()),
    };
  }
  switch (pedido.url) {
    case `${ORIGEN}/aeo-control`:
      return { tipo: "respuesta", status: 200, encabezados: { "content-type": "text/html" }, cuerpo: Buffer.from(CONTROL) };
    case `${ORIGEN}/aeo-sana`:
      return { tipo: "respuesta", status: 200, encabezados: { "content-type": "text/html" }, cuerpo: Buffer.from(SANA) };
    case `${ORIGEN}/robots.txt`:
      return { tipo: "respuesta", status: 200, encabezados: { "content-type": "text/plain" }, cuerpo: Buffer.from(robotsDelDespliegue) };
    default:
      return { tipo: "respuesta", status: 404, encabezados: {}, cuerpo: vacio };
  }
}

/**
 * El DOM de la página de control DESPUÉS de su `<script>`, sacado de la página
 * misma: el script se ejecuta contra un `document` que sólo guarda el
 * `innerHTML` de `#app`, y ese HTML se pone donde el navegador lo pondría. Es
 * lo que `page.content()` devuelve en la pestaña con JavaScript; con Chrome
 * 154, `renderizado.integracion.test.ts` lo mide de verdad.
 */
function domQueDibujaElControl(): string {
  const script = [...CONTROL.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  const app = { innerHTML: "" };
  new Function("document", script)({ getElementById: () => app });
  return CONTROL.replace('<div id="app"></div>', `<div id="app">${app.innerHTML}</div>`);
}

let negocioControl = { id: "", organization_id: "org-control", website: "" };
let ipControl = 0;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-control" } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: negocioControl, error: null }) }) }),
      insert: async () => ({ error: null }),
    }),
  }),
}));

vi.mock("@/lib/aeo/chromium", () => ({
  dependenciasDeProduccion: (): DependenciasRender => {
    const reloj = relojVirtual();
    return {
      // El DOM del control es el que dibuja su script; la sana no tiene
      // ninguno, y su DOM es el documento que llegó.
      abrirNavegador: navegadorDoble({
        reloj,
        htmlCrudo: (url) => (url.endsWith("/aeo-control") ? domQueDibujaElControl() : undefined),
      }).abrirNavegador,
      transporte: (pedido) => despliegue(pedido),
      resolver: resolvedorDoble({ "morby-local-seo-platform.vercel.app": ["76.76.21.21"] }).resolver,
      ...reloj,
    };
  },
}));

async function auditarPorLaRuta(website: string) {
  const { POST } = await import("@/app/api/aeo/audit/route");
  negocioControl = { id: "5a0e7d1c-4b8e-4f43-9c35-0d6b8f3b2a11", organization_id: "org-control", website };
  ipControl += 1;
  const res = await POST(
    new Request("http://localhost/api/aeo/audit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${ipControl}` },
      body: JSON.stringify({ businessId: negocioControl.id }),
    })
  );
  return {
    status: res.status,
    cuerpo: (await res.json()) as {
      urlFinal: string;
      lectura: LecturaDelSitio;
      hallazgos: Hallazgo[];
      puntos: PuntosDeLaPuerta;
      legible: boolean | null;
    },
  };
}

describe("la página de control sale en rojo en los tres ejes", () => {
  it("eje 1 — sin JavaScript no hay texto: el HTML servido está vacío", () => {
    const caracteres = textoSinJavaScript(CONTROL);
    expect(caracteres, "el texto vive dentro de un <script>; servido, no existe").toBeLessThan(
      MINIMO_DE_TEXTO
    );
    // Y el número crudo, que es lo que la puerta pide: no «poco», sino cuánto.
    expect(caracteres).toBeLessThan(60);
  });

  it("eje 1, con el DOM renderizado al lado: rojo si el render midió, y rojo si falló", () => {
    // La puerta pide «servido frente a renderizado». El número renderizado de
    // ESTA página con un Chromium de verdad lo mide
    // `renderizado.integracion.test.ts` (1677 caracteres el 2026-10-11, con
    // Chrome 154); acá se fija lo que la regla hace con cualquiera de los dos
    // desenlaces, para que un render caído no pueda pintar de verde el control.
    const servido = textoSinJavaScript(CONTROL);
    const base: LecturaDelSitio = {
      acceso: accesoDeLasIA(ROBOTS, "/aeo-control/"),
      caracteresSinJs: servido,
      schema: tiposDeSchema(CONTROL),
      erroresDeSchema: erroresDeSchema(CONTROL),
      tieneLlmsTxt: false,
    };
    expect(contenidoSinJs({ ...base, caracteresRenderizados: { estado: "medido", caracteres: 1677 } }).estado).toBe("rojo");
    expect(contenidoSinJs({ ...base, caracteresRenderizados: { estado: "fallo", codigo: "timeout" } }).estado).toBe("rojo");
    expect(contenidoSinJs(base).estado).toBe("rojo");
  });

  it("eje 2 — el JSON-LD es inválido, y el validador dice en qué", () => {
    const errores = erroresDeSchema(CONTROL);
    expect(errores.length).toBeGreaterThanOrEqual(2);
    expect(errores.some((e) => e.includes("no parsea"))).toBe(true);
    expect(errores.some((e) => e.includes("sin @context"))).toBe(true);
    // Lo que SÍ se pudo leer se sigue reportando aparte: «inválido» no es «ausente».
    expect(tiposDeSchema(CONTROL)).toEqual([]);
  });

  it("eje 3a — el robots.txt lo bloquea para los agentes declarados, y sólo para ellos", () => {
    // Con y sin la barra: el despliegue redirige la primera a la segunda, y
    // la segunda es la URL que de verdad se sirve.
    for (const ruta of ["/aeo-control", "/aeo-control/"]) {
      const acceso = accesoDeLasIA(ROBOTS, ruta);
      expect(acceso.gptbot, ruta).toBe(false);
      expect(acceso.claudebot, ruta).toBe(false);
      expect(acceso.perplexitybot, "el resto entra: el bloqueo es selectivo a propósito").toBe(true);
    }
    // La raíz del sitio sigue abierta para todos: la página de control no
    // puede costarle posicionamiento al producto que la aloja.
    expect(Object.values(accesoDeLasIA(ROBOTS, "/")).every(Boolean)).toBe(true);
  });

  it("eje 3b — el acceso se mide con una PETICIÓN real por agente, no leyendo el robots", async () => {
    const vistos: Array<{ ua: string; status: number }> = [];
    const servidor: Transporte = async (pedido) => {
      const ua = pedido.encabezados["user-agent"] ?? "";
      // Un CDN que dice «no» a GPTBot con el robots abierto: el caso que sólo
      // una petición real puede ver.
      const status = ua.includes("GPTBot") ? 403 : 200;
      vistos.push({ ua, status });
      return { tipo: "respuesta", status, encabezados: {}, cuerpo: Buffer.alloc(0) };
    };
    const red = crearRedExaminada({
      transporte: servidor,
      resolver: resolvedorDoble({ "control.test": ["93.184.216.34"] }).resolver,
    });

    const status = await statusPorAgente("https://control.test/aeo-control/", red);

    expect(Object.keys(status).sort()).toEqual(Object.keys(USER_AGENTS).sort());
    expect(vistos.map((v) => v.ua)).toEqual(expect.arrayContaining(Object.values(USER_AGENTS)));
    expect(status.gptbot).toBe(403);
    expect(bloqueadoPorHttp(status.gptbot)).toBe(true);
    expect(bloqueadoPorHttp(status.claudebot)).toBe(false);
  });

  it.each([`${ORIGEN}/aeo-control/`, `${ORIGEN}/aeo-control`])(
    "los tres ejes juntos, POR LA RUTA y con lo que contesta el despliegue (%s): tres bloqueantes, uno por eje",
    async (website) => {
      // Antes este caso armaba la lectura a mano, con 403 para GPTBot y
      // ClaudeBot y la ruta `/aeo-control/`: el despliegue no devuelve ninguna
      // de las dos cosas, y la ruta leía el robots en "/". Por el POST, con
      // las respuestas reales, el eje de acceso salía VERDE (P1).
      const renderizado = textoSinJavaScript(domQueDibujaElControl());
      expect(renderizado).toBeGreaterThan(MINIMO_DE_TEXTO);

      const { status, cuerpo } = await auditarPorLaRuta(website);
      expect(status).toBe(200);
      expect(cuerpo.urlFinal).toBe(`${ORIGEN}/aeo-control`);
      // Lo que el despliegue hace con cada agente: 403 a PerplexityBot —el
      // middleware, GATE-6— y 200 al resto. GPTBot y ClaudeBot están
      // bloqueados SÓLO en el robots, y tienen que verse igual.
      expect(cuerpo.lectura.statusPorAgente).toEqual({
        gptbot: 200,
        claudebot: 200,
        perplexitybot: 403,
        "google-extended": 200,
        ccbot: 200,
      });

      // GATE-7: el color de cada punto viene en la respuesta, no se deduce de la prosa.
      expect(cuerpo.puntos).toEqual({ acceso: "rojo", contenidoSinJs: "rojo", schema: "rojo" });
      expect(cuerpo.legible).toBe(false);

      const bloqueantes = cuerpo.hallazgos.filter((h) => h.gravedad === "bloqueante");
      const textos = bloqueantes.map((h) => h.quePasa).join(" | ");
      expect(bloqueantes.length).toBe(4);
      expect(textos, "eje 3: acceso, por el robots y por la petición").toMatch(/Bloqueados: gptbot, claudebot, perplexitybot\./);
      // GATE-6: el agente que el robots deja entrar y el servidor rechaza. Sin
      // la petición real con su user-agent, este hallazgo no existe.
      expect(
        bloqueantes.some((h) => /CDN|WAF/.test(h.donde) && /permite a perplexitybot.*403/.test(h.quePasa)),
        "eje 3: el 403 de la petición real"
      ).toBe(true);
      expect(
        bloqueantes.some((h) => /renderizado/.test(h.donde) && h.quePasa.includes(String(renderizado))),
        "eje 1: texto sin JS, con el número renderizado"
      ).toBe(true);
      expect(textos, "eje 2: schema inválido").toMatch(/JSON-LD.*error/i);
    }
  );

  it("un servidor que contesta 403 al user-agent con el robots ABIERTO es bloqueante igual", () => {
    // Ésta es la mutación que la puerta nombra: leer sólo el robots deja este
    // caso en verde. Robots limpio, servidor que rechaza.
    const lectura: LecturaDelSitio = {
      acceso: accesoDeLasIA("User-agent: *\nDisallow:", "/"),
      statusPorAgente: { gptbot: 403, claudebot: 200, perplexitybot: 200, "google-extended": 200, ccbot: 200 },
      caracteresSinJs: 5_000,
      schema: ["Organization", "LocalBusiness", "FAQPage"],
      erroresDeSchema: [],
      tieneLlmsTxt: true,
    };
    const h = hallazgos(lectura);
    expect(h.some((x) => x.gravedad === "bloqueante" && /CDN|WAF/.test(x.donde))).toBe(true);
  });
});

/**
 * GATE-3: la puerta corregida pide DOS páginas de control —la rota en ROJO 3/3
 * y una SANA en VERDE 3/3, en la misma corrida—. Sin la sana, un auditor que
 * diera rojo siempre pasaba. La sana está en `public/aeo-sana/index.html`, y
 * se lee del disco como la rota.
 */
describe("GATE-3: la página SANA sale en VERDE en los tres puntos, en la misma corrida que la rota", () => {
  it("la sana, por la ruta: verde en los tres, legible, y sin un solo bloqueante", async () => {
    const { status, cuerpo } = await auditarPorLaRuta(`${ORIGEN}/aeo-sana/`);
    expect(status).toBe(200);
    expect(cuerpo.urlFinal).toBe(`${ORIGEN}/aeo-sana`);
    expect(cuerpo.lectura.statusPorAgente).toEqual({ gptbot: 200, claudebot: 200, perplexitybot: 200, "google-extended": 200, ccbot: 200 });
    expect(cuerpo.puntos).toEqual({ acceso: "verde", contenidoSinJs: "verde", schema: "verde" });
    expect(cuerpo.legible).toBe(true);
    expect(cuerpo.hallazgos.filter((h) => h.gravedad === "bloqueante" || h.gravedad === "no-medido")).toEqual([]);
  });

  it("las dos en la MISMA corrida: rota 3/3 rojo y sana 3/3 verde", async () => {
    const [rota, sana] = [await auditarPorLaRuta(`${ORIGEN}/aeo-control/`), await auditarPorLaRuta(`${ORIGEN}/aeo-sana/`)];
    expect(rota.cuerpo.puntos).toEqual({ acceso: "rojo", contenidoSinJs: "rojo", schema: "rojo" });
    expect(sana.cuerpo.puntos).toEqual({ acceso: "verde", contenidoSinJs: "verde", schema: "verde" });
  });

  it("la sana trae el texto en el HTML, un JSON-LD válido con los tres tipos, y el robots la deja abierta", () => {
    expect(textoSinJavaScript(SANA)).toBeGreaterThan(MINIMO_DE_TEXTO);
    expect(tiposDeSchema(SANA)).toEqual(["FAQPage", "LocalBusiness", "Organization"]);
    expect(erroresDeSchema(SANA)).toEqual([]);
    for (const ruta of ["/aeo-sana", "/aeo-sana/"]) {
      expect(Object.values(accesoDeLasIA(ROBOTS, ruta)).every(Boolean), ruta).toBe(true);
    }
    // Ni un script que dibuje: lo que hay es lo servido.
    expect(SANA).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
  });
});

/**
 * GATE-4, por la ruta: un robots que bloquea con la sintaxis de RFC 9309
 * —comodín, fin de ruta, `Allow: /` más largo-gana— tiene que poner rojo el
 * acceso. Con `startsWith`, los dos agentes salían «entran» y la pantalla decía
 * «Los rastreadores entran» sobre la página bloqueada.
 */
describe("GATE-4: el control bloqueado con comodines sale rojo en el acceso, por la ruta", () => {
  it.each([
    ["Disallow: /*", "User-agent: GPTBot\nDisallow: /*\n\nUser-agent: ClaudeBot\nDisallow: /*\n\nUser-agent: *\nDisallow:\n"],
    [
      "comodín, fin de ruta y Allow: / más corto",
      "User-agent: GPTBot\nDisallow: /*control\n\nUser-agent: ClaudeBot\nAllow: /\nDisallow: /aeo-control$\n\nUser-agent: *\nDisallow:\n",
    ],
  ])("%s", async (_caso, robots) => {
    robotsDelDespliegue = robots;
    try {
      const { cuerpo } = await auditarPorLaRuta(`${ORIGEN}/aeo-control/`);
      expect(cuerpo.lectura.acceso.gptbot).toBe(false);
      expect(cuerpo.lectura.acceso.claudebot).toBe(false);
      expect(cuerpo.puntos.acceso).toBe("rojo");
      expect(cuerpo.hallazgos.map((h) => h.quePasa).join(" | ")).toMatch(/Bloqueados: gptbot, claudebot, perplexitybot\./);
    } finally {
      robotsDelDespliegue = ROBOTS;
    }
  });
});
