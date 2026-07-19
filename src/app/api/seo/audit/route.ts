import { NextResponse } from "next/server";
import { requireInternalSecret } from "@/lib/api/internal-guard";

export async function POST(req: Request) {
  const gate = requireInternalSecret(req);
  if (gate) return gate;
  return NextResponse.json({
    mode: "demo",
    score: 76,
    findings: [
      "Add stronger H1 around ansiktsbehandling",
      "Add FAQ schema",
      "Improve internal links from fotvård pages",
    ],
  });
}
