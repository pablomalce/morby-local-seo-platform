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
 *
 * Y que un reporte guardado antes de H1.2 haga reventar el export.
 *
 * MEDIDO CON `scripts/mutar.sh` (2026-09-30), cada una sola; todas cayeron acá:
 * el motor dice `none` sin cita; la frase de `error` es la de `none`; el id va
 * recortado a ocho caracteres; y sin la guarda de `undefined`, el export de un
 * reporte viejo tira un TypeError.
 *
 * Y desde H1.3, que el texto del reporte NO muestre el ICP de la versión que
 * cita —la mitad de Growth OS de «cambiar el ICP una vez cambia el prompt del
 * Lead Engine y el texto del reporte»—, o que lo invente cuando la versión no
 * tiene, o que un reporte guardado entre H1.2 y H1.3 (cita sin `icp`) reviente
 * el export. Las mutaciones de este tramo están en el bloque «el ICP de la
 * versión citada», con su resultado.
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
      reporte({
        status: "cited",
        versionId: V,
        version: 3,
        publishedAt: "2026-09-01T10:00:00.000Z",
        icp: null,
      }),
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

  it("un reporte guardado ANTES de H1.2 —sin `profileCitation`— se exporta y dice que es viejo", () => {
    // Es lo que devuelve el historial de `localStorage` para todo reporte
    // generado antes de este cambio: el tipo dice que el campo existe, el JSON
    // guardado no lo tiene. La primera versión reventaba acá con un TypeError.
    const viejo = { ...reporte() } as Partial<ReturnType<typeof reporte>>;
    delete viejo.profileCitation;

    const md = reportToMarkdown(viejo as ReturnType<typeof reporte>);

    expect(seccion(md)).toContain("generated before reports cited a strategic profile");
  });

  it("sin cita que pasarle, el motor dice `demo` y no inventa una", () => {
    const r = reporte();

    expect(r.profileCitation).toEqual({ status: "demo" });
    expect(seccion(reportToMarkdown(r))).toContain("Demo report");
  });
});

/**
 * EL ICP DE LA VERSIÓN CITADA (H1.3)
 *
 * MEDIDO CON `scripts/mutar.sh` (2026-10-07), cada una sola contra el árbol
 * entero (832 tests); todas CAYERON y todas acá. Entre paréntesis, lo que cayó
 * además en orchestrator.profileCitation.test.ts:
 *
 *   markdown.ts                                             cae
 *   ─────────────────────────────────────────────────────── ──────────────────
 *   `icpLines(c.icp)` sale de la línea de la cita           1, 2, 3, 4 (9, 11)
 *   la definición no se imprime (sólo la etiqueta)          1, 2 (9)
 *   `icp === null` pasa a `icp == undefined`                3 (11)
 *   sin la guarda de `undefined` (TypeError en .definition) 4
 *   los opcionales se imprimen aunque sean null             2
 */
describe("el ICP de la versión citada, en el texto que el cliente se lleva", () => {
  const NONCE = "icp-nonce-7f3c9a1e-unico-en-esta-corrida";
  const citada = (icp: Extract<ProfileCitation, { status: "cited" }>["icp"]): ProfileCitation => ({
    status: "cited",
    versionId: V,
    version: 4,
    publishedAt: "2026-10-01T10:00:00.000Z",
    icp,
  });

  it("1. la definición del ICP de la versión citada aparece en la sección, entera", () => {
    const s = seccion(
      reportToMarkdown(
        reporte(
          citada({
            definition: `Clínicas dentales de Estocolmo ${NONCE}`,
            disqualifiers: "cadenas con más de 20 sedes",
            buyingTrigger: "abren una segunda sede",
            budgetBand: "2-5k SEK/mes",
          }),
        ),
      ),
    );

    expect(s).toContain(`\`${V}\``);
    expect(s).toContain(`Clínicas dentales de Estocolmo ${NONCE}`);
    expect(s).toContain("cadenas con más de 20 sedes");
    expect(s).toContain("abren una segunda sede");
    expect(s).toContain("2-5k SEK/mes");
  });

  it("2. los campos opcionales ausentes no se imprimen como `null`", () => {
    const s = seccion(
      reportToMarkdown(
        reporte(citada({ definition: NONCE, disqualifiers: null, buyingTrigger: null, budgetBand: null })),
      ),
    );

    expect(s).toContain(NONCE);
    expect(s).not.toContain("null");
    expect(s).not.toContain("Disqualifiers");
    expect(s).not.toContain("Buying trigger");
    expect(s).not.toContain("Budget band");
  });

  it("3. una versión publicada SIN ICP lo dice, y no inventa uno", () => {
    const s = seccion(reportToMarkdown(reporte(citada(null))));

    // La cita sigue: la versión existe y se citó.
    expect(s).toContain(`\`${V}\``);
    expect(s).toContain("has no ideal customer profile");
    expect(s).not.toContain("Ideal customer profile (ICP):**");
    expect(s).not.toContain("generated before reports showed");
  });

  it("4. un reporte guardado entre H1.2 y H1.3 (cita sin `icp`) se exporta y dice que es viejo", () => {
    // Es lo que vuelve del historial de `localStorage`: la cita de H1.2 no
    // tenía `icp`. El tipo dice que el campo existe; el JSON guardado, no.
    const vieja = { status: "cited", versionId: V, version: 2, publishedAt: "2026-09-15T10:00:00.000Z" };
    const r = reporte(vieja as ProfileCitation);

    const s = seccion(reportToMarkdown(r));

    expect(s).toContain(`\`${V}\``);
    expect(s).toContain("generated before reports showed the ideal customer profile");
    expect(s).not.toContain("has no ideal customer profile");
  });
});
