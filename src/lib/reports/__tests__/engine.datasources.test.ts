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
import {
  DATA_SOURCE_KEYS,
  DATA_SOURCE_LABELS,
  type DataSourceKey,
} from "@/lib/reports/dataSources";
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
    //
    // Esta aserción decía `toContain("pagespeed")` —la clave del objeto— y pasaba
    // porque la nota se armaba con las claves. Clavaba el defecto en vez del
    // requisito: "pagespeed" se lee como una palabra, así que la aserción parecía
    // razonable y la misma implementación le escribía "searchConsole" al cliente.
    expect(roto.dataSourceHealth.note).toContain(DATA_SOURCE_LABELS.pagespeed);
  });

  it("nombra TODAS las fuentes caídas, no sólo la primera", () => {
    const roto = buildReport(snapshot(), AT, {
      dataSources: { places: "error", pagespeed: "error" },
      localeOverride: "es",
    });
    expect(roto.dataSourceHealth.note).toContain(DATA_SOURCE_LABELS.places);
    expect(roto.dataSourceHealth.note).toContain(DATA_SOURCE_LABELS.pagespeed);
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

describe("DataSourceHealth — las fuentes que trae F2 avisan igual que las viejas", () => {
  // Los bloques de arriba prueban `pagespeed` y `places`, que son las dos que ya
  // consultan una API. Search Console y GA4 estaban declaradas en el tipo desde
  // el principio y clavadas en "missing", así que NADA probaba que supieran
  // avisar un fallo. La puerta de F2 pide exactamente eso, y lo pide antes de
  // que exista el cliente HTTP.

  it("todas las fuentes están cubiertas, y son cinco", () => {
    // Denominador a mano: una fuente nueva rompe este conteo y obliga a mirar si
    // los tests de abajo la alcanzan. Es la misma puerta que los bloques 1 y 5
    // de la suite de aislamiento tienen con el total de tablas.
    expect(DATA_SOURCE_KEYS).toHaveLength(5);
    expect([...DATA_SOURCE_KEYS]).toEqual([
      "places",
      "pagespeed",
      "searchConsole",
      "gbp",
      "ga4",
    ]);
  });

  it.each(DATA_SOURCE_KEYS)("un error de %s cambia la nota", (source: DataSourceKey) => {
    const sano = buildReport(snapshot(), AT, {
      dataSources: { [source]: "live" },
      localeOverride: "es",
    });
    const roto = buildReport(snapshot(), AT, {
      dataSources: { [source]: "error" },
      localeOverride: "es",
    });

    expect(roto.dataSourceHealth[source]).toBe("error");
    expect(roto.dataSourceHealth.note).not.toBe(sano.dataSourceHealth.note);
  });

  it.each(DATA_SOURCE_KEYS)(
    "un error de %s se distingue de la misma fuente sin conectar",
    (source: DataSourceKey) => {
      // El par que importa, y el que ninguna prueba anterior hacía sobre estas
      // fuentes: "falló" y "falta conectarla" no pueden producir el mismo texto.
      const roto = buildReport(snapshot(), AT, {
        dataSources: { [source]: "error" },
        localeOverride: "es",
      });
      const sinConectar = buildReport(snapshot(), AT, {
        dataSources: { [source]: "missing" },
        localeOverride: "es",
      });

      expect(roto.dataSourceHealth.note).not.toBe(sinConectar.dataSourceHealth.note);
    },
  );

  it.each(DATA_SOURCE_KEYS)(
    "la nota nombra a %s con su nombre de producto, no con la clave del objeto",
    (source: DataSourceKey) => {
      const roto = buildReport(snapshot(), AT, {
        dataSources: { [source]: "error" },
        localeOverride: "es",
      });
      expect(roto.dataSourceHealth.note).toContain(DATA_SOURCE_LABELS[source]);
    },
  );

  it("ninguna clave de programador se filtra a la nota, en ningún idioma", () => {
    // El defecto real que encontró este frente: la nota se armaba con las claves
    // del objeto. `places` y `pagespeed` se leen como palabras y por eso pasó
    // inadvertido durante todo el desarrollo; `searchConsole` y `ga4` no, y son
    // las dos que F2 enciende. Un cliente sueco leía "searchConsole".
    const fugas: DataSourceKey[] = ["searchConsole", "gbp", "ga4"];
    for (const locale of ["en", "es", "sv"] as const) {
      const roto = buildReport(snapshot(), AT, {
        dataSources: { searchConsole: "error", gbp: "error", ga4: "error" },
        localeOverride: locale,
      });
      for (const clave of fugas) {
        expect(roto.dataSourceHealth.note, `${clave} filtrada en ${locale}`).not.toContain(clave);
      }
    }
  });

  it("nombra las dos fuentes de F2 cuando las dos caen, no sólo una", () => {
    // La puerta de F2 habla de las DOS fuentes. Si el reporte nombra una sola,
    // el cliente reintenta la mitad de lo que falló.
    const roto = buildReport(snapshot(), AT, {
      dataSources: { searchConsole: "error", ga4: "error" },
      localeOverride: "es",
    });
    expect(roto.dataSourceHealth.note).toContain(DATA_SOURCE_LABELS.searchConsole);
    expect(roto.dataSourceHealth.note).toContain(DATA_SOURCE_LABELS.ga4);
  });

  it("avisa el fallo de Search Console en los tres idiomas", () => {
    const notas = (["en", "es", "sv"] as const).map((locale) => {
      const sano = buildReport(snapshot(), AT, {
        dataSources: { searchConsole: "live" },
        localeOverride: locale,
      }).dataSourceHealth.note;
      const roto = buildReport(snapshot(), AT, {
        dataSources: { searchConsole: "error" },
        localeOverride: locale,
      }).dataSourceHealth.note;
      return { locale, sano, roto };
    });

    for (const { locale, sano, roto } of notas) {
      expect(roto, `la nota de fallo en ${locale} es igual a la normal`).not.toBe(sano);
    }
    expect(new Set(notas.map((n) => n.roto)).size).toBe(3);
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
