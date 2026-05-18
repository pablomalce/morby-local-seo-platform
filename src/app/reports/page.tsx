"use client";

import { useState } from "react";
import { Badge, Button, Card, HudLabel, PageHeader } from "@/components/ui";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";

export default function ReportsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { business } = useSelection();
  const [message, setMessage] = useState("");

  const reports = [
    { kind: "weekly", title: "Weekly Growth Report" },
    { kind: "monthly", title: "Monthly Executive Report" },
    { kind: "technical", title: "Technical SEO Opportunity Report" },
  ];

  function flag(report: string, format: string) {
    setMessage(`${report} · ${format}: export will be implemented in Phase 2 (locale=${locale}, business=${business.name}).`);
  }

  return (
    <>
      <PageHeader
        eyebrow={`08 / REPORTS — ${business.name.toUpperCase()}`}
        frame="03 TEMPLATES"
        title={t("reports.title")}
        description={t("reports.description")}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {reports.map((r, idx) => (
          <Card key={r.kind} hoverable>
            <div className="flex items-center justify-between">
              <Badge variant="orange">{t("reports.preview")}</Badge>
              <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                {String(idx + 1).padStart(2, "0")} / 03
              </span>
            </div>
            <h2 className="mt-4 display-h text-lg">{r.title}</h2>
            <p className="mt-2 text-[12px] text-metal-400">{t("reports.bodyShort")}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => flag(r.title, "PDF")}>PDF</Button>
              <Button size="sm" variant="secondary" onClick={() => flag(r.title, "DOCX")}>DOCX</Button>
              <Button size="sm" variant="ghost" onClick={() => flag(r.title, "CSV")}>CSV</Button>
            </div>
          </Card>
        ))}
      </div>

      {message && (
        <Card className="mt-6">
          <HudLabel>EXPORT NOTICE</HudLabel>
          <p className="mt-2 text-[13px] text-vulkan-white">{message}</p>
        </Card>
      )}
    </>
  );
}
