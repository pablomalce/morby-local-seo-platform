// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la ruta de aprobación siga sin llamadores.
 *
 * Es el defecto que este proyecto ya se comió cuatro veces, el último con el
 * transporte y sus 19 tests. `estadoDelAsset.test.ts` prueba las cuatro lecturas
 * y seguiría verde con este botón sin `onClick`. Acá se afirma sobre la LLAMADA:
 * a dónde va, con qué cuerpo, y qué hace cuando la base dice que no.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContenidoDeLaOrganizacion } from "../client";
import type { AssetVisto } from "@/lib/content/estadoDelAsset";

const refrescar = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

const HUELLA = "9e107d9d372bb6826bd81d3542a419d6";
const BORRADOR: AssetVisto = {
  id: "asset-1",
  title: "Un posteo",
  kind: "gbp_post",
  locale: "es",
  status: "draft",
  approvedHash: null,
  payloadHash: HUELLA,
};

let llamadas: { url: string; body: unknown }[] = [];
let respuesta: { ok: boolean; status: number; cuerpo?: unknown } = { ok: true, status: 200 };

beforeEach(() => {
  llamadas = [];
  respuesta = { ok: true, status: 200 };
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

describe("el botón de aprobar", () => {
  it("llama a la ruta de aprobación con el id del asset", async () => {
    render(<ContenidoDeLaOrganizacion assets={[BORRADOR]} businessId="b1" />);
    fireEvent.click(screen.getByTestId("aprobar"));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].url).toBe("/api/content/approve");
    expect(llamadas[0].body).toEqual({ assetId: "asset-1" });
  });

  it("NO manda el sello: quién y con qué hash lo decide el servidor", async () => {
    render(<ContenidoDeLaOrganizacion assets={[BORRADOR]} businessId="b1" />);
    fireEvent.click(screen.getByTestId("aprobar"));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0].body).not.toHaveProperty("approvedHash");
  });

  it("refresca cuando salió bien, para que la fila deje de decir borrador", async () => {
    render(<ContenidoDeLaOrganizacion assets={[BORRADOR]} businessId="b1" />);
    fireEvent.click(screen.getByTestId("aprobar"));
    await waitFor(() => expect(refrescar).toHaveBeenCalled());
  });

  it("un fallo se MUESTRA, y el texto cambiado tiene su propio mensaje", async () => {
    // Un fallo silencioso deja a alguien apretando un botón que no hace nada.
    respuesta = { ok: false, status: 409, cuerpo: { motivo: "el-texto-cambio" } };
    render(<ContenidoDeLaOrganizacion assets={[BORRADOR]} businessId="b1" />);
    fireEvent.click(screen.getByTestId("aprobar"));

    await waitFor(() =>
      expect(screen.getByTestId("error-al-aprobar").textContent).toMatch(/texto cambió/i)
    );
    expect(refrescar).not.toHaveBeenCalled();
  });

  it("no se ofrece sobre un asset ya aprobado", async () => {
    render(
      <ContenidoDeLaOrganizacion
        assets={[{ ...BORRADOR, status: "approved", approvedHash: HUELLA }]}
        businessId="b1"
      />
    );
    expect(screen.queryByTestId("aprobar")).toBeNull();
  });

  it("sin contenido lo dice, y distingue no tener negocio de no tener contenido", () => {
    const { rerender } = render(<ContenidoDeLaOrganizacion assets={[]} businessId="b1" />);
    expect(screen.getByTestId("sin-contenido").textContent).toMatch(/no tiene contenido/i);

    rerender(<ContenidoDeLaOrganizacion assets={[]} businessId={null} />);
    expect(screen.getByTestId("sin-contenido").textContent).toMatch(/ningún negocio/i);
  });
});
