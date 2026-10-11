/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que «hay un token» y «puedo llamar a Google» se confundan.
 *
 * Entre las dos cosas hay cuatro maneras de fallar que piden acciones distintas
 * —no hay conexión, la revocaron, el access token venció, o el secreto guardado
 * no se puede leer— y una sola de ellas se arregla reintentando. Este archivo es
 * el único lugar donde esa diferencia se decide, y lo que devuelve es un access
 * token usable o el motivo por el que no lo hay.
 *
 * SERVER-ONLY. Toca la custodia de la 0021, que sólo alcanza `service_role`.
 *
 * EL NÚCLEO ESTÁ SEPARADO DE LOS CLIENTES A PROPÓSITO
 *
 * `resolveAccessToken()` recibe sus dependencias y no importa nada de Supabase ni
 * de `fetch`. Es lo que permite medir por mutación las ramas de arriba sin una
 * base ni una red, que es donde vive el defecto: el camino feliz lo prueba
 * cualquiera, y son las ramas de error las que se escriben una vez y no se
 * vuelven a mirar.
 *
 * POR QUÉ EL REFRESCO ESCRIBE, Y POR QUÉ NO USA `store`
 *
 * Un access token nuevo es la MISMA autorización, así que va por
 * `refresh_integration_token`, que reemplaza el secreto en su lugar. Usar
 * `store_integration_token` acá revocaría la fila viva y crearía otra cada hora:
 * el historial de revocaciones de la 0014 —que existe para poder contestar quién
 * tuvo acceso y hasta cuándo— pasaría a ser un historial de refrescos.
 *
 * Y si esa escritura falla, lo que se devuelve igual es el access token: ya se
 * obtuvo y ya sirve, y la respuesta correcta a «no pude guardarlo» es usarlo esta
 * vez y volver a pedir uno la próxima. Fallar acá dejaría al reporte sin datos
 * por un problema que no le impide tenerlos.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  type AgencyOrgResolution,
  type AgencyTokenState,
  resolveAgencyOrgId,
} from "./agency";
import { agencyTokenState } from "./agencyToken";
import {
  type ConfigResolution,
  type ExchangeResult,
  type Fetcher,
  type GoogleOAuthConfig,
  type StoredToken,
  parseStoredToken,
  refreshAccessToken,
  resolveOAuthConfig,
  serializeToken,
} from "./oauth";

/** El proveedor, escrito acá porque el CHECK de la `0014` sólo admite éste. */
const PROVIDER = "google";

/** Por qué no hay un access token con el que llamar a Google. */
export type TokenUnavailable =
  /** Falta `VULKAN_AGENCY_ORG_ID`, o no es un uuid. Se arregla en el entorno. */
  | "agency-unresolved"
  /** Faltan las credenciales de plataforma. Se arregla en el entorno. */
  | "platform-not-configured"
  /** La agencia está identificada y no hay token. Se hace el OAuth. */
  | "absent"
  /** La autorización ya no existe. Se rehace el OAuth. */
  | "revoked"
  /** Google rechazó el refresco. Casi siempre es una revocación del otro lado. */
  | "refresh-rejected"
  /** No se pudo averiguar. El token puede estar vivo; esto NO manda a reconectar. */
  | "unreadable";

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: TokenUnavailable; detail: string };

/** Lo que este archivo necesita de afuera, para poder probarlo sin base ni red. */
export interface TokenDeps {
  /** El estado del token de la agencia, tal como lo lee la pantalla. */
  readState: () => Promise<AgencyTokenState>;
  /** El secreto en claro de la conexión viva, o `null` si no se pudo. */
  readSecret: (organizationId: string) => Promise<string | null>;
  /** Guarda el secreto nuevo sobre la conexión viva. `false` = ya no hay ninguna. */
  writeRefreshed: (
    organizationId: string,
    secret: string,
    expiresAt: Date
  ) => Promise<boolean>;
  /** Pide un access token nuevo a Google. */
  refresh: (
    config: GoogleOAuthConfig,
    refreshToken: string,
    ahora: Date
  ) => Promise<ExchangeResult>;
  agency: AgencyOrgResolution;
  config: ConfigResolution;
  ahora: Date;
}

/**
 * Un access token usable, o por qué no lo hay.
 *
 * El orden de las preguntas es el mismo que el de `agency.ts` y por el mismo
 * motivo: primero se sabe A QUIÉN corresponde el token, después si hay con qué
 * pedirlo, y recién entonces se lo busca. Invertirlo consultaría con un id
 * inválido y leería el vacío que devuelve como una respuesta.
 */
export async function resolveAccessToken(deps: TokenDeps): Promise<AccessTokenResult> {
  if (!deps.agency.ok) {
    return {
      ok: false,
      reason: "agency-unresolved",
      detail: `VULKAN_AGENCY_ORG_ID: ${deps.agency.reason}`,
    };
  }
  if (!deps.config.ok) {
    return {
      ok: false,
      reason: "platform-not-configured",
      detail: `faltan ${deps.config.missing.join(", ")}`,
    };
  }

  const organizationId = deps.agency.organizationId;
  const estado = await deps.readState();

  // `absent` y `revoked` son las dos que mandan a la pantalla; `unset` y
  // `malformed` ya se contestaron arriba, y `unreadable` no dice nada del token.
  if (estado === "absent") {
    return { ok: false, reason: "absent", detail: "la agencia no tiene token" };
  }
  if (estado === "revoked") {
    return { ok: false, reason: "revoked", detail: "la autorización fue revocada" };
  }
  if (estado !== "active" && estado !== "expired") {
    return { ok: false, reason: "unreadable", detail: `estado ${estado}` };
  }

  const secreto = parseStoredToken(await deps.readSecret(organizationId));
  if (!secreto) {
    // Y esto NO es `absent`. La fila existe y su estado se leyó recién: lo que
    // falló es leer el secreto o parsearlo, y el token puede estar vivo. Decir
    // «no hay token» mandaría a rehacer un OAuth que ya está hecho.
    return { ok: false, reason: "unreadable", detail: "el secreto guardado no se pudo leer" };
  }

  if (estado === "active" && secreto.accessToken !== "") {
    return { ok: true, accessToken: secreto.accessToken };
  }

  const refrescado = await deps.refresh(deps.config.config, secreto.refreshToken, deps.ahora);
  if (!refrescado.ok) {
    // Un código que no es 2xx del endpoint de tokens es, en la práctica,
    // `invalid_grant`: alguien dio de baja el acceso del lado de Google. Un fallo
    // de red no lo es, y por eso no comparten motivo: uno manda a reconectar y el
    // otro a reintentar.
    if (refrescado.reason === "http" || refrescado.reason === "no-refresh-token") {
      return { ok: false, reason: "refresh-rejected", detail: refrescado.detail };
    }
    return { ok: false, reason: "unreadable", detail: refrescado.detail };
  }

  const nuevo: StoredToken = {
    refreshToken: refrescado.token.refreshToken,
    accessToken: refrescado.token.accessToken,
  };

  // Se guarda, y el resultado de guardarlo NO decide lo que se devuelve. Ver el
  // encabezado: el access token ya sirve, y un fallo de escritura sólo significa
  // que la próxima llamada va a refrescar de nuevo.
  await deps.writeRefreshed(organizationId, serializeToken(nuevo), refrescado.expiresAt);

  return { ok: true, accessToken: nuevo.accessToken };
}

/** Qué pasó al guardar una conexión nueva. */
export type StoreResult =
  | { ok: true }
  | { ok: false; reason: "agency-unresolved" | "write-failed"; detail: string };

/**
 * Guardar la conexión que acaba de autorizar el operador.
 *
 * Una sola llamada, porque cifrar el secreto y escribir la fila tienen que ser
 * una transacción. Ver la 0021.
 */
export async function saveAgencyToken(
  token: StoredToken,
  expiresAt: Date,
  env: NodeJS.ProcessEnv = process.env
): Promise<StoreResult> {
  const agencia = resolveAgencyOrgId(env);
  if (!agencia.ok) {
    return {
      ok: false,
      reason: "agency-unresolved",
      detail: `VULKAN_AGENCY_ORG_ID: ${agencia.reason}`,
    };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("store_integration_token", {
    p_organization_id: agencia.organizationId,
    p_provider: PROVIDER,
    p_secret: serializeToken(token),
    p_expires_at: expiresAt.toISOString(),
  });

  if (error) return { ok: false, reason: "write-failed", detail: error.message };
  return { ok: true };
}

/**
 * El access token de la agencia, listo para usar, con las dependencias reales.
 *
 * Es lo único de este archivo que los clientes HTTP llaman, y lo único que hace
 * es atar los cabos: la lectura de estado que ya usa la pantalla, las dos
 * funciones de la 0021, y el `fetch` del proceso.
 */
export async function agencyAccessToken(
  env: NodeJS.ProcessEnv = process.env,
  ahora: Date = new Date()
): Promise<AccessTokenResult> {
  const admin = createSupabaseAdminClient();

  return resolveAccessToken({
    agency: resolveAgencyOrgId(env),
    config: resolveOAuthConfig(env),
    ahora,
    readState: agencyTokenState,

    readSecret: async (organizationId) => {
      const { data, error } = await admin.rpc("integration_token_secret", {
        p_organization_id: organizationId,
        p_provider: PROVIDER,
      });
      if (error) return null;
      return typeof data === "string" ? data : null;
    },

    writeRefreshed: async (organizationId, secret, expiresAt) => {
      const { data, error } = await admin.rpc("refresh_integration_token", {
        p_organization_id: organizationId,
        p_provider: PROVIDER,
        p_secret: secret,
        p_expires_at: expiresAt.toISOString(),
      });
      return !error && data === true;
    },

    refresh: (config, refreshToken, momento) =>
      refreshAccessToken(config, refreshToken, momento, fetch as Fetcher),
  });
}
