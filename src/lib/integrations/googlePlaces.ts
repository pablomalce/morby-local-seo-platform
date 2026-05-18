import { businesses, competitors as allCompetitors } from "@/lib/mock/universal";

/**
 * Google Places — provider-abstracted search.
 *
 * Phase 1: returns competitor data scoped to the supplied businessId from the universal demo
 * dataset. Phase 4 will swap the demo branch for the real Places API New text search endpoint,
 * preserving the response shape so callers don't change.
 */
export async function searchPlaces(query: string, businessId?: string) {
  const scopedCompetitors = (businessId
    ? allCompetitors.filter((c) => c.businessId === businessId)
    : allCompetitors.filter((c) => c.businessId === businesses[0].id));

  if (!process.env.GOOGLE_PLACES_API_KEY || process.env.NEXT_PUBLIC_APP_MODE !== "live") {
    return { mode: "demo", query, places: scopedCompetitors };
  }
  // Phase 4: implement Google Places API New text search here.
  return { mode: "live-placeholder", query, places: scopedCompetitors };
}
