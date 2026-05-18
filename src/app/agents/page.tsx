"use client";

import { useState } from "react";
import { Badge, Button, Card, HudLabel, PageHeader, StatusDot } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { agentDefinitions } from "@/lib/mock/universal";
import { runAgent } from "@/lib/agents/registry";
import type { AgentRun } from "@/lib/types/core";

export default function AgentsPage() {
  const t = useT();
  const { business } = useSelection();
  const [runs, setRuns] = useState<Record<string, AgentRun>>({});
  const [running, setRunning] = useState<string | null>(null);

  function handleRun(agentId: string) {
    setRunning(agentId);
    setTimeout(() => {
      const run = runAgent({ agentId, scope: "business", scopeId: business.id });
      setRuns((prev) => ({ ...prev, [agentId]: run }));
      setRunning(null);
    }, 600);
  }

  return (
    <>
      <PageHeader
        eyebrow={`09 / AGENTS — ${business.name.toUpperCase()}`}
        frame={`${agentDefinitions.length} REGISTERED`}
        title={t("agents.title")}
        description={t("agents.description")}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {agentDefinitions.map((agent, idx) => {
          const lastRun = runs[agent.id];
          const status = lastRun?.status ?? "idle";
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
                  <StatusDot tone={status === "completed" ? "online" : status === "running" ? "warning" : "muted"} />
                  &nbsp;{status}
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
                disabled={running === agent.id}
                onClick={() => handleRun(agent.id)}
                className="mt-5"
              >
                {running === agent.id ? t("agents.running") : t("agents.run")}
              </Button>
            </Card>
          );
        })}
      </div>
    </>
  );
}
