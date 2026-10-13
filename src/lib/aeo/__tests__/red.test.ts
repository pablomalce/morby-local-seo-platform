/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que los pedidos que la ruta de auditoría AEO hace SIN navegador —robots,
 * portada, `llms.txt` y uno por agente— vuelvan a salir sin examen de la
 * dirección (SEC-1).
 *
 * El oráculo es de sockets, no de dobles: dos servidores HTTP locales y el
 * transporte de producción (`crearTransporteRender`) con `conectarA`, igual que
 * `renderizado.integracion.test.ts`. Lo que el examen dejó pasar con la
 * dirección pública va al SITIO del atacante; TODO lo demás va al CANARIO, que
 * cuenta conexiones TCP. Si la guarda dejara pasar loopback, la metadata o una
 * red privada —por la URL o por una redirección—, el canario dejaría de contar
 * cero. Es la reproducción del hallazgo: un sitio público que contesta 302 a un
 * servicio interno, y cinco agentes que devolvían el status de ese servicio.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { statusPorAgente } from "../peticion";
import { crearRedExaminada, traerExaminado, type RedExaminada } from "../red";
import { crearTransporteRender } from "../transporteRender";
import { resolvedorDoble } from "./navegadorDoble";

const PUBLICA = "93.184.216.34";
const AGENTE = "VulkanGrowthOS/1.0 (auditoria AEO)";

let sitio: http.Server;
let canario: http.Server;
let puertoSitio = 0;
let puertoCanario = 0;
const enCanario = { conexiones: 0, pedidos: [] as string[] };

function escuchar(servidor: http.Server): Promise<number> {
  return new Promise((listo) => servidor.listen(0, "127.0.0.1", () => listo((servidor.address() as AddressInfo).port)));
}

/** Adónde redirige el atacante, según el caso. */
let destinoHostil = "http://127.0.0.1/secret";

beforeAll(async () => {
  canario = http.createServer((req, res) => {
    enCanario.pedidos.push(`${req.method} ${req.url} ${req.headers["user-agent"] ?? ""}`);
    res.end("INTERNAL-SECRET token=abc123");
  });
  canario.on("connection", () => {
    enCanario.conexiones += 1;
  });
  puertoCanario = await escuchar(canario);

  sitio = http.createServer((req, res) => {
    const ua = req.headers["user-agent"] ?? "";
    switch (req.url) {
      case "/portada":
        res.writeHead(302, { location: destinoHostil });
        return res.end();
      case "/agentes":
        // Al visitante, una página; a los rastreadores, el servicio interno.
        if (ua === AGENTE) return res.end("<p>hola</p>");
        res.writeHead(302, { location: destinoHostil });
        return res.end();
      case "/a":
        res.writeHead(301, { location: "/b" });
        return res.end();
      case "/b":
        return res.end("destino sano");
      case "/bucle":
        res.writeHead(302, { location: "/bucle" });
        return res.end();
      case "/lento":
        return; // no contesta nunca
      case "/grande":
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(Buffer.alloc(2 * 1024 * 1024, 1));
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  puertoSitio = await escuchar(sitio);
});

afterAll(async () => {
  sitio.closeAllConnections();
  await new Promise((listo) => sitio.close(listo));
  await new Promise((listo) => canario.close(listo));
});

beforeEach(() => {
  enCanario.conexiones = 0;
  enCanario.pedidos = [];
  destinoHostil = "http://127.0.0.1/secret";
});

function transporte() {
  return crearTransporteRender({
    conectarA: ({ ip }) => ({ ip: "127.0.0.1", puerto: ip === PUBLICA ? puertoSitio : puertoCanario }),
  });
}

function red(): RedExaminada {
  return crearRedExaminada({
    transporte: transporte(),
    resolver: resolvedorDoble({ "atacante.test": [PUBLICA], "interno.test": ["10.0.0.7"] }).resolver,
  });
}

async function canarioDespues(ms = 200) {
  await new Promise((listo) => setTimeout(listo, ms));
  return { ...enCanario, pedidos: [...enCanario.pedidos] };
}

const OPCIONES = { userAgent: AGENTE, timeoutMs: 3_000, maxBytes: 1024 * 1024 };

describe("SEC-1, con sockets: cada salto se examina antes de conectarse", () => {
  it.each([
    ["loopback", "http://127.0.0.1/secret"],
    ["la metadata", "http://169.254.169.254/latest/meta-data/"],
    ["un nombre que resuelve a 10.x", "http://interno.test/admin"],
    ["IPv6 loopback", "http://[::1]/secret"],
  ])("una portada pública que redirige a %s: el destino no se pide y el canario cuenta CERO", async (_caso, destino) => {
    destinoHostil = destino;
    const traida = await traerExaminado(red(), "http://atacante.test/portada", OPCIONES);
    expect(traida).toEqual({ ok: false, motivo: "red-no-publica", url: destino });
    expect(await canarioDespues()).toEqual({ conexiones: 0, pedidos: [] });
  });

  it("los cinco agentes redirigidos a un servicio interno: ningún código, ninguna conexión", async () => {
    const status = await statusPorAgente("http://atacante.test/agentes", red(), 3_000);
    expect(status).toEqual({ gptbot: null, claudebot: null, perplexitybot: null, "google-extended": null, ccbot: null });
    expect(await canarioDespues()).toEqual({ conexiones: 0, pedidos: [] });
  });

  it("el canario VE: con un examen que deja pasar todo, la misma cadena le llega —el cero de arriba no es un canario sordo—", async () => {
    const ciego: RedExaminada = {
      examinar: async (url) => ({ ok: true, ip: url.hostname === "atacante.test" ? PUBLICA : "127.0.0.1" }),
      transporte: transporte(),
    };
    const traida = await traerExaminado(ciego, "http://atacante.test/portada", OPCIONES);
    expect(traida.ok && traida.cuerpo.toString()).toBe("INTERNAL-SECRET token=abc123");
    const status = await statusPorAgente("http://atacante.test/agentes", ciego, 3_000);
    expect(status.gptbot).toBe(200);
    const visto = await canarioDespues();
    expect(visto.conexiones).toBeGreaterThan(0);
    expect(visto.pedidos.some((p) => p.includes("GPTBot"))).toBe(true);
  });

  it("una cadena SANA se sigue hasta el final, y devuelve la URL del último salto", async () => {
    const traida = await traerExaminado(red(), "http://atacante.test/a", OPCIONES);
    expect(traida).toMatchObject({ ok: true, status: 200, url: "http://atacante.test/b" });
    expect(traida.ok && traida.cuerpo.toString()).toBe("destino sano");
  });

  it("una cadena que no termina corta en `redirecciones`, no en el plazo", async () => {
    expect(await traerExaminado(red(), "http://atacante.test/bucle", OPCIONES)).toEqual({
      ok: false,
      motivo: "redirecciones",
      url: "http://atacante.test/bucle",
    });
  });

  it("el plazo es TOTAL: un sitio que no contesta es `timeout` dentro del plazo", async () => {
    const antes = Date.now();
    const traida = await traerExaminado(red(), "http://atacante.test/lento", { ...OPCIONES, timeoutMs: 300 });
    expect(traida).toMatchObject({ ok: false, motivo: "timeout" });
    expect(Date.now() - antes).toBeLessThan(1_500);
  });

  it("`sinCuerpo` trae el status sin leer el cuerpo: 2 MB no son `demasiado-grande` con tope cero", async () => {
    const traida = await traerExaminado(red(), "http://atacante.test/grande", { ...OPCIONES, maxBytes: 0, sinCuerpo: true });
    expect(traida).toMatchObject({ ok: true, status: 200 });
    expect(traida.ok && traida.cuerpo.length).toBe(0);
  });
});
