/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría diga «bloqueado» sobre un sitio abierto, o al revés.
 *
 * Las dos equivocaciones cuestan caro y en direcciones opuestas: decir bloqueado
 * manda a arreglar lo que anda, y decir abierto deja a un cliente invisible para
 * las IA sin que nadie lo note. Por eso los `robots.txt` de acá están escritos a
 * mano con las formas que aparecen en sitios reales, y no generados desde el
 * mismo código que los interpreta.
 */
import { describe, expect, it } from "vitest";
import {
  AGENTES_IA,
  MINIMO_DE_TEXTO,
  accesoDeLasIA,
  agentePuede,
  textoSinJavaScript,
  tiposDeSchema,
} from "../lectura";

describe("quién puede entrar según robots.txt", () => {
  it("sin reglas, se puede: la ausencia de una prohibición no es una prohibición", () => {
    expect(agentePuede("", "GPTBot")).toBe(true);
    expect(agentePuede("# solo un comentario", "GPTBot")).toBe(true);
  });

  it("un `Disallow:` vacío NO bloquea nada", () => {
    // Tratarlo como prefijo vacío bloquearía el sitio entero, y es la forma
    // estándar de decir «pasá». Es el error que hace informar «bloqueado» sobre
    // un sitio abierto.
    expect(agentePuede("User-agent: *\nDisallow:", "GPTBot")).toBe(true);
  });

  it("un `Disallow: /` general bloquea a todos", () => {
    expect(agentePuede("User-agent: *\nDisallow: /", "GPTBot")).toBe(false);
  });

  it("el grupo del agente NOMBRADO gana sobre el de `*`", () => {
    // Es lo que dice el estándar. Sin esto, un sitio que bloquea todo salvo a
    // GPTBot se reportaría como bloqueado para GPTBot.
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow:";
    expect(agentePuede(robots, "GPTBot")).toBe(true);
    expect(agentePuede(robots, "ClaudeBot")).toBe(false);
  });

  it("y al revés: bloquear a uno solo no bloquea a los demás", () => {
    const robots = "User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow:";
    const acceso = accesoDeLasIA(robots);
    expect(acceso.claudebot).toBe(false);
    expect(acceso.gptbot).toBe(true);
    expect(acceso.perplexitybot).toBe(true);
  });

  it("el nombre del agente es insensible a mayúsculas", () => {
    const robots = "User-agent: gptbot\nDisallow: /";
    expect(agentePuede(robots, "GPTBot")).toBe(false);
  });

  it("varios `User-agent` seguidos comparten las reglas que los siguen", () => {
    // Es la forma del estándar, y leerla mal parte el grupo en dos: el segundo
    // agente se quedaría sin reglas y se reportaría como permitido.
    const robots = "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /";
    expect(agentePuede(robots, "GPTBot")).toBe(false);
    expect(agentePuede(robots, "ClaudeBot")).toBe(false);
  });

  it("`Allow` abre una excepción dentro de lo bloqueado", () => {
    const robots = "User-agent: *\nDisallow: /\nAllow: /blog";
    expect(agentePuede(robots, "GPTBot", "/blog/nota")).toBe(true);
    expect(agentePuede(robots, "GPTBot", "/privado")).toBe(false);
  });

  it("los comentarios no cambian nada", () => {
    const robots = "User-agent: *   # todos\nDisallow: /   # todo el sitio";
    expect(agentePuede(robots, "GPTBot")).toBe(false);
  });

  it("se miran los cinco agentes que importan, y ninguno queda sin respuesta", () => {
    const acceso = accesoDeLasIA("User-agent: *\nDisallow: /");
    expect(Object.keys(acceso).sort()).toEqual([...AGENTES_IA].sort());
    expect(Object.values(acceso).every((v) => v === false)).toBe(true);
  });
});

describe("los tipos de schema declarados", () => {
  it("lee un JSON-LD simple", () => {
    const html = `<script type="application/ld+json">{"@type":"LocalBusiness"}</script>`;
    expect(tiposDeSchema(html)).toEqual(["LocalBusiness"]);
  });

  it("aplana `@graph`, que es donde vive la mitad de los sitios reales", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"FAQPage"}]}
    </script>`;
    expect(tiposDeSchema(html)).toEqual(["FAQPage", "Organization"]);
  });

  it("un `@type` con varios valores cuenta todos", () => {
    const html = `<script type="application/ld+json">{"@type":["LocalBusiness","Restaurant"]}</script>`;
    expect(tiposDeSchema(html)).toEqual(["LocalBusiness", "Restaurant"]);
  });

  it("un JSON-LD roto se ignora y NO se inventa un tipo", () => {
    // El motor tampoco lo va a poder leer. Contarlo como presente diría que el
    // dato es citable cuando no lo es.
    const html = `<script type="application/ld+json">{ roto </script>`;
    expect(tiposDeSchema(html)).toEqual([]);
  });

  it("sin JSON-LD devuelve la lista vacía", () => {
    expect(tiposDeSchema("<html><body>hola</body></html>")).toEqual([]);
  });
});

describe("cuánto texto hay sin JavaScript", () => {
  it("no cuenta lo que hay dentro de `script` ni de `style`", () => {
    // Es la trampa: una página vacía con un bundle grande parecería llena.
    const html = `<html><head><style>${"a".repeat(2000)}</style></head>
      <body><script>${"b".repeat(5000)}</script><p>Hola</p></body></html>`;
    expect(textoSinJavaScript(html)).toBeLessThan(20);
  });

  it("cuenta el texto real", () => {
    const html = `<body><p>${"palabra ".repeat(200)}</p></body>`;
    expect(textoSinJavaScript(html)).toBeGreaterThan(MINIMO_DE_TEXTO);
  });

  it("una página que se dibuja en el cliente queda por debajo del umbral", () => {
    const html = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;
    expect(textoSinJavaScript(html)).toBeLessThan(MINIMO_DE_TEXTO);
  });
});
