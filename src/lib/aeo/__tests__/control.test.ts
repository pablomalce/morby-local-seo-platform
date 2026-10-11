import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { contenidoSinJs, hallazgos, type Hallazgo, type LecturaDelSitio } from "../hallazgos";
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
const ROBOTS = readFileSync(path.join(RAIZ, "public", "robots.txt"), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// El despliegue, como contesta de verdad (medido con curl el 2026-10-11 contra
// https://morby-local-seo-platform.vercel.app): `/aeo-control/` da 308 a
// `/aeo-control`, que da 200 con este mismo HTML a CUALQUIER user-agent —
// GPTBot, ClaudeBot y CCBot incluidos: Vercel no bloquea a nadie—, el
// `robots.txt` es el de `public/`, y no hay `llms.txt`.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGEN = "https://morby-local-seo-platform.vercel.app";

function despliegue(pedido: PedidoHttp): RespuestaHttp {
  const vacio = Buffer.alloc(0);
  switch (pedido.url) {
    case `${ORIGEN}/aeo-control/`:
      return { tipo: "respuesta", status: 308, encabezados: { location: "/aeo-control" }, cuerpo: vacio };
    case `${ORIGEN}/aeo-control`:
      return { tipo: "respuesta", status: 200, encabezados: { "content-type": "text/html" }, cuerpo: Buffer.from(CONTROL) };
    case `${ORIGEN}/robots.txt`:
      return { tipo: "respuesta", status: 200, encabezados: { "content-type": "text/plain" }, cuerpo: Buffer.from(ROBOTS) };
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
      abrirNavegador: navegadorDoble({ reloj, htmlCrudo: domQueDibujaElControl() }).abrirNavegador,
      transporte: async (pedido) => despliegue(pedido),
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
      // Lo que el despliegue hace con cada agente: 200 a todos. El bloqueo
      // vive SÓLO en el robots, y tiene que verse igual.
      expect(Object.values(cuerpo.lectura.statusPorAgente ?? {})).toEqual([200, 200, 200, 200, 200]);

      const bloqueantes = cuerpo.hallazgos.filter((h) => h.gravedad === "bloqueante");
      const textos = bloqueantes.map((h) => h.quePasa).join(" | ");
      expect(bloqueantes.length).toBe(3);
      expect(textos, "eje 3: acceso").toMatch(/Bloqueados: gptbot, claudebot/);
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
