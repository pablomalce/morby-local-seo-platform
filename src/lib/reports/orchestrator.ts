/**
 * Report orchestrator — server-side.
 *
 * Pipeline:
 *   1. Load the tenant snapshot (Supabase if authenticated, otherwise the universal seed
 *      dataset for demo mode).
 *   2. Hydrate with real data from connected integrations (Places API today; SC / GBP / GA4
 *      pending OAuth setup).
 *   3. Run the heuristic engine to produce the structured Report.
 *   4. Persist to Supabase `reports` table (when authenticated).
 *   5. Return the Report.
 *
 * This is the function the Reporting Agent calls, and what the API route uses.
 */

import "server-only";
import { buildBusinessSnapshot, businesses, locations, services } from "@/lib/mock/universal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { lookupPlace } from "@/lib/integrations/google/places";
import { lookupPageSpeed } from "@/lib/integrations/google/pagespeed";
import { buildReport } from "./engine";
import type { BusinessSnapshot } from "@/lib/mock/universal";
import type {
  Business,
  BusinessLocation,
  BusinessService,
  Competitor,
  ContentAsset,
  Review,
} from "@/lib/types/core";
import type { DataSourceHealth, Report } from "./types";

/**
 * Client-side snapshot passed from the browser when the tenant lives only in localStorage
 * (i.e. created via the onboarding wizard while not signed in). This lets demo users get
 * real reports without persisting to the DB.
 */
export interface ClientSnapshotInput {
  business: Business;
  locations: BusinessLocation[];
  services: BusinessService[];
  content?: ContentAsset[];
  competitors?: Competitor[];
  reviews?: Review[];
}

interface GenerateReportInput {
  /** Business ID (uuid for authenticated tenants, or one of the seed IDs in demo mode). */
  businessId: string;
  /** Optional snapshot from the client — used when the tenant isn't in DB nor seed. */
  clientSnapshot?: ClientSnapshotInput;
  /** Optional UI locale override — when set, the engine renders in this language regardless of business.primaryLocale. */
  locale?: "en" | "es" | "sv";
}

interface SnapshotResult {
  snapshot: BusinessSnapshot;
  /** True when the snapshot came from authenticated Supabase data. */
  authenticated: boolean;
}

async function loadSnapshot({ businessId, clientSnapshot }: GenerateReportInput): Promise<SnapshotResult | null> {
  // Try authenticated path first.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: biz } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", businessId)
      .single();
    if (biz) {
      const [locsResp, svcsResp, cmpResp, revResp, contentResp, plansResp] = await Promise.all([
        supabase.from("business_locations").select("*").eq("business_id", businessId),
        supabase.from("business_services").select("*").eq("business_id", businessId),
        supabase.from("competitors").select("*").eq("business_id", businessId),
        supabase.from("reviews").select("*").eq("business_id", businessId),
        supabase.from("content_assets").select("*").eq("business_id", businessId),
        supabase.from("platform_tasks").select("*").eq("business_id", businessId),
      ]);

      const business = {
        id: biz.id,
        organizationId: biz.organization_id,
        name: biz.name,
        website: biz.website,
        industry: biz.industry,
        brandTone: biz.brand_tone,
        primaryLocale: biz.primary_locale as "en" | "es" | "sv",
        valueProposition: biz.value_proposition,
        logoColor: biz.logo_color,
        createdAt: biz.created_at,
      };

      const snap = buildBusinessSnapshot(
        business,
        (locsResp.data ?? []).map(mapLocation),
        (svcsResp.data ?? []).map(mapService),
      );

      // Override the seed-derived collections with real DB data.
      snap.competitors = (cmpResp.data ?? []).map(mapCompetitor);
      snap.reviews = (revResp.data ?? []).map(mapReview);
      snap.content = (contentResp.data ?? []).map(mapContent);
      if ((plansResp.data ?? []).length > 0) {
        snap.plan = (plansResp.data ?? []).map(mapPlan);
      }

      return { snapshot: snap, authenticated: true };
    }
  }

  // Fall back to seed business (demo mode).
  const seed = businesses.find((b) => b.id === businessId);
  if (seed) {
    const locs = locations.filter((l) => l.businessId === seed.id);
    const svcs = services.filter((s) => s.businessId === seed.id);
    return { snapshot: buildBusinessSnapshot(seed, locs, svcs), authenticated: false };
  }

  // Final fallback: tenant lives only in the client's localStorage (created via onboarding
  // wizard while not signed in). Build the snapshot from the data the browser sent.
  if (clientSnapshot && clientSnapshot.business?.id === businessId) {
    const snap = buildBusinessSnapshot(
      clientSnapshot.business,
      clientSnapshot.locations ?? [],
      clientSnapshot.services ?? [],
    );
    if (clientSnapshot.content?.length) snap.content = clientSnapshot.content;
    if (clientSnapshot.competitors?.length) snap.competitors = clientSnapshot.competitors;
    if (clientSnapshot.reviews?.length) snap.reviews = clientSnapshot.reviews;
    return { snapshot: snap, authenticated: false };
  }

  return null;
}

/**
 * Hydrate the snapshot with real Google Places data when possible.
 * Returns the updated DataSourceHealth so the report shows provenance.
 */
async function hydrateWithPlaces(snap: BusinessSnapshot): Promise<DataSourceHealth["places"]> {
  if (!process.env.GOOGLE_PLACES_API_KEY) return "missing";

  const location = snap.locations.find((l) => l.isPrimary) ?? snap.locations[0];
  if (!location) return "missing";

  const query = `${snap.business.name} ${location.city ?? ""}`.trim();
  const lookup = await lookupPlace({ name: snap.business.name, query });

  if (lookup.status === "live") {
    // Mutate: overwrite review count + add a Google-rated competitor benchmark if helpful.
    // We do NOT touch the review array (that's the user's local CRM data) — just augment
    // the `reviewsGrowth` projection so KPIs reflect real Google numbers.
    if (typeof lookup.userRatingCount === "number" && lookup.userRatingCount > 0) {
      // Tag the current month's data point with the real count.
      if (snap.reviewsGrowth.length > 0) {
        const last = snap.reviewsGrowth[snap.reviewsGrowth.length - 1];
        last.reviews = lookup.userRatingCount;
      }
    }
    return "live";
  }
  if (lookup.status === "no-match") return "missing";
  return lookup.status === "missing-key" ? "missing" : "error";
}

/** How long a cached PageSpeed result stays fresh. */
const PAGESPEED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Hydrate the snapshot with real Core Web Vitals from Google PageSpeed Insights.
 * Returns the resulting DataSourceHealth status so the report shows provenance.
 *
 * Caching strategy: PageSpeed is slow (15–40s) and flaky on slow sites, so we cache only
 * SUCCESSFUL results in the `pagespeed_cache` table (keyed by url+strategy, 24h TTL). A fresh hit
 * is served instantly and survives redeploys; failures are never cached. All cache access is
 * best-effort — if the table/RLS isn't present yet, we transparently fall back to a live call.
 */
async function hydrateWithPageSpeed(snap: BusinessSnapshot): Promise<DataSourceHealth["pagespeed"]> {
  if (!process.env.GOOGLE_PAGESPEED_API_KEY) return "missing";
  const website = snap.business.website;
  if (!website) return "missing";
  const strategy = "mobile";

  const supabase = await createSupabaseServerClient();

  // 1. Serve a fresh cached good result if we have one.
  const { data: cached } = await supabase
    .from("pagespeed_cache")
    .select("result, fetched_at")
    .eq("url", website)
    .eq("strategy", strategy)
    .maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < PAGESPEED_TTL_MS) {
    snap.webVitals = cached.result as BusinessSnapshot["webVitals"];
    return "live";
  }

  // 2. Cache miss / stale → fresh lookup.
  const result = await lookupPageSpeed({ url: website, strategy });

  if (result.status === "live" && result.lighthouseScore !== undefined) {
    const webVitals = {
      lcp: result.lcp ?? 0,
      inp: result.inp ?? 0,
      cls: result.cls ?? 0,
      lighthouseScore: result.lighthouseScore,
      fetchedAt: result.fetchedAt ?? new Date().toISOString(),
    };
    snap.webVitals = webVitals;
    // 3. Cache the good result (best-effort — never block the report on a cache write).
    await supabase
      .from("pagespeed_cache")
      .upsert({ url: website, strategy, result: webVitals, fetched_at: webVitals.fetchedAt });
    return "live";
  }
  if (result.status === "missing-key") return "missing";
  return "error";
}

export async function generateReport(input: GenerateReportInput): Promise<Report | null> {
  const result = await loadSnapshot(input);
  if (!result) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[reports] No snapshot for", input.businessId, "clientSnapshot?", !!input.clientSnapshot);
    }
    return null;
  }

  // Both hydrations mutate the same snapshot but write disjoint fields, so they're safe in parallel.
  const [placesStatus, pagespeedStatus] = await Promise.all([
    hydrateWithPlaces(result.snapshot),
    hydrateWithPageSpeed(result.snapshot),
  ]);

  const report = buildReport(result.snapshot, new Date().toISOString(), {
    dataSources: {
      places: placesStatus,
      pagespeed: pagespeedStatus,
      searchConsole: "missing",
      gbp: "missing",
      ga4: "missing",
    },
    localeOverride: input.locale,
  });

  // Persist to DB if authenticated.
  if (result.authenticated) {
    const supabase = await createSupabaseServerClient();
    await supabase.from("reports").insert({
      business_id: report.businessId,
      title: `${report.businessName} · ${new Date(report.generatedAt).toLocaleDateString()}`,
      kind: "weekly",
      locale: report.locale,
      summary: report.summary,
      content: JSON.stringify(report),
    });
  }

  return report;
}

// ---------------------------------------------------------------------------
// Row → app type mappers
// ---------------------------------------------------------------------------

function mapLocation(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    label: row.label,
    addressLine: row.address_line,
    city: row.city,
    region: row.region,
    country: row.country,
    primaryGeoQuery: row.primary_geo_query,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    isPrimary: row.is_primary,
  };
}

function mapService(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    primaryKeyword: row.primary_keyword,
    supportingKeywords: row.supporting_keywords ?? [],
    isFeatured: row.is_featured,
  };
}

function mapCompetitor(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    locationId: row.location_id ?? undefined,
    name: row.name,
    website: row.website ?? undefined,
    rating: row.rating ?? undefined,
    reviewCount: row.review_count ?? undefined,
    strengthScore: row.strength_score,
    relevanceScore: row.relevance_score,
    strengths: row.strengths ?? [],
    weaknesses: row.weaknesses ?? [],
    opportunities: row.opportunities ?? [],
  };
}

function mapReview(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    locationId: row.location_id ?? undefined,
    author: row.author,
    rating: row.rating,
    text: row.text,
    serviceMentioned: row.service_mentioned ?? undefined,
    suggestedReply: row.suggested_reply ?? undefined,
    status: row.status,
    receivedAt: row.received_at,
  };
}

function mapContent(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    serviceId: row.service_id ?? undefined,
    locale: row.locale,
    kind: row.kind,
    title: row.title ?? undefined,
    body: row.body,
    targetKeyword: row.target_keyword ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapPlan(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category,
    priority: row.priority,
    impact: row.impact,
    difficulty: row.difficulty,
    week: row.week,
    status: row.status,
  };
}
