/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría mezcle lo que impide una cita con lo que la empeora, y que
 * `llms.txt` se cuente como posicionamiento.
 */
import { describe, expect, it } from "vitest";
import { AGENTES_IA } from "../lectura";
import { esLegiblePorIA, hallazgos, type LecturaDelSitio } from "../hallazgos";

const TODOS_ENTRAN = Object.fromEntries(AGENTES_IA.map((a) => [a, true])) as LecturaDelSitio["acceso"];

/** Un sitio sin ningún problema, que los casos van rompiendo. */
const SANO: LecturaDelSitio = {
  acceso: TODOS_ENTRAN,
  caracteresSinJs: 4000,
  schema: ["Organization", "LocalBusiness", "FAQPage"],
  tieneLlmsTxt: true,
};

describe("qué encuentra la auditoría", () => {
  it("un sitio sano no tiene hallazgos", () => {
    // Sin esto, cualquier lista no vacía pasaría los casos de abajo y la pantalla
    // siempre mostraría algo que arreglar.
    expect(hallazgos(SANO)).toEqual([]);
    expect(esLegiblePorIA([])).toBe(true);
  });

  it("bloquear a TODOS los rastreadores es bloqueante", () => {
    const bloqueados = Object.fromEntries(AGENTES_IA.map((a) => [a, false])) as LecturaDelSitio["acceso"];
    const lista = hallazgos({ ...SANO, acceso: bloqueados });
    expect(lista[0].gravedad).toBe("bloqueante");
    expect(lista[0].donde).toMatch(/robots\.txt/);
    expect(esLegiblePorIA(lista)).toBe(false);
  });

  it("bloquear a algunos lo dice CON NOMBRE, y no lo funde con bloquear a todos", () => {
    // Son dos situaciones distintas: una es una decisión de configuración, la
    // otra suele ser un descuido heredado. Fundirlas manda a revisar de más.
    const lista = hallazgos({ ...SANO, acceso: { ...TODOS_ENTRAN, claudebot: false } });
    expect(lista[0].quePasa).toContain("claudebot");
    expect(lista[0].quePasa).toMatch(/los demás sí entran/i);
  });

  it("un sitio que necesita JavaScript es bloqueante, y dice dónde se arregla", () => {
    const lista = hallazgos({ ...SANO, caracteresSinJs: 40 });
    const h = lista.find((x) => x.quePasa.includes("JavaScript"));
    expect(h?.gravedad).toBe("bloqueante");
    expect(h?.donde).toMatch(/renderizado/);
  });

  it("el schema faltante es IMPORTANTE, no bloqueante", () => {
    // Empeora la cita, no la impide. Marcarlo bloqueante haría que un sitio
    // visible pero mejorable se viera igual que uno invisible.
    const lista = hallazgos({ ...SANO, schema: [] });
    expect(lista[0].gravedad).toBe("importante");
    expect(esLegiblePorIA(lista)).toBe(true);
  });

  it("dice QUÉ tipo de schema falta, no que falte schema", () => {
    const lista = hallazgos({ ...SANO, schema: ["Organization", "LocalBusiness"] });
    expect(lista[0].quePasa).toContain("FAQPage");
    expect(lista[0].quePasa).not.toContain("Organization");
  });

  it("`llms.txt` es INFORMATIVO y dice que no cuenta como posicionamiento", () => {
    // Es la métrica de vanidad de esta pantalla. Si algún día se marca como
    // importante, este test tiene que ponerse rojo y obligar a discutirlo.
    const lista = hallazgos({ ...SANO, tieneLlmsTxt: false });
    expect(lista[0].gravedad).toBe("informativo");
    expect(lista[0].queHacer).toMatch(/no cuenta como posicionamiento/i);
    expect(esLegiblePorIA(lista)).toBe(true);
  });

  it("un sitio roto entero acumula los hallazgos, sin perder ninguno", () => {
    const bloqueados = Object.fromEntries(AGENTES_IA.map((a) => [a, false])) as LecturaDelSitio["acceso"];
    const lista = hallazgos({
      acceso: bloqueados,
      caracteresSinJs: 10,
      schema: [],
      tieneLlmsTxt: false,
    });
    expect(lista).toHaveLength(4);
    expect(lista.filter((h) => h.gravedad === "bloqueante")).toHaveLength(2);
    expect(esLegiblePorIA(lista)).toBe(false);
  });

  it("todos los hallazgos dicen dónde se arregla", () => {
    // Un hallazgo sin lugar es un «error» sin motivo: manda a buscar.
    const bloqueados = Object.fromEntries(AGENTES_IA.map((a) => [a, false])) as LecturaDelSitio["acceso"];
    const lista = hallazgos({ acceso: bloqueados, caracteresSinJs: 10, schema: [], tieneLlmsTxt: false });
    for (const h of lista) {
      expect(h.donde.length, h.quePasa).toBeGreaterThan(0);
      expect(h.queHacer.length, h.quePasa).toBeGreaterThan(0);
    }
  });
});
