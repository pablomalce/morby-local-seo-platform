"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, Globe2, MapPin, Sparkles } from "lucide-react";
import { z } from "zod";
import {
  Badge,
  Button,
  Card,
  Field,
  HudLabel,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";
import { INDUSTRY_PRESETS, getIndustryPreset } from "@/lib/industries";
import type { IndustryVertical, Locale } from "@/lib/types/core";
import { cn } from "@/lib/utils";

// ---------- Schemas ----------

const basicsSchema = z.object({
  name: z.string().min(2, "Required"),
  website: z
    .string()
    .url("Must be a valid URL")
    .or(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Use a valid domain")),
  industry: z.string().min(1),
  primaryLocale: z.enum(["en", "es", "sv"]),
  brandTone: z.string().min(2, "Required"),
  valueProposition: z.string().min(10, "Add at least 10 characters"),
  logoColor: z.string().regex(/^#[0-9a-f]{6}$/i, "Use a hex color like #EF4C24"),
});

const locationSchema = z.object({
  label: z.string().min(1),
  addressLine: z.string().min(2),
  city: z.string().min(2),
  region: z.string().min(1),
  country: z.string().length(2, "Use ISO code (e.g. US, ES, SE)"),
  primaryGeoQuery: z.string().min(2),
});

const serviceSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(10),
  primaryKeyword: z.string().min(2),
  supportingKeywords: z.string().optional(),
});

// ---------- Stepper ----------

function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2 rounded-vulkan border px-3 py-1.5 font-mono text-[10px] uppercase tracking-hud transition-[border-color,background-color,color] duration-vulkan ease-vulkan",
              done && "border-vulkan-orange/40 bg-vulkan-orange/10 text-vulkan-orange",
              active && "border-vulkan-orange bg-vulkan-orange text-vulkan-black",
              !done && !active && "border-metal-700 bg-metal-950 text-metal-400",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-[2px] text-[10px] font-bold tabular-nums",
                done && "bg-vulkan-orange text-vulkan-black",
                active && "bg-vulkan-black text-vulkan-orange",
                !done && !active && "bg-metal-800 text-metal-400",
              )}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Page ----------

export default function NewBusinessPage() {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const { createTenant } = useSelection();

  const steps = [t("onboarding.step1"), t("onboarding.step2"), t("onboarding.step3"), t("onboarding.step4")];
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Basics
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState<IndustryVertical>("beauty_clinic");
  const [primaryLocale, setPrimaryLocale] = useState<Locale>(locale);
  const [brandTone, setBrandTone] = useState(getIndustryPreset("beauty_clinic").suggestedTone);
  const [valueProposition, setValueProposition] = useState("");
  const [logoColor, setLogoColor] = useState("#EF4C24");

  // Location
  const [locLabel, setLocLabel] = useState("Main location");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("US");
  const [geoQuery, setGeoQuery] = useState("");

  // Service
  const preset = useMemo(() => getIndustryPreset(industry), [industry]);
  const [svcName, setSvcName] = useState(preset.suggestedService.name);
  const [svcDesc, setSvcDesc] = useState(preset.suggestedService.description);
  const [svcKeyword, setSvcKeyword] = useState(preset.suggestedService.primaryKeyword);
  const [svcSupport, setSvcSupport] = useState("");

  function applyIndustry(next: IndustryVertical) {
    setIndustry(next);
    const p = getIndustryPreset(next);
    setBrandTone(p.suggestedTone);
    setSvcName(p.suggestedService.name);
    setSvcDesc(p.suggestedService.description);
    setSvcKeyword(p.suggestedService.primaryKeyword);
    if (!geoQuery) setGeoQuery(p.suggestedGeoQuery);
  }

  function validateStep(): boolean {
    setErrors({});
    if (step === 0) {
      const result = basicsSchema.safeParse({
        name,
        website,
        industry,
        primaryLocale,
        brandTone,
        valueProposition,
        logoColor,
      });
      if (!result.success) {
        const flat: Record<string, string> = {};
        for (const issue of result.error.issues) flat[issue.path.join(".")] = issue.message;
        setErrors(flat);
        return false;
      }
    }
    if (step === 1) {
      const result = locationSchema.safeParse({
        label: locLabel,
        addressLine,
        city,
        region,
        country,
        primaryGeoQuery: geoQuery,
      });
      if (!result.success) {
        const flat: Record<string, string> = {};
        for (const issue of result.error.issues) flat[issue.path.join(".")] = issue.message;
        setErrors(flat);
        return false;
      }
    }
    if (step === 2) {
      const result = serviceSchema.safeParse({
        name: svcName,
        description: svcDesc,
        primaryKeyword: svcKeyword,
        supportingKeywords: svcSupport,
      });
      if (!result.success) {
        const flat: Record<string, string> = {};
        for (const issue of result.error.issues) flat[issue.path.join(".")] = issue.message;
        setErrors(flat);
        return false;
      }
    }
    return true;
  }

  function next() {
    if (!validateStep()) return;
    setStep((s) => Math.min(steps.length - 1, s + 1));
  }
  function back() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
  }
  function normaliseWebsite(value: string): string {
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value}`;
  }
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    if (!validateStep()) return;
    setSubmitting(true);
    const supporting = svcSupport
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    try {
      await createTenant({
        business: {
          name,
          website: normaliseWebsite(website),
          industry,
          brandTone,
          primaryLocale,
          valueProposition,
          logoColor,
        },
        firstLocation: {
          label: locLabel,
          addressLine,
          city,
          region,
          country,
          primaryGeoQuery: geoQuery,
        },
        firstService: {
          name: svcName,
          description: svcDesc,
          primaryKeyword: svcKeyword,
          supportingKeywords: supporting,
        },
      });
      router.push("/dashboard");
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "Failed to create business" });
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="ONBOARDING / ADD BUSINESS"
        frame={`STEP ${String(step + 1).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")}`}
        title={t("onboarding.title")}
        description={t("onboarding.subtitle")}
      />

      <div className="mb-6">
        <Stepper steps={steps} current={step} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid lg:grid-cols-[1fr_320px]">
          <div className="p-6 md:p-8">
            {step === 0 && (
              <div className="space-y-4">
                <h2 className="flex items-center gap-2 display-h text-lg">
                  <Building2 className="h-5 w-5 text-vulkan-orange" strokeWidth={1.5} />
                  {t("onboarding.step1")}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t("onboarding.fields.name")}>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Local Co." />
                    <FieldError msg={errors.name} />
                  </Field>
                  <Field label={t("onboarding.fields.website")}>
                    <Input
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="acmelocal.com"
                    />
                    <FieldError msg={errors.website} />
                  </Field>
                  <Field label={t("onboarding.fields.industry")}>
                    <Select
                      value={industry}
                      onChange={(e) => applyIndustry(e.target.value as IndustryVertical)}
                    >
                      {INDUSTRY_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("onboarding.fields.locale")}>
                    <Select value={primaryLocale} onChange={(e) => setPrimaryLocale(e.target.value as Locale)}>
                      <option value="en">English</option>
                      <option value="es">Español</option>
                      <option value="sv">Svenska</option>
                    </Select>
                  </Field>
                  <Field label={t("onboarding.fields.tone")}>
                    <Input value={brandTone} onChange={(e) => setBrandTone(e.target.value)} />
                    <FieldError msg={errors.brandTone} />
                  </Field>
                  <Field label={t("onboarding.fields.color")} hint={t("onboarding.hint.color")}>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={logoColor}
                        onChange={(e) => setLogoColor(e.target.value)}
                        className="h-10 w-12 cursor-pointer rounded-vulkan border border-metal-700 bg-metal-950 p-1"
                      />
                      <Input
                        value={logoColor}
                        onChange={(e) => setLogoColor(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                    <FieldError msg={errors.logoColor} />
                  </Field>
                </div>
                <Field label={t("onboarding.fields.value")} hint={t("onboarding.hint.value")}>
                  <Textarea
                    value={valueProposition}
                    onChange={(e) => setValueProposition(e.target.value)}
                    placeholder="What outcome do you deliver, and to whom?"
                  />
                  <FieldError msg={errors.valueProposition} />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <h2 className="flex items-center gap-2 display-h text-lg">
                  <MapPin className="h-5 w-5 text-vulkan-orange" strokeWidth={1.5} />
                  {t("onboarding.step2")}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t("onboarding.fields.locationLabel")}>
                    <Input value={locLabel} onChange={(e) => setLocLabel(e.target.value)} />
                  </Field>
                  <Field label={t("onboarding.fields.address")}>
                    <Input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
                    <FieldError msg={errors.addressLine} />
                  </Field>
                  <Field label={t("onboarding.fields.city")}>
                    <Input value={city} onChange={(e) => setCity(e.target.value)} />
                    <FieldError msg={errors.city} />
                  </Field>
                  <Field label={t("onboarding.fields.region")}>
                    <Input value={region} onChange={(e) => setRegion(e.target.value)} />
                    <FieldError msg={errors.region} />
                  </Field>
                  <Field label={t("onboarding.fields.country")}>
                    <Input
                      value={country}
                      onChange={(e) => setCountry(e.target.value.toUpperCase())}
                      maxLength={2}
                    />
                    <FieldError msg={errors.country} />
                  </Field>
                  <Field label={t("onboarding.fields.geoQuery")} hint={t("onboarding.hint.geoQuery")}>
                    <Input
                      value={geoQuery}
                      onChange={(e) => setGeoQuery(e.target.value)}
                      placeholder="e.g. dentist brooklyn"
                    />
                    <FieldError msg={errors.primaryGeoQuery} />
                  </Field>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="flex items-center gap-2 display-h text-lg">
                  <Sparkles className="h-5 w-5 text-vulkan-orange" strokeWidth={1.5} />
                  {t("onboarding.step3")}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t("onboarding.fields.serviceName")}>
                    <Input value={svcName} onChange={(e) => setSvcName(e.target.value)} />
                    <FieldError msg={errors.name} />
                  </Field>
                  <Field label={t("onboarding.fields.serviceKeyword")}>
                    <Input value={svcKeyword} onChange={(e) => setSvcKeyword(e.target.value)} />
                    <FieldError msg={errors.primaryKeyword} />
                  </Field>
                </div>
                <Field label={t("onboarding.fields.serviceDesc")}>
                  <Textarea value={svcDesc} onChange={(e) => setSvcDesc(e.target.value)} />
                  <FieldError msg={errors.description} />
                </Field>
                <Field label={t("onboarding.fields.serviceSupport")} hint={t("common.optional")}>
                  <Input
                    value={svcSupport}
                    onChange={(e) => setSvcSupport(e.target.value)}
                    placeholder="keyword one, keyword two"
                  />
                </Field>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h2 className="display-h text-lg">{t("onboarding.step4")}</h2>

                <SummaryBlock title={t("onboarding.review.basics")}>
                  <SummaryRow label={t("onboarding.fields.name")} value={name} />
                  <SummaryRow label={t("onboarding.fields.website")} value={normaliseWebsite(website)} />
                  <SummaryRow label={t("onboarding.fields.industry")} value={getIndustryPreset(industry).label} />
                  <SummaryRow label={t("onboarding.fields.locale")} value={primaryLocale.toUpperCase()} />
                  <SummaryRow label={t("onboarding.fields.tone")} value={brandTone} />
                  <SummaryRow
                    label={t("onboarding.fields.color")}
                    value={
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-4 w-4 rounded-[2px] border border-metal-700"
                          style={{ backgroundColor: logoColor }}
                        />
                        {logoColor}
                      </span>
                    }
                  />
                  <SummaryRow label={t("onboarding.fields.value")} value={valueProposition} />
                </SummaryBlock>

                <SummaryBlock title={t("onboarding.review.location")}>
                  <SummaryRow label={t("onboarding.fields.locationLabel")} value={locLabel} />
                  <SummaryRow
                    label={t("onboarding.fields.address")}
                    value={`${addressLine}, ${city}, ${region}, ${country}`}
                  />
                  <SummaryRow label={t("onboarding.fields.geoQuery")} value={geoQuery} />
                </SummaryBlock>

                <SummaryBlock title={t("onboarding.review.service")}>
                  <SummaryRow label={t("onboarding.fields.serviceName")} value={svcName} />
                  <SummaryRow label={t("onboarding.fields.serviceKeyword")} value={svcKeyword} />
                  <SummaryRow label={t("onboarding.fields.serviceDesc")} value={svcDesc} />
                  {svcSupport && (
                    <SummaryRow label={t("onboarding.fields.serviceSupport")} value={svcSupport} />
                  )}
                </SummaryBlock>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-metal-800 pt-6">
              <Button variant="ghost" onClick={() => router.push("/dashboard")}>
                {t("common.cancel")}
              </Button>
              <div className="flex flex-wrap gap-2">
                {step > 0 && (
                  <Button variant="secondary" onClick={back}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {t("common.back")}
                  </Button>
                )}
                {step < steps.length - 1 ? (
                  <Button onClick={next}>
                    {t("common.next")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button onClick={submit} disabled={submitting}>
                    <Check className="h-3.5 w-3.5" />
                    {submitting ? "Saving..." : t("onboarding.cta.create")}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Live preview rail */}
          <aside className="border-t border-metal-800 bg-metal-950 p-6 md:p-8 lg:border-l lg:border-t-0">
            <HudLabel>PREVIEW</HudLabel>
            <div className="mt-4 flex items-center gap-3 rounded-vulkan border border-metal-700 bg-metal-900 p-4">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-vulkan text-vulkan-black"
                style={{ backgroundColor: logoColor }}
              >
                <Building2 className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="truncate display-h text-sm">{name || "YOUR BUSINESS"}</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-hud text-metal-500">
                  {getIndustryPreset(industry).label}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <RailItem icon={<Globe2 className="h-3.5 w-3.5" />} label={website ? normaliseWebsite(website) : "—"} />
              <RailItem
                icon={<MapPin className="h-3.5 w-3.5" />}
                label={city ? `${city}${region ? `, ${region}` : ""}` : "—"}
              />
              <RailItem icon={<Sparkles className="h-3.5 w-3.5" />} label={svcName || preset.suggestedService.name} />
            </div>

            <div className="mt-5 rounded-vulkan border border-metal-700 bg-metal-900 p-4">
              <HudLabel>{t("onboarding.fields.serviceKeyword")}</HudLabel>
              <div className="mt-2">
                <Badge variant="orange">{svcKeyword || preset.suggestedService.primaryKeyword}</Badge>
              </div>
            </div>
          </aside>
        </div>
      </Card>
    </>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <span className="mt-1 block font-mono text-[10px] uppercase tracking-hud text-red-400">{msg}</span>;
}

function SummaryBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-vulkan border border-metal-800 bg-metal-950 p-5">
      <HudLabel>{title}</HudLabel>
      <dl className="mt-3 space-y-1.5 text-sm">{children}</dl>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <dt className="font-mono text-[10px] uppercase tracking-hud text-metal-500">{label}</dt>
      <dd className="max-w-[60%] text-right text-[13px] text-vulkan-white">{value}</dd>
    </div>
  );
}

function RailItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-vulkan border border-metal-700 bg-metal-900 px-3 py-2 text-[11px] text-metal-300">
      <span className="text-metal-500">{icon}</span>
      <span className="truncate font-mono uppercase tracking-hud">{label}</span>
    </div>
  );
}
