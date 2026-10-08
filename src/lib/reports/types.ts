/**
 * Structured Report types — what the Reporting Agent produces.
 *
 * Phase 4a ships a deterministic heuristic engine that emits this shape from a tenant snapshot.
 * Phase 4c will add an optional LLM pass (Claude Haiku) that refines the language in `summary`
 * and `issues[].rationale` while keeping the structured fields rule-derived.
 */

import type { IcpPublicado } from "@/lib/profile/fichaPublicada";

export type IssueSeverity = "P1" | "P2" | "P3";
/**
 * Owner of an action. Holds a localized label (e.g. "Operations" / "Operaciones" / "Drift")
 * produced by the engine's STRINGS table, so it is a plain string rather than a fixed union.
 */
export type ActionOwner = string;
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
  /** Real Core Web Vitals from PageSpeed Insights — present only when hydrated. */
  webVitals?: {
    lcp: number;
    inp: number;
    cls: number;
    lighthouseScore: number;
    fetchedAt: string;
  };
  /**
   * Real Search Console totals for the report window — present only when
   * hydrated. Absent and zero are different: a client with no traffic has real
   * zeroes, a client whose query failed has nothing, and
   * `dataSources.searchConsole` is what says which.
   */
  searchConsole?: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    fetchedAt: string;
  };
  /** Real GA4 totals for the same window — present only when hydrated. */
  ga4?: {
    sessions: number;
    conversions: number;
    fetchedAt: string;
  };
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
  /** Localized cadence label (e.g. "Weekly" / "Semanal" / "Veckovis"). */
  cadence: string;
}

export interface DataSourceHealth {
  places: DataSourceStatus;
  pagespeed: DataSourceStatus;
  searchConsole: DataSourceStatus;
  gbp: DataSourceStatus;
  ga4: DataSourceStatus;
  /** Plain text explanation for the user about what's live vs demo. */
  note: string;
}

/**
 * Contra qué versión de la ficha de empresa (`company_profiles`) se escribió el
 * reporte. Es la mitad (b) de la puerta H1.2: «un reporte generado cita un
 * version_id que resuelve a esa fila exacta».
 *
 * CUATRO ESTADOS Y NO UN `string | null`, porque un null no distingue las dos
 * cosas que más importan distinguir: «esta empresa no tiene ficha publicada» y
 * «no se pudo leer la ficha». La primera es un hecho sobre el cliente; la
 * segunda es un fallo nuestro, y leerla como la primera sería presentar un
 * error como un dato — el mismo defecto que `dataSourceHealth.note` tuvo con las
 * fuentes en `error`.
 *
 * - `cited`: había una versión publicada y ésta es. `versionId` es el que la
 *   base guarda en `reports.profile_version_id`, con FK compuesta (la `0028`).
 *   `icp` es el ICP DE ESA VERSIÓN (H1.3), leído por su id en la misma
 *   `leerFichaPublicada` que sirve la ficha al Lead Engine: cambiar el ICP —es
 *   decir, publicar otra versión— cambia la cita y este texto juntos. `null` es
 *   una versión publicada sin ICP, que la base permite. Un reporte guardado
 *   antes de H1.3 no trae el campo: ver `citationLine` en `markdown.ts`.
 * - `none`: con sesión, la lectura anduvo, y no hay versión publicada.
 * - `demo`: reporte de demostración, sin organización: no hay nada que citar.
 * - `error`: con sesión, la lectura falló. `reason` es el código, nunca el
 *   mensaje de Postgres, que puede nombrar tablas y constraints.
 */
export type ProfileCitation =
  | {
      status: "cited";
      versionId: string;
      version: number;
      publishedAt: string;
      icp: IcpPublicado | null;
    }
  | { status: "none" }
  | { status: "demo" }
  | { status: "error"; reason: string };

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
  /** Contra qué versión de la ficha se escribió. Ver `ProfileCitation`. */
  profileCitation: ProfileCitation;
}
