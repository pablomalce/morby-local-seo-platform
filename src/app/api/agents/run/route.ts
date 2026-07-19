import { requireInternalSecret } from "@/lib/api/internal-guard";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { z } from "zod";
import { runAgent } from "@/lib/agents/registry";

const schema = z.object({
  agentId: z.string(),
  scope: z.enum(["platform", "organization", "business", "location", "service", "campaign"]).default("business"),
  scopeId: z.string(),
  payload: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  const gate = requireInternalSecret(req);
  if (gate) return gate;

  try {
    const body = schema.parse(await req.json());
    return NextResponse.json(runAgent(body));
  } catch (error) {
    return apiError(error);
  }
}
