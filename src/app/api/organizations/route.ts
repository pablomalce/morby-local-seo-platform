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
 * Que dar de alta un cliente siga siendo imposible desde la aplicación.
 *
 * La `0024` puso la capacidad en la base —`authenticated` no puede insertar en
 * `organizations` de ninguna manera, medido sobre `pg_policies`— y una función
 * que nadie llama es el defecto que este proyecto ya se comió cinco veces.
 *
 * DOS ESCRITURAS, Y LA SEGUNDA PUEDE FALLAR SIN DESHACER LA PRIMERA
 *
 * La organización y su membresía son atómicas: eso lo garantiza la función. El
 * NEGOCIO es una escritura aparte, y se dice acá en vez de esconderse: si falla,
 * queda una organización vacía y ALCANZABLE —quien la creó es su owner— así que
 * se puede reintentar el negocio o borrarla. Es un estado incómodo, no uno
 * perdido, que es la diferencia con la organización huérfana que la `0024`
 * existe para impedir.
 *
 * Por eso el id de la organización viaja en la respuesta AUNQUE el negocio falle,
 * con su motivo: decir «no se pudo» sobre una organización que SÍ se creó
 * mandaría a crearla de nuevo, y la segunda tendría slug `cliente-1`.
 *
 * LO QUE SE PIDE AL DAR DE ALTA NO ES BUROCRACIA
 *
 * `industry`, `website` y `valueProposition` son el insumo del análisis
 * estratégico: sin ellos el reporte compara contra nada. Se piden acá, una vez,
 * en lugar de descubrir que faltan cuando alguien pide el primer reporte.
 */

const IDIOMAS = ["en", "es", "sv"] as const;
const _idiomasCubrenLocale: readonly Locale[] = IDIOMAS;
void _idiomasCubrenLocale;

const schema = z.object({
  /** El nombre del cliente. Es lo único imprescindible: de acá sale el slug. */
  name: z.string().trim().min(1).max(200),
  /** El sitio, que es contra lo que corren PageSpeed y el análisis. */
  website: z.string().trim().max(500).optional(),
  industry: z.string().trim().max(100).optional(),
  valueProposition: z.string().trim().max(2000).optional(),
  brandTone: z.string().trim().max(500).optional(),
  locale: z.enum(IDIOMAS).default("en"),
});

export async function POST(req: Request) {
  // Crear organizaciones es barato para la base y caro para el orden: 20 por
  // minuto alcanza para una agencia dando de alta clientes y no para un bucle.
  const limitado = rateLimit(req, { limit: 20, windowMs: 60_000, key: "organizations-create" });
  if (limitado) return limitado;

  try {
    const entrada = schema.parse(await req.json().catch(() => ({})));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

    // La función decide el slug y crea la membresía owner de QUIEN LLAMA. No se
    // le manda ningún usuario: esta ruta no puede dar de alta a nombre de otro
    // porque la función no acepta a quién.
    const { data: organizationId, error } = await supabase.rpc("create_client_organization", {
      p_name: entrada.name,
    });

    if (error || !organizationId) {
      return NextResponse.json(
        { ok: false, motivo: "no-se-pudo-crear-la-organizacion" },
        { status: 502 }
      );
    }

    const { data: negocio, error: errorNegocio } = await supabase
      .from("businesses")
      .insert({
        organization_id: organizationId as string,
        name: entrada.name,
        website: entrada.website ?? "",
        industry: entrada.industry ?? "other",
        brand_tone: entrada.brandTone ?? "",
        primary_locale: entrada.locale,
        value_proposition: entrada.valueProposition ?? "",
      })
      .select("id")
      .maybeSingle();

    if (errorNegocio || !negocio) {
      // La organización EXISTE y es alcanzable. Ver el encabezado: se dice, con
      // su id, para que quien reintente no cree una segunda.
      return NextResponse.json(
        { ok: false, motivo: "organizacion-creada-sin-negocio", organizationId },
        { status: 207 }
      );
    }

    return NextResponse.json(
      { ok: true, organizationId, businessId: negocio.id },
      { status: 201 }
    );
  } catch (error) {
    return apiError(error);
  }
}
