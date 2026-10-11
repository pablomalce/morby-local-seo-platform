/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que dos auditorías que arrancan en frío en la misma instancia descompriman
 * Chromium a la vez y una lance un binario a medio escribir (RV-2).
 *
 * `@sparticuz/chromium` devuelve `/tmp/chromium` apenas el archivo EXISTE, y
 * existe desde que se abre el stream que lo escribe. MEDIDO en un contenedor
 * `public.ecr.aws/lambda/nodejs:24` con 1 vCPU y `/tmp` vacío: dos
 * `medirRenderizado` a la vez dieron `sin-navegador` (`spawn ETXTBSY`) en 2 de
 * 3 corridas; con la promesa única, 5 de 5 midieron las dos.
 *
 * Acá se prueba la unidad que puede fallar —`abrirChromium` por la rama de
 * producción— con el paquete y puppeteer dobles: cuántas veces se pide la
 * descompresión, y que un fallo no quede guardado.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const descomprimir = vi.fn<() => Promise<string>>();
const lanzar = vi.fn();

vi.mock("@sparticuz/chromium", () => ({
  default: { setGraphicsMode: true, args: ["--de-sparticuz"], executablePath: () => descomprimir() },
}));

vi.mock("puppeteer-core", () => ({
  default: {
    launch: async (opciones: { executablePath: string }) => {
      lanzar(opciones.executablePath);
      return {
        target: () => ({ createCDPSession: async () => ({ send: async () => {} }) }),
        close: async () => {},
        process: () => null,
      };
    },
  },
}));

const plataforma = process.platform;
const chromeLocal = process.env.AEO_CHROME_PATH;

beforeAll(() => {
  // La rama de producción: Linux y sin Chrome local.
  Object.defineProperty(process, "platform", { value: "linux" });
  delete process.env.AEO_CHROME_PATH;
});

afterAll(() => {
  Object.defineProperty(process, "platform", { value: plataforma });
  if (chromeLocal !== undefined) process.env.AEO_CHROME_PATH = chromeLocal;
});

beforeEach(() => {
  vi.resetModules();
  descomprimir.mockReset();
  lanzar.mockReset();
});

/** Un `chromium.ts` nuevo por caso: la promesa única vive en el módulo. */
async function abrir() {
  // Los dobles se cargan ANTES de las aperturas concurrentes: con el registro
  // recién vaciado, dos `import()` simultáneos del mismo módulo simulado le
  // dan el real al segundo (medido en vitest 3.2.7). Es del arnés, no de Node.
  await import("puppeteer-core");
  await import("@sparticuz/chromium");
  const { abrirChromium } = await import("../chromium");
  return abrirChromium();
}

describe("RV-2: una sola descompresión de Chromium por proceso", () => {
  it("dos aperturas en frío a la vez esperan la MISMA descompresión, y las dos lanzan el binario terminado", async () => {
    // Cada descompresión pendiente termina recién cuando el test lo dice.
    const pendientes: Array<(ruta: string) => void> = [];
    descomprimir.mockImplementation(() => new Promise((listo) => pendientes.push(listo)));
    const abrirNavegador = await abrir();

    const una = abrirNavegador();
    const otra = abrirNavegador();
    await new Promise((listo) => setTimeout(listo, 20));
    // Mientras la primera descomprime, la segunda NO lanza nada.
    expect(lanzar).not.toHaveBeenCalled();
    for (const terminar of pendientes) terminar("/tmp/chromium");
    await Promise.all([una, otra]);

    expect(descomprimir).toHaveBeenCalledTimes(1);
    expect(lanzar.mock.calls).toEqual([["/tmp/chromium"], ["/tmp/chromium"]]);
  });

  it("una descompresión que falla no queda guardada: la próxima apertura lo vuelve a intentar", async () => {
    descomprimir.mockRejectedValueOnce(new Error("ENOSPC")).mockResolvedValueOnce("/tmp/chromium");
    const abrirNavegador = await abrir();

    await expect(abrirNavegador()).rejects.toThrow("ENOSPC");
    await expect(abrirNavegador()).resolves.toBeDefined();
    expect(descomprimir).toHaveBeenCalledTimes(2);
    expect(lanzar.mock.calls).toEqual([["/tmp/chromium"]]);
  });
});
