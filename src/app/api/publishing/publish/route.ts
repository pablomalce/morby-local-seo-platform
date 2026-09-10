import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { agencyAccessToken } from "@/lib/integrations/google/tokenStore";
import { publicadorDeBusinessProfile } from "@/lib/publishing/googleBusinessProfile";
import { publicar, type Destino, type Publicador } from "@/lib/publishing/transport";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que `publicadorDeBusinessProfile` siga siendo un módulo que nadie llama.
 *
 * El publicador entró con este mismo frente y su ÚNICO importador era su propio
 * test: ninguna ruta lo inyectaba, esperaba un `accessToken` que nadie le
 * pasaba, y desde afuera se leía como «el publicador está hecho». Es el defecto
 * que este repositorio ya se comió dos veces —`transport.ts` con sus 19 tests
 * hasta la #76, y `POST /api/content` con once, que hasta hoy ninguna pantalla
 * llama— y por eso `sinLlamadores.test.ts` ahora lo vigila en cada corrida.
 *
 * ESTA RUTA ES LA VARIANTE EN VIVO QUE EL ENSAYO PROMETIÓ
 *
 * `rehearse/route.ts` dice, textual, que la variante en vivo *"no es esta ruta
 * con un campo más: necesita un publicador y necesita decidir quién puede mandar
 * algo a la ficha de un cliente. Cuando eso exista tendrá su propia ruta y su
 * propia decisión"*. Esto es esa ruta, y ésta es esa decisión.
 *
 * LA DECISIÓN, ESCRITA: EL MISMO GUARDIÁN QUE EL ENSAYO
 *
 * Quien puede ensayar sobre un asset puede publicarlo. No hay un rol nuevo, y no
 * es pereza: un permiso separado que nadie sabe otorgar termina otorgándose a
 * todos, y mientras tanto la ficha de un cliente queda protegida por una
 * comprobación que nadie probó. El guardián que ya existe está medido en las dos
 * direcciones —deja pasar al miembro, y a un no-miembro la RLS le esconde la
 * fila, así que recibe 404 igual que quien pide un id inventado—.
 *
 * Si mañana hace falta separar «aprobar» de «publicar», eso es una migración de
 * roles y su propio frente, no un `if` acá.
 *
 * EL MODO ES UN LITERAL, IGUAL QUE EN EL ENSAYO Y POR LO MISMO
 *
 * `"en-vivo"` está escrito acá y no llega en el cuerpo. **Un modo elegido por
 * quien llama no es un modo, es un accidente**: la misma ruta que ensaya no
 * puede publicar según un booleano del pedido, porque entonces publicar de
 * verdad sería un typo.
 *
 * EL PUBLICADOR SE INYECTA SÓLO SI HAY CON QUÉ, Y SI NO, FALLA
 *
 * Hacen falta tres cosas, y ninguna se inventa: el token de la agencia, la
 * cuenta (`GOOGLE_BUSINESS_ACCOUNT_ID`) y el mapeo `locations/N` de ESA
 * organización. Si falta cualquiera, esta ruta NO arma el publicador y
 * `publicar()` contesta `sin-transporte` — un fallo con nombre, no un éxito
 * silencioso ni un cero inventado. Ese camino ya está probado en `transport.ts`
 * desde la #74.
 *
 * Al 2026-09-10 falta la cuota de Business Profile y falta el mapeo de la ficha,
 * así que en producción esta ruta contesta `sin-transporte` hoy. **Eso es lo
 * correcto y es el punto**: el día que la cuota llegue y la ficha se mapee,
 * cruzar F4 es apretar un botón en lugar de escribir código bajo presión.
 *
 * DE DÓNDE SALE CADA COSA
 *
 * El `approvedHash` y el texto, del asset leído ACÁ como el usuario — no del
 * cuerpo del pedido: mandar el hash de ayer sería publicar el texto de ayer, y
 * mandar el texto sería publicar algo que nadie aprobó. El `locations/N`, de
 * `integration_properties`, también con el cliente de sesión, porque la `0017`
 * le da a `authenticated` justamente `SELECT` sobre esa tabla y la RLS ya sabe
 * cuáles son sus organizaciones.
 */

/** El único destino, igual que el CHECK de la `0016` y que `Destino`. */
const DESTINO: Destino = "google_business_profile";

const schema = z.object({
  assetId: z.string().uuid(),
});

export async function POST(req: Request) {
  // Más apretado que el ensayo —que permite 20/min— porque esto sale a la red de
  // un tercero y deja una publicación visible. Un ensayo se puede repetir; esto
  // no.
  const limitado = rateLimit(req, { limit: 5, windowMs: 60_000, key: "publishing-publish" });
  if (limitado) return limitado;

  try {
    const { assetId } = schema.parse(await req.json().catch(() => ({})));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

    const { data: asset, error } = await supabase
      .from("content_assets")
      .select("id, organization_id, approved_hash, body")
      .eq("id", assetId)
      .maybeSingle();

    // Un fallo de lectura NO es un asset ausente, y tampoco es permiso para
    // seguir: sin la fila no hay organización, ni hash, ni texto que mandar.
    if (error) return NextResponse.json({ error: "asset unreadable" }, { status: 502 });
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (!asset.approved_hash) {
      return NextResponse.json({ ok: false, motivo: "no-aprobado" }, { status: 409 });
    }

    const publicador = await armarPublicador(supabase, asset.organization_id, asset.body);

    const resultado = await publicar(
      {
        // Del ASSET, nunca del cuerpo del pedido.
        organizationId: asset.organization_id,
        assetId: asset.id,
        approvedHash: asset.approved_hash,
        destino: DESTINO,
      },
      "en-vivo",
      publicador
    );

    if (resultado.ok) return NextResponse.json(resultado, { status: 200 });

    // Cada motivo con su código, y ninguno con 200.
    //
    // `sin-transporte` es 503 y no 500: no es que algo se rompió, es que falta
    // una pieza de configuración —la cuota, la cuenta o el mapeo— y el pedido
    // vale la pena reintentarlo cuando esté. Un 500 mandaría a buscar un bug que
    // no existe.
    const codigo =
      resultado.motivo === "no-aprobado" ? 409
      : resultado.motivo === "sin-transporte" ? 503
      : resultado.motivo === "red-rechazo" ? 502
      : resultado.motivo === "ledger-ilegible" ? 502
      : 500;
    return NextResponse.json(resultado, { status: codigo });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * El publicador, o `undefined` si falta cualquiera de las tres piezas.
 *
 * Devolver `undefined` es una respuesta, no una omisión: `publicar()` la lee
 * como `sin-transporte` y deja constancia. Lo que NO hace este archivo es
 * inventar un valor por defecto para seguir adelante — una cuenta inventada
 * publicaría en la ficha de otro, y un `locationRef` inventado es exactamente el
 * defecto que la `0017` existe para impedir.
 */
async function armarPublicador(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  cuerpo: string
): Promise<Publicador | undefined> {
  const accountId = process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
  if (!accountId) return undefined;

  // El mapeo vivo de ESTA organización. `unmapped_at is null` es lo que
  // distingue el mapeo actual del historial: la `0017` guarda los dos.
  const { data: propiedad } = await supabase
    .from("integration_properties")
    .select("property_ref")
    .eq("organization_id", organizationId)
    .eq("provider", DESTINO)
    .is("unmapped_at", null)
    .maybeSingle();

  const locationRef = propiedad?.property_ref;
  if (!locationRef) return undefined;

  const token = await agencyAccessToken();
  if (!token.ok) return undefined;

  return publicadorDeBusinessProfile({
    accessToken: token.accessToken,
    accountId,
    // El texto y la ficha ya se resolvieron acá arriba, con el cliente de sesión
    // y en la misma operación que decidió publicar. `leerDatos` existe para que
    // el publicador no sepa de dónde salen, no para volver a buscarlos.
    leerDatos: async () => ({ cuerpo, locationRef }),
    fetcher: fetch,
  });
}
