import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HudLabel } from "@/components/ui";
import { ProductoResumen, type NegocioResumen } from "./client";
import { SelectorDeOrganizacion } from "@/components/SelectorDeOrganizacion";
import { AvisosDeEscala } from "@/components/AvisosDeEscala";
import { organizacionActiva } from "@/lib/org/servidor";
import type { EstadoDelProducto } from "@/lib/product/proximoPaso";

export const dynamic = "force-dynamic";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que el producto no tenga lugar propio.
 *
 * `DESTINO_POST_LOGIN` era `/dashboard`, que es la demo pública con los
 * servicios sembrados de Mörby: el login depositaba al usuario DENTRO de la
 * demostración. El #75 puso una marca para que se supiera cuál se estaba
 * mirando, y dejó dicho que no cerraba esta decisión. Ésta la cierra.
 *
 * NO IMPORTA NADA DE `@/lib/mock`, Y ESO ES LA MITAD DEL PUNTO
 *
 * Todo lo que se dibuja acá sale de la base leída COMO EL USUARIO. Si esta
 * pantalla no tiene datos, dice que no los tiene; no los rellena con un negocio
 * sembrado. `page.test.ts` es la pared sobre eso.
 *
 * SE LEE COMO EL USUARIO
 *
 * La RLS decide qué filas alcanza cada quien, así que no hay ninguna
 * comprobación de membresía escrita acá: sería una copia de la RLS.
 */
export default async function ProductDashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirectTo=/app/dashboard");

  // La organización activa la resuelve UN solo lugar. Cuatro pantallas con cuatro
  // copias del criterio divergen en cuanto una agregue una regla, y entonces dos
  // pantallas de la misma sesión muestran clientes distintos.
  const organizacion = await organizacionActiva();

  // Sin organización activa no hay nada que contar, y contarlo igual daría ceros
  // que se leen como «no falta nada».
  if (!organizacion) {
    return (
      <div className="mx-auto max-w-3xl">
        <HudLabel>00 / PRODUCT</HudLabel>
        <h1 className="mt-3 display-h text-3xl">Your organization</h1>
        <p className="mt-6 text-[13px] text-metal-300" data-testid="sin-organizacion">
          Esta cuenta no tiene ninguna organización activa. Sin eso no hay nada que mostrar — y no
          es lo mismo que una organización vacía.
        </p>
      </div>
    );
  }

  const [negociosRes, mapeosRes, sondasRes, reportesRes, aprobadosRes, publicacionesRes] =
    await Promise.all([
      supabase.from("businesses").select("id, name").eq("organization_id", organizacion.id),
      supabase
        .from("integration_properties")
        .select("provider")
        .eq("organization_id", organizacion.id)
        .is("unmapped_at", null),
      supabase.from("integration_probe").select("provider, outcome").eq("organization_id", organizacion.id),
      supabase.from("reports").select("id").eq("organization_id", organizacion.id),
      supabase
        .from("content_assets")
        .select("id")
        .eq("organization_id", organizacion.id)
        .not("approved_hash", "is", null),
      supabase.from("publications").select("id").eq("organization_id", organizacion.id),
    ]);

  const negociosBase = (negociosRes.data ?? []) as { id: string; name: string }[];
  const idsNegocios = negociosBase.map((b) => b.id);

  const [ubicacionesRes, serviciosRes] = idsNegocios.length
    ? await Promise.all([
        supabase.from("business_locations").select("business_id").in("business_id", idsNegocios),
        supabase.from("business_services").select("business_id").in("business_id", idsNegocios),
      ])
    : [{ data: [] as { business_id: string }[] }, { data: [] as { business_id: string }[] }];

  const contar = (filas: { business_id: string }[] | null, id: string) =>
    (filas ?? []).filter((f) => f.business_id === id).length;

  const negocios: NegocioResumen[] = negociosBase.map((b) => ({
    id: b.id,
    nombre: b.name,
    ubicaciones: contar(ubicacionesRes.data as { business_id: string }[] | null, b.id),
    servicios: contar(serviciosRes.data as { business_id: string }[] | null, b.id),
  }));

  // La última sonda por proveedor, no todas: una sonda de ayer que falló y otra
  // de hoy que anduvo son la misma fuente, y contarlas juntas diría que algo
  // está fallando cuando ya se arregló.
  const ultimaPorProveedor = new Map<string, string>();
  for (const s of (sondasRes.data ?? []) as { provider: string; outcome: string }[]) {
    ultimaPorProveedor.set(s.provider, s.outcome);
  }

  const estado: EstadoDelProducto = {
    negocios: negocios.length,
    mapeos: (mapeosRes.data ?? []).length,
    fuentesFallando: [...ultimaPorProveedor.values()].filter((o) => o !== "ok").length,
    reportes: (reportesRes.data ?? []).length,
    contenidoAprobado: (aprobadosRes.data ?? []).length,
    publicaciones: (publicacionesRes.data ?? []).length,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <HudLabel>00 / PRODUCT</HudLabel>
      <h1 className="mt-3 display-h text-3xl">{organizacion.name}</h1>
      <SelectorDeOrganizacion actual={organizacion.id} disponibles={organizacion.disponibles} />
      {/*
        La cantidad de CLIENTES sale de las organizaciones que el usuario puede
        elegir, que es lo mismo que cuenta el selector. Un segundo conteo
        divergiría del primero en cuanto uno de los dos cambie de criterio.
      */}
      <AvisosDeEscala clientes={organizacion.disponibles.length} />
      <ProductoResumen organizacion={organizacion.name} negocios={negocios} estado={estado} />
    </div>
  );
}
