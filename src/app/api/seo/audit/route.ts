import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ mode: "demo", score: 76, findings: ["Add stronger H1 around ansiktsbehandling", "Add FAQ schema", "Improve internal links from fotvård pages"] }); }
