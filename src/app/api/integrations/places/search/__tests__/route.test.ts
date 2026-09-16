import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

/**
 * H2-GO-0, las partes (a) y (c): un solo camino a Places, y sin clave, error.
 *
 * QUÉ AGUJERO CIERRA
 *
 * Había dos clientes de Places. El real (`google/places.ts`) estaba cableado al
 * orquestador de reportes. El falso (`googlePlaces.ts`) estaba cableado a la
 * ÚNICA ruta de Places de la aplicación, devolvía competidores del dataset de
 * demo, y los seguía devolviendo con la clave puesta. La trampa está escrita
 * en el lanzador de la espina con nombre y apellido: «`GOOGLE_PLACES_API_KEY`
 * no alcanza». Una auditoría hecha sobre un cliente que devuelve mock es peor
 * que ninguna, porque se lee igual que una de verdad.
 *
 * CÓMO FALLA
 *
 * Si alguien vuelve a importar el archivo falso —o lo recrea— el primer test
 * da rojo con el archivo y la línea. Si la ruta vuelve a contestar datos sin
 * clave, el segundo da rojo: «no hay datos» tiene que ser un error, nunca
 * filas con nombre de negocio.
 */
const RAIZ = process.cwd();
const FALSO = "lib/integrations/googlePlaces";

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) salida.push(...archivosTs(completo));
    else if (/\.(ts|tsx)$/.test(entrada)) salida.push(completo);
  }
  return salida;
}

describe("un solo camino a Places (H2-GO-0 a)", () => {
  it("el cliente falso no existe y nadie lo importa", () => {
    expect(
      existsSync(path.join(RAIZ, "src", `${FALSO}.ts`)),
      "src/lib/integrations/googlePlaces.ts volvió a existir. Devolvía datos de demo con la " +
        "clave puesta; si hace falta un modo demo, no es un cliente de Places, es otra cosa."
    ).toBe(false);

    // Con los comentarios tapados y buscando un `from`, no la palabra. La
    // primera versión buscaba el texto crudo y dio rojo contra la PROSA que
    // explica por qué el archivo ya no existe: la lección R14 del director,
    // otra vez, en el primer test que la cita.
    const importadores = archivosTs(path.join(RAIZ, "src"))
      .filter((a) => !a.includes("__tests__"))
      .filter((a) =>
        new RegExp(`from\\s+["']@/${FALSO}["']`).test(
          readFileSync(a, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, " ")
            .replace(/\/\/[^\n]*/g, " ")
        )
      )
      .map((a) => path.relative(RAIZ, a));

    expect(
      importadores,
      "Estos archivos importan el cliente falso de Places. La puerta H2-GO-0 pide cero " +
        "importadores fuera de sus propios tests, y se mide por texto a propósito: es la " +
        "ausencia de un import, no un comportamiento."
    ).toEqual([]);
  });
});

describe("POST /api/integrations/places/search (H2-GO-0 c)", () => {
  const salientes: string[] = [];
  const fetchOriginal = globalThis.fetch;
  const envPrevio = { ...process.env };

  beforeEach(() => {
    salientes.length = 0;
    process.env.INTERNAL_API_SECRET = "secreto-de-prueba";
    globalThis.fetch = vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof entrada === "string" ? entrada : entrada.toString();
      salientes.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(
        JSON.stringify({
          places: [
            { id: "places/abc", displayName: { text: "Salón Real" }, rating: 4.6, userRatingCount: 12 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    process.env = { ...envPrevio };
  });

  const pedido = (cuerpo: unknown, header = "secreto-de-prueba") =>
    new Request("https://growth-os.test/api/integrations/places/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": header },
      body: JSON.stringify(cuerpo),
    });

  it("sin clave contesta 503 y NO devuelve lugares ni sale a la red", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;

    const res = await POST(pedido({ query: "salón de belleza Stockholm" }));
    const cuerpo = (await res.json()) as Record<string, unknown>;

    expect(res.status, "sin clave la respuesta es un error, no datos").toBe(503);
    expect(cuerpo.places, "un 503 con lugares adentro es el mock con otro nombre").toBeUndefined();
    expect(salientes, "sin clave no hay nada que pedirle a Google").toEqual([]);
  });

  it("con clave va a Google y devuelve lo que Google contestó", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "clave-de-prueba";

    const res = await POST(pedido({ query: "salón de belleza Stockholm" }));
    const cuerpo = (await res.json()) as { mode: string; places: Array<{ displayName?: string }> };

    expect(res.status).toBe(200);
    expect(salientes).toEqual(["POST https://places.googleapis.com/v1/places:searchText"]);
    expect(cuerpo.mode).toBe("live");
    expect(cuerpo.places.map((p) => p.displayName)).toEqual(["Salón Real"]);
  });

  it("si Google falla, es un 502 sin lugares", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "clave-de-prueba";
    globalThis.fetch = vi.fn(async () => new Response("", { status: 429 })) as typeof fetch;

    const res = await POST(pedido({ query: "salón de belleza Stockholm" }));
    const cuerpo = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(502);
    expect(cuerpo.places).toBeUndefined();
  });

  it("sin el secreto interno no llega ni a mirar la clave", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "clave-de-prueba";

    const res = await POST(pedido({ query: "salón de belleza Stockholm" }, "otro-secreto"));

    expect(res.status).toBe(401);
    expect(salientes, "un 401 que igual salió a Google es gasto de un anónimo").toEqual([]);
  });
});
