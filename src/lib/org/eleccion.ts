/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la organización activa la elija un desempate, cuando el modelo del negocio
 * exige que la elija una persona.
 *
 * POR QUÉ ESTO DEJÓ DE SER UN CASO BORDE
 *
 * Medido sobre el esquema el 2026-09-06:
 *
 *     integration_properties_one_live_per_provider  UNIQUE (organization_id, provider)
 *     integration_properties_one_org_per_property   UNIQUE (provider, lower(property_ref))
 *
 * O sea: UNA property de GA4 por organización, y una property pertenece a UNA
 * sola organización. Entonces «un cliente = un negocio dentro de la agencia» es
 * imposible — los clientes compartirían una property y la garantía que separa
 * sus números se caería. **Un cliente es su propia organización**, y Vulkan
 * Studios es la agencia que tiene el token.
 *
 * Con eso, tener varias membresías activas deja de ser una anomalía y pasa a ser
 * el caso NORMAL: una por cliente. Y el desempate por uuid, que era correcto como
 * default determinista, se vuelve una trampa: siempre caés en el cliente del uuid
 * más chico y no hay manera de moverse. Se resolvió a mano dos veces archivando
 * organizaciones —la #69 con una cuenta y el 2026-09-05 con la otra— que es un
 * arreglo de datos para un hueco de producto.
 *
 * LA ELECCIÓN NO REEMPLAZA AL ORDEN: LO PISA CUANDO ES VÁLIDA
 *
 * Una elección que ya no corresponde —la membresía se archivó, o alguien escribió
 * la cookie a mano— NO es un error: se ignora y se cae al orden determinista. La
 * cookie es una preferencia, no un permiso; quien decide qué filas se ven es la
 * RLS, y por eso una elección inventada termina en una organización vacía y no en
 * los datos de otro.
 */

/** Dónde se guarda la elección. Una cookie, para que la lean las pantallas de servidor. */
export const COOKIE_ORG_ACTIVA = "vulkan_org_activa";

export interface MembresiaElegible {
  organization_id: string;
  role?: string | null;
  state?: string | null;
}

const PESO: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/**
 * Las tres reglas del orden, que siguen valiendo como DEFAULT:
 *
 *   1. las archivadas no cuentan. Se filtra acá y no se confía en que la RLS lo
 *      haga: la baja archiva desde la 0013, y un cliente que dependa de que la
 *      policy lo esconda deja de funcionar el día que la policy cambie;
 *   2. `owner` antes que `admin` antes que `member`;
 *   3. a igual rol, el uuid más chico. No es «mejor»: es DETERMINISTA, y eso es
 *      lo único que impide que dos cargas de la misma pantalla elijan distinto.
 */
export function elegirOrganizacion(
  membresias: readonly MembresiaElegible[],
  elegida?: string | null
): string | null {
  const activas = membresias.filter((m) => (m.state ?? "active") === "active");
  if (activas.length === 0) return null;

  // La elección explícita gana, y sólo si sigue siendo una membresía ACTIVA.
  // Comprobarlo acá y no confiar en quien llama es lo que hace que una cookie
  // vieja o inventada no elija nada.
  if (elegida && activas.some((m) => m.organization_id === elegida)) return elegida;

  const ordenadas = [...activas].sort((a, b) => {
    const pa = PESO[a.role ?? ""] ?? 9;
    const pb = PESO[b.role ?? ""] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.organization_id.localeCompare(b.organization_id);
  });

  return ordenadas[0].organization_id;
}
