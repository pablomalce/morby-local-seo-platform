import { NextResponse } from "next/server";
import { z } from "zod";
import { businesses, getBusinessSnapshot } from "@/lib/mock/universal";

const schema = z.object({
  businessId: z.string().optional(),
  kind: z.enum(["weekly", "monthly", "executive", "technical"]).default("weekly"),
  locale: z.enum(["en", "es", "sv"]).default("en"),
});

export async function POST(req: Request) {
  try {
    const body = req.body ? schema.parse(await req.json()) : schema.parse({});
    const businessId = body.businessId ?? businesses[0].id;
    const snap = getBusinessSnapshot(businessId);
    const featured = snap.services.find((s) => s.isFeatured) ?? snap.services[0];

    return NextResponse.json({
      mode: "demo",
      kind: body.kind,
      locale: body.locale,
      title: `${snap.business.name} — ${body.kind} report`,
      summary: featured
        ? `${snap.business.name} is improving semantic relevance for ${featured.primaryKeyword}.`
        : `${snap.business.name} ${body.kind} summary.`,
      sections: ["Rankings", "GBP", "Reviews", "Content", "Tasks completed", "Next-week priorities"],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
