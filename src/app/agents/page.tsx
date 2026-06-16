"use client";

import { useState } from "react";
import { Play, Sparkles } from "lucide-react";
import { Badge, Button, Card, HudLabel, PageHeader, StatusDot } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { agentDefinitions } from "@/lib/mock/universal";
import { runAgent } from "@/lib/agents/registry";
import { notifyStoreChanged } from "@/lib/hooks/useTenantSnapshot";
import type { AgentRun } from "@/lib/types/core";

export default function AgentsPage() {
  const t = useT();
  const { business } = useSelection();
  const [runs, setRuns] = useState<Record<string, AgentRun>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  function handleRun(agentId: string) {
    setRunning(agentId);
    setTimeout(() => {
      const run = runAgent({ agentId, scope: "business", scopeId: business.id });
      setRuns((prev) => ({ ...prev, [agentId]: run }));
      setRunning(null);
      notifyStoreChanged();
    }, 600);
  }

  async function handleRunAll() {
    setRunningAll(true);
    for (const agent of agentDefinitions) {
      // Brief delay per agent so the user can see the progression.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 220));
      const run = runAgent({ agentId: agent.id, scope: "business", scopeId: business.id });
      setRuns((prev) => ({ ...prev, [agent.id]: run }));
    }
    notifyStoreChanged();
    setRunningAll(false);
  }

  const completedCount = Object.values(runs).filter((r) => r.status === "completed").length;

  return (
    <>
      <PageHeader
        eyebrow={`09 / AGENTS — ${business.name.toUpperCase()}`}
        frame={`${completedCount} / ${agentDefinitions.length} RUN`}
        title={t("agents.title")}
        description={t("agents.description")}
        action={
          <Button onClick={handleRunAll} disabled={runningAll || !!running} size="lg">
            <Play className="h-3.5 w-3.5" />
            {runningAll ? `${t("agents.running")} ${completedCount}/${agentDefinitions.length}` : "RUN ALL AGENTS"}
          </Button>
        }
      />

      <Card className="mb-6 border-vulkan-orange/30 vulkan-pattern-overlay">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-hud text-metal-300">
          <Sparkles className="h-3.5 w-3.5 text-vulkan-orange" strokeWidth={1.5} />
          Running an agent persists deliverables (content drafts, competitors, reviews, reports) to this tenant — open the relevant page after each run to see results.
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {agentDefinitions.map((agent, idx) => {
          const lastRun = runs[agent.id];
          const status = lastRun?.status ?? "idle";
          const isRunning = running === agent.id || (runningAll && !lastRun);
          return (
            <Card key={agent.id} hoverable className="vulkan-pattern-overlay">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    AGENT / {String(idx + 1).padStart(2, "0")}
                  </span>
                  <h2 className="mt-2 display-h text-lg">{agent.name}</h2>
                  <p className="mt-2 text-[12px] text-metal-400">{agent.role}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {agent.scopes.map((scope) => (
                      <Badge key={scope} variant="outline">
                        {scope}
                      </Badge>
                    ))}
                    {agent.requiresApproval && (
                      <Badge variant="orange">{t("agents.requiresApproval")}</Badge>
                    )}
                  </div>
                </div>
                <Badge variant={status === "completed" ? "success" : "hud"}>
                  <StatusDot tone={status === "completed" ? "online" : isRunning ? "warning" : "muted"} />
                  &nbsp;{isRunning ? "running" : status}
                </Badge>
              </div>
              <div className="mt-5 border-l-2 border-vulkan-orange bg-metal-950 p-4">
                <HudLabel>{t("agents.outputSummary")}</HudLabel>
                <p className="mt-2 text-[12px] text-metal-300">
                  {lastRun?.output ?? `Ready to run on scope: ${agent.scopes.join(", ")}.`}
                </p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-hud text-metal-500">
                  {t("agents.lastRun")}:{" "}
                  {lastRun ? new Date(lastRun.finishedAt ?? lastRun.startedAt).toLocaleString() : "—"}
                </p>
              </div>
              <Button
                disabled={isRunning || runningAll}
                onClick={() => handleRun(agent.id)}
                className="mt-5"
              >
                {isRunning ? t("agents.running") : t("agents.run")}
              </Button>
            </Card>
          );
        })}
      </div>
    </>
  );
}
