/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la frase de una baja fallida mienta sobre lo que ya no está —«no se borró
 * nada» cuando las organizaciones ya se fueron, o al revés—, o que un motivo
 * nuevo llegue a la pantalla sin frase.
 */
import { describe, expect, it } from "vitest";
import { explicarBaja, loQueYaNoEsta, NADA_BORRADO, type MotivoDeBaja } from "../porQueNoSeBorro";

const MOTIVOS: MotivoDeBaja[] = [
  "sin-sesion",
  "no-se-pudo-verificar",
  "sello-en-otra-organizacion",
  "firma-en-otra-organizacion",
  "no-se-pudo-salir",
  "no-se-pudieron-borrar-las-propias",
  "no-se-pudo-borrar-el-acceso",
];

describe("explicarBaja", () => {
  it.each(MOTIVOS)("«%s» tiene frase propia, con por qué y qué hacer", (motivo) => {
    const frase = explicarBaja(motivo, NADA_BORRADO);
    expect(frase).not.toMatch(/undefined/);
    expect(frase).toMatch(/^Your account was not (fully )?deleted: /);
    // Ninguna frase es la de otro motivo: si dos coincidieran, la pantalla no
    // distinguiría casos que se arreglan en lugares distintos.
    const otras = MOTIVOS.filter((m) => m !== motivo).map((m) => explicarBaja(m, NADA_BORRADO));
    expect(otras).not.toContain(frase);
  });

  it("los rechazos que decide otra organización dicen que el paso siguiente es de ELLA, no reintentar ya", () => {
    expect(explicarBaja("firma-en-otra-organizacion", NADA_BORRADO)).toMatch(/That organization has to decide/);
    expect(explicarBaja("sello-en-otra-organizacion", NADA_BORRADO)).toMatch(/Ask that organization/);
  });
});

describe("loQueYaNoEsta", () => {
  it("sin nada borrado dice exactamente eso", () => {
    expect(loQueYaNoEsta(NADA_BORRADO)).toBe("Nothing was deleted.");
  });

  it("con algo borrado NO dice «nothing», y nombra cada cosa con su número", () => {
    const f = loQueYaNoEsta({ ajenas: 2, propias: 1 });
    expect(f).not.toMatch(/Nothing/);
    expect(f).toMatch(/removed from 2 organizations you do not own/);
    expect(f).toMatch(/1 organization you owned was deleted/);
    expect(f).toMatch(/login is still there/);
  });

  it("sólo ajenas, o sólo propias", () => {
    expect(loQueYaNoEsta({ ajenas: 1, propias: 0 })).toMatch(/removed from 1 organization you do not own\. /);
    expect(loQueYaNoEsta({ ajenas: 0, propias: 3 })).toMatch(/^Already done: 3 organizations you owned were deleted/);
  });

  it("«no se sabe cuántas» (null) no es cero, y no inventa un número", () => {
    const f = loQueYaNoEsta({ ajenas: null, propias: null });
    expect(f).not.toMatch(/Nothing/);
    expect(f).not.toMatch(/\d/);
    expect(f).toMatch(/removed from organizations you do not own/);
    expect(f).toMatch(/may have been deleted/);
  });
});
