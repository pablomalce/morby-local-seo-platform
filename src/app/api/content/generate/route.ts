import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSeoContent } from "@/lib/integrations/openai";

const schema = z.object({
  topic: z.string().min(1),
  businessId: z.string().optional(),
  serviceId: z.string().optional(),
  locale: z.enum(["en", "es", "sv"]).optional(),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    return NextResponse.json(await generateSeoContent(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
