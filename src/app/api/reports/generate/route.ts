import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";
import { generateReport } from "@/lib/reports/orchestrator";
import type { ClientSnapshotInput } from "@/lib/reports/orchestrator";
import { businesses } from "@/lib/mock/universal";

// PageSpeed Insights can take 15–40s for slow sites; give the serverless function
// enough budget so the lookup isn't killed before its own 45s timeout. Vercel Hobby caps this at 60s.
export const maxDuration = 60;

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
 */
export async function POST(req: Request) {
  // El guardia lleva su propio try, y no es decoración. En "modo demo" —sin
  // las envs de Supabase, un estado que el middleware documenta y soporta—
  // `createSupabaseServerClient()` las pasa como `undefined!` y `getUser()`
  // TIRA. Sin este catch, un anónimo recibía un 500: exactamente lo que el
  // barrido prohíbe ("un 500 sin sesión significa una de dos cosas, y las dos
  // son el defecto"), y encima escondiendo la razón.
  //
  // Falla CERRADO, como `requireInternalSecret` cuando le falta el secreto: si
  // no hay proveedor de identidad no hay nadie autenticado, y eso es un 401.
  let user: { id: string } | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Still rate-limited per IP: a report takes 20–40s and costs two PageSpeed
  // calls, so 10/min is generous for a person and a brake for a loop.
  const limited = rateLimit(req, { limit: 10, windowMs: 60_000, key: "reports-generate" });
  if (limited) return limited;

  try {
    const body = req.body ? schema.parse(await req.json().catch(() => ({}))) : { businessId: undefined, clientSnapshot: undefined };
    const businessId = body.businessId ?? businesses[0].id;
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
