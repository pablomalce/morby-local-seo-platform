import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Download, LogOut, Mail, Trash2 } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge, Card, HudLabel, PageHeader } from "@/components/ui";
import { ExportButton, DeleteAccountButton, SignOutButton } from "./client";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirectTo=/app/account");

  // Resolve org info (best-effort — RLS filters).
  const { data: membership } = await supabase
    .from("org_members")
    .select("organization_id, role, created_at")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1);

  const { data: org } = membership?.[0]
    ? await supabase
        .from("organizations")
        .select("name, slug, default_locale, default_currency, created_at")
        .eq("id", membership[0].organization_id)
        .single()
    : { data: null };

  return (
    <>
      <PageHeader
        eyebrow="11 / ACCOUNT"
        frame="GDPR · SETTINGS"
        title="Your account"
        description="Manage your sign-in, export your data, and exercise your GDPR rights."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <HudLabel>IDENTITY</HudLabel>
          <div className="mt-4 space-y-2">
            <Row label="Email" value={user.email ?? "—"} />
            <Row label="User ID" value={user.id} mono />
            <Row label="Created" value={new Date(user.created_at).toLocaleString()} />
          </div>
          <div className="mt-5">
            <SignOutButton />
          </div>
        </Card>

        <Card>
          <HudLabel>ORGANIZATION</HudLabel>
          <div className="mt-4 space-y-2">
            <Row label="Name" value={org?.name ?? "Personal"} />
            <Row label="Slug" value={org?.slug ?? "—"} mono />
            <Row label="Role" value={membership?.[0]?.role ?? "owner"} />
            <Row
              label="Created"
              value={org?.created_at ? new Date(org.created_at).toLocaleString() : "—"}
            />
          </div>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-hud text-metal-500">
            Team invitations and member management land in Phase 4.
          </p>
        </Card>
      </div>

      <Card className="mt-6 vulkan-pattern-overlay">
        <HudLabel>DATA RIGHTS · GDPR</HudLabel>
        <p className="mt-2 text-[13px] text-metal-300">
          Under the EU General Data Protection Regulation you have the right to access, port and
          erase your data. Read the full{" "}
          <Link href="/legal/privacy" className="text-vulkan-orange underline">
            Privacy Policy
          </Link>{" "}
          for details.
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <ExportButton />
          <DeleteAccountButton />
        </div>
      </Card>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">{label}</span>
      <span
        className={`max-w-[60%] truncate text-[13px] text-vulkan-white ${mono ? "font-mono text-[11px]" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
