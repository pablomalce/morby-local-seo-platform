import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ mode: "demo", title: "Weekly SEO Report", summary: "Mörby is improving semantic relevance for ansiktsbehandling danderyd." }); }
