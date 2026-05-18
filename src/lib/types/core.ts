/**
 * Universal Local Growth Platform — Core Domain Types
 *
 * Every entity is multi-tenant by design. The hierarchy is:
 *   Organization → Users → Businesses → Locations → Services → (Keywords, Competitors, Reviews,
 *   Content, Social/Image Assets, Reports, Tasks, AgentRuns)
 *
 * Keep this file framework-agnostic: no React, no Next.js, no Prisma. The Prisma schema mirrors
 * these shapes but storage is decoupled — Phase 1 ships with in-memory mocks.
 */

export type Locale = "en" | "es" | "sv";
export type Currency = "USD" | "EUR" | "SEK" | "GBP";
export type WorkflowStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "scheduled"
  | "published"
  | "archived";

export type AgentScope =
  | "platform"
  | "organization"
  | "business"
  | "location"
  | "service"
  | "campaign";

export type AgentStatus = "idle" | "queued" | "running" | "completed" | "failed";

export type IndustryVertical =
  | "beauty_clinic"
  | "health_clinic"
  | "dental_clinic"
  | "restaurant"
  | "cafe"
  | "retail"
  | "professional_services"
  | "franchise"
  | "ecommerce_local"
  | "repair_services"
  | "home_services"
  | "gym"
  | "spa"
  | "salon"
  | "other";

export type SocialPlatform =
  | "linkedin"
  | "instagram_feed"
  | "instagram_story"
  | "facebook"
  | "x_twitter"
  | "gbp_post"
  | "website_banner"
  | "ad_creative";

export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9" | "3:2" | "2:3";

export type UserRole = "owner" | "admin" | "manager" | "editor" | "viewer";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  defaultLocale: Locale;
  defaultCurrency: Currency;
  createdAt: string;
}

export interface OrgUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Business {
  id: string;
  organizationId: string;
  name: string;
  website: string;
  industry: IndustryVertical;
  brandTone: string;
  primaryLocale: Locale;
  /** Free-form value proposition used by agents to ground generated content. */
  valueProposition: string;
  logoColor: string;
  createdAt: string;
}

export interface BusinessLocation {
  id: string;
  businessId: string;
  label: string;
  addressLine: string;
  city: string;
  region: string;
  country: string;
  /** Primary market query a user would search to find this location. */
  primaryGeoQuery: string;
  latitude?: number;
  longitude?: number;
  isPrimary: boolean;
}

export interface BusinessService {
  id: string;
  businessId: string;
  /** Short stable identifier — e.g. "facial-treatments". */
  slug: string;
  name: string;
  description: string;
  /** Primary commercial keyword tied to this service. */
  primaryKeyword: string;
  supportingKeywords: string[];
  isFeatured: boolean;
}

export interface Keyword {
  id: string;
  businessId: string;
  serviceId?: string;
  locationId?: string;
  query: string;
  intent: "informational" | "transactional" | "navigational" | "local";
  estimatedVolume?: number;
  difficulty?: number;
  currentRank?: number;
  targetRank?: number;
}

export interface Competitor {
  id: string;
  businessId: string;
  locationId?: string;
  name: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  strengthScore: number;
  relevanceScore: number;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
}

export interface Review {
  id: string;
  businessId: string;
  locationId?: string;
  author: string;
  rating: number;
  text: string;
  serviceMentioned?: string;
  suggestedReply?: string;
  status: WorkflowStatus;
  receivedAt: string;
}

export interface ContentAsset {
  id: string;
  businessId: string;
  serviceId?: string;
  locale: Locale;
  /** "meta_title", "h1", "faq", "blog", "gbp_post", etc. */
  kind: string;
  title?: string;
  body: string;
  targetKeyword?: string;
  status: WorkflowStatus;
  createdAt: string;
}

export interface SocialImageAsset {
  id: string;
  businessId: string;
  serviceId?: string;
  locationId?: string;
  platform: SocialPlatform;
  aspectRatio: AspectRatio;
  visualStyle: string;
  campaignGoal: string;
  audience: string;
  language: Locale;
  brandTone: string;
  prompt: string;
  caption: string;
  hashtags: string[];
  altText: string;
  cta: string;
  /** URL or data URI. Demo mode generates a deterministic SVG placeholder. */
  imageUrl: string;
  provider: "openai" | "demo" | "placeholder";
  status: WorkflowStatus;
  createdAt: string;
}

export interface SocialPost {
  id: string;
  businessId: string;
  imageAssetId?: string;
  platform: SocialPlatform;
  locale: Locale;
  caption: string;
  hashtags: string[];
  scheduledFor?: string;
  status: WorkflowStatus;
}

export interface Campaign {
  id: string;
  businessId: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: "draft" | "active" | "paused" | "completed";
}

export interface PlatformTask {
  id: string;
  businessId: string;
  title: string;
  description?: string;
  category: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  impact: "Low" | "Medium" | "High";
  difficulty: "Low" | "Medium" | "High";
  week: number;
  status: "pending" | "in_progress" | "completed" | "blocked";
}

export interface Report {
  id: string;
  businessId: string;
  title: string;
  kind: "weekly" | "monthly" | "executive" | "technical";
  locale: Locale;
  summary: string;
  createdAt: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  /** What entities this agent can operate on. */
  scopes: AgentScope[];
  /** Free-form schema label for input — actual validation is module-local. */
  inputSchema: string;
  outputSchema: string;
  /** Whether external publishing requires human approval. */
  requiresApproval: boolean;
}

export interface AgentRun {
  id: string;
  agentId: string;
  scope: AgentScope;
  /** ID of the entity at the chosen scope (orgId, businessId, locationId, etc.). */
  scopeId: string;
  status: AgentStatus;
  startedAt: string;
  finishedAt?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  /** Reserved for Phase 2 OpenAI usage tracking. */
  tokensUsed?: number;
  costUsd?: number;
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: string;
  delta?: string;
  note?: string;
}

export interface IntegrationAccount {
  id: string;
  organizationId: string;
  provider:
    | "openai"
    | "google_places"
    | "google_business_profile"
    | "search_console"
    | "ga4"
    | "linkedin"
    | "meta"
    | "x_twitter"
    | "buffer";
  status: "not_connected" | "pending" | "connected" | "error";
  connectedAt?: string;
}
