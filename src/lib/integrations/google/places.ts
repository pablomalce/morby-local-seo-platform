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

export async function lookupPlace(input: PlacesLookupInput): Promise<PlacesLookup> {
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
      body: JSON.stringify({
        textQuery: input.query,
        maxResultCount: 1,
      }),
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
    const place = payload.places?.[0];
    if (!place) return { status: "no-match" };

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
  } catch (err) {
    return {
      status: "error",
      errorMessage: err instanceof Error ? err.message : "Unknown Places error",
    };
  }
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
