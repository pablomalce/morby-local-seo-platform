import type { IndustryVertical } from "@/lib/types/core";

/**
 * Industry presets feed the onboarding wizard with sensible defaults.
 * Adding a new vertical here automatically extends the wizard's industry select.
 */
export interface IndustryPreset {
  id: IndustryVertical;
  label: string;
  brandColor: string;
  suggestedTone: string;
  suggestedService: { name: string; primaryKeyword: string; description: string };
  suggestedGeoQuery: string;
}

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    id: "beauty_clinic",
    label: "Beauty / Skincare Clinic",
    brandColor: "#8FAF9A",
    suggestedTone: "Warm, expert, calm",
    suggestedService: {
      name: "Facial Treatments",
      primaryKeyword: "facial treatments [city]",
      description: "Personalised facials, deep cleansing, hydration and skin care.",
    },
    suggestedGeoQuery: "facial treatments [city]",
  },
  {
    id: "health_clinic",
    label: "Health / Medical Clinic",
    brandColor: "#3F7CAC",
    suggestedTone: "Trustworthy, clinical, reassuring",
    suggestedService: {
      name: "General Consultations",
      primaryKeyword: "medical consultation [city]",
      description: "Comprehensive consultations and diagnostic services.",
    },
    suggestedGeoQuery: "medical clinic [city]",
  },
  {
    id: "dental_clinic",
    label: "Dental Clinic",
    brandColor: "#3F7CAC",
    suggestedTone: "Modern, trustworthy, premium",
    suggestedService: {
      name: "Teeth Whitening",
      primaryKeyword: "teeth whitening [city]",
      description: "Professional whitening with low-sensitivity protocols.",
    },
    suggestedGeoQuery: "dentist [city]",
  },
  {
    id: "restaurant",
    label: "Restaurant",
    brandColor: "#C46A4E",
    suggestedTone: "Friendly, vibrant, locally-rooted",
    suggestedService: {
      name: "Tasting Menu",
      primaryKeyword: "tasting menu [city]",
      description: "Seasonal tasting menu with chef pairings.",
    },
    suggestedGeoQuery: "best restaurant [city]",
  },
  {
    id: "cafe",
    label: "Café / Bakery",
    brandColor: "#B07A52",
    suggestedTone: "Cozy, artisanal, neighbourly",
    suggestedService: {
      name: "Specialty Coffee",
      primaryKeyword: "specialty coffee [city]",
      description: "Single-origin specialty coffee and house-baked pastries.",
    },
    suggestedGeoQuery: "best cafe [city]",
  },
  {
    id: "retail",
    label: "Retail Store",
    brandColor: "#6C5CE7",
    suggestedTone: "Confident, curated, friendly",
    suggestedService: {
      name: "Curated Collection",
      primaryKeyword: "[product] shop [city]",
      description: "Hand-picked products with personalised in-store service.",
    },
    suggestedGeoQuery: "[product] store [city]",
  },
  {
    id: "professional_services",
    label: "Professional Services",
    brandColor: "#24312B",
    suggestedTone: "Sharp, expert, accountable",
    suggestedService: {
      name: "Strategy Consulting",
      primaryKeyword: "[service] consultant [city]",
      description: "Strategic engagements tailored to your goals.",
    },
    suggestedGeoQuery: "[service] consultant [city]",
  },
  {
    id: "franchise",
    label: "Local Franchise",
    brandColor: "#E26D5C",
    suggestedTone: "Familiar, dependable, energetic",
    suggestedService: {
      name: "Signature Offer",
      primaryKeyword: "[brand] [city]",
      description: "Our signature franchise experience, delivered locally.",
    },
    suggestedGeoQuery: "[brand] near me",
  },
  {
    id: "ecommerce_local",
    label: "E-commerce with local presence",
    brandColor: "#0E9F6E",
    suggestedTone: "Modern, transparent, helpful",
    suggestedService: {
      name: "Local Pickup",
      primaryKeyword: "[product] local pickup [city]",
      description: "Order online, pick up locally with friendly service.",
    },
    suggestedGeoQuery: "[product] [city] pickup",
  },
  {
    id: "repair_services",
    label: "Repair Services",
    brandColor: "#475569",
    suggestedTone: "Practical, fast, reliable",
    suggestedService: {
      name: "Same-day Repair",
      primaryKeyword: "[item] repair [city]",
      description: "Quick, reliable repairs with transparent pricing.",
    },
    suggestedGeoQuery: "[item] repair near me",
  },
  {
    id: "home_services",
    label: "Home Services",
    brandColor: "#0EA5E9",
    suggestedTone: "Helpful, on-time, careful",
    suggestedService: {
      name: "Residential Cleaning",
      primaryKeyword: "home cleaning [city]",
      description: "Reliable, recurring home services with friendly staff.",
    },
    suggestedGeoQuery: "home services [city]",
  },
  {
    id: "gym",
    label: "Gym / Fitness Studio",
    brandColor: "#F97316",
    suggestedTone: "Motivating, energetic, supportive",
    suggestedService: {
      name: "Personal Training",
      primaryKeyword: "personal trainer [city]",
      description: "1:1 personal training plans designed for your goals.",
    },
    suggestedGeoQuery: "gym [city]",
  },
  {
    id: "spa",
    label: "Spa / Wellness",
    brandColor: "#A78BFA",
    suggestedTone: "Calm, restorative, premium",
    suggestedService: {
      name: "Signature Massage",
      primaryKeyword: "massage [city]",
      description: "Signature massage rituals in a calm setting.",
    },
    suggestedGeoQuery: "spa [city]",
  },
  {
    id: "salon",
    label: "Hair / Beauty Salon",
    brandColor: "#EC4899",
    suggestedTone: "Stylish, friendly, on-trend",
    suggestedService: {
      name: "Signature Cut & Color",
      primaryKeyword: "hair salon [city]",
      description: "Expert cut, color and styling with personalised care.",
    },
    suggestedGeoQuery: "hair salon [city]",
  },
  {
    id: "other",
    label: "Other / Custom",
    brandColor: "#8FAF9A",
    suggestedTone: "Friendly and professional",
    suggestedService: {
      name: "Featured Service",
      primaryKeyword: "[service] [city]",
      description: "Describe your featured service here.",
    },
    suggestedGeoQuery: "[service] [city]",
  },
];

export function getIndustryPreset(id: IndustryVertical): IndustryPreset {
  return INDUSTRY_PRESETS.find((p) => p.id === id) ?? INDUSTRY_PRESETS[INDUSTRY_PRESETS.length - 1];
}
