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
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  AGENTES_IA,
  MAX_LARGO_DE_PATRON,
  MAX_REGLAS_POR_GRUPO,
  MINIMO_DE_TEXTO,
  accesoDeLasIA,
  agentePuede,
  erroresDeSchema,
  leerAcceso,
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

  it("el `$` del final ancla, y en el medio es un carácter más; los tramos no se pisan", () => {
    expect(agentePuede("User-agent: *\nDisallow: /$", "gptbot", "/")).toBe(false);
    expect(agentePuede("User-agent: *\nDisallow: /$", "gptbot", "/x")).toBe(true);
    expect(agentePuede("User-agent: *\nDisallow: /a$b", "gptbot", "/a$b/c")).toBe(false);
    expect(agentePuede("User-agent: *\nDisallow: /a$b", "gptbot", "/ab")).toBe(true);
    // El último tramo anclado no puede reusar lo que ya consumió el primero.
    expect(agentePuede("User-agent: *\nDisallow: /a*a$", "gptbot", "/a")).toBe(true);
    expect(agentePuede("User-agent: *\nDisallow: /a*a$", "gptbot", "/aa")).toBe(false);
    expect(agentePuede("User-agent: *\nDisallow: /ab*ba", "gptbot", "/aba")).toBe(true);
    expect(agentePuede("User-agent: *\nDisallow: /ab*ba", "gptbot", "/abba")).toBe(false);
    expect(agentePuede("User-agent: *\nDisallow: *", "gptbot", "/cualquiera")).toBe(false);
  });
});

/**
 * REDOS: los patrones del `robots.txt` los escribe el sitio auditado, que es
 * un tercero. `aplica` los traducía a una `RegExp` con cada `*` como `.*`, sin
 * tope, y un patrón con muchos comodines contra una ruta larga hace
 * backtracking catastrófico EN EL SERVIDOR. MEDIDO con la versión de la
 * `RegExp` en Node 26: `/*a*a*a*a*b` contra «/» y 100 «a» tardó 0,9 s; con un
 * comodín más, 15 s; con 30, no termina.
 *
 * La medición corre dentro de `vm` con plazo: si vuelve el backtracking, el
 * plazo CORTA la `RegExp` (lo interrumpe V8) y el caso da un rojo legible, en
 * vez de colgar al runner con un bucle que ningún `testTimeout` interrumpe.
 */
describe("REDOS: un robots.txt ajeno no puede colgar el servidor", () => {
  const PATOLOGICO = `User-agent: *\nDisallow: /${"*a".repeat(30)}*b\n`;
  const RUTA_LARGA = `/${"a".repeat(2_000)}`;

  /** Corre `f` con un plazo que interrumpe incluso una `RegExp` en backtracking. */
  function conPlazo<T>(f: () => T, ms: number): { valor: T; ms: number } {
    const inicio = performance.now();
    const valor = vm.runInNewContext("medir()", { medir: f }, { timeout: ms }) as T;
    return { valor, ms: performance.now() - inicio };
  }

  it("treinta comodines contra una ruta de 2 000 caracteres terminan en milisegundos, con la respuesta correcta", () => {
    const { valor, ms } = conPlazo(() => accesoDeLasIA(PATOLOGICO, RUTA_LARGA), 2_000);
    // No hay ninguna «b»: el patrón no coincide y el agente entra.
    expect(valor.gptbot).toBe(true);
    expect(ms).toBeLessThan(100);
    // Y cuando sí coincide, también en milisegundos.
    const conB = conPlazo(() => accesoDeLasIA(PATOLOGICO, `${RUTA_LARGA}b`), 2_000);
    expect(conB.valor.gptbot).toBe(false);
    expect(conB.ms).toBeLessThan(100);
  });

  /**
   * El oráculo es la traducción a `RegExp` de antes, que era CORRECTA y lenta:
   * sobre entradas chicas, donde no se cuelga, las dos tienen que contestar
   * lo mismo. Generado con una semilla fija, para que un rojo se reproduzca.
   */
  it("el matcher lineal contesta lo mismo que la RegExp en 4 000 casos chicos", () => {
    const comoRegExp = (patron: string, ruta: string) => {
      const anclado = patron.endsWith("$");
      const cuerpo = anclado ? patron.slice(0, -1) : patron;
      const expresion = cuerpo
        .split("*")
        .map((t) => t.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp(`^${expresion}${anclado ? "$" : ""}`).test(ruta);
    };
    let semilla = 9309;
    const azar = (n: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
      return semilla % n;
    };
    const palabra = (alfabeto: string, largo: number) =>
      Array.from({ length: largo }, () => alfabeto[azar(alfabeto.length)]).join("");
    const distintos: string[] = [];
    for (let i = 0; i < 4_000; i++) {
      const patron = `/${palabra("ab*$", azar(7))}${azar(3) === 0 ? "$" : ""}`;
      const ruta = `/${palabra("ab$", azar(9))}`;
      const esperado = !comoRegExp(patron, ruta);
      const obtenido = agentePuede(`User-agent: *\nDisallow: ${patron}`, "gptbot", ruta);
      if (obtenido !== esperado) distintos.push(`${patron} contra ${ruta}: ${obtenido}, la RegExp dice ${esperado}`);
    }
    expect(distintos).toEqual([]);
  });
});

/**
 * Los topes: el trabajo de coincidir es lineal por regla, pero un robots puede
 * traer miles de reglas o un patrón kilométrico. Pasado el tope, lo que ese
 * grupo dice NO SE MIDE —`null`, «no medido»—: ignorar la regla podía
 * convertir un `Disallow` en un verde, y truncarla, en otro patrón.
 */
describe("los topes del robots.txt: fuera de tope es «no medido», nunca un permiso", () => {
  it("un patrón más largo que el tope deja sin medir a los agentes de ese grupo, y sólo a ellos", () => {
    const largo = `/${"x".repeat(MAX_LARGO_DE_PATRON)}`;
    const robots = `User-agent: GPTBot\nDisallow: /privado\n\nUser-agent: *\nDisallow: ${largo}\n`;
    const { acceso, fueraDeTope } = leerAcceso(robots, "/");
    expect(acceso.gptbot, "GPTBot tiene su grupo, que está dentro del tope").toBe(true);
    expect(acceso.claudebot).toBeNull();
    expect(fueraDeTope).toMatch(new RegExp(`${largo.length} caracteres`));
    // En el tope justo, se mide.
    const justo = `User-agent: *\nDisallow: /${"x".repeat(MAX_LARGO_DE_PATRON - 1)}\n`;
    expect(accesoDeLasIA(justo, "/").claudebot).toBe(true);
  });

  it("más reglas que el tope en el grupo que aplica —contando los grupos que se fusionan— deja sin medir", () => {
    const reglas = (n: number, prefijo: string) =>
      Array.from({ length: n }, (_, i) => `Disallow: /${prefijo}${i}`).join("\n");
    const mitad = Math.ceil((MAX_REGLAS_POR_GRUPO + 1) / 2);
    // Dos grupos de `*` se fusionan (RFC 9309 §2.2.1): ninguno pasa el tope solo.
    const fusionado = `User-agent: *\n${reglas(mitad, "a")}\n\nUser-agent: *\n${reglas(mitad, "b")}\n`;
    const { acceso, fueraDeTope } = leerAcceso(fusionado, "/");
    expect(acceso.gptbot).toBeNull();
    expect(fueraDeTope).toMatch(/reglas/);
    const enElTope = `User-agent: *\n${reglas(MAX_REGLAS_POR_GRUPO - 1, "a")}\nDisallow: /\n`;
    expect(accesoDeLasIA(enElTope, "/").gptbot).toBe(false);
  });

  it("al parsear, un grupo que pasa el tope deja de guardar reglas ahí mismo: no se arma lo que no se va a usar", () => {
    const reglas = Array.from({ length: MAX_REGLAS_POR_GRUPO * 3 }, (_, i) => `Disallow: /r${i}`).join("\n");
    const { acceso, fueraDeTope } = leerAcceso(`User-agent: *\n${reglas}\n`, "/");
    expect(acceso.ccbot).toBeNull();
    // El motivo del PARSEO, no el del grupo fusionado: el grupo no llegó a
    // guardar las 15 000.
    expect(fueraDeTope).toBe(`más de ${MAX_REGLAS_POR_GRUPO} reglas en un grupo`);
  });

  /**
   * La ruta también la elige el sitio, y los dos topes solos no acotaban el
   * trabajo: MEDIDO, cinco grupos de 5 000 reglas `/*ab<n>` contra una ruta de
   * 16 000 «a» tardaban más de 3 s. El presupuesto lo corta y lo dice.
   */
  it("el peor caso dentro de los topes —5 grupos llenos contra una ruta larga— termina rápido, y es «no medido»", () => {
    const agentes = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"];
    const robots = agentes
      .map((a) => `User-agent: ${a}\n${Array.from({ length: MAX_REGLAS_POR_GRUPO }, (_, i) => `Disallow: /*ab${i}`).join("\n")}`)
      .join("\n\n");
    const inicio = performance.now();
    const { acceso, fueraDeTope } = leerAcceso(robots, `/${"a".repeat(16_000)}`);
    const ms = performance.now() - inicio;
    expect(Object.values(acceso)).toEqual([null, null, null, null, null]);
    expect(fueraDeTope).toMatch(/presupuesto/);
    expect(ms).toBeLessThan(1_000);
  });

  it("un robots.txt real y grande sí se mide contra una ruta larga: cobra lo que recorre, no el largo de la ruta por regla", () => {
    const reglas = Array.from({ length: MAX_REGLAS_POR_GRUPO - 1 }, (_, i) => `Disallow: /categoria-${i}/*?orden=`);
    const ruta = `/${"a".repeat(16_000)}`;
    expect(accesoDeLasIA(`User-agent: *\n${reglas.join("\n")}\n`, ruta).gptbot).toBe(true);
    expect(accesoDeLasIA(`User-agent: *\n${reglas.join("\n")}\nDisallow: /*a$\n`, ruta).gptbot).toBe(false);
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

/**
 * GATE-9: el validador era casi de presencia. Medido con vitest: un
 * `@context` que no es schema.org daba `[]`, y un bloque con `type=` sin
 * comillas ni se detectaba —ni sus tipos ni que no parsea—.
 */
describe("GATE-9: el JSON-LD se valida, no sólo se busca", () => {
  const bloque = (cuerpo: string, tipo = '"application/ld+json"') => `<script type=${tipo}>${cuerpo}</script>`;

  it("un `@context` que no es schema.org es un error, con el valor que trae", () => {
    const errores = erroresDeSchema(bloque('{"@context":"https://example.com/nada","@type":"LocalBusiness"}'));
    expect(errores).toEqual([expect.stringMatching(/bloque 1: @context no es schema\.org.*example\.com\/nada/)]);
  });

  it("schema.org con http o https, con o sin barra, en un arreglo o como @vocab, es válido", () => {
    for (const ctx of [
      '"https://schema.org"',
      '"http://schema.org/"',
      '["https://schema.org", {"ex": "https://example.com/"}]',
      '{"@vocab": "https://schema.org/"}',
    ]) {
      expect(erroresDeSchema(bloque(`{"@context":${ctx},"@type":"Organization"}`)), ctx).toEqual([]);
    }
  });

  it("un bloque con `type=` SIN comillas se lee: sus tipos cuentan y, roto, es un error", () => {
    expect(tiposDeSchema(bloque('{"@context":"https://schema.org","@type":"FAQPage"}', "application/ld+json"))).toEqual(["FAQPage"]);
    expect(erroresDeSchema(bloque('{"@type": }', "application/ld+json"))).toEqual([expect.stringMatching(/bloque 1: no parsea/)]);
  });

  it("un `type` con parámetros o en mayúsculas también es JSON-LD", () => {
    const html = bloque('{"@context":"https://schema.org","@type":"Organization"}', '"application/ld+json; charset=utf-8"');
    expect(tiposDeSchema(html)).toEqual(["Organization"]);
    expect(tiposDeSchema(bloque('{"@context":"https://schema.org","@type":"Organization"}', "'Application/LD+JSON'"))).toEqual([
      "Organization",
    ]);
  });

  it("un `<script>` que no es JSON-LD no se valida", () => {
    expect(erroresDeSchema('<script type="application/json">{"@type": }</script><script>var x = {</script>')).toEqual([]);
  });
});

/**
 * PU-4: el verde falso del schema. `BLOQUE_JSON_LD` era una expresión regular
 * sobre el HTML crudo: un JSON-LD válido dentro de un comentario, de un
 * `<template>` o de un `<textarea>` contaba como schema presente y sin errores,
 * y el punto salía VERDE con los tipos listados —reproducido por la ruta con
 * la página sana y su JSON-LD entre `<!-- -->`—, aunque un parser de HTML no
 * ve ningún `<script>` ahí. Y `"@type": ""` daba el tipo `""` y verde.
 */
describe("PU-4: el JSON-LD se lee donde un parser de HTML lo lee, y un @type vacío es un error", () => {
  const LD = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>';

  it.each([
    ["un comentario", `<!-- ${LD} -->`],
    ["un <template>", `<template>${LD}</template>`],
    ["un <textarea>", `<textarea>${LD}</textarea>`],
    ["un <noscript>", `<noscript>${LD}</noscript>`],
    ["un <title>", `<title>${LD}</title>`],
    ["un <style>", `<style>/* ${LD} */</style>`],
    ["un <iframe>", `<iframe>${LD}</iframe>`],
    ["un <xmp>", `<xmp>${LD}</xmp>`],
    ["un comentario sin cerrar", `<p>hola</p><!-- ${LD}`],
    ["un <plaintext>, que se come el resto", `<plaintext>${LD}`],
  ])("dentro de %s no hay JSON-LD: ni tipos ni errores", (_donde, html) => {
    expect(tiposDeSchema(`<html><body>${html}</body></html>`)).toEqual([]);
    expect(erroresDeSchema(`<html><body>${html}</body></html>`)).toEqual([]);
  });

  it("lo que viene DESPUÉS de esos contenedores sí se lee, y lo de adentro de un <script> no los abre", () => {
    expect(tiposDeSchema(`<!-- un comentario --><template><p>x</p></template><textarea>y</textarea>${LD}`)).toEqual(["Organization"]);
    // `<!-->` y `<!--->` son comentarios que cierran en el acto.
    expect(tiposDeSchema(`<!-->${LD}`)).toEqual(["Organization"]);
    expect(tiposDeSchema(`<!--->${LD}`)).toEqual(["Organization"]);
    // Un `<!--` o un `<template>` escritos DENTRO de un script son texto del script.
    expect(tiposDeSchema(`<script>var a = "<!--"; var b = "<template>";</script>${LD}`)).toEqual(["Organization"]);
    // Un template anidado no cierra al de afuera.
    expect(tiposDeSchema(`<template><template></template>${LD}</template>`)).toEqual([]);
    // Un `</scriptx>` no cierra un script; `</script >` sí.
    expect(
      tiposDeSchema('<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage"}</script >')
    ).toEqual(["FAQPage"]);
  });

  it("un `@type` vacío, o que no es texto, es un error y no es un tipo", () => {
    const bloque = (tipo: string) => `<script type="application/ld+json">{"@context":"https://schema.org","@type":${tipo}}</script>`;
    for (const tipo of ['""', '"   "', "5", "null", "[]", '[""]', "{}"]) {
      expect(erroresDeSchema(bloque(tipo)), tipo).toEqual([expect.stringMatching(/bloque 1: un nodo con @type vacío o que no es texto/)]);
      expect(tiposDeSchema(bloque(tipo)), tipo).toEqual([]);
    }
    // En un arreglo, los válidos cuentan y el vacío igual es un error.
    expect(tiposDeSchema(bloque('["Organization", ""]'))).toEqual(["Organization"]);
    expect(erroresDeSchema(bloque('["Organization", ""]'))).toHaveLength(1);
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

  it("PU-2: un shadow root declarativo SÍ se dibuja —sin JavaScript— y cuenta; un `<template>` común no", () => {
    // Es lo que devuelve la serialización con las sombras del navegador
    // (`chromium.ts`), y lo que trae el HTML de un sitio con DSD servido.
    expect(textoSinJavaScript('<x-a><template shadowrootmode="open"><p>hola</p></template></x-a>')).toBe(4);
    expect(textoSinJavaScript("<x-a><template shadowrootmode='closed'><p>chau</p></template></x-a>")).toBe(4);
    expect(textoSinJavaScript('<x-a><template shadowrootmode="open"><p>a</p><template><p>inerte</p></template></template></x-a>')).toBe(1);
    // Un `shadowrootmode` que no es `open` ni `closed` no declara una sombra.
    expect(textoSinJavaScript('<template shadowrootmode="otro"><p>hola</p></template>')).toBe(0);
    expect(textoSinJavaScript("<template><p>hola</p></template>")).toBe(0);
  });

  it("no cuenta el `<title>`, ni un `<template>`, ni un comentario: `innerText` tampoco", () => {
    const html = `<html><head><title>Un título largo de la pestaña</title></head><body>
      <!-- un comentario > con signo de mayor -->
      <template><p>Una fila que el JavaScript clona</p></template><p>hola</p></body></html>`;
    expect(textoSinJavaScript(html)).toBe(4);
  });
});
