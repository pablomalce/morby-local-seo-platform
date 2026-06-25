"use client";

import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Target, TrendingUp } from "lucide-react";
import { Badge, Card, HudLabel } from "@/components/ui";
import type { Report, ReportIssue } from "@/lib/reports/types";

export function ReportView({ report }: { report: Report }) {
  return (
    <div className="space-y-6">
      {/* Executive summary */}
      <Card className="vulkan-pattern-overlay">
        <div className="flex items-start gap-3">
          <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-vulkan bg-vulkan-orange/15 text-vulkan-orange">
            <TrendingUp className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div className="flex-1">
            <HudLabel>EXECUTIVE SUMMARY</HudLabel>
            <p className="mt-3 text-[14px] leading-relaxed text-vulkan-white">{report.summary}</p>
          </div>
        </div>
      </Card>

      {/* Current state */}
      <Card>
        <HudLabel>CURRENT STATE</HudLabel>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StateCell
            label="Local rank"
            value={report.state.localRank !== null ? `#${report.state.localRank}` : "—"}
            delta={report.state.localRankDelta}
            deltaInverted={true}
          />
          <StateCell label="GBP score" value={`${report.state.gbpScore}%`} target="90%+" />
          <StateCell label="Reviews total" value={`${report.state.reviewsTotal}`} />
          <StateCell
            label="Service mentions"
            value={`${report.state.reviewsServiceMentions}`}
            target={
              report.state.reviewsTotal > 0
                ? `${Math.round(
                    (report.state.reviewsServiceMentions / report.state.reviewsTotal) * 100,
                  )}% of reviews`
                : undefined
            }
          />
          <StateCell
            label="Content drafts"
            value={`${report.state.contentApproved} / ${report.state.contentTotal}`}
            target="2+ shipped/week"
          />
          <StateCell label="Plan completion" value={`${report.state.planCompletion}%`} />
          {report.state.webVitals && (
            <>
              <StateCell
                label="LCP (mobile)"
                value={`${(report.state.webVitals.lcp / 1000).toFixed(1)}s`}
                target="≤ 2.5s"
              />
              <StateCell
                label="CLS"
                value={report.state.webVitals.cls.toFixed(2)}
                target="≤ 0.1"
              />
              <StateCell
                label="Lighthouse"
                value={`${report.state.webVitals.lighthouseScore}/100`}
                target="≥ 90"
              />
            </>
          )}
        </div>
      </Card>

      {/* Priority issues */}
      <Card>
        <HudLabel>
          PRIORITY ISSUES ·{" "}
          <span className="text-vulkan-orange">
            {report.issues.filter((i) => i.severity === "P1").length} P1
          </span>{" "}
          · {report.issues.filter((i) => i.severity === "P2").length} P2 ·{" "}
          {report.issues.filter((i) => i.severity === "P3").length} P3
        </HudLabel>
        {report.issues.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 text-[13px] text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            No issues detected. The team is executing well — focus on compounding improvements.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {report.issues.map((issue, idx) => (
              <IssueRow key={issue.id} issue={issue} index={idx + 1} />
            ))}
          </div>
        )}
      </Card>

      {/* Action plan */}
      <Card>
        <HudLabel>90-DAY ACTION PLAN</HudLabel>
        <div className="mt-4 space-y-2">
          {report.actions.map((action) => (
            <div
              key={action.id}
              className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-vulkan border border-metal-800 bg-metal-950 p-3"
            >
              <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded-[2px] bg-vulkan-orange/15 font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
                W{String(action.week).padStart(2, "0")}
              </span>
              <div>
                <p className="font-display text-[13px] uppercase tracking-hud text-vulkan-white">
                  {action.title}
                </p>
                <p className="mt-1 text-[12px] text-metal-400">{action.description}</p>
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-hud text-metal-500">
                  Owner: {action.owner} · Impact: {action.impact}
                </p>
              </div>
              <Badge variant={action.impact === "High" ? "orange" : "outline"}>
                {action.impact}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* KPIs */}
      <Card>
        <HudLabel>KPIs TO TRACK</HudLabel>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {report.kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3"
            >
              <div>
                <p className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                  {kpi.label}
                </p>
                <p className="mt-1 font-display text-[14px] uppercase tracking-hud text-vulkan-white">
                  {kpi.currentValue}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
                  Target
                </p>
                <p className="mt-1 text-[12px] text-metal-300">{kpi.target}</p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-hud text-metal-500">
                  {kpi.cadence}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Data source provenance */}
      <Card className="border-metal-700/60 bg-metal-950">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-vulkan-orange" />
          <div className="flex-1">
            <HudLabel>DATA SOURCE HEALTH</HudLabel>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <DataSourceRow label="Google Places" status={report.dataSourceHealth.places} />
              <DataSourceRow label="Google PageSpeed" status={report.dataSourceHealth.pagespeed} />
              <DataSourceRow label="Search Console" status={report.dataSourceHealth.searchConsole} />
              <DataSourceRow label="Google Business Profile" status={report.dataSourceHealth.gbp} />
              <DataSourceRow label="Google Analytics 4" status={report.dataSourceHealth.ga4} />
            </div>
            <p className="mt-3 text-[12px] text-metal-400">{report.dataSourceHealth.note}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function IssueRow({ issue, index }: { issue: ReportIssue; index: number }) {
  const sevConfig = {
    P1: { variant: "critical" as const, Icon: AlertOctagon, color: "text-red-400" },
    P2: { variant: "orange" as const, Icon: AlertTriangle, color: "text-vulkan-orange" },
    P3: { variant: "outline" as const, Icon: Info, color: "text-metal-400" },
  }[issue.severity];

  return (
    <details className="group rounded-vulkan border border-metal-800 bg-metal-950 p-4 transition-colors hover:border-metal-700">
      <summary className="flex cursor-pointer items-start justify-between gap-3 list-none">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 font-mono text-[10px] uppercase tracking-hud text-metal-500">
            {String(index).padStart(2, "0")}
          </span>
          <sevConfig.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${sevConfig.color}`} />
          <div>
            <p className="font-display text-[13px] uppercase tracking-hud text-vulkan-white">
              {issue.title}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-hud text-metal-500">
              {issue.category} · Impact {issue.impact} · Difficulty {issue.difficulty}
            </p>
          </div>
        </div>
        <Badge variant={sevConfig.variant}>{issue.severity}</Badge>
      </summary>

      <div className="mt-4 space-y-3 border-l-2 border-vulkan-orange/30 pl-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
            Why it matters
          </p>
          <p className="mt-1 text-[13px] text-metal-200">{issue.rationale}</p>
        </div>
        {issue.evidence.length > 0 && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-hud text-metal-500">Evidence</p>
            <ul className="mt-1 space-y-1">
              {issue.evidence.map((e, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-metal-300">
                  <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-vulkan-orange" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
            Recommendation
          </p>
          <p className="mt-1 text-[13px] text-vulkan-white">{issue.recommendation}</p>
        </div>
      </div>
    </details>
  );
}

function StateCell({
  label,
  value,
  delta,
  deltaInverted,
  target,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaInverted?: boolean;
  target?: string;
}) {
  const positive = delta !== undefined && delta !== null && (deltaInverted ? delta > 0 : delta < 0);
  return (
    <div className="rounded-vulkan border border-metal-800 bg-metal-950 p-4">
      <p className="font-mono text-[10px] uppercase tracking-hud text-metal-500">{label}</p>
      <p className="mt-2 display-h text-3xl">{value}</p>
      <div className="mt-2 flex items-center justify-between">
        {delta !== undefined && delta !== null && delta !== 0 ? (
          <span
            className={`font-mono text-[10px] uppercase tracking-hud ${
              positive ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {positive ? "↗" : "↘"} {delta > 0 ? "+" : ""}
            {delta}
          </span>
        ) : (
          <span />
        )}
        {target && (
          <span className="font-mono text-[9px] uppercase tracking-hud text-metal-500">
            <Target className="mr-1 inline h-2.5 w-2.5" />
            {target}
          </span>
        )}
      </div>
    </div>
  );
}

function DataSourceRow({ label, status }: { label: string; status: string }) {
  const config: Record<string, { color: string; text: string }> = {
    live: { color: "text-emerald-400", text: "● LIVE" },
    demo: { color: "text-vulkan-orange", text: "○ DEMO" },
    missing: { color: "text-metal-500", text: "○ NOT CONNECTED" },
    error: { color: "text-red-400", text: "● ERROR" },
  };
  const c = config[status] ?? config.missing;
  return (
    <div className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-900 px-3 py-2">
      <span className="font-mono text-[11px] uppercase tracking-hud text-metal-400">{label}</span>
      <span className={`font-mono text-[10px] uppercase tracking-hud ${c.color}`}>{c.text}</span>
    </div>
  );
}
