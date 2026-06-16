"use client";

import Link from "next/link";
import { Badge, Button, Card, HudLabel, PageHeader, Progress } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { useTenantSnapshot } from "@/lib/hooks/useTenantSnapshot";

export default function CompetitorsPage() {
  const t = useT();
  const { business } = useSelection();
  const { competitors } = useTenantSnapshot();

  return (
    <>
      <PageHeader
        eyebrow={`02 / COMPETITORS — ${business.name.toUpperCase()}`}
        frame={`${competitors.length.toString().padStart(2, "0")} / TRACKED`}
        title={t("competitors.title")}
        description={t("competitors.description")}
      />

      {competitors.length === 0 ? (
        <Card className="flex flex-col items-start gap-3">
          <HudLabel>NO COMPETITORS YET</HudLabel>
          <p className="text-[13px] text-metal-300">{t("empty.competitors")}</p>
          <Link href="/agents">
            <Button>Run Competitor Intelligence Agent</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {competitors.map((c, idx) => (
            <Card key={c.id} hoverable className="vulkan-pattern-overlay">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    {String(idx + 1).padStart(3, "0")} / COMPETITOR
                  </span>
                  <h2 className="mt-2 display-h text-xl">{c.name}</h2>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-hud text-metal-400">
                    {c.rating ? `★ ${c.rating}` : "—"} · {c.reviewCount ?? 0} REVIEWS
                  </p>
                </div>
                <Badge variant="orange">STR {c.strengthScore}%</Badge>
              </div>
              <div className="mt-5 space-y-4">
                <div>
                  <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-hud text-metal-400">
                    <span>{t("competitors.strength")}</span>
                    <span className="text-vulkan-white">{c.strengthScore}%</span>
                  </div>
                  <Progress value={c.strengthScore} />
                </div>
                <div>
                  <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-hud text-metal-400">
                    <span>{t("competitors.relevance")}</span>
                    <span className="text-vulkan-white">{c.relevanceScore}%</span>
                  </div>
                  <Progress value={c.relevanceScore} />
                </div>
              </div>
              <Section title={t("competitors.strengths")} items={c.strengths} tone="ok" />
              <Section title={t("competitors.weaknesses")} items={c.weaknesses} tone="warn" />
              <Section title={t("competitors.opportunities")} items={c.opportunities} tone="orange" />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "ok" | "warn" | "orange";
}) {
  const accent = {
    ok: "border-emerald-900/60",
    warn: "border-red-900/40",
    orange: "border-vulkan-orange/40",
  }[tone];
  return (
    <div className="mt-5">
      <HudLabel>{title}</HudLabel>
      <ul className="mt-2 space-y-2 text-sm text-metal-300">
        {items.map((i) => (
          <li
            key={i}
            className={`rounded-vulkan border-l-2 ${accent} bg-metal-950 px-3 py-2`}
          >
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
