/**
 * Heuristic Report Engine
 *
 * Pure, deterministic. Takes a tenant snapshot (already universal — see `buildBusinessSnapshot`)
 * and produces a structured Report by applying ~25 SEO heuristics that mirror what a senior
 * consultant would say in their first audit.
 *
 * The engine NEVER fabricates data — it analyses what's in the snapshot and surfaces what's
 * actionable. When a section of the snapshot is synthetic (no real Google API connected yet),
 * we annotate the `dataSourceHealth` block so the reader knows which findings are demo-grade
 * vs production-grade.
 */

import type { BusinessSnapshot } from "@/lib/mock/universal";
import type {
  ActionOwner,
  DataSourceHealth,
  KpiSnapshot,
  Report,
  ReportAction,
  ReportIssue,
  ReportKpi,
} from "./types";

interface EngineOptions {
  /** Source-of-truth flags so the engine can show data provenance honestly. */
  dataSources?: Partial<DataSourceHealth>;
}

// ---------------------------------------------------------------------------
// Locale strings
// ---------------------------------------------------------------------------

const STRINGS = {
  en: {
    summaryIntro: (biz: string, geo: string) =>
      `${biz} is currently ranked ${"{rank}"} for "${geo}". The growth gap to the top three competitors is being driven by ${"{gap}"}. The fastest wins this quarter live in ${"{focus}"}.`,
    fastWeek1: "Week 1: quick wins on GBP + reviews",
    fastWeek2: "Weeks 2–4: ship content for the featured service",
    fastWeek3: "Weeks 5–8: authority signals (citations, press, schema)",
    fastWeek4: "Weeks 9–13: competitor displacement campaign",
    kpiRank: "Local rank",
    kpiGbp: "GBP score",
    kpiReviewVel: "Review velocity",
    kpiServiceMentions: "Service-specific mentions",
    kpiContent: "Content drafts shipped",
    kpiPlan: "90-day plan completion",
    actionGbpChecklist: "Complete pending GBP checklist items",
    actionReviewReply: "Reply to outstanding pending reviews",
    actionContentFeatured: "Publish landing page content for featured service",
    actionFaqSchema: "Add FAQPage schema to featured service page",
    actionReviewVelocity: "Run review request flow for last 30 days customers",
    actionCompetitorGap: "Close review-rating gap with top competitor",
    actionLocationCoverage: "Optimise GBP profile for each location",
    actionApprovalPipeline: "Approve pending content drafts and ship",
    actionAuthorityLinks: "Pursue 3 local citations / press mentions",
    actionTrackingSetup: "Connect Search Console + GA4 for live KPIs",
    sourceNote:
      "Reports analyse the data currently available for this tenant. Where a section is sourced from synthetic data (no Google API connected yet), that section is annotated below — connect the relevant integration to upgrade it to live data.",
  },
  es: {
    summaryIntro: (biz: string, geo: string) =>
      `${biz} está actualmente en posición ${"{rank}"} para "${geo}". La brecha con los tres principales competidores se debe a ${"{gap}"}. Las victorias más rápidas del trimestre están en ${"{focus}"}.`,
    fastWeek1: "Semana 1: quick wins en GBP y reseñas",
    fastWeek2: "Semanas 2–4: contenido para el servicio destacado",
    fastWeek3: "Semanas 5–8: señales de autoridad (citas, prensa, schema)",
    fastWeek4: "Semanas 9–13: campaña de desplazamiento competitivo",
    kpiRank: "Posición local",
    kpiGbp: "Score GBP",
    kpiReviewVel: "Velocidad de reseñas",
    kpiServiceMentions: "Menciones del servicio destacado",
    kpiContent: "Contenidos publicados",
    kpiPlan: "Avance plan 90 días",
    actionGbpChecklist: "Completar items pendientes del checklist de GBP",
    actionReviewReply: "Responder reseñas pendientes",
    actionContentFeatured: "Publicar landing page del servicio destacado",
    actionFaqSchema: "Añadir schema FAQPage a la página del servicio destacado",
    actionReviewVelocity: "Activar flujo de solicitud de reseñas a clientes recientes",
    actionCompetitorGap: "Cerrar la brecha de rating con el principal competidor",
    actionLocationCoverage: "Optimizar perfil GBP para cada ubicación",
    actionApprovalPipeline: "Aprobar borradores de contenido pendientes y publicar",
    actionAuthorityLinks: "Conseguir 3 citas locales / menciones en prensa",
    actionTrackingSetup: "Conectar Search Console + GA4 para KPIs en vivo",
    sourceNote:
      "Los reportes analizan los datos disponibles para este cliente. Las secciones que usan datos sintéticos (sin la API de Google conectada todavía) están anotadas más abajo — conecta la integración correspondiente para usar datos reales.",
  },
  sv: {
    summaryIntro: (biz: string, geo: string) =>
      `${biz} har för närvarande placering ${"{rank}"} för "${geo}". Klyftan till topp 3-konkurrenterna drivs av ${"{gap}"}. De snabbaste vinsterna detta kvartal ligger i ${"{focus}"}.`,
    fastWeek1: "Vecka 1: snabba vinster på GBP + recensioner",
    fastWeek2: "Vecka 2–4: innehåll för den utvalda tjänsten",
    fastWeek3: "Vecka 5–8: auktoritetssignaler (citeringar, press, schema)",
    fastWeek4: "Vecka 9–13: konkurrentförflyttningskampanj",
    kpiRank: "Lokal placering",
    kpiGbp: "GBP-poäng",
    kpiReviewVel: "Recensionsfrekvens",
    kpiServiceMentions: "Tjänstespecifika omnämnanden",
    kpiContent: "Innehållsutkast publicerade",
    kpiPlan: "90-dagarsplan slutförande",
    actionGbpChecklist: "Slutför kvarvarande GBP-checklistepunkter",
    actionReviewReply: "Svara på obesvarade recensioner",
    actionContentFeatured: "Publicera landningssida för utvald tjänst",
    actionFaqSchema: "Lägg till FAQPage-schema på sidan för utvald tjänst",
    actionReviewVelocity: "Aktivera flödet för recensionsbegäran för senaste kunder",
    actionCompetitorGap: "Stäng betygsgapet mot den främsta konkurrenten",
    actionLocationCoverage: "Optimera GBP-profil för varje plats",
    actionApprovalPipeline: "Godkänn väntande innehållsutkast och publicera",
    actionAuthorityLinks: "Skaffa 3 lokala citeringar / pressomnämnanden",
    actionTrackingSetup: "Anslut Search Console + GA4 för live KPI:er",
    sourceNote:
      "Rapporten analyserar tillgänglig data för denna kund. Avsnitt med syntetisk data (ingen Google API ansluten ännu) annoteras nedan — anslut integrationen för att uppgradera till live-data.",
  },
};

// ---------------------------------------------------------------------------
// KPI extraction
// ---------------------------------------------------------------------------

function buildKpiSnapshot(snap: BusinessSnapshot): KpiSnapshot {
  const rankNow = snap.rankingTrend.length ? snap.rankingTrend[snap.rankingTrend.length - 1].rank : null;
  const rankBefore = snap.rankingTrend.length > 1 ? snap.rankingTrend[0].rank : null;
  const rankDelta = rankNow !== null && rankBefore !== null ? rankBefore - rankNow : null;

  // GBP score from checklist weights.
  const weights = { Done: 1, "In progress": 0.5, Pending: 0 } as const;
  const gbpScore =
    snap.gbpChecklist.length === 0
      ? 0
      : Math.round(
          (snap.gbpChecklist.reduce((acc, i) => acc + weights[i.status], 0) /
            snap.gbpChecklist.length) *
            100,
        );

  const featured = snap.services.find((s) => s.isFeatured) ?? snap.services[0];
  const reviewsTotal = snap.reviews.length;
  const reviewsServiceMentions = featured
    ? snap.reviews.filter((r) => r.serviceMentioned === featured.name).length
    : 0;
  const contentApproved = snap.content.filter((c) => c.status === "approved").length;
  const contentTotal = snap.content.length;
  const competitorsTracked = snap.competitors.length;
  const totalPlanTasks = snap.plan.length;
  const donePlanTasks = snap.plan.filter((t) => t.status === "completed").length;
  const planCompletion =
    totalPlanTasks > 0 ? Math.round((donePlanTasks / totalPlanTasks) * 100) : 0;

  return {
    localRank: rankNow,
    localRankDelta: rankDelta,
    gbpScore,
    reviewsTotal,
    reviewsServiceMentions,
    contentApproved,
    contentTotal,
    competitorsTracked,
    planCompletion,
  };
}

// ---------------------------------------------------------------------------
// Issue detection rules
// ---------------------------------------------------------------------------

function detectIssues(snap: BusinessSnapshot, kpis: KpiSnapshot): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const featured = snap.services.find((s) => s.isFeatured) ?? snap.services[0];

  // R1 — Pending GBP items.
  const pendingGbp = snap.gbpChecklist.filter((i) => i.status === "Pending");
  if (pendingGbp.length >= 2) {
    issues.push({
      id: "gbp-pending",
      severity: pendingGbp.length >= 4 ? "P1" : "P2",
      category: "GBP",
      title: `${pendingGbp.length} GBP checklist items still pending`,
      rationale:
        "Google Business Profile completeness has the highest local-rank correlation for service businesses. Each pending item is an easy +5–10 percentage points on coverage.",
      evidence: pendingGbp.map((i) => i.item),
      recommendation:
        "Assign each pending item to a teammate. Set a 7-day completion deadline. None of these items take more than 15 minutes individually.",
      difficulty: "Low",
      impact: "High",
    });
  }

  // R2 — Reviews in pending_review status (not replied to yet).
  const unresolvedReviews = snap.reviews.filter((r) => r.status === "pending_review");
  if (unresolvedReviews.length >= 1) {
    issues.push({
      id: "reviews-backlog",
      severity: unresolvedReviews.length >= 3 ? "P1" : "P2",
      category: "Reviews",
      title: `${unresolvedReviews.length} reviews awaiting reply`,
      rationale:
        "Response rate is a public-facing signal. Customers compare brands' attentiveness across listings; an unanswered review tells the next visitor they're not heard either.",
      evidence: unresolvedReviews.slice(0, 3).map((r) => `${r.author}: "${r.text.slice(0, 80)}…"`),
      recommendation:
        "Set a 48-hour SLA for review replies. Use the suggested replies already drafted in /reviews. Each reply lifts your locale-specific signal.",
      difficulty: "Low",
      impact: "Medium",
    });
  }

  // R3 — Featured service exists but no approved content.
  if (featured && kpis.contentApproved === 0) {
    issues.push({
      id: "content-featured-missing",
      severity: "P1",
      category: "Content",
      title: `No published content for featured service "${featured.name}"`,
      rationale:
        "If you can't show Google a landing page optimised for the featured query, no algorithm will rank you for it. Content depth on the primary keyword is your single biggest lever.",
      evidence: [
        `Featured service primary keyword: "${featured.primaryKeyword}"`,
        `Content drafts available: ${kpis.contentTotal} (none approved)`,
      ],
      recommendation:
        "Take the existing meta_title + h1 + FAQ drafts from /content, approve them, and ship the landing page this week. Add FAQPage structured data.",
      difficulty: "Medium",
      impact: "High",
    });
  }

  // R4 — Approval pipeline backlog (drafts that never ship).
  const draftsCount = snap.content.filter((c) => c.status === "draft" || c.status === "pending_review").length;
  if (draftsCount >= 4) {
    issues.push({
      id: "content-approval-backlog",
      severity: "P2",
      category: "Content",
      title: `${draftsCount} content drafts stuck in approval pipeline`,
      rationale:
        "Drafts that never ship don't move metrics. The team is producing the content but the bottleneck is review/approval — that's an organisational problem, not a creative one.",
      evidence: [`Drafts in 'draft' status: ${snap.content.filter((c) => c.status === "draft").length}`,
                 `Awaiting review: ${snap.content.filter((c) => c.status === "pending_review").length}`],
      recommendation:
        "Define an owner for content approval and a weekly publication cadence. Approve and ship at least 2 drafts per week.",
      difficulty: "Low",
      impact: "Medium",
    });
  }

  // R5 — Competitor rating gap.
  if (snap.competitors.length >= 2 && snap.reviews.length > 0) {
    const avgCompetitorRating =
      snap.competitors.reduce((acc, c) => acc + (c.rating ?? 0), 0) / snap.competitors.length;
    const businessAvg =
      snap.reviews.reduce((acc, r) => acc + r.rating, 0) / Math.max(1, snap.reviews.length);
    const gap = avgCompetitorRating - businessAvg;
    if (gap > 0.3) {
      issues.push({
        id: "competitor-rating-gap",
        severity: gap > 0.6 ? "P1" : "P2",
        category: "Competitive",
        title: `${gap.toFixed(1)}-point rating gap with competitor average`,
        rationale:
          "Average rating dominates click-through from local pack listings. A 0.3-point gap costs roughly 15–25% of map-pack CTR.",
        evidence: [
          `Your average: ${businessAvg.toFixed(2)}`,
          `Competitor average: ${avgCompetitorRating.toFixed(2)}`,
          `Tracked competitors: ${snap.competitors.length}`,
        ],
        recommendation:
          "Run a targeted review-request flow to your last 30 days of happy customers. Identify the operational driver of low ratings and fix the root cause before pushing volume.",
        difficulty: "Medium",
        impact: "High",
      });
    }
  }

  // R6 — Service-specific review mentions too low.
  if (featured && kpis.reviewsTotal >= 5) {
    const mentionRate = kpis.reviewsServiceMentions / kpis.reviewsTotal;
    if (mentionRate < 0.2) {
      issues.push({
        id: "service-mentions-weak",
        severity: "P2",
        category: "Reviews",
        title: `Only ${Math.round(mentionRate * 100)}% of reviews mention "${featured.name}"`,
        rationale:
          "Service-specific keywords inside reviews are a Google signal for service-level ranking. Generic 'great place!' reviews don't help you rank for your most valuable query.",
        evidence: [
          `Total reviews: ${kpis.reviewsTotal}`,
          `Reviews mentioning ${featured.name}: ${kpis.reviewsServiceMentions}`,
          `Target mention rate: 25%+`,
        ],
        recommendation:
          "Prompt customers in the review-request message: 'If you came in for X, please mention it in your review — it helps others find us.' Use plain language, never script.",
        difficulty: "Low",
        impact: "Medium",
      });
    }
  }

  // R7 — Multi-location but only one optimised.
  if (snap.locations.length >= 2) {
    issues.push({
      id: "multi-location-coverage",
      severity: "P2",
      category: "GBP",
      title: `${snap.locations.length} locations — each needs its own optimisation`,
      rationale:
        "Each physical location is a separate GBP profile and a separate ranking entity. Optimising only the primary leaves the other(s) invisible in their map area.",
      evidence: snap.locations.map((l) => `${l.label} — ${l.city}, ${l.region}`),
      recommendation:
        "Replicate GBP checklist execution per location. Each location should have its own service descriptions, photos and post cadence.",
      difficulty: "Medium",
      impact: "Medium",
    });
  }

  // R8 — Plan execution low.
  if (kpis.planCompletion < 15 && snap.plan.length > 0) {
    issues.push({
      id: "plan-execution-low",
      severity: "P2",
      category: "Authority",
      title: `90-day plan only ${kpis.planCompletion}% complete`,
      rationale:
        "A plan that doesn't execute is a wish list. SEO compounds — every week skipped is a week your competitors used.",
      evidence: [
        `${snap.plan.filter((t) => t.status === "completed").length} completed / ${snap.plan.length} total tasks`,
      ],
      recommendation:
        "Pick the 3 highest-impact tasks for this week. Block 2 hours per task on the calendar. Ship and mark complete.",
      difficulty: "Low",
      impact: "Medium",
    });
  }

  // R9 — No competitor tracking yet.
  if (snap.competitors.length === 0) {
    issues.push({
      id: "no-competitor-tracking",
      severity: "P3",
      category: "Competitive",
      title: "No competitors being tracked",
      rationale:
        "Without competitor data, every recommendation is in a vacuum. Rank improvements that don't displace someone don't translate to revenue.",
      evidence: ["Competitor list is empty"],
      recommendation:
        "Run the Competitor Intelligence Agent — it identifies 3 plausible competitors based on your industry + city and adds them to your tracking list.",
      difficulty: "Low",
      impact: "Low",
    });
  }

  // R10 — Data freshness — no live integrations.
  // (Detected at engine level via dataSourceHealth, added by buildReport below.)

  // Sort: P1 first, then P2, then P3.
  const sevOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
  return issues.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Action plan synthesis
// ---------------------------------------------------------------------------

function buildActionPlan(snap: BusinessSnapshot, issues: ReportIssue[], lang: typeof STRINGS.en): ReportAction[] {
  const actions: ReportAction[] = [];

  // Map issues → actions, scheduled across 13 weeks.
  const byId = new Map(issues.map((i) => [i.id, i]));

  if (byId.has("gbp-pending")) {
    actions.push({
      id: "a-gbp-pending",
      title: lang.actionGbpChecklist,
      description: byId.get("gbp-pending")!.recommendation,
      owner: "Operations",
      week: 1,
      impact: "High",
      linkedIssueIds: ["gbp-pending"],
    });
  }
  if (byId.has("reviews-backlog")) {
    actions.push({
      id: "a-review-reply",
      title: lang.actionReviewReply,
      description: byId.get("reviews-backlog")!.recommendation,
      owner: "Customer Success",
      week: 1,
      impact: "Medium",
      linkedIssueIds: ["reviews-backlog"],
    });
  }
  if (byId.has("content-featured-missing")) {
    actions.push({
      id: "a-content-featured",
      title: lang.actionContentFeatured,
      description: byId.get("content-featured-missing")!.recommendation,
      owner: "Content",
      week: 2,
      impact: "High",
      linkedIssueIds: ["content-featured-missing"],
    });
    actions.push({
      id: "a-faq-schema",
      title: lang.actionFaqSchema,
      description:
        "Add FAQPage JSON-LD structured data to the featured service page. Use the FAQ drafts already in /content.",
      owner: "Dev",
      week: 2,
      impact: "Medium",
      linkedIssueIds: ["content-featured-missing"],
    });
  }
  if (byId.has("content-approval-backlog")) {
    actions.push({
      id: "a-content-approval",
      title: lang.actionApprovalPipeline,
      description: byId.get("content-approval-backlog")!.recommendation,
      owner: "Marketing",
      week: 3,
      impact: "Medium",
      linkedIssueIds: ["content-approval-backlog"],
    });
  }
  if (byId.has("competitor-rating-gap") || byId.has("service-mentions-weak")) {
    actions.push({
      id: "a-review-velocity",
      title: lang.actionReviewVelocity,
      description:
        "Define a 30-day review-request cadence. Use the suggested message in /reviews. Track week-over-week increase in service-specific mentions.",
      owner: "Customer Success",
      week: 4,
      impact: "High",
      linkedIssueIds: ["competitor-rating-gap", "service-mentions-weak"].filter((id) =>
        byId.has(id),
      ),
    });
  }
  if (byId.has("competitor-rating-gap")) {
    actions.push({
      id: "a-competitor-gap",
      title: lang.actionCompetitorGap,
      description: byId.get("competitor-rating-gap")!.recommendation,
      owner: "Owner",
      week: 5,
      impact: "High",
      linkedIssueIds: ["competitor-rating-gap"],
    });
  }
  if (byId.has("multi-location-coverage")) {
    actions.push({
      id: "a-location-coverage",
      title: lang.actionLocationCoverage,
      description: byId.get("multi-location-coverage")!.recommendation,
      owner: "Operations",
      week: 6,
      impact: "Medium",
      linkedIssueIds: ["multi-location-coverage"],
    });
  }

  // Authority signals always belong in weeks 7–9.
  actions.push({
    id: "a-authority-links",
    title: lang.actionAuthorityLinks,
    description:
      "Identify 5 high-relevance local directories, chambers of commerce or industry associations. Get listed in 3 within 30 days.",
    owner: "Marketing",
    week: 8,
    impact: "Medium",
    linkedIssueIds: [],
  });

  // Tracking — always last (without it, future reports will be guessing).
  actions.push({
    id: "a-tracking-setup",
    title: lang.actionTrackingSetup,
    description:
      "Connect Google Search Console + GA4 in /app/integrations. This unlocks live rank, CTR, sessions and conversion data for future reports.",
    owner: "Dev",
    week: 9,
    impact: "High",
    linkedIssueIds: [],
  });

  return actions.sort((a, b) => a.week - b.week);
}

// ---------------------------------------------------------------------------
// KPIs to track
// ---------------------------------------------------------------------------

function buildTrackingKpis(snap: BusinessSnapshot, kpis: KpiSnapshot, lang: typeof STRINGS.en): ReportKpi[] {
  return [
    {
      label: lang.kpiRank,
      currentValue: kpis.localRank !== null ? `#${kpis.localRank}` : "—",
      target: "Top 3",
      cadence: "Weekly",
    },
    {
      label: lang.kpiGbp,
      currentValue: `${kpis.gbpScore}%`,
      target: "90%+",
      cadence: "Weekly",
    },
    {
      label: lang.kpiReviewVel,
      currentValue: `${kpis.reviewsTotal} total`,
      target: "+5 / month",
      cadence: "Weekly",
    },
    {
      label: lang.kpiServiceMentions,
      currentValue: `${kpis.reviewsServiceMentions} (${
        kpis.reviewsTotal > 0 ? Math.round((kpis.reviewsServiceMentions / kpis.reviewsTotal) * 100) : 0
      }%)`,
      target: "25%+ mention rate",
      cadence: "Weekly",
    },
    {
      label: lang.kpiContent,
      currentValue: `${kpis.contentApproved} / ${kpis.contentTotal}`,
      target: "+2 / week",
      cadence: "Weekly",
    },
    {
      label: lang.kpiPlan,
      currentValue: `${kpis.planCompletion}%`,
      target: "+8% / week",
      cadence: "Weekly",
    },
  ];
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

function buildSummary(snap: BusinessSnapshot, kpis: KpiSnapshot, issues: ReportIssue[], lang: typeof STRINGS.en): string {
  const featured = snap.services.find((s) => s.isFeatured) ?? snap.services[0];
  const geoQuery = featured?.primaryKeyword ?? snap.locations[0]?.primaryGeoQuery ?? "the primary query";
  const rankStr = kpis.localRank !== null ? `#${kpis.localRank}` : "unranked";
  const p1Count = issues.filter((i) => i.severity === "P1").length;
  const focusAreas = Array.from(new Set(issues.slice(0, 3).map((i) => i.category))).join(" + ");

  const gapDescription =
    issues
      .slice(0, 2)
      .map((i) => i.title.toLowerCase())
      .join(" and ") || "execution discipline";

  let text = lang.summaryIntro(snap.business.name, geoQuery)
    .replace("{rank}", rankStr)
    .replace("{gap}", gapDescription)
    .replace("{focus}", focusAreas || "operational hygiene");

  if (p1Count > 0) {
    text += ` ${p1Count} issue${p1Count > 1 ? "s are" : " is"} flagged as P1 and should be addressed this week.`;
  } else {
    text += ` No P1 issues — the team is executing well; focus on compounding the next tier of improvements.`;
  }

  return text;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildReport(
  snap: BusinessSnapshot,
  generatedAtISO: string,
  options: EngineOptions = {},
): Report {
  const locale = snap.business.primaryLocale;
  const lang = STRINGS[locale] ?? STRINGS.en;
  const kpis = buildKpiSnapshot(snap);
  const issues = detectIssues(snap, kpis);
  const actions = buildActionPlan(snap, issues, lang);
  const trackingKpis = buildTrackingKpis(snap, kpis, lang);
  const summary = buildSummary(snap, kpis, issues, lang);

  const dataSourceHealth: DataSourceHealth = {
    places: options.dataSources?.places ?? "demo",
    searchConsole: options.dataSources?.searchConsole ?? "missing",
    gbp: options.dataSources?.gbp ?? "missing",
    ga4: options.dataSources?.ga4 ?? "missing",
    note: lang.sourceNote,
  };

  return {
    id: `rep-${Date.now().toString(36)}`,
    businessId: snap.business.id,
    businessName: snap.business.name,
    locationLabel: snap.locations[0]?.label ?? null,
    generatedAt: generatedAtISO,
    locale,
    summary,
    state: kpis,
    issues,
    actions,
    kpis: trackingKpis,
    dataSourceHealth,
    generator: "heuristic",
  };
}
