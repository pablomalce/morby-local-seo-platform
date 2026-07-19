import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { z } from "zod";
import { searchPlaces } from "@/lib/integrations/googlePlaces";

const schema = z.object({
  query: z.string().min(1),
  businessId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    return NextResponse.json(await searchPlaces(body.query, body.businessId));
  } catch (error) {
    return apiError(error);
  }
}
