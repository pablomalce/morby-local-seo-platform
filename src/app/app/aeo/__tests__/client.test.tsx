// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la ruta de auditoría siga sin llamadores, y que un fallo se lea como un
 * sitio sano.
 *
 * `hallazgos.test.ts` prueba las reglas y seguiría verde con este botón sin
 * `onClick`. Acá se afirma sobre la LLAMADA y sobre lo que lee una persona.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditoriaAeo } from "../client";

const NEGOCIO = "7d703707-4f9d-43bf-9305-6bc22eddf45f";

let llamadas: { url: string; body: unknown }[] = [];
let respuesta: { ok: boolean; status: number; cuerpo: unknown } = {
  ok: true,
  status: 200,
  cuerpo: { ok: true, url: "https://ejemplo.com/", robotsLeido: true, motivoRobots: null, hallazgos: [], legible: true },
};

beforeEach(() => {
  llamadas = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    llamadas.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: respuesta.ok, status: respuesta.status, json: async () => respuesta.cuerpo } as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  respuesta = {
    ok: true,
    status: 200,
    cuerpo: { ok: true, url: "https://ejemplo.com/", robotsLeido: true, motivoRobots: null, hallazgos: [], legible: true },
  };
});

describe("la auditoría desde la pantalla", () => {
  it("llama a la ruta con el negocio, y no con una URL", async () => {
    // La URL la decide el servidor leyendo el negocio. Mandarla desde acá sería
    // dejar que cualquiera audite cualquier sitio.
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].url).toBe("/api/aeo/audit");
    expect(llamadas[0].body).toEqual({ businessId: NEGOCIO });
  });

  it("sin negocio ni siquiera ofrece auditar", () => {
    render(<AuditoriaAeo businessId={null} />);
    expect(screen.getByTestId("sin-negocio")).toBeTruthy();
    expect((screen.getByTestId("auditar") as HTMLButtonElement).disabled).toBe(true);
  });

  it("un sitio sano lo dice, en vez de dejar la pantalla vacía", async () => {
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() => expect(screen.getByTestId("sin-hallazgos")).toBeTruthy());
  });

  it("dibuja cada hallazgo con su gravedad y DÓNDE se arregla", async () => {
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: {
        ok: true,
        url: "https://ejemplo.com/",
        robotsLeido: true,
        motivoRobots: null,
        hallazgos: [
          {
            gravedad: "bloqueante",
            quePasa: "Ningún rastreador de IA puede entrar al sitio.",
            queHacer: "Se arregla en minutos.",
            donde: "robots.txt",
          },
        ],
      },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));

    await waitFor(() => expect(screen.getByTestId("hallazgo").dataset.gravedad).toBe("bloqueante"));
    expect(screen.getByTestId("hallazgo").textContent).toContain("robots.txt");
  });

  it("«no se pudo mirar» NO se muestra como sitio sano", async () => {
    // Es la distinción que más importa: un sitio que no responde no está bien.
    respuesta = { ok: false, status: 502, cuerpo: { motivo: "sitio-inalcanzable", detalle: "timeout" } };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));

    await waitFor(() => {
      const texto = screen.getByTestId("error-auditoria").textContent ?? "";
      expect(texto).toMatch(/no se pudo mirar/i);
    });
    expect(screen.queryByTestId("sin-hallazgos")).toBeNull();
  });

  it("«sin sitio cargado» tiene su propia frase, y no se funde con un fallo de red", async () => {
    respuesta = { ok: false, status: 409, cuerpo: { motivo: "sin-sitio" } };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() =>
      expect(screen.getByTestId("error-auditoria").textContent).toMatch(/no tiene sitio cargado/i)
    );
  });

  it("un destino rechazado (red interna, puerto raro) tiene su frase, y no se lee como sitio caído", async () => {
    respuesta = { ok: false, status: 422, cuerpo: { ok: false, motivo: "destino-rechazado", detalle: "red-no-publica" } };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() => {
      const texto = screen.getByTestId("error-auditoria").textContent ?? "";
      expect(texto).toMatch(/no se audita \(red-no-publica\)/);
      expect(texto).toMatch(/sitios públicos/);
    });
    expect(screen.queryByTestId("sin-hallazgos")).toBeNull();
  });

  it("muestra los DOS números, servido y renderizado, uno al lado del otro", async () => {
    // Es lo que la puerta H2-GO-1 pide del sitio real: no «poco» o «mucho»,
    // sino cuánto texto sin JavaScript frente a cuánto en el DOM renderizado.
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: {
        ok: true,
        url: "https://ejemplo.com/",
        robotsLeido: true,
        motivoRobots: null,
        hallazgos: [],
        lectura: { caracteresSinJs: 40, caracteresRenderizados: { estado: "medido", caracteres: 1677 } },
      },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));

    await waitFor(() => expect(screen.getByTestId("texto-comparado")).toBeTruthy());
    expect(screen.getByTestId("texto-servido").textContent).toMatch(/^40 caracteres$/);
    const renderizado = screen.getByTestId("texto-renderizado");
    expect(renderizado.dataset.estado).toBe("medido");
    expect(renderizado.textContent?.replace(/\D/g, "")).toBe("1677");
  });

  it("con `servidos` en la respuesta, muestra ÉSE como servido —el del mismo documento— y el renderizado al lado", async () => {
    // El render midió 1 671 en el HTML del documento y 4 860 en su DOM; la
    // ruta, con otro user-agent, trajo un HTML de 1 669. La puerta pide «los
    // caracteres del HTML sin ejecutar JS frente a los del DOM renderizado»,
    // y los dos tienen que salir del mismo documento.
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: {
        ok: true,
        url: "https://ejemplo.com/",
        robotsLeido: true,
        motivoRobots: null,
        hallazgos: [],
        lectura: { caracteresSinJs: 1669, caracteresRenderizados: { estado: "medido", caracteres: 3171, servidos: 1671 } },
      },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() => expect(screen.getByTestId("texto-comparado")).toBeTruthy());
    expect(screen.getByTestId("texto-servido").textContent?.replace(/\D/g, "")).toBe("1671");
    expect(screen.getByTestId("texto-comparado").textContent).toMatch(/texto del HTML/);
    // GATE-2: y el renderizado, CON `servidos` en la respuesta. El único caso
    // que miraba esta caja venía sin `servidos`, así que mostrar el servido en
    // el lugar del renderizado («0 frente a 0») pasaba la suite entera.
    const renderizado = screen.getByTestId("texto-renderizado");
    expect(renderizado.dataset.estado).toBe("medido");
    expect(renderizado.textContent?.replace(/\D/g, "")).toBe("3171");
  });

  it("P6: muestra los datos CRUDOS aunque el sitio esté sano —código por agente, tipos y errores de schema—", async () => {
    // Un sitio sano no tiene hallazgos, y antes por eso no mostraba ni un
    // código: la comparación de las dos URLs de la puerta pedía devtools.
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: {
        ok: true,
        url: "https://ejemplo.com/",
        robotsLeido: true,
        motivoRobots: null,
        hallazgos: [],
        legible: true,
        guardada: false,
        lectura: {
          caracteresSinJs: 4000,
          caracteresRenderizados: { estado: "medido", caracteres: 4000, servidos: 4000 },
          acceso: { gptbot: true, claudebot: false, perplexitybot: null },
          statusPorAgente: { gptbot: 200, claudebot: 403, perplexitybot: null },
          schema: ["LocalBusiness", "Organization"],
          erroresDeSchema: ["bloque 2: sin @context"],
        },
      },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() => expect(screen.getByTestId("datos-crudos")).toBeTruthy());

    const filas = screen.getAllByTestId("dato-agente");
    expect(filas.map((f) => f.dataset.agente)).toEqual(["gptbot", "claudebot", "perplexitybot"]);
    expect(filas.map((f) => f.textContent)).toEqual([
      "gptbotpermite200",
      "claudebotbloquea403",
      "perplexitybotsin medirsin respuesta",
    ]);
    expect(screen.getByTestId("dato-schema").textContent).toMatch(/LocalBusiness, Organization/);
    expect(screen.getByTestId("dato-errores-schema").textContent).toMatch(/bloque 2: sin @context/);
    expect(screen.getByTestId("no-guardada")).toBeTruthy();
  });

  it("un renderizado que falló dice «no medido» y el código, NUNCA un cero", async () => {
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: {
        ok: true,
        url: "https://ejemplo.com/",
        robotsLeido: true,
        motivoRobots: null,
        hallazgos: [
          { gravedad: "no-medido", quePasa: "no se pudo medir (timeout)", queHacer: "Volver a correr.", donde: "la auditoría" },
        ],
        lectura: { caracteresSinJs: 4000, caracteresRenderizados: { estado: "fallo", codigo: "timeout" } },
      },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));

    await waitFor(() => expect(screen.getByTestId("texto-renderizado")).toBeTruthy());
    const renderizado = screen.getByTestId("texto-renderizado");
    expect(renderizado.dataset.estado).toBe("no-medido");
    expect(renderizado.textContent).toMatch(/no medido \(timeout\)/);
    expect(renderizado.textContent).not.toMatch(/\b0\b/);
    expect(screen.getByTestId("hallazgo").textContent).toMatch(/NO MEDIDO/);
    expect(screen.queryByTestId("sin-hallazgos")).toBeNull();
  });

  it("avisa cuando el robots.txt no se pudo leer: SIN MEDIR, no «permite»", async () => {
    // «Permite» y «no se pudo comprobar» no son lo mismo, y la pantalla lo dice.
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: {
        ok: true,
        url: "https://ejemplo.com/",
        robotsLeido: false,
        estadoRobots: "no-medido",
        motivoRobots: "timeout",
        hallazgos: [{ gravedad: "no-medido", quePasa: "No se pudo leer el robots.txt (timeout).", queHacer: "Volver a correr.", donde: "la auditoría" }],
        legible: null,
      },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() => expect(screen.getByTestId("robots-no-leido")).toBeTruthy());
    expect(screen.getByTestId("robots-no-leido").textContent).toMatch(/SIN MEDIR/);
    expect(screen.queryByTestId("sin-hallazgos")).toBeNull();
  });

  it("un robots que NO EXISTE (404) dice que deja entrar a todos, que es lo que el estándar dice", async () => {
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: {
        ok: true,
        url: "https://ejemplo.com/",
        robotsLeido: false,
        estadoRobots: "ausente",
        motivoRobots: "http 404",
        hallazgos: [],
        legible: true,
      },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() => expect(screen.getByTestId("robots-no-leido").dataset.estado).toBe("ausente"));
    expect(screen.getByTestId("sin-hallazgos")).toBeTruthy();
  });

  it("P3: cero hallazgos SIN `legible: true` no dice «los rastreadores entran»", async () => {
    // La frase verde la habilita la ruta diciendo que todo se midió, no una
    // lista vacía: una respuesta que no lo confirma no es un sitio sano.
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: { ok: true, url: "https://ejemplo.com/", robotsLeido: true, motivoRobots: null, hallazgos: [], legible: null },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() => expect(screen.getByTestId("sin-veredicto")).toBeTruthy());
    expect(screen.queryByTestId("sin-hallazgos")).toBeNull();
  });
});
