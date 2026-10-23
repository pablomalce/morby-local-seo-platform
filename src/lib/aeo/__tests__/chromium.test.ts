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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * El `tmpdir()` de cada caso: la limpieza de restos (RT-3) borra lo que
 * `@sparticuz/chromium` descomprime, y no puede tocar el de la máquina.
 */
let dir = "";

beforeEach(() => {
  vi.resetModules();
  descomprimir.mockReset();
  lanzar.mockReset();
  dir = mkdtempSync(path.join(tmpdir(), "aeo-chromium-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Un `chromium.ts` nuevo por caso: la promesa única vive en el módulo. */
async function abrir() {
  const { abrirChromium } = await import("../chromium");
  // La rama de producción: Linux y sin Chrome local.
  return abrirChromium({ ejecutable: "", paquetes, plataforma: "linux", dirTemporal: dir });
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

/**
 * RT-3. `@sparticuz/chromium` devuelve `/tmp/chromium` apenas EXISTE, y cada
 * tar se da por extraído apenas existe su carpeta. MEDIDO en un contenedor
 * AL2023 con 1 vCPU: 30 MB del binario escritos en `/tmp/chromium` —un proceso
 * que murió a mitad de la descompresión— dejaron la instancia en
 * `sin-navegador` 3 de 3 veces, sin `al2023/` ni `fonts/`.
 */
describe("RT-3: una descompresión que no terminó no deja la instancia sin navegador", () => {
  /** El doble se porta como el paquete: lo que existe, lo da por bueno. */
  function comoSparticuz() {
    descomprimir.mockImplementation(async () => {
      const binario = path.join(dir, "chromium");
      if (!existsSync(binario)) writeFileSync(binario, "binario completo");
      if (!existsSync(path.join(dir, "al2023"))) {
        mkdirSync(path.join(dir, "al2023", "lib"), { recursive: true });
        writeFileSync(path.join(dir, "al2023", "lib", "libnss3.so"), "biblioteca completa");
      }
      return binario;
    });
  }

  it("un binario a medio escribir, sin la marca, se borra con sus carpetas y se descomprime de nuevo", async () => {
    writeFileSync(path.join(dir, "chromium"), "30 MB de 180");
    mkdirSync(path.join(dir, "al2023", "lib"), { recursive: true });
    writeFileSync(path.join(dir, "al2023", "lib", "libnss3.so"), "a medias");
    writeFileSync(path.join(dir, "libGLESv2.so"), "a medias");
    comoSparticuz();
    const alLanzar: string[] = [];
    lanzar.mockImplementation((ruta) => {
      alLanzar.push(readFileSync(ruta, "utf8"), readFileSync(path.join(dir, "al2023", "lib", "libnss3.so"), "utf8"));
    });

    const abrirNavegador = await abrir();
    await abrirNavegador();

    expect(alLanzar).toEqual(["binario completo", "biblioteca completa"]);
    expect(existsSync(path.join(dir, "libGLESv2.so")), "los restos sueltos de swiftshader también").toBe(false);
    const { MARCA_DE_DESCOMPRESION } = await import("../chromium");
    expect(existsSync(path.join(dir, MARCA_DE_DESCOMPRESION))).toBe(true);
  });

  it("con la marca de una descompresión terminada, lo descomprimido se REUSA: no se borra nada", async () => {
    const { MARCA_DE_DESCOMPRESION } = await import("../chromium");
    writeFileSync(path.join(dir, "chromium"), "binario de una invocación anterior");
    writeFileSync(path.join(dir, MARCA_DE_DESCOMPRESION), "");
    comoSparticuz();
    const alLanzar: string[] = [];
    lanzar.mockImplementation((ruta) => alLanzar.push(readFileSync(ruta, "utf8")));

    await (await abrir())();
    expect(alLanzar).toEqual(["binario de una invocación anterior"]);
  });

  it("una descompresión que falla NO escribe la marca: la próxima apertura limpia y vuelve a empezar", async () => {
    const { MARCA_DE_DESCOMPRESION } = await import("../chromium");
    descomprimir.mockImplementationOnce(async () => {
      writeFileSync(path.join(dir, "chromium"), "cortado por ENOSPC");
      throw new Error("ENOSPC");
    });
    const abrirNavegador = await abrir();
    await expect(abrirNavegador()).rejects.toThrow("ENOSPC");
    expect(existsSync(path.join(dir, MARCA_DE_DESCOMPRESION))).toBe(false);

    comoSparticuz();
    const alLanzar: string[] = [];
    lanzar.mockImplementation((ruta) => alLanzar.push(readFileSync(ruta, "utf8")));
    await abrirNavegador();
    expect(alLanzar).toEqual(["binario completo"]);
  });
});
