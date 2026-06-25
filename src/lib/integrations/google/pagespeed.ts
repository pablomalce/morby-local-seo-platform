/**
 * Google PageSpeed Insights API (v5) — server-only client.
 *
 * Single platform-wide key (`GOOGLE_PAGESPEED_API_KEY`). The API is free (no OAuth, no billing,
 * ~25k requests/day quota). We use it to hydrate a business with REAL Core Web Vitals (LCP, CLS),
 * a Time-to-Interactive proxy for INP, and the Lighthouse performance score for a given URL.
 *
 * If the key is missing we return `{ status: "missing-key" }` and the calling code falls back to
 * not showing Web Vitals. Never throws — PageSpeed is a nice-to-have, not a hard dependency.
 */

import "server-only";

export interface PageSpeedResult {
  status: "live" | "missing-key" | "error";
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

/**
 * PageSpeed routinely takes 15–30s, and slow sites can push past 40s. Abort beyond this so we
 * never hang a report. Kept under the route's `maxDuration` (60s) so the function has headroom.
 */
const TIMEOUT_MS = 45_000;

export async function lookupPageSpeed(opts: {
  url: string;
  strategy?: "mobile" | "desktop";
}): Promise<PageSpeedResult> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!apiKey) return { status: "missing-key" };

  const strategy = opts.strategy ?? "mobile";
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", opts.url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      // PageSpeed scores drift slowly — a day-long cache is plenty and keeps reports fast.
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn(`[pagespeed] HTTP ${response.status} for ${opts.url}: ${detail.slice(0, 300)}`);
      return { status: "error", url: opts.url };
    }

    const payload = (await response.json()) as PageSpeedApiResponse;
    const audits = payload.lighthouseResult?.audits;
    const perfScore = payload.lighthouseResult?.categories?.performance?.score;

    if (!audits || typeof perfScore !== "number") {
      // eslint-disable-next-line no-console
      console.warn(
        `[pagespeed] incomplete result for ${opts.url}: runtimeError=${JSON.stringify(
          payload.lighthouseResult?.runtimeError,
        )} hasAudits=${!!audits} score=${perfScore}`,
      );
      return { status: "error", url: opts.url };
    }

    return {
      status: "live",
      url: opts.url,
      lcp: audits["largest-contentful-paint"]?.numericValue,
      cls: audits["cumulative-layout-shift"]?.numericValue,
      // Proxy for INP — Lighthouse exposes Time to Interactive, not INP directly.
      inp: audits["interactive"]?.numericValue,
      lighthouseScore: Math.round(perfScore * 100),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    // AbortError (timeout) or network failure — degrade gracefully, but log why.
    // eslint-disable-next-line no-console
    console.warn(
      `[pagespeed] fetch failed for ${opts.url}: ${err instanceof Error ? `${err.name} ${err.message}` : String(err)}`,
    );
    return { status: "error", url: opts.url };
  } finally {
    clearTimeout(timeout);
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
