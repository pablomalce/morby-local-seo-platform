/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que una consulta a Search Console que falló se cuente como un cliente sin
 * conectar, y que un cuerpo incompleto se lea como un cliente con cero clics.
 *
 * El contrato ya estaba escrito antes que este cliente, en `status.ts`, y eso no
 * es un orden casual: `statusForOutcome()` fija que un 401 es `error` y no
 * `missing`, y este archivo se adapta a él. Al revés —el cliente decidiendo qué
 * mostrar— es como entró el defecto que arregló el #46.
 *
 * LA DIFERENCIA QUE MÁS DUELE ACÁ ES CERO CONTRA NADA
 *
 * Una property sin tráfico contesta 200 sin `rows`. Un cuerpo roto también puede
 * no traer `rows`. Los dos se ven igual leyendo `body.rows?.[0]?.clicks ?? 0`, y
 * el reporte diría «0 clics» en los dos casos — una vez con razón y otra por un
 * fallo que nadie va a mirar, porque un cero no llama la atención de nadie.
 *
 * Por eso se distingue: `rows` ausente o vacío es cero de verdad; `rows` con una
 * fila que no trae los cuatro campos que el reporte usa es `malformed`.
 *
 * LA VENTANA TERMINA HACE TRES DÍAS, Y NO HOY
 *
 * Search Console publica con demora. Pedir hasta hoy devuelve los últimos días
 * vacíos y hace que todo reporte parezca una caída de tráfico.
 */

import type { FetchOutcome } from "./status";

/** El endpoint, escrito entero para que un test pueda afirmar sobre él. */
export const SEARCH_CONSOLE_ENDPOINT = "https://searchconsole.googleapis.com/webmasters/v3/sites";

/** Cuántos días mira el reporte, y cuántos descuenta por la demora de Google. */
export const VENTANA_DIAS = 28;
export const DEMORA_DIAS = 3;

/** Lo que el reporte usa de Search Console. */
export interface SearchConsoleTotals {
  clicks: number;
  impressions: number;
  /** 0 a 1, tal como lo devuelve Google. */
  ctr: number;
  /** Posición media. Más chico es mejor. */
  position: number;
  fetchedAt: string;
}

/** El resultado de un intento: el estado SIEMPRE, los números cuando los hay. */
export interface SearchConsoleResult {
  outcome: FetchOutcome;
  totals: SearchConsoleTotals | null;
}

/** El `fetch` inyectable, igual que en `oauth.ts`. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** `YYYY-MM-DD` en UTC, que es lo que la API pide. */
function fecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** La ventana que se le pide a Google, terminada hace `DEMORA_DIAS`. */
export function ventana(ahora: Date): { startDate: string; endDate: string } {
  const fin = new Date(ahora.getTime() - DEMORA_DIAS * 86_400_000);
  const inicio = new Date(fin.getTime() - (VENTANA_DIAS - 1) * 86_400_000);
  return { startDate: fecha(inicio), endDate: fecha(fin) };
}

/**
 * El cuerpo de `searchAnalytics.query`, traducido.
 *
 * Sin `rows` es una property sin tráfico en la ventana, y eso es un dato: ceros.
 * Con una fila que no trae los cuatro campos, es un cuerpo que no sirve, y decir
 * ceros ahí sería inventar una respuesta.
 */
export function readSearchAnalytics(body: unknown, fetchedAt: string): SearchConsoleResult {
  if (typeof body !== "object" || body === null) {
    return { outcome: { kind: "malformed" }, totals: null };
  }

  const rows = (body as { rows?: unknown }).rows;
  const sinTrafico: SearchConsoleResult = {
    outcome: { kind: "ok" },
    totals: { clicks: 0, impressions: 0, ctr: 0, position: 0, fetchedAt },
  };

  if (rows === undefined) return sinTrafico;
  if (!Array.isArray(rows)) return { outcome: { kind: "malformed" }, totals: null };
  if (rows.length === 0) return sinTrafico;

  const fila = rows[0] as Record<string, unknown>;
  for (const campo of ["clicks", "impressions", "ctr", "position"] as const) {
    const valor = fila?.[campo];
    if (typeof valor !== "number" || !Number.isFinite(valor)) {
      return { outcome: { kind: "malformed" }, totals: null };
    }
  }

  return {
    outcome: { kind: "ok" },
    totals: {
      clicks: fila.clicks as number,
      impressions: fila.impressions as number,
      ctr: fila.ctr as number,
      position: fila.position as number,
      fetchedAt,
    },
  };
}

/**
 * Los totales de una property, o por qué no se pudieron pedir.
 *
 * `propertyRef` viene de `integration_properties` con la forma que la 0017
 * obliga —`https://sitio/` o `sc-domain:host`— y se codifica entero: las dos
 * llevan caracteres que dentro de una URL significan otra cosa.
 */
export async function fetchSearchConsoleTotals(deps: {
  accessToken: string;
  propertyRef: string;
  ahora: Date;
  fetcher: Fetcher;
}): Promise<SearchConsoleResult> {
  const { startDate, endDate } = ventana(deps.ahora);
  const url = `${SEARCH_CONSOLE_ENDPOINT}/${encodeURIComponent(deps.propertyRef)}/searchAnalytics/query`;

  let respuesta: Response;
  try {
    respuesta = await deps.fetcher(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.accessToken}`,
        "content-type": "application/json",
      },
      // Sin `dimensions`: lo que el reporte muestra son los totales de la
      // ventana. Pedir dimensiones traería filas por consulta o por página, que
      // es otra pantalla y otro costo de cuota.
      body: JSON.stringify({ startDate, endDate, rowLimit: 1 }),
    });
  } catch {
    return { outcome: { kind: "network" }, totals: null };
  }

  if (!respuesta.ok) {
    // El número viaja adentro del outcome y no se traduce acá: `status.ts` es
    // quien decide qué significa cada uno, y este archivo no lo vuelve a decidir.
    return { outcome: { kind: "http", status: respuesta.status }, totals: null };
  }

  let json: unknown;
  try {
    json = await respuesta.json();
  } catch {
    return { outcome: { kind: "malformed" }, totals: null };
  }

  return readSearchAnalytics(json, deps.ahora.toISOString());
}
