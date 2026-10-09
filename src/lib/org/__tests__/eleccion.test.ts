/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la elección explícita de organización se ignore, o que pise al orden
 * cuando ya no vale.
 *
 * El orden determinista sigue siendo el default y su test vive en
 * `elegirOrganizacion.test.ts`. Acá se prueba lo que se agregó: que una persona
 * pueda decidir, y que una decisión vieja no decida por ella.
 */
import { describe, expect, it } from "vitest";
import { elegirOrganizacion, type MembresiaElegible } from "../eleccion";

const AGENCIA = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
/** Un uuid MÁS CHICO que el de la agencia: gana el desempate sin elección. */
const CLIENTE = "2c655774-c624-49cb-ba61-87c582f56881";

const DOS: MembresiaElegible[] = [
  { organization_id: AGENCIA, role: "owner", state: "active" },
  { organization_id: CLIENTE, role: "owner", state: "active" },
];

describe("la elección explícita", () => {
  it("sin elección gana el orden determinista, que es el uuid más chico a igual rol", () => {
    // Es el estado del que venimos, y sigue siendo el default correcto.
    expect(elegirOrganizacion(DOS)).toBe(CLIENTE);
  });

  it("con elección gana la elegida, aunque el orden diría otra", () => {
    // Sin esto, tener dos clientes significa quedarse siempre en el mismo.
    expect(elegirOrganizacion(DOS, AGENCIA)).toBe(AGENCIA);
  });

  it("una elección que ya no es membresía ACTIVA se ignora, y NO rompe", () => {
    // Archivar una membresía no puede dejar a alguien sin pantalla: se cae al
    // orden, que es lo que había antes de elegir.
    const conArchivada: MembresiaElegible[] = [
      { organization_id: AGENCIA, role: "owner", state: "active" },
      { organization_id: CLIENTE, role: "owner", state: "archived" },
    ];
    expect(elegirOrganizacion(conArchivada, CLIENTE)).toBe(AGENCIA);
  });

  it("una elección inventada se ignora", () => {
    // La cookie es una preferencia, no un permiso. Quien decide qué filas se ven
    // es la RLS: una elección inventada termina en una organización vacía, y acá
    // ni siquiera llega a elegirse.
    expect(elegirOrganizacion(DOS, "00000000-0000-4000-8000-000000000000")).toBe(CLIENTE);
  });

  it("sin ninguna membresía activa no elige nada, con o sin elección", () => {
    const ninguna: MembresiaElegible[] = [
      { organization_id: AGENCIA, role: "owner", state: "archived" },
    ];
    expect(elegirOrganizacion(ninguna)).toBeNull();
    expect(elegirOrganizacion(ninguna, AGENCIA)).toBeNull();
  });
});

describe("un client cae en la organización del cliente, no en su personal (H4.1)", () => {
  // Toda cuenta es owner de una organización personal (handle_new_user, 0001).
  // Con `owner` primero, la activa por defecto de un client era esa, vacía.
  const X = "c4100000-0031-4031-8031-200000000001";
  // La personal con el uuid MÁS CHICO, para que el desempate no la tape.
  const P = "00000000-0000-4000-8000-000000000001";
  const clara: MembresiaElegible[] = [
    { organization_id: P, role: "owner", state: "active" },
    { organization_id: X, role: "client", state: "active" },
  ];

  it("sin elección, la de client gana a la personal de owner", () => {
    expect(elegirOrganizacion(clara, null)).toBe(X);
  });

  it("si la membresía client está archivada, cae en la personal", () => {
    expect(
      elegirOrganizacion([clara[0], { ...clara[1], state: "archived" }], null)
    ).toBe(P);
  });

  it("y la elección explícita sigue ganando", () => {
    expect(elegirOrganizacion(clara, P)).toBe(P);
  });
});
