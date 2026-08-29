/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla de integraciones mande a un operador a configurar un cliente
 * que ya está bien.
 *
 * El reporte tiene cuatro palabras —`live`, `demo`, `missing`, `error`— y por
 * debajo hay más de cuatro situaciones. `sources.ts` ya separó las dos que más
 * duelen: «la plataforma no está conectada» se arregla UNA vez, en Google Cloud,
 * y «este cliente no está mapeado» se arregla POR CLIENTE, en esta pantalla.
 * Mostrar las dos como «sin conectar» es el mismo defecto que arregló el #46,
 * sólo que en la pantalla donde alguien va a actuar en consecuencia.
 *
 * Este archivo es la vista, no una segunda fuente de verdad: las dos razones las
 * sigue decidiendo `resolveGoogleSource()`, y acá se le agregan las que el
 * reporte no mira porque no son por cliente — el estado del token de la agencia.
 *
 * LA CAUSA DE MÁS ARRIBA GANA, Y EL MAPEO SE MUESTRA IGUAL
 *
 * Un token vencido y un cliente sin mapear pueden ser ciertos a la vez, y se
 * arreglan en lugares distintos. El estado nombra el problema de más arriba, por
 * el mismo argumento que `resolveGoogleSource()` hace con las credenciales de
 * plataforma: mandar a mapear a alguien cuyo token está muerto es mandarlo a
 * hacer un trabajo que no va a servir.
 *
 * Pero `propertyRef` viaja SIEMPRE, esté el estado como esté. Si no, la pantalla
 * que existe para editar el mapeo escondería el mapeo justo cuando algo más
 * anda mal, que es cuando hace falta mirarlo.
 *
 * POR QUÉ EXISTE `agency-organization-undecided`
 *
 * Porque el acceso es de agencia con acceso delegado: hay UNA fila en
 * `integration_tokens`, la de la organización de Vulkan, y hoy ninguna columna
 * dice cuál organización es ésa. Buscar el token de la organización del cliente
 * aplicaría el modelo viejo y daría «sin token» para todos, para siempre — la
 * respuesta correcta por el motivo equivocado, que es lo que el #55 dejó de
 * hacer.
 *
 * Así que el estado del token entra como PARÁMETRO y `"undecided"` es un valor
 * legítimo. La pantalla lo pasa hoy porque la decisión es de producto y no de
 * código; el día que exista, cambia un solo lugar. Que ese valor desaparezca es
 * la señal de que la decisión se tomó.
 */

import {
  type GoogleSourceReason,
  type GoogleSurface,
  type PropertyMapping,
  resolveGoogleSource,
} from "./sources";

/** Las tres superficies, en el orden en que la pantalla las muestra. */
export const GOOGLE_SURFACES: readonly GoogleSurface[] = [
  "search_console",
  "ga4",
  "google_business_profile",
];

/**
 * El estado del token de la agencia.
 *
 * Los tres primeros son los que devuelve `public.integration_token_state()`. El
 * cuarto no es un estado del token: es que todavía no se sabe A QUIÉN
 * preguntarle. Ver el encabezado.
 */
export type AgencyTokenState = "active" | "expired" | "revoked" | "undecided";

/** Dónde se arregla lo que la pantalla está mostrando. */
export type IntegrationReason =
  | GoogleSourceReason
  /** El token de la agencia fue revocado. Se rehace el OAuth, una vez. */
  | "platform-token-revoked"
  /** El token de la agencia venció. Se refresca; no hace falta rehacer nada. */
  | "platform-token-expired"
  /** Ninguna columna dice cuál organización es la agencia. Decisión de producto. */
  | "agency-organization-undecided";

/** Lo que la pantalla muestra de una superficie, para UNA organización. */
export interface SurfaceView {
  surface: GoogleSurface;
  /** Las cuatro palabras. `error` es «no se pudo saber», nunca «no configurado». */
  state: "connected" | "not-connected" | "expired" | "error";
  /**
   * Dónde se arregla. `null` EXACTAMENTE cuando el estado es `connected`, que es
   * el único caso sin nada que arreglar — `expired` lleva razón igual, porque
   * «vencido» a secas se lee como que venció la conexión de ESTE cliente, y lo
   * que venció es el token de la plataforma, que es de todos.
   */
  reason: IntegrationReason | null;
  /** El mapeo vivo de este cliente, o `null`. Independiente del estado. */
  propertyRef: string | null;
}

/**
 * De las precondiciones al estado que la pantalla muestra, para una superficie.
 *
 * `mappings` son los mapeos VIVOS de la organización, ya leídos: la `0017`
 * garantiza uno por organización y proveedor, así que la lista trae tres filas
 * como mucho y se pide una sola vez para las tres superficies.
 */
export function viewForSurface(
  surface: GoogleSurface,
  mappings: readonly PropertyMapping[],
  tokenState: AgencyTokenState,
  env: NodeJS.ProcessEnv = process.env
): SurfaceView {
  const resolution = resolveGoogleSource(surface, mappings, env);
  const propertyRef = resolution.ready
    ? resolution.propertyRef
    : (mappings.find((m) => m.provider === surface)?.propertyRef ?? null);

  // 1. Sin credenciales de plataforma no hay petición para NADIE, y el estado
  //    del token no se puede ni consultar. Es la causa de más arriba de todas y
  //    la decide `sources.ts`, no este archivo.
  if (!resolution.ready && resolution.reason === "platform-not-connected") {
    return { surface, state: "not-connected", reason: "platform-not-connected", propertyRef };
  }

  // 2. Hay credenciales, y no se sabe de quién es el token. No es «sin
  //    conectar»: puede estar conectado y no tenemos cómo mirarlo.
  if (tokenState === "undecided") {
    return { surface, state: "error", reason: "agency-organization-undecided", propertyRef };
  }

  // 3. Revocado es «sin conectar» de verdad: la autorización ya no existe y hay
  //    que rehacer el OAuth. Domina sobre vencido, igual que en la `0014`.
  if (tokenState === "revoked") {
    return { surface, state: "not-connected", reason: "platform-token-revoked", propertyRef };
  }

  // 4. Vencido tiene palabra propia porque tiene arreglo propio: el refresh, que
  //    no le pide nada a nadie. Decir «sin conectar» acá manda a rehacer un
  //    OAuth que no hace falta.
  if (tokenState === "expired") {
    return { surface, state: "expired", reason: "platform-token-expired", propertyRef };
  }

  // 5. La plataforma está entera y este cliente no tiene property. Es lo único
  //    de esta lista que se arregla en esta pantalla.
  if (!resolution.ready) {
    return { surface, state: "not-connected", reason: resolution.reason, propertyRef };
  }

  return { surface, state: "connected", reason: null, propertyRef: resolution.propertyRef };
}

/** Las tres superficies de una organización, en el orden de la pantalla. */
export function viewForOrganization(
  mappings: readonly PropertyMapping[],
  tokenState: AgencyTokenState,
  env: NodeJS.ProcessEnv = process.env
): SurfaceView[] {
  return GOOGLE_SURFACES.map((s) => viewForSurface(s, mappings, tokenState, env));
}
