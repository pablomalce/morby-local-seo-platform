import { NextResponse } from "next/server";

/**
 * Gate for API routes that are NOT meant to be called from the browser (internal / server-to-server
 * / not-yet-wired endpoints).
 *
 * Opt-in by design: if `INTERNAL_API_SECRET` is set, callers must send it as the `x-internal-secret`
 * header. If it's unset (e.g. the public demo), the gate is a no-op so nothing breaks. This lets you
 * lock these routes down from Vercel — just add the env var — without any code change.
 *
 * Returns null when allowed, or a 401 NextResponse to short-circuit with.
 */
export function requireInternalSecret(req: Request): NextResponse | null {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return null; // not configured → open (demo mode)
  if (req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
