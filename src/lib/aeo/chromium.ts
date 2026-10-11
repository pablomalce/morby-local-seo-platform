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
 *   --force-webrtc-ip-handling-policy=disable_non_proxied_udp
 *                                        WebRTC no abre UDP por fuera del proxy.
 *
 * LAS DOS CAPAS SON REDUNDANTES A PROPÓSITO, y está medido. Contra el mismo
 * canario, con un `WebSocket` y dos `preconnect` a loopback: sin banderas, 4
 * conexiones; sólo el proxy (con `<-loopback>`), 0; sólo el resolvedor apagado,
 * 0 —`MAP *` alcanza también a las IP literales—; el proxy SIN `<-loopback>`,
 * 4. Cada capa basta sola, así que borrar una no pone rojo un test que corra
 * con las dos: por eso el test de integración arranca Chromium tres veces, con
 * las dos capas y con cada una sola (`capasDeRed`), y afirma cero conexiones en
 * las tres. Borrar una bandera de acá pone rojo el caso de su capa.
 *
 * Además: las descargas se deniegan por CDP, los service workers se saltean, y
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
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
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
export const capasDeRed = {
  proxy: BANDERAS_SIN_RED.filter((b) => !b.startsWith("--host-resolver-rules")),
  resolvedor: BANDERAS_SIN_RED.filter((b) => !b.startsWith("--proxy-")),
};

/** Lo que `@sparticuz/chromium` agrega y un render fiel no puede llevar. */
const SIN_SEGURIDAD = new Set(["--disable-web-security", "--allow-running-insecure-content"]);

const VENTANA = { width: 1366, height: 768 };

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

function envolverPagina(page: Page): PaginaAbierta {
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
    async textoVisible() {
      return page.evaluate(() => document.body?.innerText ?? "");
    },
  };
}

function envolverNavegador(browser: Browser, cierreMs: number): NavegadorAbierto {
  return {
    async nuevaPagina() {
      const page = await browser.newPage();
      await page.setViewport(VENTANA);
      // Se dice quién mira, sin el «Headless» que algunos WAF usan para
      // contestar otra página que la que ve una persona.
      const agente = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
      await page.setUserAgent({ userAgent: `${agente} VulkanGrowthOS/1.0 (auditoria AEO; renderizado)` });
      return envolverPagina(page);
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
    return envolverNavegador(browser, opciones.cierreMs ?? 5_000);
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
