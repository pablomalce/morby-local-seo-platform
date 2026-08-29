import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, HudLabel, PageHeader } from "@/components/ui";
import {
  type AgencyTokenState,
  viewForOrganization,
} from "@/lib/integrations/google/screen";
import {
  type GoogleSurface,
  type PropertyMapping,
  platformIsConnected,
} from "@/lib/integrations/google/sources";
import { OrganizationIntegrations, PlatformNotice } from "./client";

export const dynamic = "force-dynamic";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que operar el mapeo de propiedades sea entrar a la base a mano.
 *
 * Con un token de agencia, el mapeo es la frontera entre clientes: si se
 * equivoca, el reporte de un cliente muestra los datos de otro. Hacer eso con un
 * INSERT escrito a mano contra producción es la manera más cara posible de
 * cometer un error de tipeo.
 *
 * POR QUÉ EL ESTADO DEL TOKEN ENTRA COMO `"undecided"`
 *
 * Porque hay UNA fila de token —la de la organización de Vulkan— y ninguna
 * columna dice cuál organización es ésa. Leer el token de la organización del
 * cliente aplicaría el modelo viejo y diría «sin token» para todos, para
 * siempre: la respuesta correcta por el motivo equivocado. Ver
 * `ESPINA_VULKAN.md`, «El modelo de acceso a Google».
 *
 * Este es el ÚNICO lugar donde ese valor se escribe. El día que la decisión
 * exista, se reemplaza esta línea por la consulta y nada más de la pantalla
 * cambia.
 */
const ESTADO_DEL_TOKEN: AgencyTokenState = "undecided";

interface Organizacion {
  id: string;
  name: string;
  slug: string;
}

export default async function IntegrationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirectTo=/app/integrations");

  const { data: memberships } = await supabase
    .from("org_members")
    .select("organization_id")
    .eq("user_id", user.id);

  const orgIds = (memberships ?? []).map((m) => m.organization_id as string);

  const { data: orgRows } = orgIds.length
    ? await supabase.from("organizations").select("id, name, slug").in("id", orgIds)
    : { data: [] as Organizacion[] };

  // Los mapeos VIVOS de todas las organizaciones del usuario, en una consulta.
  // `unmapped_at IS NULL` va escrito aunque el índice único sólo alcance a los
  // vivos: el índice impide que haya DOS vivos, no que se lea uno muerto — y un
  // mapeo muerto en pantalla le atribuye a un cliente una property que ya no es
  // suya.
  const { data: mappingRows } = orgIds.length
    ? await supabase
        .from("integration_properties")
        .select("organization_id, provider, property_ref")
        .in("organization_id", orgIds)
        .is("unmapped_at", null)
    : { data: [] as { organization_id: string; provider: string; property_ref: string }[] };

  const porOrganizacion = new Map<string, PropertyMapping[]>();
  for (const row of mappingRows ?? []) {
    const lista = porOrganizacion.get(row.organization_id as string) ?? [];
    lista.push({
      provider: row.provider as GoogleSurface,
      propertyRef: row.property_ref as string,
    });
    porOrganizacion.set(row.organization_id as string, lista);
  }

  const organizaciones = (orgRows ?? []) as Organizacion[];
  const plataformaConectada = platformIsConnected();

  return (
    <>
      <PageHeader
        eyebrow="12 / INTEGRATIONS"
        frame="GOOGLE · PER ORGANIZATION"
        title="Google integrations"
        description="One agency token, one mapping per client. The mapping is what separates one client's numbers from another's."
      />

      <PlatformNotice connected={plataformaConectada} tokenState={ESTADO_DEL_TOKEN} />

      {organizaciones.length === 0 ? (
        <Card className="mt-6">
          <HudLabel>NO ORGANIZATIONS</HudLabel>
          <p className="mt-2 text-[13px] text-metal-300">
            This account is not a member of any organization yet.
          </p>
        </Card>
      ) : (
        <div className="mt-6 space-y-6">
          {organizaciones.map((org) => (
            <OrganizationIntegrations
              key={org.id}
              organizationId={org.id}
              organizationName={org.name}
              organizationSlug={org.slug}
              surfaces={viewForOrganization(
                porOrganizacion.get(org.id) ?? [],
                ESTADO_DEL_TOKEN
              )}
            />
          ))}
        </div>
      )}
    </>
  );
}
