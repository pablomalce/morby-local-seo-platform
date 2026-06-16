import { NextResponse } from "next/server";
import { z } from "zod";
import { generateReport } from "@/lib/reports/orchestrator";
import { businesses } from "@/lib/mock/universal";

const schema = z.object({
  businessId: z.string().optional(),
});

/**
 * Generate a structured executive report for a tenant.
 * Always runs the deterministic heuristic engine. Hydrates with Google Places data
 * when GOOGLE_PLACES_API_KEY is configured.
 */
export async function POST(req: Request) {
  try {
    const body = req.body ? schema.parse(await req.json().catch(() => ({}))) : { businessId: undefined };
    const businessId = body.businessId ?? businesses[0].id;
    const report = await generateReport({ businessId });
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
