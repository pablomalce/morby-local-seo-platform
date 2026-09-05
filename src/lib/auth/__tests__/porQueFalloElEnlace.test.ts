/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un fallo de login vuelva a llegar a la pantalla sin decir qué hacer.
 *
 * Los mensajes de entrada están copiados de los que Supabase devuelve de verdad
 * —el primero, textual, del que se vio en producción el 2026-09-05— y NO se
 * importan de ninguna constante del módulo: un test que compara contra el patrón
 * que el módulo usa para decidir mediría que el módulo es igual a sí mismo.
 */
import { describe, expect, it } from "vitest";
import { porQueFalloElEnlace } from "../porQueFalloElEnlace";

/** El que se vio en pantalla, tal cual. */
const PKCE = "code challenge does not match previously saved code verifier";

describe("por qué falló el enlace", () => {
  it("el de PKCE manda a pedirlo desde ESTE navegador, y no a pedir otro y ya", () => {
    const e = porQueFalloElEnlace(PKCE);
    expect(e.fallo).toBe("verificador-de-otro-navegador");
    expect(e.queHacer).toMatch(/mismo navegador/i);
    // La otra mitad, y es la que costó una vuelta entera: pedir otro sin cambiar
    // de navegador vuelve a fallar igual, y encima invalida el que ya llegó.
    expect(e.queHacer).toMatch(/invalida el anterior/i);
    expect(e.mostrarCrudo).toBe(false);
  });

  it("gana sobre `vencido` aunque el mensaje traiga la palabra `invalid`", () => {
    // Supabase escribe este fallo de varias maneras según la versión. Si
    // `invalid` decidiera primero, el consejo sería «pedí otro» — que es
    // exactamente lo que no hay que hacer acá.
    const e = porQueFalloElEnlace("invalid request: code verifier should be non-empty");
    expect(e.fallo).toBe("verificador-de-otro-navegador");
  });

  it("un enlace usado o vencido manda a pedir uno nuevo", () => {
    for (const crudo of [
      "Email link is invalid or has expired",
      "otp_expired",
      "access_denied",
    ]) {
      const e = porQueFalloElEnlace(crudo);
      expect(e.fallo, `con "${crudo}"`).toBe("enlace-vencido-o-usado");
      expect(e.queHacer).toMatch(/nuevo/i);
    }
  });

  it("llegar sin código es su propio caso", () => {
    expect(porQueFalloElEnlace("missing_code").fallo).toBe("sin-codigo");
  });

  it("lo que no sabe explicar lo MUESTRA, en vez de taparlo", () => {
    // Un fallo nuevo detrás de un «algo salió mal» es un motivo que se pierde.
    const e = porQueFalloElEnlace("database is on fire");
    expect(e.fallo).toBe("desconocido");
    expect(e.mostrarCrudo).toBe(true);
  });

  it("los cuatro casos dicen cosas distintas y ninguno se queda sin acción", () => {
    // Sin esto, un módulo que devolviera la misma frase cuatro veces pasaría
    // todos los casos de arriba salvo uno, y la pantalla dejaría de orientar.
    const frases = new Set<string>();
    for (const crudo of [PKCE, "otp_expired", "missing_code", "database is on fire"]) {
      const e = porQueFalloElEnlace(crudo);
      expect(e.queHacer.length, `con "${crudo}"`).toBeGreaterThan(0);
      frases.add(e.quePaso);
    }
    expect(frases.size).toBe(4);
  });
});
