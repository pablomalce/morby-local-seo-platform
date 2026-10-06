/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el chequeo de H1.4 examine una dirección y se conecte a otra.
 *
 * `evidenceCheck.ts` resuelve el host, exige que TODAS las direcciones sean
 * públicas y recién entonces pide. Si el transporte volviera a resolver el
 * nombre por su cuenta —que es lo que hace `fetch` sin más—, entre el examen y
 * la conexión hay una segunda consulta DNS, y un servidor DNS hostil contesta
 * una IP pública a la primera y `169.254.169.254` a la segunda. Eso es el
 * rebinding, y se cierra acá: la conexión usa el `lookup` FIJADO a la dirección
 * que pasó el examen, y el nombre sigue viajando en `Host` y en el SNI de TLS,
 * así que el certificado se verifica contra el host y no contra la IP.
 *
 * POR QUÉ `node:http` Y NO `fetch`
 *
 * Porque `fetch` no deja fijar la dirección sin `undici` como dependencia, y
 * `precondicionRutas.test.ts` tiene un trinquete que falla si entra `undici`:
 * el espía de ese barrido instrumenta `globalThis.fetch` y `request`/`get` de
 * `node:http` y `node:https`, y nada más. Este archivo usa exactamente lo que
 * el espía ve, y lo llama por el objeto del módulo (`http.request`, no un
 * `request` importado suelto) para que el espía instalado en ese objeto lo vea.
 *
 * QUÉ NO LEE
 *
 * El cuerpo. Un HEAD no tiene, y el GET degradado pide `Range: bytes=0-0` pero
 * un origen puede ignorarlo y mandar el archivo entero: se leen el status y
 * `Location` y la respuesta se destruye.
 */
import { randomBytes } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Dependencias, PedidoHttp, Resolucion, RespuestaHttp } from "./evidenceCheck";

const AGENTE = "VulkanGrowthOS/1.0 (chequeo de evidencia H1.4)";

/** Todas las direcciones del nombre, en el orden del sistema. Cualquier fallo es «no resuelve». */
export async function resolverDns(host: string): Promise<Resolucion> {
  try {
    const direcciones = await dns.promises.lookup(host, { all: true, verbatim: true });
    return { ok: true, direcciones: direcciones.map((d) => d.address) };
  } catch {
    return { ok: false };
  }
}

/**
 * Errores de TLS: un certificado vencido, ajeno o de una CA que no conocemos no
 * es «sin respuesta», es otro motivo.
 *
 * La primera versión miraba sólo `CERT|TLS|SSL` en el código, y MEDIDO con un
 * servidor HTTPS local y una CA de prueba: un certificado de una CA desconocida
 * da `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, que no tiene ninguna de las tres, y salía
 * como `sin-respuesta`. Los códigos de verificación de X.509 de OpenSSL son una
 * lista larga; los que no dicen CERT dicen UNABLE_TO, CRL, INVALID_CA,
 * PATH_LENGTH, INVALID_PURPOSE o HOSTNAME_MISMATCH.
 */
export function motivoDeError(codigo: string | undefined): "tls" | "sin-respuesta" {
  return codigo && /CERT|TLS|SSL|CRL|UNABLE_TO_|INVALID_CA|PATH_LENGTH|INVALID_PURPOSE|HOSTNAME_MISMATCH/.test(codigo)
    ? "tls"
    : "sin-respuesta";
}

export interface OpcionesTransporte {
  /**
   * Adónde se abre el socket, dada la dirección examinada y el puerto de la URL.
   *
   * Existe para UNA cosa: que los tests con sockets reales puedan llevar una
   * URL `http://fuente-sana.test/` —puerto 80, dirección pública según el doble
   * de DNS— a un servidor local en un puerto alto, sin debilitar el examen de IP
   * ni el de puertos, que siguen corriendo sobre la URL y la dirección
   * originales. Producción no lo pasa: `crearTransporteNodo()` sin argumentos
   * conecta a la dirección examinada y al puerto de la URL.
   */
  conectarA?: (destino: { ip: string; puerto: number }) => { ip: string; puerto: number };
}

export function crearTransporteNodo(opciones: OpcionesTransporte = {}): Dependencias["transporte"] {
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
        host: url.host,
        "user-agent": AGENTE,
        accept: "*/*",
      };
      if (pedido.rango) encabezados.range = "bytes=0-0";

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
        servername: isIP(url.hostname) ? undefined : url.hostname,
      });

      // Un plazo TOTAL, no el de inactividad del socket que da `timeout:` de
      // `http.request`: un origen que gotea un byte por segundo no lo dispara.
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
        const location = res.headers.location ?? null;
        terminar({ tipo: "respuesta", status: res.statusCode ?? 0, location });
        res.destroy();
        req.destroy();
      });
      req.on("error", (error: NodeJS.ErrnoException) => {
        terminar({ tipo: "error", motivo: motivoDeError(error.code) });
      });
      req.end();
    });
}

/** Las dependencias de verdad, para la ruta. */
export function dependenciasDeProduccion(): Dependencias {
  return {
    resolver: resolverDns,
    transporte: crearTransporteNodo(),
    sufijoAleatorio: () => randomBytes(8).toString("hex"),
  };
}
