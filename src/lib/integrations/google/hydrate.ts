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
 *   `servicioCompartido.ts`  si el token de la agencia se le presta a ESTA
 *                   organización: sin ningún mapeo vivo, o con el mapeo
 *                   ilegible, no se le pide;
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

import type { DataSourceStatus, FuenteDeGoogle, MotivoDeFuente } from "@/lib/reports/types";
import type { TokenUnavailable } from "./tokenStore";
import type { Negativa, TokenDelServicio } from "./servicioCompartido";
import type { Ga4Result, Ga4Totals } from "./ga4";
import type { SearchConsoleResult, SearchConsoleTotals } from "./searchConsole";
import {
  type GoogleSourceResolution,
  type GoogleSurface,
  type PropertyMapping,
  resolveGoogleSource,
} from "./sources";
import { type FetchOutcome, statusForOutcome } from "./status";
import { type Sonda, sondaDeOutcome } from "./probe";

/** Lo que el reporte necesita de las tres superficies de Google. */
export interface GoogleHydration {
  searchConsole: DataSourceStatus;
  ga4: DataSourceStatus;
  gbp: DataSourceStatus;
  /**
   * Por qué cada superficie NO se consultó. Sólo las que no se consultaron: lo
   * que Google contestó no es un motivo de esta lista. Ver `MotivoDeFuente`.
   */
  motivos: Partial<Record<FuenteDeGoogle, MotivoDeFuente>>;
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
 *
 * La negativa del servicio compartido (`not-mapped`, `mapping-unreadable`) no
 * pasa por acá: no es un estado del token, y se decide antes, para todas las
 * superficies a la vez. Ver `hydrateGoogle`.
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

/** Una superficie que no se consulta, con el motivo que el reporte muestra. */
type NoConsultada = { ready: false; status: DataSourceStatus; reason: MotivoDeFuente };

/** Lo que el servicio compartido niega, como estado de la fuente. */
function statusForNegativa(negativa: Negativa): DataSourceStatus {
  switch (negativa) {
    // Sin ningún mapeo no hay nada que mandar, ni a quién.
    case "not-mapped":
      return "missing";
    // No se sabe si hay mapeo: es un fallo nuestro, no una integración sin
    // configurar. Decir «sin conectar» mandaría a mapear lo que puede estar
    // mapeado.
    case "mapping-unreadable":
      return "error";
  }
}

const esNegativa = (reason: TokenUnavailable | Negativa): reason is Negativa =>
  reason === "not-mapped" || reason === "mapping-unreadable";

export interface HydrateDeps {
  mappings: readonly PropertyMapping[];
  /**
   * El access token de la agencia, ya resuelto —o por qué el servicio
   * compartido no lo prestó—. Se pide UNA vez, y lo da `servirConLaAgencia()`
   * junto con `mappings`: los dos salen de la misma llamada para que no se pueda
   * prestar el token a mapeos de otra organización.
   */
  token: TokenDelServicio;
  fetchSearchConsole: (accessToken: string, propertyRef: string) => Promise<SearchConsoleResult>;
  fetchGa4: (accessToken: string, propertyRef: string) => Promise<Ga4Result>;
  env?: NodeJS.ProcessEnv;
  /**
   * Dónde se anota el motivo de un fallo. Inyectable para poder MEDIR que se
   * anota: espiar `console` desde un test mide el espía, no el código.
   */
  log?: (mensaje: string) => void;
  /**
   * La organización cuyo reporte se está armando. Sin ella no se guarda sonda:
   * `integration_probe` tiene `organization_id NOT NULL` porque una fila sin
   * tenant no la puede ver nadie, y un reporte de demostración no tiene ninguna.
   */
  organizationId?: string | null;
  /**
   * Dónde queda el resultado, además del log. Inyectable por lo mismo que `log`,
   * y porque el que va de verdad escribe en la base.
   */
  recordProbe?: (sonda: Sonda) => Promise<unknown>;
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
  const negativa = !deps.token.ok && esNegativa(deps.token.reason) ? deps.token.reason : null;

  // El orden es el de siempre, la causa de más arriba gana, con un escalón
  // nuevo en el medio:
  //
  //   1. sin credenciales de plataforma no hay petición para NADIE;
  //   2. la negativa del servicio compartido es de la ORGANIZACIÓN entera —sin
  //      ningún mapeo, o sin poder leerlo— y dice eso, no «a esta superficie le
  //      falta su property»;
  //   3. el mapeo de cada superficie;
  //   4. el token.
  const resolucion = (superficie: GoogleSurface): GoogleSourceResolution | NoConsultada => {
    const r = resolveGoogleSource(superficie, deps.mappings, env);
    if (!r.ready && r.reason === "platform-not-connected") return r;
    if (negativa) return { ready: false, status: statusForNegativa(negativa), reason: negativa };
    return r;
  };

  const sc = resolucion("search_console");
  const ga = resolucion("ga4");
  const gbp = resolucion("google_business_profile");

  const motivos: GoogleHydration["motivos"] = {};
  if (!sc.ready) motivos.searchConsole = sc.reason;
  if (!ga.ready) motivos.ga4 = ga.reason;
  if (!gbp.ready) motivos.gbp = gbp.reason;

  const salida: GoogleHydration = {
    // `ready` sin consulta sigue siendo `error`, igual que antes de este archivo:
    // significa que no se sabe, y las líneas de abajo lo reemplazan por lo que
    // Google haya contestado.
    searchConsole: sc.ready ? "error" : sc.status,
    ga4: ga.ready ? "error" : ga.status,
    gbp: gbp.ready ? "error" : gbp.status,
    motivos,
    searchConsoleTotals: null,
    ga4Totals: null,
  };

  // Sin token no se llama a nadie, y las fuentes que ya tenían un motivo propio
  // —sin credenciales, sin mapear, la negativa— conservan el suyo: ésa es la
  // causa que se arregla primero. Con una negativa ninguna fuente está lista.
  if (!deps.token.ok) {
    const reason = deps.token.reason;
    if (!esNegativa(reason)) {
      const porToken = statusForTokenFailure(reason);
      if (sc.ready) {
        salida.searchConsole = porToken;
        motivos.searchConsole = "agency-token";
      }
      if (ga.ready) {
        salida.ga4 = porToken;
        motivos.ga4 = "agency-token";
      }
      if (gbp.ready) {
        salida.gbp = porToken;
        motivos.gbp = "agency-token";
      }
    }
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

  // La sonda se guarda SIEMPRE, también cuando salió bien: «anduvo hace un
  // minuto» es la mitad del diagnóstico cuando algo empieza a fallar, y una tabla
  // que sólo tiene fallos no puede distinguir «nunca se consultó» de «anduvo».
  // Es lo contrario del log, que sólo habla cuando hay algo raro que decir.
  const sondas: Sonda[] = [];
  const anotar = (superficie: GoogleSurface, outcome: FetchOutcome, propertyRef: string) => {
    if (!deps.organizationId || !deps.recordProbe) return;
    sondas.push(sondaDeOutcome(deps.organizationId, superficie, outcome, propertyRef));
  };

  if (scResultado) {
    salida.searchConsole = statusForOutcome(scResultado.outcome);
    salida.searchConsoleTotals = scResultado.totals;
    if (sc.ready) {
      const motivo = describirFallo(scResultado.outcome, sc.propertyRef);
      if (motivo) registrar(`[google] search_console: ${motivo}`);
      anotar("search_console", scResultado.outcome, sc.propertyRef);
    }
  }
  if (gaResultado) {
    salida.ga4 = statusForOutcome(gaResultado.outcome);
    salida.ga4Totals = gaResultado.totals;
    if (ga.ready) {
      const motivo = describirFallo(gaResultado.outcome, ga.propertyRef);
      if (motivo) registrar(`[google] ga4: ${motivo}`);
      anotar("ga4", gaResultado.outcome, ga.propertyRef);
    }
  }

  // Se espera a que terminen, y sus fallos NO cambian lo que se devuelve: ver el
  // encabezado de `probe.ts`. `allSettled` y no `all` porque un rechazo acá no
  // puede tumbar el reporte que produjo el dato.
  if (deps.recordProbe && sondas.length > 0) {
    await Promise.allSettled(sondas.map((s) => deps.recordProbe!(s)));
  }

  return salida;
}
