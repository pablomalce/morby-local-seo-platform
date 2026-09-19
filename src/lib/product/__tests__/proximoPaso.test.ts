/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el próximo paso vuelva a ser una lista escrita a mano.
 *
 * El defecto que persigue ya pasó tres veces en este repositorio —el
 * orquestador, la pantalla de integraciones y `/settings`— y siempre igual: la
 * pantalla dice lo correcto HOY, y por el motivo equivocado. Acá se comprueba
 * que cada paso desaparece cuando su condición deja de ser cierta.
 */
import { describe, expect, it } from "vitest";
import { proximoPaso, type EstadoDelProducto } from "../proximoPaso";

/** Una organización que ya no necesita nada. Los casos la van rompiendo. */
const COMPLETA: EstadoDelProducto = {
  negocios: 1,
  mapeos: 3,
  fuentesFallando: 0,
  reportes: 2,
  contenidoAprobado: 1,
  publicaciones: 0,
};

describe("el próximo paso sale de lo que hay", () => {
  it("sin negocios, el paso es crear uno", () => {
    expect(proximoPaso({ ...COMPLETA, negocios: 0 })?.donde).toBe("/onboarding/new-business");
  });

  it("con negocio y sin mapeo, el paso es conectar Google", () => {
    expect(proximoPaso({ ...COMPLETA, mapeos: 0 })?.donde).toBe("/app/integrations");
  });

  it("una fuente fallando gana sobre generar el reporte", () => {
    // Es la parte que no es estética: un reporte generado sobre una fuente rota
    // sale con huecos y con la fecha de hoy, y después se lee como si fuera
    // bueno. El orden invertido es un defecto, no una preferencia.
    const paso = proximoPaso({ ...COMPLETA, fuentesFallando: 1, reportes: 0 });
    expect(paso?.que).toMatch(/fuentes de Google/i);
  });

  it("con todo conectado y sin reportes, el paso es generar el primero", () => {
    expect(proximoPaso({ ...COMPLETA, reportes: 0 })?.donde).toBe("/app/reports");
  });

  it("con reporte y sin contenido aprobado, el paso es aprobar", () => {
    const paso = proximoPaso({ ...COMPLETA, contenidoAprobado: 0 });
    expect(paso?.donde).toBe("/content");
    expect(paso?.porque).toMatch(/ledger/i);
  });

  it("cuando no falta nada devuelve null, y no un paso inventado", () => {
    // Inventar un paso acá es darle trabajo a alguien que ya terminó.
    expect(proximoPaso(COMPLETA)).toBeNull();
  });

  it("cada paso DESAPARECE cuando su condición deja de ser cierta", () => {
    // La mitad que impide la lista escrita a mano. Se recorre el camino entero y
    // se comprueba que el destino cambia en cada tramo: una lista fija daría
    // siempre el mismo.
    const camino: EstadoDelProducto[] = [
      { negocios: 0, mapeos: 0, fuentesFallando: 0, reportes: 0, contenidoAprobado: 0, publicaciones: 0 },
      { negocios: 1, mapeos: 0, fuentesFallando: 0, reportes: 0, contenidoAprobado: 0, publicaciones: 0 },
      { negocios: 1, mapeos: 3, fuentesFallando: 1, reportes: 0, contenidoAprobado: 0, publicaciones: 0 },
      { negocios: 1, mapeos: 3, fuentesFallando: 0, reportes: 0, contenidoAprobado: 0, publicaciones: 0 },
      { negocios: 1, mapeos: 3, fuentesFallando: 0, reportes: 1, contenidoAprobado: 0, publicaciones: 0 },
      COMPLETA,
    ];
    const pasos = camino.map((e) => proximoPaso(e)?.que ?? "(nada)");
    expect(new Set(pasos).size).toBe(camino.length);
    expect(pasos[pasos.length - 1]).toBe("(nada)");
  });
});
