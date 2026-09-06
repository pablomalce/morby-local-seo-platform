/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el publicador diga que publicó algo que no publicó, y que la barra del
 * identificador se codifique como pasó con GA4.
 *
 * Lo que NO puede probar, y conviene que quede escrito: que el CUERPO del pedido
 * sea el que Google espera. Eso sólo lo contesta una publicación real, y para eso
 * hace falta la cuota — que es la puerta de F4. Acá se prueba todo lo demás.
 */
import { describe, expect, it, vi } from "vitest";
import type { EntradaPublicacion } from "../transport";
import { publicadorDeBusinessProfile, urlDePosts } from "../googleBusinessProfile";

const ENTRADA: EntradaPublicacion = {
  organizationId: "df6743a9-6f98-400e-8efb-fdcc37b3cb45",
  assetId: "7d703707-4f9d-43bf-9305-6bc22eddf45f",
  approvedHash: "9e107d9d372bb6826bd81d3542a419d6",
  destino: "google_business_profile",
};

const DATOS = { cuerpo: "Texto aprobado", locationRef: "locations/456" };

function armar(
  respuesta: Partial<Response> | Error,
  datos: typeof DATOS | null = DATOS,
  registro: { url?: string; init?: RequestInit } = {}
) {
  const fetcher = (async (url: string, init: RequestInit) => {
    registro.url = url;
    registro.init = init;
    if (respuesta instanceof Error) throw respuesta;
    return respuesta as Response;
  }) as unknown as typeof fetch;

  return publicadorDeBusinessProfile({
    accessToken: "ACCESO-sintetico",
    accountId: "123",
    leerDatos: vi.fn(async () => datos),
    fetcher,
  });
}

const ok = (json: unknown) =>
  ({ ok: true, status: 200, json: async () => json }) as Partial<Response>;

describe("la URL de los posts", () => {
  it("la barra de `locations/N` es un SEPARADOR y no se codifica", () => {
    // Es el defecto de GA4, que costó un 404 leído como problema de permisos.
    const url = urlDePosts("123", "locations/456");
    expect(url).toBe("https://mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts");
    expect(url).not.toContain("%2F");
  });

  it("y lo raro DENTRO de un segmento sí se escapa", () => {
    // La forma la valida la 0017, pero esta función recibe un `string`.
    expect(urlDePosts("1 2", "locations/4?x")).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/1%202/locations/4%3Fx/localPosts"
    );
  });
});

describe("cuándo NO se llama a la red", () => {
  it("sin datos no se publica", async () => {
    const registro: { url?: string } = {};
    const r = await armar(ok({}), null, registro).publicar(ENTRADA);
    expect(r).toEqual({ ok: false, motivo: "sin-datos-para-publicar" });
    expect(registro.url).toBeUndefined();
  });

  it("con el cuerpo vacío tampoco", async () => {
    // Llamar igual publicaría un post vacío en la ficha de un cliente, que desde
    // acá es irreversible.
    const registro: { url?: string } = {};
    const r = await armar(ok({}), { ...DATOS, cuerpo: "   " }, registro).publicar(ENTRADA);
    expect(r).toEqual({ ok: false, motivo: "cuerpo-vacio" });
    expect(registro.url).toBeUndefined();
  });
});

describe("qué contesta según lo que devuelve Google", () => {
  it("un 2xx con `name` es el único éxito, y ese `name` es el id de la red", async () => {
    const registro: { url?: string; init?: RequestInit } = {};
    const r = await armar(ok({ name: "accounts/123/locations/456/localPosts/9" }), DATOS, registro)
      .publicar(ENTRADA);

    expect(r).toEqual({ ok: true, externalId: "accounts/123/locations/456/localPosts/9" });
    expect(registro.url).toContain("/localPosts");
    expect((registro.init?.headers as Record<string, string>).authorization).toBe(
      "Bearer ACCESO-sintetico"
    );
    expect(JSON.parse(String(registro.init?.body)).summary).toBe("Texto aprobado");
  });

  it("un 2xx SIN `name` NO es un éxito", async () => {
    // El post puede haber salido y no hay a qué volver: ni para mirarlo ni para
    // borrarlo. El CHECK de la 0016 tampoco lo aceptaría.
    expect(await armar(ok({})).publicar(ENTRADA)).toEqual({ ok: false, motivo: "sin-id-de-la-red" });
  });

  it("un 2xx con el cuerpo ilegible tampoco es un éxito", async () => {
    const rota = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("roto");
      },
    } as Partial<Response>;
    expect(await armar(rota).publicar(ENTRADA)).toEqual({ ok: false, motivo: "respuesta-ilegible" });
  });

  it("un error HTTP viaja con su número", async () => {
    const r = await armar({ ok: false, status: 429 } as Partial<Response>).publicar(ENTRADA);
    expect(r).toEqual({ ok: false, motivo: "http 429" });
  });

  it("sin respuesta se dice sin respuesta, y NO se dice que falló la publicación", async () => {
    // No se puede saber si el post salió. El transporte deja la fila abierta y el
    // ledger manda a mirar el destino antes de reintentar.
    expect(await armar(new Error("ECONNRESET")).publicar(ENTRADA)).toEqual({
      ok: false,
      motivo: "sin-respuesta",
    });
  });

  it("ningún camino de fallo devuelve `ok: true`", async () => {
    // La mitad que importa: un publicador que dice que publicó lo que no publicó
    // deja el ledger diciendo que salió algo que nadie mandó.
    const fallos = [
      await armar(ok({})).publicar(ENTRADA),
      await armar({ ok: false, status: 500 } as Partial<Response>).publicar(ENTRADA),
      await armar(new Error("x")).publicar(ENTRADA),
      await armar(ok({}), null).publicar(ENTRADA),
    ];
    expect(fallos.every((r) => r.ok === false)).toBe(true);
  });
});
