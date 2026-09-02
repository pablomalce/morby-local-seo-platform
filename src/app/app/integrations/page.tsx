import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, HudLabel, PageHeader } from "@/components/ui";
import { viewForOrganization } from "@/lib/integrations/google/screen";
import { agencyTokenState } from "@/lib/integrations/google/agencyToken";
import {
  type GoogleSurface,
  type PropertyMapping,
  platformIsConnected,
} from "@/lib/integrations/google/sources";
import type { SondaVista } from "@/lib/integrations/google/probeView";
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
 * DE DÓNDE SALE EL ESTADO DEL TOKEN
 *
 * Hay UNA fila de token, la de la organización de Vulkan, y cuál organización
 * es ésa lo dice `VULKAN_AGENCY_ORG_ID`. `agencyTokenState()` resuelve las dos
 * mitades —a quién preguntarle y en qué estado está— y devuelve una de siete
 * palabras; esta pantalla no decide ninguna, sólo la pasa.
 *
 * Se pide UNA vez para todas las organizaciones y no una por cliente: el token
 * es de la plataforma, así que consultarlo por cliente daría la misma respuesta
 * N veces y sugeriría, a quien lea este archivo, que es un dato por cliente.
 */

/** Una fila de `integration_probe`, tal como vuelve de la base. */
interface ProbeRow {
  organization_id: string;
  provider: string;
  outcome: string;
  http_status: number | null;
  property_ref: string;
  checked_at: string;
}

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

  // La última respuesta de Google por superficie, de la 0022. Es lo que convierte
  // un `error` en algo accionable: sin esto, la pantalla dice que falló y el
  // motivo vive en un log que en el plan Hobby dura minutos.
  //
  // Se lee con el cliente de SESIÓN y no con el admin, a diferencia del estado
  // del token: esto SÍ es un dato por cliente, y la RLS de la 0022 es justamente
  // la que impide que alguien vea contra qué property consulta otro.
  const { data: probeRows } = orgIds.length
    ? await supabase
        .from("integration_probe")
        .select("organization_id, provider, outcome, http_status, property_ref, checked_at")
        .in("organization_id", orgIds)
    : { data: [] as ProbeRow[] };

  const sondasPorOrganizacion = new Map<string, SondaVista[]>();
  for (const row of (probeRows ?? []) as ProbeRow[]) {
    const lista = sondasPorOrganizacion.get(row.organization_id) ?? [];
    lista.push({
      surface: row.provider as GoogleSurface,
      outcome: row.outcome,
      httpStatus: row.http_status,
      propertyRef: row.property_ref,
      checkedAt: row.checked_at,
    });
    sondasPorOrganizacion.set(row.organization_id, lista);
  }

  const organizaciones = (orgRows ?? []) as Organizacion[];
  const plataformaConectada = platformIsConnected();
  const estadoDelToken = await agencyTokenState();

  return (
    <>
      <PageHeader
        eyebrow="12 / INTEGRATIONS"
        frame="GOOGLE · PER ORGANIZATION"
        title="Google integrations"
        description="One agency token, one mapping per client. The mapping is what separates one client's numbers from another's."
      />

      <PlatformNotice connected={plataformaConectada} tokenState={estadoDelToken} />

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
                estadoDelToken
              )}
              probes={sondasPorOrganizacion.get(org.id) ?? []}
            />
          ))}
        </div>
      )}
    </>
  );
}
