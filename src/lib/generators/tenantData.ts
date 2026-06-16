/**
 * Tenant Data Generator
 *
 * Produces deterministic, plausible demo data for ANY business (seed or user-created) based on
 * its industry, services, locations and locale. The same business ID always yields the same data
 * so the UI is stable across reloads.
 *
 * Used by `buildBusinessSnapshot` when no curated seed data exists for the business.
 */

import type {
  Business,
  BusinessLocation,
  BusinessService,
  Competitor,
  ContentAsset,
  DashboardMetric,
  IndustryVertical,
  Review,
} from "@/lib/types/core";

// ---------- Seeded PRNG ----------

/** Deterministic pseudo-random generator: stable per business id. */
function mulberry32(seed: number) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function range(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

// ---------- Industry archetypes ----------

interface IndustryArchetype {
  competitorNouns: string[];
  reviewMentions: string[];
  reviewSentiments: string[];
  contentTone: string;
  positiveAdjective: string;
}

const ARCHETYPES: Record<IndustryVertical, IndustryArchetype> = {
  beauty_clinic: {
    competitorNouns: ["Beauty", "Skin Studio", "Aesthetic Lab", "Glow", "Hudvård"],
    reviewMentions: ["the facial", "the skin treatment", "the staff", "the products"],
    reviewSentiments: ["loved", "really enjoyed", "was impressed by", "felt great about"],
    contentTone: "calming and expert",
    positiveAdjective: "luminous",
  },
  health_clinic: {
    competitorNouns: ["Medical", "Health Center", "Clinic", "Wellness"],
    reviewMentions: ["the consultation", "the doctor", "the team", "the diagnosis process"],
    reviewSentiments: ["trusted", "appreciated", "felt reassured by", "valued"],
    contentTone: "trustworthy and clear",
    positiveAdjective: "reassuring",
  },
  dental_clinic: {
    competitorNouns: ["Dental", "Smile Studio", "Cosmetic Dentistry", "Aligners"],
    reviewMentions: ["the whitening", "the Invisalign experience", "the staff", "the office"],
    reviewSentiments: ["loved", "was thrilled by", "appreciated", "was impressed by"],
    contentTone: "modern and premium",
    positiveAdjective: "confident",
  },
  restaurant: {
    competitorNouns: ["Kitchen", "Bistro", "Cocina", "Trattoria", "Table"],
    reviewMentions: ["the tasting menu", "the wine pairing", "the service", "the chef"],
    reviewSentiments: ["enjoyed", "fell in love with", "raved about", "savored"],
    contentTone: "vibrant and rooted in place",
    positiveAdjective: "memorable",
  },
  cafe: {
    competitorNouns: ["Café", "Coffee Bar", "Bakery", "Roastery"],
    reviewMentions: ["the espresso", "the pastries", "the atmosphere", "the staff"],
    reviewSentiments: ["loved", "enjoyed", "couldn't get enough of", "appreciated"],
    contentTone: "cozy and artisanal",
    positiveAdjective: "warm",
  },
  retail: {
    competitorNouns: ["Shop", "Store", "Collection", "Boutique"],
    reviewMentions: ["the curation", "the staff knowledge", "the experience", "the selection"],
    reviewSentiments: ["loved", "appreciated", "enjoyed", "was impressed by"],
    contentTone: "confident and curated",
    positiveAdjective: "considered",
  },
  professional_services: {
    competitorNouns: ["Consulting", "Advisors", "Partners", "Group"],
    reviewMentions: ["the strategy session", "the deliverables", "the team's expertise", "the outcomes"],
    reviewSentiments: ["valued", "trusted", "was impressed by", "appreciated"],
    contentTone: "sharp and accountable",
    positiveAdjective: "decisive",
  },
  franchise: {
    competitorNouns: ["Brand", "Local", "Express", "Hub"],
    reviewMentions: ["the consistency", "the staff", "the value", "the local touch"],
    reviewSentiments: ["loved", "enjoyed", "appreciated", "valued"],
    contentTone: "familiar and energetic",
    positiveAdjective: "reliable",
  },
  ecommerce_local: {
    competitorNouns: ["Shop", "Goods", "Co.", "Direct"],
    reviewMentions: ["the pickup experience", "the staff", "the product quality", "the speed"],
    reviewSentiments: ["loved", "appreciated", "enjoyed", "valued"],
    contentTone: "modern and transparent",
    positiveAdjective: "smooth",
  },
  repair_services: {
    competitorNouns: ["Repair", "Fix", "Service Center", "Workshop"],
    reviewMentions: ["the turnaround", "the price", "the staff", "the diagnostic"],
    reviewSentiments: ["appreciated", "was impressed by", "valued", "trusted"],
    contentTone: "practical and reliable",
    positiveAdjective: "trustworthy",
  },
  home_services: {
    competitorNouns: ["Home", "Pro Services", "Cleaning Co.", "Local Pros"],
    reviewMentions: ["the punctuality", "the staff", "the result", "the care"],
    reviewSentiments: ["loved", "appreciated", "valued", "trusted"],
    contentTone: "helpful and careful",
    positiveAdjective: "thorough",
  },
  gym: {
    competitorNouns: ["Gym", "Fitness Studio", "Athletic Club", "Performance"],
    reviewMentions: ["the personal training", "the trainers", "the equipment", "the community"],
    reviewSentiments: ["loved", "was motivated by", "appreciated", "thrived at"],
    contentTone: "motivating and energetic",
    positiveAdjective: "energizing",
  },
  spa: {
    competitorNouns: ["Spa", "Wellness", "Sanctuary", "Retreat"],
    reviewMentions: ["the massage", "the rituals", "the atmosphere", "the staff"],
    reviewSentiments: ["loved", "relaxed at", "appreciated", "felt restored by"],
    contentTone: "calm and restorative",
    positiveAdjective: "restorative",
  },
  salon: {
    competitorNouns: ["Salon", "Hair Studio", "Beauty Bar", "Stylists"],
    reviewMentions: ["the cut", "the color", "the stylist", "the atmosphere"],
    reviewSentiments: ["loved", "appreciated", "was thrilled by", "couldn't stop talking about"],
    contentTone: "stylish and on-trend",
    positiveAdjective: "polished",
  },
  other: {
    competitorNouns: ["Studio", "Co.", "Lab", "Group"],
    reviewMentions: ["the service", "the team", "the experience", "the result"],
    reviewSentiments: ["loved", "appreciated", "enjoyed", "valued"],
    contentTone: "friendly and professional",
    positiveAdjective: "great",
  },
};

// ---------- Localized snippets ----------

interface LocaleStrings {
  metaTitleTpl: (svc: string, city: string, biz: string) => string;
  metaDescTpl: (svc: string, city: string) => string;
  h1Tpl: (svc: string, city: string) => string;
  faqTpl: (svc: string) => string;
  gbpPostTpl: (svc: string, city: string) => string;
  ctaTpl: (svc: string, city: string) => string;
  reviewTpl: (sentiment: string, mention: string, biz: string) => string;
  replyTpl: (mention: string) => string;
}

const STRINGS: Record<"en" | "es" | "sv", LocaleStrings> = {
  en: {
    metaTitleTpl: (s, c, b) => `${s} in ${c} — ${b}`,
    metaDescTpl: (s, c) => `Professional ${s.toLowerCase()} in ${c}. Personalised service, results-driven and locally trusted.`,
    h1Tpl: (s, c) => `Modern ${s.toLowerCase()} in ${c}, designed around you`,
    faqTpl: (s) => `What does a typical ${s.toLowerCase()} session look like? We start with a consultation, tailor the protocol and walk you through aftercare.`,
    gbpPostTpl: (s, c) => `Now booking ${s.toLowerCase()} in ${c}. Reserve your slot this week and see the difference for yourself.`,
    ctaTpl: (s, c) => `Book your ${s.toLowerCase()} in ${c} today.`,
    reviewTpl: (sent, mention, biz) => `I ${sent} ${mention} at ${biz}. Highly recommended.`,
    replyTpl: (mention) => `Thank you so much for the kind words about ${mention}! It means a lot to the whole team.`,
  },
  es: {
    metaTitleTpl: (s, c, b) => `${s} en ${c} — ${b}`,
    metaDescTpl: (s, c) => `${s} profesional en ${c}. Servicio personalizado, orientado a resultados y de confianza local.`,
    h1Tpl: (s, c) => `${s} moderno en ${c}, diseñado a tu medida`,
    faqTpl: (s) => `¿Cómo es una sesión típica de ${s.toLowerCase()}? Comenzamos con una consulta, adaptamos el protocolo y te acompañamos en el cuidado posterior.`,
    gbpPostTpl: (s, c) => `Ya puedes reservar ${s.toLowerCase()} en ${c}. Aparta tu cita esta semana y comprueba la diferencia.`,
    ctaTpl: (s, c) => `Reserva tu ${s.toLowerCase()} en ${c} hoy.`,
    reviewTpl: (sent, mention, biz) => `${sent.charAt(0).toUpperCase()}${sent.slice(1)} ${mention} en ${biz}. Muy recomendado.`,
    replyTpl: (mention) => `¡Gracias por tus palabras sobre ${mention}! Significa mucho para todo el equipo.`,
  },
  sv: {
    metaTitleTpl: (s, c, b) => `${s} i ${c} — ${b}`,
    metaDescTpl: (s, c) => `Professionell ${s.toLowerCase()} i ${c}. Personlig service, resultatdriven och lokalt betrodd.`,
    h1Tpl: (s, c) => `Modern ${s.toLowerCase()} i ${c}, anpassad efter dig`,
    faqTpl: (s) => `Hur ser ett typiskt ${s.toLowerCase()}-pass ut? Vi börjar med en konsultation, anpassar protokollet och guidar dig genom eftervården.`,
    gbpPostTpl: (s, c) => `Boka ${s.toLowerCase()} i ${c}. Reservera din tid den här veckan och upplev skillnaden.`,
    ctaTpl: (s, c) => `Boka din ${s.toLowerCase()} i ${c} idag.`,
    reviewTpl: (sent, mention, biz) => `Jag ${sent} ${mention} hos ${biz}. Varmt rekommenderat.`,
    replyTpl: (mention) => `Tack så mycket för dina fina ord om ${mention}! Det betyder mycket för hela teamet.`,
  },
};

// ---------- Generators ----------

export function generateMetrics(business: Business, rand: () => number): DashboardMetric[] {
  const rank = range(rand, 4, 9);
  const gbp = range(rand, 55, 78);
  const reviews = range(rand, 32, 180);
  const mentions = range(rand, 6, 18);
  const plan = range(rand, 12, 35);
  const week = Math.max(1, Math.floor(plan / 8));
  return [
    { key: "rank", label: "metrics.rank", value: `#${rank}`, delta: `+${range(rand, 1, 3)}`, note: "metrics.rank.note" },
    { key: "gbp", label: "metrics.gbp", value: `${gbp}%`, delta: `+${range(rand, 6, 18)}%`, note: "metrics.gbp.note" },
    { key: "reviews", label: "metrics.reviews", value: `${reviews}`, delta: `${mentions} service mentions`, note: "metrics.reviews.note" },
    { key: "plan", label: "metrics.plan", value: `${plan}%`, delta: `Week ${week}`, note: "metrics.plan.note" },
  ];
}

export function generateRankingTrend(rand: () => number): { week: string; rank: number }[] {
  const start = range(rand, 9, 14);
  const trend: number[] = [start];
  for (let i = 1; i < 6; i++) {
    const last = trend[trend.length - 1];
    trend.push(Math.max(2, last - range(rand, 0, 2)));
  }
  return ["W1", "W2", "W3", "W4", "W5", "Now"].map((week, i) => ({ week, rank: trend[i] }));
}

export function generateReviewsGrowth(rand: () => number): { month: string; reviews: number; mentions: number }[] {
  const base = range(rand, 40, 140);
  const months = ["Jan", "Feb", "Mar", "Apr", "May"];
  let r = base;
  let m = Math.floor(base * 0.08);
  return months.map((month) => {
    r += range(rand, 4, 12);
    m += range(rand, 1, 4);
    return { month, reviews: r, mentions: m };
  });
}

export function generateGbpChecklist(rand: () => number): { item: string; status: "Pending" | "In progress" | "Done" }[] {
  const items = [
    "Primary and secondary categories reviewed",
    "Featured service highlighted",
    "Weekly Google posts calendar",
    "Service photos uploaded",
    "Review request process for primary service",
    "Service descriptions optimised in primary language",
  ];
  const statuses: ("Pending" | "In progress" | "Done")[] = ["Pending", "In progress", "Done"];
  return items.map((item) => ({ item, status: pick(rand, statuses) }));
}

export function generateCompetitors(
  business: Business,
  locations: BusinessLocation[],
  rand: () => number,
): Competitor[] {
  const arch = ARCHETYPES[business.industry] ?? ARCHETYPES.other;
  const city = locations[0]?.city ?? "your area";
  const count = 3;
  return Array.from({ length: count }, (_, i) => {
    const noun = arch.competitorNouns[i % arch.competitorNouns.length];
    const variant = pick(rand, ["", " Co.", " Studio", ` ${city}`, " Lab", " Group"]);
    const name = `${noun}${variant}`.trim();
    const rating = +(3.8 + rand() * 1.1).toFixed(1);
    const reviews = range(rand, 40, 280);
    const strength = range(rand, 60, 88);
    const relevance = range(rand, 55, 90);
    return {
      id: `${business.id}-cmp-${i + 1}`,
      businessId: business.id,
      name,
      website: undefined,
      rating,
      reviewCount: reviews,
      strengthScore: strength,
      relevanceScore: relevance,
      strengths: [
        `Strong ${arch.contentTone} positioning`,
        `Established presence in ${city}`,
        i === 0 ? "Higher review volume than average" : "Clear service identity",
      ],
      weaknesses: [
        "Generic local content without geo specifics",
        i === 1 ? "Outdated website" : "Inconsistent posting cadence",
      ],
      opportunities: [
        `Build deeper ${city}-specific content for the featured service`,
        "Increase service-specific review volume",
        "Publish consistent GBP posts",
      ],
    };
  });
}

export function generateReviews(business: Business, services: BusinessService[], rand: () => number): Review[] {
  const arch = ARCHETYPES[business.industry] ?? ARCHETYPES.other;
  const locale = business.primaryLocale;
  const lang = STRINGS[locale];
  const featured = services.find((s) => s.isFeatured) ?? services[0];
  const featuredName = featured?.name ?? "service";
  const names = ["Alex", "Sam", "Jordan", "Taylor", "Mia", "Noa", "Luca", "Iris", "Theo", "Eva"];
  const count = 5;
  return Array.from({ length: count }, (_, i) => {
    const author = `${pick(rand, names)} ${pick(rand, ["L", "M", "P", "R", "K", "S"])}.`;
    const rating = pick(rand, [4, 5, 5, 5]);
    const sentiment = pick(rand, arch.reviewSentiments);
    const mention = pick(rand, arch.reviewMentions);
    return {
      id: `${business.id}-rv-${i + 1}`,
      businessId: business.id,
      author,
      rating,
      text: lang.reviewTpl(sentiment, mention, business.name),
      serviceMentioned: i < 3 ? featuredName : undefined,
      suggestedReply: lang.replyTpl(mention),
      status: i === 0 ? "pending_review" : "approved",
      receivedAt: new Date(Date.now() - (i + 1) * 86400000 * range(rand, 1, 7)).toISOString(),
    } as Review;
  });
}

export function generateContent(
  business: Business,
  locations: BusinessLocation[],
  services: BusinessService[],
  rand: () => number,
): ContentAsset[] {
  const featured = services.find((s) => s.isFeatured) ?? services[0];
  if (!featured) return [];
  const city = locations[0]?.city ?? "your city";
  const lang = STRINGS[business.primaryLocale];
  const kinds: Array<{ kind: string; body: string }> = [
    { kind: "meta_title", body: lang.metaTitleTpl(featured.name, city, business.name) },
    { kind: "meta_description", body: lang.metaDescTpl(featured.name, city) },
    { kind: "h1", body: lang.h1Tpl(featured.name, city) },
    { kind: "faq", body: lang.faqTpl(featured.name) },
    { kind: "gbp_post", body: lang.gbpPostTpl(featured.name, city) },
    { kind: "cta", body: lang.ctaTpl(featured.name, city) },
  ];
  const statuses: Array<ContentAsset["status"]> = ["draft", "draft", "pending_review", "approved", "scheduled", "draft"];
  return kinds.map((k, i) => ({
    id: `${business.id}-content-${i + 1}`,
    businessId: business.id,
    serviceId: featured.id,
    locale: business.primaryLocale,
    kind: k.kind,
    body: k.body,
    targetKeyword: featured.primaryKeyword,
    status: statuses[i % statuses.length],
    createdAt: new Date(Date.now() - i * 86400000).toISOString(),
  }));
}

// ---------- Façade ----------

export interface GeneratedTenantData {
  metrics: DashboardMetric[];
  rankingTrend: { week: string; rank: number }[];
  reviewsGrowth: { month: string; reviews: number; mentions: number }[];
  gbpChecklist: { item: string; status: "Pending" | "In progress" | "Done" }[];
  competitors: Competitor[];
  reviews: Review[];
  content: ContentAsset[];
}

export function generateTenantData(
  business: Business,
  locations: BusinessLocation[],
  services: BusinessService[],
): GeneratedTenantData {
  const rand = mulberry32(seedFromId(business.id));
  return {
    metrics: generateMetrics(business, rand),
    rankingTrend: generateRankingTrend(rand),
    reviewsGrowth: generateReviewsGrowth(rand),
    gbpChecklist: generateGbpChecklist(rand),
    competitors: generateCompetitors(business, locations, rand),
    reviews: generateReviews(business, services, rand),
    content: generateContent(business, locations, services, rand),
  };
}
