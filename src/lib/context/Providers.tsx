"use client";

import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { SelectionProvider } from "./SelectionContext";

/**
 * Single top-level wrapper composed in `app/layout.tsx`. Add future providers (auth, theme,
 * analytics, error boundary) here so the layout itself stays declarative.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider defaultLocale="en">
      <SelectionProvider>{children}</SelectionProvider>
    </I18nProvider>
  );
}
