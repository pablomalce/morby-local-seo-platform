import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COOKIE_ORG_ACTIVA } from "@/lib/org/eleccion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que la única manera de cambiar de cliente sea archivar una organización a mano.
 *
 * Pasó dos veces: la #69 con una cuenta y el 2026-09-05 con la otra. Las dos
 * veces se arregló un hueco de producto tocando datos.
 *
 * SE COMPRUEBA LA MEMBRESÍA ANTES DE GUARDAR, Y NO PORQUE HAGA FALTA
 *
 * No hace falta para la seguridad: la cookie es una preferencia y quien decide
 * qué filas se ven es la RLS, así que una elección inventada termina en una
 * organización vacía. Se comprueba para que el fallo sea INMEDIATO y con
 * nombre — guardar una elección que después se ignora en silencio deja a alguien
 * apretando un selector que no cambia nada.
 *
 * Y la comprobación es una lectura COMO EL USUARIO: la RLS contesta la membresía,
 * así que no hay ninguna copia de esa regla escrita acá.
 */

const schema = z.object({ organizationId: z.string().uuid() });

/** Un mes. La elección es una comodidad, no una sesión: no vive más que el uso. */
const VIDA = 60 * 60 * 24 * 30;

export async function POST(req: Request) {
  try {
    const { organizationId } = schema.parse(await req.json().catch(() => ({})));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

    const { data, error } = await supabase
      .from("org_members")
      .select("organization_id, state")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    // Un fallo de lectura NO es «no sos miembro»: guardar igual sería elegir a
    // ciegas, y contestar 404 mandaría a pedir una membresía que quizá ya tiene.
    if (error) return NextResponse.json({ error: "membership unreadable" }, { status: 502 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ((data.state ?? "active") !== "active") {
      return NextResponse.json({ ok: false, motivo: "membresia-archivada" }, { status: 409 });
    }

    const almacen = await cookies();
    almacen.set(COOKIE_ORG_ACTIVA, organizationId, {
      // NO es `httpOnly` a propósito: la mitad de la aplicación que corre en el
      // navegador tiene que elegir la MISMA organización que las pantallas de
      // servidor, y para eso necesita leerla. Ver `eleccion.ts`.
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: VIDA,
      secure: process.env.NODE_ENV === "production",
    });

    return NextResponse.json({ ok: true, organizationId }, { status: 200 });
  } catch (error) {
    return apiError(error);
  }
}
