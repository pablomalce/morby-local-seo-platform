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
import { type FetchOutcome, statusForOutcome } from "./status";

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

/**
 * QUÉ IMPIDE ESTA FUNCIÓN
 *
 * Que «falló» sea todo lo que queda escrito cuando una fuente falla.
 *
 * `statusForOutcome()` colapsa seis maneras de fallar en la palabra `error`, y
 * eso es correcto PARA LA PANTALLA: quien lee un reporte no puede hacer nada
 * distinto con un 403 que con un timeout. Para quien opera la plataforma es lo
 * contrario — un 403 se arregla dando permiso sobre la property, un 401 es el
 * token, un 400 suele ser el identificador mal mapeado, y un timeout se
 * reintenta.
 *
 * Medido el 2026-09-01: GA4 salió `error` en el primer reporte real y no había
 * NINGUNA manera de saber cuál de los cuatro era — ni en la pantalla, ni en los
 * logs del servidor, ni en la base. La única salida era adivinar y probar.
 *
 * El texto no lleva el token ni ningún dato del cliente: lleva la superficie, el
 * tipo de fallo, el código si lo hubo, y el `property_ref` —que es un
 * identificador público y es justamente el que suele estar mal—.
 */
export function describirFallo(outcome: FetchOutcome, propertyRef: string): string | null {
  switch (outcome.kind) {
    case "ok":
      return null;
    case "http":
      // El número entero, no una familia. `403` y `401` piden acciones distintas
      // y agruparlos como «4xx» sería volver a perder el motivo.
      return `http ${outcome.status} sobre ${propertyRef}`;
    case "timeout":
      return `se agotó el tiempo sobre ${propertyRef}`;
    case "network":
      return `no hubo respuesta sobre ${propertyRef}`;
    case "malformed":
      return `respondió 2xx con un cuerpo que no trae lo que el reporte usa, sobre ${propertyRef}`;
    case "no-credentials":
      // No debería llegar acá —sin credenciales no se hace la petición— y por eso
      // se dice así: si aparece en un log, lo que está mal es el llamador.
      return `se intentó consultar ${propertyRef} sin credenciales`;
  }
}

export interface HydrateDeps {
  mappings: readonly PropertyMapping[];
  /** El access token de la agencia, ya resuelto. Se pide UNA vez. */
  token: AccessTokenResult;
  fetchSearchConsole: (accessToken: string, propertyRef: string) => Promise<SearchConsoleResult>;
  fetchGa4: (accessToken: string, propertyRef: string) => Promise<Ga4Result>;
  env?: NodeJS.ProcessEnv;
  /**
   * Dónde se anota el motivo de un fallo. Inyectable para poder MEDIR que se
   * anota: espiar `console` desde un test mide el espía, no el código.
   */
  log?: (mensaje: string) => void;
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

  // Por defecto va a los logs del servidor, que en Vercel es donde alguien puede
  // leerlo después del hecho. No se escribe en la respuesta: lo que un tercero
  // podría provocar en un reporte es un fallo, y decirle cuál es entregarle el
  // mapa. Mismo argumento que la ruta del callback.
  const registrar =
    deps.log ??
    ((mensaje: string) => {
      // eslint-disable-next-line no-console
      console.warn(mensaje);
    });

  if (scResultado) {
    salida.searchConsole = statusForOutcome(scResultado.outcome);
    salida.searchConsoleTotals = scResultado.totals;
    const motivo = sc.ready ? describirFallo(scResultado.outcome, sc.propertyRef) : null;
    if (motivo) registrar(`[google] search_console: ${motivo}`);
  }
  if (gaResultado) {
    salida.ga4 = statusForOutcome(gaResultado.outcome);
    salida.ga4Totals = gaResultado.totals;
    const motivo = ga.ready ? describirFallo(gaResultado.outcome, ga.propertyRef) : null;
    if (motivo) registrar(`[google] ga4: ${motivo}`);
  }

  return salida;
}
