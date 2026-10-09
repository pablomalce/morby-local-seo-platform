import type { ConsultaDePunto, ResultadoDePunto } from "@/lib/integrations/google/places";
import { TOPE_DE_PUNTOS, type Observacion, type PuntoDeGrilla } from "./grilla";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que una corrida de la grilla salga a la red de otra forma que UNA consulta por
 * punto, con la coordenada de ESE punto, de a pocas por vez, y que lo que vuelva
 * se anote con otro resultado que el que la consulta dio.
 *
 *   * UNA CONSULTA POR PUNTO, CON SU COORDENADA. El modo de fallo de la puerta
 *     H2-GO-3 es «posiciones de un único llamado sin coordenada»: si la corrida
 *     consultara una vez y copiara el resultado a las nueve celdas, el mapa
 *     sería plano y desplazar el centro no lo movería. Acá cada punto lleva su
 *     `lat`/`lng` a `consultar`, y el test lo mide con un doble de Google que
 *     ordena por distancia al centro del sesgo;
 *   * DE A POCAS POR VEZ. `concurrencia` (3 por defecto) acota cuántas
 *     consultas hay en vuelo. Nueve de golpe es la forma más rápida de
 *     comerse un 429 de cuota —y un 429 es un `failed`, que achica el
 *     denominador útil— y de a una no entra en el `maxDuration` de 60 s con un
 *     timeout de 8 s por punto (9 × 8 = 72);
 *   * EL TOPE, OTRA VEZ. `TOPE_DE_PUNTOS` lo hace cumplir `planificarGrilla`;
 *     esto se niega igual si le llegan más puntos, ANTES de consultar el
 *     primero. Es la última línea antes del gasto;
 *   * LO QUE VOLVIÓ, TAL CUAL. `failed` sigue siendo `failed` con su código; si
 *     `consultar` tirara —`posicionEnPunto` no tira, pero un transporte nuevo
 *     podría— el punto es `failed` con `network`, nunca `absent`.
 *
 * LA HORA de cada observación es la de SU respuesta, no la de la corrida: la
 * puerta pide hora por observación, y dos puntos de la misma corrida no se
 * midieron en el mismo instante.
 */

export interface EncargoDeCorrida {
  keyword: string;
  targetPlaceId: string;
  radiusM: number;
  puntos: readonly PuntoDeGrilla[];
}

export interface DependenciasDeCorrida {
  /** En producción, `posicionEnPunto` de `google/places.ts`. */
  consultar: (consulta: ConsultaDePunto) => Promise<ResultadoDePunto>;
  /** Cuántas consultas en vuelo como máximo. */
  concurrencia?: number;
  reloj?: () => Date;
}

export const CONCURRENCIA_POR_DEFECTO = 3;

export type ResultadoDeCorrida =
  | { ok: true; observaciones: Observacion[] }
  | { ok: false; motivo: "tope-de-puntos"; pedidos: number; tope: number };

export async function correrGrilla(encargo: EncargoDeCorrida, deps: DependenciasDeCorrida): Promise<ResultadoDeCorrida> {
  const { puntos } = encargo;
  if (puntos.length > TOPE_DE_PUNTOS) {
    return { ok: false, motivo: "tope-de-puntos", pedidos: puntos.length, tope: TOPE_DE_PUNTOS };
  }

  const reloj = deps.reloj ?? (() => new Date());
  const concurrencia = Math.max(1, Math.floor(deps.concurrencia ?? CONCURRENCIA_POR_DEFECTO));
  const observaciones: Observacion[] = new Array(puntos.length);
  let siguiente = 0;

  const trabajador = async () => {
    while (siguiente < puntos.length) {
      const indice = siguiente++;
      const punto = puntos[indice];
      let resultado: ResultadoDePunto;
      try {
        resultado = await deps.consultar({
          keyword: encargo.keyword,
          targetPlaceId: encargo.targetPlaceId,
          lat: punto.lat,
          lng: punto.lng,
          radiusM: encargo.radiusM,
        });
      } catch {
        resultado = { outcome: "failed", errorCode: "network" };
      }
      observaciones[indice] = {
        fila: punto.fila,
        columna: punto.columna,
        lat: punto.lat,
        lng: punto.lng,
        observadaEn: reloj().toISOString(),
        resultado: resultado.outcome,
        posicion: resultado.outcome === "position" ? resultado.position : null,
        codigoDeError: resultado.outcome === "failed" ? resultado.errorCode : null,
      };
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrencia, puntos.length) }, trabajador));
  return { ok: true, observaciones };
}
