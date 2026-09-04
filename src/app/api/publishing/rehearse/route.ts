import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicar, type Destino } from "@/lib/publishing/transport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que `publicar()` siga siendo un módulo que nadie llama.
 *
 * El transporte entró en `main` con la #74, con sus 19 tests, y al 2026-09-04
 * **nada en `src/` lo invocaba**. Es exactamente el defecto que este proyecto ya
 * se comió una vez —*un módulo con treinta y un tests al que nadie llamaba*— y
 * por eso `route.test.ts` afirma sobre el CABLEADO: con QUÉ se llamó, en qué
 * modo, y sobre todo CUÁNDO NO se llamó. Un test que sólo probara `transport.ts`
 * seguiría en verde con este archivo entero borrado.
 *
 * ES SÓLO EL ENSAYO, Y ESO ES UNA DECISIÓN
 *
 * El modo va escrito acá como literal, `"dry-run"`, y no llega en el cuerpo del
 * pedido. **Un modo elegido por quien no es el que llama no es un modo, es un
 * accidente**, y la variante en vivo no es esta ruta con un campo más: necesita
 * un publicador —que hoy no existe, porque no hay cuota de Business Profile— y
 * necesita decidir quién puede mandar algo a la ficha de un cliente. Cuando eso
 * exista tendrá su propia ruta y su propia decisión, y este archivo seguirá
 * ensayando.
 *
 * DE DÓNDE SALE EL `approvedHash`, QUE ES LA PREGUNTA QUE EL MÓDULO DEJÓ ABIERTA
 *
 * De `content_assets`, leído acá, en la misma operación en que se decide
 * publicar. No lo manda el cliente: si lo mandara, mandar el hash de ayer sería
 * publicar el texto de ayer.
 *
 * Y la lectura es **como el usuario**, con el cliente de sesión y no con el
 * admin — el mismo argumento de `agencyGuard.ts` y de `property-actions.ts`: la
 * pregunta es «¿qué alcanza ESTE usuario?», y hacerla con una llave que lo
 * alcanza todo la contesta siempre que sí. La RLS de la `0014` le esconde la
 * fila a quien no es miembro, así que un no-miembro recibe exactamente lo mismo
 * que quien pide un id inventado: 404. No hay una comprobación de membresía
 * escrita acá, y es a propósito — sería una COPIA de la RLS, y una copia diverge.
 *
 * LO ÚNICO QUE ESTA RUTA MIRA DEL ASSET, Y POR QUÉ NO ES UNA COPIA
 *
 * Que `approved_hash` no sea NULL. No está validando la aprobación —eso lo
 * garantiza la FK compuesta de la `0016` contra `(id, approved_hash)`, y el caso
 * peligroso es el hash VIEJO, que sólo la base puede rechazar—. Es que sin hash
 * no hay entrada que construir: `EntradaPublicacion.approvedHash` es un `string`,
 * y la columna del ledger es `NOT NULL`. Mandarlo igual daría `23502`, que el
 * transporte lee como `ledger-ilegible` — un motivo que no es el verdadero.
 */

/** El único destino, igual que el CHECK de la `0016` y que `Destino`. */
const DESTINO: Destino = "google_business_profile";

const schema = z.object({
  assetId: z.string().uuid(),
});

export async function POST(req: Request) {
  // Escribe en el ledger —reserva una fila— aunque no publique. 20/min por IP.
  const limitado = rateLimit(req, { limit: 20, windowMs: 60_000, key: "publishing-rehearse" });
  if (limitado) return limitado;

  try {
    const { assetId } = schema.parse(await req.json().catch(() => ({})));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

    const { data: asset, error } = await supabase
      .from("content_assets")
      .select("id, organization_id, approved_hash")
      .eq("id", assetId)
      .maybeSingle();

    // Un fallo de lectura NO es un asset ausente, y tampoco es permiso para
    // seguir: sin la fila no hay `organization_id` ni hash que mandar.
    if (error) return NextResponse.json({ error: "asset unreadable" }, { status: 502 });
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (!asset.approved_hash) {
      return NextResponse.json({ ok: false, motivo: "no-aprobado" }, { status: 409 });
    }

    const resultado = await publicar(
      {
        // Del ASSET, nunca del cuerpo del pedido: con una organización que
        // mandara quien llama, reservar sobre el asset ajeno sería escribir la
        // fila en la organización propia.
        organizationId: asset.organization_id,
        assetId: asset.id,
        approvedHash: asset.approved_hash,
        destino: DESTINO,
      },
      "dry-run"
      // Sin publicador, y no por olvido: en `dry-run` el transporte no lo toca.
    );

    if (resultado.ok) {
      return NextResponse.json(resultado, { status: 200 });
    }

    // Cada motivo con su código, y ninguno con 200. Un ensayo que fallara
    // contestando «bien» es la versión de este frente del cero inventado.
    const codigo =
      resultado.motivo === "no-aprobado" ? 409
      : resultado.motivo === "ledger-ilegible" ? 502
      : 500;
    return NextResponse.json(resultado, { status: codigo });
  } catch (error) {
    return apiError(error);
  }
}
