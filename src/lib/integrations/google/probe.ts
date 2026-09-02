/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el motivo de un fallo dure menos que las ganas de averiguarlo.
 *
 * La #67 hizo que el servidor escriba el motivo en su log. Alcanzaba en teoría y
 * no en la práctica: el proyecto vive en el plan Hobby de Vercel, donde los logs
 * de función son efímeros. Medido el 2026-09-02, con GA4 fallando de verdad: el
 * panel contestó «There are no request logs in this time range» sobre la ventana
 * en que había pasado.
 *
 * Así que el resultado va también a `integration_probe`, que sobrevive al log y
 * se consulta con un SELECT — por quien opera la plataforma, y por la pantalla de
 * integraciones cuando lo muestre.
 *
 * SERVER-ONLY. Escribe con `service_role`, el único rol que la 0022 deja
 * escribir: registrar el resultado de una consulta es consecuencia de haberla
 * hecho, y una sesión de navegador que pudiera escribirlo podría declarar «ok»
 * sobre una integración rota.
 *
 * ESCRIBIR ESTO NO PUEDE ROMPER UN REPORTE
 *
 * Es telemetría: útil, y menos importante que el reporte que la produjo. Si la
 * escritura falla, el reporte sigue. Lo contrario —un reporte que se cae porque no
 * pudo anotar por qué falló otra cosa— convierte una molestia en una caída.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { FetchOutcome } from "./status";
import type { GoogleSurface } from "./sources";

/** Una fila de `integration_probe`, tal como se escribe. */
export interface Sonda {
  organizationId: string;
  provider: GoogleSurface;
  outcome: FetchOutcome["kind"];
  httpStatus: number | null;
  propertyRef: string;
}

/**
 * De lo que devolvió el cliente HTTP a lo que la tabla guarda.
 *
 * El código viaja SÓLO cuando hubo respuesta, y el CHECK de la 0022 lo obliga en
 * las dos direcciones. Mandar un código junto a un `timeout` inventaría una
 * respuesta que no existió, y quien lea la fila buscaría el problema del lado de
 * Google en vez del de la red.
 */
export function sondaDeOutcome(
  organizationId: string,
  provider: GoogleSurface,
  outcome: FetchOutcome,
  propertyRef: string
): Sonda {
  return {
    organizationId,
    provider,
    outcome: outcome.kind,
    httpStatus: outcome.kind === "http" ? outcome.status : null,
    propertyRef,
  };
}

/**
 * Guarda la sonda, reemplazando la anterior de esa organización y proveedor.
 *
 * `upsert` sobre la unicidad de la 0022 y no `insert`: la tabla contesta «¿qué
 * pasa AHORA?», así que acumular filas sería construir un historial que nadie
 * pidió y que nadie borra.
 *
 * Devuelve si se pudo, y quien llama es libre de ignorarlo — ver el encabezado.
 */
export async function guardarSonda(sonda: Sonda): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("integration_probe").upsert(
      {
        organization_id: sonda.organizationId,
        provider: sonda.provider,
        outcome: sonda.outcome,
        http_status: sonda.httpStatus,
        property_ref: sonda.propertyRef,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider" }
    );
    return !error;
  } catch {
    // El cliente admin tira si le faltan sus variables. Que eso tumbe un reporte
    // sería exactamente lo que el encabezado dice que no puede pasar.
    return false;
  }
}
