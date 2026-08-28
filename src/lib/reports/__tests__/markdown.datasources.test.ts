/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el archivo que el cliente se descarga omita el estado de una fuente.
 *
 * La tabla "Data Source Health" del export tenía cuatro filas escritas a mano y
 * cinco fuentes. La que faltaba era PageSpeed — la ÚNICA que hoy consulta una
 * API de verdad, o sea la única que puede estar en `error`. El reporte en
 * pantalla mostraba el fallo y el archivo que el cliente guarda y reenvía no.
 *
 * Una fila que desaparece no rompe nada: el Markdown sigue siendo válido y la
 * tabla sigue viéndose completa. Por eso el test cuenta las filas contra
 * `DATA_SOURCE_KEYS` en vez de mirar si están las que uno recuerda.
 */
import { describe, expect, it } from "vitest";

import { DATA_SOURCE_KEYS, DATA_SOURCE_LABELS } from "@/lib/reports/dataSources";
import { buildBusinessSnapshot, businesses, locations, services } from "@/lib/mock/universal";
import { buildReport } from "@/lib/reports/engine";
import { reportToMarkdown } from "@/lib/reports/markdown";

const AT = "2026-08-18T12:00:00.000Z";

function reporte(dataSources = {}) {
  const business = businesses[0];
  const snap = buildBusinessSnapshot(
    business,
    locations.filter((l) => l.businessId === business.id),
    services.filter((s) => s.businessId === business.id),
  );
  return buildReport(snap, AT, { dataSources, localeOverride: "es" });
}

describe("reportToMarkdown — la tabla de fuentes", () => {
  it("lista LAS CINCO fuentes, no las que alguien recordó escribir", () => {
    const md = reportToMarkdown(reporte());
    for (const key of DATA_SOURCE_KEYS) {
      expect(md, `falta la fila de ${key}`).toContain(`| ${DATA_SOURCE_LABELS[key]} |`);
    }
    // El conteo, además de la presencia: una fila duplicada o una fuente nueva
    // sin fila cambian este número.
    const filas = md.split("\n").filter((l) => /^\| (Google|Search) /.test(l));
    expect(filas).toHaveLength(DATA_SOURCE_KEYS.length);
  });

  it("el estado de PageSpeed llega al archivo, no sólo a la pantalla", () => {
    // La fila que faltaba, y la única fuente que hoy puede fallar de verdad.
    const md = reportToMarkdown(reporte({ pagespeed: "error" }));
    expect(md).toContain(`| ${DATA_SOURCE_LABELS.pagespeed} | error |`);
  });

  it("un fallo de Search Console o GA4 se distingue de 'sin conectar' en el export", () => {
    const roto = reportToMarkdown(reporte({ searchConsole: "error", ga4: "error" }));
    const sinConectar = reportToMarkdown(reporte({ searchConsole: "missing", ga4: "missing" }));

    expect(roto).toContain(`| ${DATA_SOURCE_LABELS.searchConsole} | error |`);
    expect(roto).toContain(`| ${DATA_SOURCE_LABELS.ga4} | error |`);
    expect(roto).not.toBe(sinConectar);
    // Y la nota en prosa viaja con el archivo: la tabla dice el estado, la nota
    // dice qué hacer con él.
    expect(roto).toContain(DATA_SOURCE_LABELS.searchConsole);
  });
});
