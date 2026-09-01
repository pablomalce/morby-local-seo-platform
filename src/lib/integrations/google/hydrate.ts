/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la costura que el #55 dejó abierta se cierre a mano en el orquestador.
 *
 * `statusForResolution()` devolvía `error` para una fuente LISTA, y era honesto:
 * las precondiciones se cumplían y nadie había traído el dato, así que decir
 * `live` habría sido afirmar sobre una consulta que no ocurrió. Este archivo es
 * lo que faltaba para que ese `error` pase a ser el resultado real de preguntar.
 *
 * LO QUE DECIDE CADA CAPA, Y POR QUÉ SON TRES Y NO UNA
 *
 *   `sources.ts`    si hay credenciales de plataforma y si ESTE cliente tiene
 *                   property. Decide sin preguntarle nada a Google;
 *   `tokenStore.ts` si hay un access token usable, y si no, cuál de las seis
 *                   maneras de no tenerlo es;
 *   `status.ts`     qué significa lo que Google contestó.
 *
 * Este archivo no decide nada de eso: los ordena. La regla que sí vive acá es
 * cuál gana cuando hay más de una respuesta posible, y es siempre la causa de más
 * arriba — mandar a mapear a alguien cuyo token está muerto es mandarlo a hacer
 * un trabajo que no va a servir.
 *
 * EL TOKEN SE PIDE UNA VEZ, Y NO UNA POR FUENTE
 *
 * Es de agencia: la respuesta sería la misma tres veces, y pedirlo por fuente
 * sugeriría —a quien lea esto— que es un dato por fuente. Además cada llamada
 * puede refrescar contra Google, así que tres serían tres refrescos compitiendo
 * por escribir la misma fila.
 *
 * Y SIN TOKEN NO SE LLAMA A NADIE, PERO EL MOTIVO SE MUESTRA
 *
 * `missing` queda reservado para lo que `status.ts` reserva: no haber
 * credenciales que mandar. Un token ausente o revocado también es `missing` —no
 * hay nada que mandar— y uno que no se pudo averiguar es `error`, porque el token
 * puede estar vivo y lo que falló es nuestra manera de mirarlo.
 */

import type { DataSourceStatus } from "@/lib/reports/types";
import type { AccessTokenResult, TokenUnavailable } from "./tokenStore";
import type { Ga4Result, Ga4Totals } from "./ga4";
import type { SearchConsoleResult, SearchConsoleTotals } from "./searchConsole";
import { type GoogleSurface, type PropertyMapping, resolveGoogleSource } from "./sources";
import { statusForOutcome } from "./status";

/** Lo que el reporte necesita de las tres superficies de Google. */
export interface GoogleHydration {
  searchConsole: DataSourceStatus;
  ga4: DataSourceStatus;
  gbp: DataSourceStatus;
  /** Los números, cuando la consulta salió bien. */
  searchConsoleTotals: SearchConsoleTotals | null;
  ga4Totals: Ga4Totals | null;
}

/**
 * Qué muestra una fuente cuando no hay token con el que preguntarle.
 *
 * Dos de los seis motivos no dicen nada del token —dicen que no se pudo
 * averiguar— así que son `error`. Los otros cuatro son «no hay nada que mandar»,
 * que es lo único que `status.ts` deja llamar `missing`.
 */
export function statusForTokenFailure(reason: TokenUnavailable): DataSourceStatus {
  switch (reason) {
    case "agency-unresolved":
    case "unreadable":
      return "error";
    case "platform-not-configured":
    case "absent":
    case "revoked":
    case "refresh-rejected":
      return "missing";
  }
}

export interface HydrateDeps {
  mappings: readonly PropertyMapping[];
  /** El access token de la agencia, ya resuelto. Se pide UNA vez. */
  token: AccessTokenResult;
  fetchSearchConsole: (accessToken: string, propertyRef: string) => Promise<SearchConsoleResult>;
  fetchGa4: (accessToken: string, propertyRef: string) => Promise<Ga4Result>;
  env?: NodeJS.ProcessEnv;
}

/**
 * Las tres superficies, consultadas donde corresponde.
 *
 * Google Business Profile NO se consulta: su API todavía no tiene cuota
 * aprobada, así que sigue saliendo del mapeo como hasta ahora. Que su `ready` se
 * muestre `live` sin llamada sería exactamente lo que este repositorio viene
 * sacando —una respuesta correcta por el motivo equivocado— así que se queda en
 * `missing` con el motivo del mapeo, y la llamada entra cuando entre la cuota.
 */
export async function hydrateGoogle(deps: HydrateDeps): Promise<GoogleHydration> {
  const env = deps.env ?? process.env;

  const resolucion = (superficie: GoogleSurface) =>
    resolveGoogleSource(superficie, deps.mappings, env);

  const sc = resolucion("search_console");
  const ga = resolucion("ga4");
  const gbp = resolucion("google_business_profile");

  const salida: GoogleHydration = {
    // `ready` sin consulta sigue siendo `error`, igual que antes de este archivo:
    // significa que no se sabe, y las líneas de abajo lo reemplazan por lo que
    // Google haya contestado.
    searchConsole: sc.ready ? "error" : sc.status,
    ga4: ga.ready ? "error" : ga.status,
    gbp: gbp.ready ? "error" : gbp.status,
    searchConsoleTotals: null,
    ga4Totals: null,
  };

  // Sin token no se llama a nadie, y las fuentes que ya tenían un motivo propio
  // —sin credenciales, sin mapear— conservan el suyo: ésa es la causa que se
  // arregla primero.
  if (!deps.token.ok) {
    const porToken = statusForTokenFailure(deps.token.reason);
    if (sc.ready) salida.searchConsole = porToken;
    if (ga.ready) salida.ga4 = porToken;
    if (gbp.ready) salida.gbp = porToken;
    return salida;
  }

  const accessToken = deps.token.accessToken;

  // Las dos en paralelo: son APIs distintas y ninguna necesita el resultado de la
  // otra. En serie, el reporte espera la suma de las dos latencias.
  const [scResultado, gaResultado] = await Promise.all([
    sc.ready ? deps.fetchSearchConsole(accessToken, sc.propertyRef) : null,
    ga.ready ? deps.fetchGa4(accessToken, ga.propertyRef) : null,
  ]);

  if (scResultado) {
    salida.searchConsole = statusForOutcome(scResultado.outcome);
    salida.searchConsoleTotals = scResultado.totals;
  }
  if (gaResultado) {
    salida.ga4 = statusForOutcome(gaResultado.outcome);
    salida.ga4Totals = gaResultado.totals;
  }

  return salida;
}
