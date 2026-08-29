/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que «sin conectar» vuelva a ser una palabra escrita a mano.
 *
 * Las tres fuentes de Google estaban clavadas en `"missing"` dentro del
 * orquestador. La respuesta era correcta y el motivo no: era correcta porque
 * nadie había conectado nada, no porque alguien lo hubiera mirado. Un literal no
 * cambia el día que cambia el mundo, así que el error que produce no es «dice
 * algo falso hoy» sino «va a decir algo falso mañana y nadie va a estar mirando».
 *
 * LO QUE MÁS PESA ACÁ, Y NO ES EL ESTADO
 *
 * Es la RAZÓN. «La plataforma no está conectada» y «este cliente no está
 * configurado» comparten estado —los dos son `missing`, porque el vocabulario
 * del reporte tiene cuatro palabras y no cinco— y se arreglan en lugares
 * distintos: uno en la consola de Google Cloud, una sola vez, por quien opera la
 * plataforma; el otro en la pantalla de integraciones, por cliente, por quien
 * hace el onboarding.
 *
 * Confundirlos manda a un operador a configurar un cliente que ya está bien. Es
 * el mismo defecto del #46 con otra ropa: dos situaciones que piden acciones
 * opuestas contadas con la misma palabra.
 */
import { describe, expect, it } from "vitest";

import {
  type PropertyMapping,
  platformIsConnected,
  resolveGoogleSource,
} from "@/lib/integrations/google/sources";

/** Una plataforma conectada. Los valores no son de nadie: sólo tienen que estar. */
const CONECTADA = {
  GOOGLE_CLIENT_ID: "no-es-un-client-id-real.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "no-es-un-secreto-real",
} as unknown as NodeJS.ProcessEnv;

const SIN_CREDENCIALES = {} as unknown as NodeJS.ProcessEnv;

/** El mapeo de un cliente con sus tres superficies, en la forma que exige la 0017. */
const MAPEO_COMPLETO: PropertyMapping[] = [
  { provider: "ga4", propertyRef: "properties/123456789" },
  { provider: "search_console", propertyRef: "https://ejemplo.test/" },
  { provider: "google_business_profile", propertyRef: "locations/123456789" },
];

describe("platformIsConnected", () => {
  it("pide las dos credenciales, no una", () => {
    expect(platformIsConnected(CONECTADA)).toBe(true);
    expect(platformIsConnected(SIN_CREDENCIALES)).toBe(false);
  });

  it("con media credencial dice que NO", () => {
    // Y no es prolijidad. Un client id sin secreto no completa ningún
    // intercambio OAuth, así que decir «conectado» con media manda a investigar
    // un fallo a quien tenía que terminar una configuración.
    expect(
      platformIsConnected({ GOOGLE_CLIENT_ID: "algo" } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      platformIsConnected({ GOOGLE_CLIENT_SECRET: "algo" } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("una cadena vacía no es una credencial", () => {
    // El caso que llega solo: una variable declarada en el entorno de despliegue
    // y sin valor. `process.env` la entrega como "" y no como ausente.
    expect(
      platformIsConnected({
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "no-es-un-secreto-real",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
  });
});

describe("resolveGoogleSource", () => {
  it("sin credenciales de plataforma, la razón es la plataforma", () => {
    const r = resolveGoogleSource("ga4", MAPEO_COMPLETO, SIN_CREDENCIALES);

    expect(r).toEqual({
      ready: false,
      status: "missing",
      reason: "platform-not-connected",
    });
  });

  it("la falta de plataforma gana sobre la falta de mapeo, y ese orden importa", () => {
    // Con las dos causas presentes hay que informar la de arriba. Un mapeo
    // perfecto no produce ninguna petición si Growth OS no tiene credenciales,
    // así que decir «este cliente no está configurado» manda a alguien a
    // arreglar lo que ya está bien mientras la causa real sigue intacta.
    const r = resolveGoogleSource("ga4", [], SIN_CREDENCIALES);

    expect(r).toEqual({
      ready: false,
      status: "missing",
      reason: "platform-not-connected",
    });
  });

  it("con plataforma y sin mapeo, la razón es el cliente", () => {
    const r = resolveGoogleSource("ga4", [], CONECTADA);

    expect(r).toEqual({ ready: false, status: "missing", reason: "client-not-mapped" });
  });

  it("no confunde una superficie con otra del mismo cliente", () => {
    // El caso normal a mitad de un onboarding: GA4 ya mapeado y Search Console
    // todavía no. Un `mappings.length > 0` en vez de buscar el proveedor daría
    // las tres por listas y el reporte pediría datos de Search Console con el
    // identificador de GA4.
    const soloGa4: PropertyMapping[] = [
      { provider: "ga4", propertyRef: "properties/123456789" },
    ];

    expect(resolveGoogleSource("ga4", soloGa4, CONECTADA)).toEqual({
      ready: true,
      propertyRef: "properties/123456789",
    });
    expect(resolveGoogleSource("search_console", soloGa4, CONECTADA)).toEqual({
      ready: false,
      status: "missing",
      reason: "client-not-mapped",
    });
  });

  it("devuelve la referencia de la superficie que se pidió, no la primera", () => {
    // Las tres formas son distintas y ninguna sirve en el lugar de otra:
    // `properties/N` es lo que espera GA4, `locations/N` lo que espera GBP, y
    // una URL con barra final lo que espera Search Console. Mandar la que no es
    // no da un error de permisos: da los datos de otra cosa, o ninguno.
    expect(resolveGoogleSource("search_console", MAPEO_COMPLETO, CONECTADA)).toEqual({
      ready: true,
      propertyRef: "https://ejemplo.test/",
    });
    expect(resolveGoogleSource("google_business_profile", MAPEO_COMPLETO, CONECTADA)).toEqual({
      ready: true,
      propertyRef: "locations/123456789",
    });
  });

  it("no importa el orden en que vengan los mapeos", () => {
    const alReves = [...MAPEO_COMPLETO].reverse();

    expect(resolveGoogleSource("ga4", alReves, CONECTADA)).toEqual({
      ready: true,
      propertyRef: "properties/123456789",
    });
  });
});
