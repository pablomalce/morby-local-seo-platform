/**
 * Image generation provider — provider-agnostic, OpenAI-first.
 *
 * Phase 1 ships a polished SVG demo generator so the platform feels real without burning tokens
 * or exposing keys. Phase 3 will replace the demo branch with a server-only OpenAI Images call
 * (`gpt-image-1`). The returned shape never changes — callers get a `SocialImageAsset` ready to
 * persist and approve.
 */

import type { AspectRatio, Locale, SocialImageAsset, SocialPlatform, WorkflowStatus } from "@/lib/types/core";

export interface ImageBrief {
  businessId: string;
  businessName: string;
  brandColor: string;
  brandTone: string;
  serviceId?: string;
  serviceName?: string;
  locationId?: string;
  platform: SocialPlatform;
  aspectRatio: AspectRatio;
  visualStyle: string;
  campaignGoal: string;
  audience: string;
  language: Locale;
  cta: string;
  prompt?: string;
}

export interface ImageGenerationResult extends SocialImageAsset {}

const ASPECT_DIMENSIONS: Record<AspectRatio, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "3:2": { w: 1500, h: 1000 },
  "2:3": { w: 1000, h: 1500 },
};

const CTA_DEFAULTS: Record<Locale, string> = {
  en: "Book now",
  es: "Reservar",
  sv: "Boka nu",
};

const CAPTION_TEMPLATES: Record<Locale, (b: string, s: string) => string> = {
  en: (business, service) => `${service} at ${business} — tailored to you.`,
  es: (business, service) => `${service} en ${business} — pensado para ti.`,
  sv: (business, service) => `${service} hos ${business} — anpassat för dig.`,
};

function buildPrompt(brief: ImageBrief): string {
  if (brief.prompt && brief.prompt.trim().length > 0) return brief.prompt;
  const service = brief.serviceName ? `for "${brief.serviceName}"` : "";
  return [
    `Premium ${brief.visualStyle.toLowerCase()} ${brief.platform.replace(/_/g, " ")} image ${service} for ${brief.businessName}.`,
    `Audience: ${brief.audience}.`,
    `Campaign goal: ${brief.campaignGoal}.`,
    `Brand tone: ${brief.brandTone}.`,
    `No text overlays. Photographic style, soft natural light, professional composition. Leave negative space for typography.`,
  ].join(" ");
}

function buildCaption(brief: ImageBrief): { caption: string; hashtags: string[]; alt: string } {
  const service = brief.serviceName ?? "our featured service";
  const baseCaption = CAPTION_TEMPLATES[brief.language](brief.businessName, service);
  const goalLine = brief.campaignGoal ? ` ${brief.campaignGoal}.` : "";
  const cta = brief.cta || CTA_DEFAULTS[brief.language];
  const caption = `${baseCaption}${goalLine} ${cta}.`.trim();
  const hashtags = Array.from(
    new Set([
      brief.serviceName?.toLowerCase().replace(/\s+/g, ""),
      brief.businessName.split(" ")[0].toLowerCase(),
      brief.platform.replace(/_/g, ""),
    ].filter(Boolean) as string[]),
  ).map((h) => `#${h}`);
  const alt = `${service} — ${brief.visualStyle.toLowerCase()} image for ${brief.businessName}`;
  return { caption, hashtags, alt };
}

function buildDemoSvg(brief: ImageBrief): string {
  const { w, h } = ASPECT_DIMENSIONS[brief.aspectRatio];
  const accent = brief.brandColor;
  const text = brief.serviceName ?? brief.businessName;
  const subtitle = brief.campaignGoal || brief.visualStyle;
  const cta = brief.cta || CTA_DEFAULTS[brief.language];

  // Premium SVG: layered gradients + brand color block + restrained typography.
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' width='${w}' height='${h}'>
    <defs>
      <linearGradient id='bg' x1='0%' y1='0%' x2='100%' y2='100%'>
        <stop offset='0%' stop-color='#F7F1E8'/>
        <stop offset='60%' stop-color='#FBF8F2'/>
        <stop offset='100%' stop-color='#EEE7DA'/>
      </linearGradient>
      <linearGradient id='accent' x1='0%' y1='0%' x2='0%' y2='100%'>
        <stop offset='0%' stop-color='${accent}' stop-opacity='0.85'/>
        <stop offset='100%' stop-color='${accent}' stop-opacity='0.55'/>
      </linearGradient>
      <filter id='soft' x='-10%' y='-10%' width='120%' height='120%'>
        <feGaussianBlur stdDeviation='40'/>
      </filter>
    </defs>
    <rect width='${w}' height='${h}' fill='url(#bg)'/>
    <circle cx='${w * 0.85}' cy='${h * 0.18}' r='${Math.min(w, h) * 0.28}' fill='url(#accent)' filter='url(#soft)'/>
    <circle cx='${w * 0.15}' cy='${h * 0.82}' r='${Math.min(w, h) * 0.22}' fill='${accent}' fill-opacity='0.18' filter='url(#soft)'/>
    <rect x='${w * 0.06}' y='${h * 0.55}' width='${w * 0.42}' height='${h * 0.012}' rx='6' fill='${accent}'/>
    <text x='${w * 0.06}' y='${h * 0.5}' font-family='Inter, Helvetica, Arial, sans-serif' font-size='${Math.round(w * 0.052)}' font-weight='700' fill='#24312B'>${escapeXml(text)}</text>
    <text x='${w * 0.06}' y='${h * 0.62}' font-family='Inter, Helvetica, Arial, sans-serif' font-size='${Math.round(w * 0.022)}' fill='#24312B' fill-opacity='0.7'>${escapeXml(subtitle)}</text>
    <text x='${w * 0.06}' y='${h * 0.93}' font-family='Inter, Helvetica, Arial, sans-serif' font-size='${Math.round(w * 0.018)}' font-weight='600' fill='${accent}'>${escapeXml(cta)} →</text>
    <text x='${w * 0.94}' y='${h * 0.93}' text-anchor='end' font-family='Inter, Helvetica, Arial, sans-serif' font-size='${Math.round(w * 0.014)}' fill='#24312B' fill-opacity='0.4'>${escapeXml(brief.businessName)}</text>
  </svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toDataUri(svg: string): string {
  // Base64-encode to ensure broad compatibility with <img src>.
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

export async function generateImage(brief: ImageBrief): Promise<ImageGenerationResult> {
  const prompt = buildPrompt(brief);
  const { caption, hashtags, alt } = buildCaption(brief);
  const status: WorkflowStatus = "pending_review";
  const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Demo branch — Phase 1.
  if (!process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_APP_MODE !== "live") {
    const svg = buildDemoSvg(brief);
    return {
      id,
      businessId: brief.businessId,
      serviceId: brief.serviceId,
      locationId: brief.locationId,
      platform: brief.platform,
      aspectRatio: brief.aspectRatio,
      visualStyle: brief.visualStyle,
      campaignGoal: brief.campaignGoal,
      audience: brief.audience,
      language: brief.language,
      brandTone: brief.brandTone,
      prompt,
      caption,
      hashtags,
      altText: alt,
      cta: brief.cta || CTA_DEFAULTS[brief.language],
      imageUrl: toDataUri(svg),
      provider: "demo",
      status,
      createdAt: new Date().toISOString(),
    };
  }

  // Phase 3: Replace with OpenAI Images API call here (server-only).
  // const result = await fetch("https://api.openai.com/v1/images/generations", { ... });
  return {
    id,
    businessId: brief.businessId,
    serviceId: brief.serviceId,
    locationId: brief.locationId,
    platform: brief.platform,
    aspectRatio: brief.aspectRatio,
    visualStyle: brief.visualStyle,
    campaignGoal: brief.campaignGoal,
    audience: brief.audience,
    language: brief.language,
    brandTone: brief.brandTone,
    prompt,
    caption,
    hashtags,
    altText: alt,
    cta: brief.cta || CTA_DEFAULTS[brief.language],
    imageUrl: toDataUri(buildDemoSvg(brief)),
    provider: "openai",
    status,
    createdAt: new Date().toISOString(),
  };
}
