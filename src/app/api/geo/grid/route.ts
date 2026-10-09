import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { quienLlama, type ClienteDeServidor } from "@/lib/api/sesion";
import { correrGrilla } from "@/lib/geo/corrida";
import {
  denominador,
  distanciaEntreCorridas,
  planificarGrilla,
  veredicto,
  TOPE_DE_CORRIDAS_POR_APROBACION,
  VALOR_NO_APARECE_POR_DEFECTO,
  type CorridaDeLaPrueba,
  type Observacion,
  type Resultado,
} from "@/lib/geo/grilla";
import { posicionEnPunto } from "@/lib/integrations/google/places";
import { rolPuede } from "@/lib/org/rol";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** El techo de Vercel Hobby. Nueve puntos de a tres, con 8 s por punto, entran. */
export const maxDuration = 60;

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que la grilla de H2-GO-3 gaste plata sin que una persona lo haya aprobado,
 * que gaste más de lo aprobado, que escriba una corrida a nombre de otra
 * organización, o que su informe esconda los puntos que fallaron.
 *
 * POST corre UNA corrida: N consultas pagas a Places Text Search, una por
 * punto, y guarda la corrida y sus N observaciones (`0032_geo_grid.sql`). GET
 * lee una corrida con su denominador y, si se le piden, la distancia entre dos
 * corridas o el veredicto de la puerta sobre tres (`src/lib/geo/grilla.ts`).
 *
 * EL GASTO LO APRUEBA UNA PERSONA, Y LA BASE LO CUENTA
 *
 * El acto humano de la puerta —«aprobación del gasto y tope de puntos por
 * corrida», decidido por la sesión directora con la recomendación 11a: nueve
 * puntos por corrida, tres corridas, ~27 llamadas, menos de USD 1— es una FILA:
 * `geo_grid_spend_approvals`, con la organización, cuántas corridas (1 a 3),
 * quién aprobó y hasta cuándo vale. La escribe sólo `service_role`
 * —`authenticated` sólo la lee—, o sea una persona con la llave del proyecto,
 * nunca una sesión de la aplicación. Cada corrida toma un CUPO de esa
 * aprobación, numerado de 1 a `max_runs` y ÚNICO por aprobación en la base.
 *
 * Hasta el 2026-10-09 esto no existía, y lo midieron dos revisiones:
 *
 *   * cualquier desconocido que se registrara gastaba con la clave de Places de
 *     la plataforma: el alta está abierta, `handle_new_user` (0001) le da a cada
 *     usuario nuevo una organización propia con rol `owner`, y
 *     `businesses_rw_member` le deja crear un negocio. El rol pasaba. Tres
 *     corridas, 27 pedidos pagos, sin que nadie de la agencia supiera;
 *   * el único freno de corridas era el rate limit —tres por minuto, por IP, en
 *     memoria, por instancia—: una corrida cada 21 s desde la misma IP daba
 *     diez 200 y 90 llamadas pagas; doce corridas en cuatro minutos, 108.
 *
 * Ahora una organización sin una aprobación viva no gasta (403
 * `sin-aprobacion-de-gasto`), y una con la aprobación agotada tampoco (403
 * `aprobacion-agotada`). Las dos cosas ANTES de salir a la red y antes de
 * escribir nada. Y si dos pedidos se disputan el último cupo, la base deja
 * entrar a uno: el otro recibe 409 `cupo-tomado` sin haber consultado a Google,
 * porque la corrida se escribe antes del primer pedido.
 *
 * La aprobación NO está ligada al hash de un pedido (R4) a propósito: lo que se
 * aprueba es un GASTO —tres corridas de hasta nueve puntos para esta
 * organización—, no un pedido. Las tres corridas de la puerta difieren entre sí
 * en el centro por definición. Lo que sí las ata es el veredicto: exige que A,
 * A' y B sean de la MISMA aprobación.
 *
 * EL ORDEN DEL POST, Y POR QUÉ ES ESTE
 *
 * 1. Sesión, antes de todo y FUERA del try (`quienLlama`): sin ella, 401, sin
 *    rate limit, sin leer el cuerpo, sin zod y sin red. Lo mide el barrido
 *    (`precondicionRutas.test.ts`) con cada variante de pedido.
 * 2. El rol, ANTES del cuerpo: una membresía ACTIVA con rol owner, admin o
 *    manager en ALGUNA organización, o 403. Un viewer, un editor o un cliente no
 *    disparan gasto, y no hace falta leerles el cuerpo para saberlo.
 * 3. Rate limit —tres por minuto por IP— y zod. El rate limit es un freno de
 *    velocidad, no el tope: el tope es el cupo del paso 7.
 * 4. El TOPE de puntos: `planificarGrilla` se niega a más de nueve puntos, y a
 *    cualquier punto fuera del mapa, con 400, antes de leer el negocio y antes de
 *    cualquier salida. La 0032 repite los nueve en la base.
 * 5. El negocio, leído COMO EL USUARIO: la RLS esconde el de otra organización
 *    y se contesta 404, igual que a un id inventado.
 * 6. La organización, EN CÓDIGO: la del negocio tiene que ser una donde quien
 *    llama es miembro activo —si no, 404, como si no existiera— y con rol
 *    owner, admin o manager —si no, 403—. No es una copia ociosa de la RLS:
 *    la escritura del paso 9 es con `service_role`, que la saltea, y §12.3 del
 *    director exige verificar la organización en código antes. El test que lo
 *    mide hace «fallar» la RLS y exige 404 sin red y sin escritura.
 * 7. El CUPO: una aprobación viva de ESA organización con un cupo libre, o 403.
 *    Se lee como el usuario y con la organización en el filtro.
 * 8. La clave de Places: sin ella, 503 y nada escrito.
 * 9. La corrida se ESCRIBE ANTES de salir a la red, con `service_role`, con la
 *    organización DEL NEGOCIO —nunca una que mande el pedido—, con la grilla y
 *    el desplazamiento declarados, y con su cupo: la declaración queda fechada
 *    antes de la primera observación (decisión 6 de la 0032), y el cupo queda
 *    tomado antes del primer peso. Si no se puede escribir, 502 —o 409 si otro
 *    pedido tomó el mismo cupo— y no se gasta.
 * 10. Las N consultas (`correrGrilla` con `posicionEnPunto`), de a tres.
 * 11. Las N observaciones y `finished_at`, con `service_role` y la organización
 *    en el filtro. Cada observación lleva la grilla de su corrida, y la 0032
 *    rechaza la que no está en la coordenada que el plan le da a su celda.
 * 12. El denominador se RELEE de la base. Si la escritura falla, la plata ya se
 *    gastó: la respuesta es 200 igual, con `guardado.ok = false` y el motivo,
 *    el denominador de lo que QUEDÓ guardado —que es lo que el informe va a
 *    decir— y, aparte, lo que contestó Google (`respuestasDeGoogle`). Hasta el
 *    2026-10-09 el denominador salía de memoria: con la escritura caída, el POST
 *    publicaba nueve datos devueltos y el GET de la misma corrida, nueve sin
 *    observación.
 *
 * EL DENOMINADOR VA SIEMPRE EN LA RESPUESTA: puntos, devolvieron dato (aparece
 * + no aparece), fallaron, sin observación y fuera de la grilla. Un punto que
 * falló es `failed` con su código, en la base y en la respuesta; jamás «no
 * aparece».
 *
 * EL LUGAR QUE SE MIDE NO SALE DE BUSINESS PROFILE. `targetPlaceId` es el `id`
 * público de Places de cualquier ficha de Maps, escrito en el pedido: la ruta no
 * lo deriva del negocio, no pide OAuth de Google ni un `locations/N`, y no
 * comprueba que la ficha sea «de» la organización. `businessId` es sólo el
 * negocio de Growth OS bajo el que queda archivada la corrida (el eje de
 * tenant). Es a propósito: Vulkan no va a tener Business Profile (Pablo,
 * 2026-10-09), así que la puerta se cruza midiendo una ficha pública ajena, y
 * una grilla que necesitara la ficha propia no se podría cruzar nunca.
 *
 * EL GET pide sesión primero, igual. Lee con el cliente de sesión, así que la
 * RLS decide qué corridas se ven: una ajena es 404. No usa `service_role` y no
 * sale a la red.
 */

/**
 * Quién puede disparar gasto: los que APRUEBAN (`QUIEN_PUEDE.aprobar` de
 * `src/lib/org/rol.ts`, H4.1: owner, admin y manager). Hasta la integración con
 * `main` esta ruta tenía su propia lista con los mismos tres; dos copias de una
 * regla se separan, así que ahora pregunta al mismo lugar que aprobar y publicar.
 */
const correGasto = (rol: string | null | undefined) => rolPuede(rol, "aprobar");

const esquemaPost = z.object({
  businessId: z.string().uuid(),
  keyword: z.string().trim().min(1).max(200),
  /**
   * El `id` de Places de la ficha que se mide —cualquiera de Maps, no la de
   * Business Profile: ver el encabezado—, sin `places/` delante: la forma del
   * CHECK de la 0032.
   */
  targetPlaceId: z.string().regex(/^[A-Za-z0-9_-]{10,255}$/),
  center: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  radiusM: z.number().int().min(1).max(50_000),
  stepM: z.number().int().min(1).max(50_000),
  /** Puntos por lado. SIN máximo acá a propósito: el tope lo dice `planificarGrilla`, con su motivo. */
  gridSize: z.number().int().min(1),
  unmatchedValue: z.number().int().min(21).max(100).default(VALOR_NO_APARECE_POR_DEFECTO),
  declaredShiftM: z.number().int().min(1).max(100_000).optional(),
});

const esquemaGet = z
  .object({
    runId: z.string().uuid(),
    compareTo: z.string().uuid().optional(),
    repeatId: z.string().uuid().optional(),
    shiftedId: z.string().uuid().optional(),
  })
  .refine((q) => (q.repeatId === undefined) === (q.shiftedId === undefined), {
    message: "repeatId y shiftedId van juntos",
  });

/** Un fallo de lectura o escritura, con nombre y sin el detalle de Postgres (#104). */
function fallo(motivo: string, error?: { code?: string } | null, status = 502) {
  if (error) console.error(`[geo-grid] ${motivo}:`, error.code ?? "sin-codigo");
  return NextResponse.json({ ok: false, motivo }, { status });
}

const COLUMNAS_DE_OBSERVACION = "run_id, grid_row, grid_col, lat, lng, observed_at, outcome, position, error_code";

interface FilaDeObservacion {
  run_id: string;
  grid_row: number;
  grid_col: number;
  lat: number;
  lng: number;
  observed_at: string;
  outcome: Resultado;
  position: number | null;
  error_code: string | null;
}

interface FilaDeCorrida {
  id: string;
  organization_id: string;
  business_id: string;
  keyword: string;
  target_place_id: string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  step_m: number;
  n_points: number;
  unmatched_value: number;
  declared_shift_m: number | null;
  approval_id: string;
  approval_slot: number;
  started_at: string;
  finished_at: string | null;
}

interface FilaDeAprobacion {
  id: string;
  organization_id: string;
  max_runs: number;
  approved_at: string;
  expires_at: string;
}

function aObservacion(f: FilaDeObservacion): Observacion {
  return {
    fila: f.grid_row,
    columna: f.grid_col,
    lat: f.lat,
    lng: f.lng,
    observadaEn: f.observed_at,
    resultado: f.outcome,
    posicion: f.position,
    codigoDeError: f.error_code,
  };
}

function aCorridaDeLaPrueba(c: FilaDeCorrida, observaciones: Observacion[]): CorridaDeLaPrueba {
  return {
    id: c.id,
    palabraClave: c.keyword,
    lugarObjetivo: c.target_place_id,
    centro: { lat: c.center_lat, lng: c.center_lng },
    radioM: c.radius_m,
    pasoM: c.step_m,
    puntos: c.n_points,
    valorNoAparece: c.unmatched_value,
    desplazamientoDeclaradoM: c.declared_shift_m,
    empezoEn: c.started_at,
    aprobacion: c.approval_id,
    observaciones,
  };
}

type Cupo =
  | { ok: true; aprobacion: FilaDeAprobacion; cupo: number }
  | { ok: false; respuesta: NextResponse };

/**
 * El paso 7: una aprobación VIVA de la organización con un cupo libre. Vivas
 * son las que no vencieron; se usan de la más vieja a la más nueva, y dentro de
 * cada una el cupo libre más bajo. `max_runs` se acota también acá a
 * `TOPE_DE_CORRIDAS_POR_APROBACION`, por si la base alguna vez lo dejara pasar.
 */
async function buscarCupo(supabase: ClienteDeServidor, organizacion: string): Promise<Cupo> {
  const { data: aprobaciones, error: errorAprobaciones } = await supabase
    .from("geo_grid_spend_approvals")
    .select("id, organization_id, max_runs, approved_at, expires_at")
    .eq("organization_id", organizacion);
  if (errorAprobaciones) return { ok: false, respuesta: fallo("aprobaciones-ilegibles", errorAprobaciones) };

  // La organización la filtra la consulta (`.eq` de arriba), no la RLS: con la
  // RLS rota, el test «la aprobación de OTRA organización no le paga» se pone
  // rojo sin ese `.eq`. Una segunda copia del filtro acá era un mutante
  // equivalente (medido el 2026-10-09) y se sacó.
  const ahora = Date.now();
  const vivas = ((aprobaciones ?? []) as FilaDeAprobacion[])
    .filter((a) => Date.parse(a.expires_at) > ahora)
    .sort((x, y) => Date.parse(x.approved_at) - Date.parse(y.approved_at) || x.id.localeCompare(y.id));
  if (vivas.length === 0) {
    return {
      ok: false,
      respuesta: NextResponse.json({ error: "forbidden", motivo: "sin-aprobacion-de-gasto" }, { status: 403 }),
    };
  }

  const { data: tomados, error: errorTomados } = await supabase
    .from("geo_grid_runs")
    .select("approval_id, approval_slot")
    .eq("organization_id", organizacion)
    .in(
      "approval_id",
      vivas.map((a) => a.id)
    );
  if (errorTomados) return { ok: false, respuesta: fallo("cupos-ilegibles", errorTomados) };
  const filas = (tomados ?? []) as Array<{ approval_id: string; approval_slot: number }>;

  for (const aprobacion of vivas) {
    const usados = new Set(filas.filter((f) => f.approval_id === aprobacion.id).map((f) => f.approval_slot));
    const tope = Math.min(aprobacion.max_runs, TOPE_DE_CORRIDAS_POR_APROBACION);
    for (let cupo = 1; cupo <= tope; cupo++) {
      if (!usados.has(cupo)) return { ok: true, aprobacion, cupo };
    }
  }
  return {
    ok: false,
    respuesta: NextResponse.json({ error: "forbidden", motivo: "aprobacion-agotada" }, { status: 403 }),
  };
}

export async function POST(req: Request) {
  // Paso 1 del encabezado.
  const sesion = await quienLlama();
  if (!sesion) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const { supabase, user } = sesion;

  try {
    // Paso 2: el rol, antes del cuerpo.
    const { data: membresias, error: errorMembresias } = await supabase
      .from("org_members")
      .select("organization_id, role, state")
      .eq("user_id", user.id);
    if (errorMembresias) return fallo("membresias-ilegibles", errorMembresias);
    const activas = ((membresias ?? []) as Array<{ organization_id: string; role: string; state: string | null }>).filter(
      (m) => (m.state ?? "active") === "active"
    );
    if (!activas.some((m) => correGasto(m.role))) {
      return NextResponse.json({ error: "forbidden", motivo: "rol-insuficiente" }, { status: 403 });
    }

    // Paso 3.
    const limitado = rateLimit(req, { limit: 3, windowMs: 60_000, key: "geo-grid" });
    if (limitado) return limitado;
    const pedido = esquemaPost.parse(await req.json().catch(() => ({})));

    // Paso 4: el tope y el mapa, antes del negocio y de la red.
    const plan = planificarGrilla({
      centro: pedido.center,
      radioM: pedido.radiusM,
      pasoM: pedido.stepM,
      lado: pedido.gridSize,
    });
    if (!plan.ok) return NextResponse.json(plan, { status: 400 });

    // Paso 5.
    const { data: negocio, error: errorNegocio } = await supabase
      .from("businesses")
      .select("id, organization_id")
      .eq("id", pedido.businessId)
      .maybeSingle();
    if (errorNegocio) return fallo("negocio-ilegible", errorNegocio);
    if (!negocio) return NextResponse.json({ error: "not found" }, { status: 404 });
    const organizacion = negocio.organization_id as string;

    // Paso 6: la organización, en código.
    const membresia = activas.find((m) => m.organization_id === organizacion);
    if (!membresia) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!correGasto(membresia.role)) {
      return NextResponse.json({ error: "forbidden", motivo: "rol-insuficiente" }, { status: 403 });
    }

    // Paso 7: el cupo aprobado.
    const cupo = await buscarCupo(supabase, organizacion);
    if (!cupo.ok) return cupo.respuesta;

    // Paso 8.
    if (!process.env.GOOGLE_PLACES_API_KEY) return fallo("sin-clave", null, 503);

    // Paso 9: la corrida, declarada, fechada y con su cupo antes de la primera consulta.
    const admin = createSupabaseAdminClient();
    const { data: corrida, error: errorCorrida } = await admin
      .from("geo_grid_runs")
      .insert({
        organization_id: organizacion,
        business_id: negocio.id,
        keyword: pedido.keyword,
        target_place_id: pedido.targetPlaceId,
        center_lat: pedido.center.lat,
        center_lng: pedido.center.lng,
        radius_m: pedido.radiusM,
        step_m: pedido.stepM,
        n_points: plan.puntos.length,
        unmatched_value: pedido.unmatchedValue,
        declared_shift_m: pedido.declaredShiftM ?? null,
        approval_id: cupo.aprobacion.id,
        approval_max_runs: cupo.aprobacion.max_runs,
        approval_slot: cupo.cupo,
        created_by: user.id,
      })
      .select("id, started_at")
      .single();
    if (errorCorrida?.code === "23505") {
      // Otro pedido tomó el mismo cupo entre la lectura y la escritura: la
      // única de la 0032 lo dejó entrar a él. Nada salió a la red.
      return NextResponse.json({ ok: false, motivo: "cupo-tomado" }, { status: 409 });
    }
    if (errorCorrida || !corrida) return fallo("corrida-no-guardada", errorCorrida);
    const runId = (corrida as { id: string }).id;

    // Paso 10: la red.
    const resultado = await correrGrilla(
      {
        keyword: pedido.keyword,
        targetPlaceId: pedido.targetPlaceId,
        radiusM: pedido.radiusM,
        puntos: plan.puntos,
      },
      { consultar: (consulta) => posicionEnPunto(consulta) }
    );
    // `planificarGrilla` ya se negó a más de nueve; esto no se alcanza con su
    // plan, y si se alcanzara, no salió nada a la red.
    if (!resultado.ok) return NextResponse.json(resultado, { status: 400 });
    const respuestas = resultado.observaciones;

    // Paso 11.
    const guardado: { ok: boolean; observaciones: number; esperadas: number; motivo?: string } = {
      ok: true,
      observaciones: 0,
      esperadas: respuestas.length,
    };
    const { error: errorObservaciones, count: escritas } = await admin.from("geo_grid_observations").insert(
      respuestas.map((o) => ({
        organization_id: organizacion,
        run_id: runId,
        run_n_points: plan.puntos.length,
        run_center_lat: pedido.center.lat,
        run_center_lng: pedido.center.lng,
        run_step_m: pedido.stepM,
        grid_row: o.fila,
        grid_col: o.columna,
        lat: o.lat,
        lng: o.lng,
        observed_at: o.observadaEn,
        source: "google_places_text_search",
        outcome: o.resultado,
        position: o.posicion,
        error_code: o.codigoDeError,
      })),
      { count: "exact" }
    );
    if (errorObservaciones) {
      console.error("[geo-grid] observaciones-no-guardadas:", errorObservaciones.code ?? "sin-codigo");
      guardado.ok = false;
      guardado.motivo = "observaciones-no-guardadas";
    } else {
      guardado.observaciones = escritas ?? 0;
      if (guardado.observaciones !== guardado.esperadas) {
        guardado.ok = false;
        guardado.motivo = "observaciones-incompletas";
      }
    }
    const terminadaEn = new Date().toISOString();
    const { error: errorFin } = await admin
      .from("geo_grid_runs")
      .update({ finished_at: terminadaEn })
      .eq("id", runId)
      .eq("organization_id", organizacion);
    if (errorFin) {
      console.error("[geo-grid] fin-no-guardado:", errorFin.code ?? "sin-codigo");
      guardado.ok = false;
      guardado.motivo = guardado.motivo ?? "fin-no-guardado";
    }

    // Paso 12: el denominador es el de la BASE.
    const declarada = {
      centro: pedido.center,
      radioM: pedido.radiusM,
      pasoM: pedido.stepM,
      puntos: plan.puntos.length,
    };
    const {
      data: releidas,
      error: errorRelectura,
      count: cuantasHay,
    } = await admin
      .from("geo_grid_observations")
      .select(COLUMNAS_DE_OBSERVACION, { count: "exact" })
      .eq("run_id", runId)
      .eq("organization_id", organizacion);
    const filasReleidas = (releidas ?? []) as unknown as FilaDeObservacion[];
    let guardadas: Observacion[] | null = null;
    if (errorRelectura || cuantasHay === null || cuantasHay === undefined || filasReleidas.length !== cuantasHay) {
      console.error("[geo-grid] relectura-fallida:", errorRelectura?.code ?? "sin-codigo");
      guardado.ok = false;
      guardado.motivo = guardado.motivo ?? "relectura-fallida";
    } else {
      guardadas = filasReleidas.map(aObservacion);
    }
    const cuenta = guardadas ? denominador({ ...declarada, observaciones: guardadas }) : null;
    const deGoogle = denominador({ ...declarada, observaciones: respuestas });
    console.log(
      `[geo-grid] corrida=${runId} cupo=${cupo.cupo}/${cupo.aprobacion.max_runs} puntos=${deGoogle.puntos} ` +
        `devolvieron=${deGoogle.devolvieronDato} fallaron=${deGoogle.fallaron} ` +
        `guardadas=${cuenta ? cuenta.puntos - cuenta.sinObservacion : "?"}`
    );

    return NextResponse.json(
      {
        ok: true,
        run: {
          id: runId,
          organizationId: organizacion,
          businessId: negocio.id,
          keyword: pedido.keyword,
          targetPlaceId: pedido.targetPlaceId,
          center: pedido.center,
          radiusM: pedido.radiusM,
          stepM: pedido.stepM,
          nPoints: plan.puntos.length,
          unmatchedValue: pedido.unmatchedValue,
          declaredShiftM: pedido.declaredShiftM ?? null,
          approvalId: cupo.aprobacion.id,
          approvalSlot: cupo.cupo,
          startedAt: (corrida as { started_at: string }).started_at,
          finishedAt: terminadaEn,
        },
        /** Lo que quedó en la base: lo que el informe va a decir. `null` si no se pudo releer. */
        denominador: cuenta,
        observaciones: guardadas ?? [],
        /** Lo que contestó Google, se haya guardado o no: la plata que se gastó. */
        respuestasDeGoogle: { denominador: deGoogle, observaciones: respuestas },
        guardado,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(error, 400);
    return apiError(error, 500);
  }
}

export async function GET(req: Request) {
  const sesion = await quienLlama();
  if (!sesion) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const { supabase } = sesion;

  try {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const q = esquemaGet.parse(params);
    // Sin repetidos para LEER; el veredicto recibe los tres tal cual vinieron, y
    // si dos son la misma corrida lo dice (`corridas-repetidas`).
    const ids = [...new Set([q.runId, q.compareTo, q.repeatId, q.shiftedId].filter((v): v is string => !!v))];

    const { data: corridas, error: errorCorridas } = await supabase
      .from("geo_grid_runs")
      .select(
        "id, organization_id, business_id, keyword, target_place_id, center_lat, center_lng, radius_m, step_m, " +
          "n_points, unmatched_value, declared_shift_m, approval_id, approval_slot, started_at, finished_at"
      )
      .in("id", ids);
    if (errorCorridas) return fallo("corridas-ilegibles", errorCorridas);
    const porId = new Map(((corridas ?? []) as unknown as FilaDeCorrida[]).map((c) => [c.id, c]));
    if (ids.some((id) => !porId.has(id))) return NextResponse.json({ error: "not found" }, { status: 404 });

    const {
      data: filas,
      error: errorObservaciones,
      count,
    } = await supabase.from("geo_grid_observations").select(COLUMNAS_DE_OBSERVACION, { count: "exact" }).in("run_id", ids);
    if (errorObservaciones || count === null || count === undefined) {
      return fallo("observaciones-ilegibles", errorObservaciones);
    }
    const leidas = (filas ?? []) as unknown as FilaDeObservacion[];
    // Menos filas que el `count` es una página cortada: una celda que no se leyó
    // se contaría como «sin observación» por un límite de PostgREST.
    if (leidas.length !== count) return fallo("lectura-incompleta");

    const observacionesDe = (id: string) => leidas.filter((f) => f.run_id === id).map(aObservacion);
    const comparable = (id: string) => aCorridaDeLaPrueba(porId.get(id) as FilaDeCorrida, observacionesDe(id));

    const principal = porId.get(q.runId) as FilaDeCorrida;
    const corridaPrincipal = comparable(q.runId);
    return NextResponse.json({
      ok: true,
      run: principal,
      denominador: denominador(corridaPrincipal),
      observaciones: corridaPrincipal.observaciones,
      distancia: q.compareTo ? distanciaEntreCorridas(corridaPrincipal, comparable(q.compareTo)) : undefined,
      veredicto:
        q.repeatId && q.shiftedId
          ? veredicto(corridaPrincipal, comparable(q.repeatId), comparable(q.shiftedId))
          : undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(error, 400);
    return apiError(error, 500);
  }
}
