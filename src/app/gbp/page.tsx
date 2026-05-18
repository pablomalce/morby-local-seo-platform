"use client";

import { Camera, MapPin, MessageSquare, Newspaper } from "lucide-react";
import { Badge, Card, HudLabel, PageHeader, Progress } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { useTenantSnapshot } from "@/lib/hooks/useTenantSnapshot";

function scoreFromChecklist(items: { status: "Pending" | "In progress" | "Done" }[]): number {
  if (items.length === 0) return 0;
  const weights = { Done: 1, "In progress": 0.5, Pending: 0 } as const;
  const sum = items.reduce((acc, i) => acc + weights[i.status], 0);
  return Math.round((sum / items.length) * 100);
}

export default function GBPPage() {
  const t = useT();
  const { business, location } = useSelection();
  const snap = useTenantSnapshot();
  const score = scoreFromChecklist(snap.gbpChecklist);

  const ideas = [
    { icon: Newspaper, titleKey: "gbp.ideaWeekly.title", bodyKey: "gbp.ideaWeekly.body" },
    { icon: Camera, titleKey: "gbp.ideaPhoto.title", bodyKey: "gbp.ideaPhoto.body" },
    { icon: MessageSquare, titleKey: "gbp.ideaReview.title", bodyKey: "gbp.ideaReview.body" },
    { icon: MapPin, titleKey: "gbp.ideaLocal.title", bodyKey: "gbp.ideaLocal.body" },
  ];

  const locDisplay = location ?? snap.locations[0];

  return (
    <>
      <PageHeader
        eyebrow={`03 / GBP — ${business.name.toUpperCase()}${locDisplay ? ` · ${locDisplay.label.toUpperCase()}` : ""}`}
        frame={`AUDIT ${score}%`}
        title={t("gbp.title")}
        description={t("gbp.description")}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <HudLabel>{t("gbp.checklist")}</HudLabel>
          <div className="mt-5 space-y-2">
            {snap.gbpChecklist.map((item, idx) => (
              <div
                key={item.item}
                className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3"
              >
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[13px] text-vulkan-white">{item.item}</span>
                </span>
                <Badge
                  variant={
                    item.status === "Done" ? "success" : item.status === "Pending" ? "muted" : "orange"
                  }
                >
                  {item.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card className="vulkan-pattern-overlay">
          <HudLabel>{t("gbp.score")}</HudLabel>
          <p className="mt-2 text-[12px] text-metal-400">{t("gbp.scoreBody")}</p>
          <p className="mt-6 display-h text-6xl text-vulkan-orange">{score}%</p>
          <div className="mt-3">
            <Progress value={score} />
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-hud text-metal-500">
            {t("gbp.scoreTarget")}
          </p>
        </Card>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {ideas.map((idea) => {
          const Icon = idea.icon;
          return (
            <Card key={idea.titleKey} hoverable>
              <Icon className="mb-4 h-5 w-5 text-vulkan-orange" strokeWidth={1.5} />
              <h3 className="display-h text-base">{t(idea.titleKey)}</h3>
              <p className="mt-2 text-[12px] text-metal-400">{t(idea.bodyKey)}</p>
            </Card>
          );
        })}
      </div>
    </>
  );
}
