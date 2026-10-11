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
import type { Browser, HTTPRequest, Page } from "puppeteer-core";
import { resolverDns } from "@/lib/profile/nodeTransport";
import type {
  AbrirNavegador,
  DependenciasRender,
  NavegadorAbierto,
  PaginaAbierta,
  PedidoDelNavegador,
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
function sinWebRtc() {
  for (const nombre of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceCandidate"]) {
    try {
      delete (window as unknown as Record<string, unknown>)[nombre];
    } catch {
      // Una propiedad que no se deja borrar se tapa: lo que importa es que no construya.
      Object.defineProperty(window, nombre, { value: undefined, configurable: false, writable: false });
    }
  }
}

async function adaptar(req: HTTPRequest, page: Page): Promise<PedidoDelNavegador> {
  let cuerpo = req.postData();
  if (cuerpo === undefined && req.hasPostData()) cuerpo = await req.fetchPostData();
  return {
    url: req.url(),
    metodo: req.method(),
    encabezados: req.headers(),
    cuerpo,
    tipo: req.resourceType(),
    esDocumentoPrincipal: req.isNavigationRequest() && req.frame() === page.mainFrame(),
    continuar: () => req.continue(),
    abortar: () => req.abort("blockedbyclient"),
    responder: (r) => req.respond({ status: r.status, headers: r.encabezados, body: r.cuerpo }),
  };
}

function envolverPagina(page: Page, sinJavaScript: boolean): PaginaAbierta {
  return {
    async interceptar(atender) {
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        // Si adaptar o atender fallan, el pedido se aborta: un pedido colgado
        // frena el `load`, y uno liberado sin examen es una salida.
        void adaptar(req, page)
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
    async textoVisible() {
      // Sin JavaScript, `<noscript>` se dibuja; con JavaScript, no. Se saca
      // para que los dos lados cuenten lo mismo. Sólo en la pestaña sin
      // JavaScript: ahí ningún script de la página ve el cambio.
      if (sinJavaScript) {
        return page.evaluate(() => {
          document.querySelectorAll("noscript").forEach((n) => n.remove());
          return document.body?.innerText ?? "";
        });
      }
      return page.evaluate(() => document.body?.innerText ?? "");
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
      return envolverPagina(page, sinJavaScript);
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
}

export function abrirChromium(opciones: OpcionesChromium = {}): AbrirNavegador {
  return async () => {
    const local = opciones.ejecutable ?? process.env.AEO_CHROME_PATH;
    const sinRed = opciones.banderas ?? BANDERAS_SIN_RED;
    // El binario de `@sparticuz/chromium` es Linux x64. Fuera de Linux, sin un
    // Chrome local, no hay navegador: se dice ya, en vez de descomprimir 180 MB
    // en `/tmp` para que después el sistema se niegue a ejecutarlos.
    if (!local && process.platform !== "linux") {
      throw new Error("sin Chromium: fuera de Linux hace falta AEO_CHROME_PATH");
    }
    const { default: puppeteer } = await import("puppeteer-core");

    let executablePath: string;
    let headless: boolean | "shell";
    let args: string[];
    if (local) {
      executablePath = local;
      headless = true;
      args = [...sinRed];
    } else {
      const { default: chromium } = await import("@sparticuz/chromium");
      // Sin WebGL: no cambia el texto, y ahorra descomprimir SwiftShader en
      // cada arranque en frío.
      chromium.setGraphicsMode = false;
      executablePath = await chromium.executablePath();
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
