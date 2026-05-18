"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, HudLabel, PageHeader, StatusPill } from "@/components/ui";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { useTenantSnapshot } from "@/lib/hooks/useTenantSnapshot";
import type { ContentAsset } from "@/lib/types/core";

export default function ContentPage() {
  const t = useT();
  const { business, service } = useSelection();
  const baseSnap = useTenantSnapshot();

  const baseContent = useMemo(() => {
    return service ? baseSnap.content.filter((c) => c.serviceId === service.id) : baseSnap.content;
  }, [baseSnap.content, service]);

  const [generated, setGenerated] = useState<ContentAsset[]>(baseContent);

  function generate() {
    const target = service ?? baseSnap.services[0];
    if (!target) return;
    const extra: ContentAsset = {
      id: `c-extra-${Date.now()}`,
      businessId: business.id,
      serviceId: target.id,
      locale: business.primaryLocale,
      kind: "cta",
      body: `Book your ${target.name.toLowerCase()} today — premium service, local expertise.`,
      targetKeyword: target.primaryKeyword,
      status: "draft",
      createdAt: new Date().toISOString(),
    };
    setGenerated((current) => [...current, extra]);
  }

  const target = service ?? baseSnap.services.find((s) => s.isFeatured) ?? baseSnap.services[0];
  const cluster = target ? [target.primaryKeyword, ...target.supportingKeywords] : [];

  return (
    <>
      <PageHeader
        eyebrow={`04 / CONTENT — ${business.name.toUpperCase()}`}
        frame={`${generated.length.toString().padStart(2, "0")} ASSETS`}
        title={t("content.title")}
        description={t("content.description")}
        action={<Button onClick={generate}>{t("content.generate")}</Button>}
      />

      <Card>
        <div className="mb-5 flex items-center justify-between">
          <HudLabel>{t("content.generated")}</HudLabel>
          <Badge variant="hud">{t("content.mockAi")}</Badge>
        </div>
        {generated.length === 0 ? (
          <p className="font-mono text-[11px] uppercase tracking-hud text-metal-500">
            No drafts yet — click generate.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {generated.map((item) => (
              <div
                key={item.id}
                className="rounded-vulkan border border-metal-800 bg-metal-950 p-4 transition-[border-color] duration-vulkan ease-vulkan hover:border-metal-600"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="orange">{item.kind.replace(/_/g, " ")}</Badge>
                  <StatusPill status={item.status} />
                </div>
                <p className="mt-3 text-[13px] text-vulkan-white">{item.body}</p>
                {item.targetKeyword && (
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    {item.targetKeyword}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {cluster.length > 0 && (
        <Card className="mt-6">
          <HudLabel>{t("content.keywordCluster")}</HudLabel>
          <div className="mt-4 flex flex-wrap gap-2">
            {cluster.map((k) => (
              <Badge key={k} variant="outline">
                {k}
              </Badge>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
