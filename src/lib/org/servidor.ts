import "server-only";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COOKIE_ORG_ACTIVA, elegirOrganizacion } from "./eleccion";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que cada pantalla de `/app` resuelva la organización activa por su cuenta.
 *
 * Son cuatro pantallas y crecen. Cuatro copias del mismo criterio divergen en
 * cuanto una agregue una regla —la que sea— y entonces dos pantallas de la misma
 * sesión muestran clientes distintos, que es peor que no tener selector.
 */

export interface OrganizacionActiva {
  id: string;
  name: string;
  /** Todas las que el usuario puede elegir, para dibujar el selector. */
  disponibles: { id: string; name: string }[];
}

/**
 * La organización activa del usuario, o `null` si no tiene ninguna ACTIVA.
 *
 * `null` es un resultado y no un hueco: «no tiene organización» no es lo mismo
 * que «su organización está vacía», y las pantallas dicen cosas distintas.
 */
export async function organizacionActiva(): Promise<OrganizacionActiva | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("org_members")
    .select("organization_id, role, state")
    .eq("user_id", user.id);

  const activas = (memberships ?? []) as {
    organization_id: string;
    role: string | null;
    state: string | null;
  }[];

  const almacen = await cookies();
  const elegida = almacen.get(COOKIE_ORG_ACTIVA)?.value ?? null;
  const id = elegirOrganizacion(activas, elegida);
  if (!id) return null;

  const idsActivos = activas
    .filter((m) => (m.state ?? "active") === "active")
    .map((m) => m.organization_id);

  const { data: orgRows } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", idsActivos)
    .order("name");

  const disponibles = (orgRows ?? []) as { id: string; name: string }[];
  const actual = disponibles.find((o) => o.id === id);
  // Si la elegida no aparece entre las organizaciones legibles, la RLS decidió
  // que no se ve. Devolver su id igual dibujaría un encabezado con un nombre
  // vacío y consultas que no traen nada.
  if (!actual) return null;

  return { id: actual.id, name: actual.name, disponibles };
}
