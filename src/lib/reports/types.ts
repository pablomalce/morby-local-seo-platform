/**
 * Structured Report types — what the Reporting Agent produces.
 *
 * Phase 4a ships a deterministic heuristic engine that emits this shape from a tenant snapshot.
 * Phase 4c will add an optional LLM pass (Claude Haiku) that refines the language in `summary`
 * and `issues[].rationale` while keeping the structured fields rule-derived.
 */

export type IssueSeverity = "P1" | "P2" | "P3";
export type ActionOwner = "Operations" | "Marketing" | "Content" | "Dev" | "Customer Success" | "Owner";
export type DataSourceStatus = "live" | "demo" | "missing" | "error";

export interface KpiSnapshot {
  /** Local rank (lower is better). Number when known, null when no data. */
  localRank: number | null;
  /** Trend vs 30 days ago: positive means improved (lower rank). */
  localRankDelta: number | null;
  /** GBP completion percentage 0–100. */
  gbpScore: number;
  /** Total reviews on file. */
  reviewsTotal: number;
  /** Reviews that mention the featured service. */
  reviewsServiceMentions: number;
  /** Approved content drafts for the featured service. */
  contentApproved: number;
  /** Total content drafts (any status). */
  contentTotal: number;
  /** Competitor count tracked. */
  competitorsTracked: number;
  /** Plan completion percentage 0–100. */
  planCompletion: number;
}

export interface ReportIssue {
  id: string;
  severity: IssueSeverity;
  category: "GBP" | "Content" | "Reviews" | "Technical SEO" | "Authority" | "Competitive" | "Conversion";
  title: string;
  rationale: string;
  evidence: string[];
  recommendation: string;
  /** Estimated effort to fix. */
  difficulty: "Low" | "Medium" | "High";
  /** Estimated impact on rank/reach if fixed. */
  impact: "Low" | "Medium" | "High";
}

export interface ReportAction {
  id: string;
  title: string;
  description: string;
  owner: ActionOwner;
  week: number;
  impact: "Low" | "Medium" | "High";
  linkedIssueIds: string[];
}

export interface ReportKpi {
  label: string;
  currentValue: string;
  target: string;
  cadence: "Weekly" | "Monthly";
}

export interface DataSourceHealth {
  places: DataSourceStatus;
  searchConsole: DataSourceStatus;
  gbp: DataSourceStatus;
  ga4: DataSourceStatus;
  /** Plain text explanation for the user about what's live vs demo. */
  note: string;
}

export interface Report {
  id: string;
  businessId: string;
  businessName: string;
  locationLabel: string | null;
  generatedAt: string;
  /** Locale the report copy is written in (matches business.primaryLocale). */
  locale: "en" | "es" | "sv";
  /** ~150-word executive summary at the top of the report. */
  summary: string;
  /** Current state KPIs. */
  state: KpiSnapshot;
  /** Prioritized issues — sorted P1 → P3, max ~8. */
  issues: ReportIssue[];
  /** 90-day action plan ordered by week. */
  actions: ReportAction[];
  /** KPIs the team should track. */
  kpis: ReportKpi[];
  /** Transparency about which sections used real vs synthetic data. */
  dataSourceHealth: DataSourceHealth;
  /** What engine generated this — heuristic, claude, openai, hybrid. */
  generator: "heuristic" | "claude" | "openai" | "hybrid";
}
