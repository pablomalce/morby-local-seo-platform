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
};

function bitacoraVacia(): Bitacora {
  return { bloqueados: [], pedidos: [], statusDocumento: null, falloDocumento: null };
}

function armar(sitio: Sitio, opcionesNavegador: Parameters<typeof navegadorDoble>[0] = {}) {
  // Tiempo virtual: la espera de quietud del DOM no duerme de verdad.
  const reloj = relojVirtual();
  const navegador = navegadorDoble({ reloj, ...opcionesNavegador });
  const red = transporteDoble(sitio);
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
    // `innerText` separa párrafos con «\n\n»; el HTML sin etiquetas, con
    // espacios. Contados con dos funciones distintas, la misma página daría
    // dos números distintos y la diferencia la inventaría el código.
    const html = `<body><p>Hola</p>\n<p>mundo   de\tverdad</p></body>`;
    const { deps } = armar({ "http://sitio.test/": { cuerpo: html } }, { textoCrudo: "Hola\n\nmundo de verdad\n" });
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
 * P4. Reproducido con Chrome 154: un mega-menú `display: none` de 1 671
 * caracteres servidos y TODO lo visible (3 189) dibujado por JavaScript salía
 * VERDE, porque el lado servido se contaba en el HTML —con lo oculto— y el
 * renderizado con `innerText` —sin lo oculto—. Ahora el lado servido es la
 * misma página con el JavaScript apagado, y la misma extracción.
 */
describe("P4: el lado servido se mide con la MISMA extracción, en una pestaña sin JavaScript", () => {
  const MEGA_MENU = `<nav style="display: none">${Array.from({ length: 80 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
  const DIBUJADO = "Todo lo que una persona ve lo dibuja el JavaScript. ".repeat(61);

  it("un mega-menú oculto no cuenta como texto servido: la página sólo-JS sale ROJA", async () => {
    const html = `<html><body>${MEGA_MENU}<main id="app"></main><script src="/app.js"></script></body></html>`;
    const { deps, red, navegador } = armar(
      { "http://sitio.test/": { cuerpo: html }, "http://sitio.test/app.js": { cuerpo: "" } },
      // Lo que Chrome muestra con JavaScript: el contenido, y no el menú oculto.
      { textoCrudo: DIBUJADO }
    );
    const render = await medirRenderizado("http://sitio.test/", deps);
    expect(render.estado).toBe("medido");
    if (render.estado !== "medido") return;

    // El número viejo —el HTML sin etiquetas— pasaba la mitad de lo dibujado.
    expect(textoSinJavaScript(html)).toBeGreaterThan(render.caracteres / 2);
    expect(render.servidos).toBeLessThan(10);
    const punto = contenidoSinJs({ ...SANO_PUNTO, caracteresSinJs: textoSinJavaScript(html), caracteresRenderizados: render });
    expect(punto.estado).toBe("rojo");
    expect(punto.hallazgo?.quePasa).toMatch(/oculto por CSS/);

    // La pestaña sin JavaScript recibió el MISMO documento, sin volver a la red.
    expect(navegador.registro.paginasSinJs).toBe(1);
    expect(red.pedidos.filter((p) => p.url === "http://sitio.test/")).toHaveLength(1);
  });

  it("una página SSR: lo servido visible ≈ lo renderizado, y el punto sigue verde", async () => {
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

  it("un nombre que no resuelve no sale, y un DNS que tira es «no resuelve», no un permiso", async () => {
    const senal = new AbortController().signal;
    const examinar = crearExaminador(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await examinar(new URL("http://cualquiera.test/"), senal)).toEqual({ ok: false, motivo: "no-resuelve" });
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
        continuar: async () => void vistos.push(`${metodo} continuado`),
        abortar: async () => void vistos.push(`${metodo} abortado`),
        responder: async () => void vistos.push(`${metodo} respondido`),
      });
    }
    expect(vistos).toEqual(["PUT abortado", "DELETE abortado", "PATCH abortado"]);
    expect(bitacora.pedidos).toEqual([]);
  });
});
