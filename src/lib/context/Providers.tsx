"use client";

import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { ConsentProvider } from "@/lib/consent/ConsentProvider";
import { SelectionProvider } from "./SelectionContext";

/**
 * Single top-level wrapper composed in `app/layout.tsx`. Order:
 *   - I18nProvider (outermost) — every other layer can read the active locale.
 *   - ConsentProvider — must wrap anything that conditionally loads non-essential cookies.
 *   - AuthProvider — exposes the session to children; ConsentProvider doesn't depend on it.
 *   - SelectionProvider (innermost) — needs Auth to decide between local/Supabase tenants.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider defaultLocale="en">
      <ConsentProvider>
        <AuthProvider>
          <SelectionProvider>{children}</SelectionProvider>
        </AuthProvider>
      </ConsentProvider>
    </I18nProvider>
  );
}
