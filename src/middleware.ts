import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresh the Supabase auth session on every request that matches the matcher below.
 *
 * Defensive design: if the Supabase env vars aren't set (e.g. on a fresh Vercel deploy before
 * the admin has added them), the middleware passes through transparently — the public demo
 * keeps working, /app routes simply aren't gated until configured.
 *
 * Public routes (overview, dashboard, demo) can be accessed without a session and use
 * localStorage-backed seed data. Pages under `/app/*` are gated: if there's no session, we
 * redirect to /login.
 */
export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured yet, skip auth-related logic entirely. The site stays up in
  // demo mode and /app/* simply renders without a session (frontend gracefully handles this).
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // Refresh session if expired — required for Server Components.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const url = request.nextUrl.clone();

    // Gate /app/* — must be signed in.
    if (url.pathname.startsWith("/app") && !user) {
      url.pathname = "/login";
      url.searchParams.set("redirectTo", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }

    // If already signed in, /login bounces to /app.
    if (url.pathname === "/login" && user) {
      url.pathname = "/app/dashboard";
      return NextResponse.redirect(url);
    }

    return response;
  } catch (err) {
    // Last-resort safety: never let a misconfigured Supabase setup take the whole site down.
    // Log to Vercel runtime logs and let the request through.
    console.error("[middleware] supabase failed, falling through:", err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    /*
     * Run middleware on every route EXCEPT static assets and the public API health endpoints.
     */
    "/((?!_next/static|_next/image|favicon.ico|patterns/|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
