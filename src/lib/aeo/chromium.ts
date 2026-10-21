/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el Chromium de la auditoría AEO salga a la red por su cuenta.
 *
 * `renderizado.ts` hace en Node todos los pedidos que la página necesita y se
 * los entrega al navegador ya examinados. Eso sólo vale si el navegador NO
 * PUEDE pedir nada solo, y la intercepción de puppeteer no lo garantiza —
 * MEDIDO con Chrome 154 contra un servidor canario local: con todos los pedidos
 * HTTP interceptados y abortados, un `WebSocket` llegó al canario (`UPGRADE`)
 * y dos `<link rel="preconnect">` abrieron sockets TCP (3 conexiones). Con las
 * banderas de abajo, cero. Lo vuelve a medir `renderizado.integracion.test.ts`
 * en cada corrida con Chrome.
 *
 *   --proxy-server=http://127.0.0.1:1   todo el tráfico propio de Chromium —http,
 *                                        https, ws, wss— va a un proxy que no
 *                                        existe y falla en la máquina. Un proxy
 *                                        fijo no cae a DIRECT: sólo un PAC puede.
 *   --proxy-bypass-list=<-loopback>     Chromium saltea el proxy para loopback por
 *                                        defecto; esto le saca esa excepción, que
 *                                        es justo la red de la API de runtime de
 *                                        Lambda.
 *   --host-resolver-rules=MAP * ~NOTFOUND
 *                                        su resolvedor no contesta nada: un
 *                                        prefetch de DNS tampoco sale.
 *
 *   --webrtc-ip-handling-policy=disable_non_proxied_udp
 *   --force-webrtc-ip-handling-policy=disable_non_proxied_udp
 *                                        WebRTC no manda UDP por fuera del proxy.
 *                                        Hacen falta LAS DOS: cada binario
 *                                        escucha una (ver abajo).
 *   --block-new-web-contents             `window.open` no abre nada: un popup es
 *                                        otro target, y ni la intercepción ni
 *                                        `evaluateOnNewDocument` llegan a él.
 *
 * WEBRTC ES OTRA SALIDA, Y EL PROXY Y EL RESOLVEDOR NO LA CIERRAN. Un
 * `RTCPeerConnection` con un servidor STUN manda UDP directo a la dirección que
 * la página elija. MEDIDO con Chrome 154 y un canario UDP en loopback: 4
 * paquetes sin banderas, 4 con el proxy y el resolvedor, 4 con la `--force-…`
 * sola, y 0 con la `--webrtc-…` sola. Y MEDIDO al revés en el binario que
 * corre en Vercel (RV-1: headless shell 153 de `@sparticuz/chromium`, en un
 * contenedor `public.ecr.aws/lambda/nodejs:24` con AL2023): la `--webrtc-…`
 * sola dejó salir 8 datagramas y la `--force-…` CON valor los cerró. Por eso
 * van las dos, y el test de integración corre con los dos binarios.
 *
 * Además, el constructor no existe en la pestaña: `sinWebRtc` lo borra de cada
 * documento ANTES de que corra el JavaScript de la página
 * (`evaluateOnNewDocument`, que también llega a un `<iframe>` recién creado).
 * Pero NO llega a un popup: con la configuración de producción entera, una
 * página que hace `window.open("about:blank")` y usa `w.RTCPeerConnection`
 * mandó UDP en headless shell 153 —y puppeteer agrega
 * `--disable-popup-blocking` por defecto—. Al popup lo cierran las banderas de
 * WebRTC, y además `--block-new-web-contents`, que no deja que exista.
 *
 * LAS DOS CAPAS SON REDUNDANTES A PROPÓSITO, y está medido. Contra el mismo
 * canario, con un `WebSocket` y dos `preconnect` a loopback: sin banderas, 4
 * conexiones; sólo el proxy (con `<-loopback>`), 0; sólo el resolvedor apagado,
 * 0 —`MAP *` alcanza también a las IP literales—; el proxy SIN `<-loopback>`,
 * 4. Cada capa basta sola, así que borrar una no pone rojo un test que corra
 * con las dos: por eso el test de integración arranca Chromium con todas las
 * capas y con cada una sola (`capasDeRed`, WebRTC con sus banderas solas y con
 * su constructor borrado solo, y el popup con las banderas de WebRTC solas y
 * con `--block-new-web-contents` sola), y afirma cero en todas. Borrar una
 * bandera de acá pone rojo el caso de su capa en el binario que la escucha.
 *
 * Además: las descargas se deniegan por CDP —MEDIDO: sin eso, una página que
 * arma un `Blob` y hace clic en un `<a download>` escribe el archivo en disco, y
 * esa descarga no pasa por la red ni por el transporte—, los service workers se
 * saltean, y
 * de los argumentos de `@sparticuz/chromium` se sacan dos que no tienen nada
 * que ver con correr en Lambda: `--disable-web-security` (apaga CORS: la página
 * podría leer respuestas de otros orígenes que un navegador real no le
 * mostraría) y `--allow-running-insecure-content`. Un render con menos
 * seguridad que la de un navegador de verdad no mide la página que ve una
 * persona.
 *
 * QUÉ CHROMIUM
 *
 * En Vercel, el de `@sparticuz/chromium` (153.0.0, que es el Chrome 153 de
 * `puppeteer-core` 25.11.0: las dos versiones van juntas y fijadas exactas).
 * Detecta solo que la función de Vercel con Node 20 o más es Amazon Linux 2023 y
 * descomprime sus bibliotecas en `/tmp`. Fuera de Vercel ese binario no corre
 * —es Linux x64—, así que `AEO_CHROME_PATH` apunta a un Chrome local: es lo que
 * usa el test de integración, y lo que hace falta para `npm run dev` en la Mac.
 *
 * Las dos dependencias se importan ADENTRO de la función, no arriba: la ruta
 * de auditoría importa este archivo, y el barrido de rutas, el build y cada
 * pedido que no llega a renderizar no tienen por qué cargar un navegador.
 */
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, CDPSession, HTTPRequest, LaunchOptions, Page } from "puppeteer-core";
import { resolverDns } from "@/lib/profile/nodeTransport";
import type {
  AbrirNavegador,
  DependenciasRender,
  NavegadorAbierto,
  PaginaAbierta,
  PedidoDelNavegador,
  SalidaPropia,
  SalidaPropiaVista,
} from "./renderizado";
import { crearTransporteRender } from "./transporteRender";

/** El navegador sin red propia. Ver el encabezado: cada una está medida. */
export const BANDERAS_SIN_RED = [
  "--proxy-server=http://127.0.0.1:1",
  "--proxy-bypass-list=<-loopback>",
  "--host-resolver-rules=MAP * ~NOTFOUND",
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--block-new-web-contents",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--no-pings",
] as const;

/**
 * Las dos capas por separado, para que el test de integración pruebe cada una
 * sola (ver el encabezado). Se derivan de `BANDERAS_SIN_RED`, no se copian: si
 * alguien borra una bandera de arriba, su capa queda sin ella y su caso cae.
 */
const esProxy = (b: string) => b.startsWith("--proxy-");
const esResolvedor = (b: string) => b.startsWith("--host-resolver-rules");
const esWebRtc = (b: string) => b.startsWith("--webrtc-") || b.startsWith("--force-webrtc-");
const esPopup = (b: string) => b === "--block-new-web-contents";
export const capasDeRed = {
  proxy: BANDERAS_SIN_RED.filter((b) => !esResolvedor(b) && !esWebRtc(b)),
  resolvedor: BANDERAS_SIN_RED.filter((b) => !esProxy(b) && !esWebRtc(b)),
  /** Para el popup: sólo las banderas de WebRTC cierran su UDP. */
  webRtc: BANDERAS_SIN_RED.filter((b) => !esPopup(b)),
  /** Para el popup: sólo `--block-new-web-contents`, sin las de WebRTC. */
  popup: BANDERAS_SIN_RED.filter((b) => !esWebRtc(b)),
};

/** Lo que `@sparticuz/chromium` agrega y un render fiel no puede llevar. */
const SIN_SEGURIDAD = new Set(["--disable-web-security", "--allow-running-insecure-content"]);

const VENTANA = { width: 1366, height: 768 };

/**
 * Corre en cada documento antes que el JavaScript de la página: sin estos
 * constructores no hay `RTCPeerConnection`, y sin él no hay UDP a ninguna parte.
 * Ver el encabezado: es lo único que, medido, cierra esa salida.
 */
//
// Viaja como TEXTO y no como función de TypeScript: corre en la pestaña, no en
// Node, y escrito como función nombraba el objeto global, que es justo lo que
// la pared de la credencial de la agencia (credencialDeLaAgencia.test.ts, #118)
// no deja escapar en src. Como texto, el compilador no lo ve como código del
// servidor y la pestaña lo corre igual. Una propiedad que no se deja borrar se
// tapa: lo que importa es que no construya.
// Sin "use strict" un delete que no puede borrar devuelve false en vez de
// tirar, así que la tapa no depende del catch: se pregunta si sigue ahí.
const sinWebRtc = `(() => {
  for (const nombre of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceCandidate"]) {
    try { delete globalThis[nombre]; } catch (e) {}
    if (globalThis[nombre] !== undefined) {
      Object.defineProperty(globalThis, nombre, { value: undefined, configurable: false, writable: false });
    }
  }
})();`;

/**
 * DE QUÉ WORKER ES CADA PEDIDO SIN MARCO (W-1). Lo que pide un worker llega
 * al interceptor sin marco, y hasta acá eso contaba siempre como de la
 * página: MEDIDO en producción el 2026-10-21 contra https://vulkan-studios.com,
 * el `fetch` a `brunhild.challenges.cloudflare.com` que dejaba el render
 * `subrecurso-sin-respuesta` lo hacía un WORKER que crea el desafío de
 * Cloudflare, en su marco de otro sitio dentro del reproductor de Vimeo.
 *
 * Chromium sí dice de qué worker es: cada pedido de un worker sale, en la
 * sesión de CDP de ESE worker, como `Network.requestWillBeSent` con la URL de
 * su script en `documentURL`. MEDIDO con Chrome 155 y con el headless shell
 * 153 en AL2023, también para el `importScripts`, el `fetch` de un worker
 * creado por otro worker, uno `blob:` y uno `data:`. Lo que NO sirve es la
 * sesión que trae el pedido interceptado (`req.client`): con el headless
 * shell, el `fetch` de un worker —también el del desafío— llega por la
 * sesión de la PESTAÑA, y con Chrome el `importScripts` y el de un worker
 * anidado también. Ni la pila del `initiator`, que nombra el script que
 * llamó, y ése puede ser una biblioteca de otro sitio que el worker importó.
 *
 * Por eso se escucha a cada worker desde que existe —`workercreated` sale
 * antes de que corra su primera línea (ver `vigilarSalidasPropias`)— y se
 * anota, por pedido, la URL de su script. Un pedido sin marco que no está
 * anotado queda sin worker, y cuenta (falla cerrado).
 */
function scriptsDeLosWorkers(page: Page): Map<string, string> {
  const porPedido = new Map<string, string>();
  page.on("workercreated", (worker) => {
    const script = worker.url();
    worker.client.on("Network.requestWillBeSent", (e) => {
      porPedido.set(e.requestId, e.documentURL || script);
    });
  });
  return porPedido;
}

/**
 * El `requestId` de CDP del pedido: el mismo del `Network.requestWillBeSent`
 * que anota `scriptsDeLosWorkers`. puppeteer lo tiene (`CdpHTTPRequest.id`)
 * pero lo marca `@internal` y su tipo público no lo trae; la versión está
 * fijada exacta (ver «QUÉ CHROMIUM»). Emparejar por URL no sirve: dos workers
 * que piden la misma URL a la vez se confunden, y el de la página podía pasar
 * por el de otro sitio. Si un día no está, el pedido queda sin worker y cuenta
 * —falla cerrado—, y la integración con el marco de otro sitio se pone roja.
 */
function idDelPedido(req: HTTPRequest): string | null {
  const id = (req as unknown as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : null;
}

async function adaptar(req: HTTPRequest, page: Page, scripts: Map<string, string>): Promise<PedidoDelNavegador> {
  // Lo que decide de dónde sale el pedido se lee AL ENTRAR (FV-1), antes de
  // cualquier espera.
  const marco = req.frame();
  const urlDeLaPagina = page.mainFrame().url();
  let cuerpo = req.postData();
  if (cuerpo === undefined && req.hasPostData()) cuerpo = await req.fetchPostData();
  let urlDelWorker: string | null = null;
  if (marco === null) {
    // El aviso del worker puede llegar en el MISMO mensaje de CDP que suelta
    // este pedido —puppeteer lo empareja con el `Fetch.requestPaused` que ya
    // tenía—, y a un oyente que corre DESPUÉS del de puppeteer: se lo lee un
    // turno más tarde. Si igual no está, el pedido queda sin worker y cuenta.
    // Para el mismo mensaje alcanzaría una microtarea —es lo que prueba
    // `chromiumWorkers.test.ts`, y el mutante que cambia el turno por una
    // microtarea sobrevive, equivalente ahí—; el turno entero cubre además un
    // aviso que llegue en otro mensaje del mismo lote de E/S, que un test no
    // puede ordenar.
    await new Promise<void>((listo) => setImmediate(listo));
    const id = idDelPedido(req);
    if (id !== null) {
      urlDelWorker = scripts.get(id) ?? null;
      scripts.delete(id);
    }
  }
  return {
    url: req.url(),
    metodo: req.method(),
    encabezados: req.headers(),
    cuerpo,
    tipo: req.resourceType(),
    esDocumentoPrincipal: req.isNavigationRequest() && marco === page.mainFrame(),
    // El marco que pide (RT-4). En un `<iframe>` de otro sitio —que Chromium
    // corre en otro proceso— puppeteer igual lo da: es el marco hijo, con su
    // URL. Sin marco (un worker), `null`, y se juzga por el worker (W-1).
    urlDelMarco: marco?.url() ?? null,
    urlDelWorker,
    // El documento CONFIRMADO de la pestaña (FV-1): puppeteer cambia la URL
    // del marco con `Page.frameNavigated`, que Chromium manda al confirmar,
    // no al pedir. Un 204, una descarga denegada o un `window.stop()` no la
    // cambian. Antes `renderizado.ts` tomaba el último PEDIDO de navegación,
    // y con un 204 a otro sitio los `fetch` de la página pasaban por ajenos.
    urlDeLaPagina,
    continuar: () => req.continue(),
    abortar: () => req.abort("blockedbyclient"),
    responder: (r) => req.respond({ status: r.status, headers: r.encabezados, body: r.cuerpo }),
  };
}

/**
 * El nombre de la función que Chromium pone en cada contexto de la pestaña
 * (`Runtime.addBinding`) para que `avisarSalidas` le diga qué socket abre. Lo
 * llama la página y lo recibe CDP con el contexto que lo llamó.
 */
const AVISO_DE_SALIDA = "__aeoSalidaPropia";

/**
 * Corre en cada documento antes que el JavaScript de la página, como
 * `sinWebRtc` y por la misma razón viaja como texto. Envuelve `WebSocket` y
 * `WebTransport` para que, DESPUÉS de construir uno, el contexto avise su URL
 * por la función de CDP. El aviso no decide si cuenta: sólo dice DESDE QUÉ
 * CONTEXTO salió, y el origen de ese contexto lo pone Chromium, no la página
 * (ver `vigilarSalidasPropias`). La función se toma y se borra del global
 * antes de que corra nada de la página.
 *
 * Una página que esquiva el envoltorio —`WebSocket.prototype.constructor`—
 * sólo se queda sin aviso, y un socket sin aviso cuenta: esquivarlo no da un
 * verde. Y la URL se normaliza como lo hace el navegador (relativa al
 * documento, `http(s)` → `ws(s)` en un `WebSocket`), para que coincida con la
 * que avisa CDP; si no coincide, tampoco hay aviso, y cuenta.
 */
const avisarSalidas = `(() => {
  const avisar = globalThis[${JSON.stringify(AVISO_DE_SALIDA)}];
  try { delete globalThis[${JSON.stringify(AVISO_DE_SALIDA)}]; } catch (e) {}
  if (typeof avisar !== "function") return;
  const envolver = (nombre, tipo, deSocket) => {
    const Original = globalThis[nombre];
    if (typeof Original !== "function") return;
    const Envuelto = new Proxy(Original, {
      construct(objetivo, args, nuevo) {
        const abierto = Reflect.construct(objetivo, args, nuevo);
        try {
          const u = new URL(String(args[0]), document.baseURI);
          if (deSocket && u.protocol === "http:") u.protocol = "ws:";
          else if (deSocket && u.protocol === "https:") u.protocol = "wss:";
          avisar(JSON.stringify({ tipo, url: u.href }));
        } catch (e) {}
        return abierto;
      },
    });
    try { Object.defineProperty(globalThis, nombre, { value: Envuelto, writable: true, configurable: true }); } catch (e) {}
  };
  envolver("WebSocket", "websocket", true);
  envolver("WebTransport", "webtransport", false);
})();`;

/**
 * Lo que la pestaña intenta abrir SIN pasar por la intercepción (F3): un
 * `WebSocket` o un `WebTransport`. El navegador no tiene red, así que nunca
 * conectan, y lo que iban a traer no está en el DOM: sin este aviso, eso no
 * dejaba rastro y el render salía `medido` —MEDIDO por la revisión con Chrome
 * 155: un menú de 619 y un `WebSocket` que escribía 4 499, `medido 619/619`
 * y VERDE—.
 *
 * Lo avisa Chromium por CDP (`Network.webSocketCreated`), no la página: un
 * envoltorio en JavaScript lo podría deshacer la página, y no llega a los
 * workers. MEDIDO con Chrome 155: el evento sale en la sesión de la pestaña
 * para el documento y sus marcos del mismo proceso, y en la del WORKER para
 * el socket que abre un worker. Por eso se escucha también cada worker, y
 * SINCRÓNICAMENTE en `workercreated`: puppeteer lo emite antes de soltar el
 * worker (`Runtime.runIfWaitingForDebugger`), así que el `Network.enable` le
 * llega antes que su primera línea.
 *
 * Y DESDE QUÉ MARCO (RT-4). El evento no dice de qué marco es, y MEDIDO con
 * el headless shell 153 —que corre con `--single-process` y sin aislamiento
 * de sitios, así que los marcos de otro sitio viven en la misma sesión—: el
 * `WebSocket` de un `<iframe>` de otro sitio salía en la sesión de la
 * pestaña igual que el de la página, y la dejaba «no medida». Con Chrome 155,
 * que aísla los sitios, ese marco es otro proceso y su socket no se ve. Para
 * que los dos binarios juzguen igual, cada contexto avisa lo que abre
 * (`avisarSalidas`) y CDP dice el ORIGEN de ese contexto
 * (`Runtime.executionContextCreated`): MEDIDO con los dos binarios, el del
 * marco de otro sitio sale con su origen, el de un `srcdoc` con el de la
 * página, y el del marco del mismo sitio con el suyo. Cada evento de la
 * pestaña se empareja con el primer aviso de la misma URL que no se usó; uno
 * sin aviso cuenta, y `renderizado.ts` decide con la regla de RT-4.
 *
 * Y EL DE UN WORKER, POR SU SCRIPT (W-1). El socket que avisa la sesión de
 * un worker lleva la URL del script de ese worker (`worker.url()`), que dice
 * su origen: `renderizado.ts` lo juzga como a los pedidos del worker, y el
 * de un worker de un marco de otro sitio no decide.
 *
 * Lo que NO ve, dicho: un `SharedWorker`, que no es de la pestaña. Su red
 * tampoco sale (el proxy que no existe), pero si trajera el contenido, el
 * render no se enteraría. Y un marco de otro sitio que la página controla
 * puede avisar la URL de un socket de la página como suyo: es la misma
 * puerta que su `postMessage` (FV-3, «LO QUE NO CUBRE» en `renderizado.ts`).
 */
async function vigilarSalidasPropias(page: Page, sesion: CDPSession): Promise<() => SalidaPropiaVista[]> {
  type Vista = { url: string; tipo: SalidaPropia; deUnWorker: boolean; urlDelWorker: string | null; urlDeLaPagina: string };
  const vistas: Vista[] = [];
  const avisos: Array<{ url: string; tipo: SalidaPropia; origen: string | null }> = [];
  const origenes = new Map<number, string>();
  // `urlDelWorker`: el script del worker en cuya sesión Chromium lo avisó (W-1).
  const vista = (tipo: SalidaPropia, deUnWorker: boolean, urlDelWorker: string | null) => (e: { url: string }) => {
    vistas.push({ url: e.url, tipo, deUnWorker, urlDelWorker, urlDeLaPagina: page.mainFrame().url() });
  };
  sesion.on("Runtime.executionContextCreated", (e) => origenes.set(e.context.id, e.context.origin));
  sesion.on("Runtime.bindingCalled", (e) => {
    if (e.name !== AVISO_DE_SALIDA) return;
    try {
      const dicho = JSON.parse(e.payload) as { tipo?: unknown; url?: unknown };
      if ((dicho.tipo !== "websocket" && dicho.tipo !== "webtransport") || typeof dicho.url !== "string") return;
      avisos.push({ url: dicho.url, tipo: dicho.tipo, origen: origenes.get(e.executionContextId) ?? null });
    } catch {
      // Un aviso ilegible no es un aviso: el socket queda sin él, y cuenta.
    }
  });
  sesion.on("Network.webSocketCreated", vista("websocket", false, null));
  sesion.on("Network.webTransportCreated", vista("webtransport", false, null));
  await sesion.send("Runtime.enable");
  await sesion.send("Runtime.addBinding", { name: AVISO_DE_SALIDA });
  await sesion.send("Network.enable");
  await page.evaluateOnNewDocument(avisarSalidas);
  page.on("workercreated", (worker) => {
    worker.client.on("Network.webSocketCreated", vista("websocket", true, worker.url()));
    worker.client.on("Network.webTransportCreated", vista("webtransport", true, worker.url()));
    void worker.client.send("Network.enable").catch(() => {});
  });
  return () => {
    const libres = [...avisos];
    return vistas.map((v) => {
      let origenDelMarco: string | null = null;
      if (!v.deUnWorker) {
        const i = libres.findIndex((a) => a.tipo === v.tipo && a.url === v.url);
        if (i >= 0) origenDelMarco = libres.splice(i, 1)[0].origen;
      }
      return {
        url: v.url,
        tipo: v.tipo,
        deUnWorker: v.deUnWorker,
        urlDelWorker: v.urlDelWorker,
        origenDelMarco,
        urlDeLaPagina: v.urlDeLaPagina,
      };
    });
  };
}

function envolverPagina(page: Page, vigilada?: { sesion: CDPSession; salidas: () => SalidaPropiaVista[] }): PaginaAbierta {
  // Una sesión de CDP por pestaña, para serializar con las sombras (`html`):
  // la de la vigilancia si la hay, y si no, una que se abre al leer.
  let sesion: Promise<CDPSession> | undefined = vigilada ? Promise.resolve(vigilada.sesion) : undefined;
  return {
    salidasPropias() {
      return vigilada?.salidas() ?? [];
    },
    async interceptar(atender) {
      const scripts = scriptsDeLosWorkers(page);
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        // Si adaptar o atender fallan, el pedido se aborta: un pedido colgado
        // frena el `load`, y uno liberado sin examen es una salida.
        void adaptar(req, page, scripts)
          .then(atender)
          .catch(() => req.abort("blockedbyclient").catch(() => {}));
      });
    },
    async navegar(url, timeoutMs) {
      await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    },
    async esperarQuietud(timeoutMs) {
      if (timeoutMs <= 0) return;
      await page.waitForNetworkIdle({ idleTime: 500, timeout: timeoutMs }).catch(() => {});
    },
    async desplazar(timeoutMs) {
      if (timeoutMs <= 0) return;
      // Una ventana por vez, con una pausa para que el `IntersectionObserver`
      // de cada sección llegue a dispararse, y al final al fondo de todo.
      await page
        .evaluate(async (tope: number) => {
          const fin = Date.now() + tope;
          for (let y = 0; Date.now() < fin && y < document.documentElement.scrollHeight; y += window.innerHeight) {
            window.scrollTo(0, y);
            await new Promise((listo) => setTimeout(listo, 100));
          }
          window.scrollTo(0, document.documentElement.scrollHeight);
        }, timeoutMs)
        .catch(() => {});
    },
    async html() {
      // La serialización del DOM, sin tocarlo: la extracción del texto es la
      // de `renderizado.ts` (`textoSinJavaScript`), y no aplica CSS. Antes
      // esto era `innerText` y, en la pestaña sin JavaScript, borraba los
      // `<noscript>` —y con ellos el `<style>` que muestra el contenido sin
      // JavaScript— (GATE-1).
      //
      // CON LAS SOMBRAS (PU-2). Después fue `page.content()`, que es
      // `outerHTML` y NO serializa los shadow roots: una página que sirve un
      // menú y dibuja el contenido en un componente (Lit, Stencil, LWC) salía
      // con renderizado = servido y VERDE —medido con Chrome 154: 529 contra
      // 529—, y un shadow DOM declarativo servido contaba 0 de los dos lados.
      // `DOM.getOuterHTML` con `includeShadowDOM` serializa CADA sombra de
      // autor —abierta, cerrada, declarativa o creada por JavaScript, también
      // anidadas— como `<template shadowrootmode>`, que `textoSinJavaScript`
      // cuenta; las del agente de usuario (`<input>`, `<video>`) no salen.
      // MEDIDO con Chrome 155 en las dos pestañas, con y sin JavaScript. Lo
      // vuelve a medir `renderizado.integracion.test.ts` con los dos binarios.
      //
      // Lo que sigue sin contar, dicho: el contenido de los MARCOS
      // (`<iframe>`, también `srcdoc`), que ninguna serialización del
      // documento trae. La pestaña sin JavaScript no los carga, y contarlos
      // sólo del lado renderizado pondría rojo a cualquier página SSR con un
      // mapa o un video incrustado; distinguir el marco que crea el
      // JavaScript del servido es una decisión aparte.
      sesion ??= page.createCDPSession();
      const cdp = await sesion;
      const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
      const { outerHTML } = await cdp.send("DOM.getOuterHTML", { nodeId: root.nodeId, includeShadowDOM: true });
      return outerHTML;
    },
  };
}

function envolverNavegador(browser: Browser, cierreMs: number, quitarWebRtc: boolean): NavegadorAbierto {
  return {
    async nuevaPagina(opcionesPagina = {}) {
      const page = await browser.newPage();
      const sinJavaScript = opcionesPagina.javascript === false;
      if (sinJavaScript) await page.setJavaScriptEnabled(false);
      else if (quitarWebRtc) await page.evaluateOnNewDocument(sinWebRtc);
      await page.setViewport(VENTANA);
      // Se dice quién mira, sin el «Headless» que algunos WAF usan para
      // contestar otra página que la que ve una persona.
      const agente = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
      await page.setUserAgent({ userAgent: `${agente} VulkanGrowthOS/1.0 (auditoria AEO; renderizado)` });
      // Sin JavaScript no hay quien abra un socket: sólo se vigila la otra (F3).
      if (sinJavaScript) return envolverPagina(page);
      const sesion = await page.createCDPSession();
      return envolverPagina(page, { sesion, salidas: await vigilarSalidasPropias(page, sesion) });
    },
    async cerrar() {
      const proceso = browser.process();
      let reloj: ReturnType<typeof setTimeout> | undefined;
      const cerrado = await Promise.race([
        browser.close().then(
          () => true,
          () => false
        ),
        new Promise<false>((listo) => {
          reloj = setTimeout(() => listo(false), cierreMs);
        }),
      ]);
      clearTimeout(reloj);
      // Un `close()` que no contestó no cerró nada. En una función de Vercel
      // ese proceso seguiría vivo en la próxima invocación.
      if (!cerrado) proceso?.kill("SIGKILL");
    },
  };
}

/**
 * La ruta al binario de `@sparticuz/chromium`, UNA descompresión por proceso.
 *
 * `executablePath()` devuelve `/tmp/chromium` apenas el archivo EXISTE, y el
 * archivo existe desde que se abre el stream que lo escribe, no desde que
 * termina. MEDIDO (RV-2) en un contenedor AL2023 con 1 vCPU y `/tmp` vacío:
 * dos auditorías en frío a la vez —en Fluid compute comparten instancia—
 * dieron `spawn ETXTBSY` en 2 de 3 corridas, porque la segunda lanzó un
 * binario a medio escribir. Con una sola promesa por proceso, la segunda
 * espera a la primera. Si la descompresión falla, la promesa se olvida y la
 * próxima apertura lo vuelve a intentar.
 *
 * Y UNA DESCOMPRESIÓN QUE NO TERMINÓ NO SE DA POR BUENA (RT-3). Un proceso que
 * muere a mitad de la descompresión —un plazo vencido, una instancia
 * reciclada— deja `/tmp` con un `chromium` a medio escribir, y `al2023/` y
 * `fonts/` sin extraer o a medias: `@sparticuz/chromium` mira sólo si el
 * archivo EXISTE (`build/index.js`, y cada `inflate` igual con su carpeta).
 * MEDIDO en un contenedor AL2023 con 1 vCPU: 30 MB del binario escritos en
 * `/tmp/chromium` dejaron la instancia en `sin-navegador` para siempre —3 de
 * 3 corridas—, y `al2023/` y `fonts/` nunca se extrajeron. Por eso, al
 * terminar la descompresión se escribe una MARCA, y si al empezar no está,
 * lo que haya de una descompresión anterior se borra antes de pedir la ruta.
 * Una instancia que ya tiene la marca reusa lo descomprimido.
 */
let rutaDeSparticuz: Promise<string> | undefined;

/** La marca de una descompresión TERMINADA, al lado de lo descomprimido. */
export const MARCA_DE_DESCOMPRESION = "aeo-chromium-completo";

/**
 * Lo que `@sparticuz/chromium` 153 extrae en `tmpdir()`: el binario, las dos
 * carpetas de sus tar (`al2023.tar.br` → `al2023/lib/…`, `fonts.tar.br` →
 * `fonts/…`) y los cinco archivos de `swiftshader.tar.br`, que van sueltos.
 * Listado de `node_modules/@sparticuz/chromium/bin/*.tar.br`; la versión está
 * fijada exacta, y con otra hay que volver a listarlo.
 */
const DESCOMPRIMIDO = [
  "chromium",
  "al2023",
  "fonts",
  "libEGL.so",
  "libGLESv2.so",
  "libvk_swiftshader.so",
  "libvulkan.so.1",
  "vk_swiftshader_icd.json",
];

async function descomprimirSinRestos(chromium: SparticuzChromium, dir: string): Promise<string> {
  const marca = path.join(dir, MARCA_DE_DESCOMPRESION);
  if (!existsSync(marca)) {
    await Promise.all(DESCOMPRIMIDO.map((n) => rm(path.join(dir, n), { recursive: true, force: true })));
  }
  const ruta = await chromium.executablePath();
  await writeFile(marca, "");
  return ruta;
}

function ejecutableDeSparticuz(cargar: () => Promise<string>): Promise<string> {
  rutaDeSparticuz ??= cargar().catch((e: unknown) => {
    rutaDeSparticuz = undefined;
    throw e;
  });
  return rutaDeSparticuz;
}

export interface OpcionesChromium {
  /** Un Chrome local. Sin esto, `AEO_CHROME_PATH`; sin eso, el de `@sparticuz/chromium`. */
  ejecutable?: string;
  cierreMs?: number;
  /**
   * Para el test de integración, que prueba cada capa sola (`capasDeRed`).
   * Producción no lo pasa y arranca con `BANDERAS_SIN_RED` enteras.
   */
  banderas?: readonly string[];
  /**
   * Para el mismo test: `false` deja el constructor de WebRTC, y así se prueba
   * la bandera de WebRTC sola. Producción no lo pasa.
   */
  quitarWebRtc?: boolean;
  /**
   * Los dos paquetes, para el test de la descompresión única (`chromium.test.ts`),
   * que necesita dobles sin depender de cómo el runner simula un `import()`
   * dinámico. Producción no lo pasa y los importa adentro de la función.
   */
  paquetes?: () => Promise<{ puppeteer: PuppeteerLanzador; chromium: () => Promise<SparticuzChromium> }>;
  /** Para el mismo test: la plataforma, que fuera de Linux sin Chrome local no arranca nada. */
  plataforma?: NodeJS.Platform;
  /**
   * Dónde descomprime `@sparticuz/chromium`: `tmpdir()`, que es lo que el
   * paquete usa. Los tests pasan una carpeta propia, para que la limpieza de
   * restos (RT-3) no toque el `tmpdir()` de la máquina.
   */
  dirTemporal?: string;
}

/** Lo que este archivo usa de `puppeteer-core`. */
type PuppeteerLanzador = { launch(opciones: LaunchOptions): Promise<Browser> };
/** Lo que este archivo usa de `@sparticuz/chromium`. */
type SparticuzChromium = { args: string[]; setGraphicsMode: boolean; executablePath(): Promise<string> };

async function paquetesDeVerdad() {
  const { default: puppeteer } = await import("puppeteer-core");
  return {
    puppeteer,
    chromium: async (): Promise<SparticuzChromium> => (await import("@sparticuz/chromium")).default,
  };
}

export function abrirChromium(opciones: OpcionesChromium = {}): AbrirNavegador {
  return async () => {
    const local = opciones.ejecutable ?? process.env.AEO_CHROME_PATH;
    const sinRed = opciones.banderas ?? BANDERAS_SIN_RED;
    // El binario de `@sparticuz/chromium` es Linux x64. Fuera de Linux, sin un
    // Chrome local, no hay navegador: se dice ya, en vez de descomprimir 180 MB
    // en `/tmp` para que después el sistema se niegue a ejecutarlos.
    if (!local && (opciones.plataforma ?? process.platform) !== "linux") {
      throw new Error("sin Chromium: fuera de Linux hace falta AEO_CHROME_PATH");
    }
    const paquetes = await (opciones.paquetes ?? paquetesDeVerdad)();
    const { puppeteer } = paquetes;

    let executablePath: string;
    let headless: boolean | "shell";
    let args: string[];
    if (local) {
      executablePath = local;
      headless = true;
      args = [...sinRed];
    } else {
      const chromium = await paquetes.chromium();
      // Sin WebGL: no cambia el texto, y ahorra descomprimir SwiftShader en
      // cada arranque en frío.
      chromium.setGraphicsMode = false;
      executablePath = await ejecutableDeSparticuz(() => descomprimirSinRestos(chromium, opciones.dirTemporal ?? tmpdir()));
      headless = "shell";
      args = [...chromium.args.filter((a) => !SIN_SEGURIDAD.has(a)), ...sinRed];
    }

    const browser = await puppeteer.launch({
      executablePath,
      headless,
      args,
      defaultViewport: VENTANA,
      timeout: 20_000,
      protocolTimeout: 20_000,
    });
    try {
      const cdp = await browser.target().createCDPSession();
      await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
    } catch (e) {
      // Sin la negación de descargas no se sigue: se cierra y se informa.
      await browser.close().catch(() => {});
      throw e;
    }
    return envolverNavegador(browser, opciones.cierreMs ?? 5_000, opciones.quitarWebRtc ?? true);
  };
}

/**
 * Las dependencias de verdad, para la ruta: este Chromium sin red, el
 * transporte que conecta a la dirección examinada, y el mismo resolvedor DNS
 * del chequeo de evidencia de H1.4 (c-ares, con plazo y cancelable).
 */
export function dependenciasDeProduccion(): DependenciasRender {
  return {
    abrirNavegador: abrirChromium(),
    transporte: crearTransporteRender(),
    resolver: resolverDns,
  };
}
