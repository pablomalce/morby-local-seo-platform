import { NextResponse } from "next/server";

/**
 * Gate for API routes that are NOT meant to be called from the browser (internal / server-to-server
 * / not-yet-wired endpoints).
 *
 * FAIL CLOSED, AND WHY THAT CHANGED
 *
 * This used to be opt-in: with `INTERNAL_API_SECRET` unset the gate was a no-op, "so nothing
 * breaks" in demo mode. Measured on 2026-09-10 by calling every route handler with no session:
 * seven routes — seo/audit, agents/run, agents/run-all, content/generate, integrations/gbp/profile,
 * integrations/images/generate, integrations/places/search — answered 200 to an anonymous caller,
 * because this function was the only thing in front of them and the variable was not set anywhere,
 * not even in `.env.example`. The repository's default state was open, and the status of seven
 * routes was decided by a Vercel variable instead of by code.
 *
 * Measured separately before flipping it: none of those seven has a caller anywhere in the app.
 * No page fetches them, there is no `vercel.json` cron, and nothing in `src` sends
 * `x-internal-secret`. So denying by default breaks nothing that runs today; what it closes is
 * seven endpoints that anyone on the internet could hit, three of which will spend money the day
 * their live branches are implemented.
 *
 * Returns null when allowed, or a 401 NextResponse to short-circuit with. With the variable unset
 * the answer is always 401: an endpoint that nobody has configured a secret for is an endpoint
 * nobody is supposed to be calling.
 */
export function requireInternalSecret(req: Request): NextResponse | null {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
