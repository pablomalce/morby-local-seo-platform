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
 * DE DÓNDE SALE EL ESTADO DEL TOKEN, Y POR QUÉ SIGUE SIENDO UN PARÁMETRO
 *
 * El acceso es de agencia con acceso delegado: hay UNA fila en
 * `integration_tokens`, la de la organización de Vulkan. Cuál organización es
 * ésa no lo decía nada hasta que se eligió nombrarla por `VULKAN_AGENCY_ORG_ID`
 * — ver `agency.ts`, que es el único lugar donde eso se resuelve.
 *
 * Este archivo sigue recibiendo el estado ya calculado y no lo consulta: leerlo
 * acá metería el cliente admin en un módulo que el bundle del navegador
 * importa. `agency.ts` es puro por esa razón, y `agencyToken.ts` —el que sí
 * toca la base— no lo importa nadie más que la pantalla.
 *
 * TRES DE LOS SIETE ESTADOS SON `error`, Y ESO NO ES PEREZA
 *
 * `unset`, `malformed` y `unreadable` no dicen nada sobre el token: dicen que
 * no se pudo averiguar. El token puede estar perfectamente vivo. Mostrarlos
 * como «sin conectar» mandaría a rehacer un OAuth que ya está hecho, que es el
 * mismo defecto que este archivo existe para impedir, entrando por otra puerta.
 *
 * `absent` sí es «sin conectar», y es el único de los cuatro nuevos que lo es:
 * la agencia está identificada, la consulta salió bien, y no hay token. Ahí el
 * OAuth es exactamente lo que falta.
 */

import type { AgencyTokenState } from "./agency";
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

/** El estado del token de la agencia. Los siete valores viven en `agency.ts`. */
export type { AgencyTokenState };

/** Dónde se arregla lo que la pantalla está mostrando. */
export type IntegrationReason =
  | GoogleSourceReason
  /** El token de la agencia fue revocado. Se rehace el OAuth, una vez. */
  | "platform-token-revoked"
  /** El token de la agencia venció. Se refresca; no hace falta rehacer nada. */
  /** La agencia está identificada y no tiene token. Se hace el OAuth, una vez. */
  | "platform-token-absent"
  /** `VULKAN_AGENCY_ORG_ID` no está puesta. Se pone; no se toca nada de Google. */
  | "agency-organization-unset"
  /** `VULKAN_AGENCY_ORG_ID` está puesta y no es un uuid. Se corrige. */
  | "agency-organization-malformed"
  /** La consulta del estado falló. El token puede estar vivo; se investiga. */
  | "agency-token-unreadable";

/** Lo que la pantalla muestra de una superficie, para UNA organización. */
export interface SurfaceView {
  surface: GoogleSurface;
  /** Las cuatro palabras. `error` es «no se pudo saber», nunca «no configurado». */
  state: "connected" | "not-connected" | "error";
  /**
   * Dónde se arregla. `null` EXACTAMENTE cuando el estado es `connected`, que es
   * el único caso sin nada que arreglar.
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

  // 2. Hay credenciales, y no se pudo averiguar el estado del token. Los tres
  //    casos son `error` y no «sin conectar» por la misma razón: el token puede
  //    estar vivo y lo que falló es nuestra manera de mirarlo. Cada uno lleva
  //    razón propia porque cada uno se arregla en un lugar distinto — la
  //    variable que falta, la variable mal escrita, o la consulta que falló.
  if (tokenState === "unset") {
    return { surface, state: "error", reason: "agency-organization-unset", propertyRef };
  }
  if (tokenState === "malformed") {
    return { surface, state: "error", reason: "agency-organization-malformed", propertyRef };
  }
  if (tokenState === "unreadable") {
    return { surface, state: "error", reason: "agency-token-unreadable", propertyRef };
  }

  // 3. Revocado es «sin conectar» de verdad: la autorización ya no existe y hay
  //    que rehacer el OAuth. Domina sobre vencido, igual que en la `0014`.
  if (tokenState === "revoked") {
    return { surface, state: "not-connected", reason: "platform-token-revoked", propertyRef };
  }

  // 3bis. Y sin token tampoco hay conexión, con el mismo arreglo y otra razón:
  //    «revocado» dice que hubo autorización y se cayó, «ausente» dice que
  //    nunca se hizo. Quien lee la pantalla busca cosas distintas según cuál
  //    sea, y las dos veces termina en el mismo botón.
  if (tokenState === "absent") {
    return { surface, state: "not-connected", reason: "platform-token-absent", propertyRef };
  }

  // 4. `expired` NO tiene caso propio, y ésa es la corrección.
  //
  //    Tenía uno, y su comentario decía lo correcto: «tiene arreglo propio: el
  //    refresh, que no le pide nada a nadie». Pero pintaba las TRES superficies
  //    de naranja con la palabra `EXPIRED`, y eso se lee como que la conexión de
  //    este cliente está rota.
  //
  //    Medido en producción el 2026-09-05, con el estado en `expired`: Search
  //    Console, GA4 y PageSpeed contestaron las tres `ok` en la misma corrida, y
  //    el reporte salió con datos reales. La palabra describía una marca de
  //    tiempo —el access token pasó su vencimiento— y no el estado de la
  //    conexión, que es lo que alguien busca al abrir esta pantalla.
  //
  //    Y no queda sin red: si el refresh de verdad está muerto, la llamada falla
  //    y `integration_probe` lo anota por fuente. Esta misma pantalla dibuja esa
  //    sonda al lado, con `queHacer()` y `haceCuanto()`. O sea que lo que
  //    reemplaza a la palabra es EVIDENCIA MEDIDA en vez de una resta de fechas
  //    — y `readAgencyTokenState` sigue reportando `expired` en la franja de
  //    plataforma, que es donde esa marca de tiempo sí significa algo.
  //
  //    `revoked` y `absent`, arriba, siguen teniendo caso propio: ésos SÍ dicen
  //    que no hay con qué llamar, y no dependen de que alguien mire una sonda.

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
