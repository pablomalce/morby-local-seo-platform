/**
 * Cookie / storage consent categories — GDPR / ePrivacy Directive.
 *
 * Strictly necessary cookies do NOT require consent (recital 30 of the GDPR + Article 5(3)
 * of the ePrivacy Directive). Everything else does, and the user must be able to reject as
 * easily as accept. We give granular per-category control.
 */

export type ConsentCategory = "necessary" | "functional" | "analytics" | "marketing";

export interface ConsentState {
  /** ISO timestamp of when the user last decided. */
  decidedAt: string | null;
  /** Always true — strictly necessary cookies cannot be refused (and are not personal data). */
  necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  /** Schema version — bump when categories change so we re-prompt. */
  version: number;
}

export const CONSENT_VERSION = 1;

export function defaultDeclined(): ConsentState {
  return {
    decidedAt: null,
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
    version: CONSENT_VERSION,
  };
}

export function decidedAcceptAll(): ConsentState {
  return {
    decidedAt: new Date().toISOString(),
    necessary: true,
    functional: true,
    analytics: true,
    marketing: true,
    version: CONSENT_VERSION,
  };
}

export function decidedRejectAll(): ConsentState {
  return {
    decidedAt: new Date().toISOString(),
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
    version: CONSENT_VERSION,
  };
}
