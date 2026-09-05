/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la marca deje de distinguir lo sembrado de lo real sin que nada se ponga
 * en rojo.
 *
 * No importa `seedBusinesses` para después preguntarle si un id está en
 * `seedBusinesses`: eso mediría que el módulo es igual a sí mismo. Ancla contra
 * `biz-morby`, que es el negocio sembrado que se ve en la pantalla —y el que
 * apareció el 2026-09-04 haciéndose pasar por el del usuario—, y contra la forma
 * de los ids reales, que son uuid.
 */
import { describe, expect, it } from "vitest";
import { marcaDeDatos } from "../marcaDeDatos";
import { businesses as sembrados } from "@/lib/mock/universal";

/** El negocio de la demostración, escrito a mano y no leído de la lista. */
const MORBY = "biz-morby";

/** Un negocio de la base: uuid, como el que devuelve Supabase. */
const REAL = "7d703707-4f9d-43bf-9305-6bc22eddf45f";

describe("la marca la pone el dato", () => {
  it("dice `sembrado` sobre el negocio de la demostración", () => {
    expect(marcaDeDatos(MORBY)).toBe("sembrado");
  });

  it("dice `real` sobre un negocio con uuid, que es lo que trae la base", () => {
    expect(marcaDeDatos(REAL)).toBe("real");
  });

  it("dice `sin-negocio` cuando no hay selección", () => {
    // El marcador de posición tiene `id === ""` y NO está en la lista de
    // sembrados, así que sin este caso `isUserCreated("")` contestaría `true` y
    // la pantalla vacía se anunciaría como datos reales.
    expect(marcaDeDatos("")).toBe("sin-negocio");
  });

  it("no deja ningún negocio sembrado sin marcar, ni siquiera uno que se agregue después", () => {
    // La afirmación de arriba mira uno. Ésta mira la lista entera, así que
    // sembrar un cuarto negocio no crea un agujero silencioso.
    for (const b of sembrados) {
      expect(marcaDeDatos(b.id), `el sembrado ${b.id} quedó sin marcar`).toBe("sembrado");
    }
    expect(sembrados.length).toBeGreaterThan(0);
  });
});
