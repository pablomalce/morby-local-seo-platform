import { NextResponse } from "next/server";
import { runAllAgents } from "@/lib/agents/orchestrator";
export async function POST() { return NextResponse.json(await runAllAgents()); }
