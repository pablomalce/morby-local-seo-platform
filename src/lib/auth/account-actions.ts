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
 *
 * QUÉ IMPIDE: que le conteste «listo» a alguien a quien no se le borró nada.
 * Hasta el 2026-10-01 ningún paso miraba su `error` y la función terminaba en
 * `redirect("/")` pasara lo que pasara; medido en la réplica, con una versión
 * publicada de la ficha los tres borrados morían con 23503 y la pantalla se
 * leía como éxito. Ahora cada paso corta la cadena y vuelve `ok: false`.
 *
 * Un rechazo que SIGUE siendo correcto, y por eso tiene que llegar: si la
 * persona publicó o verificó una versión de la ficha en una organización que
 * NO es suya, sacarle esa membresía se rechaza al COMMIT (decisiones 4 y 18 de
 * la `0026`). Quién publicó es parte de la versión; esa organización decide
 * primero qué pasa con ella.
 *
 * Lo que este cambio no hace: deshacer un paso que ya pasó. Si las
 * organizaciones propias se borraron y el paso 2 falla, ya no están, y el
 * mensaje lo dice en vez de prometer que no se borró nada.
 */
export async function deleteMyAccount(): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, message: "Not authenticated" };

  const admin = createSupabaseAdminClient();

  // El detalle de la base va al log y no a la pantalla: el DETAIL de un 23503
  // nombra el uuid de otra organización.
  const fallo = (paso: string, error: { code?: string; message: string }, yaBorrado: string) => {
    console.error(`[deleteMyAccount] ${paso}: ${error.code ?? "?"} ${error.message}`);
    return {
      ok: false,
      message: `Your account was not deleted: we could not ${paso}.${yaBorrado ? ` ${yaBorrado}` : ""}`,
    };
  };

  // 1. Delete all orgs where this user is the owner (cascades into businesses + children).
  // Si no se puede leer cuáles son, no se sigue: con `data` en null el paso se
  // salteaba en silencio y los pasos 2 y 3 dejaban las organizaciones sin dueño.
  const { data: ownedMembers, error: ownedErr } = await admin
    .from("org_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("role", "owner");
  if (ownedErr) return fallo("look up the organizations you own", ownedErr, "Nothing was deleted.");

  const orgIds = (ownedMembers ?? []).map((m) => m.organization_id);
  if (orgIds.length > 0) {
    const { error: orgsErr } = await admin.from("organizations").delete().in("id", orgIds);
    if (orgsErr) return fallo("delete the organizations you own", orgsErr, "Nothing was deleted.");
  }
  const yaBorrado = orgIds.length > 0 ? "The organizations you owned were deleted." : "";

  // 2. Remove any remaining org_members rows referencing this user.
  const { error: membersErr } = await admin.from("org_members").delete().eq("user_id", user.id);
  if (membersErr) {
    return fallo("remove your memberships in other organizations", membersErr, yaBorrado);
  }

  // 3. Delete the Supabase Auth user itself.
  const { error: userErr } = await admin.auth.admin.deleteUser(user.id);
  if (userErr) return fallo("delete your login", userErr, yaBorrado);

  // 4. Bounce to the public homepage.
  redirect("/");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/");
  redirect("/");
}
