"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { explicarBaja, NADA_BORRADO, type MotivoDeBaja, type YaBorrado } from "./porQueNoSeBorro";

/**
 * GDPR right to access / portability.
 * Returns the entire footprint of the authenticated user as a JSON document.
 */
export async function exportMyData(): Promise<{ ok: boolean; data?: string; message?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, message: "Not authenticated" };

  // Pull every table the user has access to. RLS filters automatically.
  const [orgs, members, businesses, locations, services, content, competitors, reviews, reports, agentRuns, images] =
    await Promise.all([
      supabase.from("organizations").select("*"),
      supabase.from("org_members").select("*"),
      supabase.from("businesses").select("*"),
      supabase.from("business_locations").select("*"),
      supabase.from("business_services").select("*"),
      supabase.from("content_assets").select("*"),
      supabase.from("competitors").select("*"),
      supabase.from("reviews").select("*"),
      supabase.from("reports").select("*"),
      supabase.from("agent_runs").select("*"),
      supabase.from("social_image_assets").select("*"),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    user: { id: user.id, email: user.email, createdAt: user.created_at },
    organizations: orgs.data ?? [],
    org_members: members.data ?? [],
    businesses: businesses.data ?? [],
    business_locations: locations.data ?? [],
    business_services: services.data ?? [],
    content_assets: content.data ?? [],
    competitors: competitors.data ?? [],
    reviews: reviews.data ?? [],
    reports: reports.data ?? [],
    agent_runs: agentRuns.data ?? [],
    social_image_assets: images.data ?? [],
  };

  return { ok: true, data: JSON.stringify(payload, null, 2) };
}

/** Lo que vuelve cuando la baja no terminó. Si termina, redirige y no vuelve. */
export interface BajaFallida {
  ok: false;
  motivo: MotivoDeBaja;
  /** Lo que ya no está. Todo en cero cuando no se borró nada. */
  yaBorrado: YaBorrado;
  /** La frase de `explicarBaja`: por qué, qué ya no está, qué hacer. Sin detalle de la base. */
  message: string;
}

type PasoDeBaja = "verificar" | "salir" | "propias" | "acceso";

/** Un paso que lanza en vez de devolver `error` falla con el motivo de ese paso. */
const MOTIVO_SI_LANZA: Record<PasoDeBaja, MotivoDeBaja> = {
  verificar: "no-se-pudo-verificar",
  salir: "no-se-pudo-salir",
  propias: "no-se-pudieron-borrar-las-propias",
  acceso: "no-se-pudo-borrar-el-acceso",
};

/** `foreign_key_violation`: lo que contesta la base cuando una firma traba la salida. */
const FK_RECHAZA = "23503";

/** Para el log cuando PostgREST no dio error ni filas: no es cero, es nada. */
const SIN_FILAS = { message: "sin error y sin filas" };

function describir(causa: unknown): string {
  if (causa && typeof causa === "object") {
    const e = causa as { code?: unknown; message?: unknown };
    return `${e.code ?? "?"} ${e.message ?? ""}`.trim();
  }
  return String(causa);
}

// El detalle de la base va al log y no a la pantalla: el DETAIL de un 23503
// nombra el uuid de otra organización. Ver `porQueNoSeBorro.ts`.
function fallo(motivo: MotivoDeBaja, paso: string, causa: unknown, ya: YaBorrado): BajaFallida {
  console.error(`[deleteMyAccount] ${paso} -> ${motivo}${causa ? `: ${describir(causa)}` : ""}`);
  const yaBorrado = { ...ya };
  return { ok: false, motivo, yaBorrado, message: explicarBaja(motivo, yaBorrado) };
}

/**
 * GDPR right to erasure ("right to be forgotten").
 *
 * QUÉ IMPIDE: que la baja le conteste «listo» a quien no se le borró nada, y
 * que deje la cuenta A MEDIAS cuando se podía evitar.
 *
 * LO QUE SE MIDIÓ (réplica `supabase/postgres:17.4.1.075`, 2026-10-11, cada
 * paso en su propia transacción como un pedido de PostgREST). La persona es
 * dueña de A y manager en B, que es de otra. Con el orden anterior —borrar las
 * propias, después salir de las ajenas, después `auth.users`—:
 *
 *   * publicó una versión de la ficha en B → el paso 2 muere con 23503 en
 *     `company_profiles_published_by_member_fkey` (0026, decisión 4), DESPUÉS de
 *     que A ya se borró: queda sin A, miembro de B, con login;
 *   * aprobó una tarjeta en B → lo mismo, 23503 en
 *     `board_cards_approver_member_fkey` (0029, decisión 3);
 *   * selló contenido en B → los pasos 1 y 2 pasan y `auth.users` muere con
 *     23514 en `content_assets_approval_check`: el `ON DELETE SET NULL` de
 *     `approved_by` (0015) choca con el CHECK de la misma 0015, que no acepta un
 *     sello sin firmante. Queda sin organizaciones, sin membresías y con login.
 *
 * Las tres son rechazos que no se arreglan reintentando: los decide otra
 * organización. Y en las tres el paso irreversible ya había pasado.
 *
 * EL ORDEN DE AHORA, Y POR QUÉ
 *
 *   1. leer cuáles son las propias;
 *   2. verificar que no haya sellos suyos en organizaciones ajenas (sólo lee);
 *   3. salir de las ajenas: UNA sentencia, así que el 23503 de una firma la
 *      deshace entera y no se borró nada;
 *   4. borrar las propias (la cascada se lleva todo; la 0026 decisión 18 y la
 *      0029 decisión 4 hacen que pase con ficha publicada y tablero aprobado:
 *      bloques 118 y 131);
 *   5. borrar el acceso.
 *
 * Los rechazos de negocio caen en 2 y 3, antes de que se borre nada. El 2 es el
 * único que copia una regla de la base, porque es el único rechazo que llega
 * recién en `auth.users`; el bloque 400 de `defects_test.sql` mira por catálogo
 * que las FK hacia `auth.users` sigan siendo las que este paso conoce, y el 401
 * mide el rechazo que copia.
 *
 * LO QUE NO SE PUEDE EVITAR, Y SE DICE. PostgREST no da una transacción entre
 * pedidos y GoTrue borra el acceso en la suya. Si 4 falla después de 3, ya salió
 * de las ajenas; si 5 falla después de 4, sólo queda el login. La respuesta
 * trae `yaBorrado` y la pantalla lo muestra. Reintentar retoma: cada paso sobre
 * lo que ya no está es un no-op.
 *
 * Un paso que LANZA en vez de devolver `error` es el mismo paso fallando, y
 * vuelve con el motivo de ese paso. El `redirect` va fuera del `try`: lanza a
 * propósito.
 */
export async function deleteMyAccount(): Promise<BajaFallida> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return fallo("sin-sesion", "sesión", authErr, NADA_BORRADO);

  const yaBorrado: YaBorrado = { ...NADA_BORRADO };
  let paso: PasoDeBaja = "verificar";

  try {
    const admin = createSupabaseAdminClient();

    // 1. Las propias. Sin poder leerlas no se sigue: con `data` en null el paso
    //    4 se salteaba y el 5 dejaba las organizaciones sin dueño (la cascada de
    //    `auth.users` se lleva la membresía owner). Ausencia no es cero.
    const { data: propias, error: propiasErr } = await admin
      .from("org_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("role", "owner");
    if (propiasErr || !Array.isArray(propias)) {
      return fallo("no-se-pudo-verificar", paso, propiasErr ?? SIN_FILAS, yaBorrado);
    }
    const orgIds = propias.map((m) => m.organization_id);

    // 2. Sellos suyos FUERA de las propias. Los de adentro se van con la
    //    cascada del paso 4; los de afuera hacen morir el paso 5 (23514). Basta
    //    con uno: `limit(1)`.
    let sellos = admin.from("content_assets").select("id").eq("approved_by", user.id);
    if (orgIds.length > 0) sellos = sellos.not("organization_id", "in", `(${orgIds.join(",")})`);
    const { data: ajenos, error: sellosErr } = await sellos.limit(1);
    if (sellosErr || !Array.isArray(ajenos)) {
      return fallo("no-se-pudo-verificar", paso, sellosErr ?? SIN_FILAS, yaBorrado);
    }
    if (ajenos.length > 0) {
      return fallo("sello-en-otra-organizacion", paso, null, yaBorrado);
    }

    // 3. Salir de las ajenas. Una membresía por organización (UNIQUE de la
    //    0001), así que «no owner» es exactamente «en una organización que no es
    //    suya».
    paso = "salir";
    const { error: salirErr, count: salioDe } = await admin
      .from("org_members")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .neq("role", "owner");
    if (salirErr) {
      const motivo = salirErr.code === FK_RECHAZA ? "firma-en-otra-organizacion" : "no-se-pudo-salir";
      return fallo(motivo, paso, salirErr, yaBorrado);
    }
    yaBorrado.ajenas = salioDe ?? null;

    // 4. Las propias, con todo lo que tienen. Que borre MENOS de las que se
    //    leyeron no es un éxito: el paso 5 dejaría las que quedaron sin dueño.
    paso = "propias";
    if (orgIds.length > 0) {
      const { error: orgsErr, count: borradas } = await admin
        .from("organizations")
        .delete({ count: "exact" })
        .in("id", orgIds);
      if (orgsErr) return fallo("no-se-pudieron-borrar-las-propias", paso, orgsErr, yaBorrado);
      yaBorrado.propias = borradas ?? null;
      if (borradas !== orgIds.length) {
        return fallo(
          "no-se-pudieron-borrar-las-propias",
          paso,
          { message: `borró ${borradas ?? "?"} de ${orgIds.length}` },
          yaBorrado,
        );
      }
    }

    // 5. El acceso.
    paso = "acceso";
    const { error: userErr } = await admin.auth.admin.deleteUser(user.id);
    if (userErr) return fallo("no-se-pudo-borrar-el-acceso", paso, userErr, yaBorrado);
  } catch (lanzado) {
    return fallo(MOTIVO_SI_LANZA[paso], paso, lanzado, yaBorrado);
  }

  redirect("/");
}


export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/");
  redirect("/");
}
