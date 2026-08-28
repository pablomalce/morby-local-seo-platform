/**
 * QUÉ RESUELVE ESTE ARCHIVO
 *
 * Que el nombre de una fuente de datos exista en UN solo lugar.
 *
 * Hasta acá había tres copias del mismo mapa de nombres —las filas de
 * `ReportView`, la tabla del export a Markdown en `reports/page.tsx`, y nada en
 * el motor— y la que faltaba fue la que se filtró: `buildReport` armaba el aviso
 * de fallo con las CLAVES del objeto, así que un cliente leía
 *
 *   "No se pudieron obtener datos en vivo de: searchConsole, ga4"
 *
 * `places` y `pagespeed` se leen como palabras y por eso el defecto pasó
 * inadvertido; `searchConsole` y `ga4` no. El aviso más importante del reporte
 * estaba escrito en identificadores de programador, en los tres idiomas.
 *
 * Los nombres NO se traducen y es a propósito: son nombres de producto de
 * Google, idénticos en inglés, español y sueco. Traducirlos daría tres formas de
 * nombrar la misma pantalla que el cliente tiene que abrir para arreglarlo.
 */

import type { DataSourceHealth, DataSourceStatus } from "./types";

/** Las fuentes del reporte. `note` es prosa sobre ellas, no una de ellas. */
export type DataSourceKey = Exclude<keyof DataSourceHealth, "note">;

/**
 * El orden es el de la ficha del reporte, y la lista es el denominador: un
 * `DataSourceKey` nuevo sin entrada acá no compila, y sin fila en los tests
 * rompe su conteo. Agregar una fuente tiene que obligar a mirar las dos cosas.
 */
export const DATA_SOURCE_KEYS = [
  "places",
  "pagespeed",
  "searchConsole",
  "gbp",
  "ga4",
] as const satisfies readonly DataSourceKey[];

export const DATA_SOURCE_LABELS: Record<DataSourceKey, string> = {
  places: "Google Places",
  pagespeed: "Google PageSpeed",
  searchConsole: "Search Console",
  gbp: "Google Business Profile",
  ga4: "Google Analytics 4",
};

/** El nombre que ve el cliente. Nunca la clave. */
export function labelForSource(key: DataSourceKey): string {
  return DATA_SOURCE_LABELS[key];
}

/**
 * Cómo se pinta cada estado en la ficha del reporte.
 *
 * Estaba dentro de `DataSourceRow`, en `ReportView.tsx`, y su fallback era
 * `missing`: un estado que el mapa no conociera se le mostraba al cliente como
 * "NOT CONNECTED", o sea como un paso de setup pendiente. Es el mismo defecto
 * que el resto de este archivo existe para impedir, sólo que una capa más
 * arriba y sin ningún test que lo alcanzara, porque vivía dentro de un
 * componente.
 */
export const DATA_SOURCE_STATUS_DISPLAY: Record<
  DataSourceStatus,
  { color: string; text: string }
> = {
  live: { color: "text-emerald-400", text: "● LIVE" },
  demo: { color: "text-vulkan-orange", text: "○ DEMO" },
  missing: { color: "text-metal-500", text: "○ NOT CONNECTED" },
  error: { color: "text-red-400", text: "● ERROR" },
};

/**
 * Ante un estado desconocido cae en `error`, NO en `missing`.
 *
 * La diferencia no es de estilo: "no conectado" le dice al cliente que le falta
 * hacer algo y que las cifras están bien; "error" le dice que desconfíe de
 * ellas. Un estado que este mapa no sabe leer es, por definición, algo que salió
 * mal, y la lectura segura es la que hace desconfiar.
 */
export function displayForStatus(status: string): { color: string; text: string } {
  return (
    DATA_SOURCE_STATUS_DISPLAY[status as DataSourceStatus] ?? DATA_SOURCE_STATUS_DISPLAY.error
  );
}
