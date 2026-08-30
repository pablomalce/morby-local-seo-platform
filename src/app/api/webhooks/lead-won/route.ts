import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifySignature } from "@/lib/integrations/leadEngine/signature";
import { EVENTO, parseLeadWon } from "@/lib/integrations/leadEngine/payload";

export const dynamic = "force-dynamic";
/** Node y no edge: la verificación de firma usa `node:crypto`. */
export const runtime = "nodejs";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un lead ganado se pierda, o que se convierta en dos clientes.
 *
 * EL ORDEN DE ESTA FUNCIÓN NO ES INTERCAMBIABLE
 *
 * 1. leer el cuerpo CRUDO — antes de parsearlo, porque la firma es sobre los
 *    bytes que llegaron y `JSON.parse`/`stringify` no los devuelve iguales;
 * 2. verificar la firma — antes de mirar el contenido. Todo lo que hay más abajo
 *    escribe con `service_role` y sin RLS, así que la firma es lo único que
 *    separa una entrega legítima de un POST cualquiera;
 * 3. recién entonces parsear y validar;
 * 4. y una sola llamada a `ingest_lead_won`, que hace las cinco escrituras en UNA
 *    transacción y reclama la clave de idempotencia al final.
 *
 * POR QUÉ EL PASO 4 ES UNA SOLA LLAMADA
 *
 * Porque `supabase-js` manda una sentencia por viaje: cinco escrituras serían
 * cinco transacciones, y una caída en el medio dejaría un cliente a medio crear
 * cuya clave todavía no está reclamada — así que el siguiente reintento se ve a
 * sí mismo como el primero y lo crea de nuevo. La función de la `0019` existe
 * para eso y por eso acá no hay lógica de escritura.
 *
 * QUÉ DEVUELVE, Y POR QUÉ IMPORTA CUÁL
 *
 * El productor no reintenta —`deliverOne()` registra y sigue— pero el código de
 * estado igual decide qué queda escrito de su lado, y un 500 sobre algo que no se
 * va a arreglar solo es ruido que tapa los 500 que sí importan:
 *
 *   200  entrada nueva, o repetida. Las dos son éxito: «ya estaba» es la promesa
 *        cumpliéndose, no un problema;
 *   401  la firma no verifica, o falta el secreto de este lado;
 *   422  firmado y mal formado. Es un bug del productor y reintentarlo da igual;
 *   500  la base falló. Eso sí puede andar la próxima.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  const firma = verifySignature(
    raw,
    request.headers.get("x-vulkan-signature"),
    process.env.GROWTH_OS_WEBHOOK_SECRET
  );
  if (!firma.ok) {
    // El motivo NO viaja en la respuesta. Decirle a quien prueba si le falló el
    // formato, la firma o si a este lado le falta el secreto es entregarle el
    // mapa. Queda en el log del servidor, que es donde hace falta.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[lead-won] firma rechazada:", firma.reason);
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 422 });
  }

  const parsed = parseLeadWon(cuerpo);
  if (!parsed.ok) {
    // Acá sí se nombra el campo: la firma ya verificó, así que quien lee esto es
    // el productor y lo que necesita es saber qué arreglar.
    return NextResponse.json({ error: "invalid payload", field: parsed.campo }, { status: 422 });
  }

  const p = parsed.value;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("ingest_lead_won", {
    p_source_system: p.sourceSystem,
    p_idempotency_key: p.idempotencyKey,
    p_org_id: p.orgId,
    p_org_name: p.orgName,
    p_org_slug: p.orgSlug,
    p_org_locale: p.orgLocale,
    p_business_name: p.businessName,
    p_business_slug: p.businessSlug,
    p_business_website: p.businessWebsite,
    p_business_industry: p.businessIndustry,
    p_location: p.location,
    p_contact: p.contact,
  });

  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[lead-won] la ingesta falló:", error.message);
    }
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }

  const resultado = (data ?? {}) as { organization_id?: string | null; duplicate?: boolean };

  // 200 en los dos casos, y `duplicate` dice cuál fue. Un 409 sería tentador y
  // sería peor: le diría al productor que algo salió mal cuando lo que pasó es
  // que la restricción funcionó.
  return NextResponse.json(
    {
      event: EVENTO,
      duplicate: resultado.duplicate === true,
      organization_id: resultado.organization_id ?? null,
    },
    { status: 200 }
  );
}
