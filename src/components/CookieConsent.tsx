"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Cookie, ShieldCheck, X } from "lucide-react";
import { useConsent } from "@/lib/consent/ConsentProvider";
import { useT } from "@/lib/i18n/I18nProvider";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * GDPR / ePrivacy compliant cookie banner.
 *
 * Design notes (compliance):
 *   - Reject is exactly as prominent as Accept (same size, same styling weight).
 *   - Granular toggles per category (Customize panel).
 *   - Necessary cookies cannot be turned off but are clearly explained.
 *   - The banner persists across pages until the user decides.
 *   - The user can re-open the panel anytime from the footer ("Cookie preferences").
 */
export function CookieConsent() {
  const t = useT();
  const { showBanner, consent, acceptAll, rejectAll, save } = useConsent();
  const [showCustomize, setShowCustomize] = useState(false);
  const [functional, setFunctional] = useState(consent?.functional ?? false);
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false);
  const [marketing, setMarketing] = useState(consent?.marketing ?? false);

  if (!showBanner) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-[80] flex justify-center p-3 md:p-5"
    >
      <div className="vulkan-pattern-overlay relative w-full max-w-3xl overflow-hidden rounded-vulkan-card border border-metal-700 bg-metal-900 shadow-card-deep">
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-vulkan bg-vulkan-orange/15 text-vulkan-orange">
              <Cookie className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div className="flex-1">
              <p className="font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
                <span className="text-vulkan-orange">//</span> {t("cookies.eyebrow")}
              </p>
              <h2
                id="cookie-consent-title"
                className="mt-2 display-h text-xl md:text-2xl"
              >
                {t("cookies.title")}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-metal-300">
                {t("cookies.body")}{" "}
                <Link
                  href="/legal/cookies"
                  className="underline decoration-vulkan-orange underline-offset-2 transition-colors hover:text-vulkan-orange"
                >
                  {t("cookies.readMore")}
                </Link>
              </p>
            </div>
          </div>

          {showCustomize && (
            <div className="mt-5 space-y-3 border-t border-metal-800 pt-5">
              <CategoryRow
                title={t("cookies.cat.necessary.title")}
                description={t("cookies.cat.necessary.body")}
                checked
                disabled
                onChange={() => {}}
                tag={t("cookies.alwaysOn")}
              />
              <CategoryRow
                title={t("cookies.cat.functional.title")}
                description={t("cookies.cat.functional.body")}
                checked={functional}
                onChange={setFunctional}
              />
              <CategoryRow
                title={t("cookies.cat.analytics.title")}
                description={t("cookies.cat.analytics.body")}
                checked={analytics}
                onChange={setAnalytics}
              />
              <CategoryRow
                title={t("cookies.cat.marketing.title")}
                description={t("cookies.cat.marketing.body")}
                checked={marketing}
                onChange={setMarketing}
              />
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <button
              type="button"
              onClick={() => setShowCustomize((v) => !v)}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-hud text-metal-400 transition-colors hover:text-vulkan-white"
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  showCustomize && "rotate-180",
                )}
              />
              {showCustomize ? t("cookies.hideDetails") : t("cookies.customize")}
            </button>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <Button variant="secondary" onClick={rejectAll} size="md">
                <X className="h-3.5 w-3.5" />
                {t("cookies.rejectAll")}
              </Button>
              {showCustomize ? (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => save({ functional, analytics, marketing })}
                >
                  <Check className="h-3.5 w-3.5" />
                  {t("cookies.saveChoice")}
                </Button>
              ) : (
                <span className="hidden md:block" />
              )}
              <Button onClick={acceptAll} size="md">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t("cookies.acceptAll")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  title,
  description,
  checked,
  disabled,
  onChange,
  tag,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  tag?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-vulkan border border-metal-800 bg-metal-950 p-3 transition-colors hover:border-metal-600",
        disabled && "cursor-default opacity-90 hover:border-metal-800",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "mt-0.5 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          checked
            ? "border-vulkan-orange bg-vulkan-orange/30"
            : "border-metal-600 bg-metal-800",
          disabled && "cursor-default",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 transform rounded-full transition-transform",
            checked ? "translate-x-4 bg-vulkan-orange" : "translate-x-0.5 bg-metal-400",
          )}
        />
      </button>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-[12px] uppercase tracking-hud text-vulkan-white">
            {title}
          </p>
          {tag && (
            <span className="font-mono text-[9px] uppercase tracking-hud text-vulkan-orange">
              {tag}
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] text-metal-400">{description}</p>
      </div>
    </label>
  );
}
