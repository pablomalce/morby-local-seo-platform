import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HudLabel } from "@/components/ui";
import { ContenidoDeLaOrganizacion } from "./client";
import type { AssetVisto } from "@/lib/content/estadoDelAsset";

export const dynamic = "force-dynamic";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que la ruta de aprobación del #85 sea otro módulo que nadie llama.
 *
 * Es el defecto que este proyecto ya se comió cuatro veces —el último, el
 * transporte con 19 tests sin invocar— y por eso `client.test.tsx` afirma sobre
 * la LLAMADA, no sobre el aspecto del botón.
 *
 * `/content`, la pública, sigue siendo la demo: dibuja `@/lib/mock`. Ésta es la
 * de producto y no importa nada sembrado. `page.test.ts` es la pared.
 */
export default async function ContentPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirectTo=/app/content");

  const { data: memberships } = await supabase
    .from("org_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("state", "active");

  const orgIds = (memberships ?? []).map((m) => m.organization_id as string);

  if (orgIds.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <HudLabel>05 / CONTENT</HudLabel>
        <p className="mt-6 text-[13px] text-metal-300" data-testid="sin-organizacion">
          Esta cuenta no tiene ninguna organización activa.
        </p>
      </div>
    );
  }

  const [assetsRes, negociosRes] = await Promise.all([
    supabase
      .from("content_assets")
      .select("id, title, kind, locale, status, approved_hash, payload_hash")
      .in("organization_id", orgIds)
      .order("created_at", { ascending: false }),
    supabase.from("businesses").select("id").in("organization_id", orgIds).limit(1),
  ]);

  // Un fallo de lectura no es «no hay contenido». Se dice, y no se dibuja una
  // lista vacía que se lee como un dato.
  if (assetsRes.error) {
    return (
      <div className="mx-auto max-w-3xl">
        <HudLabel>05 / CONTENT</HudLabel>
        <p
          data-testid="contenido-ilegible"
          className="mt-6 rounded-vulkan border border-red-900/60 bg-red-950/30 p-4 text-[12px] text-red-200"
        >
          No se pudo leer el contenido, así que esta pantalla no sabe si hay o no. Reintentá antes
          de sacar conclusiones.
        </p>
      </div>
    );
  }

  const assets: AssetVisto[] = (assetsRes.data ?? []).map((r) => ({
    id: r.id as string,
    title: (r.title as string | null) ?? null,
    kind: r.kind as string,
    locale: r.locale as string,
    status: r.status as string,
    approvedHash: (r.approved_hash as string | null) ?? null,
    payloadHash: (r.payload_hash as string | null) ?? null,
  }));

  const businessId = ((negociosRes.data ?? [])[0]?.id as string | undefined) ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <HudLabel>05 / CONTENT</HudLabel>
      <h1 className="mt-3 display-h text-3xl">Content and approval</h1>
      <ContenidoDeLaOrganizacion assets={assets} businessId={businessId} />
    </div>
  );
}
