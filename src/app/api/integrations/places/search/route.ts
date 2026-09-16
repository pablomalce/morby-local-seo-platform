import { requireInternalSecret } from "@/lib/api/internal-guard";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { z } from "zod";
import { searchPlaces } from "@/lib/integrations/google/places";

const schema = z.object({
  query: z.string().min(1),
});

/**
 * Text search against Google Places — the REAL one.
 *
 * Until 2026-09-16 this route imported `@/lib/integrations/googlePlaces`,
 * which returned competitors from the demo dataset and kept doing so with the
 * key set. Gate H2-GO-0: with the key withdrawn, this route has to answer an
 * ERROR, not data. So `missing-key` is a 503 and a provider failure is a 502;
 * neither carries rows, because rows that are not from Google are the thing an
 * audit must never be built on.
 */
export async function POST(req: Request) {
  const gate = requireInternalSecret(req);
  if (gate) return gate;

  try {
    const body = schema.parse(await req.json());
    const resultado = await searchPlaces(body.query);
    if (resultado.status === "missing-key") {
      return NextResponse.json({ error: "places-sin-clave" }, { status: 503 });
    }
    if (resultado.status === "error") {
      return NextResponse.json(
        { error: "places-fallo", detail: resultado.errorMessage },
        { status: 502 }
      );
    }
    return NextResponse.json({ mode: "live", query: body.query, places: resultado.places });
  } catch (error) {
    return apiError(error);
  }
}
