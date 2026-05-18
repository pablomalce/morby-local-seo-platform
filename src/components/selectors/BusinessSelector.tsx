"use client";

import { ChevronDown, Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSelection } from "@/lib/context/SelectionContext";
import { useT } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export function BusinessSelector() {
  const t = useT();
  const { business, businessesForOrg, setBusinessId } = useSelection();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group flex min-w-[240px] items-center gap-3 rounded-vulkan border border-metal-700 bg-metal-950 px-3 py-2 text-left transition-[border-color,box-shadow] duration-vulkan ease-vulkan hover:border-vulkan-orange/50",
        )}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-vulkan text-vulkan-black"
          style={{ backgroundColor: business.logoColor }}
        >
          <Building2 className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="flex-1 truncate">
          <span className="block font-mono text-[9px] uppercase tracking-hud text-metal-500">
            <span className="text-vulkan-orange">//</span> {t("selector.business")}
          </span>
          <span className="block truncate font-display text-[13px] uppercase tracking-hud text-vulkan-white">
            {business.name}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-metal-400 transition-transform duration-vulkan ease-vulkan",
            open && "rotate-180 text-vulkan-orange",
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-vulkan-card border border-metal-700 bg-metal-900 p-1.5 shadow-card-deep">
          <div className="max-h-72 overflow-y-auto">
            {businessesForOrg.map((b) => {
              const active = b.id === business.id;
              return (
                <button
                  key={b.id}
                  onClick={() => {
                    setBusinessId(b.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-vulkan border px-2 py-2 text-left text-sm transition-[background-color,border-color] duration-vulkan ease-vulkan",
                    active
                      ? "border-vulkan-orange/40 bg-vulkan-orange/10"
                      : "border-transparent hover:border-metal-700 hover:bg-metal-800",
                  )}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-vulkan text-vulkan-black"
                    style={{ backgroundColor: b.logoColor }}
                  >
                    <Building2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </span>
                  <span className="flex-1 truncate">
                    <span
                      className={cn(
                        "block truncate font-display text-[12px] uppercase tracking-hud",
                        active ? "text-vulkan-orange" : "text-vulkan-white",
                      )}
                    >
                      {b.name}
                    </span>
                    <span className="block truncate font-mono text-[9px] uppercase tracking-hud text-metal-500">
                      {b.industry.replace(/_/g, " ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 border-t border-metal-800 pt-1">
            <Link
              href="/onboarding/new-business"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-3 rounded-vulkan border border-dashed border-metal-600 px-2 py-2 text-left font-display text-[12px] uppercase tracking-hud text-vulkan-orange transition-[background-color,border-color] duration-vulkan ease-vulkan hover:border-vulkan-orange hover:bg-vulkan-orange/10"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-vulkan border border-vulkan-orange/40 text-vulkan-orange">
                <Plus className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="flex-1">{t("selector.addBusiness")}</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
