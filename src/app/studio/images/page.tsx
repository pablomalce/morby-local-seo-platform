"use client";

import { useMemo, useState } from "react";
import { Download, ImageIcon, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Field,
  HudLabel,
  Input,
  PageHeader,
  Select,
  StatusPill,
  Textarea,
} from "@/components/ui";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { generateImage, type ImageBrief } from "@/lib/integrations/imageProvider";
import type {
  AspectRatio,
  Locale,
  SocialImageAsset,
  SocialPlatform,
} from "@/lib/types/core";
import { seedImageAssets } from "@/lib/mock/universal";
import { isUserCreated } from "@/lib/store/tenantStore";

const PLATFORMS: { value: SocialPlatform; label: string; ratio: AspectRatio }[] = [
  { value: "linkedin", label: "LinkedIn", ratio: "4:5" },
  { value: "instagram_feed", label: "Instagram Feed", ratio: "1:1" },
  { value: "instagram_story", label: "Instagram Story", ratio: "9:16" },
  { value: "facebook", label: "Facebook", ratio: "1:1" },
  { value: "x_twitter", label: "X / Twitter", ratio: "16:9" },
  { value: "gbp_post", label: "Google Business Profile", ratio: "1:1" },
  { value: "website_banner", label: "Website Banner", ratio: "16:9" },
  { value: "ad_creative", label: "Ad Creative", ratio: "1:1" },
];

const RATIOS: AspectRatio[] = ["1:1", "4:5", "9:16", "16:9", "3:2", "2:3"];

const STYLES = [
  "Editorial photography",
  "Industrial dark editorial",
  "Modern minimal product shot",
  "Vibrant Mediterranean lifestyle",
  "Premium clinic aesthetic",
  "Warm artisanal mood",
  "Bold ad-style creative",
];

export default function ImageStudioPage() {
  const t = useT();
  const { locale } = useI18n();
  const { business, service, location } = useSelection();

  const seeds = useMemo(
    () => (isUserCreated(business.id) ? [] : seedImageAssets.filter((a) => a.businessId === business.id)),
    [business.id],
  );
  const [history, setHistory] = useState<SocialImageAsset[]>(seeds);

  const [platform, setPlatform] = useState<SocialPlatform>("instagram_feed");
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [style, setStyle] = useState<string>(STYLES[1]);
  const [goal, setGoal] = useState<string>("Launch the featured service");
  const [audience, setAudience] = useState<string>("Local customers");
  const [lang, setLang] = useState<Locale>(locale);
  const [tone, setTone] = useState<string>(business.brandTone);
  const [cta, setCta] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const brief: ImageBrief = {
        businessId: business.id,
        businessName: business.name,
        brandColor: business.logoColor,
        brandTone: tone,
        serviceId: service?.id,
        serviceName: service?.name,
        locationId: location?.id,
        platform,
        aspectRatio: ratio,
        visualStyle: style,
        campaignGoal: goal,
        audience,
        language: lang,
        cta,
        prompt,
      };
      const asset = await generateImage(brief);
      setHistory((prev) => [asset, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  function downloadAsset(asset: SocialImageAsset) {
    const a = document.createElement("a");
    a.href = asset.imageUrl;
    a.download = `${business.name.replace(/\s+/g, "-").toLowerCase()}-${asset.platform}-${asset.aspectRatio.replace(":", "x")}.svg`;
    a.click();
  }

  return (
    <>
      <PageHeader
        eyebrow={`05 / IMAGE STUDIO — ${business.name.toUpperCase()}`}
        frame={`${history.length.toString().padStart(2, "0")} ASSETS`}
        title={t("studio.title")}
        description={t("studio.description")}
        action={
          <Badge variant="hud">
            <span className="text-vulkan-orange">//</span>&nbsp;{t("studio.providerLabel")}: DEMO
          </Badge>
        }
      />

      <Card className="mb-6 vulkan-pattern-overlay border-vulkan-orange/30">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-hud text-metal-300">
          <Sparkles className="h-3.5 w-3.5 text-vulkan-orange" strokeWidth={1.5} />
          {t("studio.demoNotice")}
        </p>
      </Card>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <div className="mb-5 flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-vulkan-orange" strokeWidth={1.5} />
            <HudLabel>{t("studio.brief")}</HudLabel>
          </div>

          <div className="grid gap-4">
            <Field label={t("studio.brief.platform")}>
              <Select
                value={platform}
                onChange={(e) => {
                  const next = e.target.value as SocialPlatform;
                  setPlatform(next);
                  const def = PLATFORMS.find((p) => p.value === next);
                  if (def) setRatio(def.ratio);
                }}
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t("studio.brief.ratio")}>
                <Select value={ratio} onChange={(e) => setRatio(e.target.value as AspectRatio)}>
                  {RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("studio.brief.language")}>
                <Select value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="sv">Svenska</option>
                </Select>
              </Field>
            </div>

            <Field label={t("studio.brief.style")}>
              <Select value={style} onChange={(e) => setStyle(e.target.value)}>
                {STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t("studio.brief.goal")}>
              <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t("studio.brief.audience")}>
                <Input value={audience} onChange={(e) => setAudience(e.target.value)} />
              </Field>
              <Field label={t("studio.brief.cta")}>
                <Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Book now" />
              </Field>
            </div>

            <Field label={t("studio.brief.tone")}>
              <Input value={tone} onChange={(e) => setTone(e.target.value)} />
            </Field>

            <Field label={t("studio.previewPrompt")} hint={t("common.optional")}>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A premium editorial scene..."
              />
            </Field>

            <Button onClick={generate} disabled={loading} size="lg">
              {loading ? t("studio.generating") : t("studio.generate")}
            </Button>
          </div>
        </Card>

        <div className="xl:col-span-3">
          <HudLabel>{t("studio.history")}</HudLabel>
          {history.length === 0 ? (
            <Card className="mt-3">
              <p className="font-mono text-[11px] uppercase tracking-hud text-metal-500">
                No assets yet. Fill in the brief and generate your first on-brand visual.
              </p>
            </Card>
          ) : (
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {history.map((asset) => (
                <Card key={asset.id} hoverable className="overflow-hidden p-0">
                  <div className="bg-metal-950">
                    {asset.imageUrl.startsWith("data:") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.imageUrl} alt={asset.altText} className="block h-auto w-full" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center font-mono text-[10px] uppercase tracking-hud text-metal-500">
                        Placeholder · {asset.aspectRatio}
                      </div>
                    )}
                  </div>
                  <div className="p-5">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{asset.platform.replace(/_/g, " ")}</Badge>
                      <Badge variant="muted">{asset.aspectRatio}</Badge>
                      <Badge variant="muted">{asset.language.toUpperCase()}</Badge>
                      <StatusPill status={asset.status} />
                    </div>
                    <p className="text-[13px] text-vulkan-white">{asset.caption}</p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-hud text-metal-500">
                      {asset.hashtags.join(" ")}
                    </p>
                    <details className="mt-3 text-[11px] text-metal-400">
                      <summary className="cursor-pointer font-mono uppercase tracking-hud text-metal-300">
                        {t("studio.previewPrompt")}
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap">{asset.prompt}</p>
                    </details>
                    <details className="mt-2 text-[11px] text-metal-400">
                      <summary className="cursor-pointer font-mono uppercase tracking-hud text-metal-300">
                        {t("studio.previewAlt")}
                      </summary>
                      <p className="mt-2">{asset.altText}</p>
                    </details>
                    <div className="mt-4 flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
                        {t("studio.providerLabel")}: {asset.provider}
                      </span>
                      {asset.imageUrl.startsWith("data:") && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => downloadAsset(asset)}
                        >
                          <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                          {t("common.download")}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
