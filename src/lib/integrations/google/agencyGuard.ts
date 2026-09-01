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
 * SE LEE COMO EL USUARIO, A PROPÓSITO
 *
 * Con el cliente de sesión y no con el admin, por el mismo argumento que
 * `property-actions.ts`: la pregunta es «¿qué alcanza ESTE usuario?», y hacerla
 * con una llave que lo alcanza todo la contesta siempre que sí. Es lo contrario
 * de `agencyToken.ts`, que sí usa `service_role` — allá la pregunta es sobre el
 * TOKEN, que es uno solo y no es de quien mira.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveAgencyOrgId } from "./agency";

/** Por qué alguien no puede operar la conexión de la agencia. */
export type GuardRejection =
  /** No hay sesión. */
  | "not-authenticated"
  /** Hay sesión, y no es de la agencia. */
  | "not-agency"
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
  const agencia = resolveAgencyOrgId(env);
  if (!agencia.ok) return { ok: false, reason: "agency-unresolved" };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const { data, error } = await supabase
    .from("org_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", agencia.organizationId)
    .limit(1);

  // Un fallo de lectura NO es una membresía. Devolver «es de la agencia» ante un
  // error de la base convertiría una caída de Supabase en un permiso.
  if (error || !data || data.length === 0) return { ok: false, reason: "not-agency" };

  return { ok: true, organizationId: agencia.organizationId };
}
