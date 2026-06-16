/**
 * Tenant store — runtime merge of seed demo data + user-created tenants + agent outputs.
 *
 * Phase 1 stores user-created businesses/locations/services in `localStorage`, plus any data
 * that agents produce when run (content drafts, competitor entries, reviews, reports). Phase 2
 * will swap this for tenant-scoped DB queries.
 */

import {
  businesses as seedBusinesses,
  locations as seedLocations,
  services as seedServices,
} from "@/lib/mock/universal";
import type {
  Business,
  BusinessLocation,
  BusinessService,
  Competitor,
  ContentAsset,
  Report,
  Review,
} from "@/lib/types/core";

const STORAGE_KEY = "lg.tenants.v2";

interface StoredState {
  businesses: Business[];
  locations: BusinessLocation[];
  services: BusinessService[];
  content: ContentAsset[];
  competitors: Competitor[];
  reviews: Review[];
  reports: Report[];
}

function emptyState(): StoredState {
  return {
    businesses: [],
    locations: [],
    services: [],
    content: [],
    competitors: [],
    reviews: [],
    reports: [],
  };
}

export function readStore(): StoredState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Best-effort migrate from v1.
      const legacy = window.localStorage.getItem("lg.tenants.v1");
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<StoredState>;
        return { ...emptyState(), ...parsed };
      }
      return emptyState();
    }
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      businesses: Array.isArray(parsed.businesses) ? parsed.businesses : [],
      locations: Array.isArray(parsed.locations) ? parsed.locations : [],
      services: Array.isArray(parsed.services) ? parsed.services : [],
      content: Array.isArray(parsed.content) ? parsed.content : [],
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    };
  } catch {
    return emptyState();
  }
}

export function writeStore(state: StoredState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cuid(prefix = "usr"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface NewBusinessInput {
  organizationId: string;
  name: string;
  website: string;
  industry: Business["industry"];
  brandTone: string;
  primaryLocale: Business["primaryLocale"];
  valueProposition: string;
  logoColor: string;
}

export interface NewLocationInput {
  businessId: string;
  label: string;
  addressLine: string;
  city: string;
  region: string;
  country: string;
  primaryGeoQuery: string;
  isPrimary?: boolean;
}

export interface NewServiceInput {
  businessId: string;
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

export function createBusiness(input: NewBusinessInput): Business {
  const business: Business = {
    id: cuid("biz-usr"),
    organizationId: input.organizationId,
    name: input.name.trim(),
    website: input.website.trim(),
    industry: input.industry,
    brandTone: input.brandTone.trim(),
    primaryLocale: input.primaryLocale,
    valueProposition: input.valueProposition.trim(),
    logoColor: input.logoColor || "#EF4C24",
    createdAt: new Date().toISOString(),
  };
  const state = readStore();
  state.businesses = [...state.businesses, business];
  writeStore(state);
  return business;
}

export function createLocation(input: NewLocationInput): BusinessLocation {
  const location: BusinessLocation = {
    id: cuid("loc-usr"),
    businessId: input.businessId,
    label: input.label.trim() || "Primary",
    addressLine: input.addressLine.trim(),
    city: input.city.trim(),
    region: input.region.trim(),
    country: input.country.trim().toUpperCase().slice(0, 2),
    primaryGeoQuery: input.primaryGeoQuery.trim(),
    isPrimary: input.isPrimary ?? true,
  };
  const state = readStore();
  state.locations = [...state.locations, location];
  writeStore(state);
  return location;
}

export function createService(input: NewServiceInput): BusinessService {
  const service: BusinessService = {
    id: cuid("svc-usr"),
    businessId: input.businessId,
    slug: input.slug?.trim() || slugify(input.name),
    name: input.name.trim(),
    description: input.description.trim(),
    primaryKeyword: input.primaryKeyword.trim(),
    supportingKeywords: input.supportingKeywords ?? [],
    isFeatured: input.isFeatured ?? true,
  };
  const state = readStore();
  state.services = [...state.services, service];
  writeStore(state);
  return service;
}

export function deleteBusiness(businessId: string) {
  const state = readStore();
  writeStore({
    businesses: state.businesses.filter((b) => b.id !== businessId),
    locations: state.locations.filter((l) => l.businessId !== businessId),
    services: state.services.filter((s) => s.businessId !== businessId),
    content: state.content.filter((c) => c.businessId !== businessId),
    competitors: state.competitors.filter((c) => c.businessId !== businessId),
    reviews: state.reviews.filter((r) => r.businessId !== businessId),
    reports: state.reports.filter((r) => r.businessId !== businessId),
  });
}

// ---------- Agent-output writers ----------

export function appendContent(items: ContentAsset[]) {
  if (items.length === 0) return;
  const state = readStore();
  state.content = [...items, ...state.content];
  writeStore(state);
}

export function appendCompetitors(items: Competitor[]) {
  if (items.length === 0) return;
  const state = readStore();
  state.competitors = [...items, ...state.competitors];
  writeStore(state);
}

export function appendReviews(items: Review[]) {
  if (items.length === 0) return;
  const state = readStore();
  state.reviews = [...items, ...state.reviews];
  writeStore(state);
}

export function appendReport(report: Report) {
  const state = readStore();
  state.reports = [report, ...state.reports];
  writeStore(state);
}

// ---------- Reads ----------

export function listAllBusinesses(): Business[] {
  return [...seedBusinesses, ...readStore().businesses];
}

export function listAllLocations(): BusinessLocation[] {
  return [...seedLocations, ...readStore().locations];
}

export function listAllServices(): BusinessService[] {
  return [...seedServices, ...readStore().services];
}

export function listStoredContent(businessId: string): ContentAsset[] {
  return readStore().content.filter((c) => c.businessId === businessId);
}

export function listStoredCompetitors(businessId: string): Competitor[] {
  return readStore().competitors.filter((c) => c.businessId === businessId);
}

export function listStoredReviews(businessId: string): Review[] {
  return readStore().reviews.filter((r) => r.businessId === businessId);
}

export function listStoredReports(businessId: string): Report[] {
  return readStore().reports.filter((r) => r.businessId === businessId);
}

export function isUserCreated(businessId: string): boolean {
  return !seedBusinesses.some((b) => b.id === businessId);
}
