"use client";

import { useEffect, useState, useTransition } from "react";
import { Download, FileText, Play } from "lucide-react";
import { Badge, Button, Card, EmptyState, HudLabel, PageHeader, StatusDot } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { ReportView } from "./ReportView";
import { reportToMarkdown } from "@/lib/reports/markdown";
import type { Report } from "@/lib/reports/types";
import {
  isUserCreated,
  listAllLocations,
  listAllServices,
  listStoredCompetitors,
  listStoredContent,
  listStoredReviews,
} from "@/lib/store/tenantStore";

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
        // If this tenant was created via the onboarding wizard (lives only in localStorage),
        // include the local data so the server can build a snapshot for it.
        let clientSnapshot: Record<string, unknown> | undefined;
        if (isUserCreated(business.id)) {
          const allLocations = listAllLocations().filter((l) => l.businessId === business.id);
          const allServices = listAllServices().filter((s) => s.businessId === business.id);
          clientSnapshot = {
            business,
            locations: allLocations,
            services: allServices,
            content: listStoredContent(business.id),
            competitors: listStoredCompetitors(business.id),
            reviews: listStoredReviews(business.id),
          };
        }
        const res = await fetch("/api/reports/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId: business.id, clientSnapshot }),
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
  const noBusinessPicked = !business.id;

  return (
    <>
      <PageHeader
        eyebrow={`08 / REPORTS — ${noBusinessPicked ? t("selector.businessPlaceholder", "Select a business").toUpperCase() : business.name.toUpperCase()}`}
        frame={`${scopedHistory.length} GENERATED`}
        title={t("reports.title")}
        description={t("reports.description")}
        action={
          <Button onClick={generate} disabled={pending || noBusinessPicked} size="lg">
            <Play className="h-3.5 w-3.5" />
            {pending ? "GENERATING..." : "GENERATE REPORT"}
          </Button>
        }
      />

      {noBusinessPicked && (
        <EmptyState
          title={t("selector.pickBusinessTitle", "Pick a business to continue")}
          description={t(
            "selector.pickBusinessDescription",
            "Use the selector at the top to choose a tenant. Reports, agents and KPIs need a business in context.",
          )}
        />
      )}

      {error && (
        <Card className="mb-6 border-red-900/60 bg-red-950/30">
          <p className="font-mono text-[11px] uppercase tracking-hud text-red-300">
            <span className="text-red-400">//</span> {error}
          </p>
        </Card>
      )}

      {noBusinessPicked ? null : active ? (
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

