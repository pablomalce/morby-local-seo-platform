import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { servirConLaAgencia } from "@/lib/integrations/google/servicioCompartido";
import { publicadorDeBusinessProfile } from "@/lib/publishing/googleBusinessProfile";
import { publicar, type Destino, type Publicador } from "@/lib/publishing/transport";
import { permisoEn } from "@/lib/org/rol";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { quienLlama } from "@/lib/api/sesion";

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
 * desde la #74. Y la respuesta dice cuál faltó (`falta`: `cuenta`, `mapeo` o
 * `token`), porque son tres arreglos distintos.
 *
 * El mapeo va ANTES que el token, y no es un detalle de orden: el token de la
 * agencia se presta sólo a una organización con mapeo vivo
 * (`servicioCompartido.ts`). Sin `locations/N` propio, el asset de un cliente no
 * se publica con el token de la agencia ni en la ficha de la agencia, y el
 * token ni se pide.
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
 *
 * LA DECISIÓN, REVISADA POR LA PUERTA H4.1 (D4, 2026-10-07)
 *
 * «Quien puede ensayar puede publicar» sigue valiendo, y ahora los dos piden
 * ROL: owner, admin o manager de la organización del asset. Lo de arriba
 * anunciaba que separar quién aprueba de quién publica sería «una migración de
 * roles y su propio frente»; ése fue la 0031, y decidió que son los mismos. La
 * membresía sola dejaba publicar en la ficha de un cliente a un `viewer` — o al
 * cliente mismo. 403, antes de armar el publicador y de pedir el token.
 */

/** El único destino, igual que el CHECK de la `0016` y que `Destino`. */
const DESTINO: Destino = "google_business_profile";

const schema = z.object({
  assetId: z.string().uuid(),
});

export async function POST(req: Request) {
  // La sesión primero, antes del rate limit, del cuerpo y de zod, y FUERA del
  // try del trabajo: sin ella —o sin proveedor de identidad, `quienLlama`— 401
  // y nada más. Lo mide `precondicionRutas.test.ts` con cada variante de pedido.
  const sesion = await quienLlama();
  if (!sesion) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const { supabase, user } = sesion;

  try {
    // Más apretado que el ensayo —que permite 20/min— porque esto sale a la red de
    // un tercero y deja una publicación visible. Un ensayo se puede repetir; esto
    // no.
    const limitado = rateLimit(req, { limit: 5, windowMs: 60_000, key: "publishing-publish" });
    if (limitado) return limitado;

    const { assetId } = schema.parse(await req.json().catch(() => ({})));

    const { data: asset, error } = await supabase
      .from("content_assets")
      .select("id, organization_id, approved_hash, body")
      .eq("id", assetId)
      .maybeSingle();

    // Un fallo de lectura NO es un asset ausente, y tampoco es permiso para
    // seguir: sin la fila no hay organización, ni hash, ni texto que mandar.
    if (error) return NextResponse.json({ error: "asset unreadable" }, { status: 502 });
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });

    // El rol, en la organización del ASSET. Antes que el sello: a quien no
    // puede publicar no le importa si el asset está aprobado.
    const permiso = await permisoEn(supabase, user.id, asset.organization_id, "aprobar");
    if (!permiso.ok) {
      if (permiso.motivo === "ilegible") {
        return NextResponse.json({ error: "membership unreadable" }, { status: 502 });
      }
      return NextResponse.json({ ok: false, motivo: "sin-permiso" }, { status: 403 });
    }

    if (!asset.approved_hash) {
      return NextResponse.json({ ok: false, motivo: "no-aprobado" }, { status: 409 });
    }

    const armado = await armarPublicador(supabase, asset.organization_id, asset.body);

    // Un mapeo que no se pudo leer no es un mapeo que falta, igual que el asset
    // de más arriba: 502 y nada más, antes de reservar nada en el ledger. Decir
    // `falta: "mapeo"` mandaría a mapear una organización que puede estar
    // mapeada — medido así en la revisión del #118 con un 57014 (timeout).
    if ("ilegible" in armado) return NextResponse.json({ error: "mapping unreadable" }, { status: 502 });

    const publicador = "publicador" in armado ? armado.publicador : undefined;

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

    // `sin-transporte` dice que no hubo con qué publicar; `falta` dice POR QUÉ, y
    // son tres arreglos distintos. El que importa acá es `mapeo`: una
    // organización sin su `locations/N` vivo NO se publica con lo de la agencia
    // —ni con su token ni con una ficha por defecto—, y lo dice con nombre.
    if (resultado.motivo === "sin-transporte" && "falta" in armado) {
      return NextResponse.json({ ...resultado, falta: armado.falta }, { status: 503 });
    }

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
 * Qué pieza faltó para armar el publicador. Ver `falta` en la respuesta.
 *
 *   cuenta  `GOOGLE_BUSINESS_ACCOUNT_ID` no está puesta;
 *   mapeo   ESTA organización no tiene `locations/N` vivo — y entonces el token
 *           de la agencia ni se pide (`servicioCompartido.ts`);
 *   token   la organización está mapeada y el token de la agencia no se pudo
 *           resolver. El motivo fino no viaja: es estado de la agencia, no del
 *           cliente que pidió publicar.
 *
 * Y una cuarta respuesta que NO es una pieza que falta: el mapeo no se pudo
 * leer (`{ ilegible: true }`). No se sabe si falta, así que no se dice que
 * falta: la ruta contesta 502 «mapping unreadable», como con el asset.
 */
type Falta = "cuenta" | "mapeo" | "token";

/**
 * El publicador, o qué pieza faltó.
 *
 * Que falte es una respuesta, no una omisión: `publicar()` lee la ausencia de
 * publicador como `sin-transporte` y deja constancia. Lo que NO hace este
 * archivo es inventar un valor por defecto para seguir adelante — una cuenta
 * inventada publicaría en la ficha de otro, y un `locationRef` inventado es
 * exactamente el defecto que la `0017` existe para impedir.
 */
async function armarPublicador(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  cuerpo: string
): Promise<{ publicador: Publicador } | { falta: Falta } | { ilegible: true }> {
  const accountId = process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
  if (!accountId) return { falta: "cuenta" };

  // El mapeo vivo de ESTA organización. `unmapped_at is null` es lo que
  // distingue el mapeo actual del historial: la `0017` guarda los dos. Y
  // `organization_id` se lee aunque el filtro ya lo fije, para que la regla del
  // servicio compartido lo compruebe en vez de creérselo al filtro.
  const { data: propiedad, error } = await supabase
    .from("integration_properties")
    .select("organization_id, property_ref")
    .eq("organization_id", organizationId)
    .eq("provider", DESTINO)
    .is("unmapped_at", null)
    .maybeSingle();

  // El error se lee, y viaja como fallo: antes se ignoraba, y una lectura caída
  // se convertía en «no hay ficha». El código y no el mensaje, que puede
  // nombrar tablas.
  const leidos = error
    ? { ilegible: true as const, detalle: error.code ?? "sin código" }
    : propiedad
      ? [{ organizationId: propiedad.organization_id, provider: DESTINO, propertyRef: propiedad.property_ref }]
      : [];

  // La ficha y el token salen juntos de la regla: sin mapeo propio no hay
  // ficha, y entonces el token de la agencia no se resuelve. Con el mapeo
  // ilegible, tampoco.
  const { mapeos, token } = await servirConLaAgencia(organizationId, leidos);
  if (!token.ok && token.reason === "mapping-unreadable") return { ilegible: true };

  const locationRef = mapeos.find((m) => m.provider === DESTINO)?.propertyRef;
  if (!locationRef) return { falta: "mapeo" };
  if (!token.ok) return { falta: "token" };

  return {
    publicador: publicadorDeBusinessProfile({
      accessToken: token.accessToken,
      accountId,
      // El texto y la ficha ya se resolvieron acá arriba, con el cliente de sesión
      // y en la misma operación que decidió publicar. `leerDatos` existe para que
      // el publicador no sepa de dónde salen, no para volver a buscarlos.
      leerDatos: async () => ({ cuerpo, locationRef }),
      fetcher: fetch,
    }),
  };
}
