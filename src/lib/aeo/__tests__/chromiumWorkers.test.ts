/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que `chromium.ts` le pase al interceptor un pedido de un worker sin decir
 * de QUÉ worker es, o con el worker equivocado (W-1).
 *
 * Lo que pide un worker llega sin marco. Chromium dice de qué worker es en la
 * sesión de CDP de ese worker: un `Network.requestWillBeSent` con la URL de su
 * script en `documentURL`. El pedido interceptado y ese aviso llegan por
 * sesiones distintas, en cualquier orden —MEDIDO: con el headless shell 153 el
 * `fetch` de un worker llega por la sesión de la PESTAÑA—, y cuando el aviso
 * es el segundo, puppeteer suelta el pedido ADENTRO del mismo mensaje, antes
 * que el oyente de `chromium.ts`. Con Chrome 155 y el headless shell, en la
 * integración, el aviso llegó primero en todos los casos, así que la espera
 * de un turno no se ve ahí: se prueba acá, con el orden que la rompe.
 *
 * El navegador es un doble de puppeteer: una pestaña, un worker y un pedido
 * que se emiten a mano, en el orden de cada caso.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { OpcionesChromium } from "../chromium";
import { abrirChromium } from "../chromium";
import type { PedidoDelNavegador } from "../renderizado";

/** Una sesión de CDP: eventos y `send`, que contesta vacío. */
function sesion() {
  const s = new EventEmitter() as EventEmitter & { send: (metodo: string) => Promise<object> };
  s.send = async () => ({});
  return s;
}

function navegadorDoble() {
  const pagina = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const cdp = sesion();
  Object.assign(pagina, {
    setJavaScriptEnabled: async () => {},
    evaluateOnNewDocument: async () => {},
    setViewport: async () => {},
    setUserAgent: async () => {},
    createCDPSession: async () => cdp,
    setBypassServiceWorker: async () => {},
    setRequestInterception: async () => {},
    mainFrame: () => ({ url: () => "https://sitio.test/" }),
  });
  const paquetes: NonNullable<OpcionesChromium["paquetes"]> = async () => ({
    puppeteer: {
      launch: async () =>
        ({
          target: () => ({ createCDPSession: async () => sesion() }),
          newPage: async () => pagina,
          userAgent: async () => "Mozilla/5.0 HeadlessChrome/155",
          close: async () => {},
          process: () => null,
        }) as never,
    },
    chromium: async () => ({ args: [], setGraphicsMode: false, executablePath: async () => "/no-se-usa" }),
  });
  return { pagina, abrir: abrirChromium({ ejecutable: "/chrome-doble", paquetes }) };
}

/** Un worker como lo da puppeteer en `workercreated`: su script y su sesión. */
function worker(script: string) {
  return { url: () => script, client: sesion() };
}

/** Un pedido interceptado como lo da puppeteer: con su `requestId` de CDP. */
function pedido(id: string, url: string, conMarco = false) {
  return {
    id,
    url: () => url,
    method: () => "GET",
    headers: () => ({}),
    postData: () => undefined,
    hasPostData: () => false,
    fetchPostData: async () => undefined,
    resourceType: () => "fetch",
    isNavigationRequest: () => false,
    frame: () => (conMarco ? { url: () => "https://sitio.test/" } : null),
    continue: async () => {},
    abort: async () => {},
    respond: async () => {},
  };
}

/** Abre la pestaña con JavaScript, la intercepta, y devuelve cada pedido que le llega al interceptor. */
async function abrirInterceptada() {
  const { pagina, abrir } = navegadorDoble();
  const navegador = await abrir();
  const abierta = await navegador.nuevaPagina();
  const recibidos: PedidoDelNavegador[] = [];
  let avisar: () => void = () => {};
  await abierta.interceptar(async (p) => {
    recibidos.push(p);
    avisar();
  });
  const siguiente = () => new Promise<PedidoDelNavegador>((listo) => (avisar = () => listo(recibidos[recibidos.length - 1])));
  return { pagina, abierta, siguiente };
}

const RETO = "blob:https://reto.test/2f6e0c1d-6b1a-4c39-9a55-7b1f3e0d9c21";

describe("W-1: cada pedido sin marco lleva el script del worker que lo hizo", () => {
  it("el aviso del worker llega DESPUÉS del pedido, en el mismo mensaje: igual se atribuye", async () => {
    const { pagina, siguiente } = await abrirInterceptada();
    const w = worker(RETO);
    pagina.emit("workercreated", w);
    const llega = siguiente();
    // puppeteer suelta el pedido adentro del mensaje del aviso, antes que el
    // oyente de `chromium.ts`: los dos en el mismo turno.
    pagina.emit("request", pedido("77.3", "https://brunhild.test/sonda"));
    w.client.emit("Network.requestWillBeSent", { requestId: "77.3", documentURL: RETO });
    const p = await llega;
    expect(p).toMatchObject({ url: "https://brunhild.test/sonda", urlDelMarco: null, urlDelWorker: RETO });
  });

  it("y si llega ANTES, también", async () => {
    const { pagina, siguiente } = await abrirInterceptada();
    const w = worker("https://sitio.test/w.js");
    pagina.emit("workercreated", w);
    w.client.emit("Network.requestWillBeSent", { requestId: "9.1", documentURL: "https://sitio.test/w.js" });
    const llega = siguiente();
    pagina.emit("request", pedido("9.1", "https://sitio.test/datos"));
    expect((await llega).urlDelWorker).toBe("https://sitio.test/w.js");
  });

  it("es el del MISMO pedido: dos workers que piden a la vez no se confunden", async () => {
    const { pagina, siguiente } = await abrirInterceptada();
    const ajeno = worker(RETO);
    const propio = worker("https://sitio.test/w.js");
    pagina.emit("workercreated", ajeno);
    pagina.emit("workercreated", propio);
    ajeno.client.emit("Network.requestWillBeSent", { requestId: "1.1", documentURL: RETO });
    propio.client.emit("Network.requestWillBeSent", { requestId: "2.1", documentURL: "https://sitio.test/w.js" });
    let llega = siguiente();
    pagina.emit("request", pedido("2.1", "https://cdn.test/misma"));
    expect((await llega).urlDelWorker).toBe("https://sitio.test/w.js");
    llega = siguiente();
    pagina.emit("request", pedido("1.1", "https://cdn.test/misma"));
    expect((await llega).urlDelWorker).toBe(RETO);
  });

  it("sin `documentURL`, el script del worker en cuya sesión llegó el aviso", async () => {
    const { pagina, siguiente } = await abrirInterceptada();
    const w = worker(RETO);
    pagina.emit("workercreated", w);
    w.client.emit("Network.requestWillBeSent", { requestId: "3.1", documentURL: "" });
    const llega = siguiente();
    pagina.emit("request", pedido("3.1", "https://brunhild.test/sonda"));
    expect((await llega).urlDelWorker).toBe(RETO);
  });

  it("un pedido sin marco que ningún worker avisó queda sin worker: cuenta (falla cerrado)", async () => {
    const { pagina, siguiente } = await abrirInterceptada();
    pagina.emit("workercreated", worker(RETO));
    const llega = siguiente();
    pagina.emit("request", pedido("4.1", "https://brunhild.test/sonda"));
    expect(await llega).toMatchObject({ urlDelMarco: null, urlDelWorker: null });
  });

  it("con marco no se usa: manda el marco", async () => {
    const { pagina, siguiente } = await abrirInterceptada();
    const w = worker(RETO);
    pagina.emit("workercreated", w);
    w.client.emit("Network.requestWillBeSent", { requestId: "5.1", documentURL: RETO });
    const llega = siguiente();
    pagina.emit("request", pedido("5.1", "https://sitio.test/app.js", true));
    expect(await llega).toMatchObject({ urlDelMarco: "https://sitio.test/", urlDelWorker: null });
  });

  it("el `WebSocket` que avisa la sesión de un worker lleva el script de ese worker (F3)", async () => {
    const { pagina, abierta } = await abrirInterceptada();
    const w = worker(RETO);
    pagina.emit("workercreated", w);
    w.client.emit("Network.webSocketCreated", { url: "wss://reto.test/ws" });
    expect(abierta.salidasPropias()).toEqual([
      expect.objectContaining({ url: "wss://reto.test/ws", deUnWorker: true, urlDelWorker: RETO }),
    ]);
  });
});
