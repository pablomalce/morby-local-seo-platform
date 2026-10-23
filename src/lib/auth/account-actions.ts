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
  /**
   * Lo que ya no está. Todo en cero cuando no se borró nada; `null` cuando no
   * se sabe si se borró (la base no contestó).
   */
  yaBorrado: YaBorrado | null;
  /** La frase de `explicarBaja`: por qué, qué ya no está, qué hacer. Sin detalle de la base. */
  message: string;
}

type PasoDeBaja = "sesion" | "verificar" | "organizaciones" | "acceso";

/** Un paso que lanza en vez de devolver `error` falla con el motivo de ese paso. */
const MOTIVO_SI_LANZA: Record<PasoDeBaja, MotivoDeBaja> = {
  sesion: "sin-sesion",
  verificar: "no-se-pudo-verificar",
  // La llamada salió y no volvió: la transacción pudo confirmarse o no.
  organizaciones: "no-se-sabe-que-se-borro",
  acceso: "no-se-pudo-borrar-el-acceso",
};

/** La función de la 0035: clasifica y borra en una transacción. */
const BAJA_EN_LA_BASE = "delete_account_organizations";

/**
 * Los códigos con nombre de `delete_account_organizations` (ver el encabezado
 * de la 0035). Cualquier otro error que contestó la base es
 * `no-se-pudieron-borrar-las-organizaciones`: la base lo deshizo igual.
 */
const MOTIVO_DE_LA_BASE: Record<string, MotivoDeBaja> = {
  "45008": "sello-en-otra-organizacion",
  // `foreign_key_violation`: una firma traba la salida de una ajena.
  "23503": "firma-en-otra-organizacion",
  "45009": "no-se-pudo-verificar",
  "40001": "no-se-pudo-verificar",
  "40P01": "no-se-pudo-verificar",
  "55P03": "no-se-pudo-verificar",
};

/**
 * ¿El error lo contestó la base? Sólo entonces se sabe que la transacción se
 * deshizo. postgrest-js también devuelve `error` cuando el `fetch` se corta o el
 * cuerpo no se puede leer (con `status` 0 y el `code` del error de red, que
 * puede ser `EPIPE`: cinco mayúsculas), y cuando un proxy contesta HTML sin
 * código. En esos casos el pedido pudo llegar, confirmarse y perder la
 * respuesta: «no se borró nada» sería una suposición.
 */
function laBaseContesto(r: { status: number; error: { code?: unknown } }): boolean {
  return r.status >= 400 && typeof r.error.code === "string" && /^([0-9A-Z]{5}|PGRST\d{3})$/.test(r.error.code);
}

/** Lo que devolvió la función, si tiene la forma que promete; si no, `null`. */
function leerResultado(data: unknown): YaBorrado | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const n = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v.length : null);
  const propias = n(d.deleted_organizations);
  const ajenas = n(d.left_organizations);
  const sellos = n(d.released_seals);
  if (propias === null || ajenas === null || sellos === null) return null;
  return { ajenas, propias, sellos };
}

/** Para el log cuando la base contestó sin error y con otra forma. */
const SIN_FORMA = { message: "sin error y sin la forma prometida" };

function describir(causa: unknown): string {
  if (causa && typeof causa === "object") {
    const e = causa as { code?: unknown; message?: unknown };
    return `${e.code ?? "?"} ${e.message ?? ""}`.trim();
  }
  return String(causa);
}

// El detalle de la base va al log y no a la pantalla: el DETAIL de un 23503
// nombra el uuid de otra organización. Ver `porQueNoSeBorro.ts`.
function fallo(motivo: MotivoDeBaja, paso: string, causa: unknown, ya: YaBorrado | null): BajaFallida {
  console.error(`[deleteMyAccount] ${paso} -> ${motivo}${causa ? `: ${describir(causa)}` : ""}`);
  const yaBorrado = ya === null ? null : { ...ya };
  return { ok: false, motivo, yaBorrado, message: explicarBaja(motivo, yaBorrado) };
}

/**
 * GDPR right to erasure ("right to be forgotten").
 *
 * QUÉ IMPIDE: que la baja le conteste «listo» a quien no se le borró nada, que
 * deje la cuenta A MEDIAS, que se lleve una organización que NO era sólo de
 * quien se va, y que diga «no se borró nada» cuando no lo sabe.
 *
 * DE QUIÉN ES CADA ORGANIZACIÓN —«propia» es una donde la persona es owner
 * ACTIVA y no hay otro owner activo— lo decide la base, no este archivo:
 * `delete_account_organizations` (0035) clasifica y borra en UNA transacción,
 * con locks sobre las organizaciones y las membresías que la clasificación lee,
 * y con la pregunta «¿hay otro owner activo?» adentro del mismo DELETE.
 *
 * HASTA LA 0035 (#117, `faade08`) esto eran cuatro pedidos de PostgREST —leer
 * membresías, leer otros owners, verificar sellos, borrar— y entre pedido y
 * pedido la base no prometía nada. Medido en la réplica el 2026-10-11:
 *
 *   * dos co-owners que se dan de baja a la vez dejaban su organización sin
 *     ningún miembro (bloque 402 de `defects_test.sql`), y una owner sumada a
 *     una propia entre la lectura y el DELETE se borraba con ella;
 *   * «no hay otro owner» salía de una lectura VACÍA, y PostgREST corta en
 *     `max_rows` sin error: con 1001 compartidas, una se leía propia (403);
 *   * un sello en una organización sin nadie que apruebe la trababa para
 *     siempre, con una frase que mandaba a pedirle a nadie.
 *
 * LA SECUENCIA, Y LO QUE CADA RESPUESTA QUIERE DECIR
 *
 *   0. la sesión (adentro del `try`: un `getUser` que lanza también vuelve con
 *      nombre). La identidad la valida GoTrue; la base confía en el id que
 *      recibe porque sólo `service_role` puede llamarla.
 *   1. `delete_account_organizations(user.id)`, una sola llamada:
 *        - contestó un error de la base → la transacción se deshizo: NO se
 *          borró nada, y el código dice por qué (`MOTIVO_DE_LA_BASE`);
 *        - no contestó, o contestó algo ilegible → NO SE SABE: pudo
 *          confirmarse. `yaBorrado` va en `null` y el login no se toca;
 *        - contestó la forma prometida → lo que borró, contado.
 *   2. el acceso (`auth.admin.deleteUser`). Si falla, la frase dice lo que el
 *      paso 1 ya hizo y que queda el login.
 *
 * Reintentar retoma: la función sobre una persona sin membresías es un no-op y
 * devuelve todo vacío.
 *
 * LO QUE NO SE PUEDE EVITAR, Y SE DICE. GoTrue borra el login en su propia
 * transacción, así que entre el paso 1 y el 2 queda la ventana de un pedido: una
 * membresía o un sello nuevos de la persona en ese instante los encuentra la
 * cascada de `auth.users`.
 *
 * El `redirect` va fuera del `try`: lanza a propósito.
 */
export async function deleteMyAccount(): Promise<BajaFallida> {
  let yaBorrado: YaBorrado | null = { ...NADA_BORRADO };
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

    // 1. Las organizaciones, en una transacción de la base.
    paso = "organizaciones";
    const respuesta = await admin.rpc(BAJA_EN_LA_BASE, { p_user_id: user.id });
    if (respuesta.error) {
      if (!laBaseContesto(respuesta)) {
        return fallo("no-se-sabe-que-se-borro", paso, respuesta.error, null);
      }
      const motivo = MOTIVO_DE_LA_BASE[String(respuesta.error.code)] ?? "no-se-pudieron-borrar-las-organizaciones";
      return fallo(motivo, paso, respuesta.error, yaBorrado);
    }
    const hecho = leerResultado(respuesta.data);
    // Sin error y sin la forma prometida: la base confirmó ALGO. No se cuenta
    // como cero, y el login no se borra sobre una suposición.
    if (!hecho) return fallo("no-se-sabe-que-se-borro", paso, SIN_FORMA, null);
    yaBorrado = hecho;

    // 2. El acceso.
    paso = "acceso";
    const { error: userErr } = await admin.auth.admin.deleteUser(user.id);
    if (userErr) return fallo("no-se-pudo-borrar-el-acceso", paso, userErr, yaBorrado);
  } catch (lanzado) {
    return fallo(MOTIVO_SI_LANZA[paso], paso, lanzado, paso === "organizaciones" ? null : yaBorrado);
  }

  redirect("/");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/");
  redirect("/");
}
