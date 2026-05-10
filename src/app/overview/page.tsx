"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe2, LayoutDashboard, Search, Star, FileText, CalendarCheck, Bot } from "lucide-react";

const content = {
  es: {
    title: "Mörby Local SEO Intelligence Platform",
    subtitle:
      "Una plataforma web en modo demo para planificar, organizar y ejecutar una estrategia de SEO local para Mörby Fotvård och Skönhet.",
    whatTitle: "Qué hace la aplicación",
    what:
      "La app funciona como un copiloto de SEO local. Ayuda a analizar competidores, mejorar Google Business Profile, organizar contenido SEO, gestionar reseñas, planificar acciones durante 90 días y preparar reportes para el cliente.",
    goalTitle: "Objetivo principal",
    goal:
      "Ayudar a Mörby Fotvård och Skönhet a mejorar su posicionamiento para la búsqueda “ansiktsbehandling danderyd” y reforzar su autoridad local en tratamientos faciales en Danderyd.",
    useTitle: "Cómo se usa",
    steps: [
      "Entrar al Dashboard para ver el estado general.",
      "Revisar competidores locales como Angelly Beauty.",
      "Usar Google Business Profile para ver tareas de optimización.",
      "Crear ideas de contenido SEO en Content Studio.",
      "Organizar la estrategia de reseñas.",
      "Seguir el plan de trabajo de 90 días.",
      "Generar reportes para presentar avances al cliente."
    ],
    demo: "Estado actual: modo demo con datos simulados. La estructura está preparada para futuras integraciones con OpenAI, Google Places, Google Business Profile, Search Console y GA4.",
    cta: "Ir al Dashboard"
  },
  en: {
    title: "Mörby Local SEO Intelligence Platform",
    subtitle:
      "A demo web platform to plan, organize, and execute a local SEO strategy for Mörby Fotvård och Skönhet.",
    whatTitle: "What the app does",
    what:
      "The app works as a local SEO copilot. It helps analyze competitors, improve Google Business Profile, organize SEO content, manage reviews, plan 90 days of actions, and prepare client reports.",
    goalTitle: "Main goal",
    goal:
      "Help Mörby Fotvård och Skönhet improve visibility for “ansiktsbehandling danderyd” and strengthen its local authority for facial treatments in Danderyd.",
    useTitle: "How to use it",
    steps: [
      "Open the Dashboard to view the overall status.",
      "Review local competitors such as Angelly Beauty.",
      "Use Google Business Profile to review optimization tasks.",
      "Create SEO content ideas in Content Studio.",
      "Organize the review growth strategy.",
      "Follow the 90-day work plan.",
      "Generate reports to present client progress."
    ],
    demo: "Current status: demo mode with simulated data. The structure is ready for future integrations with OpenAI, Google Places, Google Business Profile, Search Console, and GA4.",
    cta: "Go to Dashboard"
  },
  sv: {
    title: "Mörby Local SEO Intelligence Platform",
    subtitle:
      "En demo-webbplattform för att planera, organisera och genomföra en lokal SEO-strategi för Mörby Fotvård och Skönhet.",
    whatTitle: "Vad appen gör",
    what:
      "Appen fungerar som en lokal SEO-copilot. Den hjälper till att analysera konkurrenter, förbättra Google Business Profile, organisera SEO-innehåll, hantera recensioner, planera 90 dagars arbete och skapa kundrapporter.",
    goalTitle: "Huvudmål",
    goal:
      "Hjälpa Mörby Fotvård och Skönhet att förbättra synligheten för “ansiktsbehandling danderyd” och stärka sin lokala auktoritet inom ansiktsbehandlingar i Danderyd.",
    useTitle: "Så används appen",
    steps: [
      "Öppna Dashboard för att se nuläget.",
      "Granska lokala konkurrenter som Angelly Beauty.",
      "Använd Google Business Profile för optimeringsuppgifter.",
      "Skapa SEO-innehållsidéer i Content Studio.",
      "Organisera strategin för fler recensioner.",
      "Följ 90-dagarsplanen.",
      "Skapa rapporter för att visa framsteg för kunden."
    ],
    demo: "Nuvarande status: demoläge med simulerad data. Strukturen är redo för framtida integrationer med OpenAI, Google Places, Google Business Profile, Search Console och GA4.",
    cta: "Gå till Dashboard"
  }
};

export default function OverviewPage() {
  const [lang, setLang] = useState<"es" | "en" | "sv">("es");
  const t = content[lang];

  const modules = [
    { icon: LayoutDashboard, label: "Dashboard" },
    { icon: Search, label: "Competitor Intelligence" },
    { icon: Star, label: "Reviews Strategy" },
    { icon: FileText, label: "SEO Content Studio" },
    { icon: CalendarCheck, label: "90-Day Planner" },
    { icon: Bot, label: "AI Agents" }
  ];

  return (
    <main className="min-h-screen bg-[#f8f5ef] px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="mb-2 text-sm font-medium uppercase tracking-[0.25em] text-[#8a7a52]">
              Local SEO Demo Platform
            </p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              {t.title}
            </h1>
            <p className="mt-4 max-w-3xl text-lg text-slate-600">
              {t.subtitle}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
              <Globe2 size={16} />
              Language
            </div>
            <div className="flex gap-2">
              {(["es", "en", "sv"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setLang(item)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium ${
                    lang === item
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="grid gap-6 md:grid-cols-3">
          <div className="rounded-3xl bg-white p-6 shadow-sm md:col-span-2">
            <h2 className="mb-3 text-2xl font-semibold">{t.whatTitle}</h2>
            <p className="text-slate-600">{t.what}</p>

            <h2 className="mb-3 mt-8 text-2xl font-semibold">{t.goalTitle}</h2>
            <p className="text-slate-600">{t.goal}</p>

            <h2 className="mb-3 mt-8 text-2xl font-semibold">{t.useTitle}</h2>
            <ol className="space-y-3">
              {t.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-slate-700">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#d8c89f] text-sm font-semibold text-slate-900">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-sm">
            <h2 className="mb-4 text-xl font-semibold">Modules</h2>
            <div className="space-y-3">
              {modules.map((module) => {
                const Icon = module.icon;
                return (
                  <div
                    key={module.label}
                    className="flex items-center gap-3 rounded-2xl bg-white/10 p-3"
                  >
                    <Icon size={18} />
                    <span className="text-sm">{module.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <div className="mt-6 rounded-3xl border border-[#e1d6b8] bg-[#fffaf0] p-6 text-slate-700">
          {t.demo}
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-6 py-3 font-medium text-white hover:bg-slate-700"
          >
            {t.cta}
          </Link>
          <Link
            href="/planner"
            className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 py-3 font-medium text-slate-800 hover:bg-slate-50"
          >
            90-Day Planner
          </Link>
        </div>
      </div>
    </main>
  );
}
