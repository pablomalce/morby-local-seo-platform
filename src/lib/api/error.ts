import { NextResponse } from "next/server";

/**
 * Standard API error response. Logs the real error server-side (Vercel runtime logs) but returns
 * a generic message to the client so internal details (stack, DB errors, provider messages) never
 * leak. Use in every route's catch block.
 */
export function apiError(err: unknown, status = 400) {
  // eslint-disable-next-line no-console
  console.error("[api] request failed:", err);
  return NextResponse.json({ error: "Request could not be processed." }, { status });
}
