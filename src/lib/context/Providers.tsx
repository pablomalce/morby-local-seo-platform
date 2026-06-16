"use client";

import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { SelectionProvider } from "./SelectionContext";

/**
 * Single top-level wrapper composed in `app/layout.tsx`. Order matters:
 *   - AuthProvider sits outside SelectionProvider so the latter can switch data sources
 *     based on the current session (Supabase DB when signed in, localStorage when demo).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider defaultLocale="en">
      <AuthProvider>
        <SelectionProvider>{children}</SelectionProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
