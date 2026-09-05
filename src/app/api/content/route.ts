import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/types/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que la única manera de que exista un asset sea un INSERT a mano en la base.
 *
 * El #85 escribió cómo APROBAR uno, y al 2026-09-05 no había ninguna manera de
 * crear el que se iba a aprobar: `appendContentToDb` existe y no tiene
 * llamadores —el cuarto módulo sin invocar de este proyecto— y `/content` no
 * toca la base.
 *
 * NACE EN `draft`, SIEMPRE, Y NO SE ACEPTA UN ESTADO DE QUIEN LLAMA
 *
 * El CHECK de la `0015` rechazaría un `approved` sin sello, así que aceptar el
 * estado sólo cambiaría un 400 nuestro por un error de la base. Pero hay una
 * razón mejor: aprobar es un ACTO con autor y fecha, y su ruta ya existe. Un
 * asset que nace aprobado no tiene quién lo aprobó.
 *
 * LA ORGANIZACIÓN SALE DEL NEGOCIO, NUNCA DEL PEDIDO
 *
 * Mismo argumento que la ruta de ensayo: con una organización que mandara quien
 * llama, escribir sobre el negocio ajeno guardaría la fila en la organización
 * propia. Se lee el negocio COMO EL USUARIO, así que la RLS contesta la
 * membresía y un no-miembro recibe 404.
 */

/**
 * Los idiomas de la aplicación. La lista se escribe acá y la línea de abajo la
 * ata al tipo: agregar un idioma a `Locale` y no acá deja de compilar, en vez de
 * aceptar en silencio un valor que la interfaz no sabe mostrar.
 */
const IDIOMAS = ["en", "es", "sv"] as const;
const _idiomasCubrenLocale: readonly Locale[] = IDIOMAS;
void _idiomasCubrenLocale;

const schema = z.object({
  businessId: z.string().uuid(),
  // `kind` es texto libre EN EL ESQUEMA — no hay CHECK sobre esa columna. Poner
  // una lista cerrada acá sería una restricción que la base no tiene, y el día
  // que alguien inserte otro tipo por SQL la pantalla no sabría mostrarlo.
  kind: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1),
  title: z.string().trim().max(200).optional(),
  targetKeyword: z.string().trim().max(200).optional(),
  locale: z.enum(IDIOMAS).default("en"),
});

export async function POST(req: Request) {
  const limitado = rateLimit(req, { limit: 30, windowMs: 60_000, key: "content-create" });
  if (limitado) return limitado;

  try {
    const entrada = schema.parse(await req.json().catch(() => ({})));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

    const { data: negocio, error: errorLectura } = await supabase
      .from("businesses")
      .select("id, organization_id")
      .eq("id", entrada.businessId)
      .maybeSingle();

    if (errorLectura) return NextResponse.json({ error: "business unreadable" }, { status: 502 });
    if (!negocio) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("content_assets")
      .insert({
        organization_id: negocio.organization_id,
        business_id: negocio.id,
        locale: entrada.locale,
        kind: entrada.kind,
        title: entrada.title ?? null,
        body: entrada.body,
        target_keyword: entrada.targetKeyword ?? null,
        status: "draft",
      })
      .select("id, status")
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, motivo: "no-se-pudo-escribir" }, { status: 502 });
    // Sin error y sin fila es la RLS negando el INSERT. Decir «creado» acá
    // dejaría a la pantalla mostrando un asset que no existe.
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

    return NextResponse.json({ ok: true, assetId: data.id, estado: data.status }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
