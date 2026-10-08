/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que Growth OS tenga dos maneras de leer «la ficha publicada» y que se separen.
 *
 * La puerta H1.3 dice que cambiar el ICP UNA vez en la ficha cambia el prompt
 * del Lead Engine Y el texto del reporte de Growth OS. Los dos consumidores de
 * este lado —`GET /api/profile/published`, que le sirve la ficha al Lead
 * Engine con `service_role`, y el orquestador del reporte, que la lee con la
 * sesión— pasan por ESTA función. Si cada uno armara su consulta, el día que
 * uno filtre por otra cosa el Lead Engine y el reporte citarían ICP distintos
 * y nada se pondría rojo.
 *
 * QUÉ LEE, Y POR QUÉ EN ESE ORDEN
 *
 * 1. La versión PUBLICADA de ese par (organización, empresa). El par entero va
 *    en el filtro: `company_profiles` cuelga de `businesses` por la FK
 *    compuesta `(organization_id, business_id)` de la `0026`, así que si la
 *    empresa no es de esa organización no hay fila, y eso es «sin versión», lo
 *    mismo que una empresa inexistente. `maybeSingle` y no `single`: cero filas
 *    es un hecho del cliente, no un error. Dos filas SÍ son un error (PGRST116)
 *    y está bien: el índice parcial `company_profiles_one_published_key` dice
 *    que no pueden existir, y elegir una sería citar al azar. Y la fila trae
 *    su propio par, que se compara con el pedido: si no coincide es un fallo
 *    (`fila-de-otro-par`), nunca una ficha.
 * 2. El ICP y la oferta DE ESA VERSIÓN, por su id. No «el ICP más nuevo» ni
 *    «el de la empresa»: el de la versión citada. Desde la `0027` el contenido
 *    de una versión publicada o superada no se edita, así que lo que se lee por
 *    ese id es lo que la versión dice para siempre. Por eso la cita y el texto
 *    no se pueden separar aunque sean tres consultas: el texto se busca CON la
 *    cita.
 *
 * TRES ESTADOS, NO DOS
 *
 * `sin-version` y `fallo` son cosas distintas y viajan distintas: la primera es
 * un hecho del cliente (no publicó nada), la segunda es un fallo nuestro. Y el
 * fallo lleva el CÓDIGO de PostgREST o de Postgres, nunca el mensaje, que puede
 * nombrar tablas y constraints (la lección del ensayo de publicación, #104).
 *
 * QUÉ NO HACE
 *
 * No decide quién puede leer. Con el cliente de sesión decide la RLS; con el de
 * servicio decide la firma de `profileReadSignature.ts`, ANTES de que exista el
 * cliente. Esta función lee con lo que le den.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** El ICP de una versión, como lo dice la fila de `profile_icp`. */
export interface IcpPublicado {
  definition: string;
  disqualifiers: string | null;
  buyingTrigger: string | null;
  budgetBand: string | null;
}

/** Una línea de oferta de una versión, como la dice `profile_offers`. */
export interface OfertaPublicada {
  name: string;
  description: string | null;
  priceBand: string | null;
  promise: string | null;
}

export interface FichaPublicada {
  /**
   * El par de la FILA leída, no el que se pidió. Si un día la consulta pierde
   * el filtro de tenant, estos dos ya no coinciden con el pedido, y
   * `leerFichaPublicada` lo devuelve como fallo antes de que nadie lo sirva.
   * La ruta los usa en su 200 para que el chequeo de eco del Lead Engine mida
   * la fila y no la query (hallazgo de la revisión, 2026-10-07).
   */
  organizationId: string;
  businessId: string;
  versionId: string;
  version: number;
  publishedAt: string;
  /** null: la versión se publicó sin ICP. La base no lo exige; el consumidor decide. */
  icp: IcpPublicado | null;
  /** Ordenadas por `position`, y por nombre para desempatar. */
  offers: OfertaPublicada[];
}

export type LecturaDeFicha =
  | { estado: "publicada"; ficha: FichaPublicada }
  | { estado: "sin-version" }
  | { estado: "fallo"; codigo: string };

type ErrorDeLectura = { code?: string } | null;

/** El código, nunca el mensaje. Ver el encabezado. */
function fallo(error: { code?: string }): LecturaDeFicha {
  return { estado: "fallo", codigo: error.code || "sin-codigo" };
}

interface FilaVersion {
  id: string;
  organization_id: string;
  business_id: string;
  version: number;
  published_at: string;
}

interface FilaIcp {
  definition: string;
  disqualifiers: string | null;
  buying_trigger: string | null;
  budget_band: string | null;
}

interface FilaOferta {
  name: string;
  description: string | null;
  price_band: string | null;
  promise: string | null;
  position: number | null;
}

/**
 * La versión publicada de la ficha de ESA empresa de ESA organización, con su
 * ICP y su oferta, o por qué no la hay.
 */
export async function leerFichaPublicada(
  cliente: SupabaseClient,
  organizationId: string,
  businessId: string
): Promise<LecturaDeFicha> {
  const version = (await cliente
    .from("company_profiles")
    .select("id, organization_id, business_id, version, published_at")
    .eq("organization_id", organizationId)
    .eq("business_id", businessId)
    .eq("status", "published")
    .maybeSingle()) as { data: FilaVersion | null; error: ErrorDeLectura };

  if (version.error) return fallo(version.error);
  if (!version.data) return { estado: "sin-version" };
  const fila = version.data;

  // La fila tiene que ser del par que se pidió. Con los filtros de arriba
  // siempre lo es; esto es lo que queda en pie el día que alguien los saque o
  // los cambie —medido por la revisión del 2026-10-07: sin los `.eq`, la ruta
  // servía 200 con el ICP de OTRO cliente y los ids de la query, y el chequeo
  // de eco del Lead Engine lo dejaba pasar—. Sin mayúsculas en la comparación:
  // Postgres devuelve el uuid en minúsculas y la query puede no traerlo así.
  if (
    fila.organization_id?.toLowerCase() !== organizationId.toLowerCase() ||
    fila.business_id?.toLowerCase() !== businessId.toLowerCase()
  ) {
    return { estado: "fallo", codigo: "fila-de-otro-par" };
  }

  // Las dos hijas, por el id de la versión que se va a citar. El tenant va en
  // el filtro aunque la FK compuesta ya lo ate: la consulta dice qué pide.
  const [icp, ofertas] = (await Promise.all([
    cliente
      .from("profile_icp")
      .select("definition, disqualifiers, buying_trigger, budget_band")
      .eq("organization_id", organizationId)
      .eq("profile_id", fila.id)
      .maybeSingle(),
    cliente
      .from("profile_offers")
      .select("name, description, price_band, promise, position")
      .eq("organization_id", organizationId)
      .eq("profile_id", fila.id),
  ])) as [
    { data: FilaIcp | null; error: ErrorDeLectura },
    { data: FilaOferta[] | null; error: ErrorDeLectura },
  ];

  // Una ficha leída a medias es una ficha que no se pudo leer: citar la
  // versión sin poder mostrar su ICP sería presentar un hueco como contenido.
  if (icp.error) return fallo(icp.error);
  if (ofertas.error) return fallo(ofertas.error);

  const offers = [...(ofertas.data ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((o) => ({
      name: o.name,
      description: o.description ?? null,
      priceBand: o.price_band ?? null,
      promise: o.promise ?? null,
    }));

  return {
    estado: "publicada",
    ficha: {
      organizationId: fila.organization_id,
      businessId: fila.business_id,
      versionId: fila.id,
      version: fila.version,
      publishedAt: fila.published_at,
      icp: icp.data
        ? {
            definition: icp.data.definition,
            disqualifiers: icp.data.disqualifiers ?? null,
            buyingTrigger: icp.data.buying_trigger ?? null,
            budgetBand: icp.data.budget_band ?? null,
          }
        : null,
      offers,
    },
  };
}
