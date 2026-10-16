/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el navegador de la auditoría AEO examine una dirección y se conecte a
 * otra, y que salga a la red por un camino que el espía de
 * `precondicionRutas.test.ts` no ve.
 *
 * Chromium no tiene red (`chromium.ts`): todo lo que dibuja lo pide este
 * transporte, en Node, con la dirección que `renderizado.ts` ya examinó. Es el
 * mismo cierre del rebinding que `src/lib/profile/nodeTransport.ts` hace para
 * H1.4 —el `lookup` FIJADO a la IP examinada, el nombre viajando en `Host` y en
 * el SNI de TLS, así que el certificado se verifica contra el host y no contra
 * la IP— con una diferencia: acá el cuerpo SÍ se lee, porque es lo que el
 * navegador va a dibujar.
 *
 * POR QUÉ `node:http` Y NO `fetch`
 *
 * Por lo mismo que `nodeTransport.ts`: `fetch` no deja fijar la dirección sin
 * `undici` como dependencia, y `undici` es un transporte que el espía no
 * vigila. Esto llama `http.request`/`https.request` por el OBJETO del módulo,
 * que es donde el espía se instala.
 *
 * LOS TOPES
 *
 *   - un plazo TOTAL por pedido, no el de inactividad del socket: un origen que
 *     gotea un byte por segundo no dispara `timeout:` de `http.request`;
 *   - un máximo de bytes, contado DESPUÉS de descomprimir: un gzip de 10 KB que
 *     se infla a 1 GB es la bomba de compresión, y `maxOutputLength` la corta;
 *   - el presupuesto que el pedido comparte con los que van en paralelo
 *     (`PedidoHttp.presupuesto`), descontado con cada parte del cuerpo que
 *     llega: el que no alcanza corta el pedido (RED-121-2);
 *   - ninguna redirección se sigue acá: el 3xx vuelve al navegador, y el pedido
 *     al destino vuelve a pasar por el examen de `renderizado.ts`.
 *
 * NO ES SÓLO DEL NAVEGADOR
 *
 * Los pedidos que la ruta hace sin navegador —el `robots.txt`, la portada, el
 * `llms.txt` y uno por agente de IA— usan este mismo transporte, a través de
 * `red.ts`, que examina cada salto con el mismo examinador. Antes iban por
 * `fetch` con `redirect: "follow"` y sin examen: un sitio cargado como
 * `http://127.0.0.1:…`, o uno público que redirigía a la metadata, se pedía
 * igual desde la función.
 */
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";
import { motivoDeError } from "@/lib/profile/nodeTransport";
import type { PedidoHttp, RespuestaHttp, Transporte } from "./renderizado";

export interface OpcionesTransporteRender {
  /**
   * Adónde se abre el socket, dada la dirección examinada y el puerto de la URL.
   *
   * Existe para UNA cosa, igual que en `nodeTransport.ts`: que el test de
   * integración pueda llevar `http://pagina-solo-js.test/` —puerto 80, dirección
   * pública según el doble de DNS— a un servidor local en un puerto alto, sin
   * debilitar el examen de IP ni el de puertos, que siguen corriendo sobre la
   * URL y la dirección originales. Producción no lo pasa.
   */
  conectarA?: (destino: { ip: string; puerto: number }) => { ip: string; puerto: number };
}

function decodificar(cuerpo: Buffer, codificacion: string, maxBytes: number): Buffer {
  const tope = { maxOutputLength: maxBytes };
  switch (codificacion.trim().toLowerCase()) {
    case "":
    case "identity":
      return cuerpo;
    case "gzip":
    case "x-gzip":
      return zlib.gunzipSync(cuerpo, tope);
    case "deflate":
      return zlib.inflateSync(cuerpo, tope);
    case "br":
      return zlib.brotliDecompressSync(cuerpo, tope);
    default:
      throw new Error(`codificación desconocida: ${codificacion}`);
  }
}

function copiar(encabezados: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const devueltos: Record<string, string | string[]> = {};
  for (const [nombre, valor] of Object.entries(encabezados)) {
    if (valor !== undefined) devueltos[nombre] = valor;
  }
  return devueltos;
}

/**
 * Cuántas direcciones del mismo nombre se prueban, como mucho, en un pedido:
 * todas pasaron el examen, y el plazo del pedido es uno solo para todas.
 */
export const MAX_DIRECCIONES_POR_PEDIDO = 4;

/** Un intento contra UNA dirección, y si la conexión TCP llegó a establecerse. */
type Intento = { respuesta: RespuestaHttp; conecto: boolean };

export function crearTransporteRender(opciones: OpcionesTransporteRender = {}): Transporte {
  return async (pedido: PedidoHttp) => {
    // Las direcciones examinadas, en el orden del examen (IPv4 primero): si
    // la conexión a una no se establece —una IPv6 en una función sin ruta
    // IPv6, una IPv4 caída—, se prueba la siguiente con lo que quede del
    // plazo. Una que conectó y falló después (TLS, timeout, un cuerpo
    // demasiado grande) NO se reintenta: el origen contestó, y otra dirección
    // sería otra respuesta (PU-3).
    const limite = Date.now() + Math.max(pedido.timeoutMs, 0);
    const direcciones = [pedido.ip, ...(pedido.alternativas ?? [])].slice(0, MAX_DIRECCIONES_POR_PEDIDO);
    let ultimo: RespuestaHttp = { tipo: "error", motivo: "sin-respuesta" };
    for (const [i, ip] of direcciones.entries()) {
      const restante = i === 0 ? Math.max(pedido.timeoutMs, 0) : limite - Date.now();
      if (restante <= 0) break;
      const intento = await intentar(pedido, ip, restante, opciones);
      if (intento.respuesta.tipo === "respuesta" || intento.conecto) return intento.respuesta;
      ultimo = intento.respuesta;
    }
    return ultimo;
  };
}

function intentar(
  pedido: PedidoHttp,
  ip: string,
  timeoutMs: number,
  opciones: OpcionesTransporteRender
): Promise<Intento> {
  return new Promise<Intento>((resolver) => {
    let url: URL;
    try {
      url = new URL(pedido.url);
    } catch {
      resolver({ respuesta: { tipo: "error", motivo: "sin-respuesta" }, conecto: false });
      return;
    }
    const esHttps = url.protocol === "https:";
    const puertoUrl = url.port === "" ? (esHttps ? 443 : 80) : Number(url.port);
    const destino = opciones.conectarA?.({ ip, puerto: puertoUrl }) ?? { ip, puerto: puertoUrl };
    const familia = isIP(destino.ip) === 6 ? 6 : 4;

    // El `lookup` fijado: sea cual sea el nombre, la respuesta es la dirección
    // examinada. Node lo llama con `all: true` cuando prueba familias en
    // paralelo, y entonces espera un arreglo.
    //
    // Y contesta en el PRÓXIMO tick, no en el acto (PU-3). Con el callback
    // síncrono, un `connect` que falla en el acto —EHOSTUNREACH a una IPv6 sin
    // ruta, ENETUNREACH— destruía el socket dentro de `request()`, antes de
    // que existieran los listeners: `https.request` tiraba un `TypeError`
    // (`setServername` de null) y el `EHOSTUNREACH` salía como
    // `uncaughtException` del proceso. MEDIDO en Node 24 y 26; con el tick,
    // el mismo fallo llega como `error` del pedido.
    const lookup = ((
      _host: string,
      opcionesLookup: { all?: boolean },
      callback: (...args: unknown[]) => void
    ) => {
      process.nextTick(() => {
        if (opcionesLookup?.all) callback(null, [{ address: destino.ip, family: familia }]);
        else callback(null, destino.ip, familia);
      });
    }) as unknown as LookupFunction;

    const encabezados: Record<string, string> = {
      ...pedido.encabezados,
      host: url.host,
      "accept-encoding": "gzip, deflate, br",
    };
    if (pedido.cuerpo !== undefined) {
      encabezados["content-length"] = String(Buffer.byteLength(pedido.cuerpo));
    }

    let conecto = false;
    let terminado = false;
    let req: http.ClientRequest | undefined;
    // Un plazo TOTAL, no el de inactividad del socket.
    const reloj = setTimeout(() => {
      terminar({ tipo: "error", motivo: "timeout" });
      req?.destroy();
    }, Math.max(timeoutMs, 0));
    function terminar(r: RespuestaHttp) {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      resolver({ respuesta: r, conecto });
    }

    try {
      const modulo = esHttps ? https : http;
      req = modulo.request({
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[(.*)\]$/, "$1"),
        port: destino.puerto,
        path: `${url.pathname}${url.search}`,
        method: pedido.metodo,
        headers: encabezados,
        lookup,
        agent: false,
        servername: isIP(url.hostname.replace(/^\[(.*)\]$/, "$1")) ? undefined : url.hostname,
      });
    } catch {
      // Un pedido que ni se pudo armar no salió: es «sin respuesta», nunca
      // una promesa rechazada que el que llama tenga que adivinar (PU-3).
      terminar({ tipo: "error", motivo: "sin-respuesta" });
      return;
    }

    req.on("socket", (socket) => socket.once("connect", () => (conecto = true)));
    req.on("response", (res) => {
      if (pedido.sinCuerpo) {
        terminar({ tipo: "respuesta", status: res.statusCode ?? 0, encabezados: copiar(res.headers), cuerpo: Buffer.alloc(0) });
        res.destroy();
        req.destroy();
        return;
      }
      const partes: Buffer[] = [];
      let leidos = 0;
      // Antes de descomprimir también hay tope: un cuerpo comprimido más
      // grande que el máximo descomprimido no puede ser legítimo.
      //
      // Y cada parte se descuenta del presupuesto que este pedido comparte
      // con los que van en paralelo, al llegar y no al terminar (RED-121-2):
      // si no alcanza, el pedido se corta ahí, y ningún otro byte suyo se lee.
      res.on("data", (parte: Buffer) => {
        if (terminado) return;
        leidos += parte.length;
        if (leidos > pedido.maxBytes || (pedido.presupuesto !== undefined && !pedido.presupuesto(parte.length))) {
          terminar({ tipo: "error", motivo: "demasiado-grande" });
          res.destroy();
          req.destroy();
          return;
        }
        partes.push(parte);
      });
      res.on("error", () => terminar({ tipo: "error", motivo: "sin-respuesta" }));
      res.on("end", () => {
        if (terminado) return;
        let cuerpo: Buffer;
        try {
          cuerpo = decodificar(
            Buffer.concat(partes),
            String(res.headers["content-encoding"] ?? ""),
            pedido.maxBytes
          );
        } catch (e) {
          const tope = (e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE";
          terminar({ tipo: "error", motivo: tope ? "demasiado-grande" : "sin-respuesta" });
          return;
        }
        terminar({ tipo: "respuesta", status: res.statusCode ?? 0, encabezados: copiar(res.headers), cuerpo });
      });
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      terminar({ tipo: "error", motivo: motivoDeError(error.code) });
    });
    try {
      if (pedido.cuerpo !== undefined) req.write(pedido.cuerpo);
      req.end();
    } catch {
      terminar({ tipo: "error", motivo: "sin-respuesta" });
      req.destroy();
    }
  });
}
