import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/agents/orchestrator";

const schema = z.object({ agentId: z.string() });
export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    return NextResponse.json(await runAgent(body.agentId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}
