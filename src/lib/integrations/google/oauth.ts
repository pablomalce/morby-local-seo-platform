/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el consentimiento de Google se pida de una manera que devuelva un token
 * que no sirve, y que nadie se entere hasta que lo primero que falle sea el
 * reporte de un cliente.
 *
 * Es la mitad PURA del OAuth: arma la URL, lee lo que vuelve, y traduce la
 * respuesta del intercambio. No toca la base, no toca cookies y no redirige —
 * eso vive en las dos rutas, que son delgadas a propósito porque lo que corre
 * adentro de un Route Handler se prueba peor.
 *
 * TRES COSAS QUE, MAL PUESTAS, DEVUELVEN UN TOKEN INSERVIBLE
 *
 *   `access_type=offline`  sin esto Google devuelve SÓLO un access token, que
 *                          dura una hora. Al día siguiente no hay nada que
 *                          refrescar y el reporte se queda sin datos;
 *   `prompt=consent`       sin esto, la SEGUNDA vez que la misma cuenta autoriza
 *                          la misma aplicación Google NO manda refresh token: da
 *                          por hecho que el primero se guardó. O sea que
 *                          reconectar —que es lo que uno hace justamente cuando
 *                          algo anda mal— devolvería una conexión sin con qué
 *                          refrescar;
 *   `include_granted_scopes` no se manda. Los permisos que este flujo pide son
 *                          los que este flujo usa, y acumular los de otro hace
 *                          que un token siga sirviendo por accidente.
 *
 * Las tres son la clase de cosa que anda en la primera prueba y falla a la
 * semana, así que están escritas acá y medidas por tests, y no confiadas a que
 * quien arme la URL se acuerde.
 *
 * POR QUÉ EL SECRETO QUE SE GUARDA ES UN JSON Y NO EL REFRESH TOKEN A SECAS
 *
 * Porque `integration_tokens.expires_at` existe desde la 0014 y describe la vida
 * de un ACCESS token, no la de un refresh token. Guardando sólo el refresh
 * token, esa columna no tendría nada honesto que decir y
 * `integration_token_state()` —que es lo que la pantalla muestra— contestaría
 * sobre una fecha inventada. Guardando los dos, cada cosa dice lo que es.
 *
 * Y el JSON se valida al LEERLO. Un secreto que no parsea es «no se pudo leer» y
 * no «no hay token»: el token puede estar perfectamente vivo del lado de Google,
 * y lo que se rompió es nuestra manera de guardarlo. Mismo argumento que
 * `agency.ts` hace con `unreadable` y `status.ts` con `error`.
 */

/** Los permisos que este flujo pide, que son exactamente los que usa. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

/** Dónde se pide el consentimiento y dónde se canjea el código. */
export const CONSENT_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Las tres variables que el flujo necesita, ya leídas y validadas. */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type ConfigResolution =
  | { ok: true; config: GoogleOAuthConfig }
  /** Falta alguna de las tres. `missing` dice cuáles, para que la pantalla lo diga. */
  | { ok: false; missing: string[] };

/**
 * Las tres variables de entorno, o cuáles faltan.
 *
 * `platformIsConnected()` de `sources.ts` mira dos de las tres y contesta un
 * booleano; esto no lo reemplaza ni lo contradice. Aquella pregunta es «¿tiene
 * sentido pedirle algo a Google?», que se hace por reporte y por cliente; ésta es
 * «¿se puede completar el intercambio?», que además necesita el redirect y se
 * hace una vez por conexión. Compartir la respuesta obligaría a la primera a
 * cargar el redirect para no usarlo.
 */
export function resolveOAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): ConfigResolution {
  const faltan: string[] = [];
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const redirectUri = (env.GOOGLE_REDIRECT_URI ?? "").trim();

  if (!clientId) faltan.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) faltan.push("GOOGLE_CLIENT_SECRET");
  if (!redirectUri) faltan.push("GOOGLE_REDIRECT_URI");

  if (faltan.length > 0) return { ok: false, missing: faltan };
  return { ok: true, config: { clientId, clientSecret, redirectUri } };
}

/**
 * La URL a la que se manda al operador para que autorice.
 *
 * `state` viaja acá y vuelve en el callback; quien llama es responsable de
 * haberlo guardado en una cookie para poder compararlo. Ver la ruta de arranque.
 */
export function buildConsentUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(CONSENT_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Qué volvió del consentimiento. */
export type CallbackReading =
  | { ok: true; code: string; state: string }
  /** El operador dijo que no, o Google rechazó el pedido. */
  | { ok: false; reason: "denied"; detail: string }
  /** Volvió sin código o sin estado: no hay nada que canjear. */
  | { ok: false; reason: "incomplete"; detail: string };

/**
 * Lo que trae la vuelta del consentimiento.
 *
 * `error` se mira ANTES que `code`, y no al revés: Google manda uno o el otro, y
 * mirar primero el código haría que un `access_denied` se leyera como una vuelta
 * incompleta —que se arregla reintentando— cuando lo que pasó es que alguien dijo
 * que no.
 */
export function readCallback(params: URLSearchParams): CallbackReading {
  const error = params.get("error");
  if (error) return { ok: false, reason: "denied", detail: error };

  const code = params.get("code");
  const state = params.get("state");
  if (!code) return { ok: false, reason: "incomplete", detail: "falta el parámetro code" };
  if (!state) return { ok: false, reason: "incomplete", detail: "falta el parámetro state" };

  return { ok: true, code, state };
}

/** Lo que se guarda cifrado en el Vault, ya parseado. */
export interface StoredToken {
  refreshToken: string;
  accessToken: string;
}

/** Cómo terminó un intercambio con el endpoint de tokens de Google. */
export type ExchangeResult =
  | { ok: true; token: StoredToken; expiresAt: Date }
  /** Google contestó, y lo que contestó no sirve para guardar una conexión. */
  | { ok: false; reason: "no-refresh-token" | "malformed"; detail: string }
  /** Google contestó con un código que no es 2xx. */
  | { ok: false; reason: "http"; detail: string }
  /** No llegó a haber respuesta, o se agotó el tiempo. */
  | { ok: false; reason: "network"; detail: string };

/**
 * El cuerpo que Google devuelve, traducido.
 *
 * `refresh_token` ausente es su propio motivo y no `malformed`, porque se arregla
 * en otro lado: el cuerpo está perfecto, lo que falta es `prompt=consent` en la
 * URL de arriba. Confundirlos mandaría a leer el parseo cuando el defecto está en
 * el pedido.
 *
 * `refreshDeReserva` es lo que hace que el mismo lector sirva para los dos
 * intercambios. En el REFRESCO Google no devuelve `refresh_token` —el que ya
 * está guardado sigue valiendo— así que un lector sin este parámetro diría
 * `no-refresh-token` sobre un refresco perfectamente exitoso, y la aplicación
 * mandaría a reconectar cada hora. Se pasa sólo ahí: en el canje del código, la
 * ausencia SÍ es el defecto que hay que ver.
 */
export function readTokenBody(
  body: unknown,
  ahora: Date,
  refreshDeReserva?: string
): ExchangeResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "malformed", detail: "el cuerpo no es un objeto" };
  }

  const b = body as Record<string, unknown>;
  const access = b.access_token;
  const refresh = b.refresh_token;
  const expiresIn = b.expires_in;

  if (typeof access !== "string" || access === "") {
    return { ok: false, reason: "malformed", detail: "falta access_token" };
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return { ok: false, reason: "malformed", detail: "expires_in no es un número de segundos" };
  }
  const efectivo =
    typeof refresh === "string" && refresh !== "" ? refresh : (refreshDeReserva ?? "");

  if (efectivo === "") {
    return { ok: false, reason: "no-refresh-token", detail: "Google no devolvió refresh_token" };
  }

  return {
    ok: true,
    token: { refreshToken: efectivo, accessToken: access },
    expiresAt: new Date(ahora.getTime() + expiresIn * 1000),
  };
}

/** El secreto tal como se guarda en el Vault: texto opaco para la base. */
export function serializeToken(token: StoredToken): string {
  return JSON.stringify({
    refresh_token: token.refreshToken,
    access_token: token.accessToken,
  });
}

/**
 * El secreto tal como vuelve del Vault.
 *
 * `null` es «esto no se puede leer», y quien lo llame tiene que tratarlo como
 * «no se pudo averiguar» y NUNCA como «no hay token»: la conexión puede estar
 * viva del lado de Google, y mandar a reconectar por un error de formato nuestro
 * le hace rehacer a alguien un OAuth que estaba bien.
 */
export function parseStoredToken(secret: string | null): StoredToken | null {
  if (typeof secret !== "string" || secret === "") return null;

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(secret);
  } catch {
    return null;
  }

  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const c = cuerpo as Record<string, unknown>;
  if (typeof c.refresh_token !== "string" || c.refresh_token === "") return null;
  if (typeof c.access_token !== "string" || c.access_token === "") return null;

  return { refreshToken: c.refresh_token, accessToken: c.access_token };
}

/** El `fetch` que el intercambio usa, inyectable para poder probarlo. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Canjear el código por un token, o el refresh token por un access token nuevo.
 *
 * Los dos intercambios son el mismo POST con distinto `grant_type`, así que
 * comparten esta función: escribirlos por separado dejaría dos lugares donde
 * poner mal el `client_secret`, y uno de los dos se prueba mucho menos que el
 * otro.
 */
async function postToken(
  config: GoogleOAuthConfig,
  cuerpo: Record<string, string>,
  ahora: Date,
  fetcher: Fetcher,
  refreshDeReserva?: string
): Promise<ExchangeResult> {
  let respuesta: Response;
  try {
    respuesta = await fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...cuerpo,
      }).toString(),
    });
  } catch (e) {
    return {
      ok: false,
      reason: "network",
      detail: e instanceof Error ? e.message : "sin respuesta",
    };
  }

  if (!respuesta.ok) {
    return { ok: false, reason: "http", detail: `Google contestó ${respuesta.status}` };
  }

  let json: unknown;
  try {
    json = await respuesta.json();
  } catch {
    return { ok: false, reason: "malformed", detail: "el cuerpo no es JSON" };
  }

  return readTokenBody(json, ahora, refreshDeReserva);
}

/** El canje del código que vuelve del consentimiento. */
export function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  ahora: Date,
  fetcher: Fetcher
): Promise<ExchangeResult> {
  return postToken(
    config,
    { code, redirect_uri: config.redirectUri, grant_type: "authorization_code" },
    ahora,
    fetcher
  );
}

/**
 * El refresco de un access token vencido.
 *
 * El refresh token viaja DOS veces y no es redundancia: una como lo que se
 * canjea, y otra como reserva para el resultado, porque Google no lo devuelve en
 * esta respuesta. Sin la segunda, un refresco exitoso se leería como
 * `no-refresh-token` y la aplicación mandaría a reconectar cada hora.
 */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  ahora: Date,
  fetcher: Fetcher
): Promise<ExchangeResult> {
  return postToken(
    config,
    { refresh_token: refreshToken, grant_type: "refresh_token" },
    ahora,
    fetcher,
    refreshToken
  );
}
