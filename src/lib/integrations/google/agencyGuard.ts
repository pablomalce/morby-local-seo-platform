/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que cualquier usuario con sesión pueda cambiar el token de la plataforma.
 *
 * El acceso a Google es de agencia: hay UN token, el de la organización de
 * Vulkan, y con él se sirven los datos de TODOS los clientes. O sea que el OAuth
 * no es una acción de cliente sino de plataforma, y quien la dispara tiene que
 * ser de la agencia. Sin esta comprobación, cualquiera que se registre puede
 * completar un consentimiento con SU cuenta de Google y dejar a la plataforma
 * entera llamando con un token que no es de nadie conocido — o, peor, revocar el
 * que había, porque `store_integration_token` revoca antes de escribir.
 *
 * Y la comprobación es de MEMBRESÍA, no de sesión a secas. «Tiene sesión» es lo
 * que separa a un desconocido de un usuario; lo que separa a un usuario de un
 * operador de la agencia es esta consulta.
 *
 * Y DE ROL, desde la puerta H4.1 (decisión D4, 2026-10-07): owner o admin de la
 * agencia. Un `viewer` de la agencia es personal en sólo lectura, y reemplazar el
 * token con el que se sirven TODOS los clientes no es leer. Un miembro sin ese
 * rol recibe su propio motivo, `not-allowed`, y las rutas contestan 403: él SÍ
 * sabe que la ruta existe, así que el 404 de quien no es de la agencia no le
 * corresponde.
 *
 * SE LEE COMO EL USUARIO, A PROPÓSITO
 *
 * Con el cliente de sesión y no con el admin, por el mismo argumento que
 * `property-actions.ts`: la pregunta es «¿qué alcanza ESTE usuario?», y hacerla
 * con una llave que lo alcanza todo la contesta siempre que sí. Es lo contrario
 * de `agencyToken.ts`, que sí usa `service_role` — allá la pregunta es sobre el
 * TOKEN, que es uno solo y no es de quien mira.
 */

import { quienLlama, type ClienteDeServidor } from "@/lib/api/sesion";
import { permisoEn } from "@/lib/org/rol";
import { resolveAgencyOrgId } from "./agency";

/** Por qué alguien no puede operar la conexión de la agencia. */
export type GuardRejection =
  /** No hay sesión. */
  | "not-authenticated"
  /** Hay sesión, y no es de la agencia. */
  | "not-agency"
  /** Es de la agencia, y su rol no alcanza para tocar la conexión (D4). */
  | "not-allowed"
  /** `VULKAN_AGENCY_ORG_ID` falta o no es un uuid: no hay a quién comparar. */
  | "agency-unresolved";

export type GuardResult =
  | { ok: true; organizationId: string }
  | { ok: false; reason: GuardRejection };

/**
 * Si quien está pidiendo esto puede operar la conexión de la agencia.
 *
 * `agency-unresolved` es su propio motivo y no `not-agency`: con la variable mal
 * puesta NADIE es de la agencia, y contestar «no sos de la agencia» mandaría a
 * pedir una membresía a alguien que ya la tiene. Es la misma distinción que
 * `agency.ts` hace entre `absent` y `malformed`.
 */
export async function esOperadorDeLaAgencia(
  env: NodeJS.ProcessEnv = process.env
): Promise<GuardResult> {
  if (!resolveAgencyOrgId(env).ok) return { ok: false, reason: "agency-unresolved" };

  // `quienLlama` y no `getUser()` a mano: en modo demo —sin las envs de
  // Supabase— construir el cliente TIRA, y este guardia no tenía try. MEDIDO el
  // 2026-10-07 con la variante `sin-proveedor` del barrido: las dos rutas de
  // OAuth le tiraban un 500 a un anónimo. Sin proveedor no hay nadie, y nadie
  // va al login como cualquier otro `not-authenticated`.
  const sesion = await quienLlama();
  if (!sesion) return { ok: false, reason: "not-authenticated" };

  return operadorDeLaAgencia(sesion.supabase, sesion.user.id, env);
}

/**
 * La misma pregunta, para quien ya tiene la sesión en la mano.
 *
 * La usa también el mapeo de propiedades (`property-actions.ts`), y no por
 * prolijidad: es lo que cierra el hallazgo del crítico del 2026-10-08. Toda
 * cuenta es owner de una organización —la personal que crea `handle_new_user`
 * (0001), y las que quiera crear con `create_client_organization` (0024)—, así
 * que «owner o admin de la organización destino» lo cumple cualquiera que se
 * registre. Y lo que se mapea ahí se lee con el token de la AGENCIA, que llega a
 * las properties de todos los clientes. La llave es de la agencia; quién la
 * apunta a una property lo decide la agencia, con esta función.
 */
export async function operadorDeLaAgencia(
  supabase: ClienteDeServidor,
  userId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<GuardResult> {
  const agencia = resolveAgencyOrgId(env);
  if (!agencia.ok) return { ok: false, reason: "agency-unresolved" };

  const permiso = await permisoEn(supabase, userId, agencia.organizationId, "integrar");

  // Un fallo de lectura NO es una membresía. Devolver «es de la agencia» ante un
  // error de la base convertiría una caída de Supabase en un permiso.
  if (!permiso.ok) {
    return { ok: false, reason: permiso.motivo === "rol-insuficiente" ? "not-allowed" : "not-agency" };
  }

  return { ok: true, organizationId: agencia.organizationId };
}
