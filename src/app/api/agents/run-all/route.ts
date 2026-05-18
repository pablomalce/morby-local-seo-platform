import { NextResponse } from "next/server";
import { z } from "zod";
import { runAllAgents } from "@/lib/agents/registry";

const schema = z.object({
  scope: z.enum(["platform", "organization", "business", "location", "service", "campaign"]).default("business"),
  scopeId: z.string(),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    return NextResponse.json(runAllAgents(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
