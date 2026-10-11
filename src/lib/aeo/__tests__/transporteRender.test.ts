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

  it("una bomba de compresión se corta DESPUÉS de descomprimir: demasiado-grande", async () => {
    expect(await transporte(pedido("/bomba", { maxBytes: 1024 * 1024 }))).toEqual({
      tipo: "error",
      motivo: "demasiado-grande",
    });
  });

  it("un cuerpo más grande que el tope se corta mientras llega", async () => {
    expect(await transporte(pedido("/grande", { maxBytes: 1024 * 1024 }))).toEqual({
      tipo: "error",
      motivo: "demasiado-grande",
    });
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
});
