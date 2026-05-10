import { NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/lib/integrations/googlePlaces";
const schema = z.object({ query: z.string().default("ansiktsbehandling danderyd") });
export async function POST(req: Request) {
  try { const body = schema.parse(await req.json()); return NextResponse.json(await searchPlaces(body.query)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 }); }
}
