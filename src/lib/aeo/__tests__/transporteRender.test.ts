/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el transporte del renderizado —el único camino por el que el navegador
 * de la auditoría AEO recibe bytes— conecte a otra dirección que la examinada,
 * siga una redirección por su cuenta, o se deje inflar sin tope.
 *
 * Con sockets reales contra un servidor local: el `lookup` fijado y la
 * descompresión son de `node:http` y `node:zlib`, y un doble no los ejercita.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PedidoHttp } from "../renderizado";
import { crearTransporteRender } from "../transporteRender";

let servidor: http.Server;
let puerto = 0;
const vistos: Array<{ host: string | undefined; metodo: string | undefined; url: string | undefined; cuerpo: string }> = [];

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (d) => (cuerpo += d));
    req.on("end", () => {
      vistos.push({ host: req.headers.host, metodo: req.method, url: req.url, cuerpo });
      switch (req.url) {
        case "/gzip":
          res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/html" });
          return res.end(zlib.gzipSync("hola comprimido"));
        case "/br":
          res.writeHead(200, { "content-encoding": "br" });
          return res.end(zlib.brotliCompressSync("hola brotli"));
        case "/bomba":
          // 10 MB de ceros comprimidos en unos pocos KB.
          res.writeHead(200, { "content-encoding": "gzip" });
          return res.end(zlib.gzipSync(Buffer.alloc(10 * 1024 * 1024)));
        case "/grande":
          res.writeHead(200);
          return res.end(Buffer.alloc(2 * 1024 * 1024, 120));
        case "/redir":
          res.writeHead(302, { location: "http://127.0.0.1/admin", "set-cookie": ["a=1", "b=2"] });
          return res.end();
        case "/colgado":
          return; // nunca contesta
        case "/corta":
          // Conectó, leyó el pedido y cortó: el origen está, y contestó mal.
          return req.socket.destroy();
        default:
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end("ok");
      }
    });
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", () => listo()));
  puerto = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  servidor.closeAllConnections();
  await new Promise((listo) => servidor.close(listo));
});

/** Todo va al servidor local; la URL dice otro host y otro puerto, y eso viaja en `Host`. */
const transporte = crearTransporteRender({
  conectarA: ({ ip }) => {
    destinos.push(ip);
    return { ip: "127.0.0.1", puerto };
  },
});
const destinos: string[] = [];

function pedido(ruta: string, extra: Partial<PedidoHttp> = {}): PedidoHttp {
  return {
    url: `http://sitio.test${ruta}`,
    ip: "93.184.216.34",
    metodo: "GET",
    encabezados: { accept: "*/*" },
    timeoutMs: 2_000,
    maxBytes: 1024 * 1024,
    ...extra,
  };
}

describe("el transporte del renderizado", () => {
  it("conecta a la dirección EXAMINADA y manda el nombre en Host", async () => {
    const r = await transporte(pedido("/"));
    expect(r).toMatchObject({ tipo: "respuesta", status: 200 });
    expect(destinos.at(-1)).toBe("93.184.216.34");
    expect(vistos.at(-1)?.host).toBe("sitio.test");
  });

  it("NO sigue redirecciones: el 3xx vuelve entero, con Location y las cookies", async () => {
    const r = await transporte(pedido("/redir"));
    expect(r.tipo).toBe("respuesta");
    if (r.tipo !== "respuesta") return;
    expect(r.status).toBe(302);
    expect(r.encabezados.location).toBe("http://127.0.0.1/admin");
    expect(r.encabezados["set-cookie"]).toEqual(["a=1", "b=2"]);
    expect(vistos.some((v) => v.url === "/admin")).toBe(false);
  });

  it("descomprime gzip y brotli", async () => {
    const g = await transporte(pedido("/gzip"));
    const b = await transporte(pedido("/br"));
    expect(g.tipo === "respuesta" && g.cuerpo.toString()).toBe("hola comprimido");
    expect(b.tipo === "respuesta" && b.cuerpo.toString()).toBe("hola brotli");
  });

  // Se afirma sobre el MOTIVO y no sobre el objeto entero: si el tope se
  // rompe, el objeto trae 10 MB de cuerpo, y el diff de un `toEqual` contra él
  // tumbaba el informe del runner en vez de dar un rojo legible (medido con la
  // mutación «sin `maxOutputLength`»).
  const motivo = (r: Awaited<ReturnType<typeof transporte>>) =>
    r.tipo === "error" ? r.motivo : `respuesta de ${r.cuerpo.length} bytes`;

  it("una bomba de compresión se corta DESPUÉS de descomprimir: demasiado-grande", async () => {
    expect(motivo(await transporte(pedido("/bomba", { maxBytes: 1024 * 1024 })))).toBe("demasiado-grande");
  });

  it("un cuerpo más grande que el tope se corta mientras llega", async () => {
    expect(motivo(await transporte(pedido("/grande", { maxBytes: 1024 * 1024 })))).toBe("demasiado-grande");
  });

  /**
   * RED-121-2: el presupuesto que un pedido comparte con los que van en
   * paralelo se descuenta con cada parte que LLEGA. Antes el transporte no lo
   * conocía, y 30 pedidos en paralelo de un marco bajaron 40,5 MB contra 10.
   */
  it("RED-121-2 — cada parte del cuerpo se descuenta del presupuesto al llegar, y si no alcanza el pedido se corta ahí", async () => {
    let aceptados = 0;
    const presupuesto = (bytes: number) => {
      if (aceptados + bytes > 300 * 1024) return false;
      aceptados += bytes;
      return true;
    };
    const r = await transporte(pedido("/grande", { maxBytes: 4 * 1024 * 1024, presupuesto }));
    // Cabía en su tope propio (4 MB): lo que lo cortó fue el presupuesto.
    expect(motivo(r)).toBe("demasiado-grande");
    expect(aceptados).toBeGreaterThan(0);
    expect(aceptados).toBeLessThanOrEqual(300 * 1024);
  });

  it("RED-121-2 — cuatro pedidos EN PARALELO de 2 MB con un presupuesto compartido de 3 MB: lo entregado no lo pasa", async () => {
    let aceptados = 0;
    const presupuesto = (bytes: number) => {
      if (aceptados + bytes > 3 * 1024 * 1024) return false;
      aceptados += bytes;
      return true;
    };
    const rs = await Promise.all(
      [1, 2, 3, 4].map(() => transporte(pedido("/grande", { maxBytes: 4 * 1024 * 1024, presupuesto })))
    );
    const entregados = rs.reduce((suma, r) => suma + (r.tipo === "respuesta" ? r.cuerpo.length : 0), 0);
    expect(entregados).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(aceptados).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(rs.filter((r) => r.tipo === "error").length).toBeGreaterThan(0);
  });

  it("y con presupuesto de sobra, la respuesta llega entera y se descontó entera", async () => {
    let aceptados = 0;
    const r = await transporte(pedido("/grande", { maxBytes: 4 * 1024 * 1024, presupuesto: (b) => ((aceptados += b), true) }));
    expect(r.tipo === "respuesta" && r.cuerpo.length).toBe(2 * 1024 * 1024);
    expect(aceptados).toBe(2 * 1024 * 1024);
  });

  it("un origen que no contesta es timeout, con plazo TOTAL", async () => {
    const inicio = Date.now();
    expect(await transporte(pedido("/colgado", { timeoutMs: 200 }))).toEqual({ tipo: "error", motivo: "timeout" });
    expect(Date.now() - inicio).toBeLessThan(1_500);
  });

  it("manda el cuerpo de un POST", async () => {
    await transporte(pedido("/", { metodo: "POST", cuerpo: '{"q":1}', encabezados: { "content-type": "application/json" } }));
    expect(vistos.at(-1)).toMatchObject({ metodo: "POST", cuerpo: '{"q":1}' });
  });

  it("una conexión rechazada es sin-respuesta, no un status inventado", async () => {
    const sinNadie = crearTransporteRender({ conectarA: () => ({ ip: "127.0.0.1", puerto: 1 }) });
    expect(await sinNadie(pedido("/"))).toEqual({ tipo: "error", motivo: "sin-respuesta" });
  });

  /**
   * PU-3: el `lookup` fijado llamaba al callback de forma SÍNCRONA, y un
   * `connect` que falla en el acto —una IPv6 en un host sin ruta IPv6, una
   * dirección a la que el kernel ni intenta— destruía el socket antes de que
   * existieran los listeners. MEDIDO en Node 24 y 26: `https.request` tiraba
   * `TypeError: Cannot read properties of null (reading 'setServername')` (la
   * promesa del transporte RECHAZABA) y además el proceso recibía un
   * `uncaughtException` `EHOSTUNREACH`. 224.0.0.1 falla en el acto en Linux y
   * en macOS (TCP a multicast); 100::1 (RFC 6666) en un host sin ruta IPv6.
   */
  describe("PU-3: un connect que falla en el acto es un error con motivo, no una excepción", () => {
    const noCapturadas: unknown[] = [];
    const anotar = (e: unknown) => noCapturadas.push(e);

    it.each([
      ["https a una dirección que falla en el acto", "https", "224.0.0.1"],
      ["http a una dirección que falla en el acto", "http", "224.0.0.1"],
      ["https a una IPv6 sin ruta", "https", "100::1"],
    ])("%s: resuelve `{ tipo: \"error\" }`, y el proceso no ve ninguna excepción", async (_caso, esquema, ip) => {
      process.on("uncaughtException", anotar);
      try {
        const sinRuta = crearTransporteRender({ conectarA: ({ puerto: p }) => ({ ip, puerto: p }) });
        const r = await sinRuta(pedido("/", { url: `${esquema}://sitio.test/`, timeoutMs: 1_500 }));
        expect(r.tipo).toBe("error");
        // Un tick más: el `uncaughtException` llegaba después del rechazo.
        await new Promise((listo) => setTimeout(listo, 50));
        expect(noCapturadas).toEqual([]);
      } finally {
        process.off("uncaughtException", anotar);
      }
    });

    it("un pedido que `request()` rechaza en el acto (un encabezado inválido) es sin-respuesta, no una promesa rechazada", async () => {
      expect(await transporte(pedido("/", { encabezados: { "x-mala": "a\nb" } }))).toEqual({ tipo: "error", motivo: "sin-respuesta" });
    });

    it("con varias direcciones examinadas prueba la siguiente si la primera no conecta, IPv4 primero", async () => {
      const intentos: string[] = [];
      const conFallo = crearTransporteRender({
        conectarA: ({ ip }) => {
          intentos.push(ip);
          // La primera no conecta; la segunda va al servidor local.
          return ip === "93.184.216.34" ? { ip: "224.0.0.1", puerto: 80 } : { ip: "127.0.0.1", puerto };
        },
      });
      const r = await conFallo(pedido("/", { ip: "93.184.216.34", alternativas: ["93.184.216.35"] }));
      expect(r).toMatchObject({ tipo: "respuesta", status: 200 });
      expect(intentos).toEqual(["93.184.216.34", "93.184.216.35"]);
    });

    it("una conexión que SE ESTABLECIÓ y falló después NO se reintenta en otra dirección", async () => {
      const intentos: string[] = [];
      const t = crearTransporteRender({
        conectarA: ({ ip }) => {
          intentos.push(ip);
          return { ip: "127.0.0.1", puerto };
        },
      });
      const r = await t(pedido("/corta", { ip: "93.184.216.34", alternativas: ["93.184.216.35"] }));
      expect(r).toEqual({ tipo: "error", motivo: "sin-respuesta" });
      expect(intentos).toEqual(["93.184.216.34"]);
    });
  });
});
