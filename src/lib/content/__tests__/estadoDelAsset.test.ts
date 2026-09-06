/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla ofrezca aprobar sobre una fila que no se puede aprobar, y que
 * llame «aprobado» a algo cuyo sello ya no describe el texto.
 */
import { describe, expect, it } from "vitest";
import { leerAsset, type AssetVisto } from "../estadoDelAsset";

const HUELLA = "9e107d9d372bb6826bd81d3542a419d6";

function asset(p: Partial<AssetVisto> = {}): AssetVisto {
  return {
    id: "a1",
    title: "Un posteo",
    kind: "gbp_post",
    locale: "es",
    status: "draft",
    approvedHash: null,
    payloadHash: HUELLA,
    ...p,
  };
}

describe("cómo se lee un asset", () => {
  it("un borrador se puede aprobar", () => {
    const l = leerAsset(asset());
    expect(l.clase).toBe("borrador");
    expect(l.sePuedeAprobar).toBe(true);
  });

  it("un borrador NO promete que sea nuevo: puede haber perdido su aprobación", () => {
    // El trigger de la 0015 devuelve a `draft` y borra el sello cuando se edita
    // un aprobado. En la base queda idéntico a uno que nunca se aprobó, y esta
    // pantalla no puede distinguirlos — así que lo dice en vez de inventarlo.
    expect(leerAsset(asset()).quePasa).toMatch(/perdió su aprobación/i);
  });

  it("uno aprobado ya no ofrece aprobar", () => {
    const l = leerAsset(asset({ status: "approved", approvedHash: HUELLA }));
    expect(l.clase).toBe("aprobado");
    expect(l.sePuedeAprobar).toBe(false);
  });

  it("los tres estados que implican aprobación se leen igual", () => {
    // `scheduled` y `published` también exigen sello en el CHECK. Mirar sólo
    // `approved` dejaría a los otros dos ofreciendo un botón que no corresponde.
    for (const status of ["approved", "scheduled", "published"]) {
      const l = leerAsset(asset({ status, approvedHash: HUELLA }));
      expect(l.clase, `con ${status}`).toBe("aprobado");
      expect(l.sePuedeAprobar).toBe(false);
    }
  });

  it("dice estar aprobado sin sello: eso es la base rota, y no se ofrece aprobar", () => {
    const l = leerAsset(asset({ status: "approved", approvedHash: null }));
    expect(l.clase).toBe("incoherente");
    expect(l.sePuedeAprobar).toBe(false);
  });

  it("un sello que no coincide con el texto no es «aprobado»", () => {
    const l = leerAsset(asset({ status: "approved", approvedHash: "otro", payloadHash: HUELLA }));
    expect(l.clase).toBe("sello-viejo");
    expect(l.sePuedeAprobar).toBe(false);
  });

  it("sólo el borrador ofrece el botón", () => {
    // La mitad que impide que `sePuedeAprobar` quede en `true` para todos.
    const clases = [
      asset(),
      asset({ status: "approved", approvedHash: HUELLA }),
      asset({ status: "approved", approvedHash: null }),
      asset({ status: "approved", approvedHash: "otro" }),
    ].map((a) => leerAsset(a).sePuedeAprobar);
    expect(clases).toEqual([true, false, false, false]);
  });
});
