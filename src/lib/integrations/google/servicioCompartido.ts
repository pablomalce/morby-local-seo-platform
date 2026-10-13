/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el token de la agencia sirva, en silencio, a quien no tiene con qué
 * pedirlo.
 *
 * El acceso a Google es de agencia (decisión del 2026-08-29, ver `agency.ts`):
 * hay UN token, el de la organización de `VULKAN_AGENCY_ORG_ID`, delegado sobre
 * las properties de todos los clientes. Eso es el servicio compartido de H4.4 y
 * es legítimo. Lo que no lo es —y la Espina lo nombra «el fallback silencioso al
 * token de la agencia»— es la otra mitad de la misma frase: «y si el cliente no
 * tiene nada, usá lo de la agencia». Las dos se escriben casi igual y una de las
 * dos es una fuga entre clientes.
 *
 * LA REGLA, EXACTA
 *
 *   El token de la agencia se usa para la organización X, sobre la property P
 *   de la superficie S, SÓLO SI (X, S, P) es un mapeo VIVO de
 *   `integration_properties` —`organization_id = X`, `provider = S`,
 *   `unmapped_at IS NULL`— y la fila leída dice `organization_id = X`.
 *
 * La base hace el resto, y son DOS migraciones, no una:
 *
 *   - la `0017`: una property viva está mapeada a UNA sola organización
 *     (`(provider, lower(property_ref))` único entre vivos). Alcanza para GA4 y
 *     Business Profile, cuyos identificadores no se contienen entre sí;
 *   - la `0034`: para Search Console NO alcanza. Una propiedad de dominio
 *     (`sc-domain:ejemplo.com`) cubre todos los prefijos de URL de ese dominio y
 *     de sus subdominios, así que `sc-domain:ejemplo.com` en X y
 *     `https://www.ejemplo.com/` en Y son dos textos distintos —la `0017` los
 *     deja vivos a los dos— y la MISMA cuenta de tráfico. Medido el 2026-10-11
 *     en la revisión del #118 sobre una réplica: cuatro organizaciones vivas
 *     sobre el mismo dominio, INSERT 0 4. La `0034` rechaza un mapeo de Search
 *     Console que se solapa con el vivo de OTRA organización.
 *
 * Con las dos, si (X, S, P) es un mapeo vivo, lo que P cubre es de X y de nadie
 * más.
 *
 * Y LA FILA LA LEE ESTE ARCHIVO, NO QUIEN LLAMA
 *
 * Hasta la segunda revisión del #118 la regla recibía las filas del mapeo que le
 * pasaba el llamador, y se creía la organización y que estuvieran vivas. Medido
 * el 2026-10-11 con la suite entera en verde: un módulo de datos nuevo que le
 * pasaba `[{ organizationId: X, provider: "search_console", propertyRef:
 * "sc-domain:..." }]` inventado le conseguía el token de la agencia a X, sin
 * ningún mapeo. Ahora la lectura vive acá, con el cliente de SESIÓN —la RLS de
 * quien llama— y con el filtro adentro: `organization_id = X`, `unmapped_at IS
 * NULL` y, si se pide, `provider = S`. Y cada fila que vuelve se vuelve a
 * mirar entera —organización, superficie, `unmapped_at`— en vez de creérsela al
 * filtro. Quien llama dice DE QUIÉN es el recurso; qué está mapeado lo dice la
 * base.
 *
 * Todo lo demás es el fallback, y falla con motivo:
 *
 *   - X sin ningún mapeo vivo → `not-mapped`, y el token de la agencia NI SE
 *     RESUELVE: no se lee su secreto, no se refresca contra Google, no se le
 *     presta a nadie. Antes se resolvía igual para cada reporte con sesión,
 *     mapeado o no;
 *   - el mapeo de X no se pudo leer → `mapping-unreadable`, y tampoco se
 *     resuelve. No es `not-mapped`: X puede estar mapeada, y decirle «mapeá» la
 *     manda a arreglar lo que está bien. Tampoco se presta «por las dudas»: sin
 *     la fila no hay property que sea de X;
 *   - una fila cuya `organization_id` no es X → se descarta, nunca se sirve. Es
 *     el caso de la agencia leyendo, con sus propias membresías, el mapeo de un
 *     cliente (o un cliente el de la agencia): la RLS deja ver las filas de
 *     TODAS las organizaciones de quien llama, así que un filtro que se pierda
 *     en la consulta mezcla properties sin que nada lo note;
 *   - la agencia NO es un caso especial. Sus propios datos se sirven por SUS
 *     mapeos, igual que los de cualquier cliente — no por ser la agencia. No hay
 *     ningún `if (org === agencia)` en este archivo y no tiene que haberlo.
 *
 * Y EL TOKEN NO SALE DE ACÁ
 *
 * Hasta la cuarta revisión del #118 la regla devolvía el access token como un
 * texto, junto con los mapeos, y la regla de arriba se cumplía porque los dos
 * llamadores de entonces pasaban la organización del recurso y gastaban el
 * token sólo en `mapeos`. Nada los obligaba. Medido el 2026-10-13 con tsc y la
 * pared en verde: un módulo de datos nuevo pedía el servicio para una
 * organización mapeada de quien llama y gastaba el token en la property de una
 * organización SIN mapeo — `fetchSearchConsoleTotals({ accessToken:
 * token.accessToken, propertyRef: cualquiera })`. Un token al portador no sabe
 * para qué se lo pidieron.
 *
 * Ahora lo que sale de acá no es el token: es el ESTADO del token (`{ ok: true
 * }`, o por qué no) y tres consultas que lo usan adentro —Search Console, GA4 y
 * el publicador de la ficha—, cada una atada a los mapeos que leyó esta
 * función:
 *
 *   - una property que no es un mapeo vivo de ESTA organización, de ESA
 *     superficie, no se consulta: Search Console y GA4 contestan
 *     `no-credentials` sin salir a la red, y el publicador no se arma (`null`);
 *   - los mapeos que se devuelven son una copia: cambiarlos no cambia contra qué
 *     compara la consulta;
 *   - el publicador publica sólo una entrada de ESTA organización, en la ficha
 *     mapeada;
 *   - el `fetch` es el del proceso y no se inyecta: un `fetch` de quien llama
 *     vería la cabecera `Authorization`.
 *
 * Y NO HAY OTRO CAMINO AL TOKEN
 *
 * Este archivo es el único llamador de producción de `agencyAccessToken()`, y
 * `src/lib/__tests__/credencialDeLaAgencia.test.ts` lo sostiene con el
 * compilador sobre TODO módulo de `src` (también los `.js`), por archivo Y por
 * símbolo:
 *
 *   - ningún módulo de DATOS alcanza la credencial —la lectura de
 *     `VULKAN_AGENCY_ORG_ID`, o la custodia de la `0021`: las RPC del secreto y
 *     la tabla `integration_tokens`— si se le saca este archivo del medio;
 *   - `agencyAccessToken` y `resolveAccessToken` los usa este archivo y ningún
 *     otro, a través de cualquier reexportación;
 *   - este archivo exporta como valor `servirConLaAgencia` y nada más: una
 *     reexportación del token desde acá pone la pared en rojo;
 *   - los de CONEXIÓN —el OAuth, la pantalla de integraciones, el mapeo y el
 *     guardián del operador— llegan a la credencial sin pasar por acá, y cada
 *     uno usa exactamente las piezas que declara allá, con su razón. Ninguno
 *     usa el token.
 *
 * QUÉ NO DICE
 *
 * No dice que `organizationId` sea la del recurso: eso lo sabe quien llama, que
 * la lee de la base bajo la RLS (el negocio del reporte, el asset que se
 * publica). Lo que sí garantiza es que el token se gasta sólo en mapeos vivos de
 * la organización que se le pasó, y que esa lectura se hace con la RLS de quien
 * llama: una organización de la que no es miembro no tiene mapeos que leer, y
 * entonces tampoco hay token. Un módulo que pida el servicio de una
 * organización suya y ponga lo que vuelve en el reporte de otra mezcla datos que
 * ya podía leer; ése es un defecto de quien llama, no un préstamo del token.
 *
 * No dice nada de tokens PROPIOS de una organización cliente. La `0014` los
 * admite por organización, pero el código no lee ninguno (el callback sólo
 * guarda el de la agencia) y en hosted, medido el 2026-10-11, hay 1 token vivo,
 * de la misma organización que tiene los 2 mapeos vivos. Cuando un cliente
 * conecte su propia cuenta (H3.3, catálogo por organización), su token será otra
 * credencial con su propia regla, no una excepción a ésta.
 */

import { publicadorDeBusinessProfile } from "@/lib/publishing/googleBusinessProfile";
import type { Publicador } from "@/lib/publishing/transport";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type Ga4Result, fetchGa4Totals } from "./ga4";
import { type SearchConsoleResult, fetchSearchConsoleTotals } from "./searchConsole";
import { type TokenUnavailable, agencyAccessToken } from "./tokenStore";
import type { GoogleSurface, PropertyMapping } from "./sources";

/** Una fila de `integration_properties` tal como se lee: CON su organización y su `unmapped_at`. */
interface MapeoLeido {
  organizationId: string;
  provider: GoogleSurface;
  propertyRef: string;
  unmappedAt: string | null;
}

/** La lectura del mapeo falló. Un fallo no es una lista vacía. */
interface MapeoIlegible {
  ilegible: true;
  /** El código del error, nunca el mensaje de PostgreSQL (puede nombrar tablas). */
  detalle: string;
}

/**
 * Por qué la regla NO presta el token de la agencia.
 *
 * No son estados del token —la agencia puede tenerlo perfecto— y por eso no
 * están en `TokenUnavailable`: son la negativa de esta regla, y quien la recibe
 * la muestra como tal (ver `MotivoDeFuente` en `reports/types.ts`).
 */
export type Negativa = "not-mapped" | "mapping-unreadable";

/**
 * Si hay token de la agencia para este servicio, o por qué no. SIN el token:
 * el token no sale de este archivo (ver el encabezado).
 */
export type TokenDelServicio =
  | { ok: true }
  | { ok: false; reason: TokenUnavailable | Negativa; detail: string };

/** Lo que se publica en la ficha. La ficha no: la pone el mapeo. */
export interface Publicacion {
  /** `GOOGLE_BUSINESS_ACCOUNT_ID`: la cuenta de la agencia, una para todos. */
  accountId: string;
  /** El texto aprobado, tal como se selló. */
  cuerpo: string;
}

/** Lo que la regla deja hacer con el token de la agencia, sin entregarlo. */
export interface Servicio {
  /** Los mapeos de ESTA organización, en copia. Nunca uno de otra. */
  mapeos: PropertyMapping[];
  /** Si hay token, o por qué no se presta. Sin el token. */
  token: TokenDelServicio;
  /**
   * Los totales de Search Console de `propertyRef`, SÓLO si es un mapeo vivo de
   * Search Console de esta organización y hay token. Si no, `no-credentials`
   * sin salir a la red.
   */
  searchConsole(propertyRef: string, ahora: Date): Promise<SearchConsoleResult>;
  /** Lo mismo con GA4. */
  ga4(propertyRef: string, ahora: Date): Promise<Ga4Result>;
  /**
   * El publicador de la ficha `locationRef`, SÓLO si es el mapeo vivo de
   * Business Profile de esta organización y hay token; si no, `null`. Publica
   * sólo entradas de esta organización.
   */
  publicadorDeFicha(locationRef: string, publicacion: Publicacion): Publicador | null;
}

export interface OpcionesDelServicio {
  /**
   * Sólo los mapeos de esta superficie. La publicación pide la ficha de Business
   * Profile y nada más: una organización con GA4 mapeado y sin ficha no tiene
   * con qué publicar, y entonces el token tampoco se resuelve.
   */
  superficie?: GoogleSurface;
  /**
   * Dónde se anota una fila descartada. Inyectable por lo mismo que en
   * `hydrate.ts`. No hay nada más inyectable a propósito: ni las filas ni quién
   * resuelve el token. Los tests reemplazan los módulos, no la regla.
   */
  log?: (mensaje: string) => void;
}

/**
 * Los mapeos vivos de `organizationId`, leídos con la RLS de quien llama.
 *
 * `unmapped_at` se lee aunque el filtro lo fije: es lo que deja a la regla
 * comprobar que la fila está viva en vez de creérselo al filtro, igual que
 * `organization_id`. Una excepción del cliente es un fallo de lectura, no una
 * lista vacía.
 */
async function leerMapeos(
  organizationId: string,
  superficie: GoogleSurface | undefined
): Promise<MapeoLeido[] | MapeoIlegible> {
  try {
    const supabase = await createSupabaseServerClient();
    let consulta = supabase
      .from("integration_properties")
      .select("organization_id, provider, property_ref, unmapped_at")
      .eq("organization_id", organizationId);
    if (superficie) consulta = consulta.eq("provider", superficie);
    const { data, error } = await consulta.is("unmapped_at", null);
    if (error) return { ilegible: true, detalle: error.code ?? "sin código" };
    return (data ?? []).map((fila) => ({
      organizationId: fila.organization_id as string,
      provider: fila.provider as GoogleSurface,
      propertyRef: fila.property_ref as string,
      unmappedAt: (fila.unmapped_at as string | null) ?? null,
    }));
  } catch {
    return { ilegible: true, detalle: "excepción del cliente" };
  }
}

/**
 * La regla de arriba, entera, en una llamada.
 *
 * `organizationId` es la organización DEL RECURSO —el negocio del reporte, el
 * asset que se publica—, leída de la base bajo la RLS de quien llama. Nunca la
 * del pedido, y nunca la de la agencia por defecto. `null` es no tener
 * organización (el reporte de demostración): no hay mapeo que sea suyo, así que
 * tampoco hay token, y tampoco se lee nada.
 *
 * Los mapeos los lee esta función. Ver el encabezado: un llamador que pudiera
 * pasarle filas podría inventarlas.
 */
export async function servirConLaAgencia(
  organizationId: string | null,
  opciones: OpcionesDelServicio = {}
): Promise<Servicio> {
  const superficie = opciones.superficie;
  const leidos = organizationId === null ? [] : await leerMapeos(organizationId, superficie);

  const registrar =
    opciones.log ??
    ((mensaje: string) => {
      console.warn(mensaje);
    });

  if ("ilegible" in leidos) {
    const ilegible: TokenDelServicio = {
      ok: false,
      reason: "mapping-unreadable",
      detail: `el mapeo no se pudo leer (${leidos.detalle}): no se sabe si la organización está mapeada, y el token de la agencia no se presta a ciegas`,
    };
    return servicio(organizationId, [], null, ilegible, registrar);
  }

  // Cada fila, entera, contra la regla: de ESTA organización, viva, y de la
  // superficie pedida. Una fila que no lo es no puede llegar si la consulta
  // filtra, que es lo que hace `leerMapeos`. Si llega, un filtro se perdió: se
  // anota y se descarta. Lo que NO se hace es servirla, ni «arreglarla».
  const ajenas = leidos.filter((m) => m.organizationId !== organizationId).length;
  const muertas = leidos.filter((m) => m.organizationId === organizationId && m.unmappedAt !== null).length;
  const deOtraSuperficie = leidos.filter(
    (m) => m.organizationId === organizationId && m.unmappedAt === null && superficie !== undefined && m.provider !== superficie
  ).length;
  const propios = leidos.filter(
    (m) =>
      organizationId !== null &&
      m.organizationId === organizationId &&
      m.unmappedAt === null &&
      (superficie === undefined || m.provider === superficie)
  );

  if (ajenas > 0) {
    registrar(`[google] ${ajenas} mapeo(s) de otra organización descartado(s): el token de la agencia no los sirve`);
  }
  if (muertas > 0) {
    registrar(`[google] ${muertas} mapeo(s) desmapeado(s) descartado(s): el historial no se sirve`);
  }
  if (deOtraSuperficie > 0) {
    registrar(`[google] ${deOtraSuperficie} mapeo(s) de otra superficie descartado(s): se pidió ${superficie}`);
  }

  // La lista contra la que se compara cada consulta. Congelada y SIN compartir
  // objetos con la que se devuelve: si quien llama agrega o cambia un mapeo en
  // su copia, la consulta no se entera.
  const vivos: readonly PropertyMapping[] = Object.freeze(
    propios.map((m) => Object.freeze({ provider: m.provider, propertyRef: m.propertyRef }))
  );

  if (vivos.length === 0) {
    const sinMapeo: TokenDelServicio = {
      ok: false,
      reason: "not-mapped",
      detail: "la organización no tiene ningún mapeo vivo: el token de la agencia no se le presta",
    };
    return servicio(organizationId, vivos, null, sinMapeo, registrar);
  }

  const resuelto = await agencyAccessToken();
  if (!resuelto.ok) {
    const sinToken: TokenDelServicio = { ok: false, reason: resuelto.reason, detail: resuelto.detail };
    return servicio(organizationId, vivos, null, sinToken, registrar);
  }
  return servicio(organizationId, vivos, resuelto.accessToken, { ok: true }, registrar);
}

/**
 * El servicio de una organización: sus mapeos, el estado del token y las
 * consultas que lo usan. `accessToken` queda en este cierre y no sale.
 */
function servicio(
  organizationId: string | null,
  vivos: readonly PropertyMapping[],
  accessToken: string | null,
  token: TokenDelServicio,
  registrar: (mensaje: string) => void
): Servicio {
  // El token, para ESTA property de ESTA superficie, o `null`: sin token,
  // `accessToken` ya es `null` y nada sale. Una property que no es de esta
  // organización se anota: es un contrato roto que alguien tiene que ir a
  // buscar.
  const tokenPara = (superficie: GoogleSurface, ref: string): string | null => {
    if (vivos.some((m) => m.provider === superficie && m.propertyRef === ref)) return accessToken;
    registrar(
      `[google] ${superficie}: ${ref} no es un mapeo vivo de esta organización: el token de la agencia no se usa sobre ella`
    );
    return null;
  };
  const sinConsultar = () => ({ outcome: { kind: "no-credentials" as const }, totals: null });

  return {
    mapeos: vivos.map((m) => ({ provider: m.provider, propertyRef: m.propertyRef })),
    token,
    async searchConsole(propertyRef, ahora) {
      const conToken = tokenPara("search_console", propertyRef);
      if (conToken === null) return sinConsultar();
      return fetchSearchConsoleTotals({ accessToken: conToken, propertyRef, ahora, fetcher: fetch });
    },
    async ga4(propertyRef, ahora) {
      const conToken = tokenPara("ga4", propertyRef);
      if (conToken === null) return sinConsultar();
      return fetchGa4Totals({ accessToken: conToken, propertyRef, ahora, fetcher: fetch });
    },
    publicadorDeFicha(locationRef, publicacion) {
      const conToken = tokenPara("google_business_profile", locationRef);
      if (conToken === null) return null;
      return publicadorDeBusinessProfile({
        accessToken: conToken,
        accountId: publicacion.accountId,
        // La ficha es la del mapeo, y la entrada tiene que ser de ESTA
        // organización: un publicador armado para A no publica el asset de B.
        leerDatos: async (entrada) =>
          entrada.organizationId === organizationId ? { cuerpo: publicacion.cuerpo, locationRef } : null,
        fetcher: fetch,
      });
    },
  };
}
