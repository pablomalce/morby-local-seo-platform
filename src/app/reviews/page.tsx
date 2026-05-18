"use client";

import { Badge, Card, HudLabel, PageHeader, StatusPill } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { useTenantSnapshot } from "@/lib/hooks/useTenantSnapshot";

export default function ReviewsPage() {
  const t = useT();
  const { business, service } = useSelection();
  const snap = useTenantSnapshot();
  const targetService = service?.name;
  const mentions = targetService
    ? snap.reviews.filter((r) => r.serviceMentioned === targetService).length
    : snap.reviews.filter((r) => r.serviceMentioned).length;
  const goal = Math.max(35, Math.round(snap.reviews.length * 0.3));

  return (
    <>
      <PageHeader
        eyebrow={`06 / REVIEWS — ${business.name.toUpperCase()}`}
        frame={`${mentions.toString().padStart(2, "0")} MENTIONS`}
        title={t("reviews.title")}
        description={t("reviews.description")}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Stat label={t("reviews.total")} value={snap.reviews.length} />
        <Stat label={t("reviews.mentions")} value={mentions} accent />
        <Stat label={t("reviews.goal")} value={`${goal}+`} />
      </div>

      <div className="mt-6 space-y-3">
        {snap.reviews.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="display-h text-base">{r.author}</h2>
                  <StatusPill status={r.status} />
                </div>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
                  {"★".repeat(r.rating)}
                  <span className="ml-2 text-metal-500">{r.serviceMentioned ?? "—"}</span>
                </p>
                <p className="mt-3 text-[13px] text-vulkan-white">&ldquo;{r.text}&rdquo;</p>
              </div>
              {r.serviceMentioned && <Badge variant="outline">{r.serviceMentioned}</Badge>}
            </div>
            {r.suggestedReply && (
              <div className="mt-4 border-l-2 border-vulkan-orange bg-metal-950 p-4">
                <HudLabel>{t("reviews.suggestedReply")}</HudLabel>
                <p className="mt-2 text-[12px] text-metal-300">{r.suggestedReply}</p>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <HudLabel>{t("reviews.requestMessage")}</HudLabel>
        <p className="mt-3 text-[13px] text-metal-300">
          Thank you for your visit. If you enjoyed your {targetService ?? snap.services[0]?.name ?? "experience"}, it
          would mean a lot if you shared a quick review on Google.
        </p>
      </Card>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <Card className={accent ? "vulkan-pattern-overlay" : undefined}>
      <HudLabel>{label}</HudLabel>
      <p className={`mt-3 display-h text-5xl ${accent ? "text-vulkan-orange" : ""}`}>{value}</p>
    </Card>
  );
}
