/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que los avisos de escala se conviertan en una lista fija que dice lo mismo
 * siempre. Es el defecto que ya se sacó de cuatro lugares de este repositorio.
 *
 * Acá se comprueba que cada aviso APARECE y DESAPARECE con la condición que lo
 * produce.
 */
import { describe, expect, it } from "vitest";
import {
  CLIENTES_PARA_BUSCADOR,
  CLIENTES_PARA_REVISAR_PLANES,
  MEDIDO_EL,
  avisosDeEscala,
} from "../avisos";

const titulos = (n: number) => avisosDeEscala(n).map((a) => a.titulo);

describe("los avisos salen de la cantidad de clientes", () => {
  it("con un solo cliente sólo queda la foto fechada de los planes", () => {
    // Un cartel sobre un problema que todavía no tenés enseña a ignorar los
    // carteles.
    const avisos = avisosDeEscala(1);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].clase).toBe("fechado");
  });

  it("con dos aparecen los dos que dependen de tener más de uno", () => {
    const t = titulos(2);
    expect(t.some((x) => /acceso en su Google/i.test(x))).toBe(true);
    expect(t.some((x) => /cuotas de Google/i.test(x))).toBe(true);
  });

  it("el aviso de planes aparece EN el umbral y no antes", () => {
    expect(titulos(CLIENTES_PARA_REVISAR_PLANES - 1).some((x) => /revisar los planes/i.test(x))).toBe(false);
    expect(titulos(CLIENTES_PARA_REVISAR_PLANES).some((x) => /revisar los planes/i.test(x))).toBe(true);
  });

  it("el del selector aparece EN su umbral y no antes", () => {
    expect(titulos(CLIENTES_PARA_BUSCADOR - 1).some((x) => /selector/i.test(x))).toBe(false);
    expect(titulos(CLIENTES_PARA_BUSCADOR).some((x) => /selector/i.test(x))).toBe(true);
  });

  it("el aviso dice el número real, no un genérico", () => {
    expect(titulos(12).some((x) => x.includes("12"))).toBe(true);
  });

  it("la foto de los planes lleva SU FECHA y dice que no es el estado de hoy", () => {
    // Es lo que la separa de una mentira: la aplicación no puede leer el plan.
    const fechado = avisosDeEscala(1).find((a) => a.clase === "fechado")!;
    expect(fechado.titulo).toContain(MEDIDO_EL);
    expect(fechado.detalle).toMatch(/no el estado de hoy/i);
  });

  it("y avisa que la licencia Hobby de Vercel no es para uso comercial", () => {
    // No es un límite de capacidad y por eso se dice aparte: es de licencia.
    const fechado = avisosDeEscala(1).find((a) => a.clase === "fechado")!;
    expect(fechado.detalle).toMatch(/no comercial/i);
  });

  it("todos los avisos dicen qué pasa y dónde se resuelve", () => {
    for (const a of avisosDeEscala(20)) {
      expect(a.donde.length, a.titulo).toBeGreaterThan(0);
      expect(a.detalle.length, a.titulo).toBeGreaterThan(0);
    }
  });

  it("crecer sólo AGREGA avisos: ninguno desaparece al sumar clientes", () => {
    // La mitad que impide que un umbral tape a otro.
    expect(avisosDeEscala(20).length).toBeGreaterThan(avisosDeEscala(2).length);
  });
});
