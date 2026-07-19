import { NextResponse } from "next/server";

/**
 * Best-effort in-memory per-IP rate limiter.
 *
 * NOTE: on serverless (Vercel) this is PER-INSTANCE and resets on cold start — it stops naive
 * single-source hammering (the common case), not a distributed attack. For production-grade,
 * cross-instance limiting, back this with Vercel KV / Upstash. Kept zero-dependency on purpose.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Returns null when the request is allowed, or a 429 NextResponse to short-circuit with. Prunes
 * expired buckets opportunistically so the map can't grow unbounded.
 */
export function rateLimit(
  req: Request,
  opts: { limit: number; windowMs: number; key: string },
): NextResponse | null {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }

  const id = `${opts.key}:${clientIp(req)}`;
  const bucket = buckets.get(id);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(id, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }
  if (bucket.count >= opts.limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  bucket.count++;
  return null;
}
