import { NextResponse } from "next/server";
import { businesses, getBusinessSnapshot } from "@/lib/mock/universal";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId") ?? businesses[0].id;
  const snap = getBusinessSnapshot(businessId);
  const weights = { Done: 1, "In progress": 0.5, Pending: 0 } as const;
  const score = snap.gbpChecklist.length
    ? Math.round(
        (snap.gbpChecklist.reduce((acc, item) => acc + weights[item.status], 0) / snap.gbpChecklist.length) * 100,
      )
    : 0;
  return NextResponse.json({
    mode: "demo",
    business: { id: snap.business.id, name: snap.business.name, website: snap.business.website },
    score,
    checklist: snap.gbpChecklist,
    locations: snap.locations.map((l) => ({ id: l.id, label: l.label, city: l.city, region: l.region })),
  });
}
