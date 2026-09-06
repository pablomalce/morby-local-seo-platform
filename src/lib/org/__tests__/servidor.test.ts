/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PARED
 *
 * Que el único lugar donde se resuelve la organización activa deje de aplicar
 * las reglas que las pantallas dejaron de aplicar cuando delegaron en él.
 *
 * Es la contracara de haber centralizado: cuatro paredes se volvieron una, y si
 * ésta no sostiene lo mismo, centralizar habría sido perder garantías.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AYUDANTE = readFileSync(join(__dirname, "..", "servidor.ts"), "utf8");

describe("cómo resuelve la organización activa", () => {
  it("lee como el usuario y NO con el admin", () => {
    expect(AYUDANTE).toContain("createSupabaseServerClient");
    expect(AYUDANTE).not.toContain("createSupabaseAdminClient");
  });

  it("las organizaciones ofrecidas son sólo las de membresía ACTIVA", () => {
    // Ofrecer una archivada la volvería elegible desde el selector, y archivar
    // es hoy la única manera de sacar a alguien de una organización.
    expect(AYUDANTE).toMatch(/state \?\? "active"\) === "active"/);
  });

  it("la elección sale de la cookie y pasa por `elegirOrganizacion`", () => {
    // Nunca directo: `elegirOrganizacion` es quien la valida contra las
    // membresías activas. Usarla sin validar sería confiar en una cookie.
    expect(AYUDANTE).toContain("COOKIE_ORG_ACTIVA");
    expect(AYUDANTE).toMatch(/elegirOrganizacion\(activas, elegida\)/);
  });

  it("si la elegida no se puede leer, devuelve null en vez de un id suelto", () => {
    // Devolver el id igual dibujaría un encabezado sin nombre y consultas que no
    // traen nada — un cliente vacío que parece un cliente.
    expect(AYUDANTE).toMatch(/if \(!actual\) return null;/);
  });
});
