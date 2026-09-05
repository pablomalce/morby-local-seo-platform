import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HudLabel } from "@/components/ui";
import { Ledger } from "./client";
import type { FilaLedger } from "@/lib/publishing/ledgerView";

export const dynamic = "force-dynamic";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que lo único que sepa qué reservó o publicó la plataforma sea una consulta SQL.
 *
 * SE LEE COMO EL USUARIO, Y ESO ES LA MITAD DEL DISEÑO
 *
 * Con el cliente de sesión y no con el admin. La RLS de la `0016` —una permisiva
 * y una RESTRICTIVE— ya dice qué filas alcanza cada quien, así que esta pantalla
 * no necesita ningún privilegio nuevo y tampoco escribe una comprobación de
 * membresía propia: sería una COPIA de la RLS, y una copia diverge.
 *
 * `GRANT SELECT ON public.publications TO authenticated` está en la `0016`.
 * Nada que aplicar.
 */
export default async function PublishingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirectTo=/app/publishing");

  // Sin `.eq("organization_id", …)`: la RLS ya limita esto a las organizaciones
  // del usuario. Filtrar acá además no agregaría seguridad —la RLS no se puede
  // saltear desde el cliente de sesión— y sí agregaría un segundo lugar donde el
  // criterio puede quedar desincronizado.
  const { data, error } = await supabase
    .from("publications")
    .select("id, asset_id, destination, status, external_id, attempts, created_at, published_at")
    .order("created_at", { ascending: false });

  // Un fallo de lectura NO es un ledger vacío. Decir «no hay publicaciones»
  // cuando la consulta falló es el cero inventado de esta pantalla.
  const filas: FilaLedger[] = (data ?? []).map((r) => ({
    id: r.id as string,
    assetId: r.asset_id as string,
    destination: r.destination as string,
    status: r.status as string,
    externalId: r.external_id as string | null,
    attempts: r.attempts as number,
    createdAt: r.created_at as string,
    publishedAt: r.published_at as string | null,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <HudLabel>13 / PUBLISHING</HudLabel>
      <h1 className="mt-3 display-h text-3xl">Publication ledger</h1>

      {error ? (
        <div
          data-testid="ledger-ilegible"
          className="mt-6 rounded-vulkan border border-red-900/60 bg-red-950/30 p-4 text-[12px] text-red-200"
        >
          <p>No se pudo leer el ledger, así que esta pantalla no sabe si hay publicaciones o no.</p>
          <p className="mt-2 text-red-100">
            Esto NO significa que no haya ninguna. Hay que reintentar antes de sacar conclusiones.
          </p>
        </div>
      ) : (
        <Ledger filas={filas} />
      )}
    </div>
  );
}
