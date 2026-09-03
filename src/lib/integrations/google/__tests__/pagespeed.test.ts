/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que PageSpeed vuelva a decir `error` sin decir cuál.
 *
 * `status` ya existía y colapsa cuatro fallos en una palabra. `outcome` es lo que
 * los separa, y separa mal en silencio si nadie lo mide: un 403 anotado como
 * `network` manda a reintentar algo que necesita que habiliten una API, y un
 * timeout anotado como `http` inventa un código que Google nunca mandó.
 *
 * Los dos que más se confunden son el 2xx incompleto y el fallo de red: los dos
 * llegan sin código, y sólo uno de ellos tuvo respuesta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLAVE = "clave-de-prueba";
const URL_SITIO = "https://ejemplo.test";

async function cargar() {
  vi.resetModules();
  return (await import("../pagespeed")).lookupPageSpeed;
}

function respuesta(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Un cuerpo que el cliente considera completo. */
const CUERPO_BUENO = {
  lighthouseResult: {
    categories: { performance: { score: 0.42 } },
    audits: {
      "largest-contentful-paint": { numericValue: 2500 },
      "cumulative-layout-shift": { numericValue: 0.1 },
      interactive: { numericValue: 3800 },
    },
  },
};

describe("lookupPageSpeed · outcome", () => {
  const original = process.env.GOOGLE_PAGESPEED_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_PAGESPEED_API_KEY = CLAVE;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_PAGESPEED_API_KEY;
    else process.env.GOOGLE_PAGESPEED_API_KEY = original;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sin clave no hace la petición, y lo dice como `no-credentials`", async () => {
    delete process.env.GOOGLE_PAGESPEED_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const lookupPageSpeed = await cargar();
    const r = await lookupPageSpeed({ url: URL_SITIO });

    expect(r.status).toBe("missing-key");
    expect(r.outcome).toEqual({ kind: "no-credentials" });
    // Lo que distingue `no-credentials` de todo lo demás es que NO hubo petición.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("un 403 viaja con su código, que es lo que dice qué habilitar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta({ error: {} }, false, 403)));

    const lookupPageSpeed = await cargar();
    const r = await lookupPageSpeed({ url: URL_SITIO });

    expect(r.status).toBe("error");
    expect(r.outcome).toEqual({ kind: "http", status: 403 });
  });

  it("un 429 no se confunde con un 403: es cuota, no permiso", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta({ error: {} }, false, 429)));

    const lookupPageSpeed = await cargar();
    const r = await lookupPageSpeed({ url: URL_SITIO });

    expect(r.outcome).toEqual({ kind: "http", status: 429 });
  });

  it("un 2xx sin puntaje es `malformed`, y NO lleva código", async () => {
    // El caso que más se confunde: hubo respuesta y fue buena, lo que falló fue
    // la corrida de Lighthouse. Anotarlo como `http` inventaría un permiso roto.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuesta({ lighthouseResult: { runtimeError: { code: "ERRORED" } } }))
    );

    const lookupPageSpeed = await cargar();
    const r = await lookupPageSpeed({ url: URL_SITIO });

    expect(r.status).toBe("error");
    expect(r.outcome).toEqual({ kind: "malformed" });
  });

  it("un fetch que revienta sin abortar es `network`, no `timeout`", async () => {
    // Llamar `timeout` a un DNS caído manda a reintentar algo que no mejora solo.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const lookupPageSpeed = await cargar();
    const r = await lookupPageSpeed({ url: URL_SITIO });

    expect(r.outcome).toEqual({ kind: "network" });
  });

  it("una corrida buena dice `ok` y trae los números", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(CUERPO_BUENO)));

    const lookupPageSpeed = await cargar();
    const r = await lookupPageSpeed({ url: URL_SITIO });

    expect(r.status).toBe("live");
    expect(r.outcome).toEqual({ kind: "ok" });
    expect(r.lighthouseScore).toBe(42);
  });
});
