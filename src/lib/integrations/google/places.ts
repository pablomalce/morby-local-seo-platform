/**
 * Google Places API (New) — server-only client.
 *
 * Single platform-wide key (`GOOGLE_PLACES_API_KEY`). Charges per-request to your Google Cloud
 * project regardless of tenant. We use this to hydrate a business with REAL rating, review
 * count, photos and place ID — no per-tenant OAuth required.
 *
 * If the key is missing we return null and the calling code falls back to demo / synthetic
 * data. Never throws — Places is a nice-to-have, not a hard dependency.
 */

import "server-only";

export interface PlacesLookupInput {
  /** Business name as it appears on Google (or close to it). */
  name: string;
  /** Anchor query — usually "{name} {city}". */
  query: string;
}

export interface PlacesLookup {
  status: "live" | "missing-key" | "no-match" | "error";
  /** Provider place ID — useful to deep-link, persist, or call other Places APIs. */
  placeId?: string;
  /** Verified business display name as returned by Google. */
  displayName?: string;
  /** Formatted address. */
  formattedAddress?: string;
  /** Aggregate rating 0-5. */
  rating?: number;
  /** Total review count across the listing. */
  userRatingCount?: number;
  /** Categories Google assigned to the business. */
  types?: string[];
  /** Latitude / longitude (helpful for map snapshots later). */
  location?: { lat: number; lng: number };
  /** Business website if Google has it. */
  website?: string;
  /** Whether the business is currently open. */
  openNow?: boolean;
  /** Error message (only when status === "error"). */
  errorMessage?: string;
}

/** El único endpoint de Places que usa esta aplicación: Text Search (New). */
const URL_SEARCH_TEXT = "https://places.googleapis.com/v1/places:searchText";

/**
 * El pedido a Text Search, armado en UN lugar para los dos usos: la ficha de un
 * negocio (`buscarEnPlaces`) y la grilla (`posicionEnPunto`). Lo que cambia
 * entre los dos —cuerpo, máscara, caché, corte— lo agrega cada uno; el método,
 * las cabeceras y la URL no se pueden separar.
 */
function pedidoSearchText(apiKey: string, cuerpo: Record<string, unknown>, fieldMask: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(cuerpo),
  };
}

const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "rating",
  "userRatingCount",
  "types",
  "location",
  "websiteUri",
  "currentOpeningHours.openNow",
].join(",");

/**
 * The one call to the Places endpoint, shared by the single lookup and the
 * list search below.
 *
 * WHY THERE IS ONE PATH AND NOT TWO
 *
 * Until 2026-09-16 this repository had two Places clients. This one, which
 * calls Google, was wired to the report orchestrator. The other one,
 * `src/lib/integrations/googlePlaces.ts`, was wired to the only Places ROUTE
 * of the application — and returned rows from the demo dataset, and kept
 * returning them with the key set. Gate H2-GO-0 of the spine says it plainly:
 * auditing with a client that returns mock data is worse than not auditing.
 * The route now comes through here, the other file is gone, and a test fails
 * if anything imports it again.
 */
async function buscarEnPlaces(
  textQuery: string,
  maxResultCount: number
): Promise<
  | { status: "missing-key" }
  | { status: "error"; errorMessage: string }
  | { status: "live"; places: GooglePlacesResult[] }
> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { status: "missing-key" };

  try {
    const response = await fetch(URL_SEARCH_TEXT, {
      ...pedidoSearchText(
        apiKey,
        { textQuery, maxResultCount },
        `places.${FIELD_MASK.split(",").join(",places.")}`
      ),
      // Aggressive cache — Place details rarely change in a day.
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return {
        status: "error",
        errorMessage: `Places search failed: HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as { places?: GooglePlacesResult[] };
    return { status: "live", places: payload.places ?? [] };
  } catch (err) {
    return {
      status: "error",
      errorMessage: err instanceof Error ? err.message : "Unknown Places error",
    };
  }
}

function aLookup(place: GooglePlacesResult): PlacesLookup {
  return {
    status: "live",
    placeId: place.id,
    displayName: place.displayName?.text,
    formattedAddress: place.formattedAddress,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    types: place.types,
    location:
      place.location?.latitude !== undefined && place.location?.longitude !== undefined
        ? { lat: place.location.latitude, lng: place.location.longitude }
        : undefined,
    website: place.websiteUri,
    openNow: place.currentOpeningHours?.openNow,
  };
}

export async function lookupPlace(input: PlacesLookupInput): Promise<PlacesLookup> {
  const resultado = await buscarEnPlaces(input.query, 1);
  if (resultado.status !== "live") return resultado;
  const place = resultado.places[0];
  if (!place) return { status: "no-match" };
  return aLookup(place);
}

export interface PlacesSearch {
  /** `missing-key` and `error` carry no places on purpose: no data is not demo data. */
  status: "live" | "missing-key" | "error";
  places: PlacesLookup[];
  errorMessage?: string;
}

/**
 * Text search returning several places. Same endpoint, same key, same
 * failure modes as `lookupPlace` — and, deliberately, no fallback: without a
 * key the answer is `missing-key` with an empty list, never rows that look
 * like businesses.
 */
export async function searchPlaces(query: string, maxResultCount = 5): Promise<PlacesSearch> {
  const resultado = await buscarEnPlaces(query, maxResultCount);
  if (resultado.status === "missing-key") return { status: "missing-key", places: [] };
  if (resultado.status === "error") {
    return { status: "error", places: [], errorMessage: resultado.errorMessage };
  }
  return { status: "live", places: resultado.places.map(aLookup) };
}

interface GooglePlacesResult {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  location?: { latitude: number; longitude: number };
  websiteUri?: string;
  currentOpeningHours?: { openNow?: boolean };
}

// ─────────────────────────────────────────────────────────────────────────────
// La grilla geográfica (H2-GO-3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * QUÉ IMPIDE ESTA SECCIÓN
 *
 * Que la posición de un negocio en un punto de la grilla salga de otra cosa que
 * de una llamada a Google HECHA DESDE ESE PUNTO, o que una llamada que falló se
 * lea como «no aparece».
 *
 * La puerta H2-GO-3 nombra los dos modos de fallo: posiciones de un único
 * llamado sin coordenada —o del cliente mock— dan el mismo mapa con el centro
 * desplazado; y un punto fallido contado como «no aparece» deja el denominador
 * de fallos en cero para siempre. Por eso esta función:
 *
 *   * manda `locationBias.circle` con la coordenada del PUNTO, no del centro;
 *   * no cachea (`cache: "no-store"`). La ficha de arriba cachea 24 h, y para la
 *     grilla sería el peor defecto posible: la corrida A' —la repetición— le
 *     pegaría a la caché de A, d(A,A') daría cero por construcción y la puerta
 *     se pondría verde midiendo la caché de Next en vez del ruido de Google;
 *   * devuelve UNO de tres resultados, y `failed` lleva siempre su código: un
 *     status HTTP que no es 2xx (`http_429`, `http_403`...), `timeout`,
 *     `network`, una respuesta que no se puede leer como lista de lugares
 *     (`invalid_response`) o la clave ausente (`missing_key`). Nunca `absent`.
 *
 * EL CONTRATO, DE LO QUE GOOGLE PUBLICA (R11), leído el 2026-10-08 de
 * developers.google.com/maps/documentation/places/web-service:
 *
 *   * `POST https://places.googleapis.com/v1/places:searchText`, cabeceras
 *     `X-Goog-Api-Key` y `X-Goog-FieldMask`;
 *   * `pageSize`, de 1 a 20 —«values above 20 will be set to 20»—, y NO
 *     `maxResultCount`, que la referencia marca «Deprecated: Use pageSize
 *     instead» (la ficha de arriba todavía lo usa; cambiarla es otro frente);
 *   * `locationBias.circle = { center: { latitude, longitude }, radius }`, el
 *     radio en metros dentro de [0.0, 50000.0];
 *   * la respuesta es `{ places: [...] }`. Lo que contesta SIN resultados la
 *     referencia no lo dice; el cliente de arriba ya lo trata como `places`
 *     ausente (`payload.places ?? []`), y acá también, pero SÓLO para `{}`, el
 *     objeto vacío: ésa es una respuesta viva sin el lugar —`absent`—. Un 200
 *     con cualquier otra cosa y sin `places` —un sobre `{"error": ...}` de
 *     RESOURCE_EXHAUSTED, `{"nextPageToken": ...}` solo, `{"Places": [...]}`
 *     con otra mayúscula— es `invalid_response`, o sea `failed`. Hasta el
 *     2026-10-09 los tres salían `absent`: el código no cumplía lo que este
 *     párrafo ya decía, y un fallo se publicaba como «no aparece», que es el
 *     modo de fallo que la puerta nombra. La corrida con gasto de la sesión
 *     directora es la que mide ese borde contra Google.
 *
 * LA MÁSCARA ES `places.id,places.displayName`, decidida por la sesión
 * directora. La posición sólo necesita `places.id`; según la misma
 * documentación, una máscara de SÓLO `places.id` cae en el SKU «Text Search
 * Essentials (IDs Only)» y `displayName` la pasa a «Text Search Pro». Queda
 * dicho para quien decida el gasto.
 */
export const GRILLA_FIELD_MASK = "places.id,places.displayName";

/** El tope de resultados por punto: la posición va de 1 a 20. */
export const GRILLA_TOPE_DE_RESULTADOS = 20;

/** Cuánto se espera a Google por punto. Nueve puntos de a tres entran en el `maxDuration` de 60 s. */
export const GRILLA_TIMEOUT_MS = 8_000;

/** El valor que la 0032 deja escribir en `error_code`. */
export type CodigoDeFallo = `http_${number}` | "timeout" | "network" | "invalid_response" | "missing_key";

export type ResultadoDePunto =
  | { outcome: "position"; position: number }
  | { outcome: "absent" }
  | { outcome: "failed"; errorCode: CodigoDeFallo };

export interface ConsultaDePunto {
  keyword: string;
  /** El `id` de Places del negocio que se busca, sin el prefijo `places/`. */
  targetPlaceId: string;
  lat: number;
  lng: number;
  /** El radio del círculo de `locationBias`, en metros. */
  radiusM: number;
}

/**
 * Los ids de la respuesta, en orden, o `null` si la respuesta no tiene esa forma.
 * Sin `places`, sólo `{}` —nada más que el objeto vacío— es «cero lugares».
 */
function idsDeLaRespuesta(payload: unknown): string[] | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (!Object.prototype.hasOwnProperty.call(payload, "places")) {
    return Object.keys(payload).length === 0 ? [] : null;
  }
  const lugares = (payload as { places?: unknown }).places;
  if (!Array.isArray(lugares)) return null;
  const ids: string[] = [];
  for (const lugar of lugares) {
    const id = (lugar as { id?: unknown } | null)?.id;
    // Un lugar sin id corre la cuenta de todos los de abajo: la posición que
    // saldría estaría inventada. Mejor no medir que medir mal.
    if (typeof id !== "string" || id === "") return null;
    ids.push(id);
  }
  return ids;
}

/**
 * La posición del negocio en UN punto de la grilla, con UNA llamada a Text
 * Search sesgada a ese punto. No tira nunca: lo que no es una respuesta viva es
 * `failed` con su código.
 *
 * `transporte` es `fetch` en producción; los tests le pasan un doble. El
 * default se evalúa en cada llamada, así que un `globalThis.fetch` cambiado
 * después de importar este módulo —el espía del barrido de rutas— también lo ve.
 */
export async function posicionEnPunto(
  consulta: ConsultaDePunto,
  transporte: typeof fetch = globalThis.fetch,
  timeoutMs: number = GRILLA_TIMEOUT_MS
): Promise<ResultadoDePunto> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { outcome: "failed", errorCode: "missing_key" };

  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), timeoutMs);
  try {
    const respuesta = await transporte(URL_SEARCH_TEXT, {
      ...pedidoSearchText(
        apiKey,
        {
          textQuery: consulta.keyword,
          pageSize: GRILLA_TOPE_DE_RESULTADOS,
          locationBias: {
            circle: {
              center: { latitude: consulta.lat, longitude: consulta.lng },
              radius: consulta.radiusM,
            },
          },
        },
        GRILLA_FIELD_MASK
      ),
      cache: "no-store",
      signal: corte.signal,
    });

    if (!respuesta.ok) return { outcome: "failed", errorCode: `http_${respuesta.status}` };

    let payload: unknown;
    try {
      payload = await respuesta.json();
    } catch {
      // El corte puede llegar mientras se lee el cuerpo: eso es un timeout, no
      // una respuesta ilegible.
      return { outcome: "failed", errorCode: corte.signal.aborted ? "timeout" : "invalid_response" };
    }

    const ids = idsDeLaRespuesta(payload);
    if (ids === null) return { outcome: "failed", errorCode: "invalid_response" };

    const indice = ids.slice(0, GRILLA_TOPE_DE_RESULTADOS).indexOf(consulta.targetPlaceId);
    return indice === -1 ? { outcome: "absent" } : { outcome: "position", position: indice + 1 };
  } catch {
    return { outcome: "failed", errorCode: corte.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(reloj);
  }
}
