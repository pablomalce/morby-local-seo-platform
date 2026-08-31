import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  type AgencyTokenState,
  type TokenTimestamps,
  readAgencyTokenState,
} from "./agency";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el estado del token de la agencia dependa de quién esté mirando la
 * pantalla.
 *
 * SERVER-ONLY. Usa el cliente admin, igual que el endpoint de la ingesta.
 *
 * POR QUÉ CON `service_role` Y NO COMO EL USUARIO
 *
 * La `0014` le da `SELECT` a `authenticated` sobre `integration_tokens`, pero
 * la RLS lo deja ver sólo las organizaciones de las que es miembro. El token es
 * UNO, el de la organización de Vulkan, y quien mira esta pantalla puede no ser
 * miembro de ella: leerlo como el usuario devolvería cero filas y la pantalla
 * diría «no hay token» sobre un token que existe y funciona. La respuesta
 * correcta por el motivo equivocado, otra vez.
 *
 * Lo que se lee son DOS marcas de tiempo de UNA organización. El `secret_id` y
 * el Vault no se tocan: el token en sí no hace falta para decir en qué estado
 * está, y no pedirlo es lo que hace que este atajo de privilegios sea acotado.
 *
 * POR QUÉ LA CONSULTA ORDENA, Y NO ES UN DETALLE
 *
 * El índice único de la `0014` es PARCIAL —`WHERE revoked_at IS NULL`— para
 * conservar el historial de revocaciones. O sea que una organización puede
 * tener varias filas revocadas y una viva a la vez. Un `limit 1` sin orden
 * podría traer una revocada de hace meses y declarar revocado un token que está
 * andando. `nullsFirst` pone la viva primero cuando existe; cuando no existe
 * ninguna viva, cualquiera de las revocadas dice lo mismo.
 */

/** El proveedor, escrito acá porque el CHECK de la `0014` sólo admite éste. */
const PROVIDER = "google";

/**
 * El estado del token de la agencia, leído de la base.
 *
 * Los dos fallos posibles —la consulta y la clasificación— llegan como
 * `unreadable` y no como un estado del token. Ver `agency.ts`.
 */
export async function agencyTokenState(): Promise<AgencyTokenState> {
  const admin = createSupabaseAdminClient();

  return readAgencyTokenState({
    readRow: async (organizationId) => {
      const { data, error } = await admin
        .from("integration_tokens")
        .select("expires_at, revoked_at")
        .eq("organization_id", organizationId)
        .eq("provider", PROVIDER)
        .order("revoked_at", { ascending: true, nullsFirst: true })
        .limit(1);

      if (error) return { ok: false };
      const fila = (data ?? [])[0];
      return { ok: true, row: fila ? (fila as TokenTimestamps) : null };
    },

    classify: async (row) => {
      const { data, error } = await admin.rpc("integration_token_state", {
        p_expires_at: row.expires_at,
        p_revoked_at: row.revoked_at,
      });
      if (error) return null;
      return typeof data === "string" ? data : null;
    },
  });
}
