"use client";

import Link from "next/link";
import { Badge, Card, HudLabel, PageHeader } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import type { PlatformIntegrationStatus, PlatformState } from "@/lib/integrations/platformStatus";

/**
 * Las tres palabras, y la tercera es la que esta pantalla existía para no tener.
 *
 * `PER CLIENT` no es un adorno de «casi listo». Es la diferencia entre mandar a
 * alguien a Google Cloud y mandarlo a mapear un cliente, que es la misma
 * distinción que hace la pantalla de integraciones y la razón por la que el #56
 * la separó.
 */
const ESTADO: Record<PlatformState, { label: string; variant: "success" | "orange" | "muted" }> = {
  ready: { label: "CONFIGURED", variant: "success" },
  "per-client": { label: "PER CLIENT", variant: "orange" },
  "not-configured": { label: "NOT CONFIGURED", variant: "muted" },
};

export function SettingsView({ status }: { status: PlatformIntegrationStatus[] }) {
  const t = useT();
  const { business, location, servicesForBusiness, locationsForBusiness } = useSelection();

  const listas = status.filter((s) => s.state === "ready").length;

  return (
    <>
      <PageHeader
        eyebrow={`10 / SETTINGS — ${business.name.toUpperCase()}`}
        frame={`INTEGRATIONS · ${listas} / ${status.length}`}
        title={t("settings.title")}
        description={t("settings.description")}
        action={<Badge variant="hud">{t("app.demoBadge")}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <HudLabel>{t("settings.businessInfo")}</HudLabel>
          <div className="mt-5 space-y-2">
            <Row label={t("selector.business")} value={business.name} />
            <Row label="Website" value={business.website} />
            <Row label={t("settings.industry")} value={business.industry.replace(/_/g, " ")} />
            <Row label={t("settings.brandTone")} value={business.brandTone} />
            <Row label={t("settings.primaryLocale")} value={business.primaryLocale.toUpperCase()} />
            {location && (
              <Row
                label={t("selector.location")}
                value={`${location.label} · ${location.city}, ${location.region}`}
              />
            )}
            <Row label={t("settings.locations")} value={`${locationsForBusiness.length}`} />
            <Row label={t("settings.services")} value={`${servicesForBusiness.length}`} />
          </div>
        </Card>

        <Card>
          <HudLabel>{t("settings.integrationChecklist")}</HudLabel>
          <div className="mt-5 space-y-2">
            {status.map((i, idx) => {
              const e = ESTADO[i.state];
              return (
                <div
                  key={i.name}
                  className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[13px] text-vulkan-white">{i.name}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {/* Cuántas de las que necesita están puestas, nunca cuáles ni
                        su valor. Es lo que convierte «sin configurar» en algo
                        accionable: 1/2 dice que falta una, no que no se empezó. */}
                    {i.required > 0 && i.state !== "ready" && (
                      <span className="font-mono text-[10px] text-metal-500">
                        {i.present}/{i.required}
                      </span>
                    )}
                    <Badge variant={e.variant}>{e.label}</Badge>
                  </span>
                </div>
              );
            })}
          </div>

          <p className="mt-5 font-mono text-[10px] uppercase tracking-hud text-metal-500">
            {t("settings.envWarning")}
          </p>

          <p className="mt-3 text-[12px] text-metal-400">
            <span className="text-vulkan-orange">PER CLIENT</span> means the platform has its
            credentials and each client still needs its property mapped. That half is not fixed
            here.
          </p>

          <Link
            href="/app/integrations"
            className="mt-3 inline-block font-mono text-[10px] uppercase tracking-hud text-vulkan-orange underline"
          >
            Google integrations, per organization →
          </Link>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">{label}</span>
      <span className="text-[13px] text-vulkan-white">{value}</span>
    </div>
  );
}
