/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el renderizado de la auditoría AEO se dé por probado con un navegador de
 * mentira. El doble de `renderizado.test.ts` prueba la lógica; acá el oráculo
 * es de un tercero (R11): un Chrome de verdad, sockets de verdad y dos
 * servidores HTTP locales.
 *
 *   - el SITIO sirve la página de control de la puerta —el mismo
 *     `public/aeo-control/index.html` que despliega Vercel, leído del disco—, una
 *     página SSR, redirecciones hostiles y una página llena de subrecursos que
 *     apuntan adentro;
 *   - el CANARIO cuenta CONEXIONES TCP y DATAGRAMAS UDP, no pedidos HTTP. Un
 *     STUN de WebRTC manda UDP sin pasar por ningún proxy; un `WebSocket` o un
 *     `<link rel="preconnect">` abren un socket sin pedir nada, y MEDIDO al
 *     escribir esto: con la intercepción de puppeteer puesta y sin las
 *     banderas de `chromium.ts`, el canario contó 3 conexiones y un `UPGRADE`.
 *     Con ellas, cero. Ése es el número que se afirma acá.
 *
 * El DNS es un doble (los `.test` no existen) y el transporte es el de
 * producción con `conectarA`: lo que el examen dejó pasar por una dirección
 * pública va al SITIO, y TODO lo demás va al CANARIO. Así, si la guarda dejara
 * pasar loopback, la metadata o una red privada, el pedido llegaría al canario
 * y el número dejaría de ser cero.
 *
 * CUÁNDO CORRE
 *
 * Con `AEO_CHROME_PATH` apuntando a un Chrome que exista. En la Mac:
 *
 *   AEO_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     npx vitest run src/lib/aeo/__tests__/renderizado.integracion.test.ts
 *
 * O con `AEO_CHROMIUM_DE_PRODUCCION=1`, en Linux y SIN `AEO_CHROME_PATH`: el
 * mismo camino que la ruta en Vercel, el headless shell de
 * `@sparticuz/chromium`. Es el binario que importa, y no se porta igual que
 * Chrome (RV-1: una bandera de WebRTC que en Chrome 154 cierra el UDP, en
 * headless shell 153 no). Se corre en un contenedor
 * `public.ecr.aws/lambda/nodejs:24` con `VERCEL=1` y
 * `AWS_EXECUTION_ENV=AWS_Lambda_nodejs24.x`, con su propio `npm ci`.
 *
 * Sin ninguna de las dos se saltea con el motivo escrito en el nombre del
 * bloque, y eso NO es un verde. Por eso el CI tiene un job propio
 * (`render` en `.github/workflows/ci.yml`) que corre este archivo con el Chrome
 * del runner y con el headless shell de producción, y con
 * `AEO_INTEGRACION_OBLIGATORIA=1`: ahí un Chrome que falta es ROJO, no un
 * salteo (SEC-1, GATE-5). Antes el CI no las definía, y una bandera borrada
 * de `chromium.ts` mergeaba en verde: los tests de `verify` usan dobles del
 * navegador y no la pueden ver.
 *
 * En el CI, cada caso se reintenta una vez: MEDIDO, con la máquina cargada un
 * arranque de Chromium pasó los 20 s y un caso dio `sin-navegador` o
 * `timeout`, y al repetirlo pasó. Un reintento no esconde una regresión: una
 * bandera borrada abre el canario las dos veces.
 */
import dgram from "node:dgram";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { abrirChromium, BANDERAS_SIN_RED, capasDeRed } from "../chromium";
import { contenidoSinJs, hallazgos, type LecturaDelSitio } from "../hallazgos";
import { AGENTES_IA, contarCaracteres, MINIMO_DE_TEXTO, textoSinJavaScript } from "../lectura";
import { medirRenderizado, nuevaBitacora, OPCIONES_RENDER, type Bitacora, type DependenciasRender } from "../renderizado";
import { crearTransporteRender } from "../transporteRender";
import { resolvedorDoble } from "./navegadorDoble";

const DE_PRODUCCION =
  process.env.AEO_CHROMIUM_DE_PRODUCCION === "1" && process.platform === "linux" && !process.env.AEO_CHROME_PATH;
const CHROME = DE_PRODUCCION ? undefined : process.env.AEO_CHROME_PATH;
const HAY_CHROME = DE_PRODUCCION || Boolean(CHROME && existsSync(CHROME));
const MOTIVO = DE_PRODUCCION
  ? "con el headless shell de @sparticuz/chromium, el de producción"
  : HAY_CHROME
    ? `con ${CHROME}`
    : "SALTEADO: no hay Chrome — exportá AEO_CHROME_PATH, o AEO_CHROMIUM_DE_PRODUCCION=1 en Linux";

const PUBLICA = "93.184.216.34";
/** Una IPv6 pública (la de 1.1.1.1), sólo para el examen: el socket va a 100::1. */
const IPV6_SIN_RUTA = "2606:4700:4700::1111";
const CONTROL = readFileSync(path.join(process.cwd(), "public", "aeo-control", "index.html"), "utf8");
const SANA = readFileSync(path.join(process.cwd(), "public", "aeo-sana", "index.html"), "utf8");
const HIBRIDA_DE_CONTROL = readFileSync(path.join(process.cwd(), "public", "aeo-hibrida", "index.html"), "utf8");
const SSR = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Clínica de prueba</title></head>
<body><main><h1>Clínica de prueba</h1>
<p>${"Atendemos de lunes a viernes, con turnos por teléfono y en el mostrador. ".repeat(30)}</p>
</main><script>document.body.dataset.listo = "1";</script></body></html>`;

/** Un menú servido de 60 enlaces: lo que el rastreador lee de una página que dibuja el resto. */
const MENU = `<nav>${Array.from({ length: 60 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
const CONTENIDO_TARDE = "Contenido real que el JavaScript pone con un temporizador. ".repeat(147);

/** P2: el contenido llega con un temporizador, sin un solo pedido a la red. */
const TARDE = `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<main id="app"></main>
<script>setTimeout(() => { document.getElementById("app").textContent = ${JSON.stringify(CONTENIDO_TARDE)}; }, 1500);</script>
</body></html>`;

/** P2: una sección debajo del pliegue que se dibuja cuando se la ve. */
const AL_VERSE = `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}
<div style="height: 4000px"></div><section id="abajo" style="min-height: 10px"></section>
<script>new IntersectionObserver((entradas, o) => {
  if (entradas.some((e) => e.isIntersecting)) { document.getElementById("abajo").textContent = ${JSON.stringify(CONTENIDO_TARDE)}; o.disconnect(); }
}).observe(document.getElementById("abajo"));</script>
</body></html>`;

/** P2: un texto que no deja de crecer. */
const CRECIENTE = `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<div id="goteo"></div>
<script>let i = 0; setInterval(() => { const p = document.createElement("p"); p.textContent = "línea número " + (i++) + " agregada sin parar"; document.getElementById("goteo").appendChild(p); }, 300);</script>
</body></html>`;

/**
 * F3 (tardío): el contenido llega con un temporizador LARGO, mucho después de
 * que el texto se quedó quieto. MEDIDO por la revisión con Chrome real sobre
 * `9fb77e8`: 4 s y 7 s daban 610 contra 610, VERDE. Y con un ciclo de
 * `MessageChannel` al lado, que es como agenda React: sin un tope de hambre
 * el reloj virtual no avanza nunca (ver `chromium.ts`).
 */
const tardia = (ms: number, extra = "") => `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<main id="app"></main>
<script>${extra}setTimeout(() => { document.getElementById("app").textContent = ${JSON.stringify(CONTENIDO_TARDE)}; }, ${ms});</script>
</body></html>`;
const CICLO_DE_MENSAJES = "const c = new MessageChannel(); c.port1.onmessage = () => c.port2.postMessage(0); c.port2.postMessage(0);";
/** El temporizador largo pide los datos: el pedido sale durante el adelanto, y pasa por el interceptor. */
const tardiaConDatos = (url: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<main id="app"></main>
<script>setTimeout(() => { fetch(${JSON.stringify(url)}).then((r) => r.text()).then((t) => { document.getElementById("app").textContent = t; }).catch(() => {}); }, 7000);</script>
</body></html>`;
/**
 * El reloj se DETIENE mientras el pedido está en vuelo: los datos tardan 2 s
 * reales y, cuando llegan, otro temporizador de 5 s los escribe. Si el reloj
 * siguiera corriendo durante el pedido, el adelanto se gastaría antes de que
 * lleguen y el segundo temporizador quedaría congelado afuera.
 */
const TARDIA_ENCADENADA = `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<main id="app"></main>
<script>setTimeout(() => { fetch("/datos-lentos").then((r) => r.text()).then((t) => { setTimeout(() => { document.getElementById("app").textContent = t; }, 5000); }).catch(() => {}); }, 7000);</script>
</body></html>`;

/**
 * P5 y GATE-1: lo que cuenta y lo que no, de los DOS lados. Un párrafo
 * visible y un bloque oculto por CSS cuentan —un rastreador sin JavaScript no
 * aplica CSS—; el código de un `<script>` largo en línea y el aviso de un
 * `<noscript>` no cuentan de ningún lado.
 */
const VISIBLE = "Texto que una persona ve en la página, servido por el servidor. ".repeat(30);
const OCULTO_Y_SCRIPT = `<!doctype html><html><head><meta charset="utf-8"><title>Oculto</title></head><body>
<p>${VISIBLE}</p>
<div style="display: none">${"Texto oculto por CSS que nadie ve. ".repeat(90)}</div>
<noscript><p>${"Sin JavaScript se dibujaría este aviso, que con JavaScript no existe. ".repeat(20)}</p></noscript>
<script>/* ${"código que no es texto de la página ".repeat(90)} */ document.body.dataset.listo = "1";</script>
</body></html>`;

/**
 * P4: un mega-menú servido y OCULTO por CSS, y todo lo visible dibujado por
 * JavaScript. Contado el menú de un lado y no del otro, pasaba la mitad y el
 * punto salía verde; contado de los dos lados, lo que agrega el JavaScript es
 * más del doble y el punto sale rojo.
 */
const MEGA_MENU = `<nav style="display: none">${Array.from({ length: 80 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
const OCULTO = `<!doctype html><html><head><meta charset="utf-8"></head><body>${MEGA_MENU}<main id="app"></main>
<script>document.getElementById("app").textContent = ${JSON.stringify("Todo lo que una persona ve lo dibuja el JavaScript. ".repeat(61))};</script>
</body></html>`;

/**
 * GATE-1: páginas SSR que OCULTAN su texto con CSS hasta que corre el
 * JavaScript. Un rastreador que no ejecuta JavaScript tampoco aplica CSS: lee
 * el texto del HTML entero. Contadas como «lo visible sin JavaScript», las tres
 * salían BLOQUEANTE «depende de JavaScript» —medido con Chrome real y la ruta,
 * y en la web de Vulkan, que es WordPress con Elementor—.
 */
const PARRAFO_SSR = "Atendemos de lunes a viernes, con turnos por teléfono y en el mostrador. ";

/** El patrón de Elementor: `elementor-invisible` (visibility: hidden) hasta que la sección se ve. */
const ELEMENTOR_INVISIBLE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>.elementor-invisible { visibility: hidden; }</style></head><body>
<header><a href="/">Inicio</a> <a href="/contacto">Contacto</a></header>
${Array.from(
  { length: 25 },
  (_, i) =>
    `<section class="elementor-section elementor-invisible" data-settings='{"animation":"fadeIn"}'><h2>Sección ${i}</h2><p>${PARRAFO_SSR.repeat(2)}</p></section>`
).join("\n")}
<script>
  const o = new IntersectionObserver((entradas) => {
    for (const e of entradas) if (e.isIntersecting) { e.target.classList.remove("elementor-invisible"); o.unobserve(e.target); }
  });
  document.querySelectorAll(".elementor-invisible").forEach((s) => o.observe(s));
</script></body></html>`;

/** Anti-FOUC: el `<body>` oculto por una clase en `<html>` que el JavaScript quita. */
const ANTI_FOUC = `<!doctype html><html lang="es" class="cargando"><head><meta charset="utf-8">
<style>.cargando body { visibility: hidden; }</style>
<script>addEventListener("DOMContentLoaded", () => document.documentElement.classList.remove("cargando"));</script>
</head><body><main><h1>Clínica de prueba</h1><p>${PARRAFO_SSR.repeat(27)}</p></main></body></html>`;

/**
 * `<main>` oculto, y el `<style>` que lo muestra sin JavaScript DENTRO de
 * `<noscript>`. Borrar `<noscript>` en la pestaña sin JavaScript borraba
 * justo ese estilo.
 */
const NOSCRIPT_STYLE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>main { display: none; }</style>
<noscript><style>main { display: block; }</style></noscript>
</head><body><main><h1>Clínica de prueba</h1><p>${PARRAFO_SSR.repeat(27)}</p></main>
<script>document.querySelector("main").style.display = "block";</script></body></html>`;

/**
 * RT-1: una página híbrida —un menú servido de más de 500 caracteres y el
 * contenido escrito por un bundle—. Si el bundle no llega, el DOM es el menú
 * solo, igual al servido, y el punto salía VERDE.
 */
const CONTENIDO_DEL_BUNDLE = "Contenido del negocio que dibuja el bundle de la página. ".repeat(70);
const BUNDLE = `document.getElementById("app").textContent = ${JSON.stringify(CONTENIDO_DEL_BUNDLE)};`;
function hibrida(script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<main id="app"></main>${script}</body></html>`;
}

/**
 * PU-2: el contenido real dibujado por JavaScript DENTRO de un shadow root
 * (Lit, Stencil, LWC), con un menú servido. `page.content()` es `outerHTML`
 * y no serializa los shadow roots: MEDIDO por la revisión con Chrome 154, el
 * menú de 529 y la sombra de 2 999 daban `render 529 / servidos 529` y el punto
 * VERDE, cuando un rastreador sin JavaScript sólo lee el menú. Abierto y
 * cerrado: el cerrado tampoco lo ve el JavaScript de la página.
 */
const CONTENIDO_EN_SOMBRA = "Contenido del negocio que un componente dibuja en su sombra. ".repeat(50);
function enSombra(modo: "open" | "closed"): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<x-contenido></x-contenido>
<script>customElements.define("x-contenido", class extends HTMLElement {
  connectedCallback() {
    const r = this.attachShadow({ mode: "${modo}" });
    r.innerHTML = "<main><p>" + ${JSON.stringify(CONTENIDO_EN_SOMBRA)} + "</p><x-anidado></x-anidado></main>";
  }
});
customElements.define("x-anidado", class extends HTMLElement {
  connectedCallback() { this.attachShadow({ mode: "open" }).innerHTML = "<p>Y una sombra anidada adentro de la otra.</p>"; }
});</script></body></html>`;
}

/**
 * PU-2, al revés: un declarative shadow DOM SERVIDO —el contenido viene en el
 * HTML, dentro de `<template shadowrootmode>`, y el parser lo dibuja sin
 * JavaScript—. Contado con `page.content()` daba `servido 0 / renderizado 0` y
 * rojo «poco texto», cuando el HTML trae el texto.
 */
const DSD_SERVIDO = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<x-tarjeta><template shadowrootmode="open"><main><p>${CONTENIDO_EN_SOMBRA}</p></main></template></x-tarjeta>
<x-pie><template shadowrootmode="closed"><footer>Pie servido en una sombra cerrada.</footer></template></x-pie>
</body></html>`;

/**
 * RV-1: un popup es otro target. Ni la intercepción ni `evaluateOnNewDocument`
 * llegan a él, así que el constructor de WebRTC está entero adentro, y su
 * navegación no pasa por el interceptor.
 */
function paginaConPopup(): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<p>${"Página que abre ventanas nuevas. ".repeat(30)}</p>
<script>
  try {
    const w = window.open("about:blank");
    const pc = new w.RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${puertoUdp}" }] });
    pc.createDataChannel("d");
    pc.createOffer().then((o) => pc.setLocalDescription(o));
  } catch (e) {}
  try { window.open("http://127.0.0.1:${puertoCanario}/popup-directo"); } catch (e) {}
</script>
</body></html>`;
}

/**
 * F1: la página híbrida con dos marcos que SÍ cargan red: uno de «video» en
 * otro nombre y uno del mismo sitio. Adentro, un script que tarda más que el
 * plazo y un segmento más grande que el tope, como los de YouTube y Vimeo que
 * agotaban el presupuesto contra vulkan-studios.com.
 */
const EMBED = `<!doctype html><html><body><p>Reproductor</p><script src="/video-lento.js"></script>
<script>fetch("/segmento-grande").then((r) => r.arrayBuffer()).catch(() => {});</script></body></html>`;

/** F2, F3: un menú servido y el contenido detrás de algo que la auditoría no ve. */
function conMenu(script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<main id="app"></main><script>${script}</script></body></html>`;
}
const ESCRIBIR = `(t) => { document.getElementById("app").textContent = t; }`;

/** SEC-A2: la página que usa el render como relé contra un tercero. */
const RELEVO = conMenu(`for (let i = 0; i < 3000; i++) fetch("http://tercero.test/p" + i, { mode: "no-cors" }).catch(() => {});`);
const POSTS_AJENOS = conMenu(`
  for (let i = 0; i < 25; i++) fetch("http://tercero.test/post", { method: "POST", mode: "no-cors", body: "datos-de-la-pagina" }).catch(() => {});
  fetch("http://tercero.test/post-grande", { method: "POST", mode: "no-cors", body: "x".repeat(100000) }).catch(() => {});`);

/** Lo que el tercero recibió, contado en el servidor: pedidos, el pico a la vez y los POST. */
const enTercero = { pedidos: 0, enCurso: 0, pico: 0, posts: [] as string[] };

let sitio: http.Server;
let canario: http.Server;
let canarioUdp: dgram.Socket;
let puertoSitio = 0;
let puertoCanario = 0;
let puertoUdp = 0;
const enCanario = { conexiones: 0, pedidos: [] as string[], udp: 0 };

function escuchar(servidor: http.Server): Promise<number> {
  return new Promise((listo) => servidor.listen(0, "127.0.0.1", () => listo((servidor.address() as AddressInfo).port)));
}

function paginaConSubrecursos(): string {
  // Todo lo que una página hostil puede intentar, a cada red que importa. Los
  // nombres `.test` los contesta el doble de DNS; las IP van literales.
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="http://127.0.0.1:${puertoCanario}">
<link rel="preconnect" href="http://169.254.169.254">
<link rel="dns-prefetch" href="http://interno.test">
<link rel="stylesheet" href="http://interno.test/estilo.css">
</head><body>
<h1>Página con subrecursos hostiles</h1>
<p>${"Texto visible de la página. ".repeat(30)}</p>
<img src="http://127.0.0.1/pixel.gif">
<iframe src="http://169.254.169.254/latest/meta-data/"></iframe>
<script src="http://interno.test/interno.js"></script>
<script src="http://127.0.0.1:${puertoCanario}/directo.js"></script>
<script>
  fetch("http://169.254.169.254/latest/meta-data/iam/").catch(() => {});
  fetch("http://10.0.0.7/").catch(() => {});
  fetch("http://mixto.test/").catch(() => {});
  try { new WebSocket("ws://127.0.0.1:${puertoCanario}/ws"); } catch (e) {}
  try { new WebSocket("ws://169.254.169.254/ws"); } catch (e) {}
  try { new EventSource("http://127.0.0.1:${puertoCanario}/sse"); } catch (e) {}
  navigator.sendBeacon && navigator.sendBeacon("http://127.0.0.1/beacon", "x");
  // WebRTC: UDP directo a un STUN en loopback, y el mismo intento con el
  // constructor sacado de un iframe recién creado.
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${puertoUdp}" }] });
    pc.createDataChannel("d");
    pc.createOffer().then((o) => pc.setLocalDescription(o));
  } catch (e) {}
  try {
    const f = document.createElement("iframe");
    document.body.appendChild(f);
    const R = f.contentWindow.RTCPeerConnection;
    const pc2 = new R({ iceServers: [{ urls: "stun:127.0.0.1:${puertoUdp}" }] });
    pc2.createDataChannel("d");
    pc2.createOffer().then((o) => pc2.setLocalDescription(o));
  } catch (e) {}
  new Worker(URL.createObjectURL(new Blob([
    "fetch('http://169.254.169.254/w').catch(()=>{}); try { new WebSocket('ws://127.0.0.1:${puertoCanario}/w') } catch (e) {}"
  ])));
  const p = document.createElement("p");
  p.textContent = "Párrafo agregado por JavaScript.";
  document.body.appendChild(p);
</script>
</body></html>`;
}

beforeAll(async () => {
  if (!HAY_CHROME) return;
  canario = http.createServer((req, res) => {
    enCanario.pedidos.push(`${req.method} ${req.url}`);
    res.end("CANARIO");
  });
  canario.on("connection", () => {
    enCanario.conexiones += 1;
  });
  canario.on("upgrade", (req, socket) => {
    enCanario.pedidos.push(`UPGRADE ${req.url}`);
    socket.destroy();
  });
  puertoCanario = await escuchar(canario);
  canarioUdp = dgram.createSocket("udp4");
  canarioUdp.on("message", () => {
    enCanario.udp += 1;
  });
  puertoUdp = await new Promise<number>((listo) =>
    canarioUdp.bind(0, "127.0.0.1", () => listo(canarioUdp.address().port))
  );

  sitio = http.createServer((req, res) => {
    if (req.headers.host === "tercero.test") {
      // SEC-A2: el tercero cuenta lo que le llega, y retiene cada respuesta
      // 50 ms para que la concurrencia se vea.
      enTercero.pedidos += 1;
      enTercero.enCurso += 1;
      enTercero.pico = Math.max(enTercero.pico, enTercero.enCurso);
      const partes: Buffer[] = [];
      req.on("data", (p: Buffer) => partes.push(p));
      req.on("end", () => {
        if (req.method === "POST") enTercero.posts.push(`${req.url} ${Buffer.concat(partes).length}`);
        setTimeout(() => {
          enTercero.enCurso -= 1;
          res.end("ok");
        }, 50);
      });
      return;
    }
    const html = (cuerpo: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(cuerpo);
    };
    switch (req.url) {
      case "/control":
        return html(CONTROL);
      case "/sana":
        return html(SANA);
      case "/ssr":
        return html(SSR);
      case "/tarde":
        return html(TARDE);
      case "/oculto-y-script":
        return html(OCULTO_Y_SCRIPT);
      case "/oculto":
        return html(OCULTO);
      case "/hibrida":
        return html(hibrida(`<script src="/app.js"></script>`));
      case "/hibrida-lenta":
        return html(hibrida(`<script src="/app-lento.js"></script>`));
      case "/hibrida-v6":
        return html(hibrida(`<script src="https://cdn-v6.test/app.js"></script>`));
      case "/hibrida-grande":
        return html(hibrida(`<script src="/app-grande.js"></script>`));
      case "/hibrida-chunk":
        // El chunk perezoso: lo pide el JavaScript después del `load`.
        return html(
          hibrida(`<script>addEventListener("load", () => {
            const s = document.createElement("script"); s.src = "/chunk-tardio.js"; document.body.appendChild(s);
          });</script>`)
        );
      case "/app.js":
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(BUNDLE);
      case "/app-lento.js":
      case "/chunk-tardio.js": {
        const demora = req.url === "/app-lento.js" ? 3_000 : 3_500;
        const reloj = setTimeout(() => {
          res.writeHead(200, { "content-type": "text/javascript" });
          res.end(BUNDLE);
        }, demora);
        res.on("close", () => clearTimeout(reloj));
        return;
      }
      case "/app-grande.js":
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(`${BUNDLE}\n/* ${"relleno ".repeat(15_000)} */`);
      case "/hibrida-de-control":
        return html(HIBRIDA_DE_CONTROL);
      case "/hibrida-con-marco":
        return html(hibrida(`<script src="/app.js"></script><iframe src="http://video.sitio.test/embed"></iframe><iframe src="/embed"></iframe>`));
      case "/embed":
        return html(EMBED);
      case "/video-lento.js": {
        const reloj = setTimeout(() => {
          res.writeHead(200, { "content-type": "text/javascript" });
          res.end("void 0;");
        }, 3_000);
        res.on("close", () => clearTimeout(reloj));
        return;
      }
      case "/segmento-grande":
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(Buffer.alloc(6 * 1024 * 1024, 7));
      case "/puerto-fetch":
        return html(conMenu(`fetch("https://sitio.test:8443/api/contenido").then((r) => r.text()).then(${ESCRIBIR}).catch(() => {});`));
      case "/puerto-script":
        return html(hibrida(`<script src="https://cdn.sitio.test:8443/app.js"></script>`));
      case "/websocket":
        return html(conMenu(`try { const s = new WebSocket("ws://sitio.test/ws"); s.onmessage = (e) => (${ESCRIBIR})(e.data); } catch (e) {}`));
      case "/websocket-worker":
        return html(
          conMenu(`const w = new Worker(URL.createObjectURL(new Blob([
            "try { const s = new WebSocket('ws://sitio.test/ws-worker'); s.onmessage = (e) => postMessage(e.data); } catch (e) {}"
          ])));
          w.onmessage = (e) => (${ESCRIBIR})(e.data);`)
        );
      case "/eventsource":
        return html(conMenu(`const es = new EventSource("/eventos"); es.onmessage = (e) => (${ESCRIBIR})(e.data);`));
      case "/eventos":
        // Un stream que no termina: manda un evento y deja la conexión abierta.
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${CONTENIDO_DEL_BUNDLE}\n\n`);
        return;
      case "/relevo":
        return html(RELEVO);
      case "/posts-ajenos":
        return html(POSTS_AJENOS);
      case "/sombra-abierta":
        return html(enSombra("open"));
      case "/sombra-cerrada":
        return html(enSombra("closed"));
      case "/dsd-servido":
        return html(DSD_SERVIDO);
      case "/elementor-invisible":
        return html(ELEMENTOR_INVISIBLE);
      case "/anti-fouc":
        return html(ANTI_FOUC);
      case "/noscript-style":
        return html(NOSCRIPT_STYLE);
      case "/al-verse":
        return html(AL_VERSE);
      case "/creciente":
        return html(CRECIENTE);
      case "/tardia-4s":
        return html(tardia(4_000));
      case "/tardia-7s":
        return html(tardia(7_000));
      case "/tardia-7s-mensajes":
        return html(tardia(7_000, CICLO_DE_MENSAJES));
      case "/tardia-29s":
        return html(tardia(29_000));
      case "/tardia-datos":
        return html(tardiaConDatos("/datos-tardios"));
      case "/tardia-datos-caidos":
        return html(tardiaConDatos("http://cdn-v6.test/datos-tardios"));
      case "/datos-tardios":
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        return res.end(CONTENIDO_TARDE);
      case "/tardia-encadenada":
        return html(TARDIA_ENCADENADA);
      case "/datos-lentos":
        setTimeout(() => {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end(CONTENIDO_TARDE);
        }, 2_000);
        return;
      case "/subrecursos":
        return html(paginaConSubrecursos());
      case "/popup-webrtc":
        return html(paginaConPopup());
      case "/redir-loopback":
        res.writeHead(302, { location: `http://127.0.0.1/admin` });
        return res.end();
      case "/redir-metadata":
        res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      case "/redir-interno":
        res.writeHead(302, { location: "http://interno.test/" });
        return res.end();
      case "/redir-sana":
        res.writeHead(302, { location: "/ssr" });
        return res.end();
      case "/descarga-blob":
        // La descarga que arma el JavaScript no pasa por la red: ningún
        // `Content-Disposition` que el transporte pueda rechazar.
        return html(`<body><p>${"Página que descarga sola. ".repeat(30)}</p><script>
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob(["x".repeat(1000)]));
          a.download = "aeo-descarga.txt";
          document.body.appendChild(a);
          a.click();
        </script></body>`);
      case "/descarga":
        res.writeHead(200, { "content-type": "application/zip", "content-disposition": "attachment; filename=x.zip" });
        return res.end("PK");
      default:
        res.writeHead(404, { "content-type": "text/html" });
        return res.end("<h1>no</h1>");
    }
  });
  puertoSitio = await escuchar(sitio);
});

afterAll(async () => {
  if (!HAY_CHROME) return;
  await new Promise((listo) => sitio.close(listo));
  await new Promise((listo) => canario.close(listo));
  await new Promise<void>((listo) => canarioUdp.close(() => listo()));
});

beforeEach(() => {
  enCanario.conexiones = 0;
  enCanario.pedidos = [];
  enCanario.udp = 0;
  enTercero.pedidos = 0;
  enTercero.enCurso = 0;
  enTercero.pico = 0;
  enTercero.posts = [];
});

function deps(
  banderas: readonly string[] = BANDERAS_SIN_RED,
  quitarWebRtc = true
): DependenciasRender & { aperturas: () => number; cierres: () => number } {
  let aperturas = 0;
  let cierres = 0;
  const abrir = abrirChromium({ ejecutable: CHROME, banderas, quitarWebRtc });
  return {
    abrirNavegador: async () => {
      const n = await abrir();
      aperturas += 1;
      return {
        nuevaPagina: (opciones) => n.nuevaPagina(opciones),
        cerrar: async () => {
          await n.cerrar();
          cierres += 1;
        },
      };
    },
    // Lo que pasó el examen con la dirección pública va al sitio; cualquier
    // otra dirección, al canario. Producción no pasa `conectarA`.
    transporte: crearTransporteRender({
      // PU-3: la IPv6 PÚBLICA de `cdn-v6.test` pasa el examen, y el socket se
      // abre de verdad a 100::1 (RFC 6666, descarte): en un host sin ruta
      // IPv6 —esta Mac, el runner del CI, la función de Vercel— falla en el
      // acto, y en uno con ruta no llega a ninguna parte. Nunca sale a internet.
      conectarA: ({ ip }) =>
        ip === IPV6_SIN_RUTA
          ? { ip: "100::1", puerto: 443 }
          : { ip: "127.0.0.1", puerto: ip === PUBLICA ? puertoSitio : puertoCanario },
    }),
    resolver: resolvedorDoble({
      "cdn-v6.test": [IPV6_SIN_RUTA],
      "sitio.test": [PUBLICA],
      "video.sitio.test": [PUBLICA],
      "tercero.test": [PUBLICA],
      "interno.test": ["10.0.0.7"],
      "mixto.test": [PUBLICA, "127.0.0.1"],
    }).resolver,
    aperturas: () => aperturas,
    cierres: () => cierres,
  };
}

function bitacora(): Bitacora {
  return nuevaBitacora();
}

/** Chromium pide `/favicon.ico` por su cuenta, al mismo origen: no es de la página. */
function sinFavicon<T extends { url: string }>(pedidos: T[]): T[] {
  return pedidos.filter((p) => !p.url.endsWith("/favicon.ico"));
}

/** El canario mide después de una pausa: un socket tardío también cuenta. */
async function canarioDespues(ms = 1_000) {
  await new Promise((listo) => setTimeout(listo, ms));
  return { ...enCanario, pedidos: [...enCanario.pedidos] };
}

const TODOS_ENTRAN = Object.fromEntries(AGENTES_IA.map((a) => [a, true])) as LecturaDelSitio["acceso"];

describe.runIf(process.env.AEO_INTEGRACION_OBLIGATORIA === "1")("en el CI la integración es OBLIGATORIA", () => {
  it("hay un Chromium con el que correrla: si falta, esto es rojo y no un salteo", () => {
    expect(HAY_CHROME, MOTIVO).toBe(true);
  });
});

describe.skipIf(!HAY_CHROME)(`el renderizado con un Chromium de verdad (${MOTIVO})`, { retry: process.env.CI ? 1 : 0 }, () => {
  it(
    "la página de CONTROL: servido casi cero, renderizado por encima del mínimo, punto ROJO",
    async () => {
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/control", d);
      const servido = textoSinJavaScript(CONTROL);
      console.log(`[H2-GO-1 control] html=${servido} renderizado=${JSON.stringify(render)}`);

      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(servido).toBeLessThan(60);
      expect(render.servidos, "sin JavaScript, la página de control no muestra nada").toBe(0);
      expect(render.caracteres).toBeGreaterThan(MINIMO_DE_TEXTO);

      const punto = contenidoSinJs({
        acceso: TODOS_ENTRAN,
        caracteresSinJs: servido,
        caracteresRenderizados: render,
        schema: [],
        tieneLlmsTxt: false,
      });
      expect(punto.estado).toBe("rojo");
      expect(d.cierres()).toBe(d.aperturas());
    },
    60_000
  );

  it(
    "GATE-3 — la página de control SANA (`public/aeo-sana/`) en la MISMA corrida: servido = renderizado, punto VERDE",
    async () => {
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/sana", d);
      const servido = textoSinJavaScript(SANA);
      console.log(`[H2-GO-1 sana] html=${servido} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(Math.abs((render.servidos ?? 0) - servido) / servido).toBeLessThan(0.05);
      expect(
        contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: servido, caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
          .estado
      ).toBe("verde");
      expect(d.cierres()).toBe(d.aperturas());
    },
    60_000
  );

  it(
    "una página SSR en la MISMA corrida: servido ≈ renderizado, punto VERDE",
    async () => {
      // El control positivo: un auditor que diera rojo siempre pasaría el caso
      // de arriba. Éste es el que no puede pasar.
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/ssr", d);
      const servido = textoSinJavaScript(SSR);
      console.log(`[H2-GO-1 ssr] html=${servido} renderizado=${JSON.stringify(render)}`);

      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(Math.abs(render.caracteres - servido) / servido).toBeLessThan(0.05);
      expect(Math.abs((render.servidos ?? 0) - servido) / servido).toBeLessThan(0.05);
      expect(
        contenidoSinJs({
          acceso: TODOS_ENTRAN,
          caracteresSinJs: servido,
          caracteresRenderizados: render,
          schema: [],
          tieneLlmsTxt: false,
        }).estado
      ).toBe("verde");
    },
    60_000
  );

  it(
    "P4 — un mega-menú OCULTO servido cuenta de los dos lados, y lo que dibuja el JavaScript sólo del renderizado: punto ROJO",
    async () => {
      const d = deps();
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/oculto", d, undefined, b);
      const enHtml = textoSinJavaScript(OCULTO);
      console.log(`[P4 /oculto] html=${enHtml} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(Math.abs((render.servidos ?? 0) - enHtml) / enHtml).toBeLessThan(0.05);
      expect(render.caracteres).toBeGreaterThan(2 * (render.servidos ?? 0));
      expect(
        contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: enHtml, caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
          .estado
      ).toBe("rojo");
      // La pestaña sin JavaScript no volvió a pedir el documento.
      expect(sinFavicon(b.pedidos).map((p) => p.url)).toEqual(["http://sitio.test/oculto"]);
      expect(d.cierres()).toBe(d.aperturas());
    },
    60_000
  );

  it(
    "P5 — el texto oculto por CSS cuenta de los dos lados; el código de un <script> en línea y un <noscript>, de ninguno",
    async () => {
      const render = await medirRenderizado("http://sitio.test/oculto-y-script", deps());
      const esperado = contarCaracteres(`${VISIBLE} ${"Texto oculto por CSS que nadie ve. ".repeat(90)}`);
      console.log(`[P5 /oculto-y-script] esperado=${esperado} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(Math.abs(render.caracteres - esperado) / esperado).toBeLessThan(0.05);
      expect(Math.abs((render.servidos ?? 0) - esperado) / esperado).toBeLessThan(0.05);
    },
    60_000
  );

  it(
    "PU-3 — el bundle en un CDN sólo IPv6, sin ruta IPv6: NO es una medición, y el proceso no ve ninguna excepción",
    async () => {
      // Reproducido por la revisión con Chrome 154: `render 529/529`, punto
      // VERDE, `noLlegaron=[]` y un `uncaughtException` EHOSTUNREACH.
      const noCapturadas: unknown[] = [];
      const anotar = (e: unknown) => noCapturadas.push(e);
      process.on("uncaughtException", anotar);
      try {
        const b = bitacora();
        const render = await medirRenderizado("http://sitio.test/hibrida-v6", deps(), undefined, b);
        console.log(`[PU-3 /hibrida-v6] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        expect(render.estado).toBe("fallo");
        if (render.estado !== "fallo") return;
        expect(["subrecurso-sin-respuesta", "subrecurso-timeout"]).toContain(render.codigo);
        expect(b.noLlegaron.map((n) => n.url)).toEqual(["https://cdn-v6.test/app.js"]);
        await new Promise((listo) => setTimeout(listo, 100));
        expect(noCapturadas).toEqual([]);
      } finally {
        process.off("uncaughtException", anotar);
      }
    },
    60_000
  );

  it.each(["/sombra-abierta", "/sombra-cerrada"])(
    "PU-2 — el contenido dibujado por JavaScript en un shadow root (%s) cuenta del lado renderizado: punto ROJO",
    async (ruta) => {
      const d = deps();
      const render = await medirRenderizado(`http://sitio.test${ruta}`, d);
      const menu = contarCaracteres(MENU.replace(/<[^>]+>/g, " "));
      console.log(`[PU-2 ${ruta}] menu=${menu} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      // Servido, el menú solo; renderizado, el menú y lo de las dos sombras.
      expect(Math.abs((render.servidos ?? 0) - menu) / menu).toBeLessThan(0.05);
      expect(render.caracteres).toBeGreaterThan(menu + contarCaracteres(CONTENIDO_EN_SOMBRA) - 10);
      const html = enSombra(ruta === "/sombra-abierta" ? "open" : "closed");
      expect(
        contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: textoSinJavaScript(html), caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
          .estado
      ).toBe("rojo");
      expect(d.cierres()).toBe(d.aperturas());
    },
    60_000
  );

  it(
    "PU-2 — un declarative shadow DOM SERVIDO cuenta de los dos lados, abierto y cerrado: punto VERDE",
    async () => {
      const render = await medirRenderizado("http://sitio.test/dsd-servido", deps());
      const esperado = contarCaracteres(`${CONTENIDO_EN_SOMBRA} Pie servido en una sombra cerrada.`);
      console.log(`[PU-2 /dsd-servido] esperado=${esperado} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(Math.abs((render.servidos ?? 0) - esperado) / esperado).toBeLessThan(0.05);
      expect(Math.abs(render.caracteres - esperado) / esperado).toBeLessThan(0.05);
      // Y el HTML que trae la ruta, contado sin navegador, dice lo mismo.
      expect(Math.abs(textoSinJavaScript(DSD_SERVIDO) - esperado) / esperado).toBeLessThan(0.05);
      expect(
        contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: textoSinJavaScript(DSD_SERVIDO), caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
          .estado
      ).toBe("verde");
    },
    60_000
  );

  it.each([
    ["/elementor-invisible", ELEMENTOR_INVISIBLE],
    ["/anti-fouc", ANTI_FOUC],
    ["/noscript-style", NOSCRIPT_STYLE],
  ])(
    "GATE-1 — SSR oculto por CSS hasta que corre el JavaScript (%s): el rastreador lee el HTML, y el punto NO es bloqueante",
    async (ruta, pagina) => {
      const render = await medirRenderizado(`http://sitio.test${ruta}`, deps());
      const enHtml = textoSinJavaScript(pagina);
      console.log(`[GATE-1 ${ruta}] html=${enHtml} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(enHtml).toBeGreaterThan(MINIMO_DE_TEXTO);
      // Lo servido es el texto del HTML, el que lee un rastreador sin JavaScript.
      expect(Math.abs((render.servidos ?? 0) - enHtml) / enHtml).toBeLessThan(0.05);
      const lectura: LecturaDelSitio = {
        acceso: TODOS_ENTRAN,
        caracteresSinJs: enHtml,
        caracteresRenderizados: render,
        schema: [],
        tieneLlmsTxt: false,
      };
      expect(contenidoSinJs(lectura).estado).toBe("verde");
      expect(hallazgos(lectura).filter((h) => h.gravedad === "bloqueante" && /renderizado/.test(h.donde))).toEqual([]);
    },
    60_000
  );

  describe("RT-1 — lo que escribe el texto tiene que haber LLEGADO", () => {
    const punto = (render: Awaited<ReturnType<typeof medirRenderizado>>) =>
      contenidoSinJs({
        acceso: TODOS_ENTRAN,
        caracteresSinJs: textoSinJavaScript(hibrida("")),
        caracteresRenderizados: render,
        schema: [],
        tieneLlmsTxt: false,
      }).estado;

    it(
      "el control del instrumento: con el bundle entregado, la página híbrida es ROJA",
      async () => {
        const render = await medirRenderizado("http://sitio.test/hibrida", deps());
        console.log(`[RT-1 /hibrida] renderizado=${JSON.stringify(render)}`);
        expect(render.estado).toBe("medido");
        expect(punto(render)).toBe("rojo");
      },
      60_000
    );

    it(
      "el bundle no llega a tiempo: `subrecurso-timeout`, y el punto queda «no medido» —antes, VERDE—",
      async () => {
        const b = bitacora();
        const render = await medirRenderizado("http://sitio.test/hibrida-lenta", deps(), { ...OPCIONES_RENDER, plazoPorPedidoMs: 1_500 }, b);
        console.log(`[RT-1 /hibrida-lenta] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-timeout" });
        expect(punto(render)).toBe("no-medido");
      },
      60_000
    );

    it(
      "el bundle es más grande que el tope: `subrecurso-demasiado-grande`, y el punto queda «no medido»",
      async () => {
        const render = await medirRenderizado("http://sitio.test/hibrida-grande", deps(), {
          ...OPCIONES_RENDER,
          maxBytesPorRespuesta: 60_000,
        });
        console.log(`[RT-1 /hibrida-grande] renderizado=${JSON.stringify(render)}`);
        expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-demasiado-grande" });
      },
      60_000
    );

    it(
      "un chunk que todavía está EN VUELO al leer se espera, y lo que escribe se cuenta: ROJO, no verde",
      async () => {
        // Con plazos cortos la lectura termina antes de que el chunk llegue
        // (a los 3,5 s): sin esperar lo que está en vuelo, el DOM era el menú.
        const render = await medirRenderizado("http://sitio.test/hibrida-chunk", deps(), {
          ...OPCIONES_RENDER,
          quietudMs: 500,
          desplazarMs: 200,
          quietudDomMs: 1_000,
        });
        console.log(`[RT-1 /hibrida-chunk] renderizado=${JSON.stringify(render)}`);
        expect(render.estado).toBe("medido");
        expect(punto(render)).toBe("rojo");
      },
      60_000
    );
  });

  it(
    "P2 — contenido puesto con un temporizador de 1,5 s, sin red: se cuenta, y el punto sale ROJO",
    async () => {
      const render = await medirRenderizado("http://sitio.test/tarde", deps());
      const servido = textoSinJavaScript(TARDE);
      console.log(`[P2 /tarde] servido=${servido} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(render.caracteres).toBeGreaterThan(servido + 8_000);
      expect(
        contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: servido, caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
          .estado
      ).toBe("rojo");
    },
    60_000
  );

  it(
    "P2 — una sección que un IntersectionObserver dibuja debajo del pliegue: se recorre y se cuenta",
    async () => {
      const render = await medirRenderizado("http://sitio.test/al-verse", deps());
      console.log(`[P2 /al-verse] servido=${textoSinJavaScript(AL_VERSE)} renderizado=${JSON.stringify(render)}`);
      expect(render.estado === "medido" && render.caracteres).toBeGreaterThan(textoSinJavaScript(AL_VERSE) + 8_000);
    },
    60_000
  );

  it(
    "P2 — un texto que no deja de crecer: `inestable`, no un número parcial",
    async () => {
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/creciente", d, { ...OPCIONES_RENDER, topeDomMs: 3_000 });
      expect(render).toEqual({ estado: "fallo", codigo: "inestable" });
      expect(d.cierres()).toBe(d.aperturas());
    },
    60_000
  );

  describe("F3 (tardío) — lo que el JavaScript escribe mucho después de la quietud se cuenta, en tiempo virtual", () => {
    for (const [ruta, que] of [
      ["/tardia-4s", "un temporizador de 4 s"],
      ["/tardia-7s", "un temporizador de 7 s"],
      ["/tardia-7s-mensajes", "un temporizador de 7 s con un ciclo de MessageChannel que no deja de agendar"],
      ["/tardia-datos", "un temporizador de 7 s que PIDE los datos al sitio"],
      ["/tardia-encadenada", "un temporizador de 7 s cuyos datos tardan 2 s reales y se escriben con otro de 5 s"],
    ] as const) {
      it(
        `${que}: se cuenta, y el punto sale ROJO —antes, servido igual a renderizado y VERDE—`,
        async () => {
          const d = deps();
          const inicio = Date.now();
          const render = await medirRenderizado(`http://sitio.test${ruta}`, d);
          const servido = textoSinJavaScript(tardia(0));
          console.log(`[F3 ${ruta}] servido=${servido} renderizado=${JSON.stringify(render)} en ${Date.now() - inicio} ms`);
          expect(render.estado).toBe("medido");
          if (render.estado !== "medido") return;
          expect(render.caracteres).toBeGreaterThan(servido + 8_000);
          expect(
            contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: servido, caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
              .estado
          ).toBe("rojo");
          expect(d.cierres()).toBe(d.aperturas());
        },
        60_000
      );
    }

    it(
      "un temporizador de 7 s cuyos datos NO llegan: `subrecurso-<motivo>`, no un verde",
      async () => {
        const render = await medirRenderizado("http://sitio.test/tardia-datos-caidos", deps());
        console.log(`[F3 /tardia-datos-caidos] renderizado=${JSON.stringify(render)}`);
        // Como en PU-3: sin ruta IPv6 el connect falla en el acto; con ruta, vence el plazo.
        expect(render.estado).toBe("fallo");
        if (render.estado === "fallo") expect(["subrecurso-sin-respuesta", "subrecurso-timeout"]).toContain(render.codigo);
      },
      60_000
    );

    it(
      "un temporizador que escribe cerca del final del adelanto: `inestable`, no un número parcial",
      async () => {
        const render = await medirRenderizado("http://sitio.test/tardia-29s", deps());
        console.log(`[F3 /tardia-29s] renderizado=${JSON.stringify(render)}`);
        expect(render).toEqual({ estado: "fallo", codigo: "inestable" });
      },
      60_000
    );
  });

  it(
    "F5 — el control HÍBRIDO de `public/aeo-hibrida/`: lo servido pasa el mínimo, y el punto sale ROJO por la proporción",
    async () => {
      const render = await medirRenderizado("http://sitio.test/hibrida-de-control", deps());
      const enHtml = textoSinJavaScript(HIBRIDA_DE_CONTROL);
      console.log(`[F5 /hibrida-de-control] html=${enHtml} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(render.servidos ?? 0).toBeGreaterThan(MINIMO_DE_TEXTO);
      expect(render.caracteres).toBeGreaterThan(3 * (render.servidos ?? 0));
      expect(
        contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: enHtml, caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
          .estado
      ).toBe("rojo");
    },
    60_000
  );

  it(
    "F1 — una página híbrida con dos iframes que cargan un script lento y un segmento de 6 MB: los marcos NO se piden, y se MIDE ROJA",
    async () => {
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/hibrida-con-marco", deps(), { ...OPCIONES_RENDER, plazoPorPedidoMs: 1_500 }, b);
      console.log(`[F1 /hibrida-con-marco] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
      expect(render.estado).toBe("medido");
      expect(
        contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: textoSinJavaScript(hibrida("")), caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
          .estado
      ).toBe("rojo");
      expect(sinFavicon(b.pedidos).map((p) => p.url)).toEqual(["http://sitio.test/hibrida-con-marco", "http://sitio.test/app.js"]);
      expect(b.bloqueados).toEqual(
        expect.arrayContaining([
          { url: "http://video.sitio.test/embed", motivo: "sin-texto" },
          { url: "http://sitio.test/embed", motivo: "sin-texto" },
        ])
      );
      expect(b.noLlegaron).toEqual([]);
    },
    60_000
  );

  it.each([
    ["/puerto-fetch", "https://sitio.test:8443/api/contenido", "fetch"],
    ["/puerto-script", "https://cdn.sitio.test:8443/app.js", "script"],
  ])(
    "F2 — el contenido detrás de un puerto que no es 80/443 (%s): NO LLEGÓ, `subrecurso-puerto`, y el punto no sale verde",
    async (ruta, url, tipo) => {
      const b = bitacora();
      const render = await medirRenderizado(`http://sitio.test${ruta}`, deps(), undefined, b);
      console.log(`[F2 ${ruta}] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
      expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-puerto" });
      expect(b.noLlegaron).toEqual([{ url, tipo, motivo: "puerto" }]);
      expect(await canarioDespues(300)).toEqual({ conexiones: 0, pedidos: [], udp: 0 });
    },
    60_000
  );

  it.each(["/websocket", "/websocket-worker"])(
    "F3 — el contenido por WebSocket (%s) nunca llega: Chromium avisa el intento, y es `subrecurso-websocket`",
    async (ruta) => {
      const b = bitacora();
      const render = await medirRenderizado(`http://sitio.test${ruta}`, deps(), undefined, b);
      console.log(`[F3 ${ruta}] renderizado=${JSON.stringify(render)} salidasPropias=${JSON.stringify(b.salidasPropias)}`);
      expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-websocket" });
      expect(b.salidasPropias.map((x) => x.url)).toEqual([ruta === "/websocket" ? "ws://sitio.test/ws" : "ws://sitio.test/ws-worker"]);
      expect(await canarioDespues(300)).toEqual({ conexiones: 0, pedidos: [], udp: 0 });
    },
    60_000
  );

  it(
    "F3 — el contenido por un EventSource que no termina: escribe texto, no llegó, y el render no da número",
    async () => {
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/eventsource", deps(), { ...OPCIONES_RENDER, plazoPorPedidoMs: 1_500 }, b);
      console.log(`[F3 /eventsource] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
      expect(render.estado).toBe("fallo");
      if (render.estado === "fallo") expect(["subrecurso-timeout", "subrecurso-pendiente"]).toContain(render.codigo);
    },
    60_000
  );

  it(
    "SEC-A2 — 3 000 `fetch` a un tercero: le llegan como mucho `maxPedidos`, nunca más de `maxConcurrencia` a la vez, y el render no da número",
    async () => {
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/relevo", deps(), undefined, b);
      await new Promise((listo) => setTimeout(listo, 300));
      console.log(`[SEC-A2 /relevo] renderizado=${JSON.stringify(render)} tercero=${JSON.stringify({ ...enTercero, posts: enTercero.posts.length })} pico=${b.picoConcurrente}`);
      expect(enTercero.pedidos).toBeGreaterThan(0);
      expect(enTercero.pedidos).toBeLessThanOrEqual(OPCIONES_RENDER.maxPedidos - 1);
      expect(enTercero.pico).toBeLessThanOrEqual(OPCIONES_RENDER.maxConcurrencia);
      expect(b.picoConcurrente).toBeLessThanOrEqual(OPCIONES_RENDER.maxConcurrencia);
      expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-presupuesto" });
    },
    60_000
  );

  it(
    "SEC-A2 — 25 POST a un tercero y uno de 100 KB: le llegan `maxPostsAjenos`, ninguno grande",
    async () => {
      const render = await medirRenderizado("http://sitio.test/posts-ajenos", deps());
      await new Promise((listo) => setTimeout(listo, 300));
      console.log(`[SEC-A2 /posts-ajenos] renderizado=${JSON.stringify(render)} posts=${JSON.stringify(enTercero.posts.slice(0, 3))}… (${enTercero.posts.length})`);
      expect(enTercero.posts).toHaveLength(OPCIONES_RENDER.maxPostsAjenos);
      expect(enTercero.posts.every((p) => p === `/post ${"datos-de-la-pagina".length}`)).toBe(true);
      expect(render).toEqual({ estado: "fallo", codigo: "subrecurso-presupuesto" });
    },
    60_000
  );

  it(
    "una redirección SANA se sigue: la entrega el transporte y la pide el navegador",
    async () => {
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/redir-sana", deps(), undefined, b);
      expect(render.estado).toBe("medido");
      expect(sinFavicon(b.pedidos).map((p) => p.url)).toEqual(["http://sitio.test/redir-sana", "http://sitio.test/ssr"]);
    },
    60_000
  );

  it.each([
    ["/redir-loopback", "http://127.0.0.1/admin"],
    ["/redir-metadata", "http://169.254.169.254/latest/meta-data/"],
    ["/redir-interno", "http://interno.test/"],
  ])(
    "una redirección hostil (%s) se aborta: red-no-publica, y el canario no recibe nada",
    async (ruta, destino) => {
      const b = bitacora();
      const d = deps();
      const render = await medirRenderizado(`http://sitio.test${ruta}`, d, undefined, b);
      expect(render).toEqual({ estado: "fallo", codigo: "red-no-publica" });
      expect(b.bloqueados).toContainEqual({ url: destino, motivo: "red-no-publica" });
      expect(await canarioDespues(300)).toEqual({ conexiones: 0, pedidos: [], udp: 0 });
      expect(d.cierres()).toBe(d.aperturas());
    },
    60_000
  );

  it.each([
    ["todas las capas", BANDERAS_SIN_RED, true],
    // TCP: sólo el proxy. WebRTC: sólo el constructor borrado.
    ["sólo el proxy inexistente", capasDeRed.proxy, true],
    // TCP: sólo el resolvedor. WebRTC: sólo el constructor borrado.
    ["sólo el resolvedor apagado", capasDeRed.resolvedor, true],
    // WebRTC: sólo la bandera, con el constructor intacto.
    ["las banderas y el constructor de WebRTC intacto", BANDERAS_SIN_RED, false],
  ] as const)(
    "SUBRECURSOS hostiles —loopback, metadata, 10.x, WebSocket, preconnect, worker, WebRTC— con %s: CERO conexiones al canario",
    async (capa, banderas, quitarWebRtc) => {
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/subrecursos", deps(banderas, quitarWebRtc), undefined, b);
      const visto = await canarioDespues();
      console.log(`[ssrf ${capa}] render=${JSON.stringify(render)} bloqueados=${b.bloqueados.length} canario=${JSON.stringify(visto)}`);

      // F2: los scripts a direcciones internas escriben texto que no se vio, y
      // el render queda sin número. El examen de red de abajo es el mismo.
      expect(render.estado).toBe("fallo");
      if (render.estado === "fallo") expect(render.codigo).toMatch(/^subrecurso-(red-no-publica|puerto)$/);
      expect(visto, "ni un socket ni un datagrama llegó a una dirección que no es pública").toEqual({
        conexiones: 0,
        pedidos: [],
        udp: 0,
      });
      // Y salió a la red SÓLO el documento, por la dirección pública.
      expect(sinFavicon(b.pedidos)).toEqual([{ url: "http://sitio.test/subrecursos", ip: PUBLICA }]);
      const motivos = new Set(b.bloqueados.map((x) => x.motivo));
      expect(motivos.has("red-no-publica")).toBe(true);
      expect(b.bloqueados.map((x) => x.url)).toEqual(
        expect.arrayContaining([
          "http://interno.test/interno.js",
          "http://169.254.169.254/latest/meta-data/iam/",
          "http://10.0.0.7/",
          "http://mixto.test/",
        ])
      );
    },
    60_000
  );

  it.each([
    ["todas las capas", BANDERAS_SIN_RED],
    // UDP del popup: sólo las banderas de WebRTC (el popup puede abrirse).
    ["sólo las banderas de WebRTC", capasDeRed.webRtc],
  ] as const)(
    "RV-1 — un POPUP con WebRTC y una navegación propia, con %s: CERO al canario",
    async (capa, banderas) => {
      // Con el constructor borrado, como producción: el popup no lo hereda.
      const render = await medirRenderizado("http://sitio.test/popup-webrtc", deps(banderas, true));
      const visto = await canarioDespues(1_500);
      console.log(`[RV-1 popup ${capa}] render=${JSON.stringify(render)} canario=${JSON.stringify(visto)}`);
      expect(render.estado).toBe("medido");
      expect(visto).toEqual({ conexiones: 0, pedidos: [], udp: 0 });
    },
    60_000
  );

  // `--block-new-web-contents` sola cierra el popup en el headless shell de
  // producción, y NO en Chrome 154 con `headless: true`: MEDIDO en la Mac,
  // `window.open("about:blank")` devuelve una ventana con `RTCPeerConnection`
  // igual con la bandera (y sin `--disable-popup-blocking`), y el canario
  // contó 4 datagramas. Ahí al popup lo cierra sólo la bandera de WebRTC, y
  // el caso de arriba lo afirma. Éste corre con el binario de producción.
  it.skipIf(!DE_PRODUCCION)(
    "RV-1 — un POPUP con WebRTC, con sólo --block-new-web-contents: CERO al canario (headless shell)",
    async () => {
      const render = await medirRenderizado("http://sitio.test/popup-webrtc", deps(capasDeRed.popup, true));
      const visto = await canarioDespues(1_500);
      console.log(`[RV-1 popup sólo --block-new-web-contents] render=${JSON.stringify(render)} canario=${JSON.stringify(visto)}`);
      expect(render.estado).toBe("medido");
      expect(visto).toEqual({ conexiones: 0, pedidos: [], udp: 0 });
    },
    60_000
  );

  it(
    "el canario VE el popup: sin banderas, el mismo popup le manda UDP y le pide la página —el cero de arriba no es sordo—",
    async () => {
      const render = await medirRenderizado("http://sitio.test/popup-webrtc", deps([], true));
      const visto = await canarioDespues(1_500);
      console.log(`[RV-1 popup sin banderas] render=${JSON.stringify(render)} canario=${JSON.stringify(visto)}`);
      expect(visto.udp).toBeGreaterThan(0);
      expect(visto.pedidos).toContain("GET /popup-directo");
    },
    60_000
  );

  it(
    "el canario VE: sin las banderas, la misma página le abre sockets —el cero de arriba no es un canario sordo—",
    async () => {
      // El control del instrumento, como «el espía registra Y rechaza» en
      // `precondicionRutas.test.ts`: un cero medido por un canario que no puede
      // ver nada se lee igual que un cero de verdad. Sin banderas y con el
      // constructor de WebRTC intacto, el interceptor sigue abortando todos los
      // pedidos HTTP —por eso `pedidos` puede quedar vacío—, y aun así el
      // WebSocket y los preconnect abren sockets, y el STUN manda datagramas.
      const render = await medirRenderizado("http://sitio.test/subrecursos", deps([], false));
      const visto = await canarioDespues();
      console.log(`[ssrf sin banderas] render=${JSON.stringify(render)} canario=${JSON.stringify(visto)}`);
      expect(visto.conexiones).toBeGreaterThan(0);
      expect(visto.udp).toBeGreaterThan(0);
    },
    60_000
  );

  it(
    "una DESCARGA no llega al navegador",
    async () => {
      expect(await medirRenderizado("http://sitio.test/descarga", deps())).toEqual({
        estado: "fallo",
        codigo: "descarga",
      });
    },
    60_000
  );

  it(
    "una descarga que arma el JavaScript (blob + `a.download`) no escribe nada en disco",
    async () => {
      // Esta no la para el transporte —no hay respuesta con `attachment`—: la
      // para `Browser.setDownloadBehavior: deny` en `chromium.ts`. Para poder
      // mirar dónde caería, el perfil es uno temporal con la carpeta de
      // descargas apuntando adentro; nada toca ~/Downloads. MEDIDO: sin la
      // negación, el archivo aparece en esa carpeta.
      const perfil = mkdtempSync(path.join(os.tmpdir(), "aeo-perfil-"));
      const descargas = path.join(perfil, "descargas");
      mkdirSync(descargas);
      mkdirSync(path.join(perfil, "Default"));
      writeFileSync(
        path.join(perfil, "Default", "Preferences"),
        JSON.stringify({ download: { default_directory: descargas, prompt_for_download: false } })
      );
      try {
        const render = await medirRenderizado(
          "http://sitio.test/descarga-blob",
          deps([...BANDERAS_SIN_RED, `--user-data-dir=${perfil}`])
        );
        expect(render.estado).toBe("medido");
        await new Promise((listo) => setTimeout(listo, 1_000));
        expect(readdirSync(descargas)).toEqual([]);
      } finally {
        rmSync(perfil, { recursive: true, force: true });
      }
    },
    60_000
  );

  it(
    "un 404 es `http_404`, no los caracteres de una página de error",
    async () => {
      expect(await medirRenderizado("http://sitio.test/no-existe", deps())).toEqual({
        estado: "fallo",
        codigo: "http_404",
      });
    },
    60_000
  );

  it(
    "el plazo vence con Chromium de verdad: `timeout`, y el navegador queda cerrado",
    async () => {
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/ssr", d, {
        ...OPCIONES_RENDER,
        topeMs: 1,
        plazoPorPedidoMs: 1,
        quietudMs: 0,
        cierreMs: 5_000,
        maxBytesPorRespuesta: 1024,
        maxBytesTotales: 1024,
      });
      expect(render.estado).toBe("fallo");
      expect(d.cierres()).toBe(d.aperturas());
    },
    60_000
  );
});
