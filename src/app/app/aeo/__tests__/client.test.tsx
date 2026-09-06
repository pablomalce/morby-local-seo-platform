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
  cuerpo: { ok: true, url: "https://ejemplo.com/", robotsLeido: true, motivoRobots: null, hallazgos: [] },
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
    cuerpo: { ok: true, url: "https://ejemplo.com/", robotsLeido: true, motivoRobots: null, hallazgos: [] },
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

  it("avisa cuando el robots.txt no se pudo leer, aunque la auditoría salga bien", async () => {
    // «Permite» y «no se pudo comprobar» no son lo mismo, y la pantalla lo dice.
    respuesta = {
      ok: true,
      status: 200,
      cuerpo: {
        ok: true,
        url: "https://ejemplo.com/",
        robotsLeido: false,
        motivoRobots: "timeout",
        hallazgos: [],
      },
    };
    render(<AuditoriaAeo businessId={NEGOCIO} />);
    fireEvent.click(screen.getByTestId("auditar"));
    await waitFor(() => expect(screen.getByTestId("robots-no-leido")).toBeTruthy());
  });
});
