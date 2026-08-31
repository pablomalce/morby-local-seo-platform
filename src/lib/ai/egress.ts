/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que Growth OS gaste dinero en modelos sin que nadie sepa cuánto.
 *
 * R5 pide **un único módulo de egreso de IA con registro de coste**. Las dos
 * mitades se sostienen entre sí: el registro sólo es confiable si no hay otra
 * puerta, y una sola puerta no sirve de nada si al pasar no anota.
 *
 * Al 2026-08-31 no hay ninguna llamada real a un modelo en este repositorio —
 * `generateSeoContent()` devuelve contenido de demostración y el `fetch` de
 * imágenes está comentado. **Ése es el momento de construir esto**, por lo mismo
 * que la custodia de tokens se construyó antes de que hubiera un token: después
 * habría que migrar caminos que ya gastan, y cada uno se migra o se olvida.
 *
 * LA CUENTA ES UNA RESTRICCIÓN, NO UNA COSTUMBRE
 *
 * La `0020` hace que una fila de `agent_runs` no pueda decir `completed` sin sus
 * tokens, su costo y su hora de fin. O sea que este módulo no puede cerrar una
 * corrida «sin datos»: la base lo rechaza. Un registro que depende de que el que
 * escribe se acuerde es una intención, y la primera vez que alguien agrega un
 * camino con prisa la intención se pierde sin que nada lo diga.
 *
 * UN MODELO SIN PRECIO NO CUESTA CERO
 *
 * Es la decisión que más pesa acá y la más fácil de tomar mal. Si `costOf()`
 * devolviera 0 para un modelo que no está en la tabla, el día que alguien apunte
 * a uno nuevo el gasto seguiría corriendo y la contabilidad diría que no pasó
 * nada. **Un cero inventado se suma**; un fallo se ve.
 *
 * Así que un modelo desconocido es un error, y la corrida se cierra como
 * `failed` con el motivo escrito. Se pierde la llamada, que se puede reintentar;
 * no se pierde el rastro, que no se puede reconstruir.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * El precio de cada modelo, en dólares por millón de tokens.
 *
 * ESTO SE VENCE, Y POR ESO LLEVA FECHA. Los precios de los proveedores cambian y
 * una tabla sin fecha no deja saber si lo que está escrito todavía vale. `desde`
 * es cuándo se anotó acá, no cuándo el proveedor lo publicó — es lo único que
 * este repositorio puede afirmar de primera mano.
 *
 * Y por eso `tokens_used` se guarda además del costo: con los tokens, un precio
 * corregido se puede aplicar hacia atrás. Con el costo solo, no.
 */
export interface ModelPrice {
  /** Dólares por millón de tokens de entrada. */
  inputPerMillion: number;
  /** Dólares por millón de tokens de salida. */
  outputPerMillion: number;
  /** Cuándo se anotó este precio en este repositorio. ISO 8601, sólo fecha. */
  desde: string;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6, desde: "2026-08-31" },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10, desde: "2026-08-31" },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5, desde: "2026-08-31" },
};

export type CostResult =
  | { ok: true; usd: number }
  /** El modelo no está en la tabla. NO vale cero: ver el encabezado. */
  | { ok: false; reason: "unknown-model" }
  /** Tokens negativos o no enteros. Una resta mal puesta se ve así. */
  | { ok: false; reason: "bad-tokens" };

/**
 * Lo que costó una llamada.
 *
 * Se redondea a cuatro decimales porque `agent_runs.cost_usd` es
 * `numeric(10,4)`: redondear acá y no dejar que lo haga la base es lo que hace
 * que el número que este módulo calcula y el que queda guardado sean el mismo.
 *
 * Y se redondea HACIA ARRIBA. Una llamada barata que redondea a cero deja de
 * existir en la suma del mes, y muchas llamadas baratas son exactamente el caso
 * que hay que poder ver. Preferimos sobrestimar por una diezmilésima antes que
 * perder la fila.
 */
export function costOf(model: string, inputTokens: number, outputTokens: number): CostResult {
  const precio = MODEL_PRICES[model];
  if (!precio) return { ok: false, reason: "unknown-model" };

  for (const t of [inputTokens, outputTokens]) {
    if (!Number.isInteger(t) || t < 0) return { ok: false, reason: "bad-tokens" };
  }

  const crudo =
    (inputTokens / 1_000_000) * precio.inputPerMillion +
    (outputTokens / 1_000_000) * precio.outputPerMillion;

  // `toFixed(6)` antes del `ceil` para que el error de coma flotante no empuje
  // un valor que ya cae exacto en la grilla una diezmilésima para arriba. Eso sí
  // se acumula, llamada por llamada.
  const usd = Math.ceil(Number((crudo * 10_000).toFixed(6))) / 10_000;
  return { ok: true, usd };
}

/** Lo que el llamador dice de la corrida, antes de saber cómo termina. */
export interface EgressContext {
  organizationId: string;
  businessId: string;
  /** Qué agente la pidió, para poder atribuir el gasto a una función del producto. */
  agentId: string;
  scope: string;
  scopeId: string;
  model: string;
}

/** Lo que la llamada al proveedor devuelve, además de su resultado. */
export interface EgressUsage {
  inputTokens: number;
  outputTokens: number;
}

export type EgressResult<T> =
  | { ok: true; value: T; usd: number; tokens: number; runId: string | null }
  | { ok: false; reason: "unknown-model" | "bad-tokens" | "call-failed"; runId: string | null };

/**
 * LA ÚNICA PUERTA. Toda llamada a un modelo pasa por acá.
 *
 * `llamar` hace la petición al proveedor y devuelve su resultado junto con los
 * tokens que consumió. Este módulo no sabe hablar con ningún proveedor a
 * propósito: lo que garantiza es la contabilidad, y meter acá la forma de cada
 * API haría que agregar un proveedor fuera tocar el lugar donde vive la garantía.
 *
 * `src/lib/ai/__tests__/sinAtajos.test.ts` es la otra mitad: comprueba que ningún
 * archivo fuera de `src/lib/ai/` hable con una API de IA. Sin ese test, esto es
 * una puerta con la pared al lado sin construir.
 */
export async function runAi<T>(
  ctx: EgressContext,
  llamar: () => Promise<{ value: T; usage: EgressUsage }>
): Promise<EgressResult<T>> {
  const admin = createSupabaseAdminClient();
  const startedAt = new Date().toISOString();

  // La fila se abre ANTES de llamar, y con `running`. Si el proceso se cae en el
  // medio, queda una corrida abierta —visible, contable como incidente— en vez de
  // nada. Abrirla después dejaría el gasto de una llamada que se cortó sin
  // ninguna huella, que es la forma más cara de no enterarse.
  const { data: abierta } = await admin
    .from("agent_runs")
    .insert({
      organization_id: ctx.organizationId,
      business_id: ctx.businessId,
      agent_id: ctx.agentId,
      scope: ctx.scope,
      scope_id: ctx.scopeId,
      status: "running",
      started_at: startedAt,
      input: { model: ctx.model },
    })
    .select("id")
    .maybeSingle();

  const runId = (abierta?.id as string | undefined) ?? null;

  const cerrarFallida = async (mensaje: string) => {
    if (!runId) return;
    // `failed` no lleva costo obligatorio: el esquema no puede saber si el
    // proveedor cobró. Ver el encabezado de la 0020.
    await admin
      .from("agent_runs")
      .update({ status: "failed", error: mensaje, finished_at: new Date().toISOString() })
      .eq("id", runId);
  };

  let salida: { value: T; usage: EgressUsage };
  try {
    salida = await llamar();
  } catch (e) {
    await cerrarFallida(e instanceof Error ? e.message : "la llamada falló");
    return { ok: false, reason: "call-failed", runId };
  }

  const costo = costOf(ctx.model, salida.usage.inputTokens, salida.usage.outputTokens);
  if (!costo.ok) {
    // La llamada YA se hizo y ya se pagó. No poder ponerle precio no es motivo
    // para no dejar rastro: se cierra como fallida con el motivo escrito, y el
    // que lea la tabla ve que hubo una llamada sin contabilizar en vez de no ver
    // nada.
    await cerrarFallida(`no se pudo calcular el costo: ${costo.reason} (${ctx.model})`);
    return { ok: false, reason: costo.reason, runId };
  }

  const tokens = salida.usage.inputTokens + salida.usage.outputTokens;

  if (runId) {
    await admin
      .from("agent_runs")
      .update({
        status: "completed",
        tokens_used: tokens,
        cost_usd: costo.usd,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  return { ok: true, value: salida.value, usd: costo.usd, tokens, runId };
}
