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
  crearInterceptor,
  MAX_RUTA_DEL_DETALLE,
  medirRenderizado,
  nuevaBitacora,
  OPCIONES_RENDER,
  type Bitacora,
  type CacheDeRespuestas,
  type DependenciasRender,
  type DetalleDelSubrecurso,
  type MotivoDeSubrecurso,
  type PedidoDelNavegador,
  type PedidoHttp,
  type ResultadoRenderizado,
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
  // FV-1: el otro sitio al que la página manda la pestaña, sin confirmarse.
  "otro.test": [OTRA_PUBLICA],
  // SEC-A2: un subdominio del sitio, y dos sitios hermanos bajo el mismo nombre.
  "api.sitio.test": [PUBLICA],
  "mio.app.test": [PUBLICA],
  "otro.app.test": [OTRA_PUBLICA],
  // R7-SEC-A2: un nombre que TERMINA como el sitio sin ser un subdominio, y
  // el sitio con su `www.`.
  "xsitio.test": [OTRA_PUBLICA],
  "www.sitio.test": [PUBLICA],
  // CSP-SIN-TEXTO-MUERTO: el tercero al que la página manda sus reportes.
  "tercero.test": [OTRA_PUBLICA],
};

function bitacoraVacia(): Bitacora {
  return nuevaBitacora();
}

/**
 * Un `subrecurso-<motivo>` con su detalle: el PRIMER pedido que lo decidió.
 * `noLlegaron` es 1 salvo que el caso diga otra cosa.
 */
function falloPor(
  motivo: MotivoDeSubrecurso,
  pedido: Omit<DetalleDelSubrecurso, "motivo" | "noLlegaron"> & { noLlegaron?: number }
): ResultadoRenderizado {
  return { estado: "fallo", codigo: `subrecurso-${motivo}`, detalle: { noLlegaron: 1, ...pedido, motivo } };
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
      expect(render).toEqual(falloPor(motivo, { tipo: "script", host: "sitio.test", ruta: "/app.js", origen: "pagina" }));
      expect(bitacora.noLlegaron).toEqual([{ url: "http://sitio.test/app.js", tipo: "script", motivo, origen: "pagina" }]);
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
    expect(render).toEqual(falloPor("presupuesto", { tipo: "script", host: "sitio.test", ruta: "/app.js", origen: "pagina" }));
  });

  it("los datos que trae el JavaScript (`fetch`) y un marco cuentan igual que un script", async () => {
    const conDatos = `<html><body>${MENU}<main data-fetch="/api/contenido"></main></body></html>`;
    const datos = armar({ "http://sitio.test/": { cuerpo: conDatos }, "http://sitio.test/api/contenido": { error: "timeout" } });
    expect(await medirRenderizado("http://sitio.test/", datos.deps)).toEqual(
      falloPor("timeout", { tipo: "fetch", host: "sitio.test", ruta: "/api/contenido", origen: "pagina" })
    );

    const conMarco = `<html><body>${MENU}<iframe src="/widget"></iframe></body></html>`;
    const marco = armar({ "http://sitio.test/": { cuerpo: conMarco }, "http://sitio.test/widget": { error: "tls" } });
    // La navegación del marco se juzga por la URL a la que va: es del sitio de la página.
    expect(await medirRenderizado("http://sitio.test/", marco.deps)).toEqual(
      falloPor("tls", { tipo: "document", host: "sitio.test", ruta: "/widget", origen: "mismo-sitio" })
    );
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
    expect(render).toEqual(falloPor("sin-respuesta", { tipo: "script", host: "sitio.test", ruta: "/app.js", origen: "pagina" }));
    expect(bitacora.noLlegaron).toEqual([{ url: "http://sitio.test/app.js", tipo: "script", motivo: "sin-respuesta", origen: "pagina" }]);
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
    expect(render).toEqual(falloPor("sin-respuesta", { tipo: "script", host: "sitio.test", ruta: "/app.js", origen: "pagina" }));
    expect(bitacora.noLlegaron.map((n) => n.url)).toEqual(["http://sitio.test/app.js"]);
  });

  it("PU-3 — un CDN cuyo DNS NO CONTESTÓ no es un nombre que no existe: `subrecurso-dns-sin-respuesta`", async () => {
    const html = `<html><body>${MENU}<main id="app"></main><script src="http://cdn.test/app.js"></script></body></html>`;
    const { deps, bitacora } = armar({ "http://sitio.test/": { cuerpo: html }, "http://cdn.test/app.js": { cuerpo: CONTENIDO } });
    const resolver = deps.resolver;
    deps.resolver = async (host, senal) => (host === "cdn.test" ? { ok: false, transitorio: true } : resolver(host, senal));
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render).toEqual(falloPor("dns-sin-respuesta", { tipo: "script", host: "cdn.test", ruta: "/app.js", origen: "pagina" }));
    // Y un nombre que NO EXISTE sigue sin contar: con el DNS de hoy es un dominio muerto.
    deps.resolver = async (host, senal) => (host === "cdn.test" ? { ok: false } : resolver(host, senal));
    expect((await medirRenderizado("http://sitio.test/", deps)).estado).toBe("medido");
  });

  /**
   * FV125-1: un pedido que decide está EN VUELO desde que entra al
   * interceptor, también mientras el examen espera al DNS. Reproducido por la
   * revisión con Chrome 155 y el resolvedor de producción (c-ares, 1,5 s × 2)
   * contra un DNS local que no contestaba: una sección que carga su script al
   * verse daba `medido 1249/1249` y VERDE 3 de 3, y la bitácora anotaba
   * `dns-sin-respuesta` DESPUÉS de leer. El DNS contesta acá a los 5 s del
   * reloj, cuando la lectura (2 s de quietud) ya terminó.
   */
  function conDnsLento(respuesta: { ok: false; transitorio: true } | { ok: true; direcciones: string[] }) {
    const html = `<html><body>${MENU}<main id="app"></main></body></html>`;
    const armado = armar(
      { "http://sitio.test/": { cuerpo: html }, "http://cdn.test/seccion.js": { cuerpo: CONTENIDO } },
      { enSegundoPlano: [{ url: "http://cdn.test/seccion.js", tipo: "script" }] }
    );
    const resolver = armado.deps.resolver;
    armado.deps.resolver = async (host, senal) => {
      if (host !== "cdn.test") return resolver(host, senal);
      await armado.reloj.alcanzar(5_000);
      return respuesta;
    };
    return { ...armado, html };
  }

  it("FV125-1 — el DNS de un pedido que decide no contesta MIENTRAS se lee: `subrecurso-dns-sin-respuesta`, no VERDE", async () => {
    const { deps, bitacora, reloj } = conDnsLento({ ok: false, transitorio: true });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render).toEqual(falloPor("dns-sin-respuesta", { tipo: "script", host: "cdn.test", ruta: "/seccion.js", origen: "pagina" }));
    // Se esperó al DNS: si no, esto no prueba nada.
    expect(reloj.ahora()).toBeGreaterThanOrEqual(5_000);
  });

  it("FV125-1 — el DNS contesta TARDE (una AAAA muda): lo que trae se espera y se cuenta —ROJO, no VERDE—", async () => {
    const { deps, red, html } = conDnsLento({ ok: true, direcciones: [OTRA_PUBLICA] });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(red.pedidos.map((p) => p.url)).toContain("http://cdn.test/seccion.js");
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;
    expect(render.caracteres).toBeGreaterThan(contarCaracteres(CONTENIDO));
    expect(contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(html), caracteresRenderizados: render }).estado).toBe("rojo");
  });

  it("FV125-1 — en vuelo desde que ENTRA al interceptor, antes del examen; lo que no decide, no", async () => {
    const { deps } = armar({});
    deps.resolver = () => new Promise(() => {});
    const bitacora = bitacoraVacia();
    const atender = crearInterceptor(deps, OPCIONES_RENDER, bitacora, () => 5_000, new AbortController().signal);
    const pedido = (url: string, tipo: string): PedidoDelNavegador => ({
      url,
      metodo: "GET",
      encabezados: {},
      tipo,
      esDocumentoPrincipal: false,
      urlDelMarco: "http://sitio.test/",
      urlDeLaPagina: "http://sitio.test/",
      continuar: async () => {},
      abortar: async () => {},
      responder: async () => {},
    });
    void atender(pedido("http://cdn.test/seccion.js", "script"));
    void atender(pedido("http://cdn.test/estilo.css", "stylesheet"));
    await new Promise((listo) => setImmediate(listo));
    expect(bitacora.enVuelo).toBe(1);
    expect([...bitacora.enCamino]).toEqual([{ url: "http://cdn.test/seccion.js", tipo: "script", origen: "pagina" }]);
  });

  it("PU-3 — el examen pasa la IPv4 primero y las demás de alternativa, aunque el DNS traiga la AAAA antes", async () => {
    const { deps, red } = armar({ "http://sitio.test/": { cuerpo: HIBRIDA }, "http://sitio.test/app.js": { cuerpo: CONTENIDO } });
    deps.resolver = async () => ({ ok: true, direcciones: ["2606:4700:4700::1111", PUBLICA, OTRA_PUBLICA] });
    await medirRenderizado("http://sitio.test/", deps);
    expect(red.pedidos[0]).toMatchObject({ ip: PUBLICA, alternativas: [OTRA_PUBLICA, "2606:4700:4700::1111"] });
  });

  /**
   * F2: lo que la POLÍTICA no deja salir y decide es contenido que la
   * auditoría no vio. MEDIDO por la revisión con Chrome 155: un menú de 619 y
   * `fetch("https://sitio.test:8443/api/contenido")`, que escribía 4 499, daban
   * `bloqueados=[puerto]`, `noLlegaron=[]`, `medido 619/619` y VERDE. Y la
   * mutación que sumaba `puerto` a la lista sobrevivía a los 292 tests: ninguno
   * fijaba el caso.
   */
  it.each([
    ["puerto", `<main data-fetch="https://sitio.test:8443/api/contenido"></main>`, "https://sitio.test:8443/api/contenido", "fetch"],
    ["puerto", `<script src="https://cdn.test:8443/app.js"></script>`, "https://cdn.test:8443/app.js", "script"],
    ["esquema", `<script src="ftp://cdn.test/app.js"></script>`, "ftp://cdn.test/app.js", "script"],
    ["credenciales", `<script src="http://u:p@cdn.test/app.js"></script>`, "http://u:p@cdn.test/app.js", "script"],
    ["red-no-publica", `<script src="http://interno.test/interno.js"></script>`, "http://interno.test/interno.js", "script"],
  ] as const)(
    "F2 — lo que escribe texto y la política rechaza (%s) NO LLEGÓ: `subrecurso-<motivo>`, y el punto queda «no medido»",
    async (motivo, etiqueta, url, tipo) => {
      const html = `<html><body>${MENU}${etiqueta}<img src="http://10.1.2.3/foto.jpg"></body></html>`;
      const { deps, bitacora, red } = armar({ "http://sitio.test/": { cuerpo: html }, [url]: { cuerpo: CONTENIDO } });
      const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
      const destino = new URL(url);
      expect(render).toEqual(falloPor(motivo, { tipo, host: destino.hostname, ruta: destino.pathname, origen: "pagina" }));
      expect(bitacora.noLlegaron).toEqual([{ url, tipo, motivo, origen: "pagina" }]);
      // Y la política sigue siendo la política: no salió.
      expect(red.pedidos.map((p) => p.url)).toEqual(["http://sitio.test/"]);
      // Las credenciales de la URL no llegan al detalle.
      expect(JSON.stringify(render)).not.toMatch(/u:p/);
      expect(contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(html), caracteresRenderizados: render }).estado).toBe(
        "no-medido"
      );
    }
  );

  it("F2 — un método que escribe (PUT) en un pedido de datos tampoco llegó: `subrecurso-metodo`", async () => {
    const { deps, bitacora, red } = armar(
      { "http://sitio.test/": { cuerpo: `<html><body>${MENU}</body></html>` }, "http://sitio.test/api": { cuerpo: CONTENIDO } },
      { enSegundoPlano: [{ url: "/api", tipo: "fetch", metodo: "PUT" }] }
    );
    expect(await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora)).toEqual(
      falloPor("metodo", { tipo: "fetch", host: "sitio.test", ruta: "/api", origen: "pagina" })
    );
    expect(red.pedidos.map((p) => p.url)).toEqual(["http://sitio.test/"]);
  });

  it("F2 — lo que NO cuenta: una imagen a una red privada (no escribe texto) y un nombre que NO EXISTE", async () => {
    const html = `<html><body>${MENU}<img src="http://10.1.2.3/foto.jpg"><script src="http://nadie.test/app.js"></script></body></html>`;
    const { deps, bitacora } = armar({ "http://sitio.test/": { cuerpo: html } });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");
    expect(bitacora.noLlegaron).toEqual([]);
    expect(bitacora.bloqueados).toEqual(
      expect.arrayContaining([
        { url: "http://10.1.2.3/foto.jpg", motivo: "sin-texto" },
        { url: "http://nadie.test/app.js", motivo: "no-resuelve" },
      ])
    );
  });

  /**
   * F2 con la regla de RT-4: lo que la política le rechaza a un marco de OTRO
   * sitio no decide, como no decide lo que no le llega. Lo mismo desde un
   * worker —Chromium no dice de qué marco es— o desde un marco del mismo
   * sitio, sí.
   */
  it.each([
    ["un marco de OTRO sitio: no decide", "http://video.test/embed", null],
    ["un worker: decide", null, "worker"],
    ["un marco del MISMO sitio: decide", "http://widgets.sitio.test/w", "mismo-sitio"],
  ] as const)("F2 — lo que la política le rechaza a %s", async (_caso, marco, origen) => {
    const { deps, bitacora, red } = armar(
      { "http://sitio.test/": { cuerpo: `<html><body>${MENU}</body></html>` } },
      {
        enSegundoPlano: [
          { url: "https://cdn.test:8443/datos", tipo: "fetch", marco },
          { url: "http://interno.test/datos", tipo: "fetch", marco },
        ],
      }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    // Los dos salieron del interceptor rechazados por la política, siempre.
    expect(bitacora.bloqueados).toEqual(
      expect.arrayContaining([
        { url: "https://cdn.test:8443/datos", motivo: "puerto" },
        { url: "http://interno.test/datos", motivo: "red-no-publica" },
      ])
    );
    expect(red.pedidos.map((p) => p.url)).toEqual(["http://sitio.test/"]);
    if (origen === null) {
      expect(render.estado).toBe("medido");
      expect(bitacora.noLlegaron).toEqual([]);
    } else {
      expect(render).toEqual(falloPor("puerto", { tipo: "fetch", host: "cdn.test", ruta: "/datos", origen, noLlegaron: 2 }));
    }
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
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual(
      falloPor("pendiente", { tipo: "fetch", host: "sitio.test", ruta: "/api/siempre", origen: "pagina" })
    );
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
    expect(await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora)).toEqual(
      falloPor("sin-respuesta", { tipo: "fetch", host: "solo-v6.test", ruta: "/sonda", origen: "pagina" })
    );
    expect(bitacora.noLlegaron).toEqual([{ url: "http://solo-v6.test/sonda", tipo: "fetch", motivo: "sin-respuesta", origen: "pagina" }]);
  });

  // El tercer valor es de dónde salió el pedido según el detalle: lo nombra,
  // no decide nada (los seis cuentan igual).
  it.each([
    ["un marco del MISMO origen, que puede escribir en la página", "http://sitio.test/widget", "mismo-sitio"],
    ["un marco de otro origen del MISMO sitio (`document.domain`)", "http://widgets.sitio.test/w", "mismo-sitio"],
    ["un marco `about:blank`, que hereda el origen de quien lo creó", "about:blank", "marco-desconocido"],
    // F2: lo que la tabla del PR afirma y ningún test ataba. MEDIDO con
    // Chrome 155: el `script` de un `<iframe srcdoc>` sale con el marco
    // `about:srcdoc`, y el de un `<iframe src=blob:…>` con el marco
    // `blob:http://sitio.test/<uuid>`. Los dos heredan el origen de la página.
    ["un marco `about:srcdoc`", "about:srcdoc", "marco-desconocido"],
    ["un marco `blob:` que armó la página", "blob:http://sitio.test/6f1c2a9e-3b7d-4e2a-9c1f-0d8e7b6a5c4d", "marco-desconocido"],
    ["un pedido SIN marco: un worker de la página, que le pasa los datos", null, "worker"],
  ] as const)("lo que no llega a %s sigue dejando la página sin número", async (_caso, marco, origen) => {
    const { deps } = armar(SITIO, { enSegundoPlano: [{ url: "http://solo-v6.test/sonda", tipo: "fetch", marco }] });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual(
      falloPor("sin-respuesta", { tipo: "fetch", host: "solo-v6.test", ruta: "/sonda", origen })
    );
  });

  it("F2 — un marco de otro sitio que SE NAVEGA al sitio de la página se juzga por la URL a la que va: si no llega, la página no se mide", async () => {
    // El marco ya tiene un documento de red de otro sitio (`video.test`); la
    // navegación sale con ese marco y va a `sitio.test`. El documento que
    // llegaría es del sitio de la página y podría escribir en ella: cuenta.
    const { deps, bitacora } = armar(SITIO, {
      enSegundoPlano: [{ url: "http://sitio.test/corta", tipo: "document", marco: "http://video.test/embed" }],
    });
    expect(await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora)).toEqual(
      falloPor("sin-respuesta", { tipo: "document", host: "sitio.test", ruta: "/corta", origen: "mismo-sitio" })
    );
    expect(bitacora.noLlegaron).toEqual([
      { url: "http://sitio.test/corta", tipo: "document", motivo: "sin-respuesta", origen: "mismo-sitio" },
    ]);
    // Y la misma navegación del marco a OTRO sitio no cuenta.
    const aOtro = armar(SITIO, {
      enSegundoPlano: [{ url: "http://cdn.test/corta", tipo: "document", marco: "http://video.test/embed" }],
    });
    expect((await medirRenderizado("http://sitio.test/", aOtro.deps)).estado).toBe("medido");
  });

  /**
   * FV-4. Reproducido por la revisión con Chrome 155 y el headless shell 153,
   * también en main: `importScripts` de un worker sale con tipo `other` y sin
   * marco, y un `EventSource` con tipo `eventsource`. Ninguno de los dos
   * contaba, y la página que escribía con ellos salía VERDE si no llegaban.
   */
  it.each([
    ["el `importScripts` de un worker (`other`, sin marco)", { url: "http://solo-v6.test/lib.js", tipo: "other", marco: null }, "worker"],
    ["un `EventSource` de la página", { url: "http://solo-v6.test/sse", tipo: "eventsource" }, "pagina"],
  ] as const)("FV-4 — %s que no llega deja la página sin número", async (_caso, pedido, origen) => {
    const { deps, bitacora } = armar(SITIO, { enSegundoPlano: [pedido] });
    expect(await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora)).toEqual(
      falloPor("sin-respuesta", { tipo: pedido.tipo, host: "solo-v6.test", ruta: new URL(pedido.url).pathname, origen })
    );
    expect(bitacora.noLlegaron.map((n) => n.url)).toEqual([pedido.url]);
  });

  it("FV-4 — y un `other` CON marco no cuenta: el `favicon.ico` que Chromium pide por su cuenta no escribe nada", async () => {
    const { deps, bitacora } = armar(SITIO, { enSegundoPlano: [{ url: "/favicon.ico", tipo: "other" }] });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(bitacora.bloqueados).toContainEqual({ url: "http://sitio.test/favicon.ico", motivo: "sin-respuesta" });
    expect(render.estado).toBe("medido");
  });

  /**
   * F3: los dos topes son DISTINTOS a propósito —la página 1 000, los marcos
   * de otro sitio 1 200—, y se afirma en qué pedido corta cada uno. Con los
   * dos en 1 000, cambiar el tope ajeno por el de la página pasaba igual.
   */
  it("los bytes de un marco de otro sitio salen de SU presupuesto, y cada presupuesto corta en su tope", async () => {
    const SEGMENTO = "v".repeat(600);
    const { deps } = armar({
      "http://sitio.test/": { cuerpo: "<p>hola</p>" },
      "http://video.test/seg1": { cuerpo: SEGMENTO },
      "http://video.test/seg2": { cuerpo: SEGMENTO },
      "http://video.test/seg3": { cuerpo: SEGMENTO },
      "http://sitio.test/chunk.js": { cuerpo: "c".repeat(300) },
      "http://sitio.test/chunk2.js": { cuerpo: "d".repeat(800) },
    });
    const bitacora = bitacoraVacia();
    const opciones = { ...OPCIONES_RENDER, maxBytesTotales: 1_000, maxBytesDeOtrosSitios: 1_200 };
    const atender = crearInterceptor(deps, opciones, bitacora, () => 5_000, new AbortController().signal);
    const desenlaces: Record<string, string> = {};
    // Uno por vez, en orden.
    const pedir = (url: string, tipo: string, esDocumentoPrincipal: boolean, urlDelMarco: string | null) =>
      atender({
        url,
        metodo: "GET",
        encabezados: {},
        tipo,
        esDocumentoPrincipal,
        urlDelMarco,
        // La pestaña ya tiene la página confirmada, salvo mientras la pide.
        urlDeLaPagina: esDocumentoPrincipal ? null : "http://sitio.test/",
        continuar: async () => void (desenlaces[url] = "continuado"),
        abortar: async () => void (desenlaces[url] = "abortado"),
        responder: async () => void (desenlaces[url] = "respondido"),
      });
    await pedir("http://sitio.test/", "document", true, null);
    for (const n of [1, 2, 3]) await pedir(`http://video.test/seg${n}`, "xhr", false, "http://video.test/embed");
    await pedir("http://sitio.test/chunk.js", "script", false, "http://sitio.test/");
    // El reproductor gastó el SUYO: 1 200 alcanzan para dos segmentos de 600
    // y no para el tercero. Con el tope de la página (1 000) cortaba en el
    // segundo.
    expect(desenlaces["http://video.test/seg2"]).toBe("respondido");
    expect(desenlaces["http://video.test/seg3"]).toBe("abortado");
    expect(bitacora.bloqueados).toContainEqual({ url: "http://video.test/seg3", motivo: "presupuesto" });
    // ...y el chunk de la página salió con el de la página: con un solo
    // presupuesto, los 1 200 bytes del video lo dejaban `subrecurso-presupuesto`.
    expect(desenlaces["http://sitio.test/chunk.js"]).toBe("respondido");
    expect(bitacora.noLlegaron).toEqual([]);
    // Y la página corta en el SUYO: 11 + 300 + 800 pasan los 1 000 (con el
    // tope ajeno, 1 200, pasaba).
    await pedir("http://sitio.test/chunk2.js", "script", false, "http://sitio.test/");
    expect(desenlaces["http://sitio.test/chunk2.js"]).toBe("abortado");
    expect(bitacora.noLlegaron).toEqual([
      { url: "http://sitio.test/chunk2.js", tipo: "script", motivo: "presupuesto", origen: "pagina" },
    ]);
  });

  it("F3 — los topes de producción: 25 MB la página, 10 MB los marcos de otro sitio, 5 MB cada respuesta", () => {
    expect(OPCIONES_RENDER.maxBytesTotales).toBe(25 * 1024 * 1024);
    expect(OPCIONES_RENDER.maxBytesDeOtrosSitios).toBe(10 * 1024 * 1024);
    expect(OPCIONES_RENDER.maxBytesPorRespuesta).toBe(5 * 1024 * 1024);
  });

  it("F3 — la caché para la pestaña sin JavaScript guarda SÓLO el documento: no los bytes de un reproductor", async () => {
    const { deps } = armar({
      "http://sitio.test/": { cuerpo: "<p>hola</p>" },
      "http://video.test/seg1": { cuerpo: "v".repeat(600) },
      "http://sitio.test/app.js": { cuerpo: "c".repeat(300) },
    });
    const cache: CacheDeRespuestas = new Map();
    const atender = crearInterceptor(deps, OPCIONES_RENDER, bitacoraVacia(), () => 5_000, new AbortController().signal, undefined, {
      guardarEn: cache,
    });
    const pedir = (url: string, tipo: string, esDocumentoPrincipal: boolean, urlDelMarco: string | null) =>
      atender({
        url,
        metodo: "GET",
        encabezados: {},
        tipo,
        esDocumentoPrincipal,
        urlDelMarco,
        urlDeLaPagina: esDocumentoPrincipal ? null : "http://sitio.test/",
        continuar: async () => {},
        abortar: async () => {},
        responder: async () => {},
      });
    await pedir("http://sitio.test/", "document", true, null);
    await pedir("http://video.test/seg1", "xhr", false, "http://video.test/embed");
    await pedir("http://sitio.test/app.js", "script", false, "http://sitio.test/");
    expect([...cache.keys()]).toEqual(["http://sitio.test/"]);
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
    expect(await medirRenderizado("http://sitio.test/", delNuevo.deps)).toEqual(
      falloPor("sin-respuesta", { tipo: "fetch", host: "solo-v6.test", ruta: "/sonda", origen: "mismo-sitio" })
    );
    // Y uno del sitio del PRIMER salto ya es de otro sitio que la página.
    const delViejo = armar(sitio, {
      enSegundoPlano: [{ url: "http://solo-v6.test/sonda", tipo: "fetch", marco: "http://sitio.test/w" }],
    });
    expect((await medirRenderizado("http://sitio.test/", delViejo.deps)).estado).toBe("medido");
  });

  /**
   * FV-1, RED-121-1, F1. Reproducido por la revisión con Chrome 155 y con el
   * headless shell 153: el sitio de la página salía del último PEDIDO de
   * navegación de la pestaña, no del documento que se lee. Una página que
   * manda la pestaña a otro sitio que no se confirma —un 204, una descarga
   * denegada, un `window.stop()`, una navegación que sigue en vuelo— y
   * después hace un `fetch` propio que no llega salía `medido 1249/1249`,
   * punto VERDE y `noLlegaron=[]`. En main, `subrecurso-sin-respuesta`.
   */
  it.each([
    ["un 204", { status: 204 }],
    ["una navegación que sigue en vuelo", { llegaCuando: () => new Promise<void>(() => {}) }],
  ] as const)(
    "una navegación de la PESTAÑA que no se confirma (%s) no cambia el sitio de la página: su `fetch` que no llega la deja sin número",
    async (_caso, destino) => {
      const { deps, bitacora, red } = armar(
        { ...SITIO, "http://otro.test/vacio": destino },
        {
          enSegundoPlano: [
            { url: "http://otro.test/vacio", tipo: "document", principal: true },
            { url: "http://solo-v6.test/sonda", tipo: "fetch" },
          ],
        }
      );
      const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
      // La navegación SALIÓ por el transporte: si no, esto no prueba nada.
      expect(red.pedidos.map((p) => p.url)).toContain("http://otro.test/vacio");
      expect(render).toEqual(falloPor("sin-respuesta", { tipo: "fetch", host: "solo-v6.test", ruta: "/sonda", origen: "pagina" }));
      expect(bitacora.noLlegaron).toEqual([
        { url: "http://solo-v6.test/sonda", tipo: "fetch", motivo: "sin-respuesta", origen: "pagina" },
      ]);
    }
  );

  it("y un pedido de la página que estaba EN VUELO cuando la pestaña intentó irse tampoco se descarta al no llegar", async () => {
    // El `fetch` sale con la página, la pestaña intenta irse a los 1 000 ms y
    // el `fetch` falla a los 3 000. Lo que se decidió al salir no cambia:
    // antes, `bloquear` lo volvía a juzgar contra la navegación nueva.
    const { deps, bitacora } = armar(
      (reloj) => ({
        ...SITIO,
        "http://otro.test/vacio": { status: 204 },
        "http://sitio.test/api/datos": { error: "sin-respuesta", llegaCuando: () => reloj.alcanzar(3_000) },
      }),
      {
        enSegundoPlano: [
          { url: "/api/datos", tipo: "fetch" },
          { url: "http://otro.test/vacio", tipo: "document", principal: true, enMs: 1_000 },
        ],
      }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(bitacora.pedidos.map((p) => p.url)).toContain("http://otro.test/vacio");
    expect(render).toEqual(falloPor("sin-respuesta", { tipo: "fetch", host: "sitio.test", ruta: "/api/datos", origen: "pagina" }));
    expect(bitacora.noLlegaron).toEqual([
      { url: "http://sitio.test/api/datos", tipo: "fetch", motivo: "sin-respuesta", origen: "pagina" },
    ]);
  });

  it("y si el `fetch` LLEGA después de esa navegación, lo que escribe se cuenta: la página sigue siendo la misma, punto ROJO", async () => {
    // El control: la navegación no se confirmó, el documento es el de la
    // página, y el `fetch` que llega escribe en él. Sin esto, los dos casos
    // de arriba podrían ser rojos porque la navegación rompió la medición.
    const { deps, bitacora } = armar(
      { ...SITIO, "http://otro.test/vacio": { status: 204 }, "http://sitio.test/api/datos": { cuerpo: "Datos del negocio. ".repeat(20) } },
      {
        enSegundoPlano: [
          { url: "http://otro.test/vacio", tipo: "document", principal: true },
          { url: "/api/datos", tipo: "fetch" },
        ],
      }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;
    expect(render.caracteres).toBeGreaterThan(textoSinJavaScript(CON_VIDEO) + contarCaracteres(CONTENIDO));
    expect(rojo(render)).toBe("rojo");
  });
});

/**
 * F3: lo que la página abre por fuera del interceptor. MEDIDO por la revisión
 * con Chrome 155: un menú de 619 y un `WebSocket` que escribía 4 499 daban
 * `medido 619/619`, `bloqueados=[]`, `noLlegaron=[]` y VERDE. Y con la regla
 * de RT-4: MEDIDO con el headless shell 153, el `WebSocket` de un marco de
 * otro sitio sale en la misma sesión que el de la página, y no puede decidir.
 */
describe("F3: un WebSocket o un WebTransport que la página abrió por fuera del interceptor", () => {
  const MENU = `<nav>${Array.from({ length: 60 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
  const CONTENIDO = "Contenido del negocio que dibuja el bundle de la página. ".repeat(70);
  const HIBRIDA = `<html><body>${MENU}<main id="app"></main><script src="/app.js"></script></body></html>`;
  const SITIO: Sitio = { "http://sitio.test/": { cuerpo: HIBRIDA }, "http://sitio.test/app.js": { cuerpo: CONTENIDO } };

  it("un WebSocket de la página deja el render sin número: `subrecurso-websocket`, con su detalle sin la query", async () => {
    const { deps, bitacora, navegador } = armar(SITIO, {
      salidasPropias: [{ url: "ws://sitio.test/ws?token=SECRETO", tipo: "websocket" }],
    });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render).toEqual(falloPor("websocket", { tipo: "websocket", host: "sitio.test", ruta: "/ws", origen: "pagina" }));
    expect(JSON.stringify(render)).not.toMatch(/SECRETO/);
    expect(bitacora.salidasPropias).toEqual([
      {
        url: "ws://sitio.test/ws?token=SECRETO",
        tipo: "websocket",
        deUnWorker: false,
        origenDelMarco: "http://sitio.test",
        urlDeLaPagina: "http://sitio.test/",
      },
    ]);
    expect(navegador.registro.cierres).toBe(1);
    expect(contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(HIBRIDA), caracteresRenderizados: render }).estado).toBe(
      "no-medido"
    );
  });

  // El tercer valor es de dónde salió según el detalle.
  it.each([
    ["un worker (Chromium lo avisa en su sesión)", { worker: true }, "worker"],
    ["un contexto que no avisó cuál era (esquivó el envoltorio)", { origen: null }, "marco-desconocido"],
    ["un marco con `sandbox`, de origen opaco", { origen: "null" }, "marco-desconocido"],
    ["un marco de un subdominio del sitio", { origen: "https://chat.sitio.test" }, "mismo-sitio"],
  ] as const)("el de %s también decide", async (_caso, de, origen) => {
    const { deps } = armar(SITIO, { salidasPropias: [{ url: "wss://chat.test/socket", tipo: "websocket", ...de }] });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual(
      falloPor("websocket", { tipo: "websocket", host: "chat.test", ruta: "/socket", origen })
    );
  });

  it("un WebTransport es lo mismo: `subrecurso-webtransport`", async () => {
    const { deps } = armar(SITIO, { salidasPropias: [{ url: "https://sitio.test/wt", tipo: "webtransport" }] });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual(
      falloPor("webtransport", { tipo: "webtransport", host: "sitio.test", ruta: "/wt", origen: "pagina" })
    );
  });

  it("el de un marco de OTRO sitio no decide (RT-4): la página se mide, y con el bundle es ROJA", async () => {
    const { deps, bitacora } = armar(SITIO, {
      salidasPropias: [{ url: "wss://video.test/chat", tipo: "websocket", origen: "https://video.test" }],
    });
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");
    // Chromium lo avisó —si no, esto no prueba nada—, y no decidió.
    expect(bitacora.salidasPropias.map((s) => s.url)).toEqual(["wss://video.test/chat"]);
    expect(contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(HIBRIDA), caracteresRenderizados: render }).estado).toBe("rojo");
  });

  it("el detalle es el PRIMERO que decide, y cuenta los que deciden: el de otro sitio no", async () => {
    const { deps } = armar(SITIO, {
      salidasPropias: [
        { url: "wss://video.test/chat", tipo: "websocket", origen: "https://video.test" },
        { url: "ws://sitio.test/vivo", tipo: "websocket" },
        { url: "ws://sitio.test/del-worker", tipo: "websocket", worker: true },
      ],
    });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual(
      falloPor("websocket", { tipo: "websocket", host: "sitio.test", ruta: "/vivo", origen: "pagina", noLlegaron: 2 })
    );
  });

  it("un pedido que no llegó manda sobre un socket: el código es el del pedido", async () => {
    const { deps } = armar(
      { ...SITIO, "http://sitio.test/app.js": { error: "timeout" } },
      { salidasPropias: [{ url: "ws://sitio.test/vivo", tipo: "websocket" }] }
    );
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual(
      falloPor("timeout", { tipo: "script", host: "sitio.test", ruta: "/app.js", origen: "pagina" })
    );
  });

  it("y un EventSource que LLEGA escribe y se cuenta: no es un socket, pasa por el interceptor", async () => {
    const pagina = { "http://sitio.test/": { cuerpo: `<html><body>${MENU}<main id="app"></main></body></html>` } };
    const llega = armar(
      { ...pagina, "http://sitio.test/eventos": { cuerpo: CONTENIDO } },
      { enSegundoPlano: [{ url: "/eventos", tipo: "eventsource" }] }
    );
    const render = await medirRenderizado("http://sitio.test/", llega.deps);
    expect(render.estado === "medido" && render.caracteres).toBeGreaterThan(contarCaracteres(CONTENIDO));
  });
});

/**
 * El detalle de un `subrecurso-<motivo>`. Con el #121 en producción,
 * https://vulkan-studios.com seguía saliendo `subrecurso-sin-respuesta` desde
 * la red de Vercel, y ni la respuesta ni los logs decían qué pedido faltaba:
 * en la Mac y en un contenedor `lambda/nodejs:24` medía. Ahora el fallo dice
 * cuál —el PRIMERO, el mismo que da el código—, sin la query ni el fragmento
 * de su URL, y cuántos no llegaron.
 */
describe("el fallo dice CUÁL pedido dejó el render sin número", () => {
  const MENU = `<nav>${Array.from({ length: 60 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
  const PAGINA = `<html><body>${MENU}<main id="app"></main></body></html>`;

  it("la ruta sale SIN query ni fragmento: un token de la URL no llega al resultado", async () => {
    const { deps, bitacora } = armar(
      { "http://sitio.test/": { cuerpo: PAGINA } },
      { enSegundoPlano: [{ url: "/api/datos;v=1?token=SECRETO-del-cliente&x=1#SECRETO-del-fragmento", tipo: "fetch" }] }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    // El pedido salió con su query —si no, esto no prueba nada— …
    expect(bitacora.noLlegaron.map((n) => n.url)).toEqual([
      "http://sitio.test/api/datos;v=1?token=SECRETO-del-cliente&x=1#SECRETO-del-fragmento",
    ]);
    // … y el detalle no la trae, ni el fragmento, en ningún campo.
    expect(render).toEqual(falloPor("sin-respuesta", { tipo: "fetch", host: "sitio.test", ruta: "/api/datos;v=1", origen: "pagina" }));
    expect(JSON.stringify(render)).not.toMatch(/SECRETO|token=|#/);
  });

  it("es el PRIMER pedido que no llegó —el mismo que da el código—, y cuenta todos los que no llegaron", async () => {
    // El bundle declarado no llega (timeout) mientras la página se carga; un
    // worker pide después y tampoco le llega (sin-respuesta). Manda el
    // primero: el código es suyo, y el detalle también.
    const { deps, bitacora } = armar(
      {
        "http://sitio.test/": { cuerpo: `<html><body>${MENU}<main id="app"></main><script src="/app.js"></script></body></html>` },
        "http://sitio.test/app.js": { error: "timeout" },
      },
      { enSegundoPlano: [{ url: "http://cdn.test/datos", tipo: "fetch", marco: null }] }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(bitacora.noLlegaron.map((n) => [n.url, n.motivo, n.origen])).toEqual([
      ["http://sitio.test/app.js", "timeout", "pagina"],
      ["http://cdn.test/datos", "sin-respuesta", "worker"],
    ]);
    expect(render).toEqual(
      falloPor("timeout", { tipo: "script", host: "sitio.test", ruta: "/app.js", origen: "pagina", noLlegaron: 2 })
    );
  });

  it(`una ruta larga se corta a ${MAX_RUTA_DEL_DETALLE} caracteres, y se nota que se cortó`, async () => {
    const larga = `/assets/${"segmento-largo/".repeat(20)}chunk.js`;
    expect(larga.length).toBeGreaterThan(MAX_RUTA_DEL_DETALLE);
    const { deps } = armar({ "http://sitio.test/": { cuerpo: PAGINA } }, { enSegundoPlano: [{ url: larga, tipo: "script" }] });
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado === "fallo" && render.detalle?.ruta).toBe(`${larga.slice(0, MAX_RUTA_DEL_DETALLE - 1)}…`);
    // Una de 120 justos no se toca.
    const justa = `/${"r".repeat(MAX_RUTA_DEL_DETALLE - 1)}`;
    const otro = armar({ "http://sitio.test/": { cuerpo: PAGINA } }, { enSegundoPlano: [{ url: justa, tipo: "script" }] });
    const renderJusto = await medirRenderizado("http://sitio.test/", otro.deps);
    expect(renderJusto.estado === "fallo" && renderJusto.detalle?.ruta).toBe(justa);
  });

  it("`subrecurso-pendiente` dice el PRIMERO que seguía en vuelo, y cuenta también los que no llegaron antes", async () => {
    const nunca = () => new Promise<void>(() => {});
    const { deps, bitacora } = armar(
      {
        "http://sitio.test/": { cuerpo: PAGINA },
        "http://sitio.test/api/siempre": { cuerpo: "x", llegaCuando: nunca },
        "http://sitio.test/api/tambien": { cuerpo: "x", llegaCuando: nunca },
        "http://sitio.test/api/cayo": { error: "tls" },
      },
      {
        enSegundoPlano: [
          { url: "/api/cayo", tipo: "fetch" },
          { url: "/api/siempre", tipo: "fetch", marco: "/marco-propio" },
          { url: "/api/tambien", tipo: "xhr" },
        ],
      }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    // Dos en vuelo, en este orden, y uno que no llegó: si no, esto no prueba nada.
    expect([...bitacora.enCamino].map((p) => p.url)).toEqual(["http://sitio.test/api/siempre", "http://sitio.test/api/tambien"]);
    expect(bitacora.noLlegaron.map((n) => n.url)).toEqual(["http://sitio.test/api/cayo"]);
    expect(render).toEqual(
      falloPor("pendiente", { tipo: "fetch", host: "sitio.test", ruta: "/api/siempre", origen: "mismo-sitio", noLlegaron: 3 })
    );
  });

  it("un fallo que NO decidió un pedido no trae detalle: el documento, el navegador, la pestaña sin JavaScript", async () => {
    const caido = armar({ "http://sitio.test/": { status: 503, cuerpo: "caído" } });
    expect(await medirRenderizado("http://sitio.test/", caido.deps)).toEqual({ estado: "fallo", codigo: "http_503" });
    const sinNavegador = armar({ "http://sitio.test/": { cuerpo: PAGINA } }, { arranqueFalla: true });
    expect(await medirRenderizado("http://sitio.test/", sinNavegador.deps)).toEqual({ estado: "fallo", codigo: "sin-navegador" });
    // Y un pedido de otro sitio que no llegó no aparece en ningún lado: la página se midió.
    const ajeno = armar(
      { "http://sitio.test/": { cuerpo: PAGINA } },
      { enSegundoPlano: [{ url: "http://solo-v6.test/sonda", tipo: "fetch", marco: "http://video.test/embed" }] }
    );
    const medido = await medirRenderizado("http://sitio.test/", ajeno.deps);
    expect(medido.estado).toBe("medido");
    expect(medido).not.toHaveProperty("detalle");
  });
});

/**
 * RED-121-2 y RED-121-3. Reproducido por la revisión con Chrome 155 y el
 * headless shell 153: un marco de otro sitio con 30 `fetch` EN PARALELO de
 * 4,5 MB bajó 40,5 MB (36 con el headless shell) contra 10 MB de
 * presupuesto, porque cada pedido miraba lo que quedaba antes de salir y
 * nadie lo descontaba hasta que llegaba. Y la rama de los marcos de otro
 * sitio —su examen, su plazo, su tope de bytes— no tenía un test que se
 * pusiera rojo si se rompía.
 */
describe("RED-121-2 y RED-121-3: los presupuestos y los plazos valen también para lo que piden los marcos de otro sitio", () => {
  /** N pedidos que el transporte tiene EN VUELO a la vez: ninguno termina hasta que salieron todos. */
  function enParalelo(urls: string[], cuerpo: string, porPartes?: number) {
    let salieron = 0;
    let todos!: () => void;
    const juntos = new Promise<void>((listo) => (todos = listo));
    const llegaCuando = () => {
      salieron += 1;
      if (salieron === urls.length) todos();
      return juntos;
    };
    const sitio: Sitio = { "http://sitio.test/": { cuerpo: "<p>hola</p>" } };
    for (const u of urls) sitio[u] = { cuerpo, llegaCuando };
    const red = transporteDoble(sitio, { porPartes });
    const deps: DependenciasRender = {
      abrirNavegador: navegadorDoble().abrirNavegador,
      transporte: red.transporte,
      resolver: resolvedorDoble(DNS).resolver,
    };
    return { deps, red };
  }

  function pedidoA(
    url: string,
    tipo: string,
    urlDelMarco: string | null,
    desenlaces: Record<string, number | "abortado">
  ): PedidoDelNavegador {
    return {
      url,
      metodo: "GET",
      encabezados: {},
      tipo,
      esDocumentoPrincipal: false,
      urlDelMarco,
      urlDeLaPagina: "http://sitio.test/",
      continuar: async () => {},
      abortar: async () => void (desenlaces[url] = "abortado"),
      responder: async (r) => void (desenlaces[url] = r.cuerpo.length),
    };
  }

  const entregados = (desenlaces: Record<string, number | "abortado">) =>
    Object.values(desenlaces).reduce<number>((suma, d) => suma + (d === "abortado" ? 0 : d), 0);

  it.each([
    ["descontado parte por parte, como el transporte de producción", 100],
    ["un transporte que no descuenta: el interceptor descuenta al entregar", undefined],
  ] as const)(
    "30 pedidos EN PARALELO de un marco de otro sitio no bajan ni entregan más que su tope (%s)",
    async (_caso, porPartes) => {
      const urls = Array.from({ length: 30 }, (_, i) => `http://video.test/seg${i}`);
      const { deps, red } = enParalelo(urls, "v".repeat(450), porPartes);
      const bitacora = bitacoraVacia();
      // Los 30 a la vez: los turnos de SEC-A2 son otra garantía (abajo), y acá
      // lo que se prueba es el presupuesto de bytes con todos en vuelo.
      const opciones = {
        ...OPCIONES_RENDER,
        maxBytesPorRespuesta: 500,
        maxBytesDeOtrosSitios: 1_000,
        maxBytesTotales: 1_000_000,
        maxConcurrencia: 30,
      };
      const atender = crearInterceptor(deps, opciones, bitacora, () => 5_000, new AbortController().signal);
      const desenlaces: Record<string, number | "abortado"> = {};
      await Promise.all(urls.map((u) => atender(pedidoA(u, "xhr", "http://video.test/embed", desenlaces))));
      // Salieron TODOS al transporte —si no, esto no prueba el paralelo—…
      expect(red.pedidos.length).toBe(30);
      // …y entre todos no se entregó ni se bajó más que el tope ajeno. Antes:
      // 30 × 450 = 13 500 entregados contra 1 000.
      expect(entregados(desenlaces)).toBeLessThanOrEqual(1_000);
      if (porPartes) expect(Object.values(red.bajados).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1_000);
      expect(bitacora.bloqueados.filter((b) => b.motivo === "presupuesto").length).toBeGreaterThan(0);
      // Lo de otro sitio no decide: nada en `noLlegaron`.
      expect(bitacora.noLlegaron).toEqual([]);
    }
  );

  it.each([
    ["parte por parte", 100],
    ["al entregar", undefined],
  ] as const)("y lo mismo con el presupuesto de la PÁGINA (%s): lo que no cupo es `presupuesto` en `noLlegaron`", async (_caso, porPartes) => {
    const urls = Array.from({ length: 30 }, (_, i) => `http://sitio.test/chunk${i}.js`);
    const { deps, red } = enParalelo(urls, "c".repeat(450), porPartes);
    const bitacora = bitacoraVacia();
    const opciones = {
      ...OPCIONES_RENDER,
      maxBytesPorRespuesta: 500,
      maxBytesTotales: 1_000,
      maxBytesDeOtrosSitios: 1_000_000,
      maxConcurrencia: 30,
    };
    const atender = crearInterceptor(deps, opciones, bitacora, () => 5_000, new AbortController().signal);
    const desenlaces: Record<string, number | "abortado"> = {};
    await Promise.all(urls.map((u) => atender(pedidoA(u, "script", "http://sitio.test/", desenlaces))));
    expect(red.pedidos.length).toBe(30);
    expect(entregados(desenlaces)).toBeLessThanOrEqual(1_000);
    if (porPartes) expect(Object.values(red.bajados).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1_000);
    // Los de la página que no cupieron NO LLEGARON: la página queda sin número.
    expect(bitacora.noLlegaron.length).toBeGreaterThan(0);
    expect(new Set(bitacora.noLlegaron.map((n) => n.motivo))).toEqual(new Set(["presupuesto"]));
  });

  it("RED-121-3 — un pedido de un marco de otro sitio sale con el plazo que QUEDA y con los bytes que le quedan a SU presupuesto", async () => {
    const vistos: PedidoHttp[] = [];
    const deps: DependenciasRender = {
      abrirNavegador: navegadorDoble().abrirNavegador,
      // Un origen que no termina nunca: lo que lo corta es el plazo que el
      // interceptor le da al transporte.
      transporte: async (p) => {
        vistos.push(p);
        if (p.url.endsWith("/sin-fin")) return await new Promise(() => {});
        return { tipo: "respuesta", status: 200, encabezados: {}, cuerpo: Buffer.alloc(900, 118) };
      },
      resolver: resolvedorDoble(DNS).resolver,
    };
    const opciones = { ...OPCIONES_RENDER, plazoPorPedidoMs: 8_000, maxBytesPorRespuesta: 5_000, maxBytesDeOtrosSitios: 1_200 };
    const atender = crearInterceptor(deps, opciones, bitacoraVacia(), () => 3_000, new AbortController().signal);
    const desenlaces: Record<string, number | "abortado"> = {};
    await atender(pedidoA("http://video.test/seg", "xhr", "http://video.test/embed", desenlaces));
    void atender(pedidoA("http://video.test/sin-fin", "xhr", "http://video.test/embed", desenlaces));
    await new Promise((listo) => setImmediate(listo));
    const sinFin = vistos.find((p) => p.url === "http://video.test/sin-fin");
    expect(sinFin).toBeDefined();
    if (!sinFin) return;
    // El plazo: el de cada pedido, recortado a lo que le queda a la medición.
    expect(sinFin.timeoutMs).toBeLessThanOrEqual(3_000);
    // Los bytes: lo que le queda al presupuesto de OTROS sitios (1 200 − 900),
    // no el de la página ni el tope de una respuesta.
    expect(sinFin.maxBytes).toBeLessThanOrEqual(300);
    // Y el presupuesto compartido no le deja bajar más que eso.
    expect(sinFin.presupuesto?.(301)).toBe(false);
    expect(sinFin.presupuesto?.(300)).toBe(true);
    expect(sinFin.presupuesto?.(1)).toBe(false);
  });

  it("RED-121-3 — y un pedido de un marco de otro sitio a una red que no es pública no sale: el mismo examen que la página", async () => {
    const { deps, red } = armar({ "http://sitio.test/": { cuerpo: "<p>hola</p>" } });
    const bitacora = bitacoraVacia();
    const atender = crearInterceptor(deps, OPCIONES_RENDER, bitacora, () => 5_000, new AbortController().signal);
    const desenlaces: Record<string, number | "abortado"> = {};
    const hostiles = [
      "http://127.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.7/",
      "http://interno.test/",
      "http://mixto.test/",
      "http://metadata.test/",
      "http://[::1]/",
    ];
    for (const url of hostiles) {
      await atender(pedidoA(url, "fetch", "http://video.test/embed", desenlaces));
      await atender(pedidoA(url, "script", "http://video.test/embed", desenlaces));
    }
    expect(red.pedidos).toEqual([]);
    expect(bitacora.pedidos).toEqual([]);
    for (const url of hostiles) expect(desenlaces[url]).toBe("abortado");
    expect(new Set(bitacora.bloqueados.map((b) => b.motivo))).toEqual(new Set(["red-no-publica"]));
  });
});

/**
 * SEC-A2: el render no es un relé. MEDIDO por la revisión con Chrome 155 y las
 * banderas de producción: una página con 3 000 `fetch` no-cors a un tercero y
 * un `POST` simple le hizo `pedidosAlTercero=3000 picoConcurrente=580` y el
 * `POST` con `body=datos-de-la-pagina`, y el render salió «medido». Con 10
 * auditorías por minuto e instancia, unos 30 000 pedidos por minuto desde las
 * IP de la plataforma. Y con la regla de RT-4, cada presupuesto tiene sus
 * topes: lo que piden los marcos de otro sitio no le gasta a la página ni los
 * pedidos, ni los `POST`, ni los turnos.
 */
describe("SEC-A2: el render no es un relé: tope de pedidos, de concurrencia y de POST a otros sitios", () => {
  const PAGINA = { "http://sitio.test/": { cuerpo: "<html><body><p>hola</p></body></html>" } };

  it("los topes de producción: 200 pedidos y 16 a la vez por presupuesto, 20 POST ajenos de hasta 64 KB", () => {
    expect(OPCIONES_RENDER.maxPedidos).toBe(200);
    expect(OPCIONES_RENDER.maxConcurrencia).toBe(16);
    expect(OPCIONES_RENDER.maxPostsAjenos).toBe(20);
    expect(OPCIONES_RENDER.maxCuerpoAjeno).toBe(64 * 1024);
  });

  it("3 000 pedidos de la página a un tercero: salen `maxPedidos` (el documento incluido), y el resto no llegó", async () => {
    // Cuerpos vacíos: lo que se mide es cuántos salen, no el texto (con texto,
    // el DOM del doble crece mientras llegan y la lectura no ve quietud).
    const urls = Array.from({ length: 3_000 }, (_, i) => `http://cdn.test/p${i}`);
    const { deps, red, bitacora } = armar(
      { ...PAGINA, ...Object.fromEntries(urls.map((u) => [u, { cuerpo: "" }])) },
      { enSegundoPlano: urls.map((url) => ({ url, tipo: "fetch" })) }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(red.pedidos).toHaveLength(OPCIONES_RENDER.maxPedidos);
    expect(bitacora.noLlegaron).toHaveLength(3_000 - (OPCIONES_RENDER.maxPedidos - 1));
    expect(render).toEqual(
      falloPor("presupuesto", { tipo: "fetch", host: "cdn.test", ruta: "/p199", origen: "pagina", noLlegaron: 2_801 })
    );
  });

  it("como mucho `maxConcurrencia` pedidos a la vez: el resto ESPERA su turno, no se pierde, y la página se mide", async () => {
    const urls = Array.from({ length: 100 }, (_, i) => `http://cdn.test/c${i}`);
    const { deps, bitacora } = armar(
      (reloj) => ({ ...PAGINA, ...Object.fromEntries(urls.map((u) => [u, { cuerpo: "", llegaCuando: () => reloj.alcanzar(500) }])) }),
      { enSegundoPlano: urls.map((url) => ({ url, tipo: "fetch" })) }
    );
    let enCurso = 0;
    let pico = 0;
    const transporte = deps.transporte;
    deps.transporte = async (pedido) => {
      enCurso += 1;
      pico = Math.max(pico, enCurso);
      try {
        return await transporte(pedido);
      } finally {
        enCurso -= 1;
      }
    };
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    expect(render.estado).toBe("medido");
    expect(pico).toBe(OPCIONES_RENDER.maxConcurrencia);
    expect(bitacora.picoConcurrente).toEqual({ pagina: OPCIONES_RENDER.maxConcurrencia, deOtrosSitios: 0 });
    expect(bitacora.pedidos).toHaveLength(101);
  });

  it("un pedido que ESPERA turno está en vuelo: la lectura lo espera, y lo que trae se cuenta —ROJO—", async () => {
    // Un turno solo, ocupado 5 s por una hoja de estilos —que no escribe
    // texto ni cuenta en `enVuelo`—, y el bundle detrás, esperando. Si la
    // espera no contara, la lectura terminaba a los 2 s con el menú solo: VERDE.
    const MENU = `<nav>${Array.from({ length: 60 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
    const CONTENIDO = "Contenido del negocio que dibuja el bundle de la página. ".repeat(70);
    const html = `<html><body>${MENU}<main id="app"></main></body></html>`;
    const { deps, red } = armar(
      (reloj) => ({
        "http://sitio.test/": { cuerpo: html },
        "http://sitio.test/estilo.css": { cuerpo: "p{}", llegaCuando: () => reloj.alcanzar(5_000) },
        "http://sitio.test/chunk.js": { cuerpo: CONTENIDO },
      }),
      {
        enSegundoPlano: [
          { url: "/estilo.css", tipo: "stylesheet" },
          { url: "/chunk.js", tipo: "script" },
        ],
      }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, { ...OPCIONES_RENDER, maxConcurrencia: 1 });
    expect(red.pedidos.map((p) => p.url)).toContain("http://sitio.test/chunk.js");
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;
    expect(render.caracteres).toBeGreaterThan(contarCaracteres(CONTENIDO));
    expect(contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(html), caracteresRenderizados: render }).estado).toBe("rojo");
  });

  it("si el presupuesto de tiempo vence, lo que esperaba turno se aborta como `presupuesto`: no queda colgado", async () => {
    const { deps } = armar({});
    deps.transporte = () => new Promise(() => {});
    const bitacora = bitacoraVacia();
    const corte = new AbortController();
    const atender = crearInterceptor(deps, { ...OPCIONES_RENDER, maxConcurrencia: 1 }, bitacora, () => 5_000, corte.signal);
    const desenlaces: Record<string, string> = {};
    const pedido = (url: string): PedidoDelNavegador => ({
      url,
      metodo: "GET",
      encabezados: {},
      tipo: "script",
      esDocumentoPrincipal: false,
      urlDelMarco: "http://sitio.test/",
      urlDeLaPagina: "http://sitio.test/",
      continuar: async () => {},
      abortar: async () => void (desenlaces[url] = "abortado"),
      responder: async () => void (desenlaces[url] = "respondido"),
    });
    void atender(pedido("http://sitio.test/ocupa.js"));
    const espera = atender(pedido("http://sitio.test/espera.js"));
    await new Promise((listo) => setImmediate(listo));
    // Esperando turno, y en vuelo: si no, esto no prueba nada.
    expect(bitacora.enVuelo).toBe(2);
    corte.abort();
    const listo = await Promise.race([espera.then(() => "listo"), new Promise((r) => setTimeout(() => r("colgado"), 1_000))]);
    expect(listo).toBe("listo");
    expect(desenlaces["http://sitio.test/espera.js"]).toBe("abortado");
    expect(bitacora.noLlegaron).toEqual([
      { url: "http://sitio.test/espera.js", tipo: "script", motivo: "presupuesto", origen: "pagina" },
    ]);
  });

  it("POST a OTRO sitio: como mucho `maxPostsAjenos`, con cuerpo acotado; un `ping` no sale nunca", async () => {
    const posts = Array.from({ length: 25 }, () => ({ url: "http://cdn.test/collect", tipo: "fetch", metodo: "POST", cuerpo: "datos-de-la-pagina" }));
    const { deps, red, bitacora } = armar(
      { ...PAGINA, "http://cdn.test/collect": { cuerpo: "ok" } },
      { enSegundoPlano: [...posts, { url: "http://cdn.test/beacon", tipo: "ping", metodo: "POST", cuerpo: "x" }] }
    );
    const render = await medirRenderizado("http://sitio.test/", deps, OPCIONES_RENDER, bitacora);
    const alTercero = red.pedidos.filter((p) => p.url.startsWith("http://cdn.test/"));
    expect(alTercero).toHaveLength(OPCIONES_RENDER.maxPostsAjenos);
    expect(alTercero.every((p) => p.metodo === "POST" && p.cuerpo === "datos-de-la-pagina")).toBe(true);
    expect(render).toEqual(falloPor("presupuesto", { tipo: "fetch", host: "cdn.test", ruta: "/collect", origen: "pagina", noLlegaron: 5 }));
    expect(bitacora.bloqueados).toContainEqual({ url: "http://cdn.test/beacon", motivo: "sin-texto" });

    // Un cuerpo de más de `maxCuerpoAjeno` no sale, aunque sea el primero.
    const grande = armar(
      { ...PAGINA, "http://cdn.test/collect": { cuerpo: "ok" } },
      { enSegundoPlano: [{ url: "http://cdn.test/collect", tipo: "xhr", metodo: "POST", cuerpo: "x".repeat(OPCIONES_RENDER.maxCuerpoAjeno + 1) }] }
    );
    expect(await medirRenderizado("http://sitio.test/", grande.deps)).toEqual(
      falloPor("presupuesto", { tipo: "xhr", host: "cdn.test", ruta: "/collect", origen: "pagina" })
    );
    expect(grande.red.pedidos.map((p) => p.url)).toEqual(["http://sitio.test/"]);
    // Y uno de `maxCuerpoAjeno` justos, sí.
    const justo = armar(
      { ...PAGINA, "http://cdn.test/collect": { cuerpo: "ok" } },
      { enSegundoPlano: [{ url: "http://cdn.test/collect", tipo: "xhr", metodo: "POST", cuerpo: "x".repeat(OPCIONES_RENDER.maxCuerpoAjeno) }] }
    );
    expect((await medirRenderizado("http://sitio.test/", justo.deps)).estado).toBe("medido");
  });

  it("POST al MISMO sitio —el nombre del documento o un subdominio suyo— no tiene ese tope: GraphQL lee con POST", async () => {
    const posts = Array.from({ length: 25 }, (_, i) => ({
      url: i % 2 === 0 ? "http://api.sitio.test/graphql" : "/graphql",
      tipo: "fetch",
      metodo: "POST",
      cuerpo: `{"query":"{ pagina(id: ${i}) { texto } }"}`,
    }));
    const { deps, red } = armar(
      { ...PAGINA, "http://api.sitio.test/graphql": { cuerpo: "texto" }, "http://sitio.test/graphql": { cuerpo: "texto" } },
      { enSegundoPlano: posts }
    );
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    expect(red.pedidos.filter((p) => p.metodo === "POST")).toHaveLength(25);
  });

  it("«el mismo sitio» nunca SUBE de nivel: `otro.app.test` no es del sitio de `mio.app.test`", async () => {
    const opciones = { ...OPCIONES_RENDER, maxPostsAjenos: 0 };
    const { deps, red } = armar(
      {
        "http://mio.app.test/": { cuerpo: "<p>hola</p>" },
        "http://mio.app.test/api": { cuerpo: "propio" },
        "http://otro.app.test/api": { cuerpo: "ajeno" },
      },
      {
        enSegundoPlano: [
          { url: "http://mio.app.test/api", tipo: "xhr", metodo: "POST", cuerpo: "a" },
          { url: "http://otro.app.test/api", tipo: "ping", metodo: "GET" },
          { url: "http://otro.app.test/api", tipo: "xhr", metodo: "POST", cuerpo: "b" },
        ],
      }
    );
    expect(await medirRenderizado("http://mio.app.test/", deps, opciones)).toEqual(
      falloPor("presupuesto", { tipo: "xhr", host: "otro.app.test", ruta: "/api", origen: "pagina" })
    );
    expect(red.pedidos.map((p) => `${p.metodo} ${p.url}`)).toEqual(["GET http://mio.app.test/", "POST http://mio.app.test/api"]);
  });

  /** Un pedido al interceptor, uno por vez, con su desenlace anotado. */
  function pedidor(atender: (p: PedidoDelNavegador) => Promise<void>, desenlaces: Record<string, string>) {
    return (
      url: string,
      urlDelMarco: string | null,
      opciones: {
        tipo?: string;
        metodo?: string;
        cuerpo?: string;
        principal?: boolean;
        urlDeLaPagina?: string | null;
        encabezados?: Record<string, string>;
      } = {}
    ) =>
      atender({
        url,
        metodo: opciones.metodo ?? "GET",
        encabezados: opciones.encabezados ?? {},
        ...(opciones.cuerpo !== undefined ? { cuerpo: opciones.cuerpo } : {}),
        tipo: opciones.tipo ?? (opciones.principal ? "document" : "xhr"),
        esDocumentoPrincipal: opciones.principal === true,
        urlDelMarco,
        urlDeLaPagina: opciones.urlDeLaPagina !== undefined ? opciones.urlDeLaPagina : opciones.principal ? null : "http://sitio.test/",
        continuar: async () => void (desenlaces[url] = "continuado"),
        abortar: async () => void (desenlaces[url] = "abortado"),
        responder: async () => void (desenlaces[url] = "respondido"),
      });
  }

  it("sin documento confirmado todavía, todo POST es ajeno: no hay sitio contra el cual eximirlo", async () => {
    const { deps } = armar({ "http://sitio.test/api": { cuerpo: "ok" }, "http://sitio.test/api?2": { cuerpo: "ok" } });
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxPostsAjenos: 0 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    await pedir("http://sitio.test/api", "about:blank", { metodo: "POST", cuerpo: "x", urlDeLaPagina: "about:blank" });
    expect(desenlaces["http://sitio.test/api"]).toBe("abortado");
    expect(bitacora.bloqueados).toContainEqual({ url: "http://sitio.test/api", motivo: "presupuesto" });
    // Con la página confirmada, el mismo POST es del sitio, y sale.
    await pedir("http://sitio.test/api?2", "http://sitio.test/", { metodo: "POST", cuerpo: "x" });
    expect(desenlaces["http://sitio.test/api?2"]).toBe("respondido");
  });

  it("los pedidos de un marco de otro sitio salen de SU tope: los del reproductor no le quitan ninguno a la página", async () => {
    const { deps } = armar({
      "http://sitio.test/": { cuerpo: "<p>hola</p>" },
      "http://video.test/seg1": { cuerpo: "v" },
      "http://video.test/seg2": { cuerpo: "v" },
      "http://video.test/seg3": { cuerpo: "v" },
      "http://sitio.test/chunk.js": { cuerpo: "c" },
      "http://sitio.test/chunk2.js": { cuerpo: "d" },
    });
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxPedidos: 2 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    await pedir("http://sitio.test/", null, { principal: true });
    for (const n of [1, 2, 3]) await pedir(`http://video.test/seg${n}`, "http://video.test/embed");
    // El reproductor gastó los SUYOS: dos, y el tercero no sale y no decide.
    expect(desenlaces["http://video.test/seg2"]).toBe("respondido");
    expect(desenlaces["http://video.test/seg3"]).toBe("abortado");
    expect(bitacora.bloqueados).toContainEqual({ url: "http://video.test/seg3", motivo: "presupuesto" });
    expect(bitacora.noLlegaron).toEqual([]);
    // La página tiene los suyos enteros: el documento y un chunk. Con un solo
    // tope, el chunk era `presupuesto` y la página quedaba sin número.
    await pedir("http://sitio.test/chunk.js", "http://sitio.test/", { tipo: "script" });
    expect(desenlaces["http://sitio.test/chunk.js"]).toBe("respondido");
    await pedir("http://sitio.test/chunk2.js", "http://sitio.test/", { tipo: "script" });
    expect(desenlaces["http://sitio.test/chunk2.js"]).toBe("abortado");
    expect(bitacora.noLlegaron).toEqual([
      { url: "http://sitio.test/chunk2.js", tipo: "script", motivo: "presupuesto", origen: "pagina" },
    ]);
  });

  it("y sus POST a otros sitios también: la analítica de un reproductor no le gasta el tope a la de la página", async () => {
    // Los `?2` ESTÁN en el sitio del doble (R7-SEC-A2): sin ellos, el doble
    // contestaba `sin-respuesta` y se abortaban con tope o sin él. Medido por
    // la revisión: sin el tope de los marcos de otro sitio, sin el tope para
    // lo que no escribe, o juzgando el POST contra el marco y no contra el
    // documento, este test seguía verde.
    const { deps } = armar({
      "http://sitio.test/": { cuerpo: "<p>hola</p>" },
      "http://video.test/log": { cuerpo: "ok" },
      "http://video.test/log?2": { cuerpo: "ok" },
      "http://cdn.test/collect": { cuerpo: "ok" },
      "http://cdn.test/collect?2": { cuerpo: "ok" },
    });
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxPostsAjenos: 1 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    await pedir("http://sitio.test/", null, { principal: true });
    await pedir("http://video.test/log", "http://video.test/embed", { metodo: "POST", cuerpo: "1" });
    expect(desenlaces["http://video.test/log"]).toBe("respondido");
    await pedir("http://video.test/log?2", "http://video.test/embed", { metodo: "POST", cuerpo: "2" });
    expect(desenlaces["http://video.test/log?2"]).toBe("abortado");
    // El de la página sale: con un solo tope, era `presupuesto`.
    await pedir("http://cdn.test/collect", "http://sitio.test/", { metodo: "POST", cuerpo: "3" });
    expect(desenlaces["http://cdn.test/collect"]).toBe("respondido");
    await pedir("http://cdn.test/collect?2", "http://sitio.test/", { metodo: "POST", cuerpo: "4" });
    expect(desenlaces["http://cdn.test/collect?2"]).toBe("abortado");
    // Los dos, por el TOPE: no porque el doble no los tuviera.
    expect(bitacora.bloqueados).toEqual([
      { url: "http://video.test/log?2", motivo: "presupuesto" },
      { url: "http://cdn.test/collect?2", motivo: "presupuesto" },
    ]);
    expect(bitacora.noLlegaron).toEqual([
      { url: "http://cdn.test/collect?2", tipo: "xhr", motivo: "presupuesto", origen: "pagina" },
    ]);
  });

  it("R7-SEC-A2 — «el mismo sitio» es por rótulos, no por sufijo: `xsitio.test` NO es del sitio de `sitio.test`", async () => {
    // Medido por la revisión con Chrome 155: con `h.endsWith(base)` sin el
    // punto, de 25 POST de sitio.test a xsitio.test llegaban los 25, un relé
    // sin tope hacia cualquier dominio que termine igual.
    const { deps, red } = armar({ "http://xsitio.test/api": { cuerpo: "ajeno" }, "http://api.sitio.test/api": { cuerpo: "propio" } });
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxPostsAjenos: 0 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    await pedir("http://xsitio.test/api", "http://sitio.test/", { metodo: "POST", cuerpo: "x" });
    expect(desenlaces["http://xsitio.test/api"]).toBe("abortado");
    expect(bitacora.bloqueados).toEqual([{ url: "http://xsitio.test/api", motivo: "presupuesto" }]);
    // Anti-vacuidad: un subdominio de verdad sí es del sitio, con el mismo tope en cero.
    await pedir("http://api.sitio.test/api", "http://sitio.test/", { metodo: "POST", cuerpo: "x" });
    expect(desenlaces["http://api.sitio.test/api"]).toBe("respondido");
    expect(red.pedidos.map((p) => `${p.metodo} ${p.url}`)).toEqual(["POST http://api.sitio.test/api"]);
  });

  it("R7-SEC-A2 — con el documento en `www.sitio.test`, `api.sitio.test` y `sitio.test` son del sitio: se le saca el `www.`", async () => {
    const { deps, red } = armar({
      "http://api.sitio.test/graphql": { cuerpo: "texto" },
      "http://sitio.test/graphql": { cuerpo: "texto" },
      "http://xsitio.test/graphql": { cuerpo: "ajeno" },
    });
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxPostsAjenos: 0 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    const enWww = { metodo: "POST", cuerpo: "{}", tipo: "fetch", urlDeLaPagina: "http://www.sitio.test/" };
    await pedir("http://api.sitio.test/graphql", "http://www.sitio.test/", enWww);
    await pedir("http://sitio.test/graphql", "http://www.sitio.test/", enWww);
    expect(desenlaces["http://api.sitio.test/graphql"]).toBe("respondido");
    expect(desenlaces["http://sitio.test/graphql"]).toBe("respondido");
    // Sacarle el `www.` no abre los nombres que sólo TERMINAN igual.
    await pedir("http://xsitio.test/graphql", "http://www.sitio.test/", enWww);
    expect(desenlaces["http://xsitio.test/graphql"]).toBe("abortado");
    expect(bitacora.noLlegaron).toEqual([
      { url: "http://xsitio.test/graphql", tipo: "fetch", motivo: "presupuesto", origen: "pagina" },
    ]);
    expect(red.pedidos.map((p) => p.url)).toEqual(["http://api.sitio.test/graphql", "http://sitio.test/graphql"]);
  });

  it("R7-SEC-A2 — un POST cuenta para `maxPedidos`, del sitio o ajeno: no es un pedido gratis", async () => {
    const { deps, red } = armar({
      "http://sitio.test/": { cuerpo: "<p>hola</p>" },
      "http://sitio.test/graphql": { cuerpo: "texto" },
      "http://sitio.test/graphql?2": { cuerpo: "texto" },
      "http://sitio.test/chunk.js": { cuerpo: "c" },
      "http://sitio.test/chunk2.js": { cuerpo: "d" },
    });
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxPedidos: 3 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    await pedir("http://sitio.test/", null, { principal: true });
    await pedir("http://sitio.test/graphql", "http://sitio.test/", { metodo: "POST", cuerpo: "{}", tipo: "fetch" });
    await pedir("http://sitio.test/chunk.js", "http://sitio.test/", { tipo: "script" });
    // Tres: el documento, el POST y el chunk. Lo que sigue, POST o GET, ya no sale.
    await pedir("http://sitio.test/graphql?2", "http://sitio.test/", { metodo: "POST", cuerpo: "{}", tipo: "fetch" });
    await pedir("http://sitio.test/chunk2.js", "http://sitio.test/", { tipo: "script" });
    expect(desenlaces).toMatchObject({
      "http://sitio.test/graphql": "respondido",
      "http://sitio.test/chunk.js": "respondido",
      "http://sitio.test/graphql?2": "abortado",
      "http://sitio.test/chunk2.js": "abortado",
    });
    expect(red.pedidos).toHaveLength(3);
    expect(bitacora.noLlegaron.map((n) => `${n.url} ${n.motivo}`)).toEqual([
      "http://sitio.test/graphql?2 presupuesto",
      "http://sitio.test/chunk2.js presupuesto",
    ]);
  });

  /**
   * CSP-SIN-TEXTO-MUERTO: `SIN_TEXTO` nombraba `csp_violation_report`, que
   * ningún Chromium dice. MEDIDO por la revisión con Chrome 155: un reporte
   * de `report-uri` llega al interceptor como `other POST`, salía al tercero
   * y le gastaba a la página sus 20 `POST` ajenos; el `fetch` con el
   * contenido que venía después quedaba `subrecurso-presupuesto`.
   */
  it("CSP — un reporte del navegador no sale ni gasta: `other POST` con `application/csp-report` o `reports+json` es `sin-texto`", async () => {
    const { deps, red } = armar({ "http://tercero.test/csp-report": { cuerpo: "ok" }, "http://cdn.test/graphql": { cuerpo: "contenido" } });
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxPostsAjenos: 1 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    const reportes = [
      ["http://tercero.test/csp-report", { "content-type": "application/csp-report" }],
      ["http://tercero.test/csp-report?2", { "Content-Type": "application/csp-report; charset=utf-8" }],
      ["http://tercero.test/csp-report?3", { "content-type": "Application/Reports+JSON" }],
    ] as const;
    for (const [url, encabezados] of reportes) {
      await pedir(url, "http://sitio.test/", { tipo: "other", metodo: "POST", cuerpo: '{"csp-report":{}}', encabezados });
      expect(desenlaces[url], url).toBe("abortado");
    }
    // El tipo de CDP, como lo da puppeteer, también; sin `content-type`.
    await pedir("http://tercero.test/csp-report?4", "http://sitio.test/", { tipo: "cspviolationreport", metodo: "POST", cuerpo: "{}" });
    expect(desenlaces["http://tercero.test/csp-report?4"]).toBe("abortado");
    expect(bitacora.bloqueados).toEqual(
      ["", "?2", "?3", "?4"].map((q) => ({ url: `http://tercero.test/csp-report${q}`, motivo: "sin-texto" }))
    );
    // Ninguno salió, y el único `POST` ajeno sigue libre para lo que la página escribe.
    await pedir("http://cdn.test/graphql", "http://sitio.test/", { tipo: "fetch", metodo: "POST", cuerpo: "{}" });
    expect(desenlaces["http://cdn.test/graphql"]).toBe("respondido");
    expect(red.pedidos.map((p) => p.url)).toEqual(["http://cdn.test/graphql"]);
    expect(bitacora.noLlegaron).toEqual([]);
  });

  it("CSP — lo que NO es un reporte sigue su camino: un `other POST` sin ese `content-type`, y un `fetch` de la página que lo trae", async () => {
    const { deps, red } = armar({
      "http://tercero.test/log": { cuerpo: "ok" },
      "http://tercero.test/log?2": { cuerpo: "ok" },
      "http://cdn.test/datos": { cuerpo: "contenido" },
    });
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxPostsAjenos: 1 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    // Un `other POST` con otro cuerpo gasta el tope como cualquier POST ajeno.
    await pedir("http://tercero.test/log", "http://sitio.test/", { tipo: "other", metodo: "POST", cuerpo: "x", encabezados: { "content-type": "text/plain" } });
    expect(desenlaces["http://tercero.test/log"]).toBe("respondido");
    await pedir("http://tercero.test/log?2", "http://sitio.test/", { tipo: "other", metodo: "POST", cuerpo: "x", encabezados: { "content-type": "text/plain" } });
    expect(desenlaces["http://tercero.test/log?2"]).toBe("abortado");
    // Un `fetch` lo arma la página y lee la respuesta: con `application/csp-report`
    // no se vuelve un reporte. Si decide y no sale, NO LLEGÓ (F2), no `sin-texto`.
    await pedir("http://cdn.test/datos", "http://sitio.test/", {
      tipo: "fetch",
      metodo: "POST",
      cuerpo: "{}",
      encabezados: { "content-type": "application/csp-report" },
    });
    expect(desenlaces["http://cdn.test/datos"]).toBe("abortado");
    expect(bitacora.bloqueados).toEqual([
      { url: "http://tercero.test/log?2", motivo: "presupuesto" },
      { url: "http://cdn.test/datos", motivo: "presupuesto" },
    ]);
    expect(bitacora.noLlegaron).toEqual([{ url: "http://cdn.test/datos", tipo: "fetch", motivo: "presupuesto", origen: "pagina" }]);
    expect(red.pedidos.map((p) => p.url)).toEqual(["http://tercero.test/log"]);
  });

  it("y sus turnos: un reproductor con todos los suyos ocupados no deja esperando a la página", async () => {
    const { deps } = armar({ "http://sitio.test/": { cuerpo: "<p>hola</p>" }, "http://sitio.test/chunk.js": { cuerpo: "c" } });
    const transporte = deps.transporte;
    // Los segmentos del reproductor no terminan nunca.
    deps.transporte = (p) => (p.url.startsWith("http://video.test/") ? new Promise(() => {}) : transporte(p));
    const bitacora = bitacoraVacia();
    const desenlaces: Record<string, string> = {};
    const pedir = pedidor(crearInterceptor(deps, { ...OPCIONES_RENDER, maxConcurrencia: 2 }, bitacora, () => 5_000, new AbortController().signal), desenlaces);
    await pedir("http://sitio.test/", null, { principal: true });
    for (const n of [1, 2, 3]) void pedir(`http://video.test/seg${n}`, "http://video.test/embed");
    await new Promise((listo) => setImmediate(listo));
    // Dos en el transporte y el tercero esperando: si no, esto no prueba nada.
    expect(bitacora.picoConcurrente.deOtrosSitios).toBe(2);
    expect(bitacora.pedidos.map((p) => p.url)).not.toContain("http://video.test/seg3");
    const chunk = pedir("http://sitio.test/chunk.js", "http://sitio.test/", { tipo: "script" });
    const listo = await Promise.race([chunk.then(() => "listo"), new Promise((r) => setTimeout(() => r("esperando"), 1_000))]);
    expect(listo).toBe("listo");
    expect(desenlaces["http://sitio.test/chunk.js"]).toBe("respondido");
    expect(bitacora.picoConcurrente.pagina).toBe(1);
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

  // M11 (F10): el borde es 400, no 401. Un 400 con una página de error larga
  // se medía como el sitio.
  it("el borde: un documento que contesta 400 es `http_400`, y uno que contesta 399 se mide", async () => {
    const error = `<h1>Bad Request</h1><p>${"Página de error del servidor. ".repeat(40)}</p>`;
    const { deps } = armar({ "http://sitio.test/": { status: 400, cuerpo: error } });
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "http_400" });
    const otro = armar({ "http://sitio.test/": { status: 399, cuerpo: error } });
    expect((await medirRenderizado("http://sitio.test/", otro.deps)).estado).toBe("medido");
  });

  // M12 (F10): sin status del documento no hay documento medido. Si Chromium
  // lo sirvió por su cuenta, lo que se lee no pasó por el examen ni por el
  // transporte, y su texto no es el del sitio.
  it("un documento que la medición no vio llegar —sin status— es `navegacion`, no un número", async () => {
    const { deps, navegador } = armar(
      { "http://sitio.test/": { cuerpo: "<p>x</p>" } },
      { documentoPorFuera: `<main><p>${"Texto que nadie examinó. ".repeat(40)}</p></main>` }
    );
    expect(await medirRenderizado("http://sitio.test/", deps)).toEqual({ estado: "fallo", codigo: "navegacion" });
    expect(navegador.registro.cierres).toBe(1);
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

  it("los SUBRECURSOS a 127.0.0.1, 169.254.169.254 y 10.x se abortan, y el render queda sin número: no se vio lo que traían (F2)", async () => {
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
    // Antes «medido»: lo que esos scripts escribían no estaba, y el número se
    // daba igual. Ahora, contenido que no se vio es «no medido» (F2), y el
    // detalle es el primero que la política rechazó. Cinco y no seis: el
    // marco a `localhost` es de OTRO sitio que la página, y lo que la
    // política le rechaza no decide (RT-4), igual que lo que no le llega.
    expect(render).toEqual(
      falloPor("red-no-publica", { tipo: "script", host: "127.0.0.1", ruta: "/loopback.js", origen: "pagina", noLlegaron: 5 })
    );
    expect(bitacora.noLlegaron.map((n) => n.url)).not.toContain("http://localhost/");

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
        urlDeLaPagina: "http://sitio.test/",
        continuar: async () => void vistos.push(`${metodo} continuado`),
        abortar: async () => void vistos.push(`${metodo} abortado`),
        responder: async () => void vistos.push(`${metodo} respondido`),
      });
    }
    expect(vistos).toEqual(["PUT abortado", "DELETE abortado", "PATCH abortado"]);
    expect(bitacora.pedidos).toEqual([]);
  });
});
