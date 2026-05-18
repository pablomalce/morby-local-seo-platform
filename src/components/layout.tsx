"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarCheck,
  FileText,
  Gauge,
  HelpCircle,
  ImageIcon,
  MapPin,
  MessageSquareText,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, StatusDot, VulkanLogo } from "@/components/ui";
import { BusinessSelector } from "@/components/selectors/BusinessSelector";
import { ServiceSelector } from "@/components/selectors/ServiceSelector";
import { LocaleSwitcher } from "@/components/selectors/LocaleSwitcher";
import { useT } from "@/lib/i18n/I18nProvider";
import { useSelection } from "@/lib/context/SelectionContext";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof Gauge;
  index: string;
  section: "ENGAGE" | "PRODUCE" | "AGENTS" | "ADMIN";
}

const nav: NavItem[] = [
  { href: "/overview", labelKey: "nav.howToUse", icon: HelpCircle, index: "00", section: "ENGAGE" },
  { href: "/dashboard", labelKey: "nav.dashboard", icon: Gauge, index: "01", section: "ENGAGE" },
  { href: "/competitors", labelKey: "nav.competitors", icon: Search, index: "02", section: "ENGAGE" },
  { href: "/gbp", labelKey: "nav.gbp", icon: MapPin, index: "03", section: "ENGAGE" },
  { href: "/content", labelKey: "nav.content", icon: Sparkles, index: "04", section: "PRODUCE" },
  { href: "/studio/images", labelKey: "nav.images", icon: ImageIcon, index: "05", section: "PRODUCE" },
  { href: "/reviews", labelKey: "nav.reviews", icon: MessageSquareText, index: "06", section: "PRODUCE" },
  { href: "/planner", labelKey: "nav.planner", icon: CalendarCheck, index: "07", section: "PRODUCE" },
  { href: "/reports", labelKey: "nav.reports", icon: FileText, index: "08", section: "PRODUCE" },
  { href: "/agents", labelKey: "nav.agents", icon: Bot, index: "09", section: "AGENTS" },
  { href: "/settings", labelKey: "nav.settings", icon: Settings, index: "10", section: "ADMIN" },
];

function NavGroup({
  label,
  items,
  pathname,
  t,
}: {
  label: string;
  items: NavItem[];
  pathname: string | null;
  t: (k: string) => string;
}) {
  return (
    <div className="space-y-1">
      <p className="px-3 pb-2 pt-1 font-mono text-[9px] uppercase tracking-hud text-metal-500">
        <span className="text-vulkan-orange">//</span> {label}
      </p>
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (pathname === "/" && item.href === "/dashboard") ||
          (item.href !== "/" && pathname?.startsWith(item.href + "/"));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "group relative flex items-center gap-3 rounded-vulkan border px-3 py-2.5 text-[12px] font-display uppercase tracking-hud transition-[background-color,border-color,color] duration-vulkan ease-vulkan",
              active
                ? "border-vulkan-orange/40 bg-vulkan-orange/10 text-vulkan-orange"
                : "border-transparent text-metal-300 hover:border-metal-700 hover:bg-metal-900 hover:text-vulkan-white",
            )}
          >
            <span
              className={cn(
                "font-mono text-[9px] tabular-nums",
                active ? "text-vulkan-orange" : "text-metal-500",
              )}
            >
              {item.index}
            </span>
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="flex-1 truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const { business, service } = useSelection();

  const groups: { label: string; items: NavItem[] }[] = [
    { label: "ENGAGE", items: nav.filter((n) => n.section === "ENGAGE") },
    { label: "PRODUCE", items: nav.filter((n) => n.section === "PRODUCE") },
    { label: "AGENTS", items: nav.filter((n) => n.section === "AGENTS") },
    { label: "ADMIN", items: nav.filter((n) => n.section === "ADMIN") },
  ];

  return (
    <div className="min-h-screen bg-vulkan-black vulkan-radial-bg">
      {/* ===== SIDEBAR — Solid Industrial (Variant B, slide 08) ===== */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-metal-800 bg-metal-950 lg:flex">
        {/* Brand block */}
        <div className="flex items-center gap-3 border-b border-metal-800 px-5 py-5">
          <VulkanLogo size={28} />
          <div className="flex-1 leading-none">
            <p className="wordmark text-[11px]">VULKAN</p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-hud text-metal-500">
              / GROWTH OS
            </p>
          </div>
        </div>

        {/* Status strip */}
        <div className="flex items-center justify-between border-b border-metal-800 px-5 py-3">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-hud text-metal-400">
            <StatusDot tone="online" />
            SYSTEM ONLINE
          </span>
          <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
            DEMO
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {groups.map((g) => (
            <NavGroup key={g.label} label={g.label} items={g.items} pathname={pathname} t={t} />
          ))}
        </nav>

        {/* Tenant context footer */}
        <div className="border-t border-metal-800 px-5 py-4">
          <p className="font-mono text-[9px] uppercase tracking-hud text-metal-500">
            ACTIVE TENANT
          </p>
          <p className="mt-1 truncate font-display text-sm uppercase tracking-hud text-vulkan-white">
            {business.name}
          </p>
          <p className="mt-1 truncate text-[11px] text-metal-400">
            {service ? service.primaryKeyword : business.valueProposition}
          </p>
        </div>
      </aside>

      {/* ===== MAIN ===== */}
      <main className="lg:pl-72">
        {/* Top bar — sticky, glass over the dark canvas */}
        <header className="sticky top-0 z-20 border-b border-metal-800 bg-black/70 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-3 md:flex-row md:items-center md:justify-between md:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <BusinessSelector />
              <ServiceSelector />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="hud">
                <span className="text-vulkan-orange">//</span> &nbsp;DEMO MODE
              </Badge>
              <LocaleSwitcher />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">{children}</div>
      </main>
    </div>
  );
}
