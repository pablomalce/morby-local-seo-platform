import { NextResponse } from "next/server";
import { z } from "zod";
import { businesses, locations as allLocations, services as allServices } from "@/lib/mock/universal";
import { generateImage } from "@/lib/integrations/imageProvider";
import type { ImageBrief } from "@/lib/integrations/imageProvider";

const schema = z.object({
  businessId: z.string(),
  serviceId: z.string().optional(),
  locationId: z.string().optional(),
  platform: z.enum([
    "linkedin",
    "instagram_feed",
    "instagram_story",
    "facebook",
    "x_twitter",
    "gbp_post",
    "website_banner",
    "ad_creative",
  ]),
  aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9", "3:2", "2:3"]),
  visualStyle: z.string().min(2),
  campaignGoal: z.string().min(2),
  audience: z.string().min(2),
  language: z.enum(["en", "es", "sv"]),
  brandTone: z.string().optional(),
  cta: z.string().optional(),
  prompt: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    const business = businesses.find((b) => b.id === body.businessId);
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }
    const service = body.serviceId ? allServices.find((s) => s.id === body.serviceId) : undefined;
    const location = body.locationId ? allLocations.find((l) => l.id === body.locationId) : undefined;

    const brief: ImageBrief = {
      businessId: business.id,
      businessName: business.name,
      brandColor: business.logoColor,
      brandTone: body.brandTone ?? business.brandTone,
      serviceId: service?.id,
      serviceName: service?.name,
      locationId: location?.id,
      platform: body.platform,
      aspectRatio: body.aspectRatio,
      visualStyle: body.visualStyle,
      campaignGoal: body.campaignGoal,
      audience: body.audience,
      language: body.language,
      cta: body.cta ?? "",
      prompt: body.prompt,
    };

    const asset = await generateImage(brief);
    return NextResponse.json(asset);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
