// @vitest-environment jsdom

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el reporte que se ABRE en pantalla no muestre la ficha que cita ni su
 * ICP, mientras el Markdown descargado sí.
 *
 * La puerta H1.3 dice que cambiar el ICP una vez cambia el texto del reporte.
 * La revisión del 2026-10-07 encontró que eso valía sólo para el `.md`: OPEN
 * REPORT monta `ReportView`, que no leía `profileCitation`, y la tarjeta del
 * historial muestra el resumen y los conteos. Quien regeneraba y abría el
 * reporte no veía el nonce. `markdown.profileCitation.test.ts` y
 * `orchestrator.profileCitation.test.ts` miden sólo el Markdown, y seguirían
 * verdes con la pantalla muda.
 *
 * Los reportes se arman con el motor real (`buildReport`), no a mano: el campo
 * que la pantalla lee es el que el motor escribe.
 *
 * MEDIDO con `scripts/mutar.sh` (2026-10-07); la tabla está al final.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReportView } from "../ReportView";
import { buildBusinessSnapshot, businesses, locations, services } from "@/lib/mock/universal";
import { citaLegible } from "@/lib/reports/citaLegible";
import { buildReport } from "@/lib/reports/engine";
import { reportToMarkdown } from "@/lib/reports/markdown";
import type { ProfileCitation, Report } from "@/lib/reports/types";

afterEach(() => cleanup());

const AT = "2026-10-07T10:00:00.000Z";
const V1 = "0d270000-0027-4027-8027-0000000000c1";
const V2 = "0d270000-0027-4027-8027-0000000000c2";
const NONCE_A = "NONCE-PANTALLA-A-5e91";
const NONCE_B = "NONCE-PANTALLA-B-0c3d";

function reporte(profileCitation?: ProfileCitation): Report {
  const seed = businesses[0];
  const snap = buildBusinessSnapshot(
    seed,
    locations.filter((l) => l.businessId === seed.id),
    services.filter((s) => s.businessId === seed.id),
  );
  return buildReport(snap, AT, profileCitation ? { profileCitation } : {});
}

/**
 * Los tres campos llevan su PROPIA marca, sacada del id de la versión y no de
 * la definición. La primera versión los armaba con la definición adentro
 * (`cadenas de 20 sedes ${definition}-D`), así que el nonce aparecía en la
 * tarjeta aunque la pantalla no mostrara la definición: la mutación que la
 * borra SOBREVIVIÓ (G-V4, 2026-10-08).
 */
function citada(versionId: string, version: number, definition: string): ProfileCitation {
  const marca = versionId.slice(-2);
  return {
    status: "cited",
    versionId,
    version,
    publishedAt: "2026-09-01T10:00:00.000Z",
    icp: {
      definition,
      disqualifiers: `cadenas de 20 sedes D-${marca}`,
      buyingTrigger: `abren otra sede T-${marca}`,
      budgetBand: `2-5k SEK B-${marca}`,
    },
  };
}

/** El texto de la tarjeta de la cita, y sólo ella. */
function tarjeta(): string {
  return screen.getByTestId("cita-de-la-ficha").textContent ?? "";
}

describe("el reporte abierto en pantalla muestra la ficha que cita y su ICP", () => {
  it("la versión, el id entero y los cuatro campos del ICP", () => {
    render(<ReportView report={reporte(citada(V1, 3, NONCE_A))} />);

    const t = tarjeta();
    expect(t).toContain("version 3");
    expect(t).toContain(V1);
    expect(t).toContain("Ideal customer profile (ICP)");
    expect(t).toContain(NONCE_A);
    expect(t).toContain("cadenas de 20 sedes D-c1");
    expect(t).toContain("abren otra sede T-c1");
    expect(t).toContain("2-5k SEK B-c1");
  });

  it("anti-vacuidad: el nonce está SÓLO en la definición, así que verlo es ver la definición", () => {
    const cita = citada(V1, 3, NONCE_A);
    if (cita.status !== "cited" || !cita.icp) throw new Error("la cita de prueba no tiene ICP");
    for (const otro of [cita.icp.disqualifiers, cita.icp.buyingTrigger, cita.icp.budgetBand, cita.versionId]) {
      expect(otro).not.toContain(NONCE_A);
    }

    render(<ReportView report={reporte(cita)} />);
    // Y la definición va en su propio elemento, entera.
    expect(screen.getByText(NONCE_A).textContent).toBe(NONCE_A);
  });

  it("cambiar el ICP —publicar otra versión— y regenerar cambia lo que se ve (nonce)", () => {
    const { rerender } = render(<ReportView report={reporte(citada(V1, 1, NONCE_A))} />);
    expect(tarjeta()).toContain(NONCE_A);

    rerender(<ReportView report={reporte(citada(V2, 2, NONCE_B))} />);
    expect(tarjeta()).toContain(NONCE_B);
    expect(tarjeta()).toContain(V2);
    expect(tarjeta()).not.toContain(NONCE_A);
  });

  it("la pantalla y el Markdown dicen lo mismo: cada campo que arma `citaLegible` está en los dos", () => {
    const report = reporte(citada(V1, 1, NONCE_A));
    render(<ReportView report={report} />);
    const md = reportToMarkdown(report);

    const cita = citaLegible(report.profileCitation);
    expect(cita.tipo).toBe("cita");
    if (cita.tipo !== "cita" || cita.icp.tipo !== "icp") throw new Error("la cita de prueba no tiene ICP");
    // Anti-vacuidad: hay campos que comparar.
    expect(cita.icp.campos).toHaveLength(3);

    for (const texto of [cita.versionId, cita.icp.definicion, ...cita.icp.campos.flatMap((c) => [c.etiqueta, c.valor])]) {
      expect(tarjeta(), `pantalla: ${texto}`).toContain(texto);
      expect(md, `markdown: ${texto}`).toContain(texto);
    }
  });

  it.each<[string, ProfileCitation | undefined, string, string[]]>([
    [
      "una versión sin ICP",
      { status: "cited", versionId: V1, version: 1, publishedAt: "2026-09-01T10:00:00.000Z", icp: null },
      "has no ideal customer profile",
      [V1],
    ],
    [
      "una cita de entre H1.2 y H1.3 (sin `icp`)",
      { status: "cited", versionId: V1, version: 1, publishedAt: "2026-09-01T10:00:00.000Z" } as ProfileCitation,
      "generated before reports showed the ideal customer profile",
      [V1],
    ],
    ["sin ficha publicada", { status: "none" }, "No strategic profile has been published", []],
    ["la lectura falló", { status: "error", reason: "42501" }, "could not be read (42501)", []],
    ["un reporte de demostración", { status: "demo" }, "Demo report", []],
    ["un reporte de antes de H1.2 (sin `profileCitation`)", undefined, "generated before reports cited", []],
  ])("%s: lo dice, sin inventar un ICP ni romperse", (_caso, cita, frase, ademas) => {
    const report = reporte(cita);
    // Así vuelve un reporte viejo del historial de `localStorage`.
    if (cita === undefined) delete (report as Partial<Report>).profileCitation;

    render(<ReportView report={report} />);

    expect(tarjeta()).toContain(frase);
    for (const texto of ademas) expect(tarjeta()).toContain(texto);
    expect(tarjeta()).not.toContain("Ideal customer profile (ICP)");
  });

  it("«no se pudo leer» no se presenta como «no hay ficha»", () => {
    render(<ReportView report={reporte({ status: "error", reason: "XX000" })} />);
    expect(tarjeta()).not.toContain("No strategic profile has been published");
  });
});

/**
 * LA MEDICIÓN — `scripts/mutar.sh`, 2026-10-08, cada mutación sola contra el
 * árbol entero (876 tests, 88 archivos). Dónde cae:
 *
 *   ReportView.tsx / citaLegible.ts / markdown.ts             cae
 *   ──────────────────────────────────────────────────────── ───────────────────
 *   G-V1 la pantalla no monta la tarjeta de la cita          los 10 de acá
 *   G-V2 la pantalla no muestra los campos del ICP           cuatro campos;
 *                                                            pantalla = Markdown
 *   G-V3 la pantalla no muestra el version id                cuatro campos;
 *                                                            nonce; pantalla =
 *                                                            Markdown; sin ICP
 *   G-V4 la pantalla no muestra la definición del ICP        SOBREVIVIÓ con la
 *                                                            siembra vieja (ver
 *                                                            `citada`); con la
 *                                                            nueva, 4 de acá
 *   G-M1 el Markdown no muestra la definición                markdown 1 y 2,
 *                                                            orquestador 9, y
 *                                                            pantalla = Markdown
 *   G-C1 `citaLegible` pierde los disqualifiers              cuatro campos;
 *                                                            pantalla = Markdown;
 *                                                            markdown 1
 *   G-C2 `error` se dice con la frase de `none`              «la lectura falló»;
 *                                                            «no se pudo leer»;
 *                                                            markdown none≠error
 */
