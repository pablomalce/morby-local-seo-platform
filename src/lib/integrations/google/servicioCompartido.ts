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
 * La `0017` hace el resto: una property viva está mapeada a UNA sola
 * organización en toda la base (`(provider, lower(property_ref))` único entre
 * vivos), así que si (X, S, P) es un mapeo vivo, P es de X y de nadie más.
 *
 * Todo lo demás es el fallback, y falla con motivo:
 *
 *   - X sin ningún mapeo vivo → `not-mapped`, y el token de la agencia NI SE
 *     RESUELVE: no se lee su secreto, no se refresca contra Google, no se le
 *     presta a nadie. Antes se resolvía igual para cada reporte con sesión,
 *     mapeado o no;
 *   - una fila cuya `organization_id` no es X → se descarta, nunca se sirve. Es
 *     el caso de la agencia leyendo, con sus propias membresías, el mapeo de un
 *     cliente (o un cliente el de la agencia): la RLS deja ver las filas de
 *     TODAS las organizaciones de quien llama, así que un filtro que se pierda
 *     en la consulta mezcla properties sin que nada lo note;
 *   - la agencia NO es un caso especial. Sus propios datos se sirven por SUS
 *     mapeos, igual que los de cualquier cliente — no por ser la agencia. No hay
 *     ningún `if (org === agencia)` en este archivo y no tiene que haberlo.
 *
 * Y NO HAY OTRO CAMINO AL TOKEN
 *
 * Este archivo es el único llamador de producción de `agencyAccessToken()`, y
 * `src/lib/__tests__/credencialDeLaAgencia.test.ts` lo sostiene leyendo el
 * árbol de imports desde el disco: ninguna ruta de DATOS alcanza la lectura de
 * `VULKAN_AGENCY_ORG_ID` si se le saca este archivo del medio. Las únicas que la
 * alcanzan directo son las de CONEXIÓN —el OAuth, la pantalla de integraciones
 * y el mapeo—, declaradas allá con su razón.
 *
 * QUÉ NO DICE
 *
 * No dice nada de tokens PROPIOS de una organización cliente. La `0014` los
 * admite por organización, pero el código no lee ninguno (el callback sólo
 * guarda el de la agencia) y en hosted, medido el 2026-10-11, hay 1 token vivo,
 * de la misma organización que tiene los 2 mapeos vivos. Cuando un cliente
 * conecte su propia cuenta (H3.3, catálogo por organización), su token será otra
 * credencial con su propia regla, no una excepción a ésta.
 */

import { type AccessTokenResult, agencyAccessToken } from "./tokenStore";
import type { GoogleSurface, PropertyMapping } from "./sources";

/** Una fila de `integration_properties` tal como se lee: CON su organización. */
export interface MapeoLeido {
  organizationId: string;
  provider: GoogleSurface;
  propertyRef: string;
}

/** Lo que la regla deja servir con el token de la agencia, y con cuál token. */
export interface Servicio {
  /** Los mapeos de ESTA organización. Nunca uno de otra. */
  mapeos: PropertyMapping[];
  /** El token de la agencia, o por qué no se presta. */
  token: AccessTokenResult;
}

export interface ServicioDeps {
  /** Quién resuelve el token de la agencia. Inyectable para poder contar si se llamó. */
  resolver?: () => Promise<AccessTokenResult>;
  /** Dónde se anota que llegó una fila ajena. Inyectable por lo mismo que en `hydrate.ts`. */
  log?: (mensaje: string) => void;
}

/**
 * La regla de arriba, entera, en una llamada.
 *
 * `organizationId` es la organización DEL RECURSO —el negocio del reporte, el
 * asset que se publica—, leída de la base bajo la RLS de quien llama. Nunca la
 * del pedido, y nunca la de la agencia por defecto. `null` es no tener
 * organización (el reporte de demostración): no hay mapeo que sea suyo, así que
 * tampoco hay token.
 */
export async function servirConLaAgencia(
  organizationId: string | null,
  leidos: readonly MapeoLeido[],
  deps: ServicioDeps = {}
): Promise<Servicio> {
  const propios = organizationId === null ? [] : leidos.filter((m) => m.organizationId === organizationId);

  // Una fila ajena no puede llegar si la consulta filtra por organización, que
  // es lo que hacen los dos lectores. Si llega, el filtro se perdió: se anota y
  // se descarta. Lo que NO se hace es servirla, ni «arreglarla» reasignándola.
  const ajenas = leidos.length - propios.length;
  if (ajenas > 0 && organizationId !== null) {
    const registrar =
      deps.log ??
      ((mensaje: string) => {
        console.warn(mensaje);
      });
    registrar(`[google] ${ajenas} mapeo(s) de otra organización descartado(s): el token de la agencia no los sirve`);
  }

  const mapeos = propios.map((m) => ({ provider: m.provider, propertyRef: m.propertyRef }));

  if (mapeos.length === 0) {
    return {
      mapeos,
      token: {
        ok: false,
        reason: "not-mapped",
        detail: "la organización no tiene ningún mapeo vivo: el token de la agencia no se le presta",
      },
    };
  }

  const resolver = deps.resolver ?? (() => agencyAccessToken());
  return { mapeos, token: await resolver() };
}
