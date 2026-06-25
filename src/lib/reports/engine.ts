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
  /**
   * Force the output language. When omitted, the engine falls back to the business's
   * primaryLocale. This lets the UI render reports in whichever language the user has
   * picked in the top-right language switcher.
   */
  localeOverride?: "en" | "es" | "sv";
}

// ---------------------------------------------------------------------------
// Locale strings
// ---------------------------------------------------------------------------

const STRINGS = {
  en: {
    summaryIntro: (biz: string, geo: string) =>
      `${biz} is currently ranked ${"{rank}"} for "${geo}". The growth gap to the top three competitors is being driven by ${"{gap}"}. The fastest wins this quarter live in ${"{focus}"}.`,
    summaryP1Single: " 1 issue is flagged as P1 and should be addressed this week.",
    summaryP1Multi: (n: number) => ` ${n} issues are flagged as P1 and should be addressed this week.`,
    summaryNoP1: " No P1 issues — the team is executing well; focus on compounding the next tier of improvements.",
    rankUnranked: "unranked",
    fallbackGap: "execution discipline",
    fallbackFocus: "operational hygiene",
    gapJoin: " and ",
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
    actionDescFaqSchema: "Add FAQPage JSON-LD structured data to the featured service page. Use the FAQ drafts already in /content.",
    actionDescReviewVelocity: "Define a 30-day review-request cadence. Use the suggested message in /reviews. Track week-over-week increase in service-specific mentions.",
    actionDescAuthorityLinks: "Identify 5 high-relevance local directories, chambers of commerce or industry associations. Get listed in 3 within 30 days.",
    actionDescTrackingSetup: "Connect Google Search Console + GA4 in /app/integrations. This unlocks live rank, CTR, sessions and conversion data for future reports.",
    cadenceWeekly: "Weekly",
    targetTop3: "Top 3",
    target90Plus: "90%+",
    targetReviewMonth: "+5 / month",
    targetMentionRate: "25%+ mention rate",
    targetContentWeek: "+2 / week",
    targetPlanWeek: "+8% / week",
    totalSuffix: "total",
    ownerOps: "Operations",
    ownerCS: "Customer Success",
    ownerContent: "Content",
    ownerMarketing: "Marketing",
    ownerDev: "Dev",
    ownerOwner: "Owner",
    issueGbpPendingTitle: (n: number) => `${n} GBP checklist items still pending`,
    issueGbpPendingRationale:
      "Google Business Profile completeness has the highest local-rank correlation for service businesses. Each pending item is an easy +5–10 percentage points on coverage.",
    issueGbpPendingRecommendation:
      "Assign each pending item to a teammate. Set a 7-day completion deadline. None of these items take more than 15 minutes individually.",
    issueReviewsBacklogTitle: (n: number) => `${n} reviews awaiting reply`,
    issueReviewsBacklogRationale:
      "Response rate is a public-facing signal. Customers compare brands' attentiveness across listings; an unanswered review tells the next visitor they're not heard either.",
    issueReviewsBacklogRecommendation:
      "Set a 48-hour SLA for review replies. Use the suggested replies already drafted in /reviews. Each reply lifts your locale-specific signal.",
    issueContentFeaturedTitle: (name: string) => `No published content for featured service "${name}"`,
    issueContentFeaturedRationale:
      "If you can't show Google a landing page optimised for the featured query, no algorithm will rank you for it. Content depth on the primary keyword is your single biggest lever.",
    issueContentFeaturedRecommendation:
      "Take the existing meta_title + h1 + FAQ drafts from /content, approve them, and ship the landing page this week. Add FAQPage structured data.",
    issueContentFeaturedEvidence: (keyword: string, total: number) => [
      `Featured service primary keyword: "${keyword}"`,
      `Content drafts available: ${total} (none approved)`,
    ],
    issueApprovalBacklogTitle: (n: number) => `${n} content drafts stuck in approval pipeline`,
    issueApprovalBacklogRationale:
      "Drafts that never ship don't move metrics. The team is producing the content but the bottleneck is review/approval — that's an organisational problem, not a creative one.",
    issueApprovalBacklogRecommendation:
      "Define an owner for content approval and a weekly publication cadence. Approve and ship at least 2 drafts per week.",
    issueApprovalBacklogEvidence: (draft: number, review: number) => [
      `Drafts in 'draft' status: ${draft}`,
      `Awaiting review: ${review}`,
    ],
    issueRatingGapTitle: (gap: string) => `${gap}-point rating gap with competitor average`,
    issueRatingGapRationale:
      "Average rating dominates click-through from local pack listings. A 0.3-point gap costs roughly 15–25% of map-pack CTR.",
    issueRatingGapRecommendation:
      "Run a targeted review-request flow to your last 30 days of happy customers. Identify the operational driver of low ratings and fix the root cause before pushing volume.",
    issueRatingGapEvidence: (you: string, comp: string, n: number) => [
      `Your average: ${you}`,
      `Competitor average: ${comp}`,
      `Tracked competitors: ${n}`,
    ],
    issueServiceMentionsTitle: (pct: number, name: string) =>
      `Only ${pct}% of reviews mention "${name}"`,
    issueServiceMentionsRationale:
      "Service-specific keywords inside reviews are a Google signal for service-level ranking. Generic 'great place!' reviews don't help you rank for your most valuable query.",
    issueServiceMentionsRecommendation:
      "Prompt customers in the review-request message: 'If you came in for X, please mention it in your review — it helps others find us.' Use plain language, never script.",
    issueServiceMentionsEvidence: (total: number, mentioning: number, name: string) => [
      `Total reviews: ${total}`,
      `Reviews mentioning ${name}: ${mentioning}`,
      `Target mention rate: 25%+`,
    ],
    issueMultiLocationTitle: (n: number) => `${n} locations — each needs its own optimisation`,
    issueMultiLocationRationale:
      "Each physical location is a separate GBP profile and a separate ranking entity. Optimising only the primary leaves the other(s) invisible in their map area.",
    issueMultiLocationRecommendation:
      "Replicate GBP checklist execution per location. Each location should have its own service descriptions, photos and post cadence.",
    issuePlanLowTitle: (pct: number) => `90-day plan only ${pct}% complete`,
    issuePlanLowRationale:
      "A plan that doesn't execute is a wish list. SEO compounds — every week skipped is a week your competitors used.",
    issuePlanLowRecommendation:
      "Pick the 3 highest-impact tasks for this week. Block 2 hours per task on the calendar. Ship and mark complete.",
    issuePlanLowEvidence: (done: number, total: number) => [`${done} completed / ${total} total tasks`],
    issueNoCompetitorsTitle: "No competitors being tracked",
    issueNoCompetitorsRationale:
      "Without competitor data, every recommendation is in a vacuum. Rank improvements that don't displace someone don't translate to revenue.",
    issueNoCompetitorsRecommendation:
      "Run the Competitor Intelligence Agent — it identifies 3 plausible competitors based on your industry + city and adds them to your tracking list.",
    issueNoCompetitorsEvidence: ["Competitor list is empty"],
    kpiLighthouse: "Lighthouse score",
    kpiLcp: "Largest Contentful Paint",
    kpiCls: "Cumulative Layout Shift",
    targetLighthouseGood: "≥ 90",
    targetLcpGood: "≤ 2.5s",
    targetClsGood: "≤ 0.1",
    issuePageSpeedPoorTitle: (score: number) => `PageSpeed score is ${score}/100`,
    issuePageSpeedPoorRationale:
      "Core Web Vitals are a confirmed Google ranking factor and a direct driver of conversion. Slow mobile pages lose local searchers before they ever see your offer — and most local traffic is mobile.",
    issuePageSpeedPoorRecommendation:
      "Prioritise the biggest LCP contributor first (usually an oversized hero image or render-blocking script). Compress and lazy-load images, defer non-critical JS, and reserve space for late-loading elements to stop layout shift.",
    issuePageSpeedPoorEvidence: (lcp: number, cls: number, score: number) => [
      `Lighthouse performance score: ${score}/100`,
      `Largest Contentful Paint: ${(lcp / 1000).toFixed(1)}s (target ≤ 2.5s)`,
      `Cumulative Layout Shift: ${cls.toFixed(2)} (target ≤ 0.1)`,
    ],
    sourceNote:
      "Reports analyse the data currently available for this tenant. Where a section is sourced from synthetic data (no Google API connected yet), that section is annotated below — connect the relevant integration to upgrade it to live data.",
  },
  es: {
    summaryIntro: (biz: string, geo: string) =>
      `${biz} está actualmente en posición ${"{rank}"} para "${geo}". La brecha con los tres principales competidores se debe a ${"{gap}"}. Las victorias más rápidas del trimestre están en ${"{focus}"}.`,
    summaryP1Single: " 1 issue está marcado como P1 y debería resolverse esta semana.",
    summaryP1Multi: (n: number) => ` ${n} issues están marcados como P1 y deberían resolverse esta semana.`,
    summaryNoP1: " Sin issues P1 — el equipo está ejecutando bien; concéntrate en componer la siguiente capa de mejoras.",
    rankUnranked: "sin posicionar",
    fallbackGap: "disciplina de ejecución",
    fallbackFocus: "higiene operativa",
    gapJoin: " y ",
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
    actionDescFaqSchema: "Añadir datos estructurados JSON-LD de FAQPage a la página del servicio destacado. Usa los borradores de FAQ que ya están en /content.",
    actionDescReviewVelocity: "Definir una cadencia de solicitud de reseñas a 30 días. Usa el mensaje sugerido en /reviews. Mide el incremento semana a semana de menciones específicas del servicio.",
    actionDescAuthorityLinks: "Identifica 5 directorios locales, cámaras de comercio o asociaciones de la industria con alta relevancia. Consigue estar listado en 3 en 30 días.",
    actionDescTrackingSetup: "Conecta Google Search Console + GA4 en /app/integrations. Esto desbloquea posición real, CTR, sesiones y conversiones para reportes futuros.",
    cadenceWeekly: "Semanal",
    targetTop3: "Top 3",
    target90Plus: "90%+",
    targetReviewMonth: "+5 / mes",
    targetMentionRate: "Tasa de mención 25%+",
    targetContentWeek: "+2 / semana",
    targetPlanWeek: "+8% / semana",
    totalSuffix: "total",
    ownerOps: "Operaciones",
    ownerCS: "Atención al Cliente",
    ownerContent: "Contenido",
    ownerMarketing: "Marketing",
    ownerDev: "Desarrollo",
    ownerOwner: "Dueño",
    issueGbpPendingTitle: (n: number) => `${n} items del checklist de GBP pendientes`,
    issueGbpPendingRationale:
      "La completitud del perfil de Google Business tiene la mayor correlación con el ranking local para negocios de servicio. Cada item pendiente vale fácil entre +5 y +10 puntos porcentuales de cobertura.",
    issueGbpPendingRecommendation:
      "Asigna cada item pendiente a una persona del equipo. Marca una fecha límite a 7 días. Ninguno toma más de 15 minutos individualmente.",
    issueReviewsBacklogTitle: (n: number) => `${n} reseñas esperando respuesta`,
    issueReviewsBacklogRationale:
      "La tasa de respuesta es una señal pública. Los clientes comparan la atención entre marcas; una reseña sin responder le dice al siguiente visitante que tampoco será escuchado.",
    issueReviewsBacklogRecommendation:
      "Establece un SLA de 48 horas para responder reseñas. Usa las respuestas sugeridas ya redactadas en /reviews. Cada respuesta refuerza tu señal local.",
    issueContentFeaturedTitle: (name: string) => `Sin contenido publicado para el servicio destacado "${name}"`,
    issueContentFeaturedRationale:
      "Si no puedes mostrarle a Google una landing optimizada para la consulta destacada, ningún algoritmo te va a rankear ahí. La profundidad de contenido sobre la keyword principal es tu mayor palanca.",
    issueContentFeaturedRecommendation:
      "Toma los borradores existentes de meta_title + h1 + FAQ desde /content, apruébalos y publica la landing esta semana. Añade datos estructurados FAQPage.",
    issueContentFeaturedEvidence: (keyword: string, total: number) => [
      `Keyword principal del servicio destacado: "${keyword}"`,
      `Borradores disponibles: ${total} (ninguno aprobado)`,
    ],
    issueApprovalBacklogTitle: (n: number) => `${n} borradores de contenido estancados en aprobación`,
    issueApprovalBacklogRationale:
      "Los borradores que nunca se publican no mueven métricas. El equipo está produciendo, pero el cuello de botella está en la revisión/aprobación — es un problema organizativo, no creativo.",
    issueApprovalBacklogRecommendation:
      "Define un responsable de aprobación de contenido y una cadencia semanal de publicación. Aprueba y publica al menos 2 borradores por semana.",
    issueApprovalBacklogEvidence: (draft: number, review: number) => [
      `Borradores en estado 'draft': ${draft}`,
      `Esperando revisión: ${review}`,
    ],
    issueRatingGapTitle: (gap: string) => `Brecha de ${gap} puntos respecto al rating promedio de competidores`,
    issueRatingGapRationale:
      "El rating promedio domina el click-through desde el local pack. Una brecha de 0.3 puntos cuesta aproximadamente 15–25% del CTR del map pack.",
    issueRatingGapRecommendation:
      "Activa un flujo de solicitud de reseñas dirigido a tus últimos 30 días de clientes contentos. Identifica la causa operativa de los ratings bajos y arréglala antes de empujar volumen.",
    issueRatingGapEvidence: (you: string, comp: string, n: number) => [
      `Tu promedio: ${you}`,
      `Promedio de competidores: ${comp}`,
      `Competidores trackeados: ${n}`,
    ],
    issueServiceMentionsTitle: (pct: number, name: string) =>
      `Solo el ${pct}% de las reseñas menciona "${name}"`,
    issueServiceMentionsRationale:
      "Las keywords específicas del servicio dentro de las reseñas son una señal para Google a nivel de servicio. Las reseñas genéricas tipo '¡gran lugar!' no te ayudan a rankear para tu consulta más valiosa.",
    issueServiceMentionsRecommendation:
      "Pide a los clientes en el mensaje de solicitud: 'Si viniste por X, menciónalo en tu reseña — ayuda a otros a encontrarnos.' Lenguaje natural, nunca scripted.",
    issueServiceMentionsEvidence: (total: number, mentioning: number, name: string) => [
      `Reseñas totales: ${total}`,
      `Reseñas que mencionan ${name}: ${mentioning}`,
      `Objetivo de tasa de mención: 25%+`,
    ],
    issueMultiLocationTitle: (n: number) => `${n} ubicaciones — cada una necesita su propia optimización`,
    issueMultiLocationRationale:
      "Cada ubicación física es un perfil GBP separado y una entidad de ranking distinta. Optimizar solo la principal deja las demás invisibles en su zona del mapa.",
    issueMultiLocationRecommendation:
      "Replica la ejecución del checklist de GBP por cada ubicación. Cada una debe tener sus propias descripciones de servicio, fotos y cadencia de posts.",
    issuePlanLowTitle: (pct: number) => `Plan a 90 días solo al ${pct}% de avance`,
    issuePlanLowRationale:
      "Un plan que no se ejecuta es una lista de deseos. El SEO es acumulativo — cada semana saltada es una semana que aprovechan tus competidores.",
    issuePlanLowRecommendation:
      "Elige las 3 tareas de mayor impacto para esta semana. Bloquea 2 horas por tarea en el calendario. Ejecuta y marca como completadas.",
    issuePlanLowEvidence: (done: number, total: number) => [`${done} completadas / ${total} tareas totales`],
    issueNoCompetitorsTitle: "Sin competidores trackeados",
    issueNoCompetitorsRationale:
      "Sin datos de competidores, cada recomendación está en el vacío. Las mejoras de ranking que no desplazan a nadie no se traducen en ingresos.",
    issueNoCompetitorsRecommendation:
      "Corre el Competitor Intelligence Agent — identifica 3 competidores plausibles según tu industria + ciudad y los añade a tu lista de seguimiento.",
    issueNoCompetitorsEvidence: ["Lista de competidores vacía"],
    kpiLighthouse: "Score de Lighthouse",
    kpiLcp: "Largest Contentful Paint",
    kpiCls: "Cumulative Layout Shift",
    targetLighthouseGood: "≥ 90",
    targetLcpGood: "≤ 2.5s",
    targetClsGood: "≤ 0.1",
    issuePageSpeedPoorTitle: (score: number) => `Score de PageSpeed: ${score}/100`,
    issuePageSpeedPoorRationale:
      "Los Core Web Vitals son un factor de ranking confirmado por Google y un impulsor directo de la conversión. Las páginas móviles lentas pierden a los buscadores locales antes de que vean tu oferta — y la mayoría del tráfico local es móvil.",
    issuePageSpeedPoorRecommendation:
      "Prioriza primero el mayor contribuyente al LCP (normalmente una imagen hero sobredimensionada o un script que bloquea el render). Comprime y aplica lazy-load a las imágenes, difiere el JS no crítico y reserva espacio para los elementos que cargan tarde para frenar el desplazamiento de layout.",
    issuePageSpeedPoorEvidence: (lcp: number, cls: number, score: number) => [
      `Score de rendimiento de Lighthouse: ${score}/100`,
      `Largest Contentful Paint: ${(lcp / 1000).toFixed(1)}s (objetivo ≤ 2.5s)`,
      `Cumulative Layout Shift: ${cls.toFixed(2)} (objetivo ≤ 0.1)`,
    ],
    sourceNote:
      "Los reportes analizan los datos disponibles para este cliente. Las secciones que usan datos sintéticos (sin la API de Google conectada todavía) están anotadas más abajo — conecta la integración correspondiente para usar datos reales.",
  },
  sv: {
    summaryIntro: (biz: string, geo: string) =>
      `${biz} har för närvarande placering ${"{rank}"} för "${geo}". Klyftan till topp 3-konkurrenterna drivs av ${"{gap}"}. De snabbaste vinsterna detta kvartal ligger i ${"{focus}"}.`,
    summaryP1Single: " 1 problem är flaggat som P1 och bör åtgärdas den här veckan.",
    summaryP1Multi: (n: number) => ` ${n} problem är flaggade som P1 och bör åtgärdas den här veckan.`,
    summaryNoP1: " Inga P1-problem — teamet exekverar bra; fokusera på att förstärka nästa nivå av förbättringar.",
    rankUnranked: "oplacerad",
    fallbackGap: "exekveringsdisciplin",
    fallbackFocus: "operativ hygien",
    gapJoin: " och ",
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
    actionDescFaqSchema: "Lägg till FAQPage JSON-LD strukturerad data på sidan för den utvalda tjänsten. Använd FAQ-utkasten som redan finns i /content.",
    actionDescReviewVelocity: "Definiera en 30-dagars kadens för recensionsbegäran. Använd det föreslagna meddelandet i /reviews. Mät ökningen av tjänstespecifika omnämnanden vecka över vecka.",
    actionDescAuthorityLinks: "Identifiera 5 lokala kataloger, handelskammare eller branschorganisationer med hög relevans. Bli listad i 3 inom 30 dagar.",
    actionDescTrackingSetup: "Anslut Google Search Console + GA4 i /app/integrations. Det låser upp live-placering, CTR, sessioner och konverteringsdata för framtida rapporter.",
    cadenceWeekly: "Veckovis",
    targetTop3: "Topp 3",
    target90Plus: "90%+",
    targetReviewMonth: "+5 / månad",
    targetMentionRate: "Omnämnandegrad 25%+",
    targetContentWeek: "+2 / vecka",
    targetPlanWeek: "+8% / vecka",
    totalSuffix: "totalt",
    ownerOps: "Drift",
    ownerCS: "Kundframgång",
    ownerContent: "Innehåll",
    ownerMarketing: "Marknadsföring",
    ownerDev: "Utveckling",
    ownerOwner: "Ägare",
    issueGbpPendingTitle: (n: number) => `${n} GBP-checklistepunkter kvarstår`,
    issueGbpPendingRationale:
      "Fullständighet i Google Business-profilen har den högsta korrelationen med lokal placering för tjänsteföretag. Varje väntande punkt är enkelt +5–10 procentenheter på täckningen.",
    issueGbpPendingRecommendation:
      "Tilldela varje väntande punkt till en teamkamrat. Sätt en deadline på 7 dagar. Ingen av punkterna tar mer än 15 minuter individuellt.",
    issueReviewsBacklogTitle: (n: number) => `${n} recensioner väntar på svar`,
    issueReviewsBacklogRationale:
      "Svarsfrekvens är en publik signal. Kunder jämför varumärkens uppmärksamhet mellan listningar; en obesvarad recension säger till nästa besökare att inte heller de blir hörda.",
    issueReviewsBacklogRecommendation:
      "Sätt en 48-timmars SLA för recensionssvar. Använd de föreslagna svaren som redan finns i /reviews. Varje svar förstärker din lokala signal.",
    issueContentFeaturedTitle: (name: string) => `Inget publicerat innehåll för den utvalda tjänsten "${name}"`,
    issueContentFeaturedRationale:
      "Om du inte kan visa Google en landningssida som är optimerad för den utvalda frågan kommer ingen algoritm rangordna dig för den. Innehållsdjup på huvudnyckelordet är din enskilt största hävstång.",
    issueContentFeaturedRecommendation:
      "Ta de befintliga utkasten av meta_title + h1 + FAQ från /content, godkänn dem och publicera landningssidan denna vecka. Lägg till FAQPage-strukturerad data.",
    issueContentFeaturedEvidence: (keyword: string, total: number) => [
      `Den utvalda tjänstens huvudnyckelord: "${keyword}"`,
      `Tillgängliga innehållsutkast: ${total} (inga godkända)`,
    ],
    issueApprovalBacklogTitle: (n: number) => `${n} innehållsutkast fastnar i godkännandekön`,
    issueApprovalBacklogRationale:
      "Utkast som aldrig publiceras flyttar inga mätvärden. Teamet producerar innehåll, men flaskhalsen är granskning/godkännande — det är ett organisatoriskt problem, inte ett kreativt.",
    issueApprovalBacklogRecommendation:
      "Utse en ansvarig för innehållsgodkännande och en veckovis publiceringskadens. Godkänn och publicera minst 2 utkast per vecka.",
    issueApprovalBacklogEvidence: (draft: number, review: number) => [
      `Utkast i 'draft'-status: ${draft}`,
      `Väntar på granskning: ${review}`,
    ],
    issueRatingGapTitle: (gap: string) => `${gap}-poängs betygsgap mot konkurrenters snitt`,
    issueRatingGapRationale:
      "Genomsnittligt betyg dominerar klickfrekvensen från det lokala paketet. Ett 0,3-poängs gap kostar ungefär 15–25% av map-pack-CTR.",
    issueRatingGapRecommendation:
      "Kör en riktad recensionsbegäran till dina senaste 30 dagars nöjda kunder. Identifiera den operativa drivkraften bakom låga betyg och åtgärda rotorsaken innan du driver volym.",
    issueRatingGapEvidence: (you: string, comp: string, n: number) => [
      `Ditt snitt: ${you}`,
      `Konkurrenters snitt: ${comp}`,
      `Spårade konkurrenter: ${n}`,
    ],
    issueServiceMentionsTitle: (pct: number, name: string) =>
      `Endast ${pct}% av recensionerna nämner "${name}"`,
    issueServiceMentionsRationale:
      "Tjänstespecifika nyckelord i recensioner är en Google-signal för tjänsterelaterad ranking. Generiska 'fantastiskt ställe!'-recensioner hjälper dig inte att rangordna för din mest värdefulla fråga.",
    issueServiceMentionsRecommendation:
      "Be kunderna i meddelandet om recensionsbegäran: 'Om du kom in för X, nämn det gärna i din recension — det hjälper andra att hitta oss.' Naturligt språk, aldrig scriptat.",
    issueServiceMentionsEvidence: (total: number, mentioning: number, name: string) => [
      `Totala recensioner: ${total}`,
      `Recensioner som nämner ${name}: ${mentioning}`,
      `Måltal för omnämnandegrad: 25%+`,
    ],
    issueMultiLocationTitle: (n: number) => `${n} platser — var och en behöver sin egen optimering`,
    issueMultiLocationRationale:
      "Varje fysisk plats är en separat GBP-profil och en separat rankingenhet. Att bara optimera den primära lämnar de andra osynliga i sitt kartområde.",
    issueMultiLocationRecommendation:
      "Replikera GBP-checklistans exekvering per plats. Varje plats bör ha sina egna tjänstebeskrivningar, foton och postningskadens.",
    issuePlanLowTitle: (pct: number) => `90-dagarsplan endast ${pct}% slutförd`,
    issuePlanLowRationale:
      "En plan som inte exekveras är en önskelista. SEO är kumulativ — varje vecka som hoppas över är en vecka dina konkurrenter använder.",
    issuePlanLowRecommendation:
      "Välj de 3 uppgifter med störst påverkan för denna vecka. Boka 2 timmar per uppgift i kalendern. Genomför och markera som klart.",
    issuePlanLowEvidence: (done: number, total: number) => [`${done} slutförda / ${total} totala uppgifter`],
    issueNoCompetitorsTitle: "Inga konkurrenter spåras",
    issueNoCompetitorsRationale:
      "Utan konkurrentdata sker varje rekommendation i ett vakuum. Rankingförbättringar som inte förflyttar någon översätts inte till intäkter.",
    issueNoCompetitorsRecommendation:
      "Kör Competitor Intelligence-agenten — den identifierar 3 troliga konkurrenter baserat på din bransch + stad och lägger till dem i din spårningslista.",
    issueNoCompetitorsEvidence: ["Konkurrentlistan är tom"],
    kpiLighthouse: "Lighthouse-poäng",
    kpiLcp: "Largest Contentful Paint",
    kpiCls: "Cumulative Layout Shift",
    targetLighthouseGood: "≥ 90",
    targetLcpGood: "≤ 2.5s",
    targetClsGood: "≤ 0.1",
    issuePageSpeedPoorTitle: (score: number) => `PageSpeed-poäng: ${score}/100`,
    issuePageSpeedPoorRationale:
      "Core Web Vitals är en bekräftad Google-rankingfaktor och en direkt drivkraft för konvertering. Långsamma mobilsidor tappar lokala sökare innan de ens ser ditt erbjudande — och merparten av lokal trafik är mobil.",
    issuePageSpeedPoorRecommendation:
      "Prioritera den största LCP-bidragsgivaren först (oftast en överdimensionerad hero-bild eller ett renderingsblockerande skript). Komprimera och lazy-loada bilder, skjut upp icke-kritisk JS och reservera plats för sent laddade element för att stoppa layoutförskjutning.",
    issuePageSpeedPoorEvidence: (lcp: number, cls: number, score: number) => [
      `Lighthouse prestandapoäng: ${score}/100`,
      `Largest Contentful Paint: ${(lcp / 1000).toFixed(1)}s (mål ≤ 2.5s)`,
      `Cumulative Layout Shift: ${cls.toFixed(2)} (mål ≤ 0.1)`,
    ],
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
    webVitals: snap.webVitals,
  };
}

// ---------------------------------------------------------------------------
// Issue detection rules
// ---------------------------------------------------------------------------

function detectIssues(snap: BusinessSnapshot, kpis: KpiSnapshot, lang: typeof STRINGS.en): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const featured = snap.services.find((s) => s.isFeatured) ?? snap.services[0];

  // R1 — Pending GBP items.
  const pendingGbp = snap.gbpChecklist.filter((i) => i.status === "Pending");
  if (pendingGbp.length >= 2) {
    issues.push({
      id: "gbp-pending",
      severity: pendingGbp.length >= 4 ? "P1" : "P2",
      category: "GBP",
      title: lang.issueGbpPendingTitle(pendingGbp.length),
      rationale: lang.issueGbpPendingRationale,
      evidence: pendingGbp.map((i) => i.item),
      recommendation: lang.issueGbpPendingRecommendation,
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
      title: lang.issueReviewsBacklogTitle(unresolvedReviews.length),
      rationale: lang.issueReviewsBacklogRationale,
      evidence: unresolvedReviews.slice(0, 3).map((r) => `${r.author}: "${r.text.slice(0, 80)}…"`),
      recommendation: lang.issueReviewsBacklogRecommendation,
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
      title: lang.issueContentFeaturedTitle(featured.name),
      rationale: lang.issueContentFeaturedRationale,
      evidence: lang.issueContentFeaturedEvidence(featured.primaryKeyword, kpis.contentTotal),
      recommendation: lang.issueContentFeaturedRecommendation,
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
      title: lang.issueApprovalBacklogTitle(draftsCount),
      rationale: lang.issueApprovalBacklogRationale,
      evidence: lang.issueApprovalBacklogEvidence(
        snap.content.filter((c) => c.status === "draft").length,
        snap.content.filter((c) => c.status === "pending_review").length,
      ),
      recommendation: lang.issueApprovalBacklogRecommendation,
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
        title: lang.issueRatingGapTitle(gap.toFixed(1)),
        rationale: lang.issueRatingGapRationale,
        evidence: lang.issueRatingGapEvidence(
          businessAvg.toFixed(2),
          avgCompetitorRating.toFixed(2),
          snap.competitors.length,
        ),
        recommendation: lang.issueRatingGapRecommendation,
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
        title: lang.issueServiceMentionsTitle(Math.round(mentionRate * 100), featured.name),
        rationale: lang.issueServiceMentionsRationale,
        evidence: lang.issueServiceMentionsEvidence(
          kpis.reviewsTotal,
          kpis.reviewsServiceMentions,
          featured.name,
        ),
        recommendation: lang.issueServiceMentionsRecommendation,
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
      title: lang.issueMultiLocationTitle(snap.locations.length),
      rationale: lang.issueMultiLocationRationale,
      evidence: snap.locations.map((l) => `${l.label} — ${l.city}, ${l.region}`),
      recommendation: lang.issueMultiLocationRecommendation,
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
      title: lang.issuePlanLowTitle(kpis.planCompletion),
      rationale: lang.issuePlanLowRationale,
      evidence: lang.issuePlanLowEvidence(
        snap.plan.filter((t) => t.status === "completed").length,
        snap.plan.length,
      ),
      recommendation: lang.issuePlanLowRecommendation,
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
      title: lang.issueNoCompetitorsTitle,
      rationale: lang.issueNoCompetitorsRationale,
      evidence: lang.issueNoCompetitorsEvidence,
      recommendation: lang.issueNoCompetitorsRecommendation,
      difficulty: "Low",
      impact: "Low",
    });
  }

  // R10 — Data freshness — no live integrations.
  // (Detected at engine level via dataSourceHealth, added by buildReport below.)

  // R11 — Degraded PageSpeed / Core Web Vitals (only when real data is present).
  if (snap.webVitals) {
    const score = snap.webVitals.lighthouseScore;
    if (score < 80) {
      issues.push({
        id: "pagespeed-poor",
        severity: score < 50 ? "P1" : "P2",
        category: "Technical SEO",
        title: lang.issuePageSpeedPoorTitle(score),
        rationale: lang.issuePageSpeedPoorRationale,
        evidence: lang.issuePageSpeedPoorEvidence(
          snap.webVitals.lcp,
          snap.webVitals.cls,
          score,
        ),
        recommendation: lang.issuePageSpeedPoorRecommendation,
        difficulty: "Medium",
        impact: "High",
      });
    }
  }

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
      owner: lang.ownerOps,
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
      owner: lang.ownerCS,
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
      owner: lang.ownerContent,
      week: 2,
      impact: "High",
      linkedIssueIds: ["content-featured-missing"],
    });
    actions.push({
      id: "a-faq-schema",
      title: lang.actionFaqSchema,
      description: lang.actionDescFaqSchema,
      owner: lang.ownerDev,
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
      owner: lang.ownerMarketing,
      week: 3,
      impact: "Medium",
      linkedIssueIds: ["content-approval-backlog"],
    });
  }
  if (byId.has("competitor-rating-gap") || byId.has("service-mentions-weak")) {
    actions.push({
      id: "a-review-velocity",
      title: lang.actionReviewVelocity,
      description: lang.actionDescReviewVelocity,
      owner: lang.ownerCS,
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
      owner: lang.ownerOwner,
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
      owner: lang.ownerOps,
      week: 6,
      impact: "Medium",
      linkedIssueIds: ["multi-location-coverage"],
    });
  }

  // Authority signals always belong in weeks 7–9.
  actions.push({
    id: "a-authority-links",
    title: lang.actionAuthorityLinks,
    description: lang.actionDescAuthorityLinks,
    owner: lang.ownerMarketing,
    week: 8,
    impact: "Medium",
    linkedIssueIds: [],
  });

  // Tracking — always last (without it, future reports will be guessing).
  actions.push({
    id: "a-tracking-setup",
    title: lang.actionTrackingSetup,
    description: lang.actionDescTrackingSetup,
    owner: lang.ownerDev,
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
  const list: ReportKpi[] = [
    {
      label: lang.kpiRank,
      currentValue: kpis.localRank !== null ? `#${kpis.localRank}` : "—",
      target: lang.targetTop3,
      cadence: lang.cadenceWeekly,
    },
    {
      label: lang.kpiGbp,
      currentValue: `${kpis.gbpScore}%`,
      target: lang.target90Plus,
      cadence: lang.cadenceWeekly,
    },
    {
      label: lang.kpiReviewVel,
      currentValue: `${kpis.reviewsTotal} ${lang.totalSuffix}`,
      target: lang.targetReviewMonth,
      cadence: lang.cadenceWeekly,
    },
    {
      label: lang.kpiServiceMentions,
      currentValue: `${kpis.reviewsServiceMentions} (${
        kpis.reviewsTotal > 0 ? Math.round((kpis.reviewsServiceMentions / kpis.reviewsTotal) * 100) : 0
      }%)`,
      target: lang.targetMentionRate,
      cadence: lang.cadenceWeekly,
    },
    {
      label: lang.kpiContent,
      currentValue: `${kpis.contentApproved} / ${kpis.contentTotal}`,
      target: lang.targetContentWeek,
      cadence: lang.cadenceWeekly,
    },
    {
      label: lang.kpiPlan,
      currentValue: `${kpis.planCompletion}%`,
      target: lang.targetPlanWeek,
      cadence: lang.cadenceWeekly,
    },
  ];

  // Web Vitals KPIs — only when real PageSpeed data was hydrated.
  if (snap.webVitals) {
    list.push({
      label: lang.kpiLighthouse,
      currentValue: `${snap.webVitals.lighthouseScore}/100`,
      target: lang.targetLighthouseGood,
      cadence: lang.cadenceWeekly,
    });
    list.push({
      label: lang.kpiLcp,
      currentValue: `${(snap.webVitals.lcp / 1000).toFixed(1)}s`,
      target: lang.targetLcpGood,
      cadence: lang.cadenceWeekly,
    });
  }

  return list;
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

function buildSummary(snap: BusinessSnapshot, kpis: KpiSnapshot, issues: ReportIssue[], lang: typeof STRINGS.en): string {
  const featured = snap.services.find((s) => s.isFeatured) ?? snap.services[0];
  const geoQuery = featured?.primaryKeyword ?? snap.locations[0]?.primaryGeoQuery ?? lang.fallbackFocus;
  const rankStr = kpis.localRank !== null ? `#${kpis.localRank}` : lang.rankUnranked;
  const p1Count = issues.filter((i) => i.severity === "P1").length;
  const focusAreas = Array.from(new Set(issues.slice(0, 3).map((i) => i.category))).join(" + ");

  const gapDescription =
    issues
      .slice(0, 2)
      .map((i) => i.title.toLowerCase())
      .join(lang.gapJoin) || lang.fallbackGap;

  let text = lang.summaryIntro(snap.business.name, geoQuery)
    .replace("{rank}", rankStr)
    .replace("{gap}", gapDescription)
    .replace("{focus}", focusAreas || lang.fallbackFocus);

  if (p1Count > 0) {
    text += p1Count === 1 ? lang.summaryP1Single : lang.summaryP1Multi(p1Count);
  } else {
    text += lang.summaryNoP1;
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
  const locale = options.localeOverride ?? snap.business.primaryLocale;
  const lang = STRINGS[locale] ?? STRINGS.en;
  const kpis = buildKpiSnapshot(snap);
  const issues = detectIssues(snap, kpis, lang);
  const actions = buildActionPlan(snap, issues, lang);
  const trackingKpis = buildTrackingKpis(snap, kpis, lang);
  const summary = buildSummary(snap, kpis, issues, lang);

  const dataSourceHealth: DataSourceHealth = {
    places: options.dataSources?.places ?? "demo",
    pagespeed: options.dataSources?.pagespeed ?? "demo",
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
