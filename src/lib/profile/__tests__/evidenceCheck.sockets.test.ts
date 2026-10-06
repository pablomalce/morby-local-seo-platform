/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el chequeo de H1.4 esté probado sólo contra dobles. Acá hay un servidor
 * HTTP de verdad, en 127.0.0.1, con sockets de verdad, y el transporte que usa
 * producción (`crearTransporteNodo`, `node:http` con el `lookup` fijado):
 *
 *   /sana        200 a HEAD
 *   /sin-head    405 a HEAD; 206 a un GET con `Range: bytes=0-0`, y 400 a un
 *                GET SIN Range, para que «degradó» quiera decir «mandó Range»
 *   /rota        404
 *   /mudada      301 hacia otro host ajeno, que contesta 200
 *   /a-loopback  302 hacia 127.0.0.1 en el puerto de este mismo servidor
 *   /a-localhost 302 hacia `localhost` en el puerto 80: pasa el examen de
 *                puertos y el de IP literal, y tiene que caer en el de IP cuando
 *                el DNS REAL del sistema contesta loopback
 *   /a-propio    302 hacia el propio dominio
 *   /secreto     lo que el salto a loopback intentaría alcanzar: si alguien lo
 *                pide, el test lo ve en la bitácora del servidor
 *   /lenta       nunca contesta
 *
 * Y los dos controles con el resolvedor DNS REAL del sistema: un `*.invalid`
 * (RFC 6761: no resuelve nunca) y `localhost`, que resuelve a loopback y tiene
 * que rechazarse sin que el servidor vea un solo pedido.
 *
 * LO ÚNICO QUE NO ES PRODUCCIÓN, DICHO
 *
 * El examen de IP sigue siendo el de verdad, así que 127.0.0.1 no puede ser «la
 * fuente sana». Las URLs sanas usan nombres `*.test` que un DNS de prueba
 * resuelve a una IP pública (93.184.216.34), y el transporte recibe
 * `conectarA`, que lleva ESA dirección al servidor local. El examen corre sobre
 * la URL y la dirección originales —puerto 80, IP pública—; sólo el socket se
 * abre en otro lado. Cualquier otra dirección se conecta a donde dice, y por eso
 * los rechazos de abajo se miden contra la bitácora del servidor, no contra un
 * doble.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  chequearEvidencia,
  clasificarUrl,
  OPCIONES_POR_DEFECTO,
  type Dependencias,
  type ResultadoChequeo,
} from "../evidenceCheck";
import { crearTransporteNodo, motivoDeError, resolverDns } from "../nodeTransport";

const IP_DE_PRUEBA = "93.184.216.34";
const PROPIO = "ejemplo-propio.com";

let servidor: Server;
let puerto = 0;
const bitacora: Array<{ metodo: string; path: string; host: string; range: string | null }> = [];

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res) => {
    const path = req.url ?? "/";
    bitacora.push({
      metodo: req.method ?? "?",
      path,
      host: req.headers.host ?? "",
      range: (req.headers.range as string | undefined) ?? null,
    });
    const responder = (status: number, encabezados: Record<string, string> = {}) => {
      res.writeHead(status, encabezados);
      res.end(req.method === "HEAD" ? undefined : "x".repeat(4096));
    };
    switch (path) {
      case "/sana":
        return responder(200);
      case "/sin-head":
        if (req.method === "HEAD") return responder(405, { allow: "GET" });
        if (req.headers.range !== "bytes=0-0") return responder(400);
        return responder(206, { "content-range": "bytes 0-0/4096" });
      case "/rota":
        return responder(404);
      case "/mudada":
        return responder(301, { location: "http://destino-ajeno.test/sana" });
      case "/a-loopback":
        return responder(302, { location: `http://127.0.0.1:${puerto}/secreto` });
      case "/a-localhost":
        return responder(302, { location: "http://localhost/secreto" });
      case "/a-propio":
        return responder(302, { location: `https://www.${PROPIO}/sobre-nosotros` });
      case "/secreto":
        return responder(200);
      case "/lenta":
        return; // nunca contesta
      default:
        return responder(404);
    }
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  puerto = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  servidor.closeAllConnections();
  await new Promise<void>((listo) => servidor.close(() => listo()));
});

beforeEach(() => {
  bitacora.length = 0;
});

/** Las dependencias: transporte de producción, DNS de prueba sólo para `*.test`. */
function dependencias(): Dependencias {
  return {
    resolver: async (host) => (host.endsWith(".test") ? { ok: true, direcciones: [IP_DE_PRUEBA] } : resolverDns(host)),
    transporte: crearTransporteNodo({
      conectarA: (destino) => (destino.ip === IP_DE_PRUEBA ? { ip: "127.0.0.1", puerto } : destino),
    }),
    sufijoAleatorio: () => `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
  };
}

const clasificar = (url: string, host = new URL(url).hostname, opciones = OPCIONES_POR_DEFECTO) =>
  clasificarUrl(url, host, PROPIO, dependencias(), opciones);

describe("contra un servidor HTTP real", () => {
  it("200 a HEAD: resuelta, con un solo HEAD y el Host original", async () => {
    const c = await clasificar("http://fuente-sana.test/sana");
    expect(c).toMatchObject({ cubeta: "resuelta", status: 200, degradada: false, medida: true });
    expect(bitacora).toEqual([{ metodo: "HEAD", path: "/sana", host: "fuente-sana.test", range: null }]);
  });

  it("405 a HEAD y 206 a GET con Range: resuelta, degradada, y el servidor vio el Range", async () => {
    const c = await clasificar("http://fuente-sana.test/sin-head");
    expect(c).toMatchObject({ cubeta: "resuelta", status: 206, degradada: true });
    expect(bitacora.map((b) => [b.metodo, b.range])).toEqual([
      ["HEAD", null],
      ["GET", "bytes=0-0"],
    ]);
  });

  it("404: no resuelve, con el status", async () => {
    const c = await clasificar("http://fuente-sana.test/rota");
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "http-404", status: 404 });
  });

  it("301 a otro host ajeno: sigue el salto y resuelve", async () => {
    const c = await clasificar("http://fuente-sana.test/mudada");
    expect(c).toMatchObject({ cubeta: "resuelta", saltos: 1, status: 200 });
    expect(bitacora.map((b) => `${b.metodo} ${b.host}${b.path}`)).toEqual([
      "HEAD fuente-sana.test/mudada",
      "HEAD destino-ajeno.test/sana",
    ]);
  });

  it("302 a 127.0.0.1 en el puerto de este servidor: el salto se rechaza y /secreto nunca se pide", async () => {
    // Sin re-examinar el salto, el transporte conectaría a este mismo servidor y
    // la bitácora mostraría /secreto: un servicio interno alcanzado por la IP
    // de la plataforma.
    const c = await clasificar("http://fuente-sana.test/a-loopback");
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "puerto", status: 302 });
    expect(bitacora.map((b) => b.path)).toEqual(["/a-loopback"]);
  });

  it("302 a localhost: el DNS real del salto contesta loopback y cae en el examen de IP", async () => {
    const c = await clasificar("http://fuente-sana.test/a-localhost");
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-no-publica", status: 302 });
    expect(bitacora.map((b) => b.path)).toEqual(["/a-localhost"]);
  });

  it("302 al propio dominio: no resuelve por origen propio", async () => {
    const c = await clasificar("http://fuente-sana.test/a-propio");
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "origen-propio" });
    expect(bitacora.map((b) => b.path)).toEqual(["/a-propio"]);
  });

  it("un servidor que no contesta es timeout, dentro del presupuesto", async () => {
    const antes = Date.now();
    const c = await clasificar("http://fuente-sana.test/lenta", undefined, {
      ...OPCIONES_POR_DEFECTO,
      presupuestoPorFuenteMs: 300,
    });
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "timeout" });
    expect(Date.now() - antes).toBeLessThan(3_000);
  });
});

describe("con el DNS real del sistema", () => {
  it("`localhost` resuelve a loopback: se rechaza y el servidor no ve nada", async () => {
    const c = await clasificar("http://localhost/sana");
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-no-publica", medida: true });
    expect(bitacora).toEqual([]);
  });

  it("127.0.0.1 en el puerto del servidor: el puerto se rechaza antes de nada", async () => {
    const c = await clasificar(`http://127.0.0.1:${puerto}/secreto`);
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "puerto" });
    expect(bitacora).toEqual([]);
  });

  it("una URL inventada en `.invalid` no resuelve", async () => {
    const c = await clasificar("https://esta-fuente-no-existe-h14.invalid/informe");
    expect(c.cubeta).toBe("no-resuelve");
    // `dns` es lo esperado; `timeout` sólo si el resolvedor del sistema no
    // contesta a tiempo. Las dos son «no resuelve», que es la garantía.
    expect(["dns", "timeout"]).toContain(c.motivo);
    expect(bitacora).toEqual([]);
  });
});

describe("la corrida entera, con sockets, en la misma pasada que la contraprueba", () => {
  async function corrida(urls: string[]): Promise<ResultadoChequeo> {
    const salida = await chequearEvidencia(
      {
        n: urls.length,
        afirmaciones: urls.map((_, i) => ({ id: `obj-${i}`, tipo: "claim" })),
        fuentes: urls.map((url, i) => ({
          id: `f-${i}`,
          objetivoId: `obj-${i}`,
          tipo: "http",
          url,
          hostFuente: new URL(url).hostname,
          verificadaEn: null,
          verificadaPor: null,
        })),
        hostPropio: PROPIO,
      },
      dependencias()
    );
    if (!salida.ok) throw new Error(salida.motivo);
    return salida;
  }

  it("dos fuentes sanas (una degradada): verde, y la contraprueba subió «no resuelve» en 2", async () => {
    const r = await corrida(["http://fuente-sana.test/sana", "http://fuente-sana.test/sin-head"]);
    console.log(`[h1.4 sockets] ${r.linea}`);
    expect(r.contraprueba).toMatchObject({ ok: true, subioNoResuelve: 2 });
    expect(r.contraprueba.propia?.motivo).toBe("origen-propio");
    expect(r.cubetas).toEqual({ resuelta: 2, noResuelve: 0, aMano: 0, degradadas: 1 });
    expect(r.verde).toBe(true);
    expect(r.linea.startsWith("2 afirmaciones, 0 sin evidencia resoluble")).toBe(true);
  });

  it("la misma corrida con una fuente rota: M sube a 1 y es rojo", async () => {
    const r = await corrida(["http://fuente-sana.test/sana", "http://fuente-sana.test/rota"]);
    console.log(`[h1.4 sockets] ${r.linea}`);
    expect(r.m).toBe(1);
    expect(r.cubetas.noResuelve).toBe(1);
    expect(r.motivosRojo).toContain("fuentes-que-no-resuelven");
    expect(r.verde).toBe(false);
  });
});

describe("qué error es TLS", () => {
  it("los códigos de verificación de certificados son «tls», los de red son «sin-respuesta»", () => {
    // Mutación 19. `UNABLE_TO_VERIFY_LEAF_SIGNATURE` es el que dio un servidor
    // HTTPS local con un certificado de una CA desconocida, medido a mano; la
    // primera versión lo clasificaba como `sin-respuesta`.
    for (const codigo of [
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "HOSTNAME_MISMATCH",
    ]) {
      expect(motivoDeError(codigo), codigo).toBe("tls");
    }
    for (const codigo of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE", undefined]) {
      expect(motivoDeError(codigo), String(codigo)).toBe("sin-respuesta");
    }
  });
});
