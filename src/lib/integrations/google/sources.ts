/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el reporte diga «sin conectar» por costumbre.
 *
 * `searchConsole`, `gbp` y `ga4` estaban escritos como la palabra `"missing"`
 * dentro de `orchestrator.ts`. Eso es la respuesta correcta hoy y por el motivo
 * equivocado: era correcta porque nadie había conectado nada, no porque alguien
 * lo hubiera mirado. El día que se conecte algo, la palabra sigue ahí y el
 * reporte sigue diciendo lo mismo — que es la misma clase de defecto que arregló
 * el #46 en el otro sentido, un fallo contado como «sin conectar».
 *
 * Este archivo saca esa palabra del orquestador y la deriva de dos cosas que se
 * pueden mirar: si la PLATAFORMA está conectada, y si ESTE cliente está mapeado.
 *
 * LAS DOS COSAS SE ARREGLAN EN LUGARES DISTINTOS, Y POR ESO SE DISTINGUEN
 *
 * `platform-not-connected` es que Growth OS no tiene credenciales de Google: no
 * hay `GOOGLE_CLIENT_ID` ni `GOOGLE_CLIENT_SECRET`, así que no hay ninguna
 * petición que hacer para NINGÚN cliente. Lo arregla quien opera la plataforma,
 * una vez, en la consola de Google Cloud.
 *
 * `client-not-mapped` es que la plataforma está conectada y a este cliente no le
 * asignaron su property. Lo arregla quien hace el onboarding, por cliente, desde
 * la pantalla de integraciones.
 *
 * Las dos se muestran hoy como `missing` porque el vocabulario del reporte tiene
 * cuatro estados y no cinco. Lo que NO puede pasar es que se confundan río
 * arriba: `reason` viaja aparte justamente para que la pantalla pueda decir «la
 * plataforma no está conectada» en vez de mandar a un operador a configurar un
 * cliente que ya está bien.
 *
 * POR QUÉ EL TOKEN NO SE CONSULTA ACÁ TODAVÍA, Y ES UNA DECISIÓN QUE FALTA
 *
 * La 0014 guardó el token POR ORGANIZACIÓN, dando por supuesto que cada cliente
 * conecta su cuenta. La decisión del 2026-08-29 dice lo contrario: el acceso es
 * de agencia con acceso delegado, hay UN token —el de la cuenta de Vulkan— y hay
 * una sola fila, la de la organización de Vulkan.
 *
 * O sea que para buscar «el token» hace falta saber CUÁL organización es la
 * agencia, y hoy ninguna columna lo dice. Buscar el token de la organización del
 * reporte sería aplicar el modelo viejo: en el modelo de agencia esa fila no
 * existe para ningún cliente, y todos darían «sin token» para siempre — que es
 * la respuesta correcta por el motivo equivocado otra vez, y por eso no se
 * escribe.
 *
 * La precondición de credenciales de plataforma que este archivo SÍ mide es la
 * mitad honesta de la misma pregunta —sin `GOOGLE_CLIENT_ID` no hay token de
 * nadie— y el resto entra cuando exista la respuesta. `ready` es el punto exacto
 * donde entra.
 */

import type { DataSourceStatus } from "@/lib/reports/types";

/** Las tres superficies de Google que el reporte pide por mapeo. */
export type GoogleSurface = "ga4" | "search_console" | "google_business_profile";

/**
 * Por qué una fuente no se pudo consultar. Va aparte del `DataSourceStatus`
 * porque dos razones que se arreglan en lugares distintos comparten estado.
 */
export type GoogleSourceReason =
  /** Growth OS no tiene credenciales de Google. No hay petición para nadie. */
  | "platform-not-connected"
  /** La plataforma está conectada; a este cliente no le asignaron su property. */
  | "client-not-mapped";

export type GoogleSourceResolution =
  /** Se decidió sin preguntarle a Google, y `reason` dice dónde se arregla. */
  | { ready: false; status: DataSourceStatus; reason: GoogleSourceReason }
  /**
   * Las precondiciones se cumplen: hay credenciales y este cliente tiene una
   * property viva. `propertyRef` es lo que el cliente HTTP le pide a Google, en
   * la forma canónica en que la 0017 lo obliga a estar guardado.
   */
  | { ready: true; propertyRef: string };

/** El mapeo vivo de una organización, tal como sale de `integration_properties`. */
export interface PropertyMapping {
  provider: GoogleSurface;
  propertyRef: string;
}

/**
 * Si Growth OS tiene credenciales de Google.
 *
 * Las dos, y con `&&` y no `||`: un cliente sin secreto no completa ningún
 * intercambio OAuth, así que media credencial es tan inservible como ninguna y
 * decir «conectado» con media es peor que decir «sin conectar» — manda a
 * investigar un fallo a quien tenía que terminar una configuración.
 */
export function platformIsConnected(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * Qué puede decir el reporte de una superficie, para una organización.
 *
 * `mappings` son los mapeos VIVOS de esa organización. Se pasan ya leídos en vez
 * de leerlos acá adentro porque el orquestador los pide una sola vez para las
 * tres superficies: tres consultas donde alcanza una es tres veces el costo por
 * reporte, y la 0017 garantiza un solo mapeo vivo por organización y proveedor,
 * así que la lista es corta por construcción.
 */
export function resolveGoogleSource(
  surface: GoogleSurface,
  mappings: readonly PropertyMapping[],
  env: NodeJS.ProcessEnv = process.env
): GoogleSourceResolution {
  // El orden importa y no es arbitrario. Sin credenciales de plataforma, el
  // mapeo de este cliente puede estar perfecto y seguir sin haber nada que
  // consultar; informar «este cliente no está configurado» mandaría a alguien a
  // arreglar lo que ya está bien. La causa de más arriba gana.
  if (!platformIsConnected(env)) {
    return { ready: false, status: "missing", reason: "platform-not-connected" };
  }

  const mapping = mappings.find((m) => m.provider === surface);
  if (!mapping) {
    return { ready: false, status: "missing", reason: "client-not-mapped" };
  }

  return { ready: true, propertyRef: mapping.propertyRef };
}
