import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSeoContent } from "@/lib/integrations/openai";
const schema = z.object({ topic: z.string().default("ansiktsbehandling danderyd") });
export async function POST(req: Request) {
  try { const body = schema.parse(await req.json()); return NextResponse.json(await generateSeoContent(body.topic)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 }); }
}
