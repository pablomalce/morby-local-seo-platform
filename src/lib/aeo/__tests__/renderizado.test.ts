/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el número renderizado de la auditoría AEO mienta en cualquiera de las
 * tres direcciones que importan:
 *
 *   1. que una página que se dibuja con JavaScript salga en verde, o una SSR en
 *      rojo —la regla, medida de punta a punta con el número que devuelve el
 *      render y no con uno escrito a mano—;
 *   2. que un render que falló devuelva un número —un cero inventado es un
 *      verde inventado—, o que deje un navegador abierto;
 *   3. que el navegador, empujado por la página que abre, llegue a loopback, a
 *      la metadata de la nube o a una red privada: por la URL inicial, por una
 *      redirección o por un subrecurso.
 *
 * Todo con dobles (`navegadorDoble.ts`): el navegador, el transporte y el DNS.
 * Lo que un doble no puede probar —la red propia de Chromium, que no pasa por
 * el interceptor— lo prueba `renderizado.integracion.test.ts` con un Chrome de
 * verdad.
 */
import { describe, expect, it } from "vitest";
import { contenidoSinJs, hallazgos, type LecturaDelSitio } from "../hallazgos";
import { AGENTES_IA, contarCaracteres, textoSinJavaScript } from "../lectura";
import {
  crearExaminador,
  medirRenderizado,
  nuevaBitacora,
  OPCIONES_RENDER,
  type Bitacora,
  type DependenciasRender,
} from "../renderizado";
import { navegadorDoble, relojVirtual, resolvedorDoble, transporteDoble, type Sitio } from "./navegadorDoble";

const PUBLICA = "93.184.216.34";
const OTRA_PUBLICA = "151.101.1.1";

const TODOS_ENTRAN = Object.fromEntries(AGENTES_IA.map((a) => [a, true])) as LecturaDelSitio["acceso"];

/** El DNS de todos los casos: un nombre público, y los que apuntan adentro. */
const DNS = {
  "sitio.test": [PUBLICA],
  "cdn.test": [OTRA_PUBLICA],
  "interno.test": ["10.0.0.7"],
  "metadata.test": ["169.254.169.254"],
  "mixto.test": [PUBLICA, "127.0.0.1"],
  "localhost": ["127.0.0.1", "::1"],
  // RT-4: un reproductor de otro sitio, y un nombre con SÓLO registros AAAA
  // —como `brunhild.challenges.cloudflare.com`—, pública y sin ruta.
  "video.test": [OTRA_PUBLICA],
  "solo-v6.test": ["2606:4700::6812:1092"],
  "www.mudado.test": [PUBLICA],
};

function bitacoraVacia(): Bitacora {
  return nuevaBitacora();
}

function armar(
  sitio: Sitio | ((reloj: ReturnType<typeof relojVirtual>) => Sitio),
  opcionesNavegador: Parameters<typeof navegadorDoble>[0] = {}
) {
  // Tiempo virtual: la espera de quietud del DOM no duerme de verdad.
  const reloj = relojVirtual();
  const navegador = navegadorDoble({ reloj, ...opcionesNavegador });
  const red = transporteDoble(typeof sitio === "function" ? sitio(reloj) : sitio);
  const dns = resolvedorDoble(DNS);
  const deps: DependenciasRender = {
    abrirNavegador: navegador.abrirNavegador,
    transporte: red.transporte,
    resolver: dns.resolver,
    ...reloj,
  };
  return { deps, navegador, red, dns, reloj, bitacora: bitacoraVacia() };
}

const TEXTO_JS = "Contenido que sólo existe después de ejecutar JavaScript. ".repeat(30);

describe("la medición contra el punto de la puerta", () => {
  it("una página sólo-JS: servido ≈ 0, renderizado > 0, y el punto sale ROJO", async () => {
    const html = `<html><head><title>x</title></head><body><div id="app"></div><script src="/app.js"></script></body></html>`;
    const { deps } = armar({
      "http://sitio.test/": { cuerpo: html },
      "http://sitio.test/app.js": { cuerpo: TEXTO_JS, encabezados: { "content-type": "text/javascript" } },
    });

    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;

    const servido = textoSinJavaScript(html);
    expect(servido).toBeLessThan(5);
    expect(render.caracteres).toBeGreaterThan(1_000);

    const lectura: LecturaDelSitio = {
      acceso: TODOS_ENTRAN,
      caracteresSinJs: servido,
      caracteresRenderizados: render,
      schema: ["Organization", "LocalBusiness", "FAQPage"],
      tieneLlmsTxt: true,
    };
    expect(contenidoSinJs(lectura).estado).toBe("rojo");
    expect(hallazgos(lectura).some((h) => h.gravedad === "bloqueante" && /renderizado/.test(h.donde))).toBe(true);
  });

  it("una página SSR: servido ≈ renderizado, y el punto NO sale rojo", async () => {
    const html = `<html><body><main><h1>Clínica</h1><p>${"Texto servido por el servidor. ".repeat(60)}</p></main>
      <script src="/analytics.js"></script></body></html>`;
    const { deps } = armar({
      "http://sitio.test/": { cuerpo: html },
      "http://sitio.test/analytics.js": { cuerpo: "" },
    });

    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;
    const servido = textoSinJavaScript(html);
    expect(Math.abs(render.caracteres - servido)).toBeLessThan(5);

    const punto = contenidoSinJs({
      acceso: TODOS_ENTRAN,
      caracteresSinJs: servido,
      caracteresRenderizados: render,
      schema: [],
      tieneLlmsTxt: true,
    });
    expect(punto.estado).toBe("verde");
  });

  it("los dos lados se cuentan con LA MISMA normalización", async () => {
    // El navegador serializa el DOM con su propio espacio y sus propias
    // entidades (`&nbsp;`, `<html><head>` agregados). Contados con dos
    // funciones distintas, la misma página daría dos números distintos y la
    // diferencia la inventaría el código.
    const html = `<body><p>Hola</p>\n<p>mundo   de\tverdad</p></body>`;
    const { deps } = armar(
      { "http://sitio.test/": { cuerpo: html } },
      { htmlCrudo: "<html><head></head><body><p>Hola</p>\n\n<p>mundo&nbsp;de verdad</p>\n</body></html>" }
    );
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render).toEqual({ estado: "medido", caracteres: textoSinJavaScript(html), servidos: textoSinJavaScript(html) });
    expect(textoSinJavaScript(html)).toBe("Hola mundo de verdad".length);
  });
});

/**
 * P2. Reproducido con Chrome 154: una página que pone su contenido con un
 * `setTimeout` de 1,5 s, sin red, salía con el menú solo —el render leía a la
 * primera quietud de red— y el punto en VERDE con el 84 % del texto dibujado
 * por JavaScript. El doble dibuja texto tardío en tiempo virtual.
 */
describe("P2: el texto que llega DESPUÉS de la quietud de red también se cuenta", () => {
  const MENU = `<nav>${Array.from({ length: 60 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
  const CONTENIDO_TARDE = "Contenido real que el JavaScript pone con un temporizador. ".repeat(147);

  it("contenido puesto a los 1,5 s sin pedir nada: se espera, se cuenta, y el punto sale ROJO", async () => {
    const html = `<html><body>${MENU}<main id="app"></main></body></html>`;
    const { deps } = armar({ "http://sitio.test/": { cuerpo: html } }, { textoTardio: [{ enMs: 1_500, texto: CONTENIDO_TARDE }] });
    const render = await medirRenderizado("http://sitio.test/", deps);
    const servido = textoSinJavaScript(html);
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;
    expect(render.caracteres).toBeGreaterThan(servido + 8_000);
    expect(
      contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: servido, caracteresRenderizados: render, schema: [], tieneLlmsTxt: true }).estado
    ).toBe("rojo");
  });

  it("lo que se dibuja AL VERSE (debajo del pliegue) se cuenta: la página se recorre antes de leer", async () => {
    const html = `<html><body>${MENU}<section id="abajo"></section></body></html>`;
    const { deps, navegador } = armar({ "http://sitio.test/": { cuerpo: html } }, { textoAlVerse: CONTENIDO_TARDE });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(navegador.registro.recorridos).toBe(1);
    expect(render.estado === "medido" && render.caracteres).toBeGreaterThan(textoSinJavaScript(html) + 8_000);
  });

  it("un texto que NO DEJA de crecer: `inestable`, sin número, y el punto queda «no medido»", async () => {
    const goteo = Array.from({ length: 200 }, (_, i) => ({ enMs: (i + 1) * 300, texto: `línea número ${i} agregada sin parar` }));
    const { deps, navegador } = armar({ "http://sitio.test/": { cuerpo: `<body>${MENU}</body>` } }, { textoTardio: goteo });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render).toEqual({ estado: "fallo", codigo: "inestable" });
    expect(navegador.registro.cierres).toBe(1);
    const punto = contenidoSinJs({ ...SANO_PUNTO, caracteresRenderizados: render });
    expect(punto.estado).toBe("no-medido");
  });

  it("un texto que crece y se QUEDA se lee cuando se quedó, no antes ni nunca", async () => {
    const pasos = [1, 2, 3].map((i) => ({ enMs: i * 600, texto: "Tramo que llega por partes. ".repeat(20) }));
    const { deps } = armar({ "http://sitio.test/": { cuerpo: `<body><p>inicio</p></body>` } }, { textoTardio: pasos });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    // Los tres tramos: el último llegó a los 1,8 s, y después hubo quietud.
    expect(render.estado === "medido" && render.caracteres).toBe(
      contarCaracteres(["inicio", ...pasos.map((p) => p.texto)].join(" "))
    );
  });
});

/**
 * P4 y GATE-1: los dos lados salen del MISMO documento, con la MISMA
 * extracción, y ninguno aplica CSS.
 *
 * P4 (Chrome 154): un mega-menú `display: none` servido y TODO lo demás
 * dibujado por JavaScript salía VERDE porque el lado servido contaba lo oculto
 * y el renderizado (`innerText`) no. GATE-1 (Chrome 154 y la ruta): al
 * arreglarlo contando «lo visible sin JavaScript», una página SSR que oculta
 * su texto con CSS hasta que corre el JavaScript —`elementor-invisible`— salía
 * BLOQUEANTE, y un rastreador sin JavaScript tampoco aplica CSS: lee el texto
 * entero. Ahora el menú oculto cuenta de los DOS lados, y lo que el JavaScript
 * agrega cuenta sólo del renderizado.
 */
describe("P4 y GATE-1: el lado servido es el texto del HTML, del mismo documento y con la misma extracción", () => {
  const MEGA_MENU = `<nav style="display: none">${Array.from({ length: 80 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
  const DIBUJADO = "Todo lo que una persona ve lo dibuja el JavaScript. ".repeat(61);

  it("un mega-menú oculto servido y el contenido dibujado por JavaScript: el punto sale ROJO", async () => {
    const html = `<html><body>${MEGA_MENU}<main id="app"></main><script src="/app.js"></script></body></html>`;
    const { deps, red, navegador } = armar({
      "http://sitio.test/": { cuerpo: html },
      "http://sitio.test/app.js": { cuerpo: DIBUJADO },
    });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;

    // El menú cuenta de los dos lados: el rastreador lo lee, y el DOM lo tiene.
    expect(render.servidos).toBe(textoSinJavaScript(html));
    expect(render.caracteres).toBeGreaterThan(textoSinJavaScript(html) + contarCaracteres(DIBUJADO) - 5);
    const punto = contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(html), caracteresRenderizados: render });
    expect(punto.estado).toBe("rojo");

    // La pestaña sin JavaScript recibió el MISMO documento, sin volver a la red.
    expect(navegador.registro.paginasSinJs).toBe(1);
    expect(red.pedidos.filter((p) => p.url === "http://sitio.test/")).toHaveLength(1);
  });

  it("GATE-1: una página SSR que OCULTA su texto con CSS hasta que corre el JavaScript sale VERDE", async () => {
    // El patrón de Elementor: cada sección con `elementor-invisible`
    // (visibility: hidden) hasta que el JavaScript se la saca. Lo que el
    // JavaScript cambia es una clase, no el texto.
    const secciones = Array.from(
      { length: 25 },
      (_, i) => `<section class="elementor-invisible"><h2>Sección ${i}</h2><p>${"Texto servido por el servidor. ".repeat(4)}</p></section>`
    ).join("");
    const html = `<html><head><style>.elementor-invisible{visibility:hidden}</style></head><body>${secciones}<script src="/elementor.js"></script></body></html>`;
    const { deps } = armar(
      { "http://sitio.test/": { cuerpo: html }, "http://sitio.test/elementor.js": { cuerpo: "" } },
      { htmlCrudo: html.replace(/ class="elementor-invisible"/g, ' class=""') }
    );
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;
    expect(render.servidos).toBe(textoSinJavaScript(html));
    expect(render.caracteres).toBe(render.servidos);
    const lectura = { ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(html), caracteresRenderizados: render };
    expect(contenidoSinJs(lectura).estado).toBe("verde");
    expect(hallazgos(lectura).filter((h) => h.gravedad === "bloqueante")).toEqual([]);
  });

  it("la pestaña sin JavaScript pide SÓLO el documento: ni la hoja de estilos ni el marco de un <noscript> salen a la red", async () => {
    // El marco de Google Tag Manager vive dentro de `<noscript>`: con el
    // JavaScript apagado es un elemento, y Chromium lo pide. Ni él ni el CSS
    // cambian el texto del DOM principal, así que no se piden.
    const html = `<html><head><link rel="stylesheet" href="/estilo.css"></head><body>
      <noscript><iframe src="http://cdn.test/ns.html?id=GTM-X"></iframe></noscript>
      <p>${"Texto servido. ".repeat(60)}</p><script src="/app.js"></script></body></html>`;
    const { deps, red, navegador, bitacora } = armar({
      "http://sitio.test/": { cuerpo: html },
      "http://sitio.test/app.js": { cuerpo: "" },
      "http://sitio.test/estilo.css": { cuerpo: "p { color: red }", encabezados: { "content-type": "text/css" } },
      "http://cdn.test/ns.html?id=GTM-X": { cuerpo: "<p>marco</p>" },
    });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");
    expect(navegador.registro.pedidos.filter((p) => p.url.includes("ns.html") || p.url.includes("estilo.css")).map((p) => p.desenlace)).toEqual([
      "abortado",
      "abortado",
    ]);
    // A la red salió lo que pidió la pestaña con JavaScript, cada cosa una vez.
    expect(red.pedidos.map((p) => p.url).sort()).toEqual(["http://sitio.test/", "http://sitio.test/app.js"]);
    // Y lo que la otra no pidió a propósito no ensucia la bitácora.
    expect(bitacora.bloqueados).toEqual([]);
  });

  it("una página SSR: lo servido ≈ lo renderizado, y el punto sigue verde", async () => {
    const html = `<html><body><main><p>${"Texto servido por el servidor. ".repeat(60)}</p></main></body></html>`;
    const { deps } = armar({ "http://sitio.test/": { cuerpo: html } });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado === "medido" && render.servidos).toBe(textoSinJavaScript(html));
    expect(contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(html), caracteresRenderizados: render }).estado).toBe(
      "verde"
    );
  });

  it("si la pestaña sin JavaScript no se puede abrir, no hay número: `lectura-servida`, y el navegador se cierra", async () => {
    const { deps, navegador } = armar({ "http://sitio.test/": { cuerpo: `<p>${"x ".repeat(600)}</p>` } }, { paginaSinJsFalla: true });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "lectura-servida" });
    expect(navegador.registro.cierres).toBe(1);
  });
});

/**
 * RT-1. Reproducido con el headless shell de producción en AL2023 con 1 vCPU:
 * una página que sirve un menú visible de 1 249 caracteres y dibuja el
 * contenido con `<script src=app.js>` daba `medido 1249/1249` —VERDE— cuando
 * el bundle no llegaba (demorado 9 s, o de 6 MB), y contra el despliegue real
 * 3 de 43 renders salieron `medido` con chunks de Next.js en `timeout`.
 */
describe("RT-1: un render al que no le llegó lo que escribe el texto NO es una medición", () => {
  const MENU = `<nav>${Array.from({ length: 60 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
  const CONTENIDO = "Contenido del negocio que dibuja el bundle de la página. ".repeat(70);
  const HIBRIDA = `<html><body>${MENU}<main id="app"></main><script src="/app.js"></script></body></html>`;

  it("el control del instrumento: con el bundle entregado, la página híbrida es ROJA", async () => {
    const { deps } = armar({ "http://sitio.test/": { cuerpo: HIBRIDA }, "http://sitio.test/app.js": { cuerpo: CONTENIDO } });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    expect(contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(HIBRIDA), caracteresRenderizados: render }).estado).toBe(
      "rojo"
    );
  });

  it.each(["timeout", "sin-respuesta", "tls", "demasiado-grande"] as const)(
    "el bundle no llega por el transporte (%s): `subrecurso-<motivo>`, sin número, y el punto queda «no medido»",
    async (motivo) => {
      const { deps, navegador, bitacora } = armar({
        "http://sitio.test/": { cuerpo: HIBRIDA },
        "http://sitio.test/app.js": { cuerpo: CONTENIDO, error: motivo },
      });
      const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
      expect(render).toEqual({ estado: "fallo", codigo: `subrecurso-${motivo}` });
      expect(bitacora.noLlegaron).toEqual([{ url: "http://sitio.test/app.js", tipo: "script", motivo }]);
      expect(navegador.registro.cierres).toBe(1);
      const punto = contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(HIBRIDA), caracteresRenderizados: render });
      expect(punto.estado).toBe("no-medido");
    }
  );

  it("el presupuesto de bytes ya gastado cuando sale el bundle: `subrecurso-presupuesto`", async () => {
    const { deps } = armar({ "http://sitio.test/": { cuerpo: HIBRIDA }, "http://sitio.test/app.js": { cuerpo: CONTENIDO } });
    const render = await medirRenderizado("http://sitio.test/", deps, {
      ...OPCIONES_RENDER,
      maxBytesTotales: Buffer.byteLength(HIBRIDA),
    });
    expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-presupuesto" });
  });

  it("los datos que trae el JavaScript (`fetch`) y un marco cuentan igual que un script", async () => {
    const conDatos = `<html><body>${MENU}<main data-fetch="/api/contenido"></main></body></html>`;
    const datos = armar({ "http://sitio.test/": { cuerpo: conDatos }, "http://sitio.test/api/contenido": { error: "timeout" } });
    expect(await medirRenderizado("http://sitio.test/", datos.deps)).toEqual({ estado: "fallo", codigo: "subrecurso-timeout" });

    const conMarco = `<html><body>${MENU}<iframe src="/widget"></iframe></body></html>`;
    const marco = armar({ "http://sitio.test/": { cuerpo: conMarco }, "http://sitio.test/widget": { error: "tls" } });
    expect(await medirRenderizado("http://sitio.test/", marco.deps)).toEqual({ estado: "fallo", codigo: "subrecurso-tls" });
  });

  /**
   * PU-3: tres caminos por los que un bundle NO LLEGABA y el render salía
   * `medido` igual. Reproducido con Chrome 154 por la revisión: una página
   * con un menú de 529 y `<script src=https://cdn-v6.test/app.js>` (una IPv6
   * sin ruta) daba `render 529/529`, punto VERDE y `noLlegaron=[]`.
   */
  it("PU-3 — un transporte que RECHAZA (el TypeError del connect IPv6) es `subrecurso-sin-respuesta`, no un verde", async () => {
    const { deps, bitacora } = armar({ "http://sitio.test/": { cuerpo: HIBRIDA }, "http://sitio.test/app.js": { cuerpo: CONTENIDO } });
    const transporte = deps.transporte;
    deps.transporte = async (pedido) => {
      if (pedido.url.endsWith("/app.js")) throw new TypeError("Cannot read properties of null (reading 'setServername')");
      return transporte(pedido);
    };
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-sin-respuesta" });
    expect(bitacora.noLlegaron).toEqual([{ url: "http://sitio.test/app.js", tipo: "script", motivo: "sin-respuesta" }]);
    // Con su motivo en la bitácora, como cualquier otro error del transporte.
    expect(bitacora.bloqueados).toContainEqual({ url: "http://sitio.test/app.js", motivo: "sin-respuesta" });

    // Y si el que rechaza es el del DOCUMENTO, el render dice por qué no
    // navegó —`sin-respuesta`—, no un genérico `navegacion`.
    const doc = armar({ "http://sitio.test/": { cuerpo: HIBRIDA } });
    doc.deps.transporte = async () => {
      throw new TypeError("Cannot read properties of null (reading 'setServername')");
    };
    expect(await medirRenderizado("http://sitio.test/", doc.deps)).toEqual({ estado: "fallo", codigo: "sin-respuesta" });
  });

  it("PU-3 — una respuesta que el navegador NO ACEPTA (`responder` tira) no llegó: `subrecurso-sin-respuesta`", async () => {
    const { deps, bitacora } = armar(
      { "http://sitio.test/": { cuerpo: HIBRIDA }, "http://sitio.test/app.js": { cuerpo: CONTENIDO } },
      { responderFalla: (url) => url.endsWith("/app.js") }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-sin-respuesta" });
    expect(bitacora.noLlegaron.map((n) => n.url)).toEqual(["http://sitio.test/app.js"]);
  });

  it("PU-3 — un CDN cuyo DNS NO CONTESTÓ no es un nombre que no existe: `subrecurso-dns-sin-respuesta`", async () => {
    const html = `<html><body>${MENU}<main id="app"></main><script src="http://cdn.test/app.js"></script></body></html>`;
    const { deps, bitacora } = armar({ "http://sitio.test/": { cuerpo: html }, "http://cdn.test/app.js": { cuerpo: CONTENIDO } });
    const resolver = deps.resolver;
    deps.resolver = async (host, senal) => (host === "cdn.test" ? { ok: false, transitorio: true } : resolver(host, senal));
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-dns-sin-respuesta" });
    // Y un nombre que NO EXISTE sigue sin contar: con el DNS de hoy es un dominio muerto.
    deps.resolver = async (host, senal) => (host === "cdn.test" ? { ok: false } : resolver(host, senal));
    expect((await medirRenderizado("http://sitio.test/", deps)).estado).toBe("medido");
  });

  it("PU-3 — el examen pasa la IPv4 primero y las demás de alternativa, aunque el DNS traiga la AAAA antes", async () => {
    const { deps, red } = armar({ "http://sitio.test/": { cuerpo: HIBRIDA }, "http://sitio.test/app.js": { cuerpo: CONTENIDO } });
    deps.resolver = async () => ({ ok: true, direcciones: ["2606:4700:4700::1111", PUBLICA, OTRA_PUBLICA] });
    await medirRenderizado("http://sitio.test/", deps);
    expect(red.pedidos[0]).toMatchObject({ ip: PUBLICA, alternativas: [OTRA_PUBLICA, "2606:4700:4700::1111"] });
  });

  it("lo que la POLÍTICA rechaza no es «no llegó»: un script a una red privada deja medir", async () => {
    const html = `<html><body>${MENU}<script src="http://interno.test/interno.js"></script><img src="/foto.jpg"></body></html>`;
    const { deps, bitacora } = armar({ "http://sitio.test/": { cuerpo: html }, "http://interno.test/interno.js": { cuerpo: "x" } });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");
    expect(bitacora.noLlegaron).toEqual([]);
  });

  it("un chunk que todavía está EN VUELO al leer se espera, y lo que trae se cuenta: el punto sale ROJO, no verde", async () => {
    // El chunk perezoso sale después del `load` y su origen contesta a los
    // 5 s: la lectura ya vio 2 s de quietud con el menú solo. Sin esperar lo
    // que estaba en vuelo, el número era el del menú, igual al servido: verde.
    const { deps, navegador } = armar(
      (reloj) => ({
        "http://sitio.test/": { cuerpo: `<html><body>${MENU}<main id="app"></main></body></html>` },
        "http://sitio.test/chunk.js": { cuerpo: CONTENIDO, llegaCuando: () => reloj.alcanzar(5_000) },
      }),
      { enSegundoPlano: [{ url: "/chunk.js", tipo: "script" }] }
    );
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;
    expect(render.caracteres).toBeGreaterThan(contarCaracteres(CONTENIDO));
    expect(navegador.registro.pedidos.find((p) => p.url.endsWith("/chunk.js"))?.desenlace).toBe("respondido");
    expect(contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: render.servidos ?? 0, caracteresRenderizados: render }).estado).toBe("rojo");
  });

  it("un pedido que escribe texto y NO termina nunca: `subrecurso-pendiente`, y el navegador se cierra", async () => {
    const { deps, navegador } = armar(
      {
        "http://sitio.test/": { cuerpo: `<html><body>${MENU}<main id="app"></main></body></html>` },
        "http://sitio.test/api/siempre": { cuerpo: "x", llegaCuando: () => new Promise(() => {}) },
      },
      { enSegundoPlano: [{ url: "/api/siempre", tipo: "fetch" }] }
    );
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "subrecurso-pendiente" });
    expect(navegador.registro.cierres).toBe(1);
  });
});

/**
 * RT-4. MEDIDO contra la web real: https://vulkan-studios.com (WordPress con
 * Elementor) salía `subrecurso-sin-respuesta` en producción, 2 de 2, y acá con
 * Chrome 154. El pedido que no llegaba era un `fetch` a
 * `brunhild.challenges.cloudflare.com` —un nombre con SÓLO registros AAAA—
 * desde el marco del desafío de Cloudflare, dentro del marco de
 * `player.vimeo.com`, dentro de la página. Un Chrome normal en la misma red
 * sin IPv6 tampoco lo trae (`net::ERR_ADDRESS_UNREACHABLE`): el transporte
 * no tiene defecto. Lo que estaba mal era contarlo: un marco de otro sitio no
 * escribe en el DOM que se cuenta.
 */
describe("RT-4: lo que pide un marco de OTRO SITIO no decide si la página se midió", () => {
  const MENU = `<nav>${Array.from({ length: 60 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
  const CONTENIDO = "Contenido del negocio que dibuja el bundle de la página. ".repeat(70);
  const CON_VIDEO = `<html><body>${MENU}<main id="app"></main><script src="/app.js"></script><iframe src="http://video.test/embed"></iframe></body></html>`;
  const SITIO: Sitio = {
    "http://sitio.test/": { cuerpo: CON_VIDEO },
    "http://sitio.test/app.js": { cuerpo: CONTENIDO },
    "http://video.test/embed": { cuerpo: "<p>reproductor</p>" },
    "http://solo-v6.test/sonda": { error: "sin-respuesta" },
  };
  const rojo = (render: Awaited<ReturnType<typeof medirRenderizado>>) =>
    contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(CON_VIDEO), caracteresRenderizados: render }).estado;

  it("el caso de vulkan-studios.com: el `fetch` que un marco de otro sitio no recibe no deja la página sin número", async () => {
    const { deps, bitacora } = armar(SITIO, {
      enSegundoPlano: [{ url: "http://solo-v6.test/sonda", tipo: "fetch", marco: "http://video.test/embed" }],
    });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");
    // El pedido salió y no llegó —está en la bitácora con su motivo—, pero no
    // cuenta: la prueba no pasa porque el marco no haya pedido nada.
    expect(bitacora.bloqueados).toContainEqual({ url: "http://solo-v6.test/sonda", motivo: "sin-respuesta" });
    expect(bitacora.noLlegaron).toEqual([]);
    // Y el bundle de la página, que sí llegó, se contó: el punto sale ROJO.
    expect(rojo(render)).toBe("rojo");
  });

  it("el DOCUMENTO de un marco de otro sitio que no llega tampoco: un reproductor caído no es la página", async () => {
    const { deps, bitacora } = armar({ ...SITIO, "http://video.test/embed": { error: "timeout" } });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");
    expect(bitacora.bloqueados).toContainEqual({ url: "http://video.test/embed", motivo: "timeout" });
    expect(bitacora.noLlegaron).toEqual([]);
  });

  it("y un pedido de ese marco que no termina nunca no deja la lectura esperándolo: no es `subrecurso-pendiente`", async () => {
    const { deps } = armar(
      { ...SITIO, "http://video.test/player.js": { cuerpo: "x", llegaCuando: () => new Promise(() => {}) } },
      { enSegundoPlano: [{ url: "http://video.test/player.js", tipo: "script", marco: "http://video.test/embed" }] }
    );
    expect((await medirRenderizado("http://sitio.test/", deps)).estado).toBe("medido");
  });

  it("el MISMO pedido desde la página sigue sin número: lo que la página pide y no le llega es `subrecurso-<motivo>`", async () => {
    const { deps, bitacora } = armar(SITIO, { enSegundoPlano: [{ url: "http://solo-v6.test/sonda", tipo: "fetch" }] });
    expect(await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora)).toEqual({
      estado: "fallo",
      codigo: "subrecurso-sin-respuesta",
    });
    expect(bitacora.noLlegaron).toEqual([{ url: "http://solo-v6.test/sonda", tipo: "fetch", motivo: "sin-respuesta" }]);
  });

  it.each([
    ["un marco del MISMO origen, que puede escribir en la página", "http://sitio.test/widget"],
    ["un marco de otro origen del MISMO sitio (`document.domain`)", "http://widgets.sitio.test/w"],
    ["un marco `about:blank`, que hereda el origen de quien lo creó", "about:blank"],
    ["un pedido SIN marco: un worker de la página, que le pasa los datos", null],
  ])("lo que no llega a %s sigue dejando la página sin número", async (_caso, marco) => {
    const { deps } = armar(SITIO, { enSegundoPlano: [{ url: "http://solo-v6.test/sonda", tipo: "fetch", marco }] });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "subrecurso-sin-respuesta" });
  });

  it("los bytes de un marco de otro sitio salen de SU presupuesto: un reproductor que baja video no deja sin bytes al chunk de la página", async () => {
    const SEGMENTO = "v".repeat(600);
    const { deps } = armar({
      "http://sitio.test/": { cuerpo: "<p>hola</p>" },
      "http://video.test/seg1": { cuerpo: SEGMENTO },
      "http://video.test/seg2": { cuerpo: SEGMENTO },
      "http://video.test/seg3": { cuerpo: SEGMENTO },
      "http://sitio.test/chunk.js": { cuerpo: "c".repeat(300) },
    });
    const bitacora = bitacoraVacia();
    const { crearInterceptor } = await import("../renderizado");
    const opciones = { ...OPCIONES_RENDER, maxBytesTotales: 1_000, maxBytesDeOtrosSitios: 1_000 };
    const atender = crearInterceptor(deps, opciones, bitacora, () => 5_000, new AbortController().signal);
    const desenlaces: Record<string, string> = {};
    // Uno por vez, en orden: el presupuesto se mira antes de pedir.
    const pedir = (url: string, tipo: string, esDocumentoPrincipal: boolean, urlDelMarco: string | null) =>
      atender({
        url,
        metodo: "GET",
        encabezados: {},
        tipo,
        esDocumentoPrincipal,
        urlDelMarco,
        continuar: async () => void (desenlaces[url] = "continuado"),
        abortar: async () => void (desenlaces[url] = "abortado"),
        responder: async () => void (desenlaces[url] = "respondido"),
      });
    await pedir("http://sitio.test/", "document", true, null);
    for (const n of [1, 2, 3]) await pedir(`http://video.test/seg${n}`, "xhr", false, "http://video.test/embed");
    await pedir("http://sitio.test/chunk.js", "script", false, "http://sitio.test/");
    // El reproductor gastó el suyo (el tercer segmento ya no salió)...
    expect(desenlaces["http://video.test/seg3"]).toBe("abortado");
    expect(bitacora.bloqueados).toContainEqual({ url: "http://video.test/seg3", motivo: "presupuesto" });
    // ...y el chunk de la página salió con el de la página: con un solo
    // presupuesto, los 1 200 bytes del video lo dejaban `subrecurso-presupuesto`.
    expect(desenlaces["http://sitio.test/chunk.js"]).toBe("respondido");
    expect(bitacora.noLlegaron).toEqual([]);
  });

  it("el sitio de la página es el del ÚLTIMO salto: después de una redirección, un marco del sitio nuevo cuenta", async () => {
    const pagina = `<html><body>${MENU}<main id="app"></main></body></html>`;
    const sitio: Sitio = {
      "http://sitio.test/": { status: 301, encabezados: { location: "http://www.mudado.test/" } },
      "http://www.mudado.test/": { cuerpo: pagina },
      "http://solo-v6.test/sonda": { error: "sin-respuesta" },
    };
    const delNuevo = armar(sitio, {
      enSegundoPlano: [{ url: "http://solo-v6.test/sonda", tipo: "fetch", marco: "http://cdn.mudado.test/w" }],
    });
    expect(await medirRenderizado("http://sitio.test/", delNuevo.deps)).toEqual({
      estado: "fallo",
      codigo: "subrecurso-sin-respuesta",
    });
    // Y uno del sitio del PRIMER salto ya es de otro sitio que la página.
    const delViejo = armar(sitio, {
      enSegundoPlano: [{ url: "http://solo-v6.test/sonda", tipo: "fetch", marco: "http://sitio.test/w" }],
    });
    expect((await medirRenderizado("http://sitio.test/", delViejo.deps)).estado).toBe("medido");
  });
});

/**
 * RT-2. Medido con el headless shell de producción en AL2023 con 1 vCPU y
 * `/tmp` vacío: el arranque en frío (descomprimir y lanzar) tardó 3,8, 6,0 y
 * 7,1 s, y una página estática de Next.js, 13 a 22,9 s en frío —y una de 7
 * corridas, 24,4 s y `timeout`—. Con 25 s de tope total, la primera auditoría
 * de una instancia fría no medía, sin que el sitio cambiara.
 */
describe("RT-2: el presupuesto alcanza para un arranque en frío y una página lenta", () => {
  it("arranque en frío de 7,1 s y una página que tarda 18 s en cargar: se MIDE (27 s en total, como el `timeout` de 27,3 s medido)", async () => {
    const html = `<html><body><main><p>${"Texto servido por el servidor. ".repeat(60)}</p></main></body></html>`;
    const { deps, reloj } = armar({ "http://sitio.test/": { cuerpo: html } }, { arranqueVirtualMs: 7_100, navegacionVirtualMs: 18_000 });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    expect(reloj.ahora()).toBeGreaterThan(25_000);
  });

  it("el peor caso de la ruta cabe en su maxDuration: la portada, el render entero y el cierre", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fuente = readFileSync(path.join(process.cwd(), "src", "app", "api", "aeo", "audit", "route.ts"), "utf8");
    const maxDuration = Number(fuente.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/)?.[1]);
    const { PLAZO_POR_PEDIDO_DE_LA_RUTA_MS } = await import("../red");
    expect(maxDuration).toBeGreaterThan(0);
    // La portada va sola y antes; el render corre al lado del robots y los agentes.
    const peorCaso = PLAZO_POR_PEDIDO_DE_LA_RUTA_MS + OPCIONES_RENDER.topeMs + OPCIONES_RENDER.cierreMs;
    expect(peorCaso + 3_000, "tres segundos para la sesión, la base y la respuesta").toBeLessThanOrEqual(maxDuration * 1_000);
  });
});

const SANO_PUNTO: LecturaDelSitio = {
  acceso: TODOS_ENTRAN,
  caracteresSinJs: 4_000,
  schema: [],
  tieneLlmsTxt: true,
};

describe("un fallo es un fallo: con código, sin número, y con el navegador cerrado", () => {
  it("sin Chromium: `sin-navegador`, y el punto queda «no medido», no verde", async () => {
    const { deps } = armar({ "http://sitio.test/": { cuerpo: "<p>x</p>" } }, { arranqueFalla: true });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render).toEqual({ estado: "fallo", codigo: "sin-navegador" });
    expect(render).not.toHaveProperty("caracteres");

    const punto = contenidoSinJs({
      acceso: TODOS_ENTRAN,
      caracteresSinJs: 4_000,
      caracteresRenderizados: render,
      schema: [],
      tieneLlmsTxt: true,
    });
    expect(punto.estado).toBe("no-medido");
    expect(punto.hallazgo?.gravedad).toBe("no-medido");
  });

  it("una navegación que no termina: `timeout` dentro del tope, y el navegador se cierra", async () => {
    const { deps, navegador } = armar({ "http://sitio.test/": { cuerpo: "<p>x</p>" } }, { navegacionColgada: true });
    const inicio = Date.now();
    const render = await medirRenderizado("http://sitio.test/", deps, { ...OPCIONES_RENDER, topeMs: 150 });
    expect(render).toEqual({ estado: "fallo", codigo: "timeout" });
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(navegador.registro.aperturas).toBe(1);
    expect(navegador.registro.cierres, "el finally cierra aunque haya vencido el plazo").toBe(1);
  });

  it("el plazo vence DURANTE el arranque: el navegador que llega tarde también se cierra", async () => {
    const { deps, navegador } = armar({ "http://sitio.test/": { cuerpo: "<p>x</p>" } }, { arranqueMs: 300 });
    const render = await medirRenderizado("http://sitio.test/", deps, { ...OPCIONES_RENDER, topeMs: 100 });
    expect(render).toEqual({ estado: "fallo", codigo: "timeout" });
    expect(navegador.registro.aperturas).toBe(1);
    expect(navegador.registro.cierres, "un Chromium huérfano sigue vivo en la próxima invocación").toBe(1);
  });

  it("si la pestaña no se puede abrir, devuelve un fallo —no tira— y cierra", async () => {
    const { deps, navegador } = armar({ "http://sitio.test/": { cuerpo: "<p>x</p>" } }, { paginaFalla: true });
    await expect(medirRenderizado("http://sitio.test/", deps)).resolves.toEqual({
      estado: "fallo",
      codigo: "navegacion",
    });
    expect(navegador.registro.cierres).toBe(1);
  });

  it("una medición que salió bien también cierra el navegador", async () => {
    const { deps, navegador } = armar({ "http://sitio.test/": { cuerpo: "<p>hola</p>" } });
    await medirRenderizado("http://sitio.test/", deps);
    expect(navegador.registro.aperturas).toBe(1);
    expect(navegador.registro.cierres).toBe(1);
  });

  it("un documento que contesta 4xx/5xx es `http_<status>`, no un texto de página de error", async () => {
    const { deps } = armar({ "http://sitio.test/": { status: 403, cuerpo: "<h1>Forbidden</h1>" } });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "http_403" });
  });

  it("un documento que se declara descarga no se entrega: `descarga`", async () => {
    const { deps, navegador } = armar({
      "http://sitio.test/": { cuerpo: "PK...", encabezados: { "content-disposition": "attachment; filename=x.zip" } },
    });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "descarga" });
    expect(navegador.registro.pedidos[0].desenlace).toBe("abortado");
  });
});

describe("SSRF: el navegador no llega a ninguna red que no sea pública", () => {
  it("una REDIRECCIÓN a 127.0.0.1 se aborta, y nadie le pide nada a loopback", async () => {
    const { deps, red, navegador, bitacora } = armar({
      "http://sitio.test/": { status: 302, encabezados: { location: "http://127.0.0.1/admin" } },
      "http://127.0.0.1/admin": { cuerpo: "SECRETO DE LOOPBACK" },
    });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);

    expect(render).toEqual({ estado: "fallo", codigo: "red-no-publica" });
    expect(red.pedidos.map((p) => p.url)).toEqual(["http://sitio.test/"]);
    expect(navegador.registro.pedidos.map((p) => [p.url, p.desenlace])).toEqual([
      ["http://sitio.test/", "respondido"],
      ["http://127.0.0.1/admin", "abortado"],
    ]);
    expect(bitacora.bloqueados).toEqual([{ url: "http://127.0.0.1/admin", motivo: "red-no-publica" }]);
  });

  it("una REDIRECCIÓN a la metadata (169.254.169.254) se aborta", async () => {
    const { deps, red } = armar({
      "http://sitio.test/": { status: 301, encabezados: { location: "http://169.254.169.254/latest/meta-data/" } },
      "http://169.254.169.254/latest/meta-data/": { cuerpo: "iam/credentials" },
    });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "red-no-publica" });
    expect(red.pedidos.some((p) => p.url.includes("169.254"))).toBe(false);
  });

  it("una redirección a un NOMBRE que resuelve a 10.x se aborta: se examina la dirección, no el nombre", async () => {
    const { deps, red } = armar({
      "http://sitio.test/": { status: 302, encabezados: { location: "http://interno.test/" } },
      "http://interno.test/": { cuerpo: "panel interno" },
    });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "red-no-publica" });
    expect(red.pedidos.map((p) => p.url)).toEqual(["http://sitio.test/"]);
  });

  it("los SUBRECURSOS a 127.0.0.1, 169.254.169.254 y 10.x se abortan, y la página se mide igual", async () => {
    const html = `<html><body><p>${"Texto real del sitio. ".repeat(40)}</p>
      <script src="http://127.0.0.1/loopback.js"></script>
      <script src="http://169.254.169.254/latest/meta-data/iam.js"></script>
      <script src="http://interno.test/interno.js"></script>
      <script src="http://mixto.test/mixto.js"></script>
      <div data-fetch="http://metadata.test/latest/user-data"></div>
      <iframe src="http://localhost/"></iframe>
      <img src="http://10.1.2.3/pixel.gif">
      <script src="http://cdn.test/legitimo.js"></script></body></html>`;
    const { deps, red, navegador, bitacora } = armar({
      "http://sitio.test/": { cuerpo: html },
      "http://127.0.0.1/loopback.js": { cuerpo: "SECRETO-LOOPBACK" },
      "http://169.254.169.254/latest/meta-data/iam.js": { cuerpo: "SECRETO-METADATA" },
      "http://interno.test/interno.js": { cuerpo: "SECRETO-INTERNO" },
      "http://mixto.test/mixto.js": { cuerpo: "SECRETO-MIXTO" },
      "http://metadata.test/latest/user-data": { cuerpo: "SECRETO-USERDATA" },
      "http://localhost/": { cuerpo: "SECRETO-LOCALHOST" },
      "http://cdn.test/legitimo.js": { cuerpo: "texto legítimo de un CDN público" },
    });

    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");

    // Ninguna dirección que no sea pública llegó al transporte.
    expect(red.pedidos.map((p) => p.url).sort()).toEqual(["http://cdn.test/legitimo.js", "http://sitio.test/"]);
    expect(red.pedidos.map((p) => p.ip).sort()).toEqual([OTRA_PUBLICA, PUBLICA]);
    // Y lo que esas direcciones habrían contestado no está en lo dibujado.
    expect(navegador.registro.textoDibujado).not.toMatch(/SECRETO/);
    expect(navegador.registro.textoDibujado).toContain("texto legítimo de un CDN público");

    const motivos = Object.fromEntries(bitacora.bloqueados.map((b) => [b.url, b.motivo]));
    expect(motivos).toEqual({
      "http://127.0.0.1/loopback.js": "red-no-publica",
      "http://169.254.169.254/latest/meta-data/iam.js": "red-no-publica",
      "http://interno.test/interno.js": "red-no-publica",
      // Una A pública y otra privada: alcanza con UNA para rechazar.
      "http://mixto.test/mixto.js": "red-no-publica",
      "http://metadata.test/latest/user-data": "red-no-publica",
      "http://localhost/": "red-no-publica",
      // Las imágenes no cambian `innerText`: no salen, sin mirar adónde iban.
      "http://10.1.2.3/pixel.gif": "sin-texto",
    });
  });

  it("la URL INICIAL a una red privada no arranca un navegador", async () => {
    const { deps, navegador, red } = armar({});
    for (const url of ["http://10.0.0.7/", "http://169.254.169.254/", "http://interno.test/", "http://localhost/"]) {
      expect(await medirRenderizado(url, deps)).toEqual({ estado: "fallo", codigo: "red-no-publica" });
    }
    expect(navegador.registro.aperturas).toBe(0);
    expect(red.pedidos).toHaveLength(0);
  });

  it("sólo http y https salen; data:, blob: y about: no salen a la red y se dejan", async () => {
    const examinar = crearExaminador(resolvedorDoble(DNS).resolver);
    const senal = new AbortController().signal;
    expect(await examinar(new URL("file:///etc/passwd"), senal)).toEqual({ ok: false, motivo: "esquema" });
    expect(await examinar(new URL("ftp://sitio.test/x"), senal)).toEqual({ ok: false, motivo: "esquema" });
    expect(await examinar(new URL("gopher://sitio.test/"), senal)).toEqual({ ok: false, motivo: "esquema" });

    const html = `<body><p>hola</p><script src="data:text/javascript,1"></script><script src="file:///etc/passwd"></script></body>`;
    const { deps, navegador, red } = armar({ "http://sitio.test/": { cuerpo: html } });
    await medirRenderizado("http://sitio.test/", deps);
    const desenlace = Object.fromEntries(navegador.registro.pedidos.map((p) => [p.url, p.desenlace]));
    expect(desenlace["data:text/javascript,1"]).toBe("continuado");
    expect(desenlace["file:///etc/passwd"]).toBe("abortado");
    expect(red.pedidos.map((p) => p.url)).toEqual(["http://sitio.test/"]);
  });

  it("las formas raras de escribir loopback y la metadata también se rechazan", async () => {
    const examinar = crearExaminador(resolvedorDoble(DNS).resolver);
    const senal = new AbortController().signal;
    for (const url of [
      "http://2130706433/", // 127.0.0.1 en decimal
      "http://0x7f000001/", // en hexadecimal
      "http://127.1/", // abreviada
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/", // IPv4 dentro de IPv6
      "http://[::ffff:169.254.169.254]/",
      "http://[fd00:ec2::254]/", // la metadata de AWS por IPv6
      "http://0.0.0.0/",
      "http://169.254.169.254./",
    ]) {
      expect(await examinar(new URL(url), senal), url).toEqual({ ok: false, motivo: "red-no-publica" });
    }
  });

  it("puertos que no son 80/443 y credenciales en la URL no salen", async () => {
    const examinar = crearExaminador(resolvedorDoble(DNS).resolver);
    const senal = new AbortController().signal;
    expect(await examinar(new URL("http://sitio.test:6379/"), senal)).toEqual({ ok: false, motivo: "puerto" });
    expect(await examinar(new URL("http://sitio.test:8080/"), senal)).toEqual({ ok: false, motivo: "puerto" });
    expect(await examinar(new URL("http://u:p@sitio.test/"), senal)).toEqual({ ok: false, motivo: "credenciales" });
    expect(await examinar(new URL("http://sitio.test/"), senal)).toEqual({ ok: true, ip: PUBLICA });
    expect(await examinar(new URL("https://sitio.test:443/"), senal)).toEqual({ ok: true, ip: PUBLICA });
  });

  it("rebinding: el nombre se resuelve UNA vez y el transporte conecta a ESA dirección", async () => {
    // Un DNS hostil: pública a la primera, metadata a la segunda. Si algo
    // volviera a resolver entre el examen y la conexión, la segunda respuesta
    // ganaría. Acá no hay segunda: la caché por medición y el `ip` del pedido.
    let veces = 0;
    const hostil = resolvedorDoble({
      "sitio.test": () => (veces++ === 0 ? [PUBLICA] : ["169.254.169.254"]),
    });
    const reloj = relojVirtual();
    const navegador = navegadorDoble({ reloj });
    const red = transporteDoble({
      "http://sitio.test/": { cuerpo: `<p>hola</p><script src="/a.js"></script><script src="/b.js"></script>` },
      "http://sitio.test/a.js": { cuerpo: "a" },
      "http://sitio.test/b.js": { cuerpo: "b" },
    });
    const render = await medirRenderizado("http://sitio.test/", {
      abrirNavegador: navegador.abrirNavegador,
      transporte: red.transporte,
      resolver: hostil.resolver,
      ...reloj,
    });
    expect(render.estado).toBe("medido");
    expect(red.pedidos.map((p) => p.ip)).toEqual([PUBLICA, PUBLICA, PUBLICA]);
    expect(hostil.consultas).toEqual(["sitio.test"]);
  });

  it("un nombre que no resuelve no sale, y un DNS que tira no es un permiso: es «el DNS no contestó» (PU-3)", async () => {
    const senal = new AbortController().signal;
    const examinar = crearExaminador(async () => {
      throw new Error("ECONNREFUSED");
    });
    // Antes «no-resuelve», como un nombre que no existe: y un subrecurso así
    // quedaba fuera de RT-1. Ahora es un pedido que no llegó.
    expect(await examinar(new URL("http://cualquiera.test/"), senal)).toEqual({ ok: false, motivo: "dns-sin-respuesta" });
    const vacio = crearExaminador(resolvedorDoble({}).resolver);
    expect(await vacio(new URL("http://nadie.test/"), senal)).toEqual({ ok: false, motivo: "no-resuelve" });
  });

  it("métodos que escriben no salen: PUT, DELETE y PATCH se abortan", async () => {
    const { deps } = armar({ "http://sitio.test/": { cuerpo: "<p>hola</p>" } });
    const bitacora = bitacoraVacia();
    // El interceptor se prueba con un pedido armado a mano: el doble sólo pide GET.
    const { crearInterceptor } = await import("../renderizado");
    const atender = crearInterceptor(deps, OPCIONES_RENDER, bitacora, () => 5_000, new AbortController().signal);
    const vistos: string[] = [];
    for (const metodo of ["PUT", "DELETE", "PATCH"]) {
      await atender({
        url: "http://sitio.test/api",
        metodo,
        encabezados: {},
        tipo: "fetch",
        esDocumentoPrincipal: false,
        urlDelMarco: "http://sitio.test/",
        continuar: async () => void vistos.push(`${metodo} continuado`),
        abortar: async () => void vistos.push(`${metodo} abortado`),
        responder: async () => void vistos.push(`${metodo} respondido`),
      });
    }
    expect(vistos).toEqual(["PUT abortado", "DELETE abortado", "PATCH abortado"]);
    expect(bitacora.pedidos).toEqual([]);
  });
});
