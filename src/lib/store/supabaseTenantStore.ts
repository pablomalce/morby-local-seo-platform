/**
 * Supabase-backed tenant store.
 *
 * Mirrors the public API of the localStorage `tenantStore` but persists to Postgres via the
 * Supabase JS client. Used when the user is authenticated. RLS policies enforce that a user
 * only ever sees rows in organizations they belong to.
 */

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  Business,
  BusinessLocation,
  BusinessService,
  Competitor,
  ContentAsset,
  Review,
} from "@/lib/types/core";

const client = () => createSupabaseBrowserClient();

// ---------- Row → app type mappers ----------

function mapBusiness(row: any): Business {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    website: row.website,
    industry: row.industry,
    brandTone: row.brand_tone,
    primaryLocale: row.primary_locale,
    valueProposition: row.value_proposition,
    logoColor: row.logo_color,
    createdAt: row.created_at,
  };
}
function mapLocation(row: any): BusinessLocation {
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
function mapService(row: any): BusinessService {
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
function mapCompetitor(row: any): Competitor {
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
function mapReview(row: any): Review {
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
function mapContent(row: any): ContentAsset {
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

// ---------- Reads ----------

export async function fetchMyBusinesses(): Promise<{
  organizationId: string | null;
  businesses: Business[];
  locations: BusinessLocation[];
  services: BusinessService[];
}> {
  const supabase = client();

  // Resolve the active organization (a member can be in multiple — pick the first they own,
  // else first they're a member of).
  const { data: membership } = await supabase
    .from("org_members")
    .select("organization_id, role")
    .order("role")
    .limit(1);

  const organizationId = membership?.[0]?.organization_id ?? null;
  if (!organizationId) return { organizationId, businesses: [], locations: [], services: [] };

  const [biz, locs, svcs] = await Promise.all([
    supabase.from("businesses").select("*").eq("organization_id", organizationId).order("created_at"),
    supabase.from("business_locations").select("*").order("created_at"),
    supabase.from("business_services").select("*").order("created_at"),
  ]);

  return {
    organizationId,
    businesses: (biz.data ?? []).map(mapBusiness),
    locations: (locs.data ?? []).map(mapLocation),
    services: (svcs.data ?? []).map(mapService),
  };
}

export async function fetchBusinessExtras(businessId: string): Promise<{
  competitors: Competitor[];
  reviews: Review[];
  content: ContentAsset[];
}> {
  const supabase = client();
  const [cmp, rev, cnt] = await Promise.all([
    supabase.from("competitors").select("*").eq("business_id", businessId).order("created_at"),
    supabase
      .from("reviews")
      .select("*")
      .eq("business_id", businessId)
      .order("received_at", { ascending: false }),
    supabase
      .from("content_assets")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false }),
  ]);
  return {
    competitors: (cmp.data ?? []).map(mapCompetitor),
    reviews: (rev.data ?? []).map(mapReview),
    content: (cnt.data ?? []).map(mapContent),
  };
}

// ---------- Writes ----------

export interface NewBusinessDbInput {
  name: string;
  website: string;
  industry: string;
  brandTone: string;
  primaryLocale: "en" | "es" | "sv";
  valueProposition: string;
  logoColor: string;
}
export interface NewLocationDbInput {
  label: string;
  addressLine: string;
  city: string;
  region: string;
  country: string;
  primaryGeoQuery: string;
}
export interface NewServiceDbInput {
  name: string;
  slug?: string;
  description: string;
  primaryKeyword: string;
  supportingKeywords?: string[];
  isFeatured?: boolean;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || `svc-${Date.now().toString(36)}`
  );
}

export async function createTenantInDb(input: {
  organizationId: string;
  business: NewBusinessDbInput;
  firstLocation?: NewLocationDbInput;
  firstService?: NewServiceDbInput;
}): Promise<{ businessId: string }> {
  const supabase = client();

  const { data: biz, error: bizErr } = await supabase
    .from("businesses")
    .insert({
      organization_id: input.organizationId,
      name: input.business.name,
      website: input.business.website,
      industry: input.business.industry,
      brand_tone: input.business.brandTone,
      primary_locale: input.business.primaryLocale,
      value_proposition: input.business.valueProposition,
      logo_color: input.business.logoColor,
    })
    .select()
    .single();

  if (bizErr || !biz) throw new Error(bizErr?.message ?? "Failed to create business");

  if (input.firstLocation) {
    await supabase.from("business_locations").insert({
      business_id: biz.id,
      label: input.firstLocation.label,
      address_line: input.firstLocation.addressLine,
      city: input.firstLocation.city,
      region: input.firstLocation.region,
      country: input.firstLocation.country.toUpperCase().slice(0, 2),
      primary_geo_query: input.firstLocation.primaryGeoQuery,
      is_primary: true,
    });
  }

  if (input.firstService) {
    await supabase.from("business_services").insert({
      business_id: biz.id,
      slug: input.firstService.slug ?? slugify(input.firstService.name),
      name: input.firstService.name,
      description: input.firstService.description,
      primary_keyword: input.firstService.primaryKeyword,
      supporting_keywords: input.firstService.supportingKeywords ?? [],
      is_featured: input.firstService.isFeatured ?? true,
    });
  }

  return { businessId: biz.id };
}

export async function deleteBusinessFromDb(businessId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.from("businesses").delete().eq("id", businessId);
  if (error) throw new Error(error.message);
}

export async function appendContentToDb(items: ContentAsset[]): Promise<void> {
  if (items.length === 0) return;
  const supabase = client();
  const rows = items.map((c) => ({
    business_id: c.businessId,
    service_id: c.serviceId ?? null,
    locale: c.locale,
    kind: c.kind,
    title: c.title ?? null,
    body: c.body,
    target_keyword: c.targetKeyword ?? null,
    status: c.status,
  }));
  const { error } = await supabase.from("content_assets").insert(rows);
  if (error) throw new Error(error.message);
}

export async function appendCompetitorsToDb(items: Competitor[]): Promise<void> {
  if (items.length === 0) return;
  const supabase = client();
  const rows = items.map((c) => ({
    business_id: c.businessId,
    location_id: c.locationId ?? null,
    name: c.name,
    website: c.website ?? null,
    rating: c.rating ?? null,
    review_count: c.reviewCount ?? null,
    strength_score: c.strengthScore,
    relevance_score: c.relevanceScore,
    strengths: c.strengths,
    weaknesses: c.weaknesses,
    opportunities: c.opportunities,
  }));
  const { error } = await supabase.from("competitors").insert(rows);
  if (error) throw new Error(error.message);
}

export async function appendReviewsToDb(items: Review[]): Promise<void> {
  if (items.length === 0) return;
  const supabase = client();
  const rows = items.map((r) => ({
    business_id: r.businessId,
    location_id: r.locationId ?? null,
    author: r.author,
    rating: r.rating,
    text: r.text,
    service_mentioned: r.serviceMentioned ?? null,
    suggested_reply: r.suggestedReply ?? null,
    status: r.status,
    received_at: r.receivedAt,
  }));
  const { error } = await supabase.from("reviews").insert(rows);
  if (error) throw new Error(error.message);
}
