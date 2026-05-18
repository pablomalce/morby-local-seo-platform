"use client";

import Link from "next/link";
import {
  Bot,
  CalendarCheck,
  FileText,
  ImageIcon,
  LayoutDashboard,
  MapPin,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { Badge, Card, HudLabel, VulkanLogo } from "@/components/ui";
import { LocaleSwitcher } from "@/components/selectors/LocaleSwitcher";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";

const COPY = {
  en: {
    eyebrow: "VULKAN STUDIOS · GROWTH OS",
    title: "We don't just optimise visibility. We engineer local growth.",
    subtitle:
      "Universal AI command centre for any business, any industry, any market. Multi-tenant by design — high-end production, engineered.",
    whatTitle: "What it does",
    what:
      "Vulkan Growth OS is an AI copilot for agencies, consultants and operators. Analyse competitors, optimise GBP, ship localised SEO content, generate on-brand social images, manage reviews, plan 90-day sprints, run specialised agents and produce client-ready reports — from a single multi-tenant cockpit.",
    goalTitle: "Goal",
    goal:
      "Reduce manual work, surface the next best action and operationalise growth across every business and location an agency manages.",
    useTitle: "How to use it",
    steps: [
      "Add a new business from the header — the entire app reframes.",
      "Optionally choose a featured service and a specific location.",
      "Review the dashboard to see local rank, GBP and review trends.",
      "Open Image Studio to generate channel-ready creative.",
      "Run agents at platform, business, location or campaign scope.",
      "Follow the 90-day planner and export weekly client reports.",
    ],
    cta: "Open dashboard",
    secondaryCta: "Image Studio",
    addCta: "+ ADD NEW BUSINESS",
  },
  es: {
    eyebrow: "VULKAN STUDIOS · GROWTH OS",
    title: "No solo optimizamos visibilidad. Ingeniamos crecimiento local.",
    subtitle:
      "Centro de mando IA universal para cualquier negocio, industria o mercado. Multi-tenant por diseño — producción de alta gama, ingeniada.",
    whatTitle: "Qué hace",
    what:
      "Vulkan Growth OS es un copiloto IA para agencias, consultores y operadores. Analiza competidores, optimiza GBP, publica contenido SEO localizado, genera imágenes sociales on-brand, gestiona reseñas, planifica sprints de 90 días, ejecuta agentes especializados y produce reportes — desde un único cockpit.",
    goalTitle: "Objetivo",
    goal:
      "Reducir el trabajo manual, sugerir la siguiente mejor acción y operacionalizar el crecimiento a través de cada negocio y ubicación.",
    useTitle: "Cómo se usa",
    steps: [
      "Añade un nuevo negocio desde el encabezado — la app se reconfigura.",
      "Opcionalmente selecciona servicio destacado y ubicación.",
      "Revisa el panel: posición local, GBP, tendencias de reseñas.",
      "Abre Image Studio para generar creativos listos para cualquier canal.",
      "Ejecuta agentes a nivel plataforma, negocio, ubicación o campaña.",
      "Sigue el plan 90 días y exporta reportes semanales.",
    ],
    cta: "Abrir panel",
    secondaryCta: "Estudio de imágenes",
    addCta: "+ AÑADIR NEGOCIO",
  },
  sv: {
    eyebrow: "VULKAN STUDIOS · GROWTH OS",
    title: "Vi optimerar inte bara synlighet. Vi ingenjörsbyggder lokal tillväxt.",
    subtitle:
      "Universellt AI-kommandocenter för alla verksamheter, branscher och marknader. Multi-tenant från grunden — high-end produktion, ingenjörsbyggt.",
    whatTitle: "Vad det gör",
    what:
      "Vulkan Growth OS är en AI-copilot för byråer, konsulter och operatörer. Analysera konkurrenter, optimera GBP, publicera lokaliserat SEO-innehåll, generera bilder, hantera recensioner, planera 90-dagarssprintar och kör specialiserade agenter — i en multi-tenant cockpit.",
    goalTitle: "Mål",
    goal:
      "Minska manuellt arbete, visa nästa bästa åtgärd och operationalisera tillväxt över varje verksamhet och plats.",
    useTitle: "Så används appen",
    steps: [
      "Lägg till en ny verksamhet i sidhuvudet — hela appen anpassas.",
      "Välj eventuellt utvald tjänst och plats.",
      "Granska översikten: lokal placering, GBP, recensionstrender.",
      "Öppna Image Studio och skapa kanalfärdigt material.",
      "Kör agenter på plattforms-, verksamhets-, plats- eller kampanjnivå.",
      "Följ 90-dagarsplanen och exportera veckorapporter.",
    ],
    cta: "Öppna översikten",
    secondaryCta: "Bildstudio",
    addCta: "+ LÄGG TILL VERKSAMHET",
  },
};

export default function OverviewPage() {
  const { locale } = useI18n();
  const { business } = useSelection();
  const c = COPY[locale];

  const modules = [
    { icon: LayoutDashboard, label: "DASHBOARD" },
    { icon: Search, label: "COMPETITOR INTEL" },
    { icon: MapPin, label: "GOOGLE PROFILE" },
    { icon: Sparkles, label: "CONTENT STUDIO" },
    { icon: ImageIcon, label: "IMAGE STUDIO" },
    { icon: Star, label: "REVIEWS" },
    { icon: CalendarCheck, label: "90-DAY PLANNER" },
    { icon: FileText, label: "REPORTS" },
    { icon: Bot, label: "AGENTS" },
  ];

  return (
    <main>
      {/* Hero — slide 02 type composition */}
      <section className="vulkan-pattern-overlay relative mb-12 overflow-hidden rounded-vulkan-card border border-metal-800 bg-metal-950 p-8 md:p-12">
        <div className="absolute -right-12 -top-12 h-56 w-56 rounded-full bg-vulkan-orange/10 blur-3xl" aria-hidden />
        <div className="relative grid gap-10 md:grid-cols-[1fr_auto]">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <VulkanLogo size={32} />
              <HudLabel>{c.eyebrow}</HudLabel>
            </div>
            <h1 className="mt-6 display-h text-4xl md:text-6xl">
              {c.title.split(".").map((part, i, arr) => (
                <span key={i}>
                  {i > 0 && <span className="text-vulkan-orange">.</span>}
                  <span className={i === arr.length - 2 ? "text-vulkan-orange" : ""}>{part}</span>
                </span>
              ))}
            </h1>
            <p className="mt-5 max-w-2xl text-base text-metal-300">{c.subtitle}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/onboarding/new-business"
                className="inline-flex items-center justify-center rounded-vulkan bg-vulkan-orange px-5 py-3 font-display text-xs font-semibold uppercase tracking-hud text-vulkan-black transition-[background-color,box-shadow,transform] duration-vulkan ease-vulkan hover:bg-vulkan-orange-soft hover:-translate-y-px hover:shadow-orange-glow"
              >
                {c.addCta}
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-vulkan border border-metal-600 px-5 py-3 font-display text-xs font-semibold uppercase tracking-hud text-vulkan-white transition-colors duration-vulkan ease-vulkan hover:border-vulkan-orange hover:text-vulkan-orange"
              >
                {c.cta}
              </Link>
              <Link
                href="/studio/images"
                className="inline-flex items-center justify-center rounded-vulkan border border-metal-700 px-5 py-3 font-display text-xs font-semibold uppercase tracking-hud text-metal-300 transition-colors duration-vulkan ease-vulkan hover:bg-metal-900 hover:text-vulkan-white"
              >
                {c.secondaryCta}
              </Link>
            </div>
          </div>

          <aside className="flex flex-col gap-4 md:w-56">
            <HudLabel>ACTIVE TENANT</HudLabel>
            <div
              className="flex items-center gap-3 rounded-vulkan border border-metal-700 bg-metal-900 p-4"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-vulkan text-vulkan-black"
                style={{ backgroundColor: business.logoColor }}
              >
                <Star className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="truncate display-h text-sm">{business.name}</p>
                <p className="truncate font-mono text-[9px] uppercase tracking-hud text-metal-500">
                  {business.industry.replace(/_/g, " ")}
                </p>
              </div>
            </div>
            <LocaleSwitcher variant="inline" />
          </aside>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 space-y-8">
          <div>
            <HudLabel>{c.whatTitle}</HudLabel>
            <p className="mt-3 text-[14px] leading-relaxed text-metal-300">{c.what}</p>
          </div>
          <div>
            <HudLabel>{c.goalTitle}</HudLabel>
            <p className="mt-3 text-[14px] leading-relaxed text-metal-300">{c.goal}</p>
          </div>
          <div>
            <HudLabel>{c.useTitle}</HudLabel>
            <ol className="mt-3 space-y-3">
              {c.steps.map((step, index) => (
                <li
                  key={step}
                  className="flex gap-3 rounded-vulkan border border-metal-800 bg-metal-950 p-3 text-[13px] text-metal-200"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] bg-vulkan-orange font-mono text-[10px] font-bold text-vulkan-black">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </Card>

        <Card>
          <HudLabel>MODULES</HudLabel>
          <div className="mt-4 space-y-2">
            {modules.map((m, idx) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.label}
                  className="flex items-center gap-3 rounded-vulkan border border-metal-800 bg-metal-950 p-2.5"
                >
                  <span className="font-mono text-[9px] uppercase tracking-hud text-metal-500">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <Icon className="h-4 w-4 text-vulkan-orange" strokeWidth={1.5} />
                  <span className="flex-1 font-display text-[12px] uppercase tracking-hud text-vulkan-white">
                    {m.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-5">
            <Badge variant="hud">PHASE 1 SHIPPED</Badge>
          </div>
        </Card>
      </section>
    </main>
  );
}
