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
 *   - ninguna redirección se sigue acá: el 3xx vuelve al navegador, y el pedido
 *     al destino vuelve a pasar por el examen de `renderizado.ts`.
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

export function crearTransporteRender(opciones: OpcionesTransporteRender = {}): Transporte {
  return (pedido: PedidoHttp) =>
    new Promise<RespuestaHttp>((resolver) => {
      let url: URL;
      try {
        url = new URL(pedido.url);
      } catch {
        resolver({ tipo: "error", motivo: "sin-respuesta" });
        return;
      }
      const esHttps = url.protocol === "https:";
      const puertoUrl = url.port === "" ? (esHttps ? 443 : 80) : Number(url.port);
      const destino = opciones.conectarA?.({ ip: pedido.ip, puerto: puertoUrl }) ?? {
        ip: pedido.ip,
        puerto: puertoUrl,
      };
      const familia = isIP(destino.ip) === 6 ? 6 : 4;

      // El `lookup` fijado: sea cual sea el nombre, la respuesta es la dirección
      // examinada. Node lo llama con `all: true` cuando prueba familias en
      // paralelo, y entonces espera un arreglo.
      const lookup = ((
        _host: string,
        opcionesLookup: { all?: boolean },
        callback: (...args: unknown[]) => void
      ) => {
        if (opcionesLookup?.all) callback(null, [{ address: destino.ip, family: familia }]);
        else callback(null, destino.ip, familia);
      }) as unknown as LookupFunction;

      const encabezados: Record<string, string> = {
        ...pedido.encabezados,
        host: url.host,
        "accept-encoding": "gzip, deflate, br",
      };
      if (pedido.cuerpo !== undefined) {
        encabezados["content-length"] = String(Buffer.byteLength(pedido.cuerpo));
      }

      const modulo = esHttps ? https : http;
      const req = modulo.request({
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

      // Un plazo TOTAL, no el de inactividad del socket.
      let terminado = false;
      const reloj = setTimeout(() => {
        terminar({ tipo: "error", motivo: "timeout" });
        req.destroy();
      }, Math.max(pedido.timeoutMs, 0));
      function terminar(r: RespuestaHttp) {
        if (terminado) return;
        terminado = true;
        clearTimeout(reloj);
        resolver(r);
      }

      req.on("response", (res) => {
        const partes: Buffer[] = [];
        let leidos = 0;
        // Antes de descomprimir también hay tope: un cuerpo comprimido más
        // grande que el máximo descomprimido no puede ser legítimo.
        res.on("data", (parte: Buffer) => {
          leidos += parte.length;
          if (leidos > pedido.maxBytes) {
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
          const devueltos: Record<string, string | string[]> = {};
          for (const [nombre, valor] of Object.entries(res.headers)) {
            if (valor !== undefined) devueltos[nombre] = valor;
          }
          terminar({ tipo: "respuesta", status: res.statusCode ?? 0, encabezados: devueltos, cuerpo });
        });
      });
      req.on("error", (error: NodeJS.ErrnoException) => {
        terminar({ tipo: "error", motivo: motivoDeError(error.code) });
      });
      if (pedido.cuerpo !== undefined) req.write(pedido.cuerpo);
      req.end();
    });
}
