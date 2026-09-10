/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la ruta que PUBLICA DE VERDAD llame mal al transporte, y que el publicador
 * se arme cuando no hay con qué.
 *
 * `transport.test.ts` prueba el ledger con 19 tests y
 * `googleBusinessProfile.test.ts` prueba el protocolo: los dos seguirían enteros
 * en verde con `route.ts` borrado. Lo que se afirma acá es lo que sólo se rompe
 * en el enganche — con qué se llamó, en qué modo, y sobre todo CUÁNDO NO se
 * llamó ni se armó nada.
 *
 * LO QUE MÁS IMPORTA ACÁ Y NO EN EL ENSAYO
 *
 * El ensayo, si se equivoca, escribe una fila de más en el ledger. Esto, si se
 * equivoca, **publica en la ficha de un cliente**, que desde acá es
 * irreversible. Por eso la mitad de este archivo son casos donde NO tiene que
 * pasar nada: sin cuenta, sin mapeo, sin token, sin sesión, sin aprobación.
 *
 * EL DOBLE DEL TRANSPORTE ES UN ESPÍA
 *
 * Guarda los argumentos, incluido el TERCERO — el publicador. Un test que sólo
 * mirara el código HTTP pasaría con una ruta que arma el publicador con una
 * cuenta inventada, que es exactamente el defecto que este archivo existe para
 * impedir.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_DEL_ASSET = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const ASSET = "7d703707-4f9d-43bf-9305-6bc22eddf45f";
const HASH_APROBADO = "9e107d9d372bb6826bd81d3542a419d6";
const CUERPO = "El texto que alguien aprobó.";
const FICHA = "locations/123";

/** Quién dice ser el usuario. */
let usuario: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };

/** Lo que la RLS deja ver de `content_assets`, y si la lectura falló. */
let asset: {
  id: string;
  organization_id: string;
  approved_hash: string | null;
  body: string;
} | null = null;
let errorLectura: { message: string } | null = null;

/** El mapeo vivo de Business Profile, o su ausencia. */
let propiedad: { property_ref: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          // La lectura del asset termina acá.
          maybeSingle: async () => ({ data: asset, error: errorLectura }),
          // La del mapeo encadena provider y `unmapped_at is null`.
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: propiedad, error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

/** Cada llamada al transporte, con TODOS sus argumentos. */
let llamadas: unknown[][] = [];
let respuesta: unknown = {
  ok: true,
  estado: "publicado",
  publicationId: "pub-1",
  externalId: "accounts/1/locations/123/localPosts/9",
};

vi.mock("@/lib/publishing/transport", () => ({
  publicar: async (...args: unknown[]) => {
    llamadas.push(args);
    return respuesta;
  },
}));

/** Cómo contesta el custodio del token de la agencia. */
let token: { ok: boolean; accessToken?: string } = { ok: true, accessToken: "no-es-un-token" };
vi.mock("@/lib/integrations/google/tokenStore", () => ({
  agencyAccessToken: async () => token,
}));

/** Con qué se armó el publicador, si es que se armó. */
let publicadoresArmados: Array<{ accountId: string; accessToken: string }> = [];
vi.mock("@/lib/publishing/googleBusinessProfile", () => ({
  publicadorDeBusinessProfile: (deps: { accountId: string; accessToken: string }) => {
    publicadoresArmados.push({ accountId: deps.accountId, accessToken: deps.accessToken });
    return { publicar: async () => ({ ok: true, externalId: "x" }) };
  },
}));

vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => null }));

import { POST } from "../route";

const pedir = (cuerpo: unknown) =>
  POST(
    new Request("http://localhost/api/publishing/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    })
  );

beforeEach(() => {
  usuario = { id: "11111111-1111-4111-8111-111111111111" };
  asset = {
    id: ASSET,
    organization_id: ORG_DEL_ASSET,
    approved_hash: HASH_APROBADO,
    body: CUERPO,
  };
  errorLectura = null;
  propiedad = { property_ref: FICHA };
  token = { ok: true, accessToken: "no-es-un-token" };
  llamadas = [];
  publicadoresArmados = [];
  respuesta = {
    ok: true,
    estado: "publicado",
    publicationId: "pub-1",
    externalId: "accounts/1/locations/123/localPosts/9",
  };
  process.env.GOOGLE_BUSINESS_ACCOUNT_ID = "accounts/1";
});

describe("POST /api/publishing/publish — el cableado", () => {
  it("publica en vivo, y el modo es un literal de la ruta", async () => {
    const res = await pedir({ assetId: ASSET });

    expect(res.status).toBe(200);
    expect(llamadas).toHaveLength(1);
    // El segundo argumento es el modo. Si esto dijera "dry-run", la ruta que
    // publica no publicaría y nadie se enteraría hasta mirar la ficha.
    expect(llamadas[0][1]).toBe("en-vivo");
  });

  it("toma la organización y el hash del ASSET, no de quien llama", async () => {
    // Se manda una organización distinta a propósito: si la ruta la leyera del
    // cuerpo, reservaría sobre el asset ajeno en la organización propia.
    await pedir({ assetId: ASSET, organizationId: "00000000-0000-4000-8000-000000000000" });

    expect(llamadas[0][0]).toMatchObject({
      organizationId: ORG_DEL_ASSET,
      assetId: ASSET,
      approvedHash: HASH_APROBADO,
      destino: "google_business_profile",
    });
  });

  it("inyecta un publicador armado con la cuenta configurada", async () => {
    await pedir({ assetId: ASSET });

    expect(publicadoresArmados).toHaveLength(1);
    expect(publicadoresArmados[0].accountId).toBe("accounts/1");
    // El tercer argumento existe: sin él, `publicar` contestaría sin-transporte.
    expect(llamadas[0][2]).toBeDefined();
  });
});

describe("POST /api/publishing/publish — cuándo NO se publica", () => {
  it("sin sesión: 401, y el transporte ni se toca", async () => {
    usuario = null;

    const res = await pedir({ assetId: ASSET });

    expect(res.status).toBe(401);
    expect(llamadas).toHaveLength(0);
    expect(publicadoresArmados).toHaveLength(0);
  });

  it("un asset que la RLS no deja ver: 404, igual que un id inventado", async () => {
    asset = null;

    const res = await pedir({ assetId: ASSET });

    expect(res.status).toBe(404);
    expect(llamadas).toHaveLength(0);
  });

  it("una lectura que FALLÓ no es un asset ausente: 502, y no se publica", async () => {
    errorLectura = { message: "boom" };

    const res = await pedir({ assetId: ASSET });

    expect(res.status).toBe(502);
    expect(llamadas).toHaveLength(0);
  });

  it("sin aprobación: 409, y no se arma ningún publicador", async () => {
    asset = { id: ASSET, organization_id: ORG_DEL_ASSET, approved_hash: null, body: CUERPO };

    const res = await pedir({ assetId: ASSET });

    expect(res.status).toBe(409);
    expect(llamadas).toHaveLength(0);
    expect(publicadoresArmados).toHaveLength(0);
  });
});

describe("POST /api/publishing/publish — falta una pieza: falla con nombre", () => {
  /**
   * Los tres casos de abajo son el estado de producción al 2026-09-10 y por eso
   * importan más que el camino feliz. En los tres, la ruta NO arma el publicador
   * y el transporte contesta `sin-transporte`. Lo que se afirma es que **no se
   * inventa nada para seguir adelante**.
   */
  beforeEach(() => {
    respuesta = { ok: false, motivo: "sin-transporte" };
  });

  it("sin GOOGLE_BUSINESS_ACCOUNT_ID: 503, y sin publicador", async () => {
    delete process.env.GOOGLE_BUSINESS_ACCOUNT_ID;

    const res = await pedir({ assetId: ASSET });

    expect(res.status).toBe(503);
    expect(publicadoresArmados).toHaveLength(0);
    // El tercer argumento es `undefined`: eso es lo que el transporte lee.
    expect(llamadas[0][2]).toBeUndefined();
  });

  it("sin mapeo vivo de la ficha: 503, y no se publica en una ficha inventada", async () => {
    propiedad = null;

    const res = await pedir({ assetId: ASSET });

    expect(res.status).toBe(503);
    expect(publicadoresArmados).toHaveLength(0);
    expect(llamadas[0][2]).toBeUndefined();
  });

  it("sin token de la agencia: 503, y no se llama a Google sin credencial", async () => {
    token = { ok: false };

    const res = await pedir({ assetId: ASSET });

    expect(res.status).toBe(503);
    expect(publicadoresArmados).toHaveLength(0);
    expect(llamadas[0][2]).toBeUndefined();
  });

  it("503 y no 500, porque falta configuración y no hay ningún bug que buscar", async () => {
    delete process.env.GOOGLE_BUSINESS_ACCOUNT_ID;

    const res = await pedir({ assetId: ASSET });
    const cuerpo = await res.json();

    expect(res.status).toBe(503);
    expect(cuerpo.motivo).toBe("sin-transporte");
    expect(cuerpo.ok).toBe(false);
  });
});

describe("POST /api/publishing/publish — ningún fallo contesta 200", () => {
  it("la red rechazó: 502, y el motivo viaja", async () => {
    respuesta = { ok: false, motivo: "red-rechazo", publicationId: "pub-1", detalle: "http 403" };

    const res = await pedir({ assetId: ASSET });
    const cuerpo = await res.json();

    expect(res.status).toBe(502);
    expect(cuerpo.motivo).toBe("red-rechazo");
  });

  it("el ledger no se pudo leer: 502", async () => {
    respuesta = { ok: false, motivo: "ledger-ilegible", detalle: "23502" };

    expect((await pedir({ assetId: ASSET })).status).toBe(502);
  });

  it("la base rechazó la reserva por aprobación: 409", async () => {
    respuesta = { ok: false, motivo: "no-aprobado" };

    expect((await pedir({ assetId: ASSET })).status).toBe(409);
  });

  it("un reintento que ya estaba publicado contesta 200 y no duplica", async () => {
    // La unicidad la decide la base; acá se afirma que la ruta NO lo trata como
    // error. Un 409 para "ya estaba" mandaría a reintentar en un bucle.
    respuesta = {
      ok: true,
      estado: "ya-publicado",
      publicationId: "pub-1",
      externalId: "accounts/1/locations/123/localPosts/9",
    };

    const res = await pedir({ assetId: ASSET });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(cuerpo.estado).toBe("ya-publicado");
  });
});
