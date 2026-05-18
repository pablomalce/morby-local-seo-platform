import * as React from "react";
import { cn } from "@/lib/utils";

/* =============================================================================
   VULKAN STUDIOS — UI primitives
   Specs sourced from Vulkan_UI_KIt.pptx (slides 04, 07, 09, 10).
   ============================================================================= */

/* ---------- Card (slide 09 — Portfolio Units) ----------
   1px metal-700 hairline · 8px radius · hover lifts −4px · orange border swap. */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  inset?: boolean;
}
export function Card({ className, hoverable = false, inset = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "vulkan-card p-5",
        hoverable && "vulkan-card-hover",
        inset && "bg-metal-950",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Badge ----------
   Used for HUD labels and small status chips. Sharp edges (2px radius). */

type BadgeVariant = "default" | "orange" | "muted" | "critical" | "outline" | "success" | "hud";

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  const styles: Record<BadgeVariant, string> = {
    default: "bg-metal-800 text-metal-200 border-metal-700",
    orange: "bg-vulkan-orange/15 text-vulkan-orange border-vulkan-orange/40",
    muted: "bg-metal-900 text-metal-400 border-metal-700",
    critical: "bg-red-950/40 text-red-300 border-red-900/60",
    outline: "bg-transparent text-metal-200 border-metal-600",
    success: "bg-emerald-950/40 text-emerald-300 border-emerald-900/60",
    hud: "bg-transparent text-metal-400 border-metal-700 font-mono uppercase tracking-hud",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-hud",
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Button (slide 07 — Power Controls) ----------
   Solid · precise · 4px radius · 150ms vulkan ease.
   REST → HOVER glow + −1px translate · ACTIVE darker + reduced shadow · SECONDARY ghost. */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-vulkan font-display font-semibold uppercase tracking-hud transition-[background-color,box-shadow,transform,border-color] duration-vulkan ease-vulkan disabled:opacity-40 disabled:cursor-not-allowed select-none";

  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-vulkan-orange text-vulkan-black border border-vulkan-orange hover:bg-vulkan-orange-soft hover:-translate-y-px hover:shadow-orange-glow active:bg-vulkan-orange-dark active:translate-y-0 active:shadow-orange-glow-soft",
    secondary:
      "bg-transparent text-vulkan-white border border-metal-600 hover:border-vulkan-orange hover:text-vulkan-orange active:bg-metal-900",
    ghost:
      "bg-transparent text-metal-300 hover:text-vulkan-white hover:bg-metal-800 border border-transparent",
    danger:
      "bg-red-900/30 text-red-200 border border-red-900/60 hover:bg-red-900/50 hover:border-red-700",
  };

  const sizes: Record<ButtonSize, string> = {
    sm: "h-8 px-3 text-[10px]",
    md: "h-10 px-4 text-[11px]",
    lg: "h-12 px-6 text-xs",
  };

  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

/* ---------- PageHeader ---------- */

export function PageHeader({
  eyebrow,
  frame,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  /** Frame counter shown top-right ("12 / 24" style). Optional. */
  frame?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {eyebrow ? (
          <span className="hud-label inline-flex items-center gap-2">
            <span className="text-vulkan-orange">//</span> {eyebrow}
          </span>
        ) : (
          <span />
        )}
        {frame && <span className="frame-counter">{frame}</span>}
      </div>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <h1 className="display-h text-3xl md:text-5xl">{title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-metal-300">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-6 h-px w-full bg-metal-800" />
    </div>
  );
}

/* ---------- Progress (sharp bar, orange fill) ---------- */

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-none bg-metal-800">
      <div
        className="h-full rounded-none bg-vulkan-orange transition-[width] duration-vulkan-card ease-vulkan"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* ---------- Form primitives (slide 10 — Low-Friction Controls) ----------
   Surface #050505 · 1px metal-600 border · focus brings the orange ring forward. */

export const inputStyles =
  "w-full rounded-vulkan border border-metal-600 bg-metal-950 px-3 py-2 text-sm text-vulkan-white placeholder:text-metal-500 transition-[border-color,box-shadow] duration-vulkan ease-vulkan focus:outline-none focus:border-vulkan-orange focus:shadow-orange-glow-soft";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputStyles, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(inputStyles, "min-h-[112px] resize-y", props.className)}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(inputStyles, "appearance-none pr-8", props.className)}
    />
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn("block text-sm", className)}>
      <span className="mb-1.5 block hud-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-metal-500">{hint}</span>}
    </label>
  );
}

/* ---------- HUD primitives ---------- */

export function HudLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("hud-label inline-flex items-center gap-2", className)}>
      <span className="text-vulkan-orange">//</span>
      {children}
    </span>
  );
}

export function SectionMarker({ index, label }: { index: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
        {index}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-hud text-metal-400">{label}</span>
    </div>
  );
}

export function StatusDot({ tone = "online" }: { tone?: "online" | "warning" | "offline" | "muted" }) {
  const styles: Record<string, string> = {
    online: "bg-emerald-400",
    warning: "bg-vulkan-orange animate-vulkan-pulse",
    offline: "bg-red-500",
    muted: "bg-metal-500",
  };
  return <span className={cn("inline-block h-2 w-2 rounded-full", styles[tone])} />;
}

/* ---------- Empty State ---------- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <HudLabel>NO DATA YET</HudLabel>
      <p className="display-h text-2xl">{title}</p>
      <p className="max-w-sm text-sm text-metal-400">{description}</p>
      {action}
    </Card>
  );
}

/* ---------- StatusPill (workflow states) ---------- */

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    draft: "muted",
    pending_review: "orange",
    approved: "success",
    rejected: "critical",
    scheduled: "default",
    published: "success",
    archived: "muted",
    completed: "success",
    in_progress: "orange",
    pending: "muted",
    blocked: "critical",
    idle: "muted",
    queued: "outline",
    running: "orange",
    failed: "critical",
  };
  return <Badge variant={map[status] ?? "muted"}>{status.replace(/_/g, " ")}</Badge>;
}

/* ---------- Vulkan triangle logo ----------
   The brand mark from slide 01 / 15 — angular A-glyph in orange. */

export function VulkanLogo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M24 4L4 44H44L24 4Z" fill="#EF4C24" />
      <path d="M24 22L18 34H30L24 22Z" fill="#000000" />
    </svg>
  );
}
