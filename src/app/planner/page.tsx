"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, HudLabel, PageHeader, Progress, StatusPill } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { useTenantSnapshot } from "@/lib/hooks/useTenantSnapshot";
import type { PlatformTask } from "@/lib/types/core";

export default function PlannerPage() {
  const t = useT();
  const { business } = useSelection();
  const snap = useTenantSnapshot();
  const snapshotPlan = useMemo(() => snap.plan, [snap.plan]);
  const [plan, setPlan] = useState<PlatformTask[]>(snapshotPlan);

  useEffect(() => {
    setPlan(snapshotPlan);
  }, [snapshotPlan]);

  const total = plan.length;
  const done = plan.filter((task) => task.status === "completed").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  function completePending() {
    setPlan((current) =>
      current.map((task) => (task.status === "pending" ? { ...task, status: "completed" } : task)),
    );
  }

  const weeks = Array.from(new Set(plan.map((p) => p.week))).sort((a, b) => a - b);

  return (
    <>
      <PageHeader
        eyebrow={`07 / PLANNER — ${business.name.toUpperCase()}`}
        frame={`${pct}% COMPLETE`}
        title={t("planner.title")}
        description={t("planner.description")}
        action={
          <Button variant="secondary" onClick={completePending}>
            {t("planner.markCompleted")}
          </Button>
        }
      />

      <Card className="mb-6">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-hud text-metal-400">
          <span>{t("planner.overall")}</span>
          <span className="text-vulkan-white">{pct}%</span>
        </div>
        <div className="mt-3">
          <Progress value={pct} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {weeks.map((week) => {
          const weekTasks = plan.filter((p) => p.week === week);
          const focus = weekTasks[0]?.category ?? "Growth";
          return (
            <Card key={week} hoverable>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
                    WEEK {String(week).padStart(2, "0")}
                  </span>
                  <h2 className="mt-1 display-h text-lg">{focus}</h2>
                </div>
                <Badge variant="orange">{t("planner.sprint")}</Badge>
              </div>
              <div className="space-y-2">
                {weekTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-vulkan border border-metal-800 bg-metal-950 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] text-vulkan-white">{task.title}</p>
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-hud text-metal-500">
                          {task.priority} · IMPACT {task.impact} · DIFF {task.difficulty}
                        </p>
                      </div>
                      <StatusPill status={task.status} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
