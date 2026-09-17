import { createServerClient } from "@supabase/ssr";
import { DESTINO_POST_LOGIN } from "@/lib/auth/rutas";
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

  // If Supabase isn't configured yet, the public site stays up in demo mode — but /app/* is the
  // gated area, and a gate that opens when its lock is missing is not a gate. Measured
  // 2026-09-16 by an adversarial review of the route sweep: with the variables absent (or with
  // Supabase down, below) every page under /app rendered for anyone. Public routes fall
  // through; the gated ones fail CLOSED, to the login, which is the only honest answer when
  // nobody can say who is asking.
  if (!supabaseUrl || !supabaseAnonKey) {
    return alLoginSiEsPrivada(request, "supabase-sin-configurar");
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
      url.pathname = DESTINO_POST_LOGIN;
      return NextResponse.redirect(url);
    }

    return response;
  } catch (err) {
    // Last-resort safety: never let a misconfigured Supabase setup take the PUBLIC site down.
    // The gated area is different: if the session cannot be checked, nobody gets in.
    console.error("[middleware] supabase failed:", err);
    return alLoginSiEsPrivada(request, "supabase-fallo");
  }
}

/**
 * Fail closed where there is a gate, fall through where there is none.
 *
 * Public routes (overview, dashboard, demo) never needed a session, so an auth
 * outage must not take them down. `/app/*` did need one, and "we could not
 * check" is not "checked and fine": it goes to the login with the reason in
 * the query, so the operator can tell a real logout from a broken backend.
 */
function alLoginSiEsPrivada(request: NextRequest, motivo: string): NextResponse {
  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("redirectTo", request.nextUrl.pathname);
  url.searchParams.set("motivo", motivo);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Run middleware on every route EXCEPT static assets and the public API health endpoints.
     */
    "/((?!_next/static|_next/image|favicon.ico|patterns/|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
