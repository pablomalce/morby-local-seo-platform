"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * GDPR right to access / portability.
 * Returns the entire footprint of the authenticated user as a JSON document.
 */
export async function exportMyData(): Promise<{ ok: boolean; data?: string; message?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, message: "Not authenticated" };

  // Pull every table the user has access to. RLS filters automatically.
  const [orgs, members, businesses, locations, services, content, competitors, reviews, reports, agentRuns, images] =
    await Promise.all([
      supabase.from("organizations").select("*"),
      supabase.from("org_members").select("*"),
      supabase.from("businesses").select("*"),
      supabase.from("business_locations").select("*"),
      supabase.from("business_services").select("*"),
      supabase.from("content_assets").select("*"),
      supabase.from("competitors").select("*"),
      supabase.from("reviews").select("*"),
      supabase.from("reports").select("*"),
      supabase.from("agent_runs").select("*"),
      supabase.from("social_image_assets").select("*"),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    user: { id: user.id, email: user.email, createdAt: user.created_at },
    organizations: orgs.data ?? [],
    org_members: members.data ?? [],
    businesses: businesses.data ?? [],
    business_locations: locations.data ?? [],
    business_services: services.data ?? [],
    content_assets: content.data ?? [],
    competitors: competitors.data ?? [],
    reviews: reviews.data ?? [],
    reports: reports.data ?? [],
    agent_runs: agentRuns.data ?? [],
    social_image_assets: images.data ?? [],
  };

  return { ok: true, data: JSON.stringify(payload, null, 2) };
}

/**
 * GDPR right to erasure ("right to be forgotten").
 * Deletes everything tied to the user. Triggered ON DELETE CASCADE will clear all child rows.
 */
export async function deleteMyAccount(): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, message: "Not authenticated" };

  const admin = createSupabaseAdminClient();

  // 1. Delete all orgs where this user is the owner (cascades into businesses + children).
  const { data: ownedMembers } = await admin
    .from("org_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("role", "owner");

  if (ownedMembers && ownedMembers.length > 0) {
    const orgIds = ownedMembers.map((m) => m.organization_id);
    await admin.from("organizations").delete().in("id", orgIds);
  }

  // 2. Remove any remaining org_members rows referencing this user.
  await admin.from("org_members").delete().eq("user_id", user.id);

  // 3. Delete the Supabase Auth user itself.
  await admin.auth.admin.deleteUser(user.id);

  // 4. Bounce to the public homepage.
  redirect("/");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/");
  redirect("/");
}
