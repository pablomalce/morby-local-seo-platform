/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que una petición que FALLÓ termine contada como una integración sin conectar.
 *
 * `DataSourceStatus` distingue cuatro estados y dos de ellos se parecen lo
 * suficiente como para confundirse en el código que traduce una respuesta HTTP:
 *
 *   missing  falta configurar la integración  -> acción: conectarla
 *   error    la petición FALLÓ                -> acción: reintentar / investigar
 *
 * El caso que se equivoca solo es el **401**. Es tentador leerlo como "todavía
 * no está conectado" —el servidor dice que no hay autorización— y es lo
 * contrario: hay credenciales, se mandaron, y Google las rechazó. Un token
 * vencido, revocado o de otro proyecto da 401, y el cliente que ve "conectá la
 * integración" va a mirar una pantalla donde ya está conectada. Lo mismo el 403,
 * que además suele ser el permiso de la propiedad y no del token.
 *
 * `missing` es UN solo caso: no hay credenciales que mandar, así que no hubo
 * petición. Todo lo demás que no sea una respuesta buena es `error`.
 *
 * Este archivo va antes que los clientes HTTP de Search Console y GA4 a
 * propósito: el contrato se fija primero y el cliente lo cumple, no al revés.
 * `pagespeed.ts` ya se comporta así, pero con la regla repartida entre el
 * cliente y el orquestador; los que vienen la toman de acá.
 */

import type { DataSourceStatus } from "@/lib/reports/types";

/** Cómo terminó un intento contra una API de Google. */
export type FetchOutcome =
  /** Respondió, y el cuerpo trae lo que se pidió. */
  | { kind: "ok" }
  /** No hay credenciales configuradas: NO se hizo ninguna petición. */
  | { kind: "no-credentials" }
  /** Respondió con un código que no es 2xx. */
  | { kind: "http"; status: number }
  /** Se agotó el presupuesto de tiempo y se abortó. */
  | { kind: "timeout" }
  /** No llegó a haber respuesta: DNS, TLS, conexión cortada. */
  | { kind: "network" }
  /** Respondió 2xx, pero el cuerpo no tiene los campos que el reporte usa. */
  | { kind: "malformed" };

/**
 * La única traducción de un intento a lo que el reporte muestra.
 *
 * Se escribe con un `switch` exhaustivo y sin `default` para que agregar un
 * `FetchOutcome` nuevo sea un error de tipos y no una caída silenciosa a
 * `missing`, que es exactamente el bug que este archivo existe para impedir.
 */
export function statusForOutcome(outcome: FetchOutcome): DataSourceStatus {
  switch (outcome.kind) {
    case "ok":
      return "live";
    case "no-credentials":
      return "missing";
    case "http":
    case "timeout":
    case "network":
    case "malformed":
      return "error";
  }
}
