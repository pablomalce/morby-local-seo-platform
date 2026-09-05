import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que aprobar contenido no exista.
 *
 * La `0015` puso la garantía —un asset sólo puede estar en `approved`,
 * `scheduled` o `published` si `approved_hash = payload_hash`— y el #74 y el #76
 * escribieron el camino de publicar. Al 2026-09-05, medido sobre `src/` entero:
 * **nada escribía `approved_hash`, `approved_by` ni `approved_at`**. Las únicas
 * menciones eran lecturas. O sea que el transporte, su ruta de ensayo y la
 * pantalla del ledger estaban esperando un estado al que no se podía llegar, y
 * `content_assets` en hosted seguía en 0 no por falta de una decisión sino por
 * falta de este archivo.
 *
 * EL HASH SALE DE LA FILA, Y NO SE CALCULA ACÁ
 *
 * Se lee `payload_hash`, que es una columna GENERADA por
 * `content_payload_hash()`. Recalcularlo en TypeScript sería una COPIA de esa
 * función, y el encabezado de la `0015` ya dice por qué no: un hash que la
 * aplicación tiene que acordarse de recalcular es un hash que un día no se
 * recalcula, y entonces aprueba contenido que ya no es el que se aprobó.
 *
 * Y NO LO MANDA QUIEN LLAMA, por el mismo motivo que el `approvedHash` del
 * transporte no se lee dentro de él: un hash que viaja desde el cliente es un
 * hash que se puede elegir.
 *
 * LA CARRERA LA RESUELVE LA BASE, NO ESTA RUTA
 *
 * Entre leer el hash y escribirlo, alguien puede editar el cuerpo. Si pasa, el
 * CHECK `content_assets_approval_check` rechaza la escritura porque
 * `approved_hash` ya no coincide con el `payload_hash` nuevo. No hay un `SELECT`
 * de confirmación acá a propósito: sería una copia de lo que la restricción ya
 * garantiza, y una copia diverge.
 *
 * SE LEE Y SE ESCRIBE COMO EL USUARIO
 *
 * `authenticated` ya tiene `SELECT` y `UPDATE` sobre `content_assets`, y la RLS
 * decide qué filas alcanza cada quien. Un no-miembro recibe lo mismo que quien
 * pide un id inventado: 404, y ninguna fila tocada.
 */

const schema = z.object({
  assetId: z.string().uuid(),
});

/** `check_violation`: el payload cambió entre la lectura y la escritura. */
const CHECK_VIOLADO = "23514";

export async function POST(req: Request) {
  const limitado = rateLimit(req, { limit: 30, windowMs: 60_000, key: "content-approve" });
  if (limitado) return limitado;

  try {
    const { assetId } = schema.parse(await req.json().catch(() => ({})));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

    const { data: asset, error: errorLectura } = await supabase
      .from("content_assets")
      .select("id, status, payload_hash")
      .eq("id", assetId)
      .maybeSingle();

    // Un fallo de lectura NO es un asset ausente, y tampoco es permiso para
    // escribir: sin la fila no hay hash que sellar.
    if (errorLectura) return NextResponse.json({ error: "asset unreadable" }, { status: 502 });
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Sin `payload_hash` no hay nada que sellar. La columna es generada y no
    // debería faltar nunca; si falta, aprobar a ciegas escribiría una aprobación
    // que no describe ningún texto.
    if (!asset.payload_hash) {
      return NextResponse.json({ ok: false, motivo: "sin-huella" }, { status: 502 });
    }

    const { data: actualizado, error } = await supabase
      .from("content_assets")
      .update({
        status: "approved",
        approved_hash: asset.payload_hash,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", assetId)
      .select("id, status, approved_hash")
      .maybeSingle();

    if (error) {
      const codigo = (error as { code?: string }).code;
      if (codigo === CHECK_VIOLADO) {
        // El texto cambió mientras tanto. Lo dice la base, que es la única que
        // puede saberlo.
        return NextResponse.json({ ok: false, motivo: "el-texto-cambio" }, { status: 409 });
      }
      return NextResponse.json({ ok: false, motivo: "no-se-pudo-escribir" }, { status: 502 });
    }

    // Sin error y sin fila es la RLS: alcanzó a LEER y no a escribir. Decir
    // «aprobado» acá sería el peor caso de esta ruta.
    if (!actualizado) return NextResponse.json({ error: "not found" }, { status: 404 });

    return NextResponse.json({ ok: true, estado: "aprobado", assetId: actualizado.id }, { status: 200 });
  } catch (error) {
    return apiError(error);
  }
}
