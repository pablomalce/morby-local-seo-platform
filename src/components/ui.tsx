import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border bg-card p-5 shadow-soft", className)} {...props} />;
}
export function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default"|"gold"|"muted"|"critical" }) {
  const styles = {
    default: "bg-sage/15 text-ink border-sage/25",
    gold: "bg-gold/15 text-ink border-gold/30",
    muted: "bg-muted text-muted-foreground border-border",
    critical: "bg-red-50 text-red-700 border-red-100"
  }[variant];
  return <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium", styles)}>{children}</span>;
}
export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50", className)} {...props} />;
}
export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="mb-2 text-sm font-medium text-sage">Mörby Local SEO Intelligence</p><h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">{title}</h1><p className="mt-2 max-w-3xl text-muted-foreground">{description}</p></div>{action}</div>;
}
export function Progress({ value }: { value: number }) { return <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-sage" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>; }
