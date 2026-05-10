import { NextResponse } from "next/server";
import { business, gbpChecklist } from "@/lib/mock/data";
export async function GET() { return NextResponse.json({ mode: "demo", business, score: 72, checklist: gbpChecklist }); }
