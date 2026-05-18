import { businesses, getBusinessSnapshot } from "@/lib/mock/universal";
import type { Locale } from "@/lib/types/core";

/**
 * OpenAI provider abstraction.
 *
 * Phase 1: returns business/service-scoped demo content so the same call works for any tenant.
 * Phase 3 will replace the demo branch with a server-only OpenAI Responses API call. The shape
 * of the returned object is intentionally stable.
 */
export async function generateSeoContent(args: {
  topic: string;
  businessId?: string;
  serviceId?: string;
  locale?: Locale;
}) {
  const businessId = args.businessId ?? businesses[0].id;
  const snap = getBusinessSnapshot(businessId);
  const items = args.serviceId
    ? snap.content.filter((c) => c.serviceId === args.serviceId)
    : snap.content;

  if (!process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_APP_MODE !== "live") {
    return {
      mode: "demo" as const,
      topic: args.topic,
      locale: args.locale ?? snap.business.primaryLocale,
      businessId,
      content: items.map((c) => ({ type: c.kind, text: c.body })),
    };
  }
  // Phase 3: implement OpenAI Responses API call here using OPENAI_API_KEY.
  return {
    mode: "live-placeholder" as const,
    topic: args.topic,
    locale: args.locale ?? snap.business.primaryLocale,
    businessId,
    content: items.map((c) => ({ type: c.kind, text: c.body })),
  };
}
