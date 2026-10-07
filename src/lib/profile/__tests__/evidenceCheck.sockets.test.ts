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
 * Un servidor DNS de verdad, también en 127.0.0.1, por UDP, que contesta los
 * `*.test` y le pregunta el resolvedor de PRODUCCIÓN (`crearResolvedorDns`, o
 * sea c-ares) apuntado a él:
 *
 *   fuente-sana.test, destino-ajeno.test   A 93.184.216.34
 *   interno.test                           A 127.0.0.1: un nombre cuyo DNS
 *                                          contesta loopback
 *   mixto.test                             A 93.184.216.34 y A 10.0.0.7
 *   negro-*.test                           no contesta nunca: el DNS lento o
 *                                          caído de una fuente real
 *   el resto                               NXDOMAIN
 *
 * Y los dos controles con el resolvedor del sistema: un `*.invalid` (RFC 6761:
 * no resuelve nunca) y `localhost`, que resuelve a loopback y tiene que
 * rechazarse sin que el servidor vea un solo pedido.
 *
 * LO ÚNICO QUE NO ES PRODUCCIÓN, DICHO
 *
 * El examen de IP sigue siendo el de verdad, así que 127.0.0.1 no puede ser «la
 * fuente sana». Las URLs sanas usan nombres `*.test` que el DNS local resuelve a
 * una IP pública (93.184.216.34), y el transporte recibe `conectarA`, que lleva
 * ESA dirección al servidor local. El examen corre sobre la URL y la dirección
 * originales —puerto 80, IP pública—; sólo el socket se abre en otro lado.
 * Cualquier otra dirección se conecta a donde dice, y por eso los rechazos de
 * abajo se miden contra la bitácora del servidor, no contra un doble. El
 * resolvedor es el de producción con `servidores` apuntando al DNS local: es la
 * única opción que producción no pasa.
 *
 * VERIFICADO POR MUTACIÓN (R7), además de las del encabezado de
 * `evidenceCheck.ts` que caen acá:
 *
 *   T1  el resolvedor vuelve a `dns.promises.lookup` . «no pasa por getaddrinfo»
 *       y «la corrida con DNS mudo» (getaddrinfo no conoce los `*.test`, y el
 *       espía de `lookup` deja de dar cero)
 *   T2  la señal no corta la consulta (sin `cancel`)  «el plazo CORTA la
 *       consulta»: tarda 2,1 s en vez de 100 ms, y el servidor ve reintentos
 *   T3  el plazo de la fuente no aborta la señal  . . «la corrida con DNS mudo»:
 *       el servidor sigue recibiendo reintentos después de la corrida
 */
import dgram from "node:dgram";
import dns from "node:dns";
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
import { crearResolvedorDns, crearTransporteNodo, motivoDeError, resolverDns } from "../nodeTransport";

const IP_DE_PRUEBA = "93.184.216.34";
const PROPIO = "ejemplo-propio.com";

let servidor: Server;
let puerto = 0;
const bitacora: Array<{ metodo: string; path: string; host: string; range: string | null }> = [];

// ─────────────────────────────────────────────────────────────────────────────
// El servidor DNS local
// ─────────────────────────────────────────────────────────────────────────────

const ZONA: Record<string, string[]> = {
  "fuente-sana.test": [IP_DE_PRUEBA],
  "destino-ajeno.test": [IP_DE_PRUEBA],
  "interno.test": ["127.0.0.1"],
  "mixto.test": [IP_DE_PRUEBA, "10.0.0.7"],
};
let servidorDns: dgram.Socket;
let puertoDns = 0;
/** Cada consulta que llegó: nombre, tipo (1 = A, 28 = AAAA) y cuándo. */
const consultasDns: Array<{ nombre: string; tipo: number; en: number }> = [];

/** Lo mínimo de RFC 1035 para contestar A, NOERROR vacío o NXDOMAIN. */
function contestarDns(pedido: Buffer): Buffer | null {
  let i = 12;
  const etiquetas: string[] = [];
  while (pedido[i] !== 0) {
    etiquetas.push(pedido.subarray(i + 1, i + 1 + pedido[i]).toString("ascii"));
    i += pedido[i] + 1;
  }
  const nombre = etiquetas.join(".").toLowerCase();
  const tipo = pedido.readUInt16BE(i + 1);
  consultasDns.push({ nombre, tipo, en: Date.now() });
  if (nombre.startsWith("negro-")) return null;

  const pregunta = pedido.subarray(12, i + 5);
  const direcciones = ZONA[nombre];
  const respuestas =
    direcciones && tipo === 1
      ? direcciones.map((ip) => {
          const r = Buffer.alloc(16);
          r.writeUInt16BE(0xc00c, 0); // el nombre: puntero a la pregunta
          r.writeUInt16BE(1, 2); // A
          r.writeUInt16BE(1, 4); // IN
          r.writeUInt32BE(60, 6);
          r.writeUInt16BE(4, 10);
          ip.split(".").forEach((octeto, k) => r.writeUInt8(Number(octeto), 12 + k));
          return r;
        })
      : [];
  const cabecera = Buffer.alloc(12);
  pedido.copy(cabecera, 0, 0, 2);
  cabecera.writeUInt16BE(0x8180 | (direcciones ? 0 : 3), 2);
  cabecera.writeUInt16BE(1, 4);
  cabecera.writeUInt16BE(respuestas.length, 6);
  return Buffer.concat([cabecera, pregunta, ...respuestas]);
}

beforeAll(async () => {
  servidorDns = dgram.createSocket("udp4");
  servidorDns.on("message", (pedido, remoto) => {
    const respuesta = contestarDns(pedido);
    if (respuesta) servidorDns.send(respuesta, remoto.port, remoto.address);
  });
  await new Promise<void>((listo) => servidorDns.bind(0, "127.0.0.1", () => listo()));
  puertoDns = servidorDns.address().port;
});

afterAll(() => {
  servidorDns.close();
});

/** El resolvedor de producción, apuntado al DNS local. */
const resolvedorLocal = (opciones: { timeoutMs?: number; intentos?: number } = {}) =>
  crearResolvedorDns({ servidores: [`127.0.0.1:${puertoDns}`], ...opciones });

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
  consultasDns.length = 0;
});

/** Las dependencias: transporte de producción, y el resolvedor de producción en el DNS local para `*.test`. */
function dependencias(): Dependencias {
  const local = resolvedorLocal();
  return {
    resolver: (host, senal) => (host.endsWith(".test") ? local(host, senal) : resolverDns(host, senal)),
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

describe("con un DNS de verdad que contesta lo que un atacante elegiría", () => {
  it("un nombre cuyo DNS contesta loopback se rechaza en el examen de IP, sin que el servidor vea nada", async () => {
    const c = await clasificar("http://interno.test/secreto");
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-no-publica", medida: true });
    expect(consultasDns.some((q) => q.nombre === "interno.test")).toBe(true);
    expect(bitacora).toEqual([]);
  });

  it("una respuesta mixta, una pública y una privada, por DNS real: no se conecta a ninguna", async () => {
    const c = await clasificar("http://mixto.test/sana");
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-no-publica" });
    expect(bitacora).toEqual([]);
  });
});

describe("el DNS no se queda con lo que no es suyo", () => {
  /** Cuenta las llamadas a `getaddrinfo` (las dos puertas de `node:dns`) mientras corre `cuerpo`. */
  async function contandoGetaddrinfo<T>(cuerpo: () => Promise<T>): Promise<{ valor: T; llamadas: string[] }> {
    const llamadas: string[] = [];
    const lookup = dns.lookup;
    const lookupPromesa = dns.promises.lookup;
    (dns as { lookup: unknown }).lookup = (...args: unknown[]) => {
      llamadas.push(`dns.lookup ${String(args[0])}`);
      return (lookup as (...a: unknown[]) => unknown)(...args);
    };
    (dns.promises as { lookup: unknown }).lookup = (...args: unknown[]) => {
      llamadas.push(`dns.promises.lookup ${String(args[0])}`);
      return (lookupPromesa as (...a: unknown[]) => unknown)(...args);
    };
    try {
      return { valor: await cuerpo(), llamadas };
    } finally {
      (dns as { lookup: unknown }).lookup = lookup;
      (dns.promises as { lookup: unknown }).lookup = lookupPromesa;
    }
  }

  it("el resolvedor de producción le pregunta al servidor DNS, no a getaddrinfo", async () => {
    // Mutación T1. Con `getaddrinfo` el nombre lo resuelve el sistema —que no
    // conoce `fuente-sana.test`— y cada consulta ocupa un hilo del pool de
    // libuv que el plazo no puede liberar.
    const { valor, llamadas } = await contandoGetaddrinfo(() =>
      resolvedorLocal()("fuente-sana.test", new AbortController().signal)
    );
    expect(valor).toEqual({ ok: true, direcciones: [IP_DE_PRUEBA] });
    expect(llamadas).toEqual([]);
    expect(consultasDns.filter((q) => q.nombre === "fuente-sana.test").map((q) => q.tipo).sort()).toEqual([1, 28]);
  });

  it("el plazo CORTA la consulta: contesta a los 100 ms y el servidor no ve ningún reintento", async () => {
    // Mutación T2. Sin `cancel`, c-ares sigue reintentando (300, 600 y 1200 ms
    // con estas opciones: medido, seis consultas en 2,1 s) y la promesa no
    // vuelve hasta que se rinde.
    const nombre = `negro-cancelado-${Date.now()}.test`;
    const corte = new AbortController();
    setTimeout(() => corte.abort(), 100);
    const antes = Date.now();
    const r = await resolvedorLocal({ timeoutMs: 300, intentos: 3 })(nombre, corte.signal);
    const tardo = Date.now() - antes;
    expect(r).toEqual({ ok: false });
    // Sin `cancel` son 2,1 s: la cota es holgada a propósito, para una
    // máquina cargada, y sigue separando los dos casos.
    expect(tardo).toBeLessThan(1_000);

    await new Promise((listo) => setTimeout(listo, 1_500));
    expect(
      consultasDns.filter((q) => q.nombre === nombre).map((q) => q.tipo).sort(),
      "una A y una AAAA, y ningún reintento después del corte"
    ).toEqual([1, 28]);
  });

  it("la corrida con 24 fuentes de DNS mudo: entra en su cuenta, las sanas no salen timeout y el DNS del proceso queda libre", async () => {
    // Es el hallazgo, con sockets: 48 nombres de DNS lento dejaban la corrida
    // en 41 s, una fuente sana detrás de la cola salía «timeout», y la
    // siguiente resolución del proceso esperaba 79 s. Acá: 24 mudos, una sana
    // y una que resuelve a loopback, al final de la cola a propósito.
    // Mutación T3: si el plazo de la fuente no aborta la señal, cada consulta
    // muda sigue viva y el servidor ve los reintentos después de la corrida.
    const mudos = Array.from({ length: 24 }, (_, i) => `http://negro-corrida-${i}-${Date.now()}.test/`);
    const urls = [...mudos, "http://fuente-sana.test/sana", "http://interno.test/secreto"];
    const opciones = { ...OPCIONES_POR_DEFECTO, presupuestoPorFuenteMs: 300 };
    const trabajos = urls.length + 2;
    const cuenta = Math.ceil(trabajos / opciones.concurrencia) * opciones.presupuestoPorFuenteMs;

    const antes = Date.now();
    const { valor: salida, llamadas } = await contandoGetaddrinfo(() =>
      chequearEvidencia(
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
        dependencias(),
        opciones
      )
    );
    const tardo = Date.now() - antes;
    if (!salida.ok) throw new Error(salida.motivo);
    console.log(`[h1.4 sockets] DNS mudo: ${tardo} ms (cuenta ${cuenta} ms) | ${salida.linea}`);

    // Cota de cordura y no de precisión: lo que discrimina son los motivos, el
    // espía de getaddrinfo y los reintentos de abajo.
    expect(tardo).toBeLessThan(cuenta * 2);
    expect(llamadas, "ninguna resolución pasó por getaddrinfo").toEqual([]);
    const motivo = (url: string) => salida.fuentes.find((f) => f.url === url)?.motivo;
    expect(motivo("http://fuente-sana.test/sana"), "la sana, detrás de la cola, resuelve").toBeNull();
    expect(motivo("http://interno.test/secreto"), "y la interna sale por su motivo, no por timeout").toBe(
      "ip-no-publica"
    );
    expect(mudos.every((u) => motivo(u) === "timeout")).toBe(true);

    // El DNS del proceso —el que va a necesitar la escritura a Supabase— libre.
    const antesLookup = Date.now();
    await dns.promises.lookup("localhost", { all: true });
    expect(Date.now() - antesLookup).toBeLessThan(1_000);

    // Y nada siguió preguntando: cada mudo, una A y una AAAA, sin reintentos.
    await new Promise((listo) => setTimeout(listo, 1_500));
    for (const u of mudos) {
      const host = new URL(u).hostname;
      expect(consultasDns.filter((q) => q.nombre === host).length, host).toBe(2);
    }
  }, 15_000);
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
