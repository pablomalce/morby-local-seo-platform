/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el ensayo publique, y que el ledger diga que algo salió cuando no salió.
 *
 * Los dos defectos que importan acá no se ven leyendo el módulo: un `dry-run` que
 * llama al publicador se comporta igual que uno que no lo llama mientras el
 * publicador sea un doble que no hace nada — y deja de comportarse igual el día
 * que el doble sea el cliente de Google. Por eso el publicador de estos tests
 * REVIENTA si lo tocan en ensayo, en vez de contar llamadas y afirmar cero: un
 * contador en cero puede ser un publicador al que no se llamó, o un test que
 * miró el contador equivocado.
 *
 * El otro es el silencio: `en-vivo` sin publicador. Si eso devolviera éxito, el
 * ledger quedaría diciendo que se publicó lo que nadie mandó, y nadie lo
 * investigaría nunca porque no habría nada roto que mirar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Cada escritura al ledger, en orden. Es lo que se afirma. */
let escrituras: { verbo: string; valores: Record<string, unknown> }[] = [];

/** Lo que la base contesta, puesto por cada test antes de llamar. */
let respuestaInsert: { data: unknown; error: unknown } = { data: null, error: null };
let respuestaSelect: { data: unknown; error: unknown } = { data: null, error: null };
let respuestaUpdate: { error: unknown } = { error: null };

const createSupabaseAdminClient = vi.fn(() => ({
  from() {
    const enc: Record<string, unknown> = {
      insert: (v: Record<string, unknown>) => {
        escrituras.push({ verbo: "insert", valores: v });
        return {
          select: () => ({ maybeSingle: async () => respuestaInsert }),
        };
      },
      update: (v: Record<string, unknown>) => {
        escrituras.push({ verbo: "update", valores: v });
        return { eq: async () => respuestaUpdate };
      },
      select: () => enc,
      eq: () => enc,
      maybeSingle: async () => respuestaSelect,
    };
    return enc;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

const ENTRADA = {
  organizationId: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00",
  assetId: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22",
  approvedHash: "sha256:aprobado",
  destino: "google_business_profile" as const,
};

/** Una fila recién reservada: nada publicado, ningún intento contra la red. */
const RESERVADA = {
  id: "pub-1",
  status: "pending",
  external_id: null,
  attempts: 0,
};

/**
 * El publicador que no se puede tocar.
 *
 * En ensayo, llamarlo es el defecto. Que reviente hace que el test falle POR el
 * defecto y no por una afirmación sobre un contador.
 */
const PROHIBIDO = {
  publicar: async () => {
    throw new Error("el ensayo llamó a la red");
  },
};

async function mod() {
  return import("@/lib/publishing/transport");
}

beforeEach(() => {
  escrituras = [];
  respuestaInsert = { data: RESERVADA, error: null };
  respuestaSelect = { data: null, error: null };
  respuestaUpdate = { error: null };
  vi.resetModules();
});

describe("el ensayo", () => {
  it("recorre el camino y NO llama a la red", async () => {
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "dry-run", PROHIBIDO);
    expect(r).toEqual({ ok: true, estado: "ensayado", publicationId: "pub-1" });
  });

  it("reserva de verdad, que es lo que lo distingue de un simulacro", async () => {
    // Si no escribiera, no estaría preguntándole a la base si la publicación es
    // admisible: estaría contestando por su cuenta.
    const { publicar } = await mod();
    await publicar(ENTRADA, "dry-run");
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].verbo).toBe("insert");
    expect(escrituras[0].valores).toMatchObject({
      asset_id: ENTRADA.assetId,
      approved_hash: ENTRADA.approvedHash,
      destination: "google_business_profile",
      status: "pending",
    });
  });

  it("NUNCA escribe `published` ni un id de la red", async () => {
    const { publicar } = await mod();
    await publicar(ENTRADA, "dry-run");
    for (const e of escrituras) {
      expect(e.valores.status).not.toBe("published");
      expect(e.valores.external_id).toBeUndefined();
      expect(e.valores.published_at).toBeUndefined();
    }
  });

  it("no cuenta un intento contra la red, porque no lo hubo", async () => {
    const { publicar } = await mod();
    await publicar(ENTRADA, "dry-run");
    expect(escrituras.every((e) => e.valores.attempts === undefined)).toBe(true);
  });
});

describe("en vivo", () => {
  it("sin publicador FALLA, no calla", async () => {
    // Es el defecto más caro que puede tener este módulo: el ledger diciendo que
    // salió algo que nadie mandó.
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "en-vivo");
    expect(r).toEqual({ ok: false, motivo: "sin-transporte" });
    // Y la reserva no queda marcada como publicada por haberlo intentado.
    expect(escrituras.filter((e) => e.verbo === "update")).toHaveLength(0);
  });

  it("publica y anota el id de la red con su fecha", async () => {
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "en-vivo", {
      publicar: async () => ({ ok: true, externalId: "gbp-99" }),
    });
    expect(r).toEqual({
      ok: true,
      estado: "publicado",
      publicationId: "pub-1",
      externalId: "gbp-99",
    });
    const cierre = escrituras.find((e) => e.verbo === "update");
    expect(cierre?.valores).toMatchObject({
      status: "published",
      external_id: "gbp-99",
      attempts: 1,
    });
    // La fecha es lo que el CHECK de la 0016 exige junto con el id.
    expect(typeof cierre?.valores.published_at).toBe("string");
  });

  it("un rechazo de la red deja `failed` con el intento contado", async () => {
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "en-vivo", {
      publicar: async () => ({ ok: false, motivo: "la ficha no admite posts" }),
    });
    expect(r).toEqual({
      ok: false,
      motivo: "red-rechazo",
      publicationId: "pub-1",
      detalle: "la ficha no admite posts",
    });
    expect(escrituras.find((e) => e.verbo === "update")?.valores).toMatchObject({
      status: "failed",
      attempts: 1,
    });
  });

  it("cuenta el intento SOBRE los que ya había, no desde cero", async () => {
    // Un `attempts: 1` fijo se ve idéntico a esto mientras se pruebe con una fila
    // nueva. Con dos intentos previos, un contador que no acumula se delata.
    respuestaInsert = { data: null, error: { code: "23505" } };
    respuestaSelect = {
      data: { id: "pub-1", status: "failed", external_id: null, attempts: 2 },
      error: null,
    };
    const { publicar } = await mod();
    await publicar(ENTRADA, "en-vivo", {
      publicar: async () => ({ ok: true, externalId: "gbp-99" }),
    });
    expect(escrituras.find((e) => e.verbo === "update")?.valores.attempts).toBe(3);
  });

  it("si publicó y no se pudo anotar, NO devuelve éxito", async () => {
    // La red ya publicó y eso no se deshace. Devolver éxito dejaría el post vivo
    // y el ledger diciendo `pending`, sin nadie mirando.
    respuestaUpdate = { error: { message: "se cayó la conexión" } };
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "en-vivo", {
      publicar: async () => ({ ok: true, externalId: "gbp-99" }),
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ motivo: "ledger-ilegible" });
    // Y el motivo nombra el post que quedó vivo, que es lo único que permite ir a
    // buscarlo a mano.
    expect((r as { detalle: string }).detalle).toContain("gbp-99");
  });
});

describe("el reintento", () => {
  it("no duplica: la unicidad decide, y se recupera la fila que ya estaba", async () => {
    respuestaInsert = { data: null, error: { code: "23505" } };
    respuestaSelect = {
      data: { id: "pub-1", status: "published", external_id: "gbp-99", attempts: 1 },
      error: null,
    };
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "en-vivo", PROHIBIDO);
    expect(r).toEqual({
      ok: true,
      estado: "ya-publicado",
      publicationId: "pub-1",
      externalId: "gbp-99",
    });
  });

  it("una fila ya publicada tampoco se re-publica en ensayo", async () => {
    respuestaInsert = { data: null, error: { code: "23505" } };
    respuestaSelect = {
      data: { id: "pub-1", status: "published", external_id: "gbp-99", attempts: 1 },
      error: null,
    };
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "dry-run", PROHIBIDO);
    expect(r).toMatchObject({ estado: "ya-publicado" });
  });

  it("una fila `published` SIN id de la red no se toma por buena", async () => {
    // El CHECK de la 0016 lo impide. Si aparece, el ledger está roto de una
    // manera que este módulo no debe tapar publicando encima.
    respuestaInsert = { data: null, error: { code: "23505" } };
    respuestaSelect = {
      data: { id: "pub-1", status: "published", external_id: null, attempts: 1 },
      error: null,
    };
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "en-vivo", PROHIBIDO);
    expect(r).toMatchObject({ ok: false, motivo: "ledger-ilegible" });
  });
});

describe("lo que la base rechaza", () => {
  it("un asset sin aprobar no se publica, y lo dice la FK", async () => {
    // No hay ningún `if` que compruebe la aprobación acá a propósito: eso sería
    // una copia de lo que la 0015 y la FK compuesta de la 0016 ya garantizan, y
    // una copia diverge.
    respuestaInsert = { data: null, error: { code: "23503" } };
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "en-vivo", PROHIBIDO);
    expect(r).toEqual({ ok: false, motivo: "no-aprobado" });
  });

  it("un error cualquiera del ledger no se confunde con un rechazo de aprobación", async () => {
    respuestaInsert = { data: null, error: { code: "08006", message: "sin conexión" } };
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "dry-run", PROHIBIDO);
    expect(r).toMatchObject({ ok: false, motivo: "ledger-ilegible" });
  });

  it("un insert que no devuelve fila NI error tampoco pasa por bueno", async () => {
    // Es el caso que un doble descuidado nunca produce y la vida sí: sin fila no
    // hay a qué apuntar el cierre, y seguir dejaría un `update` sobre `undefined`.
    respuestaInsert = { data: null, error: null };
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "dry-run", PROHIBIDO);
    expect(r).toMatchObject({ ok: false, motivo: "ledger-ilegible" });
  });

  it("si la unicidad rechaza y después la fila no aparece, se dice", async () => {
    // La rama que un doble que contesta `data: null` junto con el error no mide:
    // acá el error y la ausencia de fila llegan por separado.
    respuestaInsert = { data: null, error: { code: "23505" } };
    respuestaSelect = { data: null, error: { message: "la vista se cayó" } };
    const { publicar } = await mod();
    const r = await publicar(ENTRADA, "en-vivo", PROHIBIDO);
    expect(r).toMatchObject({ ok: false, motivo: "ledger-ilegible" });
    expect((r as { detalle: string }).detalle).toContain("la vista se cayó");
  });
});
