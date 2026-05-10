"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, CalendarCheck, FileText, Gauge, MapPin, MessageSquareText, Search, Settings, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/competitors", label: "Competitors", icon: Search },
  { href: "/gbp", label: "Google Profile", icon: MapPin },
  { href: "/content", label: "Content Studio", icon: Sparkles },
  { href: "/reviews", label: "Reviews", icon: MessageSquareText },
  { href: "/planner", label: "90-Day Planner", icon: CalendarCheck },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="min-h-screen"><aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r bg-white/75 p-5 backdrop-blur-xl lg:block"><div className="mb-8 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sage text-white"><Star className="h-5 w-5" /></div><div><p className="font-bold text-ink">Mörby SEO</p><p className="text-xs text-muted-foreground">AI Local Growth Platform</p></div></div><Badge variant="gold">Demo mode · API-ready</Badge><nav className="mt-8 space-y-1">{nav.map((item) => { const active = pathname === item.href || (pathname === "/" && item.href === "/dashboard"); const Icon = item.icon; return <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition", active ? "bg-ink text-white" : "text-muted-foreground hover:bg-cream hover:text-ink")}><Icon className="h-4 w-4" />{item.label}</Link>; })}</nav><div className="absolute bottom-5 left-5 right-5 rounded-2xl bg-cream p-4 text-sm"><p className="font-semibold text-ink">Target keyword</p><p className="mt-1 text-muted-foreground">ansiktsbehandling danderyd</p></div></aside><main className="lg:pl-72"><div className="mx-auto max-w-7xl p-5 md:p-8">{children}</div></main></div>;
}
