import { competitors } from "@/lib/mock/data";

export async function searchPlaces(query: string) {
  if (!process.env.GOOGLE_PLACES_API_KEY || process.env.NEXT_PUBLIC_APP_MODE !== "live") {
    return { mode: "demo", query, places: competitors };
  }
  // Phase 2: implement Google Places API New text search here.
  return { mode: "live-placeholder", query, places: competitors };
}
