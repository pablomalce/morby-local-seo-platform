/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la contabilidad del egreso sume mal, o que no sume.
 *
 * Los dos casos que más importan y que un test descuidado deja pasar: un modelo
 * sin precio que se cuenta como cero, y una llamada barata que redondea a cero.
 * Los dos producen un total que se queda corto, y un total que se queda corto no
 * llama la atención de nadie.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Cada escritura a `agent_runs`, en orden. Es lo que se afirma. */
let escrituras: { verbo: string; valores: Record<string, unknown> }[] = [];

const createSupabaseAdminClient = vi.fn(() => ({
  from() {
    const enc: Record<string, unknown> = {
      insert: (v: Record<string, unknown>) => {
        escrituras.push({ verbo: "insert", valores: v });
        return enc;
      },
      update: (v: Record<string, unknown>) => {
        escrituras.push({ verbo: "update", valores: v });
        return enc;
      },
      select: () => enc,
      eq: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: async () => ({ data: { id: "run-1" }, error: null }),
    };
    return enc;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

const CTX = {
  organizationId: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00",
  businessId: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1b11",
  agentId: "content",
  scope: "business",
  scopeId: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1b11",
  model: "gpt-4o-mini",
};

async function mod() {
  return import("@/lib/ai/egress");
}

beforeEach(() => {
  escrituras = [];
  vi.resetModules();
});

describe("cuánto costó", () => {
  it("un millón de tokens de entrada de gpt-4o-mini cuesta lo que dice la tabla", async () => {
    // El literal escrito, no la tabla importada: si mañana alguien cambia el
    // precio, lo que tiene que ponerse rojo es esto.
    const { costOf } = await mod();
    expect(costOf("gpt-4o-mini", 1_000_000, 0)).toEqual({ ok: true, usd: 0.15 });
    expect(costOf("gpt-4o-mini", 0, 1_000_000)).toEqual({ ok: true, usd: 0.6 });
    expect(costOf("gpt-4o", 1_000_000, 1_000_000)).toEqual({ ok: true, usd: 12.5 });
  });

  it("suma entrada y salida", async () => {
    const { costOf } = await mod();
    // 1000 de entrada = 0.00015, 2000 de salida = 0.0012 -> 0.00135 -> 0.0014
    expect(costOf("gpt-4o-mini", 1000, 2000)).toEqual({ ok: true, usd: 0.0014 });
  });

  it("una llamada barata NO redondea a cero", async () => {
    // Muchas llamadas baratas son el caso que hay que poder ver. Con redondeo al
    // más cercano, todas éstas valdrían 0 y la suma del mes diría que no se gastó
    // nada.
    const { costOf } = await mod();
    const r = costOf("gpt-4o-mini", 1, 1);
    expect(r).toEqual({ ok: true, usd: 0.0001 });
  });

  it("un valor que cae exacto en la grilla no se infla", async () => {
    // El otro lado del redondeo hacia arriba: si empujara una diezmilésima
    // siempre, el error se acumularía llamada por llamada.
    const { costOf } = await mod();
    expect(costOf("gpt-4o-mini", 1_000_000, 0)).toEqual({ ok: true, usd: 0.15 });
    expect(costOf("gpt-4o", 0, 0)).toEqual({ ok: true, usd: 0 });
  });

  it("un modelo sin precio NO cuesta cero", async () => {
    // Es la decisión que más pesa del módulo. Un cero inventado se suma; un
    // fallo se ve.
    const { costOf } = await mod();
    expect(costOf("gpt-5-que-no-existe", 1_000_000, 1_000_000)).toEqual({
      ok: false,
      reason: "unknown-model",
    });
  });

  it("tokens negativos o fraccionarios se rechazan", async () => {
    // Una resta mal puesta —salida menos entrada, por ejemplo— se ve así.
    const { costOf } = await mod();
    expect(costOf("gpt-4o-mini", -1, 0)).toEqual({ ok: false, reason: "bad-tokens" });
    expect(costOf("gpt-4o-mini", 0, -1)).toEqual({ ok: false, reason: "bad-tokens" });
    expect(costOf("gpt-4o-mini", 1.5, 0)).toEqual({ ok: false, reason: "bad-tokens" });
  });
});

describe("la tabla de precios lleva fecha", () => {
  it("cada modelo dice desde cuándo está anotado su precio", async () => {
    // Los precios se vencen. Una tabla sin fecha no deja saber si lo escrito
    // todavía vale, y con los tokens guardados un precio corregido se puede
    // aplicar hacia atrás.
    const { MODEL_PRICES } = await mod();
    const modelos = Object.keys(MODEL_PRICES);
    expect(modelos.length).toBeGreaterThan(0);
    for (const m of modelos) {
      expect(MODEL_PRICES[m].desde, m).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("la corrida queda registrada", () => {
  it("abre la fila ANTES de llamar, con `running`", async () => {
    // Si el proceso se cae en el medio queda una corrida abierta —visible— en vez
    // de nada. Abrirla después dejaría el gasto de una llamada cortada sin huella.
    const { runAi } = await mod();
    let abiertaAntes = false;
    await runAi(CTX, async () => {
      abiertaAntes = escrituras.some(
        (e) => e.verbo === "insert" && e.valores.status === "running"
      );
      return { value: "ok", usage: { inputTokens: 1000, outputTokens: 2000 } };
    });
    expect(abiertaAntes, "la fila se abrió después de llamar al proveedor").toBe(true);
  });

  it("cierra como `completed` con tokens, costo y hora de fin", async () => {
    // Las tres juntas: la 0020 no deja cerrar `completed` sin ellas, así que un
    // cierre incompleto lo rechazaría la base.
    const { runAi } = await mod();
    const r = await runAi(CTX, async () => ({
      value: "texto",
      usage: { inputTokens: 1000, outputTokens: 2000 },
    }));

    expect(r.ok).toBe(true);
    const cierre = escrituras.find((e) => e.verbo === "update");
    expect(cierre!.valores.status).toBe("completed");
    expect(cierre!.valores.tokens_used).toBe(3000);
    expect(cierre!.valores.cost_usd).toBe(0.0014);
    expect(cierre!.valores.finished_at).toEqual(expect.any(String));
  });

  it("una llamada que tira se cierra como `failed`, no se pierde", async () => {
    const { runAi } = await mod();
    const r = await runAi(CTX, async () => {
      throw new Error("el proveedor cortó");
    });

    expect(r).toMatchObject({ ok: false, reason: "call-failed" });
    const cierre = escrituras.find((e) => e.verbo === "update");
    expect(cierre!.valores.status).toBe("failed");
    expect(cierre!.valores.error).toContain("el proveedor cortó");
    // Sin costo: el esquema no puede saber si el proveedor cobró, y un cero
    // inventado se suma.
    expect(cierre!.valores.cost_usd).toBeUndefined();
  });

  it("un modelo sin precio deja rastro igual, porque la llamada YA se pagó", async () => {
    // No poder ponerle precio no es motivo para no dejar rastro. Quien lea la
    // tabla ve que hubo una llamada sin contabilizar en vez de no ver nada.
    const { runAi } = await mod();
    const r = await runAi({ ...CTX, model: "gpt-5-que-no-existe" }, async () => ({
      value: "texto",
      usage: { inputTokens: 1000, outputTokens: 2000 },
    }));

    expect(r).toMatchObject({ ok: false, reason: "unknown-model" });
    const cierre = escrituras.find((e) => e.verbo === "update");
    expect(cierre!.valores.status).toBe("failed");
    expect(cierre!.valores.error).toContain("unknown-model");
    expect(cierre!.valores.error).toContain("gpt-5-que-no-existe");
  });

  it("escribe el eje de tenant, que la aplicación tiene que mandar", async () => {
    // La 0012 borró los triggers que lo llenaban. Sin esta columna el INSERT lo
    // rechaza el NOT NULL.
    const { runAi } = await mod();
    await runAi(CTX, async () => ({
      value: "x",
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const apertura = escrituras.find((e) => e.verbo === "insert");
    expect(apertura!.valores.organization_id).toBe(CTX.organizationId);
    expect(apertura!.valores.business_id).toBe(CTX.businessId);
  });

  it("escribe con el cliente de SERVICIO", async () => {
    const { runAi } = await mod();
    await runAi(CTX, async () => ({ value: "x", usage: { inputTokens: 1, outputTokens: 1 } }));
    expect(createSupabaseAdminClient).toHaveBeenCalled();
  });
});
