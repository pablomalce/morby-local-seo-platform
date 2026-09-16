/**
 * Google Places API (New) — server-only client.
 *
 * Single platform-wide key (`GOOGLE_PLACES_API_KEY`). Charges per-request to your Google Cloud
 * project regardless of tenant. We use this to hydrate a business with REAL rating, review
 * count, photos and place ID — no per-tenant OAuth required.
 *
 * If the key is missing we return null and the calling code falls back to demo / synthetic
 * data. Never throws — Places is a nice-to-have, not a hard dependency.
 */

import "server-only";

export interface PlacesLookupInput {
  /** Business name as it appears on Google (or close to it). */
  name: string;
  /** Anchor query — usually "{name} {city}". */
  query: string;
}

export interface PlacesLookup {
  status: "live" | "missing-key" | "no-match" | "error";
  /** Provider place ID — useful to deep-link, persist, or call other Places APIs. */
  placeId?: string;
  /** Verified business display name as returned by Google. */
  displayName?: string;
  /** Formatted address. */
  formattedAddress?: string;
  /** Aggregate rating 0-5. */
  rating?: number;
  /** Total review count across the listing. */
  userRatingCount?: number;
  /** Categories Google assigned to the business. */
  types?: string[];
  /** Latitude / longitude (helpful for map snapshots later). */
  location?: { lat: number; lng: number };
  /** Business website if Google has it. */
  website?: string;
  /** Whether the business is currently open. */
  openNow?: boolean;
  /** Error message (only when status === "error"). */
  errorMessage?: string;
}

const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "rating",
  "userRatingCount",
  "types",
  "location",
  "websiteUri",
  "currentOpeningHours.openNow",
].join(",");

/**
 * The one call to the Places endpoint, shared by the single lookup and the
 * list search below.
 *
 * WHY THERE IS ONE PATH AND NOT TWO
 *
 * Until 2026-09-16 this repository had two Places clients. This one, which
 * calls Google, was wired to the report orchestrator. The other one,
 * `src/lib/integrations/googlePlaces.ts`, was wired to the only Places ROUTE
 * of the application — and returned rows from the demo dataset, and kept
 * returning them with the key set. Gate H2-GO-0 of the spine says it plainly:
 * auditing with a client that returns mock data is worse than not auditing.
 * The route now comes through here, the other file is gone, and a test fails
 * if anything imports it again.
 */
async function buscarEnPlaces(
  textQuery: string,
  maxResultCount: number
): Promise<
  | { status: "missing-key" }
  | { status: "error"; errorMessage: string }
  | { status: "live"; places: GooglePlacesResult[] }
> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { status: "missing-key" };

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": `places.${FIELD_MASK.split(",").join(",places.")}`,
      },
      body: JSON.stringify({ textQuery, maxResultCount }),
      // Aggressive cache — Place details rarely change in a day.
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return {
        status: "error",
        errorMessage: `Places search failed: HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as { places?: GooglePlacesResult[] };
    return { status: "live", places: payload.places ?? [] };
  } catch (err) {
    return {
      status: "error",
      errorMessage: err instanceof Error ? err.message : "Unknown Places error",
    };
  }
}

function aLookup(place: GooglePlacesResult): PlacesLookup {
  return {
    status: "live",
    placeId: place.id,
    displayName: place.displayName?.text,
    formattedAddress: place.formattedAddress,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    types: place.types,
    location:
      place.location?.latitude !== undefined && place.location?.longitude !== undefined
        ? { lat: place.location.latitude, lng: place.location.longitude }
        : undefined,
    website: place.websiteUri,
    openNow: place.currentOpeningHours?.openNow,
  };
}

export async function lookupPlace(input: PlacesLookupInput): Promise<PlacesLookup> {
  const resultado = await buscarEnPlaces(input.query, 1);
  if (resultado.status !== "live") return resultado;
  const place = resultado.places[0];
  if (!place) return { status: "no-match" };
  return aLookup(place);
}

export interface PlacesSearch {
  /** `missing-key` and `error` carry no places on purpose: no data is not demo data. */
  status: "live" | "missing-key" | "error";
  places: PlacesLookup[];
  errorMessage?: string;
}

/**
 * Text search returning several places. Same endpoint, same key, same
 * failure modes as `lookupPlace` — and, deliberately, no fallback: without a
 * key the answer is `missing-key` with an empty list, never rows that look
 * like businesses.
 */
export async function searchPlaces(query: string, maxResultCount = 5): Promise<PlacesSearch> {
  const resultado = await buscarEnPlaces(query, maxResultCount);
  if (resultado.status === "missing-key") return { status: "missing-key", places: [] };
  if (resultado.status === "error") {
    return { status: "error", places: [], errorMessage: resultado.errorMessage };
  }
  return { status: "live", places: resultado.places.map(aLookup) };
}

interface GooglePlacesResult {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  location?: { latitude: number; longitude: number };
  websiteUri?: string;
  currentOpeningHours?: { openNow?: boolean };
}
