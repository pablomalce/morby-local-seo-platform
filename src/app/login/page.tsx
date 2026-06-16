"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Mail } from "lucide-react";
import { Badge, Button, Card, Field, HudLabel, Input, VulkanLogo } from "@/components/ui";
import { signInWithEmail, type SignInResult } from "@/lib/auth/actions";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell loadingFallback />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const params = useSearchParams();
  const redirectTo = params.get("redirectTo") ?? "/app/dashboard";
  const errorParam = params.get("error");

  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SignInResult | null>(null);

  function handleSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await signInWithEmail(formData);
      setResult(r);
    });
  }

  return (
    <LoginShell>
      <form action={handleSubmit} className="mt-6 space-y-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <Field label="Email">
          <Input
            type="email"
            name="email"
            placeholder="you@company.com"
            required
            autoComplete="email"
          />
        </Field>

        <Button type="submit" disabled={pending} size="lg" className="w-full">
          {pending ? (
            "Sending link..."
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Mail className="h-3.5 w-3.5" />
              SEND MAGIC LINK
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>

        {errorParam && !result && (
          <div className="rounded-vulkan border border-red-900/60 bg-red-950/30 p-3 text-[12px] text-red-200">
            {decodeURIComponent(errorParam)}
          </div>
        )}

        {result && (
          <div
            className={`rounded-vulkan border p-3 text-[12px] ${
              result.ok
                ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-200"
                : "border-red-900/60 bg-red-950/30 text-red-200"
            }`}
          >
            {result.message}
          </div>
        )}
      </form>
    </LoginShell>
  );
}

function LoginShell({
  children,
  loadingFallback = false,
}: {
  children?: React.ReactNode;
  loadingFallback?: boolean;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-vulkan-black vulkan-radial-bg px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <VulkanLogo size={36} />
          <div>
            <p className="wordmark text-sm">VULKAN</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-hud text-metal-500">
              / GROWTH OS
            </p>
          </div>
        </div>

        <Card className="vulkan-pattern-overlay">
          <HudLabel>SIGN IN</HudLabel>
          <h1 className="mt-3 display-h text-3xl">Magic link access</h1>
          <p className="mt-2 text-[13px] text-metal-400">
            Enter your email — we send you a one-tap sign-in link. No passwords, no fuss.
          </p>
          {loadingFallback ? (
            <p className="mt-6 font-mono text-[11px] uppercase tracking-hud text-metal-500">
              Loading...
            </p>
          ) : (
            children
          )}
        </Card>

        <div className="mt-6 flex items-center justify-between font-mono text-[10px] uppercase tracking-hud text-metal-500">
          <Badge variant="hud">DEMO MODE PUBLIC AT /</Badge>
          <a href="/" className="hover:text-vulkan-orange">
            ← Back to demo
          </a>
        </div>
      </div>
    </main>
  );
}
