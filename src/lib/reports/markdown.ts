/**
 * El reporte, en Markdown — el archivo que el cliente se lleva.
 *
 * Vivía dentro de `reports/page.tsx`, donde no había forma de probarlo sin
 * montar la página entera. Es una función pura de `Report` a texto, así que sale
 * al lado del motor y se prueba directo. La mudanza no cambia una línea de lo
 * que produce salvo la tabla de fuentes, que antes tenía cuatro filas escritas a
 * mano y se había quedado sin PageSpeed — la única fuente que hoy trae datos
 * reales. El export omitía justo el estado que importaba.
 */

import { DATA_SOURCE_KEYS, DATA_SOURCE_LABELS } from "./dataSources";
import { citaLegible, ETIQUETA_DEL_ICP, type IcpLegible } from "./citaLegible";
import type { ProfileCitation, Report } from "./types";

/**
 * La línea que dice contra qué versión de la ficha se escribió el reporte.
 *
 * Cuatro frases para cuatro estados, y la de `error` NO se parece a la de
 * `none`: el cliente que lee «no strategic profile has been published» y el que
 * lee «the strategic profile could not be read» tienen que hacer cosas
 * distintas. El id va entero y no recortado: es lo que alguien pega en un
 * `select ... where id = ...` para resolver la cita, que es la mitad (b) de la
 * puerta H1.2.
 *
 * Y acepta `undefined` aunque el tipo diga que el campo es obligatorio, porque
 * el tipo no gobierna lo que ya está guardado. La pantalla de reportes guarda el
 * historial en `localStorage` (`lg.reports.cache.v1`) y lo relee con un
 * `JSON.parse` sin validar: todo reporte generado antes de H1.2 vuelve SIN
 * `profileCitation`, y exportarlo reventaba con un TypeError al leer `.status`.
 * Lo encontró la revisión adversarial del 2026-09-30. Un reporte viejo dice que
 * es viejo; no finge una cita que nunca tuvo.
 */
function citationLine(c: ProfileCitation | undefined): string {
  const cita = citaLegible(c);
  if (cita.tipo === "aviso") return cita.texto;
  return (
    `Written against strategic profile **version ${cita.version}**, published ${new Date(cita.publicadaEl).toLocaleDateString()} — version id \`${cita.versionId}\`.` +
    "\n\n" +
    icpLines(cita.icp)
  );
}

/**
 * El ICP de la versión citada (H1.3), en el texto que el cliente se lleva.
 *
 * Es la mitad de Growth OS de la puerta «cambiar el ICP una vez cambia el
 * prompt del Lead Engine Y el texto del reporte»: el ICP sale de la cita, que
 * sale de la misma lectura que sirve la ficha al Lead Engine. No hay un ICP
 * escrito acá ni uno por defecto: si la versión no tiene, se dice. Qué se dice
 * en cada caso lo decide `citaLegible`, la misma que usa la pantalla
 * (`ReportView`); acá sólo va el formato Markdown.
 */
function icpLines(icp: IcpLegible): string {
  if (icp.tipo === "aviso") return icp.texto;
  return [
    `**${ETIQUETA_DEL_ICP}:** ${icp.definicion}`,
    ...icp.campos.map((c) => `- **${c.etiqueta}:** ${c.valor}`),
  ].join("\n");
}

export function reportToMarkdown(r: Report): string {
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

  // Recorrido, y no cuatro filas escritas a mano: la lista escrita a mano se
  // había quedado sin PageSpeed —la única fuente que hoy trae datos reales—, así
  // que el export omitía justo el estado que importaba. Recorrer
  // DATA_SOURCE_KEYS hace que una fuente nueva aparezca acá sola.
  const sources = DATA_SOURCE_KEYS.map(
    (key) => `| ${DATA_SOURCE_LABELS[key]} | ${r.dataSourceHealth[key]} |`,
  ).join("\n");

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

## Strategic Profile

${citationLine(r.profileCitation)}

## Data Source Health

| Source | Status |
|--------|--------|
${sources}

> ${r.dataSourceHealth.note}

---
*Generated by Vulkan Growth OS · Reporting Engine ${r.generator}*
`;
}
