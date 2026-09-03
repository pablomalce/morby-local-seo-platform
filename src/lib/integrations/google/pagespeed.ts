/**
 * Google PageSpeed Insights API (v5) — server-only client.
 *
 * Single platform-wide key (`GOOGLE_PAGESPEED_API_KEY`). The API is free (no OAuth, no billing,
 * ~25k requests/day quota). We use it to hydrate a business with REAL Core Web Vitals (LCP, CLS),
 * a Time-to-Interactive proxy for INP, and the Lighthouse performance score for a given URL.
 *
 * If the key is missing we return `{ status: "missing-key" }` and the calling code falls back to
 * not showing Web Vitals. Never throws — PageSpeed is a nice-to-have, not a hard dependency.
 *
 * Reliability: auditing slow sites is flaky — a Lighthouse run can transiently fail (HTTP 5xx, a
 * 200 with a runtimeError, or a timeout). We therefore (a) use `cache: "no-store"` so a failed run
 * is never cached and re-served, and (b) retry once on a non-timeout failure within a bounded time
 * budget. A persistent good-result cache (Supabase) is the recommended next step for speed.
 */

import "server-only";
import type { FetchOutcome } from "./status";

export interface PageSpeedResult {
  status: "live" | "missing-key" | "error";
  /**
   * CÓMO terminó el intento, no sólo si sirvió.
   *
   * `status` colapsa un 403, un 429 y un timeout en la palabra `error`, y los
   * tres se arreglan en lugares distintos: habilitando la API en el proyecto,
   * esperando la cuota, o reintentando sobre un sitio lento. Este campo es lo que
   * la 0023 guarda para que ese motivo no dependa de un log efímero.
   */
  outcome: FetchOutcome;
  url?: string;
  /** Largest Contentful Paint in ms. */
  lcp?: number;
  /**
   * Interaction proxy in ms. Lighthouse does not expose INP directly, so we use the
   * Time to Interactive (`interactive`) audit as a stand-in.
   */
  inp?: number;
  /** Cumulative Layout Shift (decimal, 0–1+). */
  cls?: number;
  /** Lighthouse performance score, 0–100. */
  lighthouseScore?: number;
  /** ISO timestamp of when the lookup completed. */
  fetchedAt?: string;
}

/** Per-attempt timeout. PageSpeed routinely takes 15–30s and slow sites push past 40s. */
const TIMEOUT_MS = 45_000;
/** Total wall-clock budget across both attempts — kept under the route's maxDuration (60s). */
const TOTAL_BUDGET_MS = 55_000;
/** Skip the retry if less than this remains in the budget. */
const MIN_RETRY_BUDGET_MS = 10_000;

export async function lookupPageSpeed(opts: {
  url: string;
  strategy?: "mobile" | "desktop";
}): Promise<PageSpeedResult> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!apiKey) return { status: "missing-key", outcome: { kind: "no-credentials" } };

  const strategy = opts.strategy ?? "mobile";
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", opts.url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("key", apiKey);

  const start = Date.now();

  // Attempt 1.
  const first = await runOnce(endpoint, opts.url, TIMEOUT_MS);
  // A timeout means we have no budget left to retry; otherwise a live result is final.
  if (first.result.status === "live" || first.timedOut) return first.result;

  // Attempt 2 — Lighthouse runs on slow sites fail transiently; one retry usually clears it.
  const remaining = TOTAL_BUDGET_MS - (Date.now() - start);
  if (remaining < MIN_RETRY_BUDGET_MS) return first.result;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const second = await runOnce(endpoint, opts.url, Math.min(TIMEOUT_MS, remaining - 1_000));
  return second.result;
}

/** Single PageSpeed attempt. Returns the result plus whether it aborted on timeout. */
async function runOnce(
  endpoint: URL,
  url: string,
  timeoutMs: number,
): Promise<{ result: PageSpeedResult; timedOut: boolean }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      // Never cache: a failed Lighthouse run must not be re-served, and we retry on failure.
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn(`[pagespeed] HTTP ${response.status} for ${url}: ${detail.slice(0, 300)}`);
      return {
        result: { status: "error", url, outcome: { kind: "http", status: response.status } },
        timedOut: false,
      };
    }

    const payload = (await response.json()) as PageSpeedApiResponse;
    const audits = payload.lighthouseResult?.audits;
    const perfScore = payload.lighthouseResult?.categories?.performance?.score;

    if (!audits || typeof perfScore !== "number") {
      // eslint-disable-next-line no-console
      console.warn(
        `[pagespeed] incomplete result for ${url}: runtimeError=${JSON.stringify(
          payload.lighthouseResult?.runtimeError,
        )} hasAudits=${!!audits} score=${perfScore}`,
      );
      // 2xx con un cuerpo que no trae lo que se pidió: es `malformed`, no `http`.
      // Un código junto a un 200 mandaría a buscar el problema del lado del
      // permiso cuando lo que falló fue la corrida de Lighthouse.
      return {
        result: { status: "error", url, outcome: { kind: "malformed" } },
        timedOut: false,
      };
    }

    return {
      result: {
        status: "live",
        url,
        lcp: audits["largest-contentful-paint"]?.numericValue,
        cls: audits["cumulative-layout-shift"]?.numericValue,
        // Proxy for INP — Lighthouse exposes Time to Interactive, not INP directly.
        inp: audits["interactive"]?.numericValue,
        lighthouseScore: Math.round(perfScore * 100),
        fetchedAt: new Date().toISOString(),
        outcome: { kind: "ok" },
      },
      timedOut: false,
    };
  } catch (err) {
    // AbortError (timeout) or network failure — degrade gracefully, but log why.
    // eslint-disable-next-line no-console
    console.warn(
      `[pagespeed] fetch failed for ${url}: ${err instanceof Error ? `${err.name} ${err.message}` : String(err)}`,
    );
    return {
      result: {
        status: "error",
        url,
        // El abort propio es `timeout`; cualquier otra excepción del fetch es que
        // no llegó a haber respuesta. Llamar `timeout` a un DNS caído mandaría a
        // reintentar algo que no va a mejorar solo.
        outcome: timedOut ? { kind: "timeout" } : { kind: "network" },
      },
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

interface PageSpeedApiResponse {
  lighthouseResult?: {
    runtimeError?: { code?: string; message?: string };
    audits?: Record<string, { numericValue?: number }>;
    categories?: {
      performance?: { score?: number | null };
    };
  };
}
