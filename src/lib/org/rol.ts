import type { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el rol se decida —o no se decida— ruta por ruta.
 *
 * Hasta la puerta H4.1 ninguna ruta miraba `org_members.role`. Aprobar, ensayar,
 * publicar y mapear propiedades preguntaban «¿es miembro?» y nada más, así que un
 * `viewer` —o un cliente, el día que existiera el rol— aprobaba contenido,
 * reservaba en el ledger y apuntaba su organización a otra property. La base
 * tampoco lo miraba: lo midió la 0031.
 *
 * LA BASE NO ALCANZA ACÁ, Y POR ESO HAY UN ARCHIVO
 *
 * El eje de rol de la 0031 frena a quien escribe COMO EL USUARIO. Pero el ledger
 * de publicaciones, el mapeo de propiedades y el token de Google se escriben con
 * `service_role`, que saltea la RLS: ahí la única pregunta por el rol es la que
 * hace la ruta antes de usar esa llave. Esta función es esa pregunta, escrita
 * una vez.
 *
 * SE LEE COMO EL USUARIO, POR EL ARGUMENTO DE SIEMPRE
 *
 * Con el cliente de sesión, igual que `agencyGuard.ts` y `property-actions.ts`:
 * la pregunta es «¿qué rol tiene ESTE usuario?», y hacerla con una llave que lo
 * alcanza todo la contesta siempre que sí. La policy `members_select_self_org`
 * deja leer las membresías de las organizaciones propias.
 *
 * LAS LISTAS, Y DÓNDE MÁS ESTÁN
 *
 * `escribir` y `aprobar` repiten las funciones de la 0031
 * (`current_user_writer_org_ids()` y `current_user_approver_org_ids()`). Dos
 * copias de una regla se separan, así que `rol.test.ts` lee la migración y las
 * compara con estas. `integrar` no tiene copia en la base: las integraciones las
 * escribe sólo el servidor.
 *
 * Y las tres listan los roles que SÍ, no los que no. Un rol nuevo nace sin
 * permiso hasta que alguien lo agregue acá, que es la dirección barata del error.
 */

export const ROLES = ["owner", "admin", "manager", "editor", "viewer", "client"] as const;
export type Rol = (typeof ROLES)[number];

/** Las tres acciones que una ruta decide por rol. */
export type Accion = "escribir" | "aprobar" | "integrar";

/**
 * Quién puede cada una. Decisiones D3 y D4 de la puerta H4.1, tomadas el
 * 2026-10-07; están escritas en el encabezado de la 0031.
 */
export const QUIEN_PUEDE: Readonly<Record<Accion, readonly Rol[]>> = {
  /** D3: el personal que trabaja. Ni `viewer` ni `client`. */
  escribir: ["owner", "admin", "manager", "editor"],
  /** D4: aprobar, ensayar y publicar. El editor escribe pero no sella. */
  aprobar: ["owner", "admin", "manager"],
  /** D4: mapear y desmapear propiedades, conectar Google. */
  integrar: ["owner", "admin"],
};

/** Si un rol, tal como viene de la base, alcanza para una acción. */
export function rolPuede(rol: string | null | undefined, accion: Accion): boolean {
  return (QUIEN_PUEDE[accion] as readonly string[]).includes(rol ?? "");
}

export type Permiso =
  | { ok: true; rol: Rol }
  | {
      ok: false;
      /**
       * `ilegible`: la lectura falló. NO es una negativa de rol ni una membresía:
       * convertir una caída de Supabase en un permiso, o en un «no sos miembro»,
       * manda a arreglar lo que no está roto.
       * `sin-membresia`: no hay fila ACTIVA en esa organización.
       * `rol-insuficiente`: hay fila, y su rol no alcanza.
       */
      motivo: "ilegible" | "sin-membresia" | "rol-insuficiente";
    };

type ClienteDeSesion = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * El permiso de `userId` para `accion` en `organizationId`, leído de su
 * membresía.
 *
 * El estado se mira acá aunque la RLS ya esconda las organizaciones de una
 * membresía archivada: es la misma regla que `elegirOrganizacion()` aplica, y
 * por el mismo motivo — una ruta que dependa de que la policy lo esconda deja de
 * funcionar el día que la policy cambie.
 */
export async function permisoEn(
  supabase: ClienteDeSesion,
  userId: string,
  organizationId: string,
  accion: Accion
): Promise<Permiso> {
  const { data, error } = await supabase
    .from("org_members")
    .select("role, state")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .limit(1);

  if (error || !data) return { ok: false, motivo: "ilegible" };

  const fila = (data as { role?: string | null; state?: string | null }[])[0];
  if (!fila || (fila.state ?? "active") !== "active") return { ok: false, motivo: "sin-membresia" };
  if (!rolPuede(fila.role, accion)) return { ok: false, motivo: "rol-insuficiente" };

  return { ok: true, rol: fila.role as Rol };
}
