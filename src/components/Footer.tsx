"use client";

import Link from "next/link";
import { useConsent } from "@/lib/consent/ConsentProvider";
import { useT } from "@/lib/i18n/I18nProvider";
import { VulkanLogo } from "@/components/ui";

/**
 * Site-wide footer rendered at the bottom of the AppShell. Hosts legal links and the
 * "Cookie preferences" trigger that re-opens the consent banner.
 */
export function Footer() {
  const t = useT();
  const { openSettings } = useConsent();

  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-metal-800 bg-metal-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-6 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-center gap-3">
          <VulkanLogo size={20} />
          <div className="leading-tight">
            <p className="font-mono text-[10px] uppercase tracking-hud text-metal-400">
              VULKAN <span className="text-vulkan-orange">//</span> GROWTH OS
            </p>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-hud text-metal-600">
              © {year} · {t("footer.tagline")}
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-hud">
          <Link href="/legal/privacy" className="text-metal-400 transition-colors hover:text-vulkan-white">
            {t("footer.privacy")}
          </Link>
          <Link href="/legal/cookies" className="text-metal-400 transition-colors hover:text-vulkan-white">
            {t("footer.cookies")}
          </Link>
          <Link href="/legal/terms" className="text-metal-400 transition-colors hover:text-vulkan-white">
            {t("footer.terms")}
          </Link>
          <button
            type="button"
            onClick={openSettings}
            className="text-vulkan-orange transition-colors hover:text-vulkan-orange-soft"
          >
            {t("footer.cookiePreferences")}
          </button>
        </nav>
      </div>
    </footer>
  );
}
