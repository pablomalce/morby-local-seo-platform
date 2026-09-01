import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { esOperadorDeLaAgencia } from "@/lib/integrations/google/agencyGuard";
import {
  type Fetcher,
  exchangeCode,
  readCallback,
  resolveOAuthConfig,
} from "@/lib/integrations/google/oauth";
import { ESTADO_COOKIE } from "@/lib/integrations/google/oauthCookie";
import { saveAgencyToken } from "@/lib/integrations/google/tokenStore";

export const dynamic = "force-dynamic";
/** Node y no edge: la comparación del estado usa `node:crypto`. */
export const runtime = "nodejs";

/** Dónde vuelve el operador, con el resultado escrito en la URL. */
const PANTALLA = "/app/integrations";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la vuelta del consentimiento de Google escriba un token que no pidió nadie
 * de la agencia.
 *
 * EL ORDEN NO ES INTERCAMBIABLE
 *
 * 1. leer qué volvió — un `error` de Google se mira ANTES que el código, porque
 *    `access_denied` no es una vuelta incompleta: alguien dijo que no;
 * 2. comparar el `state` con la cookie, ANTES de canjear nada. Ése es el único
 *    paso que distingue una vuelta de nuestro propio flujo de un `code` que
 *    alguien mandó a mano;
 * 3. comprobar que quien vuelve sigue siendo operador de la agencia. La cookie
 *    prueba que este navegador arrancó el flujo, no que la sesión siga siendo la
 *    misma ni que la membresía siga vigente;
 * 4. recién entonces canjear el código;
 * 5. y guardar en UNA llamada, que es lo que la 0021 existe para permitir.
 *
 * La cookie se BORRA pase lo que pase, y eso no es higiene. Un `state` que
 * sobrevive a su propio canje es un `state` reutilizable, y todo el paso 2 se
 * apoya en que valga una sola vez.
 *
 * QUÉ SE LE DICE AL OPERADOR, Y QUÉ NO
 *
 * Vuelve a la pantalla de integraciones con un motivo corto en la URL, no con el
 * detalle. El detalle queda en el log del servidor: lo que un tercero podría
 * provocar en esta ruta es un error, y decirle cuál es entregarle el mapa.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const lectura = readCallback(url.searchParams);

  const almacen = await cookies();
  const esperado = almacen.get(ESTADO_COOKIE)?.value ?? "";
  // Antes que cualquier retorno, y por eso está acá arriba: cada camino de abajo
  // termina en un `return`, y borrarla en cada uno es la manera de olvidarse en
  // alguno.
  almacen.delete({ name: ESTADO_COOKIE, path: "/api/auth/google" });

  if (!lectura.ok) {
    return volver(request, lectura.reason === "denied" ? "denied" : "incomplete", lectura.detail);
  }

  if (!estadoCoincide(esperado, lectura.state)) {
    return volver(request, "bad-state", "el state no coincide con la cookie");
  }

  const quien = await esOperadorDeLaAgencia();
  if (!quien.ok) {
    if (quien.reason === "not-authenticated") {
      return NextResponse.redirect(new URL("/login?redirectTo=/app/integrations", request.url));
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const config = resolveOAuthConfig();
  if (!config.ok) {
    return volver(request, "not-configured", `faltan ${config.missing.join(", ")}`);
  }

  const canje = await exchangeCode(config.config, lectura.code, new Date(), fetch as Fetcher);
  if (!canje.ok) {
    // `no-refresh-token` lleva motivo propio porque se arregla en otro lado: es
    // `prompt=consent` faltando en la URL de arranque, y no un problema de Google
    // ni del operador.
    return volver(
      request,
      canje.reason === "no-refresh-token" ? "no-refresh-token" : "exchange-failed",
      canje.detail
    );
  }

  const guardado = await saveAgencyToken(canje.token, canje.expiresAt);
  if (!guardado.ok) {
    return volver(request, "store-failed", guardado.detail);
  }

  return NextResponse.redirect(new URL(`${PANTALLA}?google=connected`, request.url));
}

/**
 * La comparación del `state`, en tiempo constante y con los largos chequeados.
 *
 * `timingSafeEqual` tira si los buffers miden distinto, así que el largo se
 * compara antes — y una cookie ausente da cadena vacía, que nunca puede coincidir
 * con los 64 caracteres que escribe la ruta de arranque.
 */
function estadoCoincide(esperado: string, recibido: string): boolean {
  if (esperado.length === 0 || esperado.length !== recibido.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(recibido));
}

/** La vuelta a la pantalla, con el motivo corto y el detalle sólo en el log. */
function volver(request: Request, motivo: string, detalle: string): NextResponse {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[google-oauth] ${motivo}: ${detalle}`);
  }
  return NextResponse.redirect(new URL(`${PANTALLA}?google=${motivo}`, request.url));
}
