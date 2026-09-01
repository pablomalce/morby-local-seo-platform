/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Lo mismo que `searchConsole.ts`, sobre la API que devuelve los números en
 * texto.
 *
 * GA4 contesta `metricValues: [{ value: "1234" }]` —cadenas, no números— y ésa es
 * la trampa propia de esta fuente: `Number("")` es 0, `Number(null)` es 0 y
 * `Number("abc")` es NaN, que impreso da «NaN» y sumado contamina cualquier
 * total. Un cuerpo raro se convierte en un cero perfectamente creíble sin que
 * nada falle.
 *
 * Por eso cada valor se parsea explícitamente, y uno que no es un número finito
 * es `malformed`, que el reporte muestra como `error`. Es la misma distinción
 * entre cero y nada que hace `searchConsole.ts`, con otra forma.
 *
 * POR QUÉ EL ORDEN DE LAS MÉTRICAS NO SE DA POR SUPUESTO
 *
 * La respuesta trae `metricHeaders` con los nombres y `metricValues` con los
 * valores en el MISMO orden en que se pidieron. Leer por índice funciona hasta el
 * día que alguien agregue una métrica en el medio del pedido, y entonces las
 * sesiones pasan a ser conversiones sin que ningún test lo note. Se lee por
 * NOMBRE, contra los encabezados que la respuesta trae.
 */

import type { FetchOutcome } from "./status";
import { VENTANA_DIAS, ventana } from "./searchConsole";

/** El endpoint, escrito entero para que un test pueda afirmar sobre él. */
export const GA4_ENDPOINT = "https://analyticsdata.googleapis.com/v1beta";

/** Las dos métricas que el reporte usa, en el orden en que se piden. */
export const GA4_METRICAS = ["sessions", "conversions"] as const;

/** Lo que el reporte usa de GA4. */
export interface Ga4Totals {
  sessions: number;
  conversions: number;
  fetchedAt: string;
}

export interface Ga4Result {
  outcome: FetchOutcome;
  totals: Ga4Totals | null;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Un valor de GA4 —siempre texto— convertido, o `null` si no es un número. */
function numero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  // La cadena vacía la ataja esta línea y no `Number()`, que la convierte en 0.
  if (typeof valor !== "string" || valor.trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * El cuerpo de `runReport`, traducido.
 *
 * Sin `rows` es una property sin sesiones en la ventana: ceros, que es un dato.
 * Con filas y sin encabezados que digan qué es cada valor, es `malformed`: los
 * números están, y no se sabe cuál es cuál.
 */
export function readRunReport(body: unknown, fetchedAt: string): Ga4Result {
  if (typeof body !== "object" || body === null) {
    return { outcome: { kind: "malformed" }, totals: null };
  }

  const b = body as { rows?: unknown; metricHeaders?: unknown };
  const sinSesiones: Ga4Result = {
    outcome: { kind: "ok" },
    totals: { sessions: 0, conversions: 0, fetchedAt },
  };

  if (b.rows === undefined) return sinSesiones;
  if (!Array.isArray(b.rows)) return { outcome: { kind: "malformed" }, totals: null };
  if (b.rows.length === 0) return sinSesiones;

  if (!Array.isArray(b.metricHeaders)) {
    return { outcome: { kind: "malformed" }, totals: null };
  }

  const nombres = b.metricHeaders.map((h) =>
    typeof h === "object" && h !== null ? (h as { name?: unknown }).name : undefined
  );
  const valores = (b.rows[0] as { metricValues?: unknown }).metricValues;
  if (!Array.isArray(valores)) return { outcome: { kind: "malformed" }, totals: null };

  const leer = (metrica: string): number | null => {
    const i = nombres.indexOf(metrica);
    if (i < 0 || i >= valores.length) return null;
    const celda = valores[i];
    return numero(
      typeof celda === "object" && celda !== null ? (celda as { value?: unknown }).value : celda
    );
  };

  const sessions = leer("sessions");
  const conversions = leer("conversions");
  if (sessions === null || conversions === null) {
    return { outcome: { kind: "malformed" }, totals: null };
  }

  return { outcome: { kind: "ok" }, totals: { sessions, conversions, fetchedAt } };
}

/**
 * Los totales de una property de GA4, o por qué no se pudieron pedir.
 *
 * La ventana es la MISMA que la de Search Console, importada y no copiada: dos
 * ventanas distintas en el mismo reporte hacen que las dos mitades no se puedan
 * comparar, y nadie lo nota hasta que alguien divide una por la otra.
 */
export async function fetchGa4Totals(deps: {
  accessToken: string;
  propertyRef: string;
  ahora: Date;
  fetcher: Fetcher;
}): Promise<Ga4Result> {
  const { startDate, endDate } = ventana(deps.ahora);
  const url = `${GA4_ENDPOINT}/${encodeURIComponent(deps.propertyRef)}:runReport`;

  let respuesta: Response;
  try {
    respuesta = await deps.fetcher(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        metrics: GA4_METRICAS.map((name) => ({ name })),
      }),
    });
  } catch {
    return { outcome: { kind: "network" }, totals: null };
  }

  if (!respuesta.ok) {
    return { outcome: { kind: "http", status: respuesta.status }, totals: null };
  }

  let json: unknown;
  try {
    json = await respuesta.json();
  } catch {
    return { outcome: { kind: "malformed" }, totals: null };
  }

  return readRunReport(json, deps.ahora.toISOString());
}

/** Cuántos días cubre lo que este cliente pide. Lo muestra el reporte. */
export const GA4_VENTANA_DIAS = VENTANA_DIAS;
