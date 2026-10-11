/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la regla del servicio compartido se confunda con su fallback.
 *
 * «La agencia sirve a la organización X con su token, sobre las properties
 * mapeadas a X» y «si X no tiene, la agencia le presta lo suyo» se escriben
 * casi igual. La primera es H4.4; la segunda es la fuga entre clientes que la
 * Espina nombra. Un test que sólo pruebe «A mapeada recibe el token de la
 * agencia» queda verde con las dos, y por eso la mitad de este archivo son
 * organizaciones que NO tienen que recibir nada.
 *
 * El resolvedor es un doble que CUENTA: lo que se mide no es sólo qué se
 * devolvió, sino si el token de la agencia se llegó a pedir. Pedirlo para una
 * organización sin mapeo ya es usarlo —lee el secreto con `service_role` y
 * puede refrescarlo contra Google—, aunque después no se consulte nada.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MapeoLeido, servirConLaAgencia } from "../servicioCompartido";
import type { AccessTokenResult } from "../tokenStore";

/** La agencia: tiene el token, y además es una organización con su propio sitio. */
const AGENCIA = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
/** Un cliente mapeado. */
const CLIENTE_A = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00";
/** Un cliente sembrado SIN token propio y SIN mapeo: el caso de la Espina. */
const CLIENTE_B = "0b0b0b0b-1111-4222-8333-444455556666";

const MAPEOS_A: MapeoLeido[] = [
  { organizationId: CLIENTE_A, provider: "search_console", propertyRef: "https://cliente-a.test/" },
  { organizationId: CLIENTE_A, provider: "ga4", propertyRef: "properties/111111111" },
];
const MAPEOS_AGENCIA: MapeoLeido[] = [
  { organizationId: AGENCIA, provider: "search_console", propertyRef: "https://vulkan.test/" },
];

/** El token de la agencia, contado. */
function resolvedor(resultado: AccessTokenResult = { ok: true, accessToken: "ACCESO-de-la-agencia" }) {
  const espia = { pedidos: 0 };
  const fn = async (): Promise<AccessTokenResult> => {
    espia.pedidos += 1;
    return resultado;
  };
  return Object.assign(espia, { fn });
}

afterEach(() => {
  delete process.env.VULKAN_AGENCY_ORG_ID;
});

describe("lo legítimo: la agencia sirve a una organización sobre SUS mapeos", () => {
  it("A mapeada recibe el token de la agencia y sólo sus properties", async () => {
    const token = resolvedor();

    const s = await servirConLaAgencia(CLIENTE_A, MAPEOS_A, { resolver: token.fn });

    expect(s.token).toEqual({ ok: true, accessToken: "ACCESO-de-la-agencia" });
    expect(s.mapeos).toEqual([
      { provider: "search_console", propertyRef: "https://cliente-a.test/" },
      { provider: "ga4", propertyRef: "properties/111111111" },
    ]);
    // Una vez, no una por mapeo: es el mismo token para las tres superficies.
    expect(token.pedidos).toBe(1);
  });

  it("la agencia se sirve a sí misma por SUS mapeos, como cualquier otra", async () => {
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
    const token = resolvedor();

    const s = await servirConLaAgencia(AGENCIA, MAPEOS_AGENCIA, { resolver: token.fn });

    expect(s.mapeos).toEqual([{ provider: "search_console", propertyRef: "https://vulkan.test/" }]);
    expect(token.pedidos).toBe(1);
  });
});

describe("el fallback: nunca se presta el token de la agencia a quien no tiene mapeo", () => {
  it("B sembrada sin token ni mapeo: falla con motivo, y el token NI SE PIDE", async () => {
    const token = resolvedor();

    const s = await servirConLaAgencia(CLIENTE_B, [], { resolver: token.fn });

    expect(s.mapeos).toEqual([]);
    expect(s.token.ok).toBe(false);
    if (!s.token.ok) {
      // El motivo tiene nombre propio. No es `absent` —la agencia SÍ tiene
      // token—, ni `unreadable`: es que esta organización no tiene con qué
      // pedirlo.
      expect(s.token.reason).toBe("not-mapped");
      expect(s.token.detail).toMatch(/no tiene ningún mapeo vivo/);
    }
    expect(token.pedidos).toBe(0);
  });

  it("aunque el token de la agencia esté vivo y la variable puesta, B no lo recibe", async () => {
    // El fallback clásico mira la variable: «si no hay mapeo, la agencia».
    // Con la variable puesta y un token perfecto del otro lado, sigue sin
    // pedirse.
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
    const token = resolvedor();

    const s = await servirConLaAgencia(CLIENTE_B, [], { resolver: token.fn });

    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(token.pedidos).toBe(0);
  });

  it("la agencia SIN mapeo propio tampoco: ser la agencia no es un mapeo", async () => {
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
    const token = resolvedor();

    const s = await servirConLaAgencia(AGENCIA, [], { resolver: token.fn });

    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(token.pedidos).toBe(0);
  });

  it("sin organización —el reporte de demostración— no hay mapeo propio, aunque lleguen filas", async () => {
    const token = resolvedor();

    const s = await servirConLaAgencia(null, [...MAPEOS_A, ...MAPEOS_AGENCIA], { resolver: token.fn });

    expect(s.mapeos).toEqual([]);
    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(token.pedidos).toBe(0);
  });
});

describe("un mapeo que no se pudo leer no es un mapeo que falta", () => {
  it("A, con la lectura caída: `mapping-unreadable`, no `not-mapped`, y el token NI SE PIDE", async () => {
    // Medido en la revisión del #118: los dos lectores convertían un error de
    // la consulta en la lista vacía, y la regla lo anotaba como «no tiene ningún
    // mapeo vivo». A puede estar mapeada: decirle «mapeá» la manda a arreglar lo
    // que está bien. Y prestarle el token «por las dudas» es prestarlo sin
    // ninguna property que sea suya.
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
    const token = resolvedor();

    const s = await servirConLaAgencia(CLIENTE_A, { ilegible: true, detalle: "57014" }, { resolver: token.fn });

    expect(s.mapeos).toEqual([]);
    expect(s.token).toMatchObject({ ok: false, reason: "mapping-unreadable" });
    if (!s.token.ok) expect(s.token.detail).toContain("57014");
    expect(token.pedidos).toBe(0);
  });
});

describe("el mapeo ajeno: lo que la RLS deja ver a quien es miembro de dos organizaciones", () => {
  // Un operador de la agencia que es también miembro de A ve, bajo la RLS, los
  // mapeos de las DOS. Si la consulta pierde su filtro por organización, le
  // llegan los dos juegos. La regla compara la columna y no se lo cree al
  // filtro.
  //
  // Y la variable de la agencia está PUESTA, como en producción. Sin ella, un
  // «la agencia ve todo lo que lee» (`org === VULKAN_AGENCY_ORG_ID ? leidos`)
  // no se activa nunca y estos tests quedan verdes con él adentro. Medido con
  // `mutar.sh` el 2026-10-11: sobrevivía hasta que se puso esta línea.
  beforeEach(() => {
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
  });

  it("el reporte de la AGENCIA no se lleva la property de A", async () => {
    const token = resolvedor();
    const avisos: string[] = [];

    const s = await servirConLaAgencia(AGENCIA, [...MAPEOS_A, ...MAPEOS_AGENCIA], {
      resolver: token.fn,
      log: (m) => avisos.push(m),
    });

    expect(s.mapeos).toEqual([{ provider: "search_console", propertyRef: "https://vulkan.test/" }]);
    expect(s.mapeos.map((m) => m.propertyRef)).not.toContain("properties/111111111");
    // Y se anota: una fila ajena sólo llega si el lector perdió su filtro, que
    // es un defecto que alguien tiene que ir a buscar.
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/2 mapeo\(s\) de otra organización descartado/);
  });

  it("B sin mapeo, con los de A y la agencia a la vista: nada, y el token no se pide", async () => {
    const token = resolvedor();

    const s = await servirConLaAgencia(CLIENTE_B, [...MAPEOS_A, ...MAPEOS_AGENCIA], {
      resolver: token.fn,
      log: () => {},
    });

    expect(s.mapeos).toEqual([]);
    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(token.pedidos).toBe(0);
  });

  it("sin filas ajenas no hay aviso: el log habla sólo cuando hay algo raro", async () => {
    const avisos: string[] = [];

    await servirConLaAgencia(CLIENTE_A, MAPEOS_A, { resolver: resolvedor().fn, log: (m) => avisos.push(m) });

    expect(avisos).toEqual([]);
  });
});

describe("un token que no se pudo resolver viaja con su motivo", () => {
  it("A mapeada con el token de la agencia revocado: el motivo de la agencia, no `not-mapped`", async () => {
    const token = resolvedor({ ok: false, reason: "revoked", detail: "la autorización fue revocada" });

    const s = await servirConLaAgencia(CLIENTE_A, MAPEOS_A, { resolver: token.fn });

    // A sí tiene con qué pedirlo; lo que falta es del lado de la agencia. Decir
    // «sin mapeo» mandaría a mapear a quien ya está mapeado.
    expect(s.token).toMatchObject({ ok: false, reason: "revoked" });
    expect(s.mapeos).toHaveLength(2);
    expect(token.pedidos).toBe(1);
  });
});
