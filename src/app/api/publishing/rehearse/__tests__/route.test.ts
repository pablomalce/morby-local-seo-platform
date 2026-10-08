/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el transporte vuelva a ser un módulo que nadie llama, y que esta ruta lo
 * llame MAL.
 *
 * `transport.test.ts` prueba el camino del ledger con 19 tests, y seguiría
 * entero en verde con `route.ts` borrado: no puede ver el cableado. Lo que se
 * afirma acá es lo que sólo se rompe en el enganche —con qué se llamó, en qué
 * modo, y cuándo NO se llamó— porque el defecto que este proyecto ya se comió es
 * exactamente ése.
 *
 * EL DOBLE DEL TRANSPORTE ES UN ESPÍA, NO UN SIMULACRO
 *
 * Guarda los argumentos. Sin eso, un test que sólo mirara el código HTTP pasaría
 * con una ruta que llama `publicar` con el hash que mandó el cliente, o en
 * `en-vivo`, o sobre la organización equivocada — las tres cosas que este
 * archivo existe para impedir.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_DEL_ASSET = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const ASSET = "7d703707-4f9d-43bf-9305-6bc22eddf45f";
const HASH_APROBADO = "9e107d9d372bb6826bd81d3542a419d6";

/** Quién dice ser el usuario. */
let usuario: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };

/**
 * Lo que la RLS deja ver de `content_assets`, y si la lectura falló.
 *
 * Van por separado a propósito: un doble que devolviera `data: null` JUNTO con el
 * error no mediría la rama del error —caería por la fila ausente, que es otra
 * línea—. El caso que importa es el que trae error Y algo en `data`.
 */
let fila: { id: string; organization_id: string; approved_hash: string | null } | null = null;
let errorLectura: { message: string } | null = null;

/**
 * La membresía de quien llama, leída como el usuario. Por defecto manager: el
 * rol más bajo que ensaya y publica (D4 de H4.1).
 */
let membresias: { role: string; state: string }[] = [];
let errorMembresia: { message: string } | null = null;
let filtrosDeMembresia: Record<string, string> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: (tabla: string) =>
      tabla === "org_members"
        ? {
            select: () => {
              const cadena = {
                eq: (col: string, val: string) => {
                  filtrosDeMembresia[col] = val;
                  return cadena;
                },
                limit: async () => ({ data: errorMembresia ? null : membresias, error: errorMembresia }),
              };
              return cadena;
            },
          }
        : {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: fila, error: errorLectura }),
              }),
            }),
          },
  }),
}));

/** Toda salida a la red. Un ensayo no sale: tiene que quedar en cero siempre. */
let salidas = 0;

/** Cada llamada al transporte, con TODOS sus argumentos. */
let llamadas: unknown[][] = [];
let respuesta: unknown = { ok: true, estado: "ensayado", publicationId: "pub-1" };

/** Cuando está puesto, `publicar()` TIRA: una excepción del servidor, no del pedido. */
let explota: Error | null = null;

vi.mock("@/lib/publishing/transport", () => ({
  publicar: async (...args: unknown[]) => {
    llamadas.push(args);
    if (explota) throw explota;
    return respuesta;
  },
}));

const { POST } = await import("../route");

// Una IP por pedido, contada aparte: con la IP derivada de `llamadas`, los 403
// —que no llaman al transporte— repetían la misma y el limitador de 20/min
// contestaba 429 antes de que la ruta decidiera nada.
let pedidos = 0;
function pedido(cuerpo: unknown): Request {
  pedidos += 1;
  return new Request("http://localhost/api/publishing/rehearse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.${Math.floor(pedidos / 250)}.${pedidos % 250}`,
    },
    body: JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  usuario = { id: "11111111-1111-4111-8111-111111111111" };
  fila = { id: ASSET, organization_id: ORG_DEL_ASSET, approved_hash: HASH_APROBADO };
  membresias = [{ role: "manager", state: "active" }];
  errorMembresia = null;
  filtrosDeMembresia = {};
  salidas = 0;
  vi.stubGlobal("fetch", async () => {
    salidas += 1;
    throw new Error("el ensayo no sale a la red");
  });
  errorLectura = null;
  llamadas = [];
  respuesta = { ok: true, estado: "ensayado", publicationId: "pub-1" };
});

describe("quién llama al transporte", () => {
  it("lo llama con el hash del ASSET, en `dry-run`, y sin publicador", async () => {
    const res = await POST(pedido({ assetId: ASSET }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, estado: "ensayado", publicationId: "pub-1" });

    expect(llamadas).toHaveLength(1);
    const [entrada, modo, publicador] = llamadas[0];
    expect(entrada).toEqual({
      organizationId: ORG_DEL_ASSET,
      assetId: ASSET,
      approvedHash: HASH_APROBADO,
      destino: "google_business_profile",
    });
    // El modo es un literal de quien llama. Si algún día llega en el cuerpo del
    // pedido, esta línea es la que lo tiene que impedir.
    expect(modo).toBe("dry-run");
    // Y nunca un publicador: un ensayo que pudiera publicar no es un ensayo.
    expect(publicador).toBeUndefined();
  });

  it("toma la organización del asset y NO la que mande quien llama", async () => {
    // El cuerpo trae una organización ajena. Si la ruta la usara, la reserva
    // quedaría escrita en la organización de quien pide, sobre el asset de otro.
    await POST(pedido({ assetId: ASSET, organizationId: "00000000-0000-4000-8000-000000000000" }));

    expect((llamadas[0][0] as { organizationId: string }).organizationId).toBe(ORG_DEL_ASSET);
  });
});

describe("cuándo NO se llama al transporte", () => {
  it("sin sesión: 401, y el ledger no se toca", async () => {
    usuario = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(401);
    expect(llamadas).toHaveLength(0);
  });

  it("un no-miembro no puede ensayar sobre el asset de otra organización", async () => {
    // La RLS de la `0014` le esconde la fila: la lectura vuelve vacía, igual que
    // con un id inventado. Por eso son 404 y no 403 — quien no es miembro no se
    // entera de que el asset existe.
    fila = null;
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(404);
    // Lo que de verdad se está midiendo: NO se reservó ninguna fila a su nombre.
    expect(llamadas).toHaveLength(0);
  });

  it("un asset sin aprobar: 409, y sin mandar un hash que no existe", async () => {
    fila = { id: ASSET, organization_id: ORG_DEL_ASSET, approved_hash: null };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, motivo: "no-aprobado" });
    expect(llamadas).toHaveLength(0);
  });

  it("si la lectura del asset falla, no publica ni inventa un 404", async () => {
    errorLectura = { message: "connection reset" };
    fila = { id: ASSET, organization_id: ORG_DEL_ASSET, approved_hash: HASH_APROBADO };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(502);
    expect(llamadas).toHaveLength(0);
  });

  it("un assetId que no es uuid no llega a la base", async () => {
    const res = await POST(pedido({ assetId: "no-es-un-uuid" }));
    expect(res.status).toBe(400);
    expect(llamadas).toHaveLength(0);
  });
});

describe("lo que contesta cuando el transporte dice que no", () => {
  it("`no-aprobado` es 409 y nunca 200", async () => {
    respuesta = { ok: false, motivo: "no-aprobado" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, motivo: "no-aprobado" });
  });

  it("`ledger-ilegible` es 502 y nunca 200", async () => {
    respuesta = { ok: false, motivo: "ledger-ilegible", detalle: "sin conexión" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(502);
  });

  it("y el `detalle` NO sale al navegador: sólo el motivo (defecto medido el 2026-09-26 — el detalle del transporte es el mensaje crudo de Postgres, con nombre de constraint adentro, y llegaba al cliente)", async () => {
    respuesta = {
      ok: false,
      motivo: "ledger-ilegible",
      detalle: 'duplicate key value violates unique constraint "publications_asset_id_destination_key"',
    };

    const res = await POST(pedido({ assetId: ASSET }));

    expect(res.status).toBe(502);
    // El cuerpo entero, no `toMatchObject`: una clave de más es exactamente el
    // defecto, así que no puede colarse por debajo de la aserción.
    expect(await res.json()).toEqual({ ok: false, motivo: "ledger-ilegible" });
  });

  it("una excepción del servidor es 500, no 400 (defecto medido el 2026-09-26: el catch-all mandaba 400 a todo, y la pantalla lo leía como «el id no es un uuid» — o sea se culpaba a sí misma por algo que se rompió del otro lado)", async () => {
    explota = new Error("boom");
    try {
      const res = await POST(pedido({ assetId: ASSET }));
      expect(res.status).toBe(500);
    } finally {
      explota = null;
    }
  });

  it("y un pedido que de verdad está mal sigue siendo 400 (cerrar de más también es un defecto: si todo fuera 500, la pantalla no sabría cuándo el error es suyo)", async () => {
    const res = await POST(pedido({ assetId: "no-es-un-uuid" }));
    expect(res.status).toBe(400);
  });

  it("tampoco en los otros motivos: el 500 y el 409 del transporte mandan sólo el motivo", async () => {
    for (const [motivo, status] of [["sin-transporte", 500], ["no-aprobado", 409]] as const) {
      respuesta = { ok: false, motivo, detalle: "no mires esto" };
      const res = await POST(pedido({ assetId: ASSET }));
      expect(res.status, motivo).toBe(status);
      expect(await res.json(), motivo).toEqual({ ok: false, motivo });
    }
  });

  it("un motivo que acá no debería pasar tampoco se lee como éxito", async () => {
    // `sin-transporte` no puede ocurrir en `dry-run`. Si ocurriera, sería que el
    // modo dejó de ser el que esta ruta cree: 500, no 200.
    respuesta = { ok: false, motivo: "sin-transporte" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });

  it("`ya-publicado` es un 200, y no reintenta nada", async () => {
    respuesta = { ok: true, estado: "ya-publicado", publicationId: "pub-1", externalId: "gbp-9" };
    const res = await POST(pedido({ assetId: ASSET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      estado: "ya-publicado",
      publicationId: "pub-1",
      externalId: "gbp-9",
    });
    expect(llamadas).toHaveLength(1);
  });
});

describe("quién ensaya: el rol, en la organización del asset (H4.1, D4)", () => {
  // Las negativas, en la MISMA organización donde el manager sí ensaya: el
  // client lee el asset —es contenido suyo—, así que lo único que cambia es el
  // rol. Y sin esta comprobación el client reservaba en el ledger con
  // `service_role`, que ninguna policy frena.
  for (const rol of ["client", "viewer", "editor"]) {
    it(`un ${rol} de la organización recibe 403: el transporte no se llama y nada sale a la red`, async () => {
      membresias = [{ role: rol, state: "active" }];

      const res = await POST(pedido({ assetId: ASSET }));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, motivo: "sin-permiso" });
      expect(llamadas).toHaveLength(0);
      expect(salidas).toBe(0);
    });
  }

  for (const rol of ["manager", "admin", "owner"]) {
    it(`un ${rol} de la misma organización ensaya`, async () => {
      membresias = [{ role: rol, state: "active" }];

      const res = await POST(pedido({ assetId: ASSET }));

      expect(res.status).toBe(200);
      expect(llamadas).toHaveLength(1);
    });
  }

  it("el rol se pregunta en la organización DEL ASSET, no en la del pedido", async () => {
    await POST(pedido({ assetId: ASSET, organizationId: "00000000-0000-4000-8000-000000000000" }));

    expect(filtrosDeMembresia).toEqual({
      user_id: "11111111-1111-4111-8111-111111111111",
      organization_id: ORG_DEL_ASSET,
    });
  });

  it("la negativa va ANTES de mirar el sello: un client sobre un borrador también es 403", async () => {
    membresias = [{ role: "client", state: "active" }];
    fila = { id: ASSET, organization_id: ORG_DEL_ASSET, approved_hash: null };

    const res = await POST(pedido({ assetId: ASSET }));

    expect(res.status).toBe(403);
    expect(llamadas).toHaveLength(0);
  });

  it("si la membresía no se puede leer, 502 y el ledger no se toca", async () => {
    errorMembresia = { message: "connection reset" };

    const res = await POST(pedido({ assetId: ASSET }));

    expect(res.status).toBe(502);
    expect(llamadas).toHaveLength(0);
  });
});
