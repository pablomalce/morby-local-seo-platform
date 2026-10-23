/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la frase de una baja fallida mienta sobre lo que ya no está —«no se borró
 * nada» cuando las organizaciones ya se fueron, o al revés—, o que un motivo
 * nuevo llegue a la pantalla sin frase.
 */
import { describe, expect, it } from "vitest";
import {
  explicarBaja,
  FRASE_SIN_RESPUESTA,
  loQueYaNoEsta,
  NADA_BORRADO,
  type MotivoDeBaja,
} from "../porQueNoSeBorro";

const MOTIVOS: MotivoDeBaja[] = [
  "sin-sesion",
  "no-se-pudo-verificar",
  "sello-en-otra-organizacion",
  "firma-en-otra-organizacion",
  "no-se-pudieron-borrar-las-organizaciones",
  "no-se-sabe-que-se-borro",
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
    const f = loQueYaNoEsta({ ajenas: 2, propias: 1, sellos: 0 });
    expect(f).not.toMatch(/Nothing/);
    expect(f).toMatch(/removed from 2 organizations that are not only yours/);
    expect(f).toMatch(/1 organization that was only yours was deleted/);
    expect(f).toMatch(/login is still there/);
  });

  it("sólo ajenas, o sólo propias", () => {
    expect(loQueYaNoEsta({ ajenas: 1, propias: 0, sellos: 0 })).toMatch(/removed from 1 organization that is not only yours\. /);
    expect(loQueYaNoEsta({ ajenas: 0, propias: 3, sellos: 0 })).toMatch(
      /^Already done: 3 organizations that were only yours were deleted/,
    );
  });

  it("«no se sabe cuántas» (null) no es cero, y no inventa un número", () => {
    const f = loQueYaNoEsta({ ajenas: null, propias: null, sellos: null });
    expect(f).not.toMatch(/Nothing/);
    expect(f).not.toMatch(/\d/);
    expect(f).toMatch(/removed from organizations that are not only yours/);
    expect(f).toMatch(/may have been deleted/);
    expect(f).toMatch(/approvals of yours were withdrawn/);
  });

  it("los sellos soltados (0035) se nombran con su número, y solos no son «nothing»", () => {
    const f = loQueYaNoEsta({ ajenas: 0, propias: 0, sellos: 2 });
    expect(f).toBe("Already done: 2 approvals of yours were withdrawn, back to draft, where no one else could approve. Your login is still there.");
    expect(loQueYaNoEsta({ ajenas: 1, propias: 0, sellos: 1 })).toMatch(/; 1 approval of yours was withdrawn/);
  });

  it("«no se sabe SI pasó» (null) no dice «nothing» ni «already done», ni inventa un número; sí que el login sigue", () => {
    // Es la respuesta perdida de la 0035: la transacción pudo confirmarse.
    const f = loQueYaNoEsta(null);
    expect(f).not.toMatch(/Nothing|Already done/);
    expect(f).not.toMatch(/\d/);
    expect(f).toMatch(/cannot tell whether/);
    expect(f).toMatch(/login is still there/);
  });
});

describe("FRASE_SIN_RESPUESTA — la acción no contestó", () => {
  it("no dice que no se borró nada, ni inventa lo que ya no está, y es distinta de toda frase con motivo", () => {
    // Sin respuesta, la cadena pudo cortarse en cualquier paso o terminar: decir
    // «Nothing was deleted» podría ser mentira, y un número también.
    expect(FRASE_SIN_RESPUESTA).not.toMatch(/Nothing was deleted|Already done/);
    expect(FRASE_SIN_RESPUESTA).not.toMatch(/\d/);
    expect(FRASE_SIN_RESPUESTA).toMatch(/could not confirm whether your account was deleted/);
    expect(FRASE_SIN_RESPUESTA).toMatch(/resumes where it stopped/);
    const conMotivo = MOTIVOS.map((m) => explicarBaja(m, NADA_BORRADO));
    expect(conMotivo).not.toContain(FRASE_SIN_RESPUESTA);
  });
});

describe("las frases nombran de quién es cada organización", () => {
  it("ninguna dice «you do not own» ni «you owned»: una compartida es suya también, y no se borra", () => {
    // Con varios owners, «you do not own» era falso para la compartida de la que
    // sale, y «you owned» para la que queda entera con la otra owner.
    const todas = [
      ...MOTIVOS.map((m) => explicarBaja(m, { ajenas: 2, propias: 1, sellos: 1 })),
      ...MOTIVOS.map((m) => explicarBaja(m, { ajenas: null, propias: null, sellos: null })),
      ...MOTIVOS.map((m) => explicarBaja(m, null)),
    ];
    for (const f of todas) expect(f).not.toMatch(/you do not own|you owned/);
  });
});
