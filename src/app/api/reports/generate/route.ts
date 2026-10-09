import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { quienLlama, type ClienteDeServidor } from "@/lib/api/sesion";
import { permisoEn } from "@/lib/org/rol";
import { z } from "zod";
import { generateReport } from "@/lib/reports/orchestrator";
import type { ClientSnapshotInput } from "@/lib/reports/orchestrator";
import { businesses } from "@/lib/mock/universal";

// PageSpeed Insights can take 15–40s for slow sites; give the serverless function
// enough budget so the lookup isn't killed before its own 45s timeout. Vercel Hobby caps this at 60s.
export const maxDuration = 60;

// Como las otras siete rutas que leen la sesión: la cookie se lee en cada
// petición, así que esto no se cachea ni corre en el edge.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const businessSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  website: z.string().optional().default(""),
  industry: z.string(),
  brandTone: z.string().optional().default(""),
  primaryLocale: z.enum(["en", "es", "sv"]),
  valueProposition: z.string().optional().default(""),
  logoColor: z.string().optional().default("#EF4C24"),
  createdAt: z.string().optional().default(() => new Date().toISOString()),
});

const locationSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  label: z.string(),
  addressLine: z.string().optional().default(""),
  city: z.string().optional().default(""),
  region: z.string().optional().default(""),
  country: z.string().optional().default(""),
  primaryGeoQuery: z.string().optional().default(""),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isPrimary: z.boolean().optional().default(true),
});

const serviceSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().optional().default(""),
  primaryKeyword: z.string().optional().default(""),
  supportingKeywords: z.array(z.string()).optional().default([]),
  isFeatured: z.boolean().optional().default(false),
});

const schema = z.object({
  businessId: z.string().optional(),
  clientSnapshot: z
    .object({
      business: businessSchema,
      locations: z.array(locationSchema).default([]),
      services: z.array(serviceSchema).default([]),
      content: z.array(z.any()).optional(),
      competitors: z.array(z.any()).optional(),
      reviews: z.array(z.any()).optional(),
    })
    .optional(),
});

/**
 * Generate a structured executive report for a tenant.
 * Always runs the deterministic heuristic engine. Hydrates with Google Places data
 * when GOOGLE_PLACES_API_KEY is configured.
 *
 * QUÉ CIERRA ESTE GUARDIA (H0.8, decidido por Pablo el 2026-09-19: "cerrala")
 *
 * Hasta hoy esta ruta era la única de la aplicación sin ninguna línea de
 * identidad, y la única que además sale a la red: cada llamada anónima gastaba
 * Places y dos PageSpeed. El rate limit por IP la frenaba a diez por minuto,
 * que es un tope para humanos y no para un bucle. La página que la llama ya
 * no vive en `/reports` (fuera del middleware) sino en `/app/reports`, donde
 * el middleware exige sesión; y la ruta exige la suya propia acá, ANTES del
 * rate limit y de zod, para que un llamador sin sesión nunca llegue al
 * trabajo. El `getUser()` del orquestador sigue decidiendo la FUENTE de datos
 * (Supabase con sesión, semilla sin ella); éste decide si hay permiso, que es
 * otra pregunta. El barrido (`precondicionRutas.test.ts`) mide las dos cosas:
 * 401 sin sesión y cero fetch.
 *
 * Y EL ROL, ANTES DEL ORQUESTADOR (puerta H4.1, D3; crítico del 2026-10-08)
 *
 * Generar un reporte de un negocio de la base GUARDA una fila en `reports`, y
 * guardar es escribir: owner, admin, manager o editor (D3). La base ya le
 * rechaza ese INSERT a un `viewer` o a un `client` (0031), pero el INSERT es lo
 * ÚLTIMO que hace el orquestador. Medido sobre la réplica con PostgREST real:
 * antes de esa negativa, un client de X disparaba con `service_role` un upsert
 * en `integration_probe` —superficie INTERNA según D2, que ni puede leer—, otro
 * en `pagespeed_cache`, y el refresco del token de la AGENCIA (POST a
 * oauth2.googleapis.com y `refresh_integration_token`); un viewer, además,
 * consultaba Search Console y GA4 con ese token. Después, un 400. O sea que «el
 * client no escribe nada» valía por PostgREST y no por esta ruta.
 *
 * Por eso el rol se pregunta ACÁ, con la organización del negocio leída como el
 * usuario, y la negativa es un 403 sin tocar el orquestador: cero salidas a la
 * red, cero escrituras con `service_role`. Lo que NO se pregunta: un negocio de
 * la semilla o uno que la sesión no alcanza —el reporte de demostración y el de
 * `clientSnapshot`— no tienen organización, y el orquestador no escribe nada con
 * ellos (`authenticated: false`). Siguen gastando Places y PageSpeed para
 * cualquier sesión, como antes de esta puerta: eso es del rate limit, no del rol.
 */
export async function POST(req: Request) {
  // El guardia va fuera del try del trabajo, y no es decoración. En "modo
  // demo" —sin las envs de Supabase, un estado que el middleware documenta y
  // soporta— `createSupabaseServerClient()` TIRA, y dentro de ese try un
  // anónimo recibía lo que contestara el catch: exactamente lo que el barrido
  // prohíbe ("un 500 sin sesión significa una de dos cosas, y las dos son el
  // defecto"). Esta ruta lo resolvió primero con un try propio; desde el
  // 2026-10-07 ese try vive en `quienLlama` (`src/lib/api/sesion.ts`) y lo usa
  // cada ruta con sesión: falla CERRADO, sin proveedor es nadie, y nadie es un
  // 401.
  const sesion = await quienLlama();
  if (!sesion) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Still rate-limited per IP: a report takes 20–40s and costs two PageSpeed
  // calls, so 10/min is generous for a person and a brake for a loop.
  const limited = rateLimit(req, { limit: 10, windowMs: 60_000, key: "reports-generate" });
  if (limited) return limited;

  try {
    const body = req.body ? schema.parse(await req.json().catch(() => ({}))) : { businessId: undefined, clientSnapshot: undefined };
    const businessId = body.businessId ?? businesses[0].id;

    const negativa = await negativaDeRol(sesion.supabase, sesion.user.id, businessId);
    if (negativa) return negativa;

    const report = await generateReport({
      businessId,
      clientSnapshot: body.clientSnapshot as ClientSnapshotInput | undefined,
    });
    if (!report) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }
    return NextResponse.json(report);
  } catch (error) {
    return apiError(error);
  }
}

/** `businesses.id` es uuid: lo que no tiene esa forma no está en la base. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La respuesta de negativa, o `null` si el reporte puede seguir.
 *
 * Un fallo de lectura NO es «no lo alcanza»: con el negocio ilegible no se sabe
 * de qué organización es, y seguir dejaría al orquestador escribir sin que nadie
 * haya preguntado el rol. 502, como las otras rutas.
 */
async function negativaDeRol(
  supabase: ClienteDeServidor,
  userId: string,
  businessId: string
): Promise<NextResponse | null> {
  // Ids de la semilla (`biz-morby`) y de negocios locales: no hay fila, no hay
  // organización, y el orquestador no escribe nada. Preguntarle a PostgREST por
  // ellos daría un 22P02 que no es un fallo de nada.
  if (!UUID.test(businessId)) return null;

  const { data: negocio, error } = await supabase
    .from("businesses")
    .select("organization_id")
    .eq("id", businessId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "business unreadable" }, { status: 502 });
  // La sesión no lo alcanza: el orquestador tampoco, y cae a la semilla o al
  // `clientSnapshot`, sin organización y sin escribir.
  if (!negocio) return null;

  const permiso = await permisoEn(supabase, userId, negocio.organization_id as string, "escribir");
  if (permiso.ok) return null;
  if (permiso.motivo === "ilegible") {
    return NextResponse.json({ error: "membership unreadable" }, { status: 502 });
  }
  return NextResponse.json({ ok: false, motivo: "sin-permiso" }, { status: 403 });
}
