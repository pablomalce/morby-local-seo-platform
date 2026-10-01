import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HudLabel } from "@/components/ui";
import { EnsayoDePublicacion, Ledger } from "./client";
import type { FilaLedger } from "@/lib/publishing/ledgerView";
import type { AssetEnsayable } from "@/lib/publishing/ensayoVisto";
import { organizacionActiva } from "@/lib/org/servidor";

export const dynamic = "force-dynamic";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que lo único que sepa qué reservó o publicó la plataforma sea una consulta SQL,
 * y que el ENSAYO sólo se pueda disparar con `curl`.
 *
 * Hasta el 2026-09-26 esta pantalla era de sólo lectura: `POST
 * /api/publishing/rehearse` existía, tenía once tests, y ninguna pantalla lo
 * llamaba. Es el mismo defecto que el transporte huérfano, un nivel más arriba.
 * El bloque de ensayo vive en ESTA pantalla y no en otra porque el resultado de
 * un ensayo es una fila de este ledger.
 *
 * SE LEE COMO EL USUARIO, Y ESO ES LA MITAD DEL DISEÑO
 *
 * Con el cliente de sesión y no con el admin, las DOS consultas. La RLS de la
 * `0016` —una permisiva y una RESTRICTIVE— y la de la `0014` sobre
 * `content_assets` ya dicen qué filas alcanza cada quien, así que esta pantalla
 * no necesita ningún privilegio nuevo y tampoco escribe una comprobación de
 * membresía propia: sería una COPIA de la RLS, y una copia diverge.
 *
 * `GRANT SELECT ON public.publications TO authenticated` está en la `0016`.
 * Nada que aplicar.
 *
 * QUÉ CUENTA COMO APROBADO, Y POR QUÉ NO SE MIDE ACÁ
 *
 * `approved_hash IS NOT NULL`, el mismo predicado literal de `dashboard/page.tsx`
 * y el mismo que la ruta comprueba. No se filtra por `status` —tres de sus siete
 * palabras implican aprobación y el CHECK de la `0015` las ata al sello, así que
 * el sello es la columna que decide— ni se compara el sello con `payload_hash`:
 * el CHECK de la `0015` ya lo prohíbe y la FK compuesta de la `0016` rechaza el
 * sello viejo con 409 `no-aprobado`. Si el texto cambia mientras la pantalla está
 * abierta, el asset desaparece de la lista al refrescar y la carrera la cubre ese
 * 409.
 */
export default async function PublishingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirectTo=/app/publishing");

  // Una sola fuente para «cuál es el cliente activo». Ver `@/lib/org/servidor`.
  const organizacion = await organizacionActiva();

  // Sin organización activa no hay ledger de nadie, y antes esta pantalla
  // dibujaba el ledger VACÍO: el cero inventado más caro de acá, porque se lee
  // como «este cliente no publicó nada». Se dice, igual que en `content`.
  if (!organizacion) {
    return (
      <div className="mx-auto max-w-3xl">
        <HudLabel>13 / PUBLISHING</HudLabel>
        <p className="mt-6 text-[13px] text-metal-300" data-testid="sin-organizacion">
          Esta cuenta no tiene ninguna organización activa, así que esta pantalla no sabe de quién
          sería el ledger. No es un ledger vacío.
        </p>
      </div>
    );
  }

  // Se filtra por la organización ACTIVA además de la RLS, y no es una copia: la
  // RLS dice qué filas ALCANZA el usuario —todos sus clientes— y esta pantalla
  // muestra UNO. Sin el filtro, una agencia con diez clientes vería las diez
  // listas mezcladas en la pantalla de uno.
  const [ledgerRes, aprobadosRes] = await Promise.all([
    supabase
      .from("publications")
      .select("id, asset_id, destination, status, external_id, attempts, created_at, published_at")
      .eq("organization_id", organizacion.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("content_assets")
      .select("id, title, kind, locale")
      .eq("organization_id", organizacion.id)
      .not("approved_hash", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  // Un fallo de lectura NO es un ledger vacío. Decir «no hay publicaciones»
  // cuando la consulta falló es el cero inventado de esta pantalla.
  const filas: FilaLedger[] = (ledgerRes.data ?? []).map((r) => ({
    id: r.id as string,
    assetId: r.asset_id as string,
    destination: r.destination as string,
    status: r.status as string,
    externalId: r.external_id as string | null,
    attempts: r.attempts as number,
    createdAt: r.created_at as string,
    publishedAt: r.published_at as string | null,
  }));

  const aprobados: AssetEnsayable[] = (aprobadosRes.data ?? []).map((r) => ({
    id: r.id as string,
    // `title` es nullable en la `0001`: la etiqueta cae a `kind`.
    title: (r.title as string | null) ?? null,
    kind: r.kind as string,
    locale: r.locale as string,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <HudLabel>13 / PUBLISHING</HudLabel>
      <h1 className="mt-3 display-h text-3xl">Publication ledger</h1>

      {/* Y lo mismo del otro lado: «no hay aprobados» y «no se pudo saber si hay
          aprobados» no son lo mismo. El segundo no puede ofrecer un selector. */}
      {aprobadosRes.error ? (
        <div
          data-testid="aprobados-ilegibles"
          className="mt-6 rounded-vulkan border border-red-900/60 bg-red-950/30 p-4 text-[12px] text-red-200"
        >
          <p>
            No se pudo leer el contenido aprobado, así que esta pantalla no sabe si hay algo que
            ensayar y no ofrece un botón que no podría funcionar.
          </p>
          <p className="mt-2 text-red-100">
            Esto NO significa que no haya contenido aprobado. Hay que reintentar.
          </p>
        </div>
      ) : (
        <EnsayoDePublicacion aprobados={aprobados} />
      )}

      {ledgerRes.error ? (
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
