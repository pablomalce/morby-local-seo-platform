/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla mande a rehacer un OAuth que ya está hecho, porque la
 * variable que nombra a la agencia está mal escrita.
 *
 * El acceso a Google es de agencia con acceso delegado: hay UNA fila en
 * `integration_tokens`, la de la organización de Vulkan, con permiso sobre las
 * properties de todos los clientes. Hasta hoy ninguna columna decía cuál
 * organización era ésa, y por eso `AgencyTokenState` tenía un valor
 * `"undecided"` que no era un estado del token sino una decisión de producto
 * sin tomar.
 *
 * LA DECISIÓN, TOMADA: LA AGENCIA SE NOMBRA POR VARIABLE DE ENTORNO
 *
 * `VULKAN_AGENCY_ORG_ID` lleva el id de la organización de Vulkan. Se eligió
 * sobre una columna en `organizations` y sobre una tabla singleton por lo que
 * cuesta deshacerla: no hay nada que migrar, y el día que convenga que viva en
 * el esquema, mover una variable a una columna es una migración trivial. Al
 * revés —sacar una columna que ya tiene datos y policies colgando— no lo es.
 *
 * POR QUÉ HAY SIETE ESTADOS Y NO TRES
 *
 * `public.integration_token_state()` devuelve tres, y son los tres que existen
 * CUANDO HAY FILA. Los otros cuatro son las maneras de no tener respuesta, y
 * cada uno se arregla en un lugar distinto:
 *
 *   active      nada que hacer
 *   expired     refrescar el token
 *   revoked     rehacer el consentimiento OAuth
 *   absent      hacer el OAuth por primera vez: la agencia existe, el token no
 *   unset       poner `VULKAN_AGENCY_ORG_ID`
 *   malformed   corregirla: lo que tiene no es un uuid
 *   unreadable  la consulta falló; el token puede estar perfectamente vivo
 *
 * `absent` y `malformed` son el par que justifica el archivo. Sin validar el
 * uuid, un id mal tipeado consulta una organización que no existe, no
 * encuentra fila, y la pantalla dice «hacé el OAuth» — alguien lo rehace, lo
 * guarda bajo el id bueno, y la pantalla sigue diciendo lo mismo. La respuesta
 * correcta por el motivo equivocado, que es el defecto que este repositorio
 * viene sacando desde el #55.
 *
 * Y `unreadable` no es `absent` por el mismo argumento que `status.ts` usa para
 * no confundir `error` con `missing`: una consulta que falló no es una
 * integración sin configurar.
 *
 * LA REGLA DE «REVOCADO DOMINA» NO SE ESCRIBE ACÁ
 *
 * Vive en `public.integration_token_state()` desde la `0014` y llega por
 * `classify`. Reimplementarla en TypeScript la pondría en dos lugares que
 * pueden separarse, y la que decide qué se ve en pantalla tiene que ser la
 * misma que la base aplica.
 */

/** Las dos columnas que alcanzan para clasificar un token. Nunca el token. */
export interface TokenTimestamps {
  expires_at: string;
  revoked_at: string | null;
}

/**
 * El estado del token de la agencia.
 *
 * Los tres primeros son los que devuelve `public.integration_token_state()`.
 * Los cuatro últimos son las maneras de no tener respuesta. Ver el encabezado.
 */
export type AgencyTokenState =
  | "active"
  | "expired"
  | "revoked"
  | "absent"
  | "unset"
  | "malformed"
  | "unreadable";

/** El nombre de la variable, en un solo lugar para que los tests no lo repitan. */
export const AGENCY_ORG_ID_ENV = "VULKAN_AGENCY_ORG_ID";

/**
 * La forma canónica de un uuid, la misma que valida el payload de la ingesta.
 * Se escribe el literal y no se importa: un test que compara contra la
 * constante que prueba no mide nada.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Qué organización es la agencia, o por qué no se sabe. */
export type AgencyOrgResolution =
  | { ok: true; organizationId: string }
  | { ok: false; reason: "unset" | "malformed" };

/**
 * Lee `VULKAN_AGENCY_ORG_ID` y la valida.
 *
 * Una cadena vacía o de puros espacios es `unset` y no `malformed`: en la
 * práctica es una variable declarada y sin valor, y el arreglo es el mismo que
 * el de no haberla puesto.
 */
export function resolveAgencyOrgId(
  env: NodeJS.ProcessEnv = process.env
): AgencyOrgResolution {
  const crudo = env[AGENCY_ORG_ID_ENV];
  if (typeof crudo !== "string") return { ok: false, reason: "unset" };

  const valor = crudo.trim();
  if (valor === "") return { ok: false, reason: "unset" };
  if (!UUID.test(valor)) return { ok: false, reason: "malformed" };

  return { ok: true, organizationId: valor };
}

/** Trae las dos marcas de tiempo del token de una organización, o dice que no pudo. */
export type TokenRowReader = (
  organizationId: string
) => Promise<{ ok: true; row: TokenTimestamps | null } | { ok: false }>;

/** Clasifica una fila con la función de la base. `null` es no haber podido. */
export type TokenClassifier = (row: TokenTimestamps) => Promise<string | null>;

/**
 * El estado del token de la agencia, de punta a punta.
 *
 * El orden es el que impide los dos defectos del encabezado: primero se sabe A
 * QUIÉN preguntarle, y recién entonces se pregunta. Invertirlo haría una
 * consulta con un id inválido y leería su resultado vacío como una respuesta.
 */
export async function readAgencyTokenState(deps: {
  readRow: TokenRowReader;
  classify: TokenClassifier;
  env?: NodeJS.ProcessEnv;
}): Promise<AgencyTokenState> {
  const agencia = resolveAgencyOrgId(deps.env ?? process.env);
  if (!agencia.ok) return agencia.reason;

  const leida = await deps.readRow(agencia.organizationId);
  if (!leida.ok) return "unreadable";
  if (leida.row === null) return "absent";

  const clasificada = await deps.classify(leida.row);
  // Un valor que la base no debería devolver se trata como no haber podido, y
  // NO cae a `active`: un default optimista acá diría «conectado» sobre un
  // token del que no sabemos nada.
  if (clasificada === "active" || clasificada === "expired" || clasificada === "revoked") {
    return clasificada;
  }
  return "unreadable";
}
