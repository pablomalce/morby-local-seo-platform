"use client";

import { useSelection } from "@/lib/context/SelectionContext";
import { useT } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export function ServiceSelector() {
  const t = useT();
  const { service, servicesForBusiness, setServiceId } = useSelection();

  return (
    <div className="flex items-center gap-2 rounded-vulkan border border-metal-700 bg-metal-950 px-2 py-1.5">
      <span className="px-2 font-mono text-[9px] uppercase tracking-hud text-metal-500">
        <span className="text-vulkan-orange">//</span> {t("selector.service")}
      </span>
      <select
        aria-label={t("selector.service")}
        value={service?.id ?? ""}
        onChange={(e) => setServiceId(e.target.value || null)}
        className={cn(
          "rounded-vulkan bg-transparent px-2 py-1 font-display text-[12px] uppercase tracking-hud text-vulkan-white outline-none transition-colors duration-vulkan ease-vulkan focus:text-vulkan-orange",
        )}
      >
        <option value="" className="bg-metal-900">
          {t("selector.allServices")}
        </option>
        {servicesForBusiness.map((s) => (
          <option key={s.id} value={s.id} className="bg-metal-900">
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
