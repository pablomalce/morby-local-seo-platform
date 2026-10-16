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
import {
  medirRenderizado,
  nuevaBitacora,
  OPCIONES_RENDER,
  type Bitacora,
  type DependenciasRender,
  type DetalleDelSubrecurso,
  type MotivoDeSubrecurso,
  type ResultadoRenderizado,
  type Transporte,
} from "../renderizado";
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
/**
 * RT-4: la dirección pública de los marcos de OTRO SITIO (`video.test`,
 * `reto.test`). Pasa el examen y el socket va al mismo SITIO local, que
 * contesta por la ruta: el origen lo decide la URL, no el servidor.
 */
const PUBLICA_DE_TERCEROS = "151.101.1.1";
const CONTROL = readFileSync(path.join(process.cwd(), "public", "aeo-control", "index.html"), "utf8");
const SANA = readFileSync(path.join(process.cwd(), "public", "aeo-sana", "index.html"), "utf8");
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
 * RT-4: la forma de https://vulkan-studios.com que salía `subrecurso-sin-respuesta`.
 * La página trae su bundle y un reproductor de otro sitio (`player.vimeo.com`);
 * adentro del reproductor, el desafío de otro sitio más
 * (`challenges.cloudflare.com`) hace un `fetch` a un nombre con SÓLO registros
 * AAAA (`brunhild.challenges.cloudflare.com`), que sin ruta IPv6 no llega
 * —tampoco a un Chrome normal en la misma red: `net::ERR_ADDRESS_UNREACHABLE`—.
 */
const CON_VIDEO = hibrida(`<script src="/app.js"></script><iframe src="http://video.test/embed"></iframe>`);
const EMBED = `<!doctype html><html><body><p>Reproductor</p><iframe src="http://reto.test/reto"></iframe></body></html>`;
const RETO = `<!doctype html><html><body><p>Desafío</p>
<script>fetch("https://cdn-v6.test/sonda").catch(() => {});</script></body></html>`;

/**
 * FV-1, RED-121-1, F1: la página manda la PESTAÑA a otro sitio y esa
 * navegación NO se confirma —un 204, un archivo que Chromium trata como
 * descarga (las descargas están denegadas), un `window.stop()`—: el documento
 * que se lee sigue siendo la página. Después la página pide sus datos y los
 * escribe en `#app`. Reproducido por la revisión con Chrome 155 y el headless
 * shell 153: con los datos en un nombre sólo-IPv6, `medido 1249/1249`, punto
 * VERDE y `noLlegaron=[]`, porque el sitio de la página salía del último
 * PEDIDO de navegación y el `fetch` propio pasaba por uno de otro sitio.
 */
function seVa(destino: string, datos: string, detener = false): string {
  return hibrida(`<script>addEventListener("load", () => {
  setTimeout(() => {
    location.href = ${JSON.stringify(destino)};
    ${detener ? "setTimeout(() => window.stop(), 100);" : ""}
  }, 200);
  setTimeout(() => {
    fetch(${JSON.stringify(datos)}).then((r) => r.text()).then((t) => { document.getElementById("app").textContent = t; }).catch(() => {});
  }, 1200);
});</script>`);
}

/** FV-1: el pedido propio sale ANTES de que la pestaña intente irse, y no llega después. */
const SE_VA_EN_VUELO = hibrida(`<script>addEventListener("load", () => {
  fetch("/corta-tarde").then((r) => r.text()).then((t) => { document.getElementById("app").textContent = t; }).catch(() => {});
  setTimeout(() => { location.href = "http://otro.test/vacio"; }, 300);
});</script>`);

/**
 * Lo que NO LLEGA sin depender de la red de la máquina: cualquier ruta que
 * empieza con `/caido/` corta la conexión en el acto, sea cual sea el host
 * (`sin-respuesta`). El `cdn-v6.test` de arriba falla en el acto sólo en un
 * host sin ruta IPv6; en uno con ruta, el connect a 100::1 espera el plazo.
 */
const CAIDO = "/caido/";

/**
 * El detalle de un fallo, con Chromium: la página pide sus datos con un token
 * en la query y un fragmento, y no le llegan. El detalle dice cuál, SIN eso.
 */
const CON_TOKEN = hibrida(`<script>
  fetch("${CAIDO}datos;v=2?token=SECRETO-de-la-integracion&x=1#SECRETO-fragmento")
    .then((r) => r.text()).then((t) => { document.getElementById("app").textContent = t; }).catch(() => {});
</script>`);

/** Escribe `texto` en `#app` cuando un marco se lo manda con `postMessage`. */
const ESCUCHA = `<script>addEventListener("message", (e) => {
  if (e.data && typeof e.data.texto === "string") document.getElementById("app").textContent = e.data.texto;
});</script>`;

/**
 * F2: un marco `blob:` que arma la página —hereda su origen— pide un script
 * que no llega. Adentro de un documento `blob:` una URL relativa no se
 * resuelve: va absoluta.
 */
const CON_MARCO_BLOB = hibrida(`<script>
  const doc = '<script src="http://sitio.test${CAIDO}blob.js"><\\/script>';
  const f = document.createElement("iframe");
  f.src = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
  document.body.appendChild(f);
</script>`);

/** F2: lo mismo con un `<iframe srcdoc>` (`about:srcdoc`). */
const CON_MARCO_SRCDOC = hibrida(`<iframe srcdoc='<script src="${CAIDO}srcdoc.js"></script>'></iframe>`);

/**
 * RED-121-3: un marco de OTRO sitio que intenta todo lo que la página de
 * SUBRECURSOS hostiles intenta, desde adentro del marco —que Chromium corre
 * en otro proceso (OOPIF)—, más un nombre que cambia de respuesta (rebinding),
 * redirecciones a loopback y a la metadata, un `fetch` keepalive, un beacon,
 * un `EventSource`, un worker, un `SharedWorker`, un formulario POST y la
 * navegación del propio marco a la metadata.
 */
function marcoHostil(): string {
  const canario = `127.0.0.1:${puertoCanario}`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="http://${canario}">
<link rel="stylesheet" href="http://interno.test/ajeno.css">
</head><body><p>Reproductor hostil</p>
<img src="http://${canario}/pixel.gif">
<iframe src="http://169.254.169.254/latest/meta-data/marco"></iframe>
<iframe name="destino" src="about:blank"></iframe>
<form id="f" method="post" action="http://${canario}/form" target="destino"><input name="x" value="1"></form>
<script src="http://interno.test/ajeno.js"></script>
<script src="http://${canario}/ajeno.js"></script>
<script>
  for (const u of [
    "http://169.254.169.254/latest/meta-data/iam/ajeno",
    "http://10.0.0.7/ajeno",
    "http://mixto.test/ajeno",
    "http://rebind.test/ajeno",
    "/redir-loopback",
    "/redir-metadata",
    "http://${canario}/fetch",
  ]) fetch(u).catch(() => {});
  fetch("http://${canario}/keepalive", { method: "POST", body: "x", keepalive: true }).catch(() => {});
  navigator.sendBeacon && navigator.sendBeacon("http://${canario}/beacon", "x");
  try { new WebSocket("ws://${canario}/ws"); } catch (e) {}
  try { new WebSocket("ws://169.254.169.254/ws"); } catch (e) {}
  try { new EventSource("http://${canario}/sse"); } catch (e) {}
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${puertoUdp}" }] });
    pc.createDataChannel("d");
    pc.createOffer().then((o) => pc.setLocalDescription(o));
  } catch (e) {}
  new Worker(URL.createObjectURL(new Blob([
    "fetch('http://169.254.169.254/w-ajeno').catch(()=>{}); fetch('http://${canario}/w-ajeno').catch(()=>{}); try { importScripts('http://${canario}/imp') } catch (e) {}"
  ])));
  try { new SharedWorker("/compartido-hostil.js"); } catch (e) {}
  document.getElementById("f").submit();
  setTimeout(() => { location.href = "http://169.254.169.254/latest/meta-data/navegacion"; }, 800);
</script></body></html>`;
}

/**
 * RED-121-2: un marco de otro sitio que pide 12 segmentos de 450 KB EN
 * PARALELO. Con un presupuesto ajeno de 1 MB, antes se entregaban los 12
 * (5,4 MB): cada uno miraba lo que quedaba al salir.
 */
const SEGMENTO_BYTES = 450_000;
const CON_MARCO_QUE_BAJA = hibrida(`<script src="/app.js"></script><iframe src="http://video.test/baja-mucho"></iframe>`);
const BAJA_MUCHO = `<!doctype html><html><body><p>Video</p><script>
  for (let i = 0; i < 12; i++) fetch("/segmento-" + i).catch(() => {});
</script></body></html>`;

/**
 * FV-4: el contenido lo trae un worker con `importScripts`, o un
 * `EventSource`. `ok` llega; `caido` no.
 */
function conWorker(cual: "ok" | "caido"): string {
  return hibrida(`<script>
  const w = new Worker("/wi-${cual}.js");
  w.onmessage = (e) => { document.getElementById("app").textContent = e.data; };
</script>`);
}
function conEventSource(cual: "ok" | "caido"): string {
  const url = cual === "ok" ? "/sse" : `${CAIDO}sse`;
  return hibrida(`<script>
  const s = new EventSource(${JSON.stringify(url)});
  s.onmessage = (e) => { document.getElementById("app").textContent = e.data; s.close(); };
  s.onerror = () => s.close();
</script>`);
}

/**
 * LO QUE NO CUBRE (`renderizado.ts`). FV-2: el silent-auth de OIDC. El marco
 * pide `/authorize?prompt=none` al IdP —otro sitio—, que redirige al callback
 * del PROPIO sitio, y el callback escribe en la página. FV-3: el IdP avisa a
 * la página con `postMessage` (Auth0 `web_message`, MSAL), y la página recién
 * entonces pide lo suyo; o un widget de otro sitio trae datos y se los pasa.
 */
const OIDC = (cual: "ok" | "caido") =>
  hibrida(`<iframe src="http://idp.test/${cual === "ok" ? "" : CAIDO.slice(1)}authorize"></iframe>`);
const AVISA = (cual: "ok" | "caido") =>
  hibrida(`<script>addEventListener("message", (e) => {
  if (e.data && e.data.sesion) fetch("/datos").then((r) => r.text()).then((t) => { document.getElementById("app").textContent = t; });
});</script><iframe hidden src="http://idp.test/${cual === "ok" ? "" : CAIDO.slice(1)}silencioso"></iframe>`);
const WIDGET_PM = (cual: "ok" | "caido") =>
  hibrida(`${ESCUCHA}<iframe src="http://widget.test/pm-${cual}"></iframe>`);
const COMPARTIDO = hibrida(`<script>
  const w = new SharedWorker("/compartido.js");
  w.port.onmessage = (e) => { document.getElementById("app").textContent = e.data; };
  w.port.start();
</script>`);

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
    const html = (cuerpo: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(cuerpo);
    };
    const js = (cuerpo: string) => {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(cuerpo);
    };
    if (req.url?.startsWith(CAIDO)) return req.socket.destroy();
    if (req.url?.startsWith("/segmento-")) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(Buffer.alloc(SEGMENTO_BYTES, 118));
    }
    switch (req.url) {
      case "/con-token":
        return html(CON_TOKEN);
      case "/con-marco-blob":
        return html(CON_MARCO_BLOB);
      case "/con-marco-srcdoc":
        return html(CON_MARCO_SRCDOC);
      case "/con-anidado":
        return html(hibrida(`<iframe src="http://video.test/externo"></iframe>`));
      case "/con-anidado-ok":
        return html(hibrida(`<iframe src="http://video.test/externo-ok"></iframe>`));
      case "/externo":
        // Un marco de OTRO sitio con un marco del sitio de la página adentro.
        return html(`<!doctype html><html><body><iframe src="http://sitio.test/interno"></iframe></body></html>`);
      case "/externo-ok":
        return html(`<!doctype html><html><body><iframe src="http://sitio.test/interno-ok"></iframe></body></html>`);
      case "/interno":
        return html(`<!doctype html><html><body><script src="${CAIDO}adentro.js"></script></body></html>`);
      case "/interno-ok":
        // Del sitio de la página, adentro de un marco de otro sitio: escribe
        // en la página por `window.top`.
        return html(`<!doctype html><html><body><script>
          top.document.getElementById("app").textContent = ${JSON.stringify(CONTENIDO_DEL_BUNDLE)};
        </script></body></html>`);
      case "/con-marco-hostil":
        return html(hibrida(`<iframe src="http://video.test/hostil-ajeno"></iframe>`));
      case "/hostil-ajeno":
        return html(marcoHostil());
      case "/compartido-hostil.js":
        return js(`fetch("http://127.0.0.1:${puertoCanario}/shared").catch(() => {});`);
      case "/con-marco-que-baja":
        return html(CON_MARCO_QUE_BAJA);
      case "/baja-mucho":
        return html(BAJA_MUCHO);
      case "/worker-ok":
        return html(conWorker("ok"));
      case "/worker-caido":
        return html(conWorker("caido"));
      case "/wi-ok.js":
        return js(`importScripts("/lib.js"); postMessage(self.TEXTO);`);
      case "/wi-caido.js":
        return js(`importScripts("${CAIDO}lib.js"); postMessage(self.TEXTO);`);
      case "/lib.js":
        return js(`self.TEXTO = ${JSON.stringify(CONTENIDO_DEL_BUNDLE)};`);
      case "/eventsource-ok":
        return html(conEventSource("ok"));
      case "/eventsource-caido":
        return html(conEventSource("caido"));
      case "/sse":
        res.writeHead(200, { "content-type": "text/event-stream" });
        return res.end(`retry: 600000\ndata: ${CONTENIDO_DEL_BUNDLE}\n\n`);
      case "/oidc-ok":
        return html(OIDC("ok"));
      case "/oidc-caido":
        return html(OIDC("caido"));
      case "/authorize":
        // El IdP: `prompt=none` con sesión, y de vuelta al callback del sitio.
        res.writeHead(302, { location: "http://sitio.test/callback" });
        return res.end();
      case "/callback":
        return html(`<!doctype html><html><body><script>
          parent.document.getElementById("app").textContent = ${JSON.stringify(CONTENIDO_DEL_BUNDLE)};
        </script></body></html>`);
      case "/avisa-ok":
        return html(AVISA("ok"));
      case "/avisa-caido":
        return html(AVISA("caido"));
      case "/silencioso":
        return html(`<!doctype html><html><body><script>parent.postMessage({ sesion: 1 }, "*");</script></body></html>`);
      case "/widget-pm-ok":
        return html(WIDGET_PM("ok"));
      case "/widget-pm-caido":
        return html(WIDGET_PM("caido"));
      case "/pm-ok":
      case "/pm-caido":
        return html(`<!doctype html><html><body><script>
          fetch(${JSON.stringify(req.url === "/pm-ok" ? "/datos" : `${CAIDO}datos`)})
            .then((r) => r.text()).then((t) => parent.postMessage({ texto: t }, "*")).catch(() => {});
        </script></body></html>`);
      case "/compartido":
        return html(COMPARTIDO);
      case "/compartido.js":
        return js(`onconnect = (e) => {
          const port = e.ports[0];
          fetch("/datos").then((r) => r.text()).then((t) => port.postMessage(t));
        };`);
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
      case "/con-video":
        return html(CON_VIDEO);
      case "/embed":
        return html(EMBED);
      case "/reto":
        return html(RETO);
      case "/con-video-caido":
        return html(hibrida(`<script src="/app.js"></script><iframe src="https://cdn-v6.test/embed"></iframe>`));
      case "/con-marco-propio":
        return html(hibrida(`<script src="/app.js"></script><iframe src="/marco-propio"></iframe>`));
      case "/marco-propio":
        // Un marco del MISMO origen: su JavaScript puede escribir en la página.
        return html(`<!doctype html><html><body><script src="https://cdn-v6.test/widget.js"></script></body></html>`);
      case "/se-va-204":
        return html(seVa("http://otro.test/vacio", "https://cdn-v6.test/datos"));
      case "/se-va-descarga":
        return html(seVa("http://otro.test/catalogo.zip", "https://cdn-v6.test/datos"));
      case "/se-va-detenida":
        return html(seVa("http://otro.test/lento", "https://cdn-v6.test/datos", true));
      case "/se-va-en-vuelo":
        return html(SE_VA_EN_VUELO);
      case "/se-va-y-llega":
        return html(seVa("http://otro.test/vacio", "/datos"));
      case "/vacio":
        // 204: Chromium no confirma la navegación, y la pestaña se queda en la página.
        res.writeHead(204);
        return res.end();
      case "/catalogo.zip":
        // Sin `Content-Disposition`: el interceptor lo entrega, y Chromium lo
        // trata como descarga, que está denegada. Tampoco se confirma.
        res.writeHead(200, { "content-type": "application/zip" });
        return res.end("PK\u0003\u0004");
      case "/lento": {
        const reloj = setTimeout(() => {
          res.writeHead(204);
          res.end();
        }, 2_000);
        res.on("close", () => clearTimeout(reloj));
        return;
      }
      case "/datos":
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        return res.end(CONTENIDO_DEL_BUNDLE);
      case "/corta-tarde": {
        // Contesta NADA: corta la conexión a los 1,5 s, con la pestaña ya
        // intentando irse a otro sitio.
        const reloj = setTimeout(() => req.socket.destroy(), 1_500);
        res.on("close", () => clearTimeout(reloj));
        return;
      }
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
});

function deps(
  banderas: readonly string[] = BANDERAS_SIN_RED,
  quitarWebRtc = true
): DependenciasRender & { aperturas: () => number; cierres: () => number } {
  let aperturas = 0;
  let cierres = 0;
  // RED-121-3: un DNS que cambia de respuesta. La primera, pública; las
  // siguientes, loopback. El examinador pregunta UNA vez por medición.
  let consultasRebind = 0;
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
          : { ip: "127.0.0.1", puerto: ip === PUBLICA || ip === PUBLICA_DE_TERCEROS ? puertoSitio : puertoCanario },
    }),
    resolver: resolvedorDoble({
      "cdn-v6.test": [IPV6_SIN_RUTA],
      "video.test": [PUBLICA_DE_TERCEROS],
      "reto.test": [PUBLICA_DE_TERCEROS],
      "otro.test": [PUBLICA_DE_TERCEROS],
      "widget.test": [PUBLICA_DE_TERCEROS],
      "idp.test": [PUBLICA_DE_TERCEROS],
      "rebind.test": () => (consultasRebind++ === 0 ? [PUBLICA_DE_TERCEROS] : ["127.0.0.1"]),
      "sitio.test": [PUBLICA],
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

/**
 * El detalle que se espera de un fallo cuyo MOTIVO depende de la máquina
 * —`cdn-v6.test` falla en el acto sin ruta IPv6, y con ruta espera el plazo—:
 * el motivo sale del código, y así se afirma además que son del mismo pedido.
 */
function detalleDe(
  render: ResultadoRenderizado,
  pedido: Omit<DetalleDelSubrecurso, "motivo" | "noLlegaron">
): DetalleDelSubrecurso {
  const motivo = render.estado === "fallo" ? render.codigo.replace(/^subrecurso-/, "") : "medido";
  return { ...pedido, motivo: motivo as MotivoDeSubrecurso, noLlegaron: 1 };
}

/**
 * Las mismas dependencias, anotando cada pedido que el navegador le pasa al
 * interceptor con el marco desde el que sale: para afirmar que un pedido
 * SALIÓ de un marco de otro sitio, y no de la página.
 */
function registrando(d: DependenciasRender) {
  const vistos: Array<{ url: string; tipo: string; urlDelMarco: string | null }> = [];
  const abrir = d.abrirNavegador;
  const conRegistro: DependenciasRender = {
    ...d,
    abrirNavegador: async () => {
      const n = await abrir();
      return {
        nuevaPagina: async (opciones) => {
          const p = await n.nuevaPagina(opciones);
          return {
            ...p,
            interceptar: (atender) =>
              p.interceptar((pedido) => {
                vistos.push({ url: pedido.url, tipo: pedido.tipo, urlDelMarco: pedido.urlDelMarco });
                return atender(pedido);
              }),
          };
        },
        cerrar: () => n.cerrar(),
      };
    },
  };
  return { deps: conRegistro, vistos };
}

/** El punto de una página híbrida: el menú servido contra lo que se contó. */
const puntoHibrida = (render: Awaited<ReturnType<typeof medirRenderizado>>) =>
  contenidoSinJs({
    acceso: TODOS_ENTRAN,
    caracteresSinJs: textoSinJavaScript(hibrida("")),
    caracteresRenderizados: render,
    schema: [],
    tieneLlmsTxt: false,
  }).estado;

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
        expect(render.detalle).toEqual(detalleDe(render, { tipo: "script", host: "cdn-v6.test", ruta: "/app.js", origen: "pagina" }));
        await new Promise((listo) => setTimeout(listo, 100));
        expect(noCapturadas).toEqual([]);
      } finally {
        process.off("uncaughtException", anotar);
      }
    },
    60_000
  );

  describe("RT-4 — lo que pide un marco de OTRO SITIO no decide si la página se midió", () => {
    const punto = (render: Awaited<ReturnType<typeof medirRenderizado>>) =>
      contenidoSinJs({
        acceso: TODOS_ENTRAN,
        caracteresSinJs: textoSinJavaScript(CON_VIDEO),
        caracteresRenderizados: render,
        schema: [],
        tieneLlmsTxt: false,
      }).estado;
    const noLlego = (b: Bitacora, url: string) =>
      b.bloqueados.some((x) => x.url === url && (x.motivo === "sin-respuesta" || x.motivo === "timeout"));

    it(
      "el caso de vulkan-studios.com: el `fetch` sólo-IPv6 del desafío, dentro del reproductor, no deja la página sin número",
      async () => {
        const b = bitacora();
        const render = await medirRenderizado("http://sitio.test/con-video", deps(), undefined, b);
        console.log(`[RT-4 /con-video] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        // El marco del desafío PIDIÓ, y no le llegó: si no, esto no prueba nada.
        expect(noLlego(b, "https://cdn-v6.test/sonda")).toBe(true);
        expect(b.noLlegaron).toEqual([]);
        expect(render.estado).toBe("medido");
        // Y el bundle de la página se contó: el punto sale ROJO.
        expect(punto(render)).toBe("rojo");
      },
      60_000
    );

    it(
      "el documento de un marco de otro sitio que no llega tampoco decide: la página se mide",
      async () => {
        const b = bitacora();
        const render = await medirRenderizado("http://sitio.test/con-video-caido", deps(), undefined, b);
        console.log(`[RT-4 /con-video-caido] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        expect(noLlego(b, "https://cdn-v6.test/embed")).toBe(true);
        expect(b.noLlegaron).toEqual([]);
        expect(render.estado).toBe("medido");
      },
      60_000
    );

    it(
      "lo que no le llega a un marco del MISMO origen sigue dejando la página sin número",
      async () => {
        const b = bitacora();
        const render = await medirRenderizado("http://sitio.test/con-marco-propio", deps(), undefined, b);
        console.log(`[RT-4 /con-marco-propio] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        expect(render.estado).toBe("fallo");
        if (render.estado !== "fallo") return;
        expect(["subrecurso-sin-respuesta", "subrecurso-timeout"]).toContain(render.codigo);
        expect(b.noLlegaron.map((n) => n.url)).toEqual(["https://cdn-v6.test/widget.js"]);
        // Un marco con URL de red del sitio de la página, que no es la página.
        expect(render.detalle).toEqual(
          detalleDe(render, { tipo: "script", host: "cdn-v6.test", ruta: "/widget.js", origen: "mismo-sitio" })
        );
      },
      60_000
    );
  });

  describe("FV-1 — una navegación de la PESTAÑA que no se confirma no cambia de qué sitio es la página", () => {
    const punto = (render: Awaited<ReturnType<typeof medirRenderizado>>) =>
      contenidoSinJs({
        acceso: TODOS_ENTRAN,
        caracteresSinJs: textoSinJavaScript(hibrida("")),
        caracteresRenderizados: render,
        schema: [],
        tieneLlmsTxt: false,
      }).estado;

    it.each([
      ["/se-va-204", "http://otro.test/vacio", "un 204"],
      ["/se-va-descarga", "http://otro.test/catalogo.zip", "un archivo que Chromium trata como descarga"],
      ["/se-va-detenida", "http://otro.test/lento", "una navegación cortada con `window.stop()`"],
    ])(
      "%s: la pestaña intenta irse a otro sitio (%s, %s) y el `fetch` propio que no llega deja la página sin número",
      async (ruta, destino) => {
        const b = bitacora();
        const render = await medirRenderizado(`http://sitio.test${ruta}`, deps(), undefined, b);
        console.log(`[FV-1 ${ruta}] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        // La navegación salió por el transporte: si no, esto no prueba nada.
        expect(b.pedidos.map((p) => p.url)).toContain(destino);
        expect(render.estado).toBe("fallo");
        if (render.estado !== "fallo") return;
        expect(["subrecurso-sin-respuesta", "subrecurso-timeout"]).toContain(render.codigo);
        expect(b.noLlegaron.map((n) => n.url)).toEqual(["https://cdn-v6.test/datos"]);
        expect(render.detalle).toEqual(detalleDe(render, { tipo: "fetch", host: "cdn-v6.test", ruta: "/datos", origen: "pagina" }));
        expect(punto(render)).toBe("no-medido");
      },
      60_000
    );

    it(
      "y un pedido de la página que estaba EN VUELO cuando la pestaña intentó irse tampoco se descarta al no llegar",
      async () => {
        const b = bitacora();
        const render = await medirRenderizado("http://sitio.test/se-va-en-vuelo", deps(), undefined, b);
        console.log(`[FV-1 /se-va-en-vuelo] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        expect(b.pedidos.map((p) => p.url)).toContain("http://otro.test/vacio");
        expect(render.estado).toBe("fallo");
        if (render.estado !== "fallo") return;
        expect(["subrecurso-sin-respuesta", "subrecurso-timeout"]).toContain(render.codigo);
        expect(b.noLlegaron.map((n) => n.url)).toEqual(["http://sitio.test/corta-tarde"]);
        expect(render.detalle).toEqual(detalleDe(render, { tipo: "fetch", host: "sitio.test", ruta: "/corta-tarde", origen: "pagina" }));
      },
      60_000
    );

    it(
      "el control: con los datos al alcance, la misma página se mide y lo que escriben se cuenta —ROJO—",
      async () => {
        // Sin esto, los rojos de arriba podrían venir de que la navegación
        // rompe la medición y no de que el `fetch` propio cuenta.
        const b = bitacora();
        const render = await medirRenderizado("http://sitio.test/se-va-y-llega", deps(), undefined, b);
        console.log(`[FV-1 /se-va-y-llega] renderizado=${JSON.stringify(render)}`);
        expect(b.pedidos.map((p) => p.url)).toContain("http://otro.test/vacio");
        expect(render.estado).toBe("medido");
        if (render.estado !== "medido") return;
        expect(render.caracteres).toBeGreaterThan((render.servidos ?? 0) + contarCaracteres(CONTENIDO_DEL_BUNDLE) - 10);
        expect(punto(render)).toBe("rojo");
      },
      60_000
    );
  });

  describe("F2 — los marcos que RT-4 cuenta como de la página, con Chromium", () => {
    // El cuarto valor es de dónde salió según el detalle, con lo que Chromium
    // dice del marco: `blob:` y `about:srcdoc` no tienen URL de red.
    it.each([
      ["/con-marco-blob", `http://sitio.test${CAIDO}blob.js`, "un marco `blob:` que armó la página", "marco-desconocido"],
      ["/con-marco-srcdoc", `http://sitio.test${CAIDO}srcdoc.js`, "un marco `srcdoc`", "marco-desconocido"],
      [
        "/con-anidado",
        `http://sitio.test${CAIDO}adentro.js`,
        "un marco del sitio de la página ADENTRO de uno de otro sitio",
        "mismo-sitio",
      ],
    ] as const)(
      "%s: el script que no llega a %s (%s) deja la página sin número",
      async (ruta, perdido, _caso, origen) => {
        const b = bitacora();
        const render = await medirRenderizado(`http://sitio.test${ruta}`, deps(), undefined, b);
        console.log(`[F2 ${ruta}] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        expect(render).toEqual({
          estado: "fallo",
          codigo: "subrecurso-sin-respuesta",
          detalle: { tipo: "script", host: "sitio.test", ruta: new URL(perdido).pathname, origen, motivo: "sin-respuesta", noLlegaron: 1 },
        });
        expect(b.noLlegaron.map((n) => n.url)).toEqual([perdido]);
      },
      60_000
    );

    it(
      "el control del anidado: el marco del sitio de la página, adentro de uno de otro sitio, ESCRIBE en ella por `window.top` —ROJO—",
      async () => {
        // Por esto cuenta: si se juzgara por el marco de afuera (otro sitio),
        // lo que no le llega a éste quedaría fuera, y escribe en la página.
        const render = await medirRenderizado("http://sitio.test/con-anidado-ok", deps());
        console.log(`[F2 /con-anidado-ok] renderizado=${JSON.stringify(render)}`);
        expect(render.estado).toBe("medido");
        if (render.estado !== "medido") return;
        expect(render.caracteres).toBeGreaterThan((render.servidos ?? 0) + contarCaracteres(CONTENIDO_DEL_BUNDLE) - 10);
        expect(puntoHibrida(render)).toBe("rojo");
      },
      60_000
    );
  });

  it(
    "RED-121-3 — un marco de OTRO sitio (OOPIF) que intenta loopback, metadata, 10.x, rebinding, redirecciones, keepalive, beacon, WebSocket, EventSource, workers, un formulario y su propia navegación: CERO al canario",
    async () => {
      const r = registrando(deps());
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/con-marco-hostil", r.deps, undefined, b);
      const visto = await canarioDespues(1_500);
      console.log(
        `[RED-121-3 /con-marco-hostil] render=${JSON.stringify(render)} pedidos=${JSON.stringify(b.pedidos)} canario=${JSON.stringify(visto)}`
      );
      expect(render.estado).toBe("medido");
      expect(visto, "ni un socket ni un datagrama llegó a una dirección que no es pública").toEqual({
        conexiones: 0,
        pedidos: [],
        udp: 0,
      });
      // Todo lo que el transporte pidió de verdad fue a una dirección pública.
      expect(b.pedidos.filter((p) => p.ip !== PUBLICA && p.ip !== PUBLICA_DE_TERCEROS)).toEqual([]);
      // Esos pedidos SALIERON DEL MARCO de otro sitio: lo que se ejerció es
      // la rama de los marcos ajenos, no la de la página.
      const delMarco = r.vistos.filter((v) => v.urlDelMarco?.startsWith("http://video.test/")).map((v) => v.url);
      const hostiles = [
        "http://169.254.169.254/latest/meta-data/iam/ajeno",
        "http://10.0.0.7/ajeno",
        "http://mixto.test/ajeno",
        "http://interno.test/ajeno.js",
      ];
      expect(delMarco).toEqual(expect.arrayContaining([...hostiles, "http://video.test/redir-loopback", "http://rebind.test/ajeno"]));
      expect(b.bloqueados).toEqual(
        expect.arrayContaining([
          ...hostiles.map((url) => ({ url, motivo: "red-no-publica" })),
          // Las redirecciones del marco, y su navegación a la metadata.
          { url: "http://127.0.0.1/admin", motivo: "red-no-publica" },
          { url: "http://169.254.169.254/latest/meta-data/", motivo: "red-no-publica" },
          { url: "http://169.254.169.254/latest/meta-data/navegacion", motivo: "red-no-publica" },
        ])
      );
      // El rebinding: el nombre se resolvió UNA vez, y se conectó a ESA dirección.
      expect(b.pedidos).toContainEqual({ url: "http://rebind.test/ajeno", ip: PUBLICA_DE_TERCEROS });
    },
    60_000
  );

  it(
    "RED-121-2 — 12 segmentos EN PARALELO de un marco de otro sitio no pasan SU presupuesto, y la página se mide igual —ROJO—",
    async () => {
      const d = deps();
      const tope = 1_000_000;
      let entregados = 0;
      let bajados = 0;
      const transporte: Transporte = async (p) => {
        const segmento = p.url.includes("/segmento-");
        const presupuesto =
          segmento && p.presupuesto
            ? (bytes: number) => {
                const alcanza = p.presupuesto?.(bytes) ?? true;
                if (alcanza) bajados += bytes;
                return alcanza;
              }
            : p.presupuesto;
        const r = await d.transporte({ ...p, ...(presupuesto ? { presupuesto } : {}) });
        if (segmento && r.tipo === "respuesta") entregados += r.cuerpo.length;
        return r;
      };
      const b = bitacora();
      const render = await medirRenderizado(
        "http://sitio.test/con-marco-que-baja",
        { ...d, transporte },
        { ...OPCIONES_RENDER, maxBytesDeOtrosSitios: tope, maxBytesPorRespuesta: 600_000 },
        b
      );
      const salieron = b.pedidos.filter((p) => p.url.includes("/segmento-")).length;
      console.log(
        `[RED-121-2 /con-marco-que-baja] render=${JSON.stringify(render)} salieron=${salieron} entregados=${entregados} bajados=${bajados}`
      );
      // Salieron varios a la vez: si no, esto no prueba el paralelo.
      expect(salieron).toBeGreaterThan(2);
      // Antes: 12 × 450 000 = 5,4 MB entregados contra 1 MB.
      expect(entregados).toBeLessThanOrEqual(tope);
      expect(bajados).toBeLessThanOrEqual(tope);
      expect(b.bloqueados.some((x) => x.url.includes("/segmento-") && x.motivo === "presupuesto")).toBe(true);
      // Y lo de otro sitio no decide: la página se midió, con su bundle.
      expect(render.estado).toBe("medido");
      expect(puntoHibrida(render)).toBe("rojo");
    },
    60_000
  );

  describe("FV-4 — un worker y un `EventSource` también escriben el texto", () => {
    // El tipo y el origen son los que Chromium da: el `importScripts` sale
    // `other` y sin marco; el `EventSource`, desde la página.
    it.each([
      ["/worker-caido", `http://sitio.test${CAIDO}lib.js`, "el `importScripts` de un worker", "other", "worker"],
      ["/eventsource-caido", `http://sitio.test${CAIDO}sse`, "un `EventSource`", "eventsource", "pagina"],
    ] as const)(
      "%s: si no llega %s (%s), la página queda sin número",
      async (ruta, perdido, _caso, tipo, origen) => {
        const b = bitacora();
        const render = await medirRenderizado(`http://sitio.test${ruta}`, deps(), undefined, b);
        console.log(`[FV-4 ${ruta}] renderizado=${JSON.stringify(render)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        expect(render).toEqual({
          estado: "fallo",
          codigo: "subrecurso-sin-respuesta",
          detalle: { tipo, host: "sitio.test", ruta: new URL(perdido).pathname, origen, motivo: "sin-respuesta", noLlegaron: 1 },
        });
        expect(b.noLlegaron.map((n) => n.url)).toEqual([perdido]);
      },
      60_000
    );

    it.each(["/worker-ok", "/eventsource-ok"])(
      "el control (%s): lo que trae se escribe y se cuenta —ROJO—",
      async (ruta) => {
        const render = await medirRenderizado(`http://sitio.test${ruta}`, deps());
        console.log(`[FV-4 ${ruta}] renderizado=${JSON.stringify(render)}`);
        expect(render.estado).toBe("medido");
        expect(puntoHibrida(render)).toBe("rojo");
      },
      60_000
    );
  });

  /**
   * Con el #121 en producción, el negocio QA (https://vulkan-studios.com)
   * seguía en `subrecurso-sin-respuesta` desde la red de Vercel y nada decía
   * qué pedido faltó. El detalle lo dice, con lo que Chromium da del pedido.
   */
  describe("el fallo dice CUÁL pedido no llegó, con Chromium", () => {
    it(
      "/con-token: el `fetch` propio que no llega sale en el detalle con su ruta, SIN la query ni el fragmento",
      async () => {
        const b = bitacora();
        const render = await medirRenderizado("http://sitio.test/con-token", deps(), undefined, b);
        console.log(`[DETALLE /con-token] renderizado=${JSON.stringify(render)}`);
        // El pedido llegó al interceptor CON su query y su fragmento —MEDIDO
        // con Chrome: puppeteer da la URL con el `#`—; si no, esto no prueba
        // nada.
        expect(b.noLlegaron.map((n) => n.url)).toEqual([
          `http://sitio.test${CAIDO}datos;v=2?token=SECRETO-de-la-integracion&x=1#SECRETO-fragmento`,
        ]);
        expect(render).toEqual({
          estado: "fallo",
          codigo: "subrecurso-sin-respuesta",
          detalle: {
            tipo: "fetch",
            host: "sitio.test",
            ruta: `${CAIDO}datos;v=2`,
            origen: "pagina",
            motivo: "sin-respuesta",
            noLlegaron: 1,
          },
        });
        expect(JSON.stringify(render)).not.toMatch(/SECRETO|token=/);
      },
      60_000
    );
  });

  /**
   * LO QUE NO CUBRE, fijado. El encabezado de `renderizado.ts` dice que estas
   * formas salen `medido` y VERDE; reproducidas por la revisión con Chrome
   * 155 y el headless shell 153. Cada una con su oráculo: la misma página con
   * todo al alcance es ROJA, así que el verde es falso. Si un cambio las
   * vuelve «no medidas», este test se pone rojo, y el encabezado se corrige.
   */
  describe("LO QUE NO CUBRE: hoy salen VERDES, con su oráculo ROJO", () => {
    it.each([
      ["/oidc", "FV-2: el silent-auth de OIDC cuyo primer salto (el IdP, otro sitio) no llega"],
      ["/avisa", "FV-3: la página espera el `postMessage` de un marco de otro sitio cuyo DOCUMENTO no llega"],
      ["/widget-pm", "FV-3: un widget de otro sitio cuyo `fetch` no llega le pasa los datos a la página"],
    ])(
      "%s (%s)",
      async (base) => {
        const ok = await medirRenderizado(`http://sitio.test${base}-ok`, deps());
        const b = bitacora();
        const caido = await medirRenderizado(`http://sitio.test${base}-caido`, deps(), undefined, b);
        console.log(`[NO CUBRE ${base}] ok=${JSON.stringify(ok)} caido=${JSON.stringify(caido)} noLlegaron=${JSON.stringify(b.noLlegaron)}`);
        expect(ok.estado).toBe("medido");
        expect(puntoHibrida(ok)).toBe("rojo");
        // Lo que no llegó, no llegó —está en la bitácora—, y no decidió.
        expect(b.bloqueados.some((x) => x.url.includes(CAIDO) && x.motivo === "sin-respuesta")).toBe(true);
        expect(caido.estado).toBe("medido");
        expect(puntoHibrida(caido)).toBe("verde");
      },
      90_000
    );

    it(
      "un `SharedWorker` (FV-4): lo que pide no pasa por la intercepción, así que ni con los datos al alcance escribe —VERDE—",
      async () => {
        const render = await medirRenderizado("http://sitio.test/compartido", deps());
        console.log(`[NO CUBRE /compartido] renderizado=${JSON.stringify(render)}`);
        expect(render.estado).toBe("medido");
        expect(puntoHibrida(render)).toBe("verde");
      },
      60_000
    );
  });

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
        expect(render).toEqual({
          estado: "fallo",
          codigo: "subrecurso-timeout",
          detalle: { tipo: "script", host: "sitio.test", ruta: "/app-lento.js", origen: "pagina", motivo: "timeout", noLlegaron: 1 },
        });
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
        expect(render).toEqual({
          estado: "fallo",
          codigo: "subrecurso-demasiado-grande",
          detalle: {
            tipo: "script",
            host: "sitio.test",
            ruta: "/app-grande.js",
            origen: "pagina",
            motivo: "demasiado-grande",
            noLlegaron: 1,
          },
        });
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

      expect(render.estado).toBe("medido");
      if (render.estado === "medido") expect(render.caracteres).toBeGreaterThan(MINIMO_DE_TEXTO);
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
