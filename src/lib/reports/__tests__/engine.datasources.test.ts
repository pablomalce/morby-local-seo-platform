/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un fallo de API se le presente al usuario como una integración que falta
 * conectar.
 *
 * `DataSourceHealth.note` es el ÚNICO texto en prosa que el usuario lee sobre la
 * procedencia de los datos del reporte. Los campos `places`, `pagespeed`, etc.
 * quedan en el objeto, pero nadie los lee: lo que se muestra es la nota.
 *
 * Hasta este PR la nota era una constante (`note: lang.sourceNote`), así que una
 * fuente en "error" —la API se cayó, o devolvió basura— se anunciaba con la
 * misma frase que una integración nunca configurada: "conectá la integración
 * correspondiente para usar datos reales".
 *
 * O sea: un sistema roto se leía como un sistema al que le falta un paso de
 * setup. El usuario ve números sintéticos, un cartel tranquilizador, y ninguna
 * razón para reintentar ni para desconfiar de las cifras.
 *
 * Los cuatro estados NO son intercambiables y el texto tiene que distinguirlos:
 *
 *   live     el dato es real
 *   demo     el dato es sintético, y está bien que lo sea
 *   missing  falta configurar la integración  -> acción: conectarla
 *   error    la petición FALLÓ                 -> acción: reintentar / investigar
 *
 * Confundir los dos últimos es el bug. Estos tests lo impiden.
 */
import { describe, expect, it } from "vitest";

import { buildBusinessSnapshot, businesses, locations, services } from "@/lib/mock/universal";
import { buildReport } from "@/lib/reports/engine";

const AT = "2026-08-18T12:00:00.000Z";

/** Snapshot de un negocio semilla. Determinista: no toca red ni base. */
function snapshot() {
  const business = businesses[0];
  return buildBusinessSnapshot(
    business,
    locations.filter((l) => l.businessId === business.id),
    services.filter((s) => s.businessId === business.id),
  );
}

describe("DataSourceHealth — un fallo no se lee como 'falta conectar'", () => {
  it("cambia la nota cuando una fuente devolvió error", () => {
    const sano = buildReport(snapshot(), AT, {
      dataSources: { pagespeed: "live" },
      localeOverride: "es",
    });
    const roto = buildReport(snapshot(), AT, {
      dataSources: { pagespeed: "error" },
      localeOverride: "es",
    });

    expect(roto.dataSourceHealth.pagespeed).toBe("error");
    // Lo que importa: el TEXTO tiene que ser distinto. Si las dos notas son
    // iguales, el usuario no tiene forma de enterarse de que algo falló.
    expect(roto.dataSourceHealth.note).not.toBe(sano.dataSourceHealth.note);
  });

  it("nombra cuál fuente falló, no dice sólo 'hubo un error'", () => {
    const roto = buildReport(snapshot(), AT, {
      dataSources: { pagespeed: "error" },
      localeOverride: "es",
    });
    // Sin el nombre de la fuente, el mensaje no es accionable: no se sabe qué
    // reintentar ni qué cifras mirar con desconfianza.
    expect(roto.dataSourceHealth.note).toContain("pagespeed");
  });

  it("nombra TODAS las fuentes caídas, no sólo la primera", () => {
    const roto = buildReport(snapshot(), AT, {
      dataSources: { places: "error", pagespeed: "error" },
      localeOverride: "es",
    });
    expect(roto.dataSourceHealth.note).toContain("places");
    expect(roto.dataSourceHealth.note).toContain("pagespeed");
  });

  it("NO habla de fallo cuando la integración sólo está sin configurar", () => {
    const sinConfigurar = buildReport(snapshot(), AT, {
      dataSources: { pagespeed: "missing" },
      localeOverride: "es",
    });
    const todoBien = buildReport(snapshot(), AT, {
      dataSources: { pagespeed: "live" },
      localeOverride: "es",
    });
    // El complemento del primer test, y hace falta: una nota que grite "falló"
    // ante cualquier cosa es tan inútil como una que nunca lo diga. "missing" es
    // un estado legítimo y no debe alarmar.
    expect(sinConfigurar.dataSourceHealth.note).toBe(todoBien.dataSourceHealth.note);
  });

  it("avisa del fallo en los tres idiomas, no sólo en inglés", () => {
    // Un aviso que aparece sólo en inglés no existe para el cliente sueco.
    const notas = (["en", "es", "sv"] as const).map((locale) => {
      const sano = buildReport(snapshot(), AT, {
        dataSources: { pagespeed: "live" },
        localeOverride: locale,
      }).dataSourceHealth.note;
      const roto = buildReport(snapshot(), AT, {
        dataSources: { pagespeed: "error" },
        localeOverride: locale,
      }).dataSourceHealth.note;
      return { locale, sano, roto };
    });

    for (const { locale, sano, roto } of notas) {
      expect(roto, `la nota de fallo en ${locale} es igual a la normal`).not.toBe(sano);
    }

    // Y son tres textos distintos entre sí: si dos coinciden, alguno cayó al
    // idioma de otro.
    const textos = new Set(notas.map((n) => n.roto));
    expect(textos.size).toBe(3);
  });
});

describe("buildReport — el motor es determinista", () => {
  it("da exactamente la misma salida para la misma entrada", () => {
    const a = buildReport(snapshot(), AT, { localeOverride: "es" });
    const b = buildReport(snapshot(), AT, { localeOverride: "es" });

    // `id` se neutraliza a propósito: se arma con Date.now() y NO es
    // determinista. Está anotado en el PR como hallazgo aparte; no se toca acá.
    expect({ ...a, id: "" }).toEqual({ ...b, id: "" });
  });

  it("ordena los problemas de P1 a P3 y nunca al revés", () => {
    const rep = buildReport(snapshot(), AT, { localeOverride: "es" });
    const orden = { P1: 0, P2: 1, P3: 2 } as const;
    const severidades = rep.issues.map((i) => orden[i.severity]);
    // Un reporte que lista un P3 antes que un P1 entierra lo urgente. Que estén
    // presentes no alcanza: el orden ES la priorización.
    expect(severidades).toEqual([...severidades].sort((x, y) => x - y));
  });
});

describe("buildReport — el idioma", () => {
  it("respeta localeOverride por encima del idioma del negocio", () => {
    const rep = buildReport(snapshot(), AT, { localeOverride: "sv" });
    expect(rep.locale).toBe("sv");
  });

  it("cae a inglés ante un idioma desconocido en vez de romper", () => {
    const snap = snapshot();
    // El motor hace `STRINGS[locale] ?? STRINGS.en`. Si esa red desaparece, un
    // idioma no soportado no da error: da un reporte con textos `undefined`,
    // que es peor porque llega hasta el usuario.
    snap.business.primaryLocale = "de" as unknown as "en";
    const rep = buildReport(snap, AT, {});
    expect(rep.summary).toBeTruthy();
    expect(rep.dataSourceHealth.note).toBeTruthy();
    expect(rep.dataSourceHealth.note).not.toContain("undefined");
  });
});
