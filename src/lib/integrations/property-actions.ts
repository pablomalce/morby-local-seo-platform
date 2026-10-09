"use server";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el mapeo de propiedades se escriba desde el navegador.
 *
 * La `0017` le da a `authenticated` SÓLO `SELECT` sobre
 * `integration_properties`, y eso no es prolijidad de privilegios: una sesión de
 * navegador capaz de INSERTAR apunta SU organización a la property de OTRO
 * cliente. La fila es legítimamente suya —`organization_id` es el de ella— así
 * que la policy permisiva la aprueba, la RESTRICTIVE también, y nada en la base
 * está mal. A partir de ahí el token de agencia, que llega a las dos
 * propiedades, le sirve los datos ajenos en su propio reporte.
 *
 * El aislamiento se cumple sobre la FILA y la fuga ocurre en el CONTENIDO, así
 * que ninguna policy puede verla. El único lugar donde cierra es el privilegio,
 * y el bloque 38 de `supabase/qa/defects_test.sql` lo mide.
 *
 * Por eso el mapeo se escribe ACÁ, con `service_role`, y por eso la
 * comprobación de membresía de arriba es la que reemplaza a la RLS que este
 * camino se está salteando: el cliente manda un `organizationId` y un cliente
 * puede mandar cualquiera. `service_role` no tiene RLS que lo pare.
 *
 * LA LECTURA VA POR EL OTRO CLIENTE, A PROPÓSITO
 *
 * La membresía se comprueba con el cliente de sesión, no con el de servicio: la
 * pregunta es «¿qué alcanza ESTE usuario?», y hacerla con una llave que lo
 * alcanza todo la contesta siempre que sí.
 *
 * Y NO ALCANZA CON SER MIEMBRO (decisión D4 de la puerta H4.1, 2026-10-07)
 *
 * Mapear y desmapear exigen owner o admin de esa organización. Hasta acá
 * alcanzaba con una membresía cualquiera, así que un `viewer` —o el cliente
 * mismo, con el rol `client` de la 0031— movía la frontera entre clientes con
 * `service_role`. Ninguna policy lo puede frenar: la escritura de abajo no pasa
 * por la RLS. Es esta comprobación o nada, y `permisoEn()` es quien la hace.
 *
 * Y TAMPOCO ALCANZA CON SER OWNER DE LA ORGANIZACIÓN DESTINO
 *
 * Medido por un crítico el 2026-10-08, de punta a punta sobre la réplica con
 * PostgREST: el rol se preguntaba sólo en la organización destino, y TODA cuenta
 * es owner de alguna —la personal que `handle_new_user` (0001) crea al darse de
 * alta, y las que quiera con `create_client_organization` (0024)—. Un client de
 * X recibía `not-allowed` en X y `{ ok: true }` en su organización personal P,
 * mapeaba ahí una property que no estuviera mapeada en vivo —o un alias de
 * prefijo de URL de una que sí: la unicidad de la 0017 compara texto—, creaba un
 * negocio en P y `POST /api/reports/generate` le devolvía los clics de Search
 * Console del otro cliente, leídos con el token de la AGENCIA.
 *
 * El token es de la agencia, así que quién lo apunta a una property también:
 * además del rol en la organización destino, owner o admin de la agencia
 * (`operadorDeLaAgencia`, la misma pregunta que el OAuth). Un client nunca lo es;
 * una cuenta que se registró sola, tampoco. Y sin `VULKAN_AGENCY_ORG_ID` nadie
 * mapea: falla cerrado, como el OAuth.
 */

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { permisoEn } from "@/lib/org/rol";
import { operadorDeLaAgencia } from "@/lib/integrations/google/agencyGuard";
import { validarPropertyRef, FORMA_ESPERADA } from "@/lib/integrations/google/mapping";
import type { GoogleSurface } from "@/lib/integrations/google/sources";

export type PropertyActionResult =
  | { ok: true }
  | { ok: false; code: PropertyActionError; message: string };

export type PropertyActionError =
  /** No hay sesión. */
  | "not-authenticated"
  /** Hay sesión, y no es de esta organización. */
  | "not-a-member"
  /** Es de esta organización, y su rol no alcanza para tocar integraciones (D4). */
  | "not-allowed"
  /**
   * Su rol en la organización alcanza, y no opera la agencia: el mapeo apunta el
   * token de la AGENCIA, y eso lo decide un owner o admin de la agencia.
   */
  | "not-agency"
  /** `VULKAN_AGENCY_ORG_ID` falta o no es un uuid: no hay agencia a quién preguntarle. */
  | "agency-unresolved"
  /** La superficie no es una de las tres. */
  | "unknown-surface"
  /** El identificador no tiene la forma que la 0017 exige. */
  | "bad-shape"
  /** Otra organización ya tiene esa property viva. Es la fuga, rechazada. */
  | "property-taken"
  /** Cualquier otro fallo de la base. */
  | "write-failed";

/** La ruta que se revalida después de escribir. */
const PANTALLA = "/app/integrations";

/**
 * Que el usuario de la sesión pueda tocar las integraciones de la organización
 * que dice: miembro ACTIVO, con un rol que integra.
 *
 * Devuelve `null` sólo si puede. Sin esto, la mitad de arriba de este archivo no
 * sirve de nada: el privilegio quedaría del lado del servidor y el servidor
 * escribiría lo que le pidan.
 */
async function organizacionDelUsuario(organizationId: string): Promise<PropertyActionError | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "not-authenticated";

  const permiso = await permisoEn(supabase, user.id, organizationId, "integrar");
  // Un fallo de lectura NO es una membresía. Devolver «miembro» ante un error de
  // la base convertiría una caída de Supabase en un permiso — así que falla
  // cerrado, como antes de que hubiera roles.
  if (!permiso.ok) return permiso.motivo === "rol-insuficiente" ? "not-allowed" : "not-a-member";

  // La segunda pregunta, la de la llave. Ver el encabezado: owner de la
  // organización destino lo es cualquiera.
  const operador = await operadorDeLaAgencia(supabase, user.id);
  if (operador.ok) return null;
  return operador.reason === "agency-unresolved" ? "agency-unresolved" : "not-agency";
}

/**
 * Mapear una superficie de una organización a una property de Google.
 *
 * Si la organización ya tenía un mapeo vivo de esa superficie, se desmapea
 * primero. El orden importa y no es intercambiable: el índice
 * `integration_properties_one_live_per_provider` rechaza el INSERT mientras el
 * anterior siga vivo, así que al revés esto no funciona nunca. Y como los dos
 * pasos no son una transacción, la caída entre uno y otro deja al cliente SIN
 * mapear — que no muestra nada de nadie. Al revés dejaría dos mapeos vivos, que
 * es la mitad de los reportes con los números del sitio equivocado.
 */
export async function mapProperty(input: {
  organizationId: string;
  surface: string;
  propertyRef: string;
}): Promise<PropertyActionResult> {
  const noEsMiembro = await organizacionDelUsuario(input.organizationId);
  if (noEsMiembro) {
    return { ok: false, code: noEsMiembro, message: mensaje(noEsMiembro) };
  }

  const validacion = validarPropertyRef(input.surface, input.propertyRef);
  if (!validacion.ok) {
    if (validacion.rechazo === "superficie-desconocida") {
      return { ok: false, code: "unknown-surface", message: mensaje("unknown-surface") };
    }
    const esperada = FORMA_ESPERADA[input.surface as GoogleSurface];
    return {
      ok: false,
      code: "bad-shape",
      message:
        validacion.rechazo === "vacio"
          ? `Falta el identificador. Se esperaba ${esperada}.`
          : `Ese identificador no tiene la forma que Google devuelve. Se esperaba ${esperada}.`,
    };
  }

  const admin = createSupabaseAdminClient();

  const { error: errorDesmapeo } = await admin
    .from("integration_properties")
    .update({ unmapped_at: new Date().toISOString() })
    .eq("organization_id", input.organizationId)
    .eq("provider", input.surface)
    .is("unmapped_at", null);
  if (errorDesmapeo) {
    return { ok: false, code: "write-failed", message: mensaje("write-failed") };
  }

  const { error } = await admin.from("integration_properties").insert({
    organization_id: input.organizationId,
    provider: input.surface,
    property_ref: validacion.propertyRef,
  });

  if (error) {
    // 23505 es la unicidad, y acá sólo puede ser la GLOBAL: la de
    // `(organization_id, provider)` la acabamos de despejar. O sea que es
    // exactamente la fuga que la `0017` existe para impedir, y el operador tiene
    // que leer eso y no «error al guardar».
    if (error.code === "23505") {
      return { ok: false, code: "property-taken", message: mensaje("property-taken") };
    }
    return { ok: false, code: "write-failed", message: mensaje("write-failed") };
  }

  revalidatePath(PANTALLA);
  return { ok: true };
}

/**
 * Desmapear una superficie de una organización.
 *
 * No borra: escribe `unmapped_at`. El historial es lo que permite contestar «¿de
 * quién eran estos números el mes pasado?», y esa pregunta se hace justamente
 * cuando se sospecha que un reporte mostró lo que no era.
 */
export async function unmapProperty(input: {
  organizationId: string;
  surface: string;
}): Promise<PropertyActionResult> {
  const noEsMiembro = await organizacionDelUsuario(input.organizationId);
  if (noEsMiembro) {
    return { ok: false, code: noEsMiembro, message: mensaje(noEsMiembro) };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("integration_properties")
    .update({ unmapped_at: new Date().toISOString() })
    .eq("organization_id", input.organizationId)
    .eq("provider", input.surface)
    .is("unmapped_at", null);

  if (error) return { ok: false, code: "write-failed", message: mensaje("write-failed") };

  revalidatePath(PANTALLA);
  return { ok: true };
}

function mensaje(code: PropertyActionError): string {
  switch (code) {
    case "not-authenticated":
      return "Hay que iniciar sesión.";
    case "not-a-member":
      return "Esa organización no es tuya.";
    case "not-allowed":
      return "Tu rol en esta organización no permite cambiar sus integraciones.";
    case "not-agency":
      return "El mapeo apunta el token de Google de la agencia: lo cambia un owner o admin de la agencia.";
    case "agency-unresolved":
      return "VULKAN_AGENCY_ORG_ID no está configurada, así que nadie puede mapear hasta que lo esté.";
    case "unknown-surface":
      return "Esa superficie de Google no existe.";
    case "bad-shape":
      return "Ese identificador no tiene la forma que Google devuelve.";
    case "property-taken":
      return "Esa property ya está mapeada a otra organización. Desmapeala allá primero.";
    case "write-failed":
      return "No se pudo guardar el mapeo.";
  }
}
