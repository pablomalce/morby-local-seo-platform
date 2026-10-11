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
 * producción— con los dos paquetes dobles, inyectados por `paquetes` y no con
 * `vi.mock`: dos `import()` simultáneos de un módulo simulado le daban a veces
 * el paquete REAL al segundo (medido en vitest 3.2.7, en la suite entera), y
 * el test fallaba por el arnés y no por el código.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpcionesChromium } from "../chromium";

const descomprimir = vi.fn<() => Promise<string>>();
const lanzar = vi.fn<(ruta: string) => void>();

const paquetes: NonNullable<OpcionesChromium["paquetes"]> = async () => ({
  puppeteer: {
    launch: async (opciones) => {
      lanzar(String(opciones.executablePath));
      return {
        target: () => ({ createCDPSession: async () => ({ send: async () => {} }) }),
        close: async () => {},
        process: () => null,
      } as never;
    },
  },
  chromium: async () => ({ args: ["--de-sparticuz"], setGraphicsMode: true, executablePath: () => descomprimir() }),
});

beforeEach(() => {
  vi.resetModules();
  descomprimir.mockReset();
  lanzar.mockReset();
});

/** Un `chromium.ts` nuevo por caso: la promesa única vive en el módulo. */
async function abrir() {
  const { abrirChromium } = await import("../chromium");
  // La rama de producción: Linux y sin Chrome local.
  return abrirChromium({ ejecutable: "", paquetes, plataforma: "linux" });
}

describe("RV-2: una sola descompresión de Chromium por proceso", () => {
  it("dos aperturas en frío a la vez esperan la MISMA descompresión, y las dos lanzan el binario terminado", async () => {
    // Cada descompresión pendiente termina recién cuando el test lo dice.
    const pendientes: Array<(ruta: string) => void> = [];
    descomprimir.mockImplementation(() => new Promise((listo) => pendientes.push(listo)));
    const abrirNavegador = await abrir();

    const una = abrirNavegador();
    const otra = abrirNavegador();
    await vi.waitFor(() => expect(pendientes.length).toBeGreaterThan(0));
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
