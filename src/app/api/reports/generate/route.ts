import { NextResponse } from "next/server";
import { z } from "zod";
import { generateReport } from "@/lib/reports/orchestrator";
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
 */
export async function POST(req: Request) {
  try {
    const body = req.body ? schema.parse(await req.json().catch(() => ({}))) : { businessId: undefined, clientSnapshot: undefined };
    const businessId = body.businessId ?? businesses[0].id;
    const report = await generateReport({ businessId, clientSnapshot: body.clientSnapshot as any });
    if (!report) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
