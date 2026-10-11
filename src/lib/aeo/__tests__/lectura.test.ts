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

/**
 * GATE-4: la coincidencia de RFC 9309, no un prefijo. `aplica` hacía sólo
 * `startsWith`, y además cualquier `Allow` que coincidiera le ganaba a un
 * `Disallow`. Medido con vitest: `Disallow: /*` dejaba entrar a GPTBot en la
 * raíz, y `Allow: /` más `Disallow: /aeo-control` lo dejaba entrar a
 * `/aeo-control`. Con el status por agente en 200, la ruta decía «Los
 * rastreadores entran» sobre páginas bloqueadas.
 */
describe("GATE-4: la coincidencia de RFC 9309 —comodines, fin de ruta y la regla más larga—", () => {
  it("`*` coincide con cualquier secuencia: `Disallow: /*` bloquea todo, y `/*control` bloquea /aeo-control", () => {
    expect(agentePuede("User-agent: GPTBot\nDisallow: /*", "gptbot", "/")).toBe(false);
    expect(agentePuede("User-agent: GPTBot\nDisallow: /*", "gptbot", "/aeo-control")).toBe(false);
    expect(agentePuede("User-agent: GPTBot\nDisallow: /*control", "gptbot", "/aeo-control")).toBe(false);
    expect(agentePuede("User-agent: GPTBot\nDisallow: /*control", "gptbot", "/precios")).toBe(true);
    expect(agentePuede("User-agent: *\nDisallow: /*.pdf", "gptbot", "/docs/folleto.pdf")).toBe(false);
  });

  it("`$` ancla el final: `/aeo-control$` bloquea /aeo-control y no /aeo-control/otra", () => {
    const robots = "User-agent: GPTBot\nDisallow: /aeo-control$";
    expect(agentePuede(robots, "gptbot", "/aeo-control")).toBe(false);
    expect(agentePuede(robots, "gptbot", "/aeo-control/otra")).toBe(true);
    expect(agentePuede("User-agent: *\nDisallow: /*.php$", "gptbot", "/index.php")).toBe(false);
    expect(agentePuede("User-agent: *\nDisallow: /*.php$", "gptbot", "/index.php?x=1")).toBe(true);
  });

  it("gana la regla MÁS LARGA, no la primera ni la de `Allow`: `Allow: /` y `Disallow: /aeo-control`", () => {
    const robots = "User-agent: GPTBot\nAllow: /\nDisallow: /aeo-control";
    expect(agentePuede(robots, "gptbot", "/aeo-control")).toBe(false);
    expect(agentePuede(robots, "gptbot", "/")).toBe(true);
    // Y al revés: la excepción más larga abre dentro de lo bloqueado.
    const excepcion = "User-agent: *\nDisallow: /privado\nAllow: /privado/publico";
    expect(agentePuede(excepcion, "gptbot", "/privado/publico/nota")).toBe(true);
    expect(agentePuede(excepcion, "gptbot", "/privado/otra")).toBe(false);
  });

  it("a IGUAL largo gana `Allow`, que es como RFC 9309 resuelve el empate", () => {
    expect(agentePuede("User-agent: *\nDisallow: /pagina\nAllow: /pagina", "gptbot", "/pagina")).toBe(true);
    expect(agentePuede("User-agent: *\nAllow: /pagina\nDisallow: /pagina", "gptbot", "/pagina")).toBe(true);
  });

  it("los caracteres de una expresión regular en la ruta se toman literales", () => {
    expect(agentePuede("User-agent: *\nDisallow: /a.b", "gptbot", "/axb")).toBe(true);
    expect(agentePuede("User-agent: *\nDisallow: /a.b", "gptbot", "/a.b/c")).toBe(false);
    expect(agentePuede("User-agent: *\nDisallow: /(x)?", "gptbot", "/(x)?y")).toBe(false);
  });

  it("`/robots.txt` siempre se puede leer, aunque el robots lo prohíba", () => {
    expect(agentePuede("User-agent: *\nDisallow: /", "gptbot", "/robots.txt")).toBe(true);
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

  // P5: lo que la extracción hace con cada pieza, con el número EXACTO que
  // dibuja un navegador. Sin esto, sacar el reemplazo de entidades o el de
  // `<noscript>` sobrevivía a la suite entera.
  it("cada entidad es UN carácter dibujado, numérica o con nombre, y el espacio duro es espacio", () => {
    // Dibujado: «a & b’s ’c d» — 12 caracteres.
    expect(textoSinJavaScript("<p>a &amp; b&#8217;s &#x2019;c&nbsp;d</p>")).toBe(12);
    expect(textoSinJavaScript("<p>&#8220;Hola&#8221;</p>")).toBe("“Hola”".length);
    // El espacio duro entre espacios se colapsa con ellos, como `\s` colapsa
    // el U+00A0 que devuelve `innerText`: «a b», 3.
    expect(textoSinJavaScript("<p>a &nbsp; b</p>")).toBe(3);
  });

  it("no cuenta `<noscript>`: con JavaScript —como lo ve una persona— no se dibuja", () => {
    expect(textoSinJavaScript("<p>hola</p><noscript>Activá JavaScript para ver esta página</noscript>")).toBe(4);
  });

  it("no cuenta el `<title>`, ni un `<template>`, ni un comentario: `innerText` tampoco", () => {
    const html = `<html><head><title>Un título largo de la pestaña</title></head><body>
      <!-- un comentario > con signo de mayor -->
      <template><p>Una fila que el JavaScript clona</p></template><p>hola</p></body></html>`;
    expect(textoSinJavaScript(html)).toBe(4);
  });
});
