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

/**
 * The tenant of each of these businesses, as one query.
 *
 * Why this exists. Every child table carries `organization_id` and a composite
 * foreign key back to `(organization_id, business_id)` of the parent, which is
 * what makes cross-tenant reparenting structurally impossible. Until now the
 * application never sent that column: `fill_organization_id_from_business()`
 * filled it in a BEFORE INSERT trigger on ten tables. Migration 0012 removed
 * both, so this is now the only thing putting a tenant on a child row.
 *
 * A trigger that supplies a value the caller should have supplied is a trigger
 * nobody can remove — and removing it matters, because the schema can state a
 * NOT NULL column but cannot state "a trigger will get there first". Sending
 * the column explicitly is what lets a later migration drop those ten triggers
 * without silently starting to write tenant-less rows.
 *
 * One query for the whole batch, not one per row. The lookup goes through the
 * same RLS the caller is subject to, so a business in another organization
 * comes back missing rather than resolved — and the throw below is a better
 * failure than the composite foreign key violation that would otherwise follow.
 */
async function tenantOf(
  supabase: ReturnType<typeof client>,
  businessIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(businessIds)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("businesses")
    .select("id, organization_id")
    .in("id", unique);

  if (error) throw new Error(error.message);

  const byId = new Map<string, string>(
    (data ?? []).map((row: { id: string; organization_id: string }) => [
      row.id,
      row.organization_id,
    ])
  );

  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(
      `No organization for business ${missing.join(", ")} — it does not exist, ` +
        `or it belongs to an organization this session cannot see.`
    );
  }

  return byId;
}

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

/** Una membresía, con lo único que hace falta para elegir. */
export interface MembresiaElegible {
  organization_id: string;
  role?: string | null;
  state?: string | null;
}

/** El orden en que un rol pesa. Menor gana. */
const PESO: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/**
 * QUÉ IMPIDE ESTA FUNCIÓN
 *
 * Que la organización activa la elija el azar.
 *
 * Lo que había era `order("role").limit(1)`, con un comentario que prometía
 * «primero la que posee, si no la primera de la que es miembro». Hacía lo
 * contrario: `order` es alfabético ascendente, así que `admin` gana sobre
 * `owner`. Y con DOS membresías del mismo rol —que es lo que pasa apenas alguien
 * opera su propia organización y la de la agencia— el desempate no lo decidía
 * nadie.
 *
 * Medido el 2026-09-01: con dos `owner`, la base devolvió la organización SIN
 * negocios, y el selector quedó vacío mientras la petición contestaba 200. Se
 * destrabó archivando la otra membresía, que es un arreglo de datos para un
 * defecto de código.
 *
 * TRES REGLAS, Y LAS TRES HACEN FALTA
 *
 *   1. las archivadas no cuentan. Se filtra ACÁ y no se confía en que la RLS lo
 *      haga: la baja archiva desde la 0013, y un cliente que dependa de que la
 *      policy lo esconda deja de funcionar el día que la policy cambie;
 *   2. `owner` antes que `admin` antes que `member`, que es lo que el comentario
 *      viejo decía y el código no hacía;
 *   3. a igual rol, el uuid más chico. No es «mejor»: es DETERMINISTA, y eso es
 *      lo único que impide que dos cargas de la misma pantalla elijan distinto.
 */
export function elegirOrganizacion(membresias: readonly MembresiaElegible[]): string | null {
  const activas = membresias.filter((m) => (m.state ?? "active") === "active");
  if (activas.length === 0) return null;

  const ordenadas = [...activas].sort((a, b) => {
    const pa = PESO[a.role ?? ""] ?? 9;
    const pb = PESO[b.role ?? ""] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.organization_id.localeCompare(b.organization_id);
  });

  return ordenadas[0].organization_id;
}

export async function fetchMyBusinesses(): Promise<{
  organizationId: string | null;
  businesses: Business[];
  locations: BusinessLocation[];
  services: BusinessService[];
}> {
  const supabase = client();

  // Se traen TODAS las membresías y se elige acá. Ver `elegirOrganizacion()`:
  // delegarle el orden a la base con `order("role").limit(1)` elegía al revés de
  // lo que su propio comentario prometía, y encima dependía de que la RLS
  // escondiera las archivadas.
  const { data: membership } = await supabase
    .from("org_members")
    .select("organization_id, role, state");

  const organizationId = elegirOrganizacion(membership ?? []);
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
      organization_id: input.organizationId,
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
      organization_id: input.organizationId,
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
  const tenants = await tenantOf(supabase, items.map((c) => c.businessId));
  const rows = items.map((c) => ({
    organization_id: tenants.get(c.businessId)!,
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
  const tenants = await tenantOf(supabase, items.map((c) => c.businessId));
  const rows = items.map((c) => ({
    organization_id: tenants.get(c.businessId)!,
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
  const tenants = await tenantOf(supabase, items.map((r) => r.businessId));
  const rows = items.map((r) => ({
    organization_id: tenants.get(r.businessId)!,
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
