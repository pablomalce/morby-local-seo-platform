/**
 * Tenant store — runtime merge of seed demo data + user-created tenants.
 *
 * Phase 1 stores user-created businesses/locations/services in `localStorage` so users can
 * onboard their own clients from the UI without a real database. Phase 2 will swap this for
 * tenant-scoped DB queries, but the public API (`addBusiness`, `addLocation`, `addService`,
 * `listBusinesses`, etc.) is intentionally stable so consumers don't change.
 */

import {
  businesses as seedBusinesses,
  locations as seedLocations,
  services as seedServices,
} from "@/lib/mock/universal";
import type { Business, BusinessLocation, BusinessService } from "@/lib/types/core";

const STORAGE_KEY = "lg.tenants.v1";

interface StoredState {
  businesses: Business[];
  locations: BusinessLocation[];
  services: BusinessService[];
}

function emptyState(): StoredState {
  return { businesses: [], locations: [], services: [] };
}

export function readStore(): StoredState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      businesses: Array.isArray(parsed.businesses) ? parsed.businesses : [],
      locations: Array.isArray(parsed.locations) ? parsed.locations : [],
      services: Array.isArray(parsed.services) ? parsed.services : [],
    };
  } catch {
    return emptyState();
  }
}

export function writeStore(state: StoredState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cuid(): string {
  return `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || `svc-${Date.now().toString(36)}`;
}

export function createBusiness(input: NewBusinessInput): Business {
  const business: Business = {
    id: cuid(),
    organizationId: input.organizationId,
    name: input.name.trim(),
    website: input.website.trim(),
    industry: input.industry,
    brandTone: input.brandTone.trim(),
    primaryLocale: input.primaryLocale,
    valueProposition: input.valueProposition.trim(),
    logoColor: input.logoColor || "#8FAF9A",
    createdAt: new Date().toISOString(),
  };
  const state = readStore();
  state.businesses = [...state.businesses, business];
  writeStore(state);
  return business;
}

export function createLocation(input: NewLocationInput): BusinessLocation {
  const location: BusinessLocation = {
    id: cuid(),
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
    id: cuid(),
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
  });
}

/** Merge seed + user-created data — single source of truth for the UI. */
export function listAllBusinesses(): Business[] {
  return [...seedBusinesses, ...readStore().businesses];
}

export function listAllLocations(): BusinessLocation[] {
  return [...seedLocations, ...readStore().locations];
}

export function listAllServices(): BusinessService[] {
  return [...seedServices, ...readStore().services];
}

export function isUserCreated(businessId: string): boolean {
  return !seedBusinesses.some((b) => b.id === businessId);
}
