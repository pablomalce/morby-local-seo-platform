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

type PasoDeBaja = "sesion" | "verificar" | "salir" | "propias" | "acceso";

/** Un paso que lanza en vez de devolver `error` falla con el motivo de ese paso. */
const MOTIVO_SI_LANZA: Record<PasoDeBaja, MotivoDeBaja> = {
  sesion: "sin-sesion",
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
 * QUÉ IMPIDE: que la baja le conteste «listo» a quien no se le borró nada, que
 * deje la cuenta A MEDIAS cuando se podía evitar, y que se lleve una
 * organización que NO era sólo de quien se va.
 *
 * DE QUIÉN ES CADA ORGANIZACIÓN. «Propia» —la que se borra con todo— es una
 * en la que la persona es owner ACTIVA y no hay otro owner activo. Todas las
 * demás membresías se QUITAN y la organización queda:
 *
 *   * owner con otro owner activo. El esquema deja varios owners por
 *     organización (sólo UNIQUE(organization_id, user_id)), y la RLS deja llegar
 *     ahí: un owner suma un admin y el admin se sube a owner. Medido en la
 *     réplica el 2026-10-11: con «propias = role owner», la baja de beto se
 *     llevaba la organización de alicia con sus negocios, y a alicia le quedaba
 *     el login y nada más. En hosted ese día había una organización con dos
 *     owners activos (SELECT de agregados);
 *   * owner ARCHIVADA (0013): ya la sacaron de esa organización, no la manda.
 *     Medido igual: con el filtro sólo por rol, también se la llevaba. Hosted:
 *     dos membresías owner archivadas;
 *   * cualquier otro rol (admin, manager, editor, viewer, client).
 *
 * LO QUE SE MIDIÓ ANTES (réplica `supabase/postgres:17.4.1.075`, 2026-10-11,
 * cada paso en su propia transacción como un pedido de PostgREST). La persona es
 * dueña de A y manager en B, que es de otra. Con el orden anterior —borrar las
 * propias, después salir de las ajenas, después `auth.users`—:
 *
 *   * publicó una versión de la ficha en B → la salida muere con 23503 en
 *     `company_profiles_published_by_member_fkey` (0026, decisión 4), DESPUÉS de
 *     que A ya se borró: queda sin A, miembro de B, con login;
 *   * aprobó una tarjeta en B → lo mismo, 23503 en
 *     `board_cards_approver_member_fkey` (0029, decisión 3);
 *   * selló contenido en B → todo pasa y `auth.users` muere con 23514 en
 *     `content_assets_approval_check`: el `ON DELETE SET NULL` de `approved_by`
 *     (0015) choca con el CHECK de la misma 0015, que no acepta un sello sin
 *     firmante. Queda sin organizaciones, sin membresías y con login.
 *
 * Las tres son rechazos que no se arreglan reintentando: los decide otra
 * organización. Y en las tres el paso irreversible ya había pasado.
 *
 * EL ORDEN, Y POR QUÉ
 *
 *   0. la sesión (adentro del `try`: un `getUser` que lanza también vuelve con
 *      nombre);
 *   1. leer TODAS sus membresías, con rol y estado;
 *   2. de las que es owner activa, leer si hay otro owner activo: esas no son
 *      propias;
 *   3. verificar que no haya sellos suyos fuera de las propias (sólo lee);
 *   4. quitar TODAS las membresías que no son de una propia: UNA sentencia, así
 *      que el 23503 de una firma la deshace entera y no se borró nada;
 *   5. borrar las propias (la cascada se lleva todo; la 0026 decisión 18 y la
 *      0029 decisión 4 hacen que pase con ficha publicada y tablero aprobado:
 *      bloques 118 y 131);
 *   6. borrar el acceso.
 *
 * Los rechazos de negocio caen en 3 y 4, antes de que se borre nada. El 3 es el
 * único que copia una regla de la base, porque es el único rechazo que llega
 * recién en `auth.users`; el bloque 400 de `defects_test.sql` mira por catálogo
 * que las FK hacia `auth.users` sigan siendo las que este paso conoce, y el 401
 * mide el rechazo que copia. Los pasos 3 y 4 usan el MISMO conjunto de propias
 * que el 5: un sello o una firma en una organización compartida trabaría el 6,
 * porque esa organización no se borra.
 *
 * LO QUE NO SE PUEDE EVITAR, Y SE DICE. PostgREST no da una transacción entre
 * pedidos y GoTrue borra el acceso en la suya. Si 5 falla después de 4, ya salió
 * de las demás; si 6 falla después de 5, sólo queda el login. La respuesta trae
 * `yaBorrado` y la pantalla lo muestra. Reintentar retoma: cada paso sobre lo
 * que ya no está es un no-op.
 *
 * Y una carrera que sólo cerraría una función en la base: entre el paso 2 y el 5
 * pasan pedidos. Si los dos owners de una organización compartida se dan de
 * baja a la vez, cada una lee a la otra como owner, las dos salen y la
 * organización queda sin owner; si en ese intervalo alguien se suma como owner a
 * una propia, la propia se borra igual.
 *
 * Un paso que LANZA en vez de devolver `error` es el mismo paso fallando, y
 * vuelve con el motivo de ese paso y con lo que ya se borró. El `redirect` va
 * fuera del `try`: lanza a propósito.
 */
export async function deleteMyAccount(): Promise<BajaFallida> {
  const yaBorrado: YaBorrado = { ...NADA_BORRADO };
  let paso: PasoDeBaja = "sesion";

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) return fallo("sin-sesion", paso, authErr, yaBorrado);

    paso = "verificar";
    const admin = createSupabaseAdminClient();

    // 1. Todas sus membresías. Sin poder leerlas no se sigue: con `data` en null
    //    el paso 5 se salteaba y el 6 dejaba las organizaciones sin dueño (la
    //    cascada de `auth.users` se lleva la membresía owner). Ausencia no es cero.
    const { data: membresias, error: membresiasErr } = await admin
      .from("org_members")
      .select("organization_id, role, state")
      .eq("user_id", user.id);
    if (membresiasErr || !Array.isArray(membresias)) {
      return fallo("no-se-pudo-verificar", paso, membresiasErr ?? SIN_FILAS, yaBorrado);
    }
    const comoOwnerActiva = membresias
      .filter((m) => m.role === "owner" && m.state === "active")
      .map((m) => m.organization_id);

    // 2. Las que tienen OTRO owner activo no son propias: se sale de ellas y
    //    quedan con lo suyo. Un owner archivado no cuenta: ya no la manda.
    let compartidas: string[] = [];
    if (comoOwnerActiva.length > 0) {
      const { data: otros, error: otrosErr } = await admin
        .from("org_members")
        .select("organization_id")
        .in("organization_id", comoOwnerActiva)
        .eq("role", "owner")
        .eq("state", "active")
        .neq("user_id", user.id);
      if (otrosErr || !Array.isArray(otros)) {
        return fallo("no-se-pudo-verificar", paso, otrosErr ?? SIN_FILAS, yaBorrado);
      }
      compartidas = otros.map((o) => o.organization_id);
    }
    const propias = comoOwnerActiva.filter((id) => !compartidas.includes(id));
    const lasPropias = `(${propias.join(",")})`;

    // 3. Sellos suyos FUERA de las propias. Los de adentro se van con la
    //    cascada del paso 5; los de afuera hacen morir el paso 6 (23514). Basta
    //    con uno: `limit(1)`.
    let sellos = admin.from("content_assets").select("id").eq("approved_by", user.id);
    if (propias.length > 0) sellos = sellos.not("organization_id", "in", lasPropias);
    const { data: ajenos, error: sellosErr } = await sellos.limit(1);
    if (sellosErr || !Array.isArray(ajenos)) {
      return fallo("no-se-pudo-verificar", paso, sellosErr ?? SIN_FILAS, yaBorrado);
    }
    if (ajenos.length > 0) {
      return fallo("sello-en-otra-organizacion", paso, null, yaBorrado);
    }

    // 4. Salir de TODAS las demás —por rol, por estado o por compartida—, en una
    //    sentencia. Filtrar por rol acá dejaba afuera alguna membresía, y la
    //    cascada de `auth.users` la encontraba en el paso 6, después de borrar
    //    las propias.
    paso = "salir";
    let salir = admin.from("org_members").delete({ count: "exact" }).eq("user_id", user.id);
    if (propias.length > 0) salir = salir.not("organization_id", "in", lasPropias);
    const { error: salirErr, count: salioDe } = await salir;
    if (salirErr) {
      const motivo = salirErr.code === FK_RECHAZA ? "firma-en-otra-organizacion" : "no-se-pudo-salir";
      return fallo(motivo, paso, salirErr, yaBorrado);
    }
    yaBorrado.ajenas = salioDe ?? null;

    // 5. Las propias, con todo lo que tienen. Que borre MENOS de las que se
    //    leyeron —o no diga cuántas— no es un éxito: el paso 6 dejaría las que
    //    quedaron sin dueño.
    paso = "propias";
    if (propias.length > 0) {
      const { error: orgsErr, count: borradas } = await admin
        .from("organizations")
        .delete({ count: "exact" })
        .in("id", propias);
      if (orgsErr) return fallo("no-se-pudieron-borrar-las-propias", paso, orgsErr, yaBorrado);
      yaBorrado.propias = borradas ?? null;
      if (borradas !== propias.length) {
        return fallo(
          "no-se-pudieron-borrar-las-propias",
          paso,
          { message: `borró ${borradas ?? "?"} de ${propias.length}` },
          yaBorrado,
        );
      }
    }

    // 6. El acceso.
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
