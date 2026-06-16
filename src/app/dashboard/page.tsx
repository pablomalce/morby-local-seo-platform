"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  HudLabel,
  PageHeader,
  Progress,
  StatusDot,
} from "@/components/ui";
import { RankingChart, ReviewsChart } from "@/components/charts";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { useTenantSnapshot } from "@/lib/hooks/useTenantSnapshot";

export default function DashboardPage() {
  const t = useT();
  const { business, isUserCreatedBusiness } = useSelection();
  const snap = useTenantSnapshot();

  const total = snap.plan.length;
  const done = snap.plan.filter((task) => task.status === "completed").length;
  const planPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const priority = [...snap.plan]
    .sort((a, b) => {
      const order: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      const ap = order[a.priority] ?? 9;
      const bp = order[b.priority] ?? 9;
      if (ap !== bp) return ap - bp;
      return (a.week ?? 0) - (b.week ?? 0);
    })
    .slice(0, 4);

  return (
    <>
      <PageHeader
        eyebrow={`01 / OVERVIEW — ${business.name.toUpperCase()}`}
        frame="FRAME 01 / 11"
        title={t("dashboard.title")}
        description={t("dashboard.description")}
        action={
          <div className="flex items-center gap-2">
            <Badge variant="hud">
              <StatusDot tone="online" /> &nbsp;{t("dashboard.phase2")}
            </Badge>
          </div>
        }
      />

      {snap.metrics.length === 0 ? (
        <EmptyState
          title={t("empty.metrics.title")}
          description={t("empty.metrics.body")}
          action={
            <Link href="/agents">
              <Button>Run agents to populate</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {snap.metrics.map((m, idx) => (
            <Card key={m.key} className="vulkan-pattern-overlay">
              <div className="flex items-center justify-between">
                <HudLabel>{t(m.label)}</HudLabel>
                <span className="font-mono text-[9px] uppercase tracking-hud text-metal-500">
                  {String(idx + 1).padStart(2, "0")} / {String(snap.metrics.length).padStart(2, "0")}
                </span>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <p className="display-h text-5xl">{m.value}</p>
                {m.delta && (
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
                    <ArrowUpRight className="h-3 w-3" />
                    {m.delta}
                  </span>
                )}
              </div>
              {m.note && <p className="mt-4 text-[11px] text-metal-400">{t(m.note)}</p>}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <HudLabel>{t("dashboard.rankingTrend")}</HudLabel>
            <Badge variant="hud">{t("dashboard.lowerIsBetter")}</Badge>
          </div>
          {snap.rankingTrend.length === 0 ? (
            <p className="py-12 text-center font-mono text-[11px] uppercase tracking-hud text-metal-500">
              {t("empty.chart")}
            </p>
          ) : (
            <RankingChart data={snap.rankingTrend} />
          )}
        </Card>
        <Card className="vulkan-pattern-overlay relative overflow-hidden">
          <HudLabel>{t("dashboard.aiPriority")}</HudLabel>
          <div className="mt-4 border-l-2 border-vulkan-orange bg-metal-950 p-4">
            <Sparkles className="mb-3 h-5 w-5 text-vulkan-orange" strokeWidth={1.5} />
            <p className="display-h text-lg">{t("dashboard.aiInsightTitle")}</p>
            <p className="mt-2 text-[12px] text-metal-300">{t("dashboard.aiInsightBody")}</p>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-hud text-metal-400">
              <span>{t("dashboard.planLabel")}</span>
              <span className="text-vulkan-white">{planPct}%</span>
            </div>
            <Progress value={planPct} />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <HudLabel>{t("dashboard.reviewsGrowth")}</HudLabel>
          {snap.reviewsGrowth.length === 0 ? (
            <p className="py-12 text-center font-mono text-[11px] uppercase tracking-hud text-metal-500">
              {t("empty.chart")}
            </p>
          ) : (
            <div className="mt-4">
              <ReviewsChart data={snap.reviewsGrowth} />
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-vulkan-orange" strokeWidth={1.5} />
            <HudLabel>{t("dashboard.priorityTasks")}</HudLabel>
          </div>
          <div className="space-y-2">
            {priority.map((task, idx) => (
              <div
                key={task.id}
                className="group flex items-start gap-3 rounded-vulkan border border-metal-800 bg-metal-950 p-3 transition-[border-color] duration-vulkan ease-vulkan hover:border-metal-600"
              >
                <span className="mt-0.5 font-mono text-[9px] uppercase tracking-hud text-metal-500">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="flex-1">
                  <p className="font-display text-[13px] uppercase tracking-hud text-vulkan-white">
                    {task.title}
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    {task.category} · IMPACT {task.impact}
                  </p>
                </div>
                <Badge variant={task.priority === "Critical" ? "critical" : "orange"}>
                  {task.priority}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-6 vulkan-pattern-overlay">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-1 h-5 w-5 text-vulkan-orange" strokeWidth={1.5} />
          <div>
            <HudLabel>{t("dashboard.phase1Status")}</HudLabel>
            <p className="mt-2 text-sm text-metal-300">
              {isUserCreatedBusiness ? t("dashboard.newTenantBody") : t("dashboard.phase1Body")}
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}
