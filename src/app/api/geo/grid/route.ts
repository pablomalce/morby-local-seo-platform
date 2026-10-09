import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { quienLlama } from "@/lib/api/sesion";
import { correrGrilla } from "@/lib/geo/corrida";
import {
  denominador,
  distanciaEntreCorridas,
  planificarGrilla,
  veredicto,
  VALOR_NO_APARECE_POR_DEFECTO,
  type CorridaDeLaPrueba,
  type Observacion,
  type Resultado,
} from "@/lib/geo/grilla";
import { posicionEnPunto } from "@/lib/integrations/google/places";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** El techo de Vercel Hobby. Nueve puntos de a tres, con 8 s por punto, entran. */
export const maxDuration = 60;

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que la grilla de H2-GO-3 gaste plata sin que nadie autorizado lo pida, que
 * gaste más de lo declarado, que escriba una corrida a nombre de otra
 * organización, o que su informe esconda los puntos que fallaron.
 *
 * POST corre UNA corrida: N consultas pagas a Places Text Search, una por
 * punto, y guarda la corrida y sus N observaciones (`0032_geo_grid.sql`). GET
 * lee una corrida con su denominador y, si se le piden, la distancia entre dos
 * corridas o el veredicto de la puerta sobre tres (`src/lib/geo/grilla.ts`).
 *
 * EL ORDEN DEL POST, Y POR QUÉ ES ESTE
 *
 * 1. Sesión, antes de todo y FUERA del try (`quienLlama`): sin ella, 401, sin
 *    rate limit, sin leer el cuerpo, sin zod y sin red. Lo mide el barrido
 *    (`precondicionRutas.test.ts`) con cada variante de pedido.
 * 2. El rol, ANTES del cuerpo: una membresía ACTIVA con rol owner, admin o
 *    manager en ALGUNA organización, o 403. Un viewer, un editor o un cliente no
 *    disparan gasto, y no hace falta leerles el cuerpo para saberlo.
 * 3. Rate limit —tres corridas por minuto por IP— y zod.
 * 4. El TOPE: `planificarGrilla` se niega a más de nueve puntos con 400, antes
 *    de leer el negocio y antes de cualquier salida. El acto humano de la
 *    puerta, decidido por la sesión directora (recomendación 11a): 9 puntos por
 *    corrida, tres corridas, menos de USD 1. La 0032 lo repite en la base.
 * 5. El negocio, leído COMO EL USUARIO: la RLS esconde el de otra organización
 *    y se contesta 404, igual que a un id inventado.
 * 6. La organización, EN CÓDIGO: la del negocio tiene que ser una donde quien
 *    llama es miembro activo —si no, 404, como si no existiera— y con rol
 *    owner, admin o manager —si no, 403—. No es una copia ociosa de la RLS:
 *    la escritura del paso 8 es con `service_role`, que la saltea, y §12.3 del
 *    director exige verificar la organización en código antes. El test que lo
 *    mide hace «fallar» la RLS y exige 404 sin red y sin escritura.
 * 7. La clave de Places: sin ella, 503 y nada escrito. Una corrida con nueve
 *    `missing_key` sería verdad, pero no sirve a nadie.
 * 8. La corrida se ESCRIBE ANTES de salir a la red, con `service_role`, con la
 *    organización DEL NEGOCIO —nunca una que mande el pedido— y con la grilla
 *    y el desplazamiento declarados: la declaración queda fechada antes de la
 *    primera observación (decisión 6 de la 0032). Si no se puede escribir, 502
 *    y no se gasta.
 * 9. Las N consultas (`correrGrilla` con `posicionEnPunto`), de a tres.
 * 10. Las N observaciones y `finished_at`, con `service_role` y la organización
 *    en el filtro. Si la escritura falla, la plata ya se gastó: la respuesta
 *    trae todo igual y `guardado.ok = false` con el motivo, en vez de
 *    esconderlo detrás de un 500.
 *
 * EL DENOMINADOR VA SIEMPRE EN LA RESPUESTA: puntos, devolvieron dato (aparece
 * + no aparece), fallaron y sin observación. Un punto que falló es `failed` con
 * su código, en la base y en la respuesta; jamás «no aparece».
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

/** Quién puede disparar gasto. Los mismos tres que aprueban en H4.1. */
const ROLES_QUE_CORREN: ReadonlySet<string> = new Set(["owner", "admin", "manager"]);

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
  started_at: string;
  finished_at: string | null;
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
    observaciones,
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
    if (!activas.some((m) => ROLES_QUE_CORREN.has(m.role))) {
      return NextResponse.json({ error: "forbidden", motivo: "rol-insuficiente" }, { status: 403 });
    }

    // Paso 3.
    const limitado = rateLimit(req, { limit: 3, windowMs: 60_000, key: "geo-grid" });
    if (limitado) return limitado;
    const pedido = esquemaPost.parse(await req.json().catch(() => ({})));

    // Paso 4: el tope, antes del negocio y de la red.
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
    if (!ROLES_QUE_CORREN.has(membresia.role)) {
      return NextResponse.json({ error: "forbidden", motivo: "rol-insuficiente" }, { status: 403 });
    }

    // Paso 7.
    if (!process.env.GOOGLE_PLACES_API_KEY) return fallo("sin-clave", null, 503);

    // Paso 8: la corrida, declarada y fechada antes de la primera consulta.
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
        created_by: user.id,
      })
      .select("id, started_at")
      .single();
    if (errorCorrida || !corrida) return fallo("corrida-no-guardada", errorCorrida);
    const runId = (corrida as { id: string }).id;

    // Paso 9: la red.
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
    const observaciones = resultado.observaciones;

    // Paso 10.
    const guardado: { ok: boolean; observaciones: number; esperadas: number; motivo?: string } = {
      ok: true,
      observaciones: 0,
      esperadas: observaciones.length,
    };
    const { error: errorObservaciones, count: escritas } = await admin.from("geo_grid_observations").insert(
      observaciones.map((o) => ({
        organization_id: organizacion,
        run_id: runId,
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

    const cuenta = denominador(plan.puntos.length, observaciones);
    console.log(
      `[geo-grid] corrida=${runId} puntos=${cuenta.puntos} devolvieron=${cuenta.devolvieronDato} ` +
        `fallaron=${cuenta.fallaron} sin-observacion=${cuenta.sinObservacion}`
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
          startedAt: (corrida as { started_at: string }).started_at,
          finishedAt: terminadaEn,
        },
        denominador: cuenta,
        observaciones,
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
    const ids = [...new Set([q.runId, q.compareTo, q.repeatId, q.shiftedId].filter((v): v is string => !!v))];

    const { data: corridas, error: errorCorridas } = await supabase
      .from("geo_grid_runs")
      .select(
        "id, organization_id, business_id, keyword, target_place_id, center_lat, center_lng, radius_m, step_m, " +
          "n_points, unmatched_value, declared_shift_m, started_at, finished_at"
      )
      .in("id", ids);
    if (errorCorridas) return fallo("corridas-ilegibles", errorCorridas);
    const porId = new Map(((corridas ?? []) as unknown as FilaDeCorrida[]).map((c) => [c.id, c]));
    if (ids.some((id) => !porId.has(id))) return NextResponse.json({ error: "not found" }, { status: 404 });

    const {
      data: filas,
      error: errorObservaciones,
      count,
    } = await supabase
      .from("geo_grid_observations")
      .select("run_id, grid_row, grid_col, lat, lng, observed_at, outcome, position, error_code", { count: "exact" })
      .in("run_id", ids);
    if (errorObservaciones || count === null || count === undefined) {
      return fallo("observaciones-ilegibles", errorObservaciones);
    }
    const leidas = (filas ?? []) as unknown as FilaDeObservacion[];
    // Menos filas que el `count` es una página cortada: una celda que no se leyó
    // se contaría como «sin observación» por un límite de PostgREST.
    if (leidas.length !== count) return fallo("lectura-incompleta");

    const observacionesDe = (id: string) => leidas.filter((f) => f.run_id === id).map(aObservacion);
    const comparable = (id: string) => {
      const c = porId.get(id) as FilaDeCorrida;
      return aCorridaDeLaPrueba(c, observacionesDe(id));
    };

    const principal = porId.get(q.runId) as FilaDeCorrida;
    const observaciones = observacionesDe(q.runId);
    return NextResponse.json({
      ok: true,
      run: principal,
      denominador: denominador(principal.n_points, observaciones),
      observaciones,
      distancia: q.compareTo ? distanciaEntreCorridas(comparable(q.runId), comparable(q.compareTo)) : undefined,
      veredicto:
        q.repeatId && q.shiftedId
          ? veredicto(comparable(q.runId), comparable(q.repeatId), comparable(q.shiftedId))
          : undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(error, 400);
    return apiError(error, 500);
  }
}
