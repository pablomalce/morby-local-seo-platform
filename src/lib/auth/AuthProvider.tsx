"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface AuthState {
  loading: boolean;
  user: User | null;
  session: Session | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, user: null, session: null });

  useEffect(() => {
    // If env vars aren't set yet (e.g. on the public demo deploy before Phase 2 vars land),
    // skip silently and stay in unauthenticated demo mode.
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      setState({ loading: false, user: null, session: null });
      return;
    }

    const supabase = createSupabaseBrowserClient();
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setState({ loading: false, user: data.session?.user ?? null, session: data.session });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setState({ loading: false, user: session?.user ?? null, session });
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Convenience hook — `true` once auth state has been resolved. */
export function useIsSignedIn(): boolean {
  const { user, loading } = useAuth();
  return !loading && user !== null;
}
