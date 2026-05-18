"use client";

import { Globe2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export function LocaleSwitcher({ variant = "header" }: { variant?: "header" | "inline" }) {
  const { locale, setLocale, supported, labels } = useI18n();
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-vulkan border border-metal-700 bg-metal-950 p-1",
        variant === "inline" && "bg-metal-900",
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center text-metal-500">
        <Globe2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      </span>
      {supported.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          title={labels[l]}
          className={cn(
            "rounded-vulkan px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-hud transition-colors duration-vulkan ease-vulkan",
            locale === l
              ? "bg-vulkan-orange text-vulkan-black"
              : "text-metal-400 hover:bg-metal-800 hover:text-vulkan-white",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
