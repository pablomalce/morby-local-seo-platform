/**
 * Universal demo dataset
 *
 * Three businesses across different industries demonstrate that the platform is not tied to a
 * single client. Every page reads from this dataset through `getBusinessSnapshot()` so swapping
 * the selected business updates dashboards, agents, reports and image studio in one place.
 *
 * The original Mörby Fotvård & Skönhet remains as one of the demo tenants — preserving everything
 * the MVP demonstrated, while showing the same UI working for a restaurant and a dental clinic.
 */

import type {
  AgentDefinition,
  Business,
  BusinessLocation,
  BusinessService,
  Campaign,
  Competitor,
  ContentAsset,
  DashboardMetric,
  Organization,
  OrgUser,
  PlatformTask,
  Review,
  SocialImageAsset,
  SocialPost,
} from "@/lib/types/core";

// ---------- Organizations ----------

export const organizations: Organization[] = [
  {
    id: "org-northgrowth",
    name: "Northgrowth Agency",
    slug: "northgrowth",
    defaultLocale: "en",
    defaultCurrency: "EUR",
    createdAt: "2025-09-01T10:00:00Z",
  },
];

export const orgUsers: OrgUser[] = [
  { id: "u-1", organizationId: "org-northgrowth", name: "Pablo M.", email: "pablo@northgrowth.io", role: "owner" },
  { id: "u-2", organizationId: "org-northgrowth", name: "Elena R.", email: "elena@northgrowth.io", role: "manager" },
];

// ---------- Businesses ----------

export const businesses: Business[] = [
  {
    id: "biz-morby",
    organizationId: "org-northgrowth",
    name: "Mörby Fotvård och Skönhet",
    website: "https://morbyfotvard.se",
    industry: "beauty_clinic",
    brandTone: "Warm, expert, Scandinavian calm",
    primaryLocale: "sv",
    valueProposition: "Personalised facial care and skin treatments in Danderyd, Stockholm.",
    logoColor: "#8FAF9A",
    createdAt: "2025-09-04T12:00:00Z",
  },
  {
    id: "biz-luma-dental",
    organizationId: "org-northgrowth",
    name: "Luma Dental Studio",
    website: "https://lumadental.example",
    industry: "dental_clinic",
    brandTone: "Modern, trustworthy, premium",
    primaryLocale: "en",
    valueProposition: "Comfortable cosmetic dentistry and Invisalign care in Brooklyn.",
    logoColor: "#3F7CAC",
    createdAt: "2025-10-12T09:00:00Z",
  },
  {
    id: "biz-casa-verde",
    organizationId: "org-northgrowth",
    name: "Casa Verde Bistró",
    website: "https://casaverde.example",
    industry: "restaurant",
    brandTone: "Friendly, vibrant, locally-rooted",
    primaryLocale: "es",
    valueProposition: "Slow-cooked Mediterranean plates with a strong local sourcing story in Valencia.",
    logoColor: "#C46A4E",
    createdAt: "2025-11-02T18:30:00Z",
  },
];

// ---------- Locations ----------

export const locations: BusinessLocation[] = [
  {
    id: "loc-morby-1",
    businessId: "biz-morby",
    label: "Mörby Centrum",
    addressLine: "Mörbygårdsvägen 1",
    city: "Danderyd",
    region: "Stockholm",
    country: "SE",
    primaryGeoQuery: "ansiktsbehandling danderyd",
    isPrimary: true,
  },
  {
    id: "loc-luma-1",
    businessId: "biz-luma-dental",
    label: "Park Slope",
    addressLine: "552 7th Ave",
    city: "Brooklyn",
    region: "NY",
    country: "US",
    primaryGeoQuery: "cosmetic dentist park slope",
    isPrimary: true,
  },
  {
    id: "loc-luma-2",
    businessId: "biz-luma-dental",
    label: "Williamsburg",
    addressLine: "180 Bedford Ave",
    city: "Brooklyn",
    region: "NY",
    country: "US",
    primaryGeoQuery: "invisalign williamsburg",
    isPrimary: false,
  },
  {
    id: "loc-casa-1",
    businessId: "biz-casa-verde",
    label: "Russafa",
    addressLine: "Carrer de Cuba 17",
    city: "Valencia",
    region: "Valencia",
    country: "ES",
    primaryGeoQuery: "restaurante mediterráneo russafa",
    isPrimary: true,
  },
];

// ---------- Services ----------

export const services: BusinessService[] = [
  {
    id: "svc-morby-facial",
    businessId: "biz-morby",
    slug: "facial-treatments",
    name: "Ansiktsbehandling",
    description: "Personalised facials including deep cleansing, hydration and anti-age protocols.",
    primaryKeyword: "ansiktsbehandling danderyd",
    supportingKeywords: ["hudvård danderyd", "ansiktsvård", "skin treatment stockholm"],
    isFeatured: true,
  },
  {
    id: "svc-morby-pedicure",
    businessId: "biz-morby",
    slug: "medical-pedicure",
    name: "Medicinsk Fotvård",
    description: "Clinical foot care for sensitive skin and diabetes-aware protocols.",
    primaryKeyword: "fotvård danderyd",
    supportingKeywords: ["medicinsk fotvård", "pedikyr stockholm"],
    isFeatured: false,
  },
  {
    id: "svc-luma-invisalign",
    businessId: "biz-luma-dental",
    slug: "invisalign",
    name: "Invisalign Aligners",
    description: "Clear aligners with 3D digital scans and modern in-office monitoring.",
    primaryKeyword: "invisalign brooklyn",
    supportingKeywords: ["clear aligners brooklyn", "teeth straightening park slope"],
    isFeatured: true,
  },
  {
    id: "svc-luma-whitening",
    businessId: "biz-luma-dental",
    slug: "teeth-whitening",
    name: "Professional Whitening",
    description: "Single-visit professional whitening with low-sensitivity gel and shade tracking.",
    primaryKeyword: "teeth whitening brooklyn",
    supportingKeywords: ["zoom whitening brooklyn", "professional whitening park slope"],
    isFeatured: false,
  },
  {
    id: "svc-casa-tasting",
    businessId: "biz-casa-verde",
    slug: "tasting-menu",
    name: "Menú Degustación",
    description: "Seven-course Mediterranean tasting menu with seasonal pairings.",
    primaryKeyword: "menú degustación valencia",
    supportingKeywords: ["restaurante mediterráneo valencia", "cena con maridaje russafa"],
    isFeatured: true,
  },
  {
    id: "svc-casa-events",
    businessId: "biz-casa-verde",
    slug: "private-events",
    name: "Eventos Privados",
    description: "Private dining for groups of 8-30 with customised Mediterranean menus.",
    primaryKeyword: "eventos privados restaurante valencia",
    supportingKeywords: ["cena privada valencia", "celebraciones russafa"],
    isFeatured: false,
  },
];

// ---------- Dashboard metrics per business ----------

const metricsByBusiness: Record<string, DashboardMetric[]> = {
  "biz-morby": [
    { key: "rank", label: "metrics.rank", value: "#3", delta: "+2", note: "metrics.rank.note" },
    { key: "gbp", label: "metrics.gbp", value: "72%", delta: "+18%", note: "metrics.gbp.note" },
    { key: "reviews", label: "metrics.reviews", value: "98", delta: "14 service mentions", note: "metrics.reviews.note" },
    { key: "plan", label: "metrics.plan", value: "18%", delta: "Week 2", note: "metrics.plan.note" },
  ],
  "biz-luma-dental": [
    { key: "rank", label: "metrics.rank", value: "#5", delta: "+3", note: "metrics.rank.note" },
    { key: "gbp", label: "metrics.gbp", value: "84%", delta: "+9%", note: "metrics.gbp.note" },
    { key: "reviews", label: "metrics.reviews", value: "212", delta: "31 service mentions", note: "metrics.reviews.note" },
    { key: "plan", label: "metrics.plan", value: "42%", delta: "Week 5", note: "metrics.plan.note" },
  ],
  "biz-casa-verde": [
    { key: "rank", label: "metrics.rank", value: "#2", delta: "+4", note: "metrics.rank.note" },
    { key: "gbp", label: "metrics.gbp", value: "91%", delta: "+5%", note: "metrics.gbp.note" },
    { key: "reviews", label: "metrics.reviews", value: "486", delta: "62 service mentions", note: "metrics.reviews.note" },
    { key: "plan", label: "metrics.plan", value: "63%", delta: "Week 8", note: "metrics.plan.note" },
  ],
};

const rankingByBusiness: Record<string, { week: string; rank: number }[]> = {
  "biz-morby": [
    { week: "W1", rank: 8 }, { week: "W2", rank: 6 }, { week: "W3", rank: 5 },
    { week: "W4", rank: 4 }, { week: "W5", rank: 3 }, { week: "Now", rank: 3 },
  ],
  "biz-luma-dental": [
    { week: "W1", rank: 12 }, { week: "W2", rank: 10 }, { week: "W3", rank: 8 },
    { week: "W4", rank: 7 }, { week: "W5", rank: 6 }, { week: "Now", rank: 5 },
  ],
  "biz-casa-verde": [
    { week: "W1", rank: 9 }, { week: "W2", rank: 6 }, { week: "W3", rank: 4 },
    { week: "W4", rank: 3 }, { week: "W5", rank: 2 }, { week: "Now", rank: 2 },
  ],
};

const reviewsGrowthByBusiness: Record<string, { month: string; reviews: number; mentions: number }[]> = {
  "biz-morby": [
    { month: "Jan", reviews: 82, mentions: 5 }, { month: "Feb", reviews: 86, mentions: 7 },
    { month: "Mar", reviews: 90, mentions: 10 }, { month: "Apr", reviews: 95, mentions: 12 },
    { month: "May", reviews: 98, mentions: 14 },
  ],
  "biz-luma-dental": [
    { month: "Jan", reviews: 168, mentions: 18 }, { month: "Feb", reviews: 178, mentions: 22 },
    { month: "Mar", reviews: 189, mentions: 25 }, { month: "Apr", reviews: 201, mentions: 28 },
    { month: "May", reviews: 212, mentions: 31 },
  ],
  "biz-casa-verde": [
    { month: "Jan", reviews: 392, mentions: 38 }, { month: "Feb", reviews: 418, mentions: 44 },
    { month: "Mar", reviews: 441, mentions: 51 }, { month: "Apr", reviews: 463, mentions: 57 },
    { month: "May", reviews: 486, mentions: 62 },
  ],
};

// ---------- Competitors ----------

export const competitors: Competitor[] = [
  {
    id: "cmp-1", businessId: "biz-morby",
    name: "Angelly Beauty", rating: 4.8, reviewCount: 126,
    strengthScore: 88, relevanceScore: 92,
    strengths: ["Strong beauty positioning", "High review volume", "Clear facial treatment identity"],
    weaknesses: ["Generic local content", "Limited educational FAQ depth"],
    opportunities: ["Build deeper Danderyd-specific facial content", "Increase facial-treatment reviews", "Publish consistent GBP posts"],
  },
  {
    id: "cmp-2", businessId: "biz-morby",
    name: "Danderyd Hudvård", rating: 4.6, reviewCount: 74,
    strengthScore: 71, relevanceScore: 85,
    strengths: ["Relevant skincare name", "Focused treatment offer"],
    weaknesses: ["Lower review volume", "Less authority than Angelly"],
    opportunities: ["Outperform with better page structure", "Add service comparison content"],
  },
  {
    id: "cmp-3", businessId: "biz-morby",
    name: "Beauty Clinic Stockholm", rating: 4.5, reviewCount: 112,
    strengthScore: 76, relevanceScore: 68,
    strengths: ["Broader brand reach", "Good visual identity"],
    weaknesses: ["Less Danderyd-specific", "Facial page not locally focused"],
    opportunities: ["Own the Danderyd query", "Reinforce proximity and trust signals"],
  },
  {
    id: "cmp-4", businessId: "biz-luma-dental",
    name: "Brooklyn Smile Lab", rating: 4.7, reviewCount: 284,
    strengthScore: 89, relevanceScore: 87,
    strengths: ["High review volume", "Strong Invisalign authority", "Modern visual identity"],
    weaknesses: ["Generic neighbourhood content", "Slow response to reviews"],
    opportunities: ["Differentiate on comfort & sedation", "Localise pages per neighbourhood"],
  },
  {
    id: "cmp-5", businessId: "biz-luma-dental",
    name: "Park Slope Dental Care", rating: 4.4, reviewCount: 158,
    strengthScore: 72, relevanceScore: 80,
    strengths: ["Established local brand", "Family-friendly positioning"],
    weaknesses: ["Outdated website", "Limited social proof on cosmetic services"],
    opportunities: ["Win cosmetic queries with modern UX", "Publish before/after content"],
  },
  {
    id: "cmp-6", businessId: "biz-luma-dental",
    name: "Williamsburg Aligners",
    rating: 4.6, reviewCount: 96,
    strengthScore: 70, relevanceScore: 78,
    strengths: ["Strong Invisalign offer", "Active Instagram presence"],
    weaknesses: ["No content on whitening", "Single location only"],
    opportunities: ["Cross-sell with whitening content", "Compete with multi-location authority"],
  },
  {
    id: "cmp-7", businessId: "biz-casa-verde",
    name: "La Mar Bistró", rating: 4.6, reviewCount: 612,
    strengthScore: 81, relevanceScore: 84,
    strengths: ["Excellent food photography", "Strong reservation flow"],
    weaknesses: ["Generic story", "Limited press coverage"],
    opportunities: ["Win with sourcing transparency", "Press features in local media"],
  },
  {
    id: "cmp-8", businessId: "biz-casa-verde",
    name: "Russafa Kitchen", rating: 4.5, reviewCount: 388,
    strengthScore: 74, relevanceScore: 82,
    strengths: ["Trendy neighbourhood positioning", "Strong brunch traffic"],
    weaknesses: ["Slow on dinner reservations", "Generic GBP posts"],
    opportunities: ["Take dinner market share", "Publish chef-led content"],
  },
];

// ---------- Reviews ----------

export const reviews: Review[] = [
  { id: "rv-1", businessId: "biz-morby", author: "Anna L.", rating: 5, text: "Fantastisk ansiktsbehandling i Danderyd. Professionellt och varmt bemötande.", serviceMentioned: "Ansiktsbehandling", suggestedReply: "Tack så mycket för din fina recension! Vi är glada att du uppskattade din ansiktsbehandling hos oss i Danderyd.", status: "approved", receivedAt: "2026-04-22T10:00:00Z" },
  { id: "rv-2", businessId: "biz-morby", author: "Erik P.", rating: 5, text: "Mycket nöjd med fotvård och service.", serviceMentioned: "Medicinsk Fotvård", suggestedReply: "Stort tack för dina fina ord. Varmt välkommen tillbaka till oss!", status: "approved", receivedAt: "2026-04-18T11:00:00Z" },
  { id: "rv-3", businessId: "biz-morby", author: "Maja S.", rating: 4, text: "Trevlig behandling och bra rådgivning om huden.", serviceMentioned: "Ansiktsbehandling", suggestedReply: "Tack för din recension. Vi är glada att du uppskattade behandlingen och rådgivningen.", status: "pending_review", receivedAt: "2026-05-01T15:00:00Z" },
  { id: "rv-4", businessId: "biz-luma-dental", author: "Jessica K.", rating: 5, text: "My Invisalign experience here has been seamless — modern office, friendly staff.", serviceMentioned: "Invisalign Aligners", suggestedReply: "Thank you so much, Jessica! We are thrilled your Invisalign journey is going smoothly.", status: "approved", receivedAt: "2026-04-25T09:30:00Z" },
  { id: "rv-5", businessId: "biz-luma-dental", author: "David O.", rating: 5, text: "Best whitening result I've had in Brooklyn. Zero sensitivity.", serviceMentioned: "Professional Whitening", suggestedReply: "Thanks David! We're so glad to hear about your zero-sensitivity result.", status: "approved", receivedAt: "2026-04-30T14:00:00Z" },
  { id: "rv-6", businessId: "biz-luma-dental", author: "Priya N.", rating: 4, text: "Great cosmetic care, scheduling could be smoother.", suggestedReply: "Thank you for the honest feedback, Priya — we are improving our scheduling experience this quarter.", status: "pending_review", receivedAt: "2026-05-05T12:00:00Z" },
  { id: "rv-7", businessId: "biz-casa-verde", author: "Carla M.", rating: 5, text: "El menú degustación es un viaje por el Mediterráneo. Volveremos.", serviceMentioned: "Menú Degustación", suggestedReply: "¡Gracias Carla! Nos encantó tenerte y esperamos verte muy pronto de nuevo.", status: "approved", receivedAt: "2026-04-28T20:00:00Z" },
  { id: "rv-8", businessId: "biz-casa-verde", author: "Marc V.", rating: 5, text: "Cena privada inolvidable. Servicio impecable.", serviceMentioned: "Eventos Privados", suggestedReply: "Gracias Marc, fue un placer organizar vuestra cena privada. Esperamos repetir muy pronto.", status: "approved", receivedAt: "2026-05-02T22:00:00Z" },
];

// ---------- GBP checklist per business ----------

const gbpChecklistByBusiness: Record<string, { item: string; status: "Pending" | "In progress" | "Done" }[]> = {
  "biz-morby": [
    { item: "Primary and secondary categories reviewed", status: "In progress" },
    { item: "Featured service highlighted", status: "Pending" },
    { item: "Weekly Google posts calendar", status: "Pending" },
    { item: "Service photos uploaded", status: "In progress" },
    { item: "Review request process for primary service", status: "Pending" },
    { item: "Service descriptions optimised in primary language", status: "Pending" },
  ],
  "biz-luma-dental": [
    { item: "Cosmetic & Invisalign categories aligned", status: "Done" },
    { item: "Service-specific photo galleries", status: "In progress" },
    { item: "Weekly GBP posts", status: "Done" },
    { item: "Insurance & financing details", status: "Pending" },
    { item: "Before/after carousel", status: "In progress" },
    { item: "Booking link on every location", status: "Done" },
  ],
  "biz-casa-verde": [
    { item: "Menu uploaded to GBP", status: "Done" },
    { item: "Photos updated weekly", status: "Done" },
    { item: "GBP posts for special menus", status: "In progress" },
    { item: "Reservation link visible", status: "Done" },
    { item: "Reply to every review", status: "In progress" },
    { item: "Holiday hours configured", status: "Done" },
  ],
};

// ---------- Content drafts ----------

const contentByBusiness: Record<string, ContentAsset[]> = {
  "biz-morby": [
    { id: "c-m1", businessId: "biz-morby", serviceId: "svc-morby-facial", locale: "sv", kind: "meta_title", body: "Ansiktsbehandling i Danderyd | Mörby Fotvård och Skönhet", status: "draft", createdAt: "2026-04-12T08:00:00Z" },
    { id: "c-m2", businessId: "biz-morby", serviceId: "svc-morby-facial", locale: "sv", kind: "meta_description", body: "Professionell ansiktsbehandling i Danderyd med fokus på hudvård, lyster och personlig service.", status: "draft", createdAt: "2026-04-12T08:05:00Z" },
    { id: "c-m3", businessId: "biz-morby", serviceId: "svc-morby-facial", locale: "sv", kind: "h1", body: "Ansiktsbehandling i Danderyd för en friskare och mer balanserad hud", status: "draft", createdAt: "2026-04-12T08:08:00Z" },
    { id: "c-m4", businessId: "biz-morby", serviceId: "svc-morby-facial", locale: "sv", kind: "faq", body: "Vilken ansiktsbehandling passar min hudtyp? Vi hjälper dig att välja rätt behandling utifrån hudens behov.", status: "draft", createdAt: "2026-04-12T08:10:00Z" },
    { id: "c-m5", businessId: "biz-morby", serviceId: "svc-morby-facial", locale: "sv", kind: "gbp_post", body: "Ge huden ny lyster med en professionell ansiktsbehandling i Danderyd.", status: "pending_review", createdAt: "2026-04-12T08:15:00Z" },
  ],
  "biz-luma-dental": [
    { id: "c-l1", businessId: "biz-luma-dental", serviceId: "svc-luma-invisalign", locale: "en", kind: "meta_title", body: "Invisalign in Brooklyn — Luma Dental Studio", status: "draft", createdAt: "2026-04-18T09:00:00Z" },
    { id: "c-l2", businessId: "biz-luma-dental", serviceId: "svc-luma-invisalign", locale: "en", kind: "h1", body: "Modern Invisalign care in Park Slope and Williamsburg", status: "approved", createdAt: "2026-04-18T09:10:00Z" },
    { id: "c-l3", businessId: "biz-luma-dental", serviceId: "svc-luma-whitening", locale: "en", kind: "faq", body: "Is professional whitening safe for sensitive teeth? Yes — we use a low-sensitivity gel system.", status: "draft", createdAt: "2026-04-18T09:20:00Z" },
    { id: "c-l4", businessId: "biz-luma-dental", serviceId: "svc-luma-invisalign", locale: "en", kind: "gbp_post", body: "Curious about Invisalign? Book a free consultation at Park Slope or Williamsburg.", status: "scheduled", createdAt: "2026-04-19T13:00:00Z" },
  ],
  "biz-casa-verde": [
    { id: "c-c1", businessId: "biz-casa-verde", serviceId: "svc-casa-tasting", locale: "es", kind: "meta_title", body: "Menú degustación mediterráneo en Russafa | Casa Verde", status: "approved", createdAt: "2026-04-22T19:00:00Z" },
    { id: "c-c2", businessId: "biz-casa-verde", serviceId: "svc-casa-tasting", locale: "es", kind: "h1", body: "Un viaje por el Mediterráneo, plato a plato, en Russafa", status: "approved", createdAt: "2026-04-22T19:05:00Z" },
    { id: "c-c3", businessId: "biz-casa-verde", serviceId: "svc-casa-tasting", locale: "es", kind: "gbp_post", body: "Nuevo menú degustación de primavera — siete pasos con maridaje opcional.", status: "scheduled", createdAt: "2026-04-23T11:00:00Z" },
  ],
};

// ---------- Tasks ----------

export function planFor(businessId: string): PlatformTask[] {
  const focus = ["Audit", "Content", "Reviews", "GBP", "Authority", "Reporting"];
  return Array.from({ length: 13 }, (_, i) => i + 1).flatMap((week) => [
    {
      id: `${businessId}-w${week}-a`, businessId,
      title: `Week ${week} · Improve local entity signals`,
      category: focus[week % focus.length],
      priority: week < 5 ? "High" : "Medium",
      impact: "High",
      difficulty: week % 3 === 0 ? "Medium" : "Low",
      week,
      status: week < 3 ? "completed" : week === 3 ? "in_progress" : "pending",
    } as PlatformTask,
    {
      id: `${businessId}-w${week}-b`, businessId,
      title: `Week ${week} · Publish localised content update`,
      category: "Content",
      priority: "Medium", impact: "Medium", difficulty: "Low",
      week,
      status: week < 2 ? "completed" : "pending",
    } as PlatformTask,
  ]);
}

// ---------- Agents (definitions only — runs live in `agents/registry.ts`) ----------

export const agentDefinitions: AgentDefinition[] = [
  { id: "local-seo", name: "Local SEO Auditor", role: "Audits site, local signals, page structure and ranking opportunities.", scopes: ["business", "location"], inputSchema: "BusinessOrLocationRef", outputSchema: "AuditReport", requiresApproval: false },
  { id: "website-seo", name: "Website SEO Agent", role: "Reviews on-page SEO, structured data, internal linking, page speed.", scopes: ["business"], inputSchema: "WebsiteRef", outputSchema: "OnPageAudit", requiresApproval: false },
  { id: "gbp", name: "Google Business Profile Agent", role: "Optimises services, categories, posts, photos and review signals.", scopes: ["location"], inputSchema: "LocationRef", outputSchema: "GbpPlan", requiresApproval: true },
  { id: "competitor", name: "Competitor Intelligence Agent", role: "Compares the business against nearby competitors at any location.", scopes: ["business", "location"], inputSchema: "BusinessOrLocationRef", outputSchema: "CompetitorReport", requiresApproval: false },
  { id: "content", name: "Content Strategy Agent", role: "Generates localised SEO copy, FAQs, posts and landing page recommendations.", scopes: ["business", "service"], inputSchema: "ServiceOrBusinessRef", outputSchema: "ContentPlan", requiresApproval: true },
  { id: "review", name: "Review Growth Agent", role: "Designs review acquisition campaigns and reply suggestions.", scopes: ["business", "location"], inputSchema: "LocationRef", outputSchema: "ReviewCampaign", requiresApproval: true },
  { id: "social-content", name: "Social Content Agent", role: "Drafts platform-aware captions, hashtags and post variants for any channel.", scopes: ["business", "service", "campaign"], inputSchema: "SocialBrief", outputSchema: "SocialCopy", requiresApproval: true },
  { id: "social-image", name: "Social Image Agent", role: "Generates image briefs and assets ready for LinkedIn, Instagram, Facebook, GBP, ads.", scopes: ["business", "service", "campaign"], inputSchema: "ImageBrief", outputSchema: "SocialImageAsset", requiresApproval: true },
  { id: "entity", name: "Entity Optimisation Agent", role: "Strengthens brand association with featured services and primary geo queries.", scopes: ["business"], inputSchema: "BusinessRef", outputSchema: "EntityPlan", requiresApproval: false },
  { id: "reporting", name: "Reporting Agent", role: "Produces executive and operational SEO/growth reports in the chosen locale.", scopes: ["business", "organization"], inputSchema: "ReportRef", outputSchema: "Report", requiresApproval: false },
  { id: "planner", name: "Task Planner Agent", role: "Turns insights into a 90-day execution plan tailored to the business.", scopes: ["business"], inputSchema: "BusinessRef", outputSchema: "Plan", requiresApproval: false },
  { id: "campaign", name: "Campaign Agent", role: "Coordinates multi-channel campaigns (content + social + image + reporting).", scopes: ["business", "campaign"], inputSchema: "CampaignBrief", outputSchema: "CampaignPlan", requiresApproval: true },
];

// ---------- Demo seed image assets and posts ----------

export const seedImageAssets: SocialImageAsset[] = [
  {
    id: "img-seed-1",
    businessId: "biz-morby",
    serviceId: "svc-morby-facial",
    platform: "instagram_feed",
    aspectRatio: "1:1",
    visualStyle: "Soft Scandinavian editorial",
    campaignGoal: "Bookings for spring facial protocol",
    audience: "Women 28-55 in Danderyd",
    language: "sv",
    brandTone: "Warm, expert, Scandinavian calm",
    prompt: "Soft natural light editorial photography of a facial treatment room, sage and cream tones, calm composition, no faces.",
    caption: "Ge huden ny lyster — boka din ansiktsbehandling i Danderyd.",
    hashtags: ["#ansiktsbehandling", "#danderyd", "#hudvård"],
    altText: "Sage-toned facial treatment room with soft natural light.",
    cta: "Boka nu",
    imageUrl: "demo://placeholder",
    provider: "demo",
    status: "approved",
    createdAt: "2026-04-29T10:00:00Z",
  },
  {
    id: "img-seed-2",
    businessId: "biz-luma-dental",
    serviceId: "svc-luma-invisalign",
    platform: "linkedin",
    aspectRatio: "4:5",
    visualStyle: "Clean editorial, premium dental",
    campaignGoal: "Educate professionals on Invisalign",
    audience: "Working professionals 26-45 in Brooklyn",
    language: "en",
    brandTone: "Modern, trustworthy, premium",
    prompt: "Editorial photo of clear aligners with soft blue background, premium clinic aesthetic, modern typography overlay area.",
    caption: "Straighter teeth, on a schedule that respects yours. Invisalign at Luma Dental Studio.",
    hashtags: ["#Invisalign", "#Brooklyn", "#CosmeticDentistry"],
    altText: "Premium product shot of Invisalign clear aligners against a soft blue background.",
    cta: "Book a consult",
    imageUrl: "demo://placeholder",
    provider: "demo",
    status: "pending_review",
    createdAt: "2026-05-03T13:30:00Z",
  },
  {
    id: "img-seed-3",
    businessId: "biz-casa-verde",
    serviceId: "svc-casa-tasting",
    platform: "instagram_story",
    aspectRatio: "9:16",
    visualStyle: "Warm, vibrant Mediterranean",
    campaignGoal: "Reservations for spring tasting menu",
    audience: "Locals & visitors in Valencia",
    language: "es",
    brandTone: "Friendly, vibrant, locally-rooted",
    prompt: "Vertical lifestyle photo of a spring tasting plate, terracotta and olive tones, warm natural light, no text overlays.",
    caption: "Siete pasos por el Mediterráneo. Reserva tu menú degustación en Russafa.",
    hashtags: ["#russafa", "#valenciafood", "#menudegustacion"],
    altText: "Spring tasting plate photographed in warm natural light, terracotta tones.",
    cta: "Reservar",
    imageUrl: "demo://placeholder",
    provider: "demo",
    status: "approved",
    createdAt: "2026-05-04T18:00:00Z",
  },
];

export const seedSocialPosts: SocialPost[] = [
  { id: "post-1", businessId: "biz-morby", imageAssetId: "img-seed-1", platform: "instagram_feed", locale: "sv", caption: "Ge huden ny lyster — boka din ansiktsbehandling i Danderyd.", hashtags: ["#ansiktsbehandling", "#danderyd"], status: "scheduled", scheduledFor: "2026-05-18T08:00:00Z" },
  { id: "post-2", businessId: "biz-luma-dental", imageAssetId: "img-seed-2", platform: "linkedin", locale: "en", caption: "Straighter teeth on a schedule that respects yours.", hashtags: ["#Invisalign", "#Brooklyn"], status: "pending_review" },
];

// ---------- Campaigns ----------

export const campaigns: Campaign[] = [
  { id: "camp-1", businessId: "biz-morby", name: "Spring Facial Push", goal: "20 new facial bookings in 30 days", startDate: "2026-05-01", endDate: "2026-05-31", status: "active" },
  { id: "camp-2", businessId: "biz-luma-dental", name: "Invisalign Awareness", goal: "30 consultations across both locations", startDate: "2026-05-05", endDate: "2026-06-15", status: "active" },
  { id: "camp-3", businessId: "biz-casa-verde", name: "Spring Tasting Launch", goal: "Fill weekend tasting menu reservations", startDate: "2026-04-20", endDate: "2026-06-01", status: "active" },
];

// ---------- Snapshot helper ----------

export interface BusinessSnapshot {
  business: Business;
  locations: BusinessLocation[];
  services: BusinessService[];
  metrics: DashboardMetric[];
  rankingTrend: { week: string; rank: number }[];
  reviewsGrowth: { month: string; reviews: number; mentions: number }[];
  competitors: Competitor[];
  reviews: Review[];
  content: ContentAsset[];
  imageAssets: SocialImageAsset[];
  socialPosts: SocialPost[];
  campaigns: Campaign[];
  plan: PlatformTask[];
  gbpChecklist: { item: string; status: "Pending" | "In progress" | "Done" }[];
}

export function getBusinessSnapshot(businessId: string): BusinessSnapshot {
  const business = businesses.find((b) => b.id === businessId) ?? businesses[0];
  return buildBusinessSnapshot(
    business,
    locations.filter((l) => l.businessId === business.id),
    services.filter((s) => s.businessId === business.id),
  );
}

/**
 * Build a snapshot for any business object — works for both seed tenants (resolves seed data
 * for metrics/competitors/etc.) and user-created tenants (returns empty arrays so the UI shows
 * helpful empty states).
 */
export function buildBusinessSnapshot(
  business: Business,
  bizLocations: BusinessLocation[],
  bizServices: BusinessService[],
): BusinessSnapshot {
  return {
    business,
    locations: bizLocations,
    services: bizServices,
    metrics: metricsByBusiness[business.id] ?? [],
    rankingTrend: rankingByBusiness[business.id] ?? [],
    reviewsGrowth: reviewsGrowthByBusiness[business.id] ?? [],
    competitors: competitors.filter((c) => c.businessId === business.id),
    reviews: reviews.filter((r) => r.businessId === business.id),
    content: contentByBusiness[business.id] ?? [],
    imageAssets: seedImageAssets.filter((i) => i.businessId === business.id),
    socialPosts: seedSocialPosts.filter((p) => p.businessId === business.id),
    campaigns: campaigns.filter((c) => c.businessId === business.id),
    plan: planFor(business.id),
    gbpChecklist: gbpChecklistByBusiness[business.id] ?? defaultGbpChecklist(),
  };
}

/** Default Google Business Profile checklist for brand-new tenants. */
export function defaultGbpChecklist(): { item: string; status: "Pending" | "In progress" | "Done" }[] {
  return [
    { item: "Verify Google Business Profile ownership", status: "Pending" },
    { item: "Set primary and secondary categories", status: "Pending" },
    { item: "Add featured services with descriptions", status: "Pending" },
    { item: "Upload at least 10 photos (storefront, team, results)", status: "Pending" },
    { item: "Publish first weekly Google post", status: "Pending" },
    { item: "Set up a review request flow for new customers", status: "Pending" },
  ];
}

export function listBusinessesForOrg(orgId: string): Business[] {
  return businesses.filter((b) => b.organizationId === orgId);
}
