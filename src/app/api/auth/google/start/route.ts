import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { esOperadorDeLaAgencia } from "@/lib/integrations/google/agencyGuard";
import { buildConsentUrl, resolveOAuthConfig } from "@/lib/integrations/google/oauth";
import { ESTADO_COOKIE, VIDA_DEL_ESTADO } from "@/lib/integrations/google/oauthCookie";

export const dynamic = "force-dynamic";
/** Node y no edge: el estado se sortea con `node:crypto`. */
export const runtime = "nodejs";

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que el consentimiento de Google lo empiece cualquiera, y que la vuelta se pueda
 * falsificar.
 *
 * Son dos cosas distintas y las dos se resuelven acá, antes de que el navegador
 * salga hacia Google:
 *
 *   QUIÉN   sólo un miembro de la organización de la agencia. El token es de
 *           plataforma y sirve a todos los clientes, así que autorizar no es una
 *           acción de cliente. Ver `agencyGuard.ts`;
 *   QUÉ     un `state` sorteado que viaja a Google y vuelve, y del que queda una
 *           copia en una cookie `httpOnly`. Sin eso, el callback acepta cualquier
 *           `code` que alguien le mande — un CSRF que termina con el token de
 *           OTRA cuenta guardado como el de la agencia.
 *
 * El `state` se sortea con `randomBytes` y no con `Math.random()`: lo que se está
 * impidiendo es justamente que alguien lo adivine.
 *
 * Y la cookie no lleva el `code` ni nada del token: lleva un número al azar cuyo
 * único valor es coincidir con el que vuelve.
 */
export async function GET(request: Request) {
  const quien = await esOperadorDeLaAgencia();
  if (!quien.ok) {
    // `not-authenticated` manda al login, que es accionable para quien lo lee.
    // Los otros dos motivos contestan 404: quien no es de la agencia no tiene por
    // qué enterarse de que esta ruta existe, y con la variable sin resolver no
    // hay manera de saber si lo es.
    if (quien.reason === "not-authenticated") {
      return NextResponse.redirect(new URL("/login?redirectTo=/app/integrations", request.url));
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const config = resolveOAuthConfig();
  if (!config.ok) {
    // Acá sí se nombran las variables que faltan: quien llegó a esta línea es un
    // operador de la agencia, y lo que necesita es saber qué poner.
    return NextResponse.json(
      { error: "google oauth not configured", missing: config.missing },
      { status: 503 }
    );
  }

  const estado = randomBytes(32).toString("hex");

  const almacen = await cookies();
  almacen.set(ESTADO_COOKIE, estado, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: VIDA_DEL_ESTADO,
  });

  return NextResponse.redirect(buildConsentUrl(config.config, estado));
}
