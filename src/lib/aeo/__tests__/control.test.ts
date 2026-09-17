import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hallazgos, type LecturaDelSitio } from "../hallazgos";
import {
  accesoDeLasIA,
  erroresDeSchema,
  MINIMO_DE_TEXTO,
  textoSinJavaScript,
  tiposDeSchema,
} from "../lectura";
import { bloqueadoPorHttp, statusPorAgente, USER_AGENTS } from "../peticion";

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

describe("la página de control sale en rojo en los tres ejes", () => {
  it("eje 1 — sin JavaScript no hay texto: el HTML servido está vacío", () => {
    const caracteres = textoSinJavaScript(CONTROL);
    expect(caracteres, "el texto vive dentro de un <script>; servido, no existe").toBeLessThan(
      MINIMO_DE_TEXTO
    );
    // Y el número crudo, que es lo que la puerta pide: no «poco», sino cuánto.
    expect(caracteres).toBeLessThan(60);
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
    const acceso = accesoDeLasIA(ROBOTS, "/aeo-control/");
    expect(acceso.gptbot).toBe(false);
    expect(acceso.claudebot).toBe(false);
    expect(acceso.perplexitybot, "el resto entra: el bloqueo es selectivo a propósito").toBe(true);
    // La raíz del sitio sigue abierta para todos: la página de control no
    // puede costarle posicionamiento al producto que la aloja.
    expect(Object.values(accesoDeLasIA(ROBOTS, "/")).every(Boolean)).toBe(true);
  });

  it("eje 3b — el acceso se mide con una PETICIÓN real por agente, no leyendo el robots", async () => {
    const vistos: Array<{ ua: string; status: number }> = [];
    const servidor = async (_url: string, init: RequestInit) => {
      const ua = String(new Headers(init.headers).get("user-agent"));
      // Un CDN que dice «no» a GPTBot con el robots abierto: el caso que sólo
      // una petición real puede ver.
      const status = ua.includes("GPTBot") ? 403 : 200;
      vistos.push({ ua, status });
      return { status } as Response;
    };

    const status = await statusPorAgente("https://control.test/aeo-control/", servidor);

    expect(Object.keys(status).sort()).toEqual(Object.keys(USER_AGENTS).sort());
    expect(vistos.map((v) => v.ua)).toEqual(expect.arrayContaining(Object.values(USER_AGENTS)));
    expect(status.gptbot).toBe(403);
    expect(bloqueadoPorHttp(status.gptbot)).toBe(true);
    expect(bloqueadoPorHttp(status.claudebot)).toBe(false);
  });

  it("los tres ejes juntos: tres hallazgos bloqueantes, uno por eje", () => {
    const lectura: LecturaDelSitio = {
      acceso: accesoDeLasIA(ROBOTS, "/aeo-control/"),
      statusPorAgente: {
        gptbot: 403,
        claudebot: 403,
        perplexitybot: 200,
        "google-extended": 200,
        ccbot: 200,
      },
      caracteresSinJs: textoSinJavaScript(CONTROL),
      schema: tiposDeSchema(CONTROL),
      erroresDeSchema: erroresDeSchema(CONTROL),
      tieneLlmsTxt: false,
    };

    const bloqueantes = hallazgos(lectura).filter((h) => h.gravedad === "bloqueante");
    const textos = bloqueantes.map((h) => h.quePasa).join(" | ");

    expect(bloqueantes.length).toBeGreaterThanOrEqual(3);
    expect(textos, "eje 3: acceso").toMatch(/Bloqueados: gptbot, claudebot/);
    expect(textos, "eje 1: texto sin JS").toMatch(/JavaScript|texto/i);
    expect(textos, "eje 2: schema inválido").toMatch(/JSON-LD.*error/i);
  });

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
