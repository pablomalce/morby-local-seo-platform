// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que las lecturas estén bien y la pantalla las tire.
 *
 * `ledgerView.test.ts` prueba las cinco lecturas y seguiría verde con este
 * componente mostrando `status` crudo: no puede ver el cableado.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnsayoDePublicacion, Ledger } from "../client";
import type { FilaLedger } from "@/lib/publishing/ledgerView";
import type { AssetEnsayable } from "@/lib/publishing/ensayoVisto";

const refrescar = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

const APROBADO: AssetEnsayable = {
  id: "55555555-5555-4555-8555-555555555555",
  title: "Un posteo",
  kind: "gbp_post",
  locale: "es",
};

let llamadas: { url: string; body: Record<string, unknown> }[] = [];
let respuesta: { ok: boolean; status: number; cuerpo?: unknown } = {
  ok: true,
  status: 200,
  cuerpo: { ok: true, estado: "ensayado", publicationId: "pub-nueva" },
};

beforeEach(() => {
  llamadas = [];
  respuesta = { ok: true, status: 200, cuerpo: { ok: true, estado: "ensayado", publicationId: "pub-nueva" } };
  refrescar.mockClear();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    llamadas.push({ url, body: JSON.parse(String(init.body)) });
    return {
      ok: respuesta.ok,
      status: respuesta.status,
      json: async () => respuesta.cuerpo ?? {},
    } as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fila(parcial: Partial<FilaLedger> = {}): FilaLedger {
  return {
    id: "pub-1",
    assetId: "7d703707-4f9d-43bf-9305-6bc22eddf45f",
    destination: "google_business_profile",
    status: "pending",
    externalId: null,
    attempts: 0,
    createdAt: "2026-09-05T12:00:00.000Z",
    publishedAt: null,
    ...parcial,
  };
}

describe("el ledger dibujado", () => {
  it("sin filas dice qué falta, y no sólo que está vacío", () => {
    // Un ledger vacío acá significa algo concreto: no hay contenido APROBADO
    // sobre el que ensayar. Decir «todavía nada» deja a alguien esperando.
    render(<Ledger filas={[]} />);
    expect(screen.getByTestId("ledger-vacio").textContent).toMatch(/aprobado/i);
    expect(screen.queryByTestId("ledger-fila")).toBeNull();
  });

  it("distingue la reserva del intento perdido, que es lo que la columna cruda funde", () => {
    render(<Ledger filas={[fila({ id: "a" }), fila({ id: "b", attempts: 3 })]} />);

    const clases = screen.getAllByTestId("ledger-fila").map((e) => e.dataset.clase);
    expect(clases).toEqual(["reservada", "intento-perdido"]);
    // Y las dos son `pending` en la base: si la pantalla mostrara `status`, se
    // verían idénticas.
    expect(screen.getByText(/mirar en el destino/i)).toBeTruthy();
  });

  it("una fila rota se ve como rota, no como una publicación", () => {
    render(<Ledger filas={[fila({ status: "published", publishedAt: "x" })]} />);
    expect(screen.getByTestId("ledger-fila").dataset.clase).toBe("incoherente");
    expect(screen.getByText("LEDGER BROKEN")).toBeTruthy();
  });

  it("una publicada muestra el id de la red", () => {
    render(<Ledger filas={[fila({ status: "published", externalId: "gbp-9", publishedAt: "x" })]} />);
    expect(screen.getByTestId("ledger-fila").textContent).toContain("gbp-9");
  });
});


/**
 * EL DEFECTO TITULAR DE ESTE FRENTE
 *
 * «La ruta existe y nadie la llama». `ensayoVisto.test.ts` prueba las diez
 * lecturas y seguiría verde con este botón sin `onClick`, o apuntando a otra
 * ruta. Por eso lo que se afirma acá es la LLAMADA: a dónde va, con QUÉ cuerpo,
 * y qué pasa —y qué NO pasa— con cada respuesta.
 */
describe("el botón de ensayar", () => {
  it("llama a la ruta de ENSAYO, y el cuerpo es exactamente el id del asset", async () => {
    // Si el destino cambiara a `/api/publishing/publish`, este mismo click
    // mandaría el posteo a la ficha real de un cliente. Y un `modo` mandado
    // desde el navegador convertiría el ensayo en un envío: el modo es un
    // literal del servidor a propósito.
    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].url).toBe("/api/publishing/rehearse");
    expect(llamadas[0].body).toEqual({ assetId: APROBADO.id });
    expect(llamadas[0].body).not.toHaveProperty("organizationId");
    expect(llamadas[0].body).not.toHaveProperty("approvedHash");
    expect(llamadas[0].body).not.toHaveProperty("modo");
  });

  it("manda el asset ELEGIDO, no siempre el primero", async () => {
    // El defecto que impide: un selector decorativo. Se vería idéntico.
    const otro: AssetEnsayable = { ...APROBADO, id: "66666666-6666-4666-8666-666666666666", title: "Otro" };
    render(<EnsayoDePublicacion aprobados={[APROBADO, otro]} />);
    fireEvent.change(screen.getByTestId("elegir-asset"), { target: { value: otro.id } });
    fireEvent.click(screen.getByTestId("ensayar"));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].body).toEqual({ assetId: otro.id });
  });

  it("refresca el ledger cuando el ensayo salió, para que la fila nueva se vea sin recargar", async () => {
    // Sin esto el único testigo del ensayo es el cartel de esta pantalla, que es
    // exactamente lo que el ledger existe para no tener que creer.
    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    await waitFor(() => expect(refrescar).toHaveBeenCalled());
    expect(screen.getByTestId("resultado-ensayo").dataset.clase).toBe("ensayado");
  });

  it("`ya-publicado` se dice, porque el refresh no cambia nada visible", async () => {
    // El defecto que impide: el operador aprieta, la fila ya estaba, y sin frase
    // propia concluye que el botón no hace nada.
    respuesta = { ok: true, status: 200, cuerpo: { ok: true, estado: "ya-publicado", publicationId: "p", externalId: "gbp-9" } };
    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    await waitFor(() => expect(screen.getByTestId("resultado-ensayo").dataset.clase).toBe("ya-publicado"));
  });

  it("404, 409, 429 y 502 se LEEN, y con cuatro textos distintos", async () => {
    // El defecto que impide: el `catch` que traga y el «no se pudo» único. Cada
    // uno de estos cuatro se arregla en otro lado: recargando, aprobando en
    // /app/content, esperando un minuto, o mirando la base.
    const casos: { status: number; cuerpo: unknown; clase: string }[] = [
      { status: 404, cuerpo: { error: "not found" }, clase: "asset-ausente" },
      { status: 409, cuerpo: { ok: false, motivo: "no-aprobado" }, clase: "no-aprobado" },
      { status: 429, cuerpo: { error: "rate limited" }, clase: "demasiados" },
      { status: 502, cuerpo: { ok: false, motivo: "ledger-ilegible", detalle: "57P01" }, clase: "ledger-ilegible" },
    ];

    const textos = new Set<string>();
    for (const caso of casos) {
      respuesta = { ok: false, status: caso.status, cuerpo: caso.cuerpo };
      render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
      fireEvent.click(screen.getByTestId("ensayar"));

      const visto = await waitFor(() => screen.getByTestId("error-ensayo"));
      expect(visto.dataset.clase, `status ${caso.status}`).toBe(caso.clase);
      // Se guarda el «qué pasó» POR SU testid y no por ser la primera `<p>`:
      // el cartel nombra arriba el asset ensayado, y buscar por posición medía
      // el orden del DOM en vez del texto. Con el bloque entero, en cambio, dos
      // motivos con el mismo «qué pasó» y distinto «qué hacer» contarían como
      // distintos.
      textos.add(String(screen.getByTestId("ensayo-que-paso").textContent));
      // Y ninguno se dibuja donde va un ensayo que ocurrió.
      expect(screen.queryByTestId("resultado-ensayo")).toBeNull();
      cleanup();
    }

    expect(textos.size).toBe(casos.length);
  });

  it("un fallo NO refresca el ledger: no hay fila nueva que mostrar", async () => {
    respuesta = { ok: false, status: 409, cuerpo: { ok: false, motivo: "no-aprobado" } };
    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    await waitFor(() => expect(screen.getByTestId("error-ensayo")).toBeTruthy());
    expect(refrescar).not.toHaveBeenCalled();
  });

  it("un 200 con un estado que el ensayo no puede dar se dibuja como fallo y no refresca", async () => {
    // En `dry-run` no debería poder ocurrir: si ocurre, el modo dejó de ser el
    // que esta pantalla cree, y celebrarlo sería dibujar una publicación que
    // nadie pidió.
    respuesta = { ok: true, status: 200, cuerpo: { ok: true, estado: "publicado", externalId: "gbp-9" } };
    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    await waitFor(() => expect(screen.getByTestId("error-ensayo").dataset.clase).toBe("defecto-del-servidor"));
    expect(refrescar).not.toHaveBeenCalled();
  });

  it("sin assets aprobados NO hay botón ni selector, y se dice por qué", async () => {
    // Un botón que sólo puede dar 409 es una capacidad anunciada que no existe,
    // y hoy `content_assets` en hosted está en 0: el vacío es el caso normal.
    render(<EnsayoDePublicacion aprobados={[]} />);
    expect(screen.queryByTestId("ensayar")).toBeNull();
    expect(screen.queryByTestId("elegir-asset")).toBeNull();
    expect(screen.getByTestId("sin-aprobados").textContent).toMatch(/aprobado/i);
    expect(screen.getByTestId("sin-aprobados").textContent).toMatch(/\/app\/content/);
    expect(llamadas).toHaveLength(0);
  });

  it("dice que el ensayo ESCRIBE una fila, y no ofrece nada de publicación real", () => {
    // `publicar()` inserta con `service_role` antes de mirar el modo, y desde la
    // UI esa fila no se puede borrar. Callarlo sería vender el ensayo como algo
    // sin consecuencias.
    const { container } = render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    expect(container.textContent).toMatch(/reserva/i);
    expect(container.innerHTML).not.toMatch(/publishing\/publish|en-vivo/);
  });
});

/**
 * LO QUE UN ESCÉPTICO MIDIÓ SOBRE LA PRIMERA VERSIÓN DE ESTA PANTALLA.
 *
 * Los cinco casos de abajo no salieron de imaginar qué podría pasar: salieron de
 * dos agentes que atacaron el bloque del ensayo el 2026-09-26 y encontraron que
 * se podía ensayar dos veces con dos clicks, que el selector podía mostrar un
 * asset y el botón mandar otro, que si la red se caía la pantalla no decía nada,
 * y que el cartel de un ensayo sobrevivía al cambio de asset sin decir de cuál
 * era. Cada uno tiene su defecto nombrado, y cada uno cae si el arreglo se va.
 */
describe("el botón de ensayar — lo que rompía antes", () => {
  const OTRO: AssetEnsayable = { id: "66666666-6666-4666-8666-666666666666", title: "Otro posteo", kind: "gbp_post", locale: "sv" };

  it("dos clicks seguidos disparan UN solo ensayo (defecto: `useTransition` sólo está pendiente DESPUÉS del fetch, así que el botón seguía habilitado durante el pedido)", async () => {
    let soltar: (() => void) | null = null;
    const enEspera = new Promise<void>((r) => { soltar = r; });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      llamadas.push({ url, body: JSON.parse(String(init.body)) });
      await enEspera;
      return { ok: true, status: 200, json: async () => ({ ok: true, estado: "ensayado", publicationId: "p" }) } as Response;
    });

    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    const boton = screen.getByTestId("ensayar");
    fireEvent.click(boton);
    // El segundo click ocurre con el primer pedido en vuelo, que es el caso.
    fireEvent.click(boton);
    // Sin jest-dom en este repo: la propiedad del DOM, que es lo que el navegador mira.
    expect((boton as HTMLButtonElement).disabled).toBe(true);

    soltar!();
    await waitFor(() => expect(screen.getByTestId("resultado-ensayo")).toBeTruthy());
    expect(llamadas).toHaveLength(1);
  });

  it("si el fetch no llega a contestar, la pantalla lo DICE y no se lee como si nada hubiera pasado (defecto: sin catch, el click no dejaba rastro y el pedido pudo haber llegado)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    const visto = await waitFor(() => screen.getByTestId("error-ensayo"));
    expect(visto.dataset.clase).toBe("sin-respuesta");
    expect(screen.getByTestId("ensayo-que-paso").textContent).toMatch(/NO SE SABE/);
    // Y no refresca: no hay nada que se sepa que haya cambiado.
    expect(refrescar).not.toHaveBeenCalled();
    // El botón vuelve a estar usable: el `finally` corre igual.
    expect((screen.getByTestId("ensayar") as HTMLButtonElement).disabled).toBe(false);
  });

  it("manda el asset que el selector MUESTRA, incluso si la lista cambió debajo (defecto: el id guardado en estado sobrevivía a un refresh que lo saca de la lista, y el select mostraba el primero mientras el botón mandaba el que se fue)", async () => {
    const { rerender } = render(<EnsayoDePublicacion aprobados={[APROBADO, OTRO]} />);
    fireEvent.change(screen.getByTestId("elegir-asset"), { target: { value: OTRO.id } });

    // El refresh trae una lista sin el elegido — el caso que el escéptico midió.
    rerender(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    expect((screen.getByTestId("elegir-asset") as HTMLSelectElement).value).toBe(APROBADO.id);

    fireEvent.click(screen.getByTestId("ensayar"));
    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].body).toEqual({ assetId: APROBADO.id });
  });

  it("el cartel NOMBRA el asset que se ensayó, así que cambiar el selector no lo convierte en el de otro (defecto: el resultado sobrevivía al cambio sin decir de cuál era)", async () => {
    render(<EnsayoDePublicacion aprobados={[APROBADO, OTRO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    const visto = await waitFor(() => screen.getByTestId("resultado-ensayo"));
    expect(visto.dataset.de).toBe(APROBADO.id);
    expect(visto.textContent).toContain("Un posteo");

    fireEvent.change(screen.getByTestId("elegir-asset"), { target: { value: OTRO.id } });
    // El cartel sigue, y sigue diciendo de quién era.
    expect(screen.getByTestId("resultado-ensayo").dataset.de).toBe(APROBADO.id);
    expect(screen.getByTestId("resultado-ensayo").textContent).toContain("Un posteo");
  });

  it("un 502 que no trae la marca de «no pude leer el asset» se lee como INCERTIDUMBRE (defecto: cualquier 502 sin `motivo` afirmaba que el ledger no se tocó, y un 502 de un proxy caía ahí)", async () => {
    respuesta = { ok: false, status: 502, cuerpo: { error: "Bad Gateway" } };
    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    const visto = await waitFor(() => screen.getByTestId("error-ensayo"));
    expect(visto.dataset.clase).toBe("ledger-ilegible");
    expect(screen.getByTestId("ensayo-que-paso").textContent).toMatch(/NO SE SABE/);
  });

  it("y el 502 que SÍ trae la marca dice que el ledger quedó intacto (cerrar de más también es un defecto: si todo 502 fuera incierto, nadie sabría cuándo se puede reintentar tranquilo)", async () => {
    respuesta = { ok: false, status: 502, cuerpo: { error: "asset unreadable" } };
    render(<EnsayoDePublicacion aprobados={[APROBADO]} />);
    fireEvent.click(screen.getByTestId("ensayar"));

    const visto = await waitFor(() => screen.getByTestId("error-ensayo"));
    expect(visto.dataset.clase).toBe("asset-ilegible");
    expect(screen.getByTestId("ensayo-que-paso").textContent).toMatch(/no se tocó/);
  });
});
