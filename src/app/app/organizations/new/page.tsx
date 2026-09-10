import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HudLabel } from "@/components/ui";
import { AltaDeCliente } from "./client";

export const dynamic = "force-dynamic";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que la `0024` y su ruta sean código que nadie invoca.
 *
 * No lee nada de la base: no hay nada que mostrar antes de crear. Lo único que
 * hace acá el servidor es exigir sesión — sin ella la ruta contesta 401 y el
 * formulario sería un callejón.
 */
export default async function NuevaOrganizacionPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirectTo=/app/organizations/new");

  return (
    <div className="mx-auto max-w-2xl">
      <HudLabel>14 / CLIENTS</HudLabel>
      <h1 className="mt-3 display-h text-3xl">Dar de alta un cliente</h1>
      <AltaDeCliente />
    </div>
  );
}
