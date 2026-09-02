/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la organización activa vuelva a elegirse al azar.
 *
 * El defecto ocurrió y costó una hora de diagnóstico: con dos membresías `owner`
 * —la organización propia y la de la agencia— la base devolvía cualquiera de las
 * dos, y si devolvía la que no tiene negocios, el selector quedaba vacío con la
 * petición contestando 200. El síntoma no señala a esta línea por ningún lado.
 *
 * Los casos de abajo son los tres que rompen: el orden alfabético que ponía
 * `admin` delante de `owner`, el empate sin desempate, y la membresía archivada
 * que sólo la RLS escondía.
 */
import { describe, expect, it } from "vitest";
import { elegirOrganizacion } from "../supabaseTenantStore";

const AGENCIA = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const PROPIA = "5f1a2c7c-fac8-4d91-9ddc-770d8335a9a7";

describe("elegirOrganizacion", () => {
  it("prefiere owner sobre admin, que es lo que el código viejo hacía al revés", () => {
    const elegida = elegirOrganizacion([
      { organization_id: PROPIA, role: "admin", state: "active" },
      { organization_id: AGENCIA, role: "owner", state: "active" },
    ]);
    expect(elegida).toBe(AGENCIA);
  });

  it("y owner sobre member", () => {
    expect(
      elegirOrganizacion([
        { organization_id: PROPIA, role: "member", state: "active" },
        { organization_id: AGENCIA, role: "owner", state: "active" },
      ])
    ).toBe(AGENCIA);
  });

  it("con dos del mismo rol elige SIEMPRE la misma, en cualquier orden de entrada", () => {
    // Ésta es la que dolió. Dos `owner` y ningún desempate: la pantalla elegía
    // una distinta según lo que la base devolviera primero.
    const a = elegirOrganizacion([
      { organization_id: AGENCIA, role: "owner", state: "active" },
      { organization_id: PROPIA, role: "owner", state: "active" },
    ]);
    const b = elegirOrganizacion([
      { organization_id: PROPIA, role: "owner", state: "active" },
      { organization_id: AGENCIA, role: "owner", state: "active" },
    ]);
    expect(a).toBe(b);
  });

  it("ignora las archivadas sin depender de que la RLS las esconda", () => {
    expect(
      elegirOrganizacion([
        { organization_id: PROPIA, role: "owner", state: "archived" },
        { organization_id: AGENCIA, role: "member", state: "active" },
      ])
    ).toBe(AGENCIA);
  });

  it("si todas están archivadas, no hay organización activa", () => {
    expect(
      elegirOrganizacion([{ organization_id: PROPIA, role: "owner", state: "archived" }])
    ).toBeNull();
  });

  it("sin membresías devuelve null y no explota", () => {
    expect(elegirOrganizacion([])).toBeNull();
  });

  it("una fila sin `state` cuenta como activa, no como archivada", () => {
    // La columna llegó en la 0013. Tratar su ausencia como «archivada» dejaría
    // sin organización a cualquier lectura que no la pida.
    expect(elegirOrganizacion([{ organization_id: AGENCIA, role: "owner" }])).toBe(AGENCIA);
  });

  it("un rol desconocido pierde contra los conocidos, pero sigue sirviendo", () => {
    expect(
      elegirOrganizacion([
        { organization_id: PROPIA, role: "invitado", state: "active" },
        { organization_id: AGENCIA, role: "member", state: "active" },
      ])
    ).toBe(AGENCIA);

    // Y si es lo único que hay, se usa: quedarse sin organización sería peor que
    // usar una membresía cuyo rol todavía no conocemos.
    expect(
      elegirOrganizacion([{ organization_id: PROPIA, role: "invitado", state: "active" }])
    ).toBe(PROPIA);
  });
});
