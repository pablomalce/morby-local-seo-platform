/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un payload firmado pero mal formado llegue a la base y falle allá.
 *
 * La firma dice QUIÉN mandó esto; no dice que el cuerpo tenga sentido. Un
 * productor con un bug manda tan firmado como uno sin bug, y lo que llega a
 * `ingest_lead_won` son doce argumentos que la función mete en cinco tablas con
 * `service_role`: sin esta capa, un `slug` vacío se convierte en una violación de
 * CHECK a 200 ms de distancia, y lo que el productor recibe es un 500 que va a
 * reintentar para siempre.
 *
 * LO QUE SE VALIDA Y LO QUE NO
 *
 * Se valida la FORMA: que los campos estén, que sean del tipo que dicen, y que
 * los slugs cumplan el dominio canónico que la `0018` exige. No se valida la
 * unicidad ni nada que dependa del estado de la base — eso es de la base, y
 * comprobarlo acá sería un `if` donde hay una restricción.
 *
 * LOS OPCIONALES VIAJAN COMO `""`, NUNCA COMO `null`
 *
 * Es cláusula del contrato y tiene un motivo: las columnas canónicas son
 * `NOT NULL DEFAULT ''`, y casi todas son opcionales en un Lead, así que el caso
 * COMÚN es el que un `null` haría rebotar. Se acepta que falte la clave y se
 * acepta `""`; se rechaza `null` explícito, porque un `null` donde el contrato
 * dice `""` es un productor que se apartó del contrato y conviene que se entere.
 */

/** El dominio de slug del canónico, el mismo que el CHECK de la `0018`. */
const SLUG = /^[a-z0-9]([a-z0-9-]{1,60}[a-z0-9])$/;
/** ISO 3166-1 alpha-2 en mayúsculas, o vacío. Igual que el CHECK de `contacts`. */
const PAIS = /^([A-Z]{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** El único evento que este endpoint acepta. Literal: es contrato con el otro repo. */
export const EVENTO = "lead.won";

export interface LeadWon {
  sourceSystem: string;
  idempotencyKey: string;
  /** El id del CLIENTE, o null si nadie lo vinculó todavía. */
  orgId: string | null;
  orgName: string;
  orgSlug: string;
  orgLocale: string;
  businessName: string;
  businessSlug: string;
  businessWebsite: string;
  businessIndustry: string;
  location: {
    label: string;
    address_line: string;
    city: string;
    region: string;
    country: string;
    postal_code: string;
  };
  contact: {
    display_name: string;
    email: string;
    phone: string;
    website: string;
    source: string;
  };
}

export type ParseResult =
  | { ok: true; value: LeadWon }
  /** `campo` nombra QUÉ estaba mal, para que el productor pueda arreglarlo. */
  | { ok: false; campo: string };

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Un texto opcional del contrato.
 *
 * Ausente vale `""`; `""` vale `""`; `null` NO — ver el encabezado.
 */
function opcional(fuente: Record<string, unknown>, clave: string): string | null {
  const v = fuente[clave];
  if (v === undefined) return "";
  return typeof v === "string" ? v : null;
}

/** Un texto obligatorio y no vacío. */
function requerido(fuente: Record<string, unknown>, clave: string): string | null {
  const v = fuente[clave];
  return typeof v === "string" && v !== "" ? v : null;
}

export function parseLeadWon(cuerpo: unknown): ParseResult {
  const raiz = obj(cuerpo);
  if (!raiz) return { ok: false, campo: "body" };

  // El evento se comprueba acá aunque la cabecera también lo diga: la cabecera
  // NO está firmada y el cuerpo sí. Un endpoint que decide qué hacer según un
  // dato sin firmar hace lo que le pidan.
  if (raiz.event !== EVENTO) return { ok: false, campo: "event" };

  const source = obj(raiz.source);
  if (!source) return { ok: false, campo: "source" };
  const sourceSystem = requerido(source, "system");
  if (!sourceSystem) return { ok: false, campo: "source.system" };
  const idempotencyKey = requerido(source, "idempotency_key");
  if (!idempotencyKey) return { ok: false, campo: "source.idempotency_key" };

  const organization = obj(raiz.organization);
  if (!organization) return { ok: false, campo: "organization" };

  // `org_id` no nulo quiere decir ADOPTAR ese id, que es el mismo que usa Vulkan
  // OS. Un uuid mal formado no se puede adoptar y acuñar uno en su lugar sería
  // romper esa igualdad en silencio, así que se rechaza.
  const orgIdCrudo = organization.org_id;
  let orgId: string | null = null;
  if (orgIdCrudo !== null && orgIdCrudo !== undefined) {
    if (typeof orgIdCrudo !== "string" || !UUID.test(orgIdCrudo)) {
      return { ok: false, campo: "organization.org_id" };
    }
    orgId = orgIdCrudo;
  }

  const orgName = requerido(organization, "display_name");
  if (!orgName) return { ok: false, campo: "organization.display_name" };
  const orgSlug = requerido(organization, "slug");
  if (!orgSlug || !SLUG.test(orgSlug)) return { ok: false, campo: "organization.slug" };
  const orgLocale = requerido(organization, "default_locale") ?? "en";

  const business = obj(raiz.business);
  if (!business) return { ok: false, campo: "business" };
  const businessName = requerido(business, "name");
  if (!businessName) return { ok: false, campo: "business.name" };
  const businessSlug = requerido(business, "slug");
  if (!businessSlug || !SLUG.test(businessSlug)) return { ok: false, campo: "business.slug" };
  const businessWebsite = opcional(business, "website");
  if (businessWebsite === null) return { ok: false, campo: "business.website" };
  const businessIndustry = opcional(business, "industry");
  if (businessIndustry === null) return { ok: false, campo: "business.industry" };

  // `locations` es un arreglo de UNA entrada. El plural es headroom del receptor,
  // no una promesa del productor: el Lead Engine sólo conoce una dirección. Se
  // toma la primera y se ignoran las demás en vez de rechazar, porque el día que
  // mande dos, perder la segunda es mejor que perder el cliente entero.
  const locations = raiz.locations;
  if (!Array.isArray(locations) || locations.length === 0) {
    return { ok: false, campo: "locations" };
  }
  const loc = obj(locations[0]);
  if (!loc) return { ok: false, campo: "locations[0]" };

  const location = {
    label: opcional(loc, "label") || "Main",
    address_line: opcional(loc, "address_line"),
    city: opcional(loc, "city"),
    region: opcional(loc, "region"),
    country: opcional(loc, "country"),
    postal_code: opcional(loc, "postal_code"),
  };
  for (const [k, v] of Object.entries(location)) {
    if (v === null) return { ok: false, campo: `locations[0].${k}` };
  }
  if (!PAIS.test(location.country as string)) {
    return { ok: false, campo: "locations[0].country" };
  }

  const contactoCrudo = obj(raiz.contact);
  if (!contactoCrudo) return { ok: false, campo: "contact" };
  const contact = {
    display_name: opcional(contactoCrudo, "display_name"),
    email: opcional(contactoCrudo, "email"),
    phone: opcional(contactoCrudo, "phone"),
    website: opcional(contactoCrudo, "website"),
    source: opcional(contactoCrudo, "source"),
  };
  for (const [k, v] of Object.entries(contact)) {
    if (v === null) return { ok: false, campo: `contact.${k}` };
  }

  return {
    ok: true,
    value: {
      sourceSystem,
      idempotencyKey,
      orgId,
      orgName,
      orgSlug,
      orgLocale,
      businessName,
      businessSlug,
      businessWebsite,
      businessIndustry,
      location: location as LeadWon["location"],
      contact: contact as LeadWon["contact"],
    },
  };
}
