"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  CONSENT_VERSION,
  decidedAcceptAll,
  decidedRejectAll,
  defaultDeclined,
  type ConsentCategory,
  type ConsentState,
} from "./types";

const STORAGE_KEY = "lg.cookie-consent.v1";

interface ConsentContextValue {
  /** Current consent state. Null while we hydrate from localStorage on the client. */
  consent: ConsentState | null;
  /** True once the user has explicitly decided (Accept All / Reject All / Customize Save). */
  hasDecided: boolean;
  /** True if the banner should be shown right now. */
  showBanner: boolean;
  /** Convenience accessor — check if a category is currently allowed. */
  isAllowed: (category: ConsentCategory) => boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  /** Save a granular choice (necessary is always true). */
  save: (choice: Pick<ConsentState, "functional" | "analytics" | "marketing">) => void;
  /** Re-open the banner so the user can change their mind later (linked from footer). */
  openSettings: () => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

function readConsent(): ConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    if (typeof parsed !== "object" || parsed === null) return null;
    // Re-prompt if the schema version changed.
    if (parsed.version !== CONSENT_VERSION) return null;
    return { ...parsed, necessary: true };
  } catch {
    return null;
  }
}

function writeConsent(state: ConsentState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);

  useEffect(() => {
    setConsent(readConsent() ?? defaultDeclined());
    setHydrated(true);
  }, []);

  const hasDecided = !!consent?.decidedAt;
  const showBanner = hydrated && (!hasDecided || forceOpen);

  const persist = useCallback((next: ConsentState) => {
    setConsent(next);
    writeConsent(next);
    setForceOpen(false);
  }, []);

  const acceptAll = useCallback(() => persist(decidedAcceptAll()), [persist]);
  const rejectAll = useCallback(() => persist(decidedRejectAll()), [persist]);

  const save: ConsentContextValue["save"] = useCallback(
    (choice) => {
      persist({
        decidedAt: new Date().toISOString(),
        necessary: true,
        functional: choice.functional,
        analytics: choice.analytics,
        marketing: choice.marketing,
        version: CONSENT_VERSION,
      });
    },
    [persist],
  );

  const openSettings = useCallback(() => setForceOpen(true), []);

  const isAllowed = useCallback(
    (category: ConsentCategory) => {
      if (!consent) return category === "necessary"; // default deny pre-decision
      return consent[category];
    },
    [consent],
  );

  const value = useMemo<ConsentContextValue>(() => ({
    consent,
    hasDecided,
    showBanner,
    isAllowed,
    acceptAll,
    rejectAll,
    save,
    openSettings,
  }), [consent, hasDecided, showBanner, isAllowed, acceptAll, rejectAll, save, openSettings]);

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used inside <ConsentProvider>");
  return ctx;
}
