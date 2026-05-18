"use client";

import { Badge, Card, HudLabel, PageHeader } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";

const INTEGRATIONS = [
  "OpenAI API",
  "OpenAI Image Generation",
  "Google Places API",
  "Google Business Profile API",
  "Google Search Console",
  "Google Analytics GA4",
  "LinkedIn",
  "Meta (Facebook & Instagram)",
  "X / Twitter",
  "Buffer / Metricool",
  "Resend",
  "Stripe",
  "Sentry",
  "PostHog",
];

export default function SettingsPage() {
  const t = useT();
  const { business, location, servicesForBusiness, locationsForBusiness } = useSelection();

  return (
    <>
      <PageHeader
        eyebrow={`10 / SETTINGS — ${business.name.toUpperCase()}`}
        frame="INTEGRATIONS · 14"
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
            {INTEGRATIONS.map((i, idx) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3"
              >
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[13px] text-vulkan-white">{i}</span>
                </span>
                <Badge variant="muted">{t("settings.notConnected")}</Badge>
              </div>
            ))}
          </div>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-hud text-metal-500">
            {t("settings.envWarning")}
          </p>
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
