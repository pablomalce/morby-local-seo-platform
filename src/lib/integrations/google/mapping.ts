/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla de mapeo acepte un identificador que la base va a rechazar, y
 * —lo que es peor— que lo ARREGLE sola hasta que entre.
 *
 * La `0017` guarda el `property_ref` con un CHECK de forma y una unicidad GLOBAL
 * sobre `(provider, lower(property_ref))`. Las dos juntas son lo único que impide
 * que dos organizaciones queden apuntadas a la misma property de Google, que con
 * un token de agencia es un cliente viendo los números de otro. La unicidad sólo
 * significa algo si la forma es única: `123456` y `properties/123456` son la
 * misma property para Google y dos filas distintas para PostgreSQL, así que la
 * fuga entra por la ortografía.
 *
 * POR QUÉ ESTO NO NORMALIZA, Y NO ES PEREZA
 *
 * La tentación es agregarle la barra final a `https://ejemplo.com`, que es lo
 * que un humano escribe siempre y ninguna respuesta de Search Console produce.
 * Reparar un identificador es convertir un valor que el operador NO copió en uno
 * que pasa: si se equivocó de sitio, el arreglo le confirma que estaba bien.
 *
 * El único arreglo que se hace es recortar los espacios de los extremos, porque
 * ningún identificador de Google los tiene y un pegado del portapapeles los trae.
 * Todo lo demás se rechaza diciendo qué forma se esperaba.
 *
 * ESTE ARCHIVO NO ES LA BARRERA
 *
 * La barrera es el CHECK de la `0017`, y sigue siéndolo: el servidor inserta y la
 * base decide. Esto existe para que el operador reciba «se esperaba
 * properties/N» en vez del texto de un error de PostgreSQL, y para que la
 * pantalla pueda decirlo antes de escribir. Si los dos se separan, gana la base
 * y el que está mal es este archivo.
 */

import type { GoogleSurface } from "./sources";

/**
 * La forma canónica de cada superficie, EXACTAMENTE como la escribe el CHECK
 * `integration_properties_ref_shape_check` de la `0017`.
 *
 * Dos correspondencias que hay que leer despacio, porque son donde esto se
 * separa de la base sin que nada avise:
 *
 *   - PostgreSQL escribe `[^[:space:]]`, que en JavaScript es `\S`. Son la misma
 *     clase.
 *   - El operador `~` de PostgreSQL distingue mayúsculas, así que
 *     `sc-domain:Ejemplo.com` lo rechaza la base. Estas expresiones van SIN la
 *     bandera `i` por eso mismo: con ella este archivo aceptaría un valor que el
 *     INSERT rebota, que es la separación al revés y la más confusa de las dos.
 */
const FORMA: Record<GoogleSurface, RegExp> = {
  ga4: /^properties\/[0-9]+$/,
  search_console: /^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+\/)$/,
  google_business_profile: /^locations\/[0-9]+$/,
};

/**
 * El patrón de una superficie, como texto.
 *
 * Existe para que se pueda CLAVAR con un literal escrito. `supabase/qa/forma_canonica.sql`
 * clava el mismo literal contra `pg_get_constraintdef()` del lado de la base, así
 * que cambiar una de las dos mitades sola pone algo en rojo. Sin este par, las
 * dos se separan y el síntoma es un INSERT rebotado en producción con un texto
 * de PostgreSQL en la cara del operador.
 */
export function patronDe(surface: GoogleSurface): string {
  return FORMA[surface].source;
}

/** Qué forma se esperaba, para poder decírselo al operador. */
export const FORMA_ESPERADA: Record<GoogleSurface, string> = {
  ga4: "properties/N",
  search_console: "https://sitio/ (con la barra final) o sc-domain:host",
  google_business_profile: "locations/N",
};

export type PropertyRefRechazo =
  /** No se escribió nada, o sólo espacios. */
  | "vacio"
  /** La superficie no es una de las tres del vocabulario de la 0017. */
  | "superficie-desconocida"
  /** Se escribió algo y no tiene la forma que esa superficie exige. */
  | "forma";

export type PropertyRefValidacion =
  | { ok: true; propertyRef: string }
  | { ok: false; rechazo: PropertyRefRechazo };

/**
 * Si un `property_ref` escrito a mano puede llegar a la base.
 *
 * `surface` entra como `string` y no como `GoogleSurface` a propósito: lo que
 * llega de un formulario es texto, y tipar la entrada como si ya estuviera
 * validada es cómo un `provider` inventado llega hasta el INSERT. El CHECK de la
 * `0017` termina con `ELSE false` por el mismo motivo.
 */
export function validarPropertyRef(surface: string, crudo: string): PropertyRefValidacion {
  const forma = FORMA[surface as GoogleSurface];
  if (!forma) return { ok: false, rechazo: "superficie-desconocida" };

  const propertyRef = crudo.trim();
  if (propertyRef === "") return { ok: false, rechazo: "vacio" };

  if (!forma.test(propertyRef)) return { ok: false, rechazo: "forma" };

  return { ok: true, propertyRef };
}
