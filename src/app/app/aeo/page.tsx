import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HudLabel } from "@/components/ui";
import { organizacionActiva } from "@/lib/org/servidor";
import { AuditoriaAeo } from "./client";

export const dynamic = "force-dynamic";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que la auditoría de legibilidad por IA no tenga desde dónde correrse.
 *
 * Usa la organización ACTIVA, igual que las otras de `/app`: la auditoría es de
 * un cliente, y con varios clientes hay que saber de cuál.
 */
export default async function AeoPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirectTo=/app/aeo");

  const organizacion = await organizacionActiva();

  if (!organizacion) {
    return (
      <div className="mx-auto max-w-3xl">
        <HudLabel>15 / AEO</HudLabel>
        <p className="mt-6 text-[13px] text-metal-300" data-testid="sin-organizacion">
          Esta cuenta no tiene ninguna organización activa.
        </p>
      </div>
    );
  }

  const { data: negocios } = await supabase
    .from("businesses")
    .select("id")
    .eq("organization_id", organizacion.id)
    .limit(1);

  const businessId = ((negocios ?? [])[0]?.id as string | undefined) ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <HudLabel>15 / AEO</HudLabel>
      <h1 className="mt-3 display-h text-3xl">{organizacion.name}</h1>
      <AuditoriaAeo businessId={businessId} />
    </div>
  );
}
