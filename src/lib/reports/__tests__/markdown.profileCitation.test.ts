/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la cita a la ficha exista en el JSON y el cliente no la vea. El Markdown
 * es el archivo que el cliente se lleva, y la mitad (b) de H1.2 —«el reporte
 * cita un version_id que resuelve»— sólo sirve si alguien puede tomar ese id y
 * resolverlo. Por eso el id va ENTERO en el texto.
 *
 * Y que «no se pudo leer la ficha» se lea como «no hay ficha». Son dos cosas
 * distintas —un fallo nuestro y un hecho del cliente— y el defecto de
 * presentarlas con la misma frase ya pasó una vez en este motor, con la nota de
 * las fuentes en `error`.
 *
 * Y que el motor, sin que nadie le pase la cita, invente una. Sin la opción dice
 * `demo`, igual que de Places y PageSpeed.
 */
import { describe, expect, it } from "vitest";

import { buildBusinessSnapshot, businesses, locations, services } from "@/lib/mock/universal";
import { buildReport } from "@/lib/reports/engine";
import { reportToMarkdown } from "@/lib/reports/markdown";
import type { ProfileCitation } from "@/lib/reports/types";

const AT = "2026-09-30T10:00:00.000Z";
const V = "0d270000-0027-4027-8027-0000000000a1";

function reporte(profileCitation?: ProfileCitation) {
  const seed = businesses[0];
  const snap = buildBusinessSnapshot(
    seed,
    locations.filter((l) => l.businessId === seed.id),
    services.filter((s) => s.businessId === seed.id),
  );
  return buildReport(snap, AT, profileCitation ? { profileCitation } : {});
}

/** La sección de la cita, y sólo ella: el resto del Markdown puede mencionar otras cosas. */
function seccion(md: string): string {
  const desde = md.indexOf("## Strategic Profile");
  const hasta = md.indexOf("## Data Source Health");
  expect(desde).toBeGreaterThanOrEqual(0);
  expect(hasta).toBeGreaterThan(desde);
  return md.slice(desde, hasta);
}

describe("la cita a la ficha en el reporte que el cliente se lleva", () => {
  it("cita: la versión y el id ENTERO, que es lo que se resuelve con un select", () => {
    const md = reportToMarkdown(
      reporte({ status: "cited", versionId: V, version: 3, publishedAt: "2026-09-01T10:00:00.000Z" }),
    );

    const s = seccion(md);
    expect(s).toContain(`\`${V}\``);
    expect(s).toContain("version 3");
  });

  it("`none` y `error` dicen cosas distintas, y `error` no se disfraza de ficha ausente", () => {
    const none = seccion(reportToMarkdown(reporte({ status: "none" })));
    const error = seccion(reportToMarkdown(reporte({ status: "error", reason: "42P01" })));

    expect(none).not.toBe(error);
    expect(error).toContain("could not be read");
    expect(error).toContain("42P01");
    expect(none).not.toContain("could not be read");
    expect(none).toContain("No strategic profile has been published");
    expect(error).not.toContain("No strategic profile has been published");
  });

  it("sin cita que pasarle, el motor dice `demo` y no inventa una", () => {
    const r = reporte();

    expect(r.profileCitation).toEqual({ status: "demo" });
    expect(seccion(reportToMarkdown(r))).toContain("Demo report");
  });
});
