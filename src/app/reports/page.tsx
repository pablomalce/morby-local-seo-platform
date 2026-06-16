"use client";

import { useEffect, useState, useTransition } from "react";
import { Download, FileText, Play } from "lucide-react";
import { Badge, Button, Card, EmptyState, HudLabel, PageHeader, StatusDot } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { ReportView } from "./ReportView";
import type { Report } from "@/lib/reports/types";

const STORAGE_KEY = "lg.reports.cache.v1";

interface CacheEntry {
  generatedAt: string;
  businessId: string;
  report: Report;
}

function readCache(): CacheEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CacheEntry[];
  } catch {
    return [];
  }
}

function writeCache(entries: CacheEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 50)));
}

export default function ReportsPage() {
  const t = useT();
  const { business } = useSelection();
  const [pending, startTransition] = useTransition();
  const [history, setHistory] = useState<CacheEntry[]>([]);
  const [active, setActive] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHistory(readCache());
  }, []);

  function generate() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/reports/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId: business.id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed" }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const report = (await res.json()) as Report;
        const entry: CacheEntry = {
          generatedAt: report.generatedAt,
          businessId: report.businessId,
          report,
        };
        const updated = [entry, ...history.filter((h) => h.report.id !== report.id)];
        setHistory(updated);
        writeCache(updated);
        setActive(report);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  function download(report: Report, format: "json" | "md") {
    const filename = `${report.businessName.replace(/\s+/g, "-").toLowerCase()}-report-${new Date(report.generatedAt).toISOString().slice(0, 10)}.${format}`;
    const content = format === "json" ? JSON.stringify(report, null, 2) : reportToMarkdown(report);
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const scopedHistory = history.filter((h) => h.businessId === business.id);

  return (
    <>
      <PageHeader
        eyebrow={`08 / REPORTS — ${business.name.toUpperCase()}`}
        frame={`${scopedHistory.length} GENERATED`}
        title={t("reports.title")}
        description={t("reports.description")}
        action={
          <Button onClick={generate} disabled={pending} size="lg">
            <Play className="h-3.5 w-3.5" />
            {pending ? "GENERATING..." : "GENERATE REPORT"}
          </Button>
        }
      />

      {error && (
        <Card className="mb-6 border-red-900/60 bg-red-950/30">
          <p className="font-mono text-[11px] uppercase tracking-hud text-red-300">
            <span className="text-red-400">//</span> {error}
          </p>
        </Card>
      )}

      {active ? (
        <div className="space-y-6">
          <Card className="vulkan-pattern-overlay">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <HudLabel>LATEST REPORT</HudLabel>
                <p className="mt-2 display-h text-lg">
                  {new Date(active.generatedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => download(active, "md")}>
                  <Download className="h-3.5 w-3.5" />
                  MARKDOWN
                </Button>
                <Button variant="secondary" size="sm" onClick={() => download(active, "json")}>
                  <Download className="h-3.5 w-3.5" />
                  JSON
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setActive(null)}>
                  Close
                </Button>
              </div>
            </div>
          </Card>

          <ReportView report={active} />
        </div>
      ) : scopedHistory.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="Click GENERATE REPORT to produce an executive summary with current state, prioritized issues and a 90-day action plan."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {scopedHistory.map((entry) => (
            <Card key={entry.report.id} hoverable>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    {new Date(entry.generatedAt).toLocaleString()}
                  </span>
                  <h3 className="mt-2 display-h text-base">{entry.report.businessName}</h3>
                  <p className="mt-2 text-[12px] text-metal-400 line-clamp-3">
                    {entry.report.summary}
                  </p>
                </div>
                <Badge variant="hud">
                  <StatusDot tone={entry.report.dataSourceHealth.places === "live" ? "online" : "warning"} />
                  &nbsp;{entry.report.generator}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="orange">
                  {entry.report.issues.filter((i) => i.severity === "P1").length} P1
                </Badge>
                <Badge variant="outline">{entry.report.actions.length} actions</Badge>
                <Badge variant="outline">{entry.report.kpis.length} KPIs</Badge>
              </div>
              <Button onClick={() => setActive(entry.report)} className="mt-4 w-full">
                <FileText className="h-3.5 w-3.5" />
                OPEN REPORT
              </Button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function reportToMarkdown(r: Report): string {
  const issues = r.issues
    .map(
      (i, idx) =>
        `\n### ${String(idx + 1).padStart(2, "0")} — [${i.severity}] ${i.title}\n\n` +
        `**Category:** ${i.category} · **Impact:** ${i.impact} · **Difficulty:** ${i.difficulty}\n\n` +
        `**Why it matters:** ${i.rationale}\n\n` +
        `**Evidence:**\n${i.evidence.map((e) => `- ${e}`).join("\n")}\n\n` +
        `**Recommendation:** ${i.recommendation}`,
    )
    .join("\n");

  const actions = r.actions
    .map(
      (a) =>
        `| W${String(a.week).padStart(2, "0")} | ${a.title} | ${a.owner} | ${a.impact} |`,
    )
    .join("\n");

  const kpis = r.kpis
    .map((k) => `| ${k.label} | ${k.currentValue} | ${k.target} | ${k.cadence} |`)
    .join("\n");

  return `# ${r.businessName} — Growth Report
Generated: ${new Date(r.generatedAt).toLocaleString()}
Engine: ${r.generator}

## Executive Summary

${r.summary}

## Current State

- **Local rank:** ${r.state.localRank !== null ? `#${r.state.localRank}` : "—"}${r.state.localRankDelta !== null ? ` (Δ ${r.state.localRankDelta > 0 ? "+" : ""}${r.state.localRankDelta})` : ""}
- **GBP score:** ${r.state.gbpScore}%
- **Reviews:** ${r.state.reviewsTotal} total · ${r.state.reviewsServiceMentions} mention featured service
- **Content drafts:** ${r.state.contentApproved} approved / ${r.state.contentTotal} total
- **Competitors tracked:** ${r.state.competitorsTracked}
- **90-day plan completion:** ${r.state.planCompletion}%

## Priority Issues
${issues}

## 90-Day Action Plan

| Week | Action | Owner | Impact |
|------|--------|-------|--------|
${actions}

## KPIs to Track

| KPI | Current | Target | Cadence |
|-----|---------|--------|---------|
${kpis}

## Data Source Health

| Source | Status |
|--------|--------|
| Google Places | ${r.dataSourceHealth.places} |
| Search Console | ${r.dataSourceHealth.searchConsole} |
| Google Business Profile | ${r.dataSourceHealth.gbp} |
| Google Analytics 4 | ${r.dataSourceHealth.ga4} |

> ${r.dataSourceHealth.note}

---
*Generated by Vulkan Growth OS · Reporting Engine ${r.generator}*
`;
}
