import type { EntradaPublicacion, Publicador, ResultadoRed } from "./transport";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la última pieza de F4 siga sin escribirse.
 *
 * `transport.ts` declara la interfaz `Publicador` y la prueba contra un doble
 * desde el #74; nunca hubo una implementación. Sin ella, `en-vivo` falla con
 * `sin-transporte` — que es correcto y deliberado, y también es el motivo por el
 * que la puerta de F4 no se puede ni intentar.
 *
 * EL ENDPOINT SE MIDIÓ, NO SE COPIÓ DE UNA GUÍA
 *
 * R12 dice que si algo cruza hacia un tercero tiene que existir cómo medir ese
 * borde. Se midió el 2026-09-06, sin credenciales, con la técnica que destapó el
 * 404 de GA4:
 *
 *   POST mybusiness.googleapis.com/v4/accounts/A/locations/L/localPosts   401
 *   POST mybusinessbusinessinformation…/v1/locations/L/localPosts         404
 *   POST mybusiness.googleapis.com/v4/accounts/A/locations/L/inventado    404
 *
 * Una ruta que existe contesta 401 sin credenciales; una que no existe contesta
 * 404. **La tercera línea es la que hace válidas a las otras dos**: sin ella, un
 * 401 para todo no probaría nada.
 *
 * LO QUE ESTO NO PUEDE SABER, Y HAY QUE DECIRLO
 *
 * Que el CUERPO sea el correcto. Eso sólo lo contesta una publicación real, y
 * para eso hace falta la cuota de Business Profile, que es lo que la puerta de F4
 * espera. O sea que este archivo llega hasta donde R12 permite llegar y ni un
 * paso más: la forma de la URL está medida, el contenido del pedido no.
 *
 * TODO SE INYECTA
 *
 * El token, el fetcher y las lecturas. Igual que `runAi` con `llamar` y que el
 * transporte con el publicador: este módulo sabe hablar con Google, no sabe de
 * dónde salen las credenciales. Y así se puede probar sin tocar la red.
 */

/** El único host donde viven los posts locales, medido. */
export const GBP_ENDPOINT = "https://mybusiness.googleapis.com/v4";

/** Lo que hay que leer para publicar una vez. Lo trae quien llama. */
export interface DatosDeLaPublicacion {
  /** El texto aprobado, tal como se selló. */
  cuerpo: string;
  /** El mapeo vivo del cliente: `locations/N`, con la forma que valida la 0017. */
  locationRef: string;
}

export interface DependenciasGbp {
  /** El token de la agencia, ya refrescado por `tokenStore`. */
  accessToken: string;
  /** `GOOGLE_BUSINESS_ACCOUNT_ID`: la cuenta de la agencia, una para todos. */
  accountId: string;
  leerDatos(entrada: EntradaPublicacion): Promise<DatosDeLaPublicacion | null>;
  fetcher: typeof fetch;
}

/**
 * La URL de los posts locales de una ficha.
 *
 * El `locationRef` viene como `locations/N` y su barra es un SEPARADOR de ruta,
 * no parte del identificador. Se escapa segmento por segmento y no entero: es
 * exactamente el defecto que en GA4 hizo que Google contestara 404 durante días
 * y se leyera como un problema de permisos.
 */
export function urlDePosts(accountId: string, locationRef: string): string {
  const cuenta = encodeURIComponent(accountId);
  const ficha = locationRef.split("/").map(encodeURIComponent).join("/");
  return `${GBP_ENDPOINT}/accounts/${cuenta}/${ficha}/localPosts`;
}

/**
 * El publicador real contra Google Business Profile.
 *
 * Devuelve `ResultadoRed`, que es lo único que el transporte mira: el ledger lo
 * garantiza él, no este archivo.
 */
export function publicadorDeBusinessProfile(deps: DependenciasGbp): Publicador {
  return {
    async publicar(entrada: EntradaPublicacion): Promise<ResultadoRed> {
      const datos = await deps.leerDatos(entrada);
      // Sin texto o sin ficha no se llama a la red. Llamar igual publicaría un
      // post vacío en la ficha de un cliente, que desde acá es irreversible.
      if (!datos) return { ok: false, motivo: "sin-datos-para-publicar" };
      if (datos.cuerpo.trim() === "") return { ok: false, motivo: "cuerpo-vacio" };

      let respuesta: Response;
      try {
        respuesta = await deps.fetcher(urlDePosts(deps.accountId, datos.locationRef), {
          method: "POST",
          headers: {
            authorization: `Bearer ${deps.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            languageCode: "es",
            summary: datos.cuerpo,
            topicType: "STANDARD",
          }),
        });
      } catch {
        // No hubo respuesta. NO se puede saber si el post salió, así que no se
        // dice que falló ni que salió: el transporte deja la fila abierta y la
        // pantalla del ledger manda a mirar el destino antes de reintentar.
        return { ok: false, motivo: "sin-respuesta" };
      }

      if (!respuesta.ok) {
        return { ok: false, motivo: `http ${respuesta.status}` };
      }

      let json: unknown;
      try {
        json = await respuesta.json();
      } catch {
        // Google contestó 2xx y el cuerpo no se pudo leer. El post PUEDE haber
        // salido, y por eso esto no es un éxito: sin `name` no hay a qué volver.
        return { ok: false, motivo: "respuesta-ilegible" };
      }

      const nombre = (json as { name?: unknown })?.name;
      if (typeof nombre !== "string" || nombre === "") {
        // Igual que arriba: un 2xx sin identificador es un post que no se puede
        // ir a buscar ni borrar. El CHECK de la 0016 tampoco lo aceptaría.
        return { ok: false, motivo: "sin-id-de-la-red" };
      }

      return { ok: true, externalId: nombre };
    },
  };
}
