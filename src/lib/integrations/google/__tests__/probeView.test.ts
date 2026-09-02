/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que dos fallos que se arreglan en lugares opuestos se lean igual.
 *
 * `401` y `403` son el par que importa: el primero es el token de la plataforma
 * —se arregla una vez, para todos los clientes— y el segundo es el permiso sobre
 * la property de ESTE cliente. Una frase que los junte manda a rehacer el OAuth a
 * quien tenía que pedir un acceso, que es el mismo defecto que esta pantalla
 * viene impidiendo desde el #46, ahora en el vocabulario de los códigos HTTP.
 */
import { describe, expect, it } from "vitest";
import { type SondaVista, haceCuanto, queHacer } from "../probeView";

function sonda(over: Partial<SondaVista> = {}): SondaVista {
  return {
    surface: "ga4",
    outcome: "http",
    httpStatus: 403,
    propertyRef: "properties/123456789",
    checkedAt: "2026-09-02T10:00:00.000Z",
    ...over,
  };
}

describe("queHacer", () => {
  it("no dice nada cuando la última consulta salió bien", () => {
    // Un cartel que aparece siempre se deja de leer, y la insignia ya dice
    // CONNECTED.
    expect(queHacer(sonda({ outcome: "ok", httpStatus: null }))).toBeNull();
  });

  it("un 401 manda al token de la plataforma, no al permiso del cliente", () => {
    const texto = queHacer(sonda({ httpStatus: 401 })) ?? "";
    expect(texto).toContain("token");
    expect(texto).not.toContain("permiso sobre");
  });

  it("un 403 manda al permiso del cliente, no al token", () => {
    const texto = queHacer(sonda({ httpStatus: 403 })) ?? "";
    expect(texto).toContain("permiso");
    expect(texto).toContain("properties/123456789");
  });

  it("un 400 apunta al identificador, que es lo que casi siempre está mal", () => {
    expect(queHacer(sonda({ httpStatus: 400 })) ?? "").toContain("identificador");
  });

  it("un 429 se resuelve esperando y lo dice", () => {
    expect(queHacer(sonda({ httpStatus: 429 })) ?? "").toContain("cuota");
  });

  it("un 5xx dice que el problema es de Google", () => {
    expect(queHacer(sonda({ httpStatus: 503 })) ?? "").toContain("de su lado");
  });

  it("distingue las tres maneras de no tener respuesta", () => {
    expect(queHacer(sonda({ outcome: "timeout", httpStatus: null })) ?? "").toContain("tardó");
    expect(queHacer(sonda({ outcome: "network", httpStatus: null })) ?? "").toContain("red");
    expect(queHacer(sonda({ outcome: "malformed", httpStatus: null })) ?? "").toContain(
      "defecto nuestro"
    );
  });

  it("un outcome que la pantalla no conoce se dice, no se calla", () => {
    // Una palabra nueva en la base con una pantalla muda es exactamente cómo se
    // pierde un motivo, que es lo que todo esto existe para impedir.
    const texto = queHacer(sonda({ outcome: "algo-nuevo", httpStatus: null })) ?? "";
    expect(texto).toContain("algo-nuevo");
  });
});

describe("haceCuanto", () => {
  const AHORA = new Date("2026-09-02T12:00:00.000Z");

  it("distingue un problema vivo de uno viejo", () => {
    // Es la mitad del valor: un 403 de hace un minuto es el estado actual, uno de
    // hace tres semanas puede estar arreglado hace rato.
    expect(haceCuanto("2026-09-02T11:59:30.000Z", AHORA)).toContain("menos de un minuto");
    expect(haceCuanto("2026-09-02T11:30:00.000Z", AHORA)).toBe("hace 30 minutos");
    expect(haceCuanto("2026-09-02T09:00:00.000Z", AHORA)).toBe("hace 3 horas");
    expect(haceCuanto("2026-08-30T12:00:00.000Z", AHORA)).toBe("hace 3 días");
  });

  it("usa singular donde corresponde", () => {
    expect(haceCuanto("2026-09-02T11:59:00.000Z", AHORA)).toBe("hace 1 minuto");
    expect(haceCuanto("2026-09-02T11:00:00.000Z", AHORA)).toBe("hace 1 hora");
    expect(haceCuanto("2026-09-01T12:00:00.000Z", AHORA)).toBe("hace 1 día");
  });

  it("una fecha ilegible se dice, y no se muestra como «hace NaN minutos»", () => {
    expect(haceCuanto("no es una fecha", AHORA)).toContain("no se pudo leer");
  });
});
