import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verificarFirmaDeLectura } from "@/lib/integrations/leadEngine/profileReadSignature";
import { leerFichaPublicada } from "@/lib/profile/fichaPublicada";

export const dynamic = "force-dynamic";
/** Node y no edge: la verificación de firma usa `node:crypto`. */
export const runtime = "nodejs";

/** Un uuid en la forma canónica 8-4-4-4-12. Postgres acepta más formas; el contrato, no. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que el Lead Engine siga escribiendo el ICP de Vulkan a mano en su prompt
 * porque no tiene de dónde leerlo. Hasta H1.3 no existía ningún camino por el
 * que el Lead Engine leyera Growth OS —el único puente era el webhook de
 * lead-won, de salida—, así que «un solo ICP» era imposible por construcción.
 * Ésta es la lectura de servicio de la decisión 8a: el Lead Engine pide la
 * ficha publicada de un par (organización, empresa) y cita su `version_id`.
 *
 * EL CONTRATO está escrito entero en el encabezado de
 * `src/lib/integrations/leadEngine/profileReadSignature.ts`. Ésa es la fuente;
 * acá sólo está el orden.
 *
 * EL ORDEN DE ESTA FUNCIÓN NO ES INTERCAMBIABLE
 *
 * 1. Verificar la firma, que cubre los dos ids de la query y la hora. Antes de
 *    validar nada y antes de crear el cliente de servicio: todo lo que hay más
 *    abajo lee sin RLS, así que la firma es lo único que separa al Lead Engine
 *    de cualquiera que sepa dos uuid. Sin secreto de este lado, 503 —falla
 *    cerrado, la lección de `requireInternalSecret`—, nunca «pasá».
 * 2. Validar la forma de los ids. Después de la firma, porque quien llega acá
 *    ya es el productor y lo que necesita es saber qué mandó mal.
 * 3. Leer con `service_role` por `leerFichaPublicada`, la MISMA función que usa
 *    el reporte, filtrando por organización Y empresa.
 *
 * QUÉ DEVUELVE
 *
 *   200  la versión publicada, con su ICP y su oferta;
 *   400  firmado, y un id no es un uuid;
 *   401  sin firma, mal formada, de otro secreto, o fuera de la ventana. Un
 *        solo cuerpo para los cuatro: decirle a quien prueba cuál le falló es
 *        darle el mapa. El motivo queda en el log fuera de producción;
 *   404  no hay versión publicada de ESE par —incluido el negocio que no es de
 *        esa organización, que tiene que ser indistinguible de uno inexistente—;
 *   502  la base falló. Ausencia no es fallo, y el cuerpo no lleva ni el código
 *        ni el mensaje de Postgres: el Lead Engine no puede hacer nada con ellos
 *        y un tercero aprendería el esquema;
 *   503  falta VULKAN_PROFILE_READ_SECRET en este lado.
 *
 * Y `no-store`: una respuesta firmada para un pedido no es para ningún caché.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organization_id") ?? "";
  const businessId = url.searchParams.get("business_id") ?? "";

  const firma = verificarFirmaDeLectura({
    organizationId,
    businessId,
    timestamp: request.headers.get("x-vulkan-timestamp"),
    firma: request.headers.get("x-vulkan-signature"),
    secreto: process.env.VULKAN_PROFILE_READ_SECRET,
    ahoraSegundos: Math.floor(Date.now() / 1000),
  });
  if (!firma.ok) {
    if (firma.motivo === "sin-secreto") return responder({ error: "sin-secreto" }, 503);
    if (process.env.NODE_ENV !== "production") {
      console.warn("[profile/published] firma rechazada:", firma.motivo);
    }
    return responder({ error: "firma-rechazada" }, 401);
  }

  if (!UUID.test(organizationId) || !UUID.test(businessId)) {
    return responder({ error: "parametros-invalidos" }, 400);
  }

  const lectura = await leerFichaPublicada(createSupabaseAdminClient(), organizationId, businessId);

  if (lectura.estado === "fallo") {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[profile/published] la lectura falló:", lectura.codigo);
    }
    return responder({ error: "lectura-fallida" }, 502);
  }
  if (lectura.estado === "sin-version") {
    return responder({ error: "sin-version-publicada" }, 404);
  }

  const f = lectura.ficha;
  return responder(
    {
      organization_id: organizationId,
      business_id: businessId,
      version_id: f.versionId,
      version: f.version,
      published_at: f.publishedAt,
      icp: f.icp
        ? {
            definition: f.icp.definition,
            disqualifiers: f.icp.disqualifiers,
            buying_trigger: f.icp.buyingTrigger,
            budget_band: f.icp.budgetBand,
          }
        : null,
      offers: f.offers.map((o) => ({
        name: o.name,
        description: o.description,
        price_band: o.priceBand,
        promise: o.promise,
      })),
    },
    200
  );
}

function responder(cuerpo: unknown, status: number) {
  return NextResponse.json(cuerpo, { status, headers: { "cache-control": "no-store" } });
}
