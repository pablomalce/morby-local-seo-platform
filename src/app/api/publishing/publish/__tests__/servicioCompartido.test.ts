/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el texto aprobado de un cliente se publique en la ficha de OTRO con el
 * token de la agencia — o que se pida ese token para una organización que no
 * tiene ficha.
 *
 * `route.test.ts` prueba el enganche con UNA organización, y su doble de
 * `integration_properties` contesta lo mismo con cualquier filtro. Medido el
 * 2026-10-11 con `scripts/mutar.sh`: cambiar la organización del mapeo por la de
 * la agencia (`process.env.VULKAN_AGENCY_ORG_ID ?? organizationId`), leer la ficha
 * de `GOOGLE_BUSINESS_LOCATION_ID` cuando el cliente no tiene, o pedir el token
 * antes de mirar el mapeo, SOBREVIVÍAN las tres con la suite entera en verde.
 * Este archivo pone dos organizaciones y una agencia, y un doble que contesta
 * como la base: con la RLS de quien llama Y con los filtros que el código manda.
 *
 * Lo que se publica en vivo no se puede deshacer desde acá, así que lo que se
 * mide es lo que llega al publicador: con qué token y sobre qué `locations/N`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCIA = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const CLIENTE_A = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00";
const CLIENTE_B = "0b0b0b0b-1111-4222-8333-444455556666";

const ASSET_A = "7d703707-4f9d-43bf-9305-6bc22eddf4a1";
const ASSET_B = "7d703707-4f9d-43bf-9305-6bc22eddf4b1";

const FICHA_A = "locations/100";
const FICHA_AGENCIA = "locations/900";

const ASSETS = [
  { id: ASSET_A, organization_id: CLIENTE_A, approved_hash: "hash-a", body: "Texto aprobado de A." },
  { id: ASSET_B, organization_id: CLIENTE_B, approved_hash: "hash-b", body: "Texto aprobado de B." },
];

/** `integration_properties` vivos de Business Profile. B no tiene ninguno. */
const MAPEOS = [
  { organization_id: AGENCIA, provider: "google_business_profile", property_ref: FICHA_AGENCIA, unmapped_at: null },
  { organization_id: CLIENTE_A, provider: "google_business_profile", property_ref: FICHA_A, unmapped_at: null },
];

const USUARIO = "11111111-1111-4111-8111-111111111111";

/** De qué organizaciones es manager quien llama. Lo que la RLS le deja ver. */
let miembroDe: string[] = [];

/** Las lecturas del mapeo, con sus filtros: dicen de QUÉ organización se pidió la ficha. */
let lecturasDeMapeo: Record<string, unknown>[] = [];

/** Si la lectura del mapeo falla, con qué. */
let mapeoFalla: { code: string; message: string } | null = null;

/**
 * Si la base PIERDE los filtros de la lectura del mapeo y devuelve todo lo que
 * la RLS deja ver. Modela un filtro perdido en la consulta: lo que vuelve no es
 * de ESTA organización, y la regla tiene que verlo en la fila.
 */
let filtrosPerdidos = false;

function filas(tabla: string, filtros: Record<string, unknown>) {
  const coincide = (f: Record<string, unknown>) => Object.entries(filtros).every(([c, v]) => f[c] === v);
  if (tabla === "content_assets") return ASSETS.filter((a) => miembroDe.includes(a.organization_id) && coincide(a));
  if (tabla === "integration_properties") return MAPEOS.filter((m) => miembroDe.includes(m.organization_id) && coincide(m));
  if (tabla === "org_members") {
    return miembroDe.includes(String(filtros.organization_id)) && filtros.user_id === USUARIO
      ? [{ role: "manager", state: "active" }]
      : [];
  }
  return [];
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USUARIO } } }) },
    from: (tabla: string) => {
      const filtros: Record<string, unknown> = {};
      const cadena = {
        select: () => cadena,
        eq: (c: string, v: unknown) => {
          filtros[c] = v;
          return cadena;
        },
        is: (c: string, v: unknown) => {
          filtros[c] = v;
          return cadena;
        },
        limit: async () => ({ data: filas(tabla, filtros), error: null }),
        maybeSingle: async () => {
          const f = filas(tabla, filtros);
          // Como PostgREST: más de una fila en un `maybeSingle` es un error, no
          // la primera. Si el código pierde un filtro, eso se ve.
          if (f.length > 1) return { data: null, error: { code: "PGRST116" } };
          return { data: f[0] ?? null, error: null };
        },
        // La lectura del mapeo es una lista: la hace la regla del servicio
        // compartido, que la pide con sus filtros y después mira cada fila.
        then: (resolver: (v: unknown) => unknown) => {
          if (tabla === "integration_properties") lecturasDeMapeo.push({ ...filtros });
          const respuesta =
            tabla === "integration_properties" && mapeoFalla
              ? { data: null, error: mapeoFalla }
              : { data: tabla === "integration_properties" && filtrosPerdidos ? filas(tabla, {}) : filas(tabla, filtros), error: null };
          return Promise.resolve(respuesta).then(resolver);
        },
      };
      return cadena;
    },
  }),
}));

/** El token de la agencia: cuántas veces se pidió. */
let pedidosDeToken = 0;
let respuestaDelToken: { ok: true; accessToken: string } | { ok: false; reason: string; detail: string } = {
  ok: true,
  accessToken: "ACCESO-de-la-agencia",
};
vi.mock("@/lib/integrations/google/tokenStore", () => ({
  agencyAccessToken: async () => {
    pedidosDeToken += 1;
    return respuestaDelToken;
  },
}));

/** Con qué se armó cada publicador. `leerDatos` dice sobre qué ficha iba a publicar. */
let armados: Array<{
  accessToken: string;
  accountId: string;
  leerDatos: () => Promise<{ cuerpo: string; locationRef: string }>;
}> = [];
vi.mock("@/lib/publishing/googleBusinessProfile", () => ({
  publicadorDeBusinessProfile: (deps: (typeof armados)[number]) => {
    armados.push(deps);
    return { publicar: async () => ({ ok: true, externalId: "x" }) };
  },
}));

/** El transporte, con su contrato: sin publicador, `sin-transporte`. Cuenta cuántas veces se llamó. */
let llamadasAPublicar = 0;
vi.mock("@/lib/publishing/transport", () => ({
  publicar: async (_entrada: unknown, _modo: unknown, publicador: unknown) => {
    llamadasAPublicar += 1;
    return publicador
      ? { ok: true, estado: "publicado", publicationId: "pub-1", externalId: "x" }
      : { ok: false, motivo: "sin-transporte" };
  },
}));

vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => null }));

let salidas = 0;

import { POST } from "../route";

const publicar = (assetId: string) =>
  POST(
    new Request("http://localhost/api/publishing/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId }),
    })
  );

beforeEach(() => {
  miembroDe = [];
  lecturasDeMapeo = [];
  mapeoFalla = null;
  filtrosPerdidos = false;
  llamadasAPublicar = 0;
  pedidosDeToken = 0;
  respuestaDelToken = { ok: true, accessToken: "ACCESO-de-la-agencia" };
  armados = [];
  salidas = 0;
  process.env.GOOGLE_BUSINESS_ACCOUNT_ID = "accounts/1";
  process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
  // La ficha de la AGENCIA en la variable que `.env.example` declara y nada lee:
  // es el valor por defecto que un fallback usaría para el cliente sin ficha.
  process.env.GOOGLE_BUSINESS_LOCATION_ID = FICHA_AGENCIA;
  vi.stubGlobal("fetch", async () => {
    salidas += 1;
    throw new Error("este test no deja salir a Google");
  });
});

describe("lo legítimo: A publica en SU ficha, con el token de la agencia", () => {
  it("el publicador se arma con la ficha de A, y el token se pide una vez", async () => {
    miembroDe = [CLIENTE_A];

    const res = await publicar(ASSET_A);

    expect(res.status).toBe(200);
    expect(armados).toHaveLength(1);
    expect(armados[0].accessToken).toBe("ACCESO-de-la-agencia");
    expect(await armados[0].leerDatos()).toEqual({ cuerpo: "Texto aprobado de A.", locationRef: FICHA_A });
    expect(pedidosDeToken).toBe(1);
    expect(lecturasDeMapeo).toEqual([
      { organization_id: CLIENTE_A, provider: "google_business_profile", unmapped_at: null },
    ]);
  });
});

describe("el fallback: B, sembrada sin token y sin ficha", () => {
  it("503 con motivo `mapeo`, sin publicador, y el token de la agencia NI SE PIDE", async () => {
    miembroDe = [CLIENTE_B];

    const res = await publicar(ASSET_B);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, motivo: "sin-transporte", falta: "mapeo" });
    expect(armados).toEqual([]);
    expect(pedidosDeToken).toBe(0);
    expect(salidas).toBe(0);
    // La ficha se buscó en la organización DEL ASSET, y en ninguna otra.
    expect(lecturasDeMapeo).toEqual([
      { organization_id: CLIENTE_B, provider: "google_business_profile", unmapped_at: null },
    ]);
  });

  it("un operador de la agencia que es manager de B tampoco publica B en la ficha de la agencia", async () => {
    // Bajo la RLS ve la ficha de la agencia. El asset es de B, y B no tiene.
    miembroDe = [AGENCIA, CLIENTE_B];

    const res = await publicar(ASSET_B);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ falta: "mapeo" });
    expect(armados).toEqual([]);
    expect(pedidosDeToken).toBe(0);
  });

  it("y uno que es manager de A y de B no publica B en la ficha de A", async () => {
    miembroDe = [CLIENTE_A, CLIENTE_B];

    const res = await publicar(ASSET_B);

    expect(res.status).toBe(503);
    expect(armados).toEqual([]);
    expect(pedidosDeToken).toBe(0);
  });
});

describe("un mapeo que no se pudo leer no es un mapeo que falta", () => {
  it("A mapeada con la lectura caída: 502, ni `falta: mapeo` ni token, y no se reserva nada", async () => {
    // Medido en la revisión del #118: `armarPublicador` ignoraba el `error` del
    // `maybeSingle`, y un timeout (57014) sobre la organización de A —que tiene
    // `locations/100`— contestaba 503 `falta: "mapeo"`. Un motivo explícito y
    // falso, que manda a mapear lo mapeado. Igual que el asset ilegible: 502.
    miembroDe = [CLIENTE_A];
    mapeoFalla = { code: "57014", message: "canceling statement due to statement timeout" };

    const res = await publicar(ASSET_A);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "mapping unreadable" });
    expect(pedidosDeToken).toBe(0);
    expect(armados).toEqual([]);
    expect(llamadasAPublicar).toBe(0);
    expect(salidas).toBe(0);
  });

  it("cualquier código de error de la lectura es un 502, no una ausencia", async () => {
    miembroDe = [CLIENTE_A];
    mapeoFalla = { code: "08006", message: "connection failure" };

    const res = await publicar(ASSET_A);

    expect(res.status).toBe(502);
    expect(pedidosDeToken).toBe(0);
  });
});

describe("un filtro perdido no publica en la ficha de otro", () => {
  it("la lectura devuelve la ficha de la agencia para el asset de B: la regla la descarta en la fila", async () => {
    // Hasta la segunda revisión del #118 esto lo atajaba el `maybeSingle` de la
    // ruta (más de una fila es un error). Hoy la lectura la hace la regla y es
    // una lista: lo que la ataja es que la regla mira la organización, la
    // superficie y `unmapped_at` de CADA fila, en vez de creérselo al filtro.
    miembroDe = [AGENCIA, CLIENTE_B];
    filtrosPerdidos = true;

    const res = await publicar(ASSET_B);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ falta: "mapeo" });
    expect(armados).toEqual([]);
    expect(pedidosDeToken).toBe(0);
  });
});

describe("cada pieza que falta, con su nombre", () => {
  it("sin cuenta: `cuenta`, y ni se mira el mapeo", async () => {
    miembroDe = [CLIENTE_A];
    delete process.env.GOOGLE_BUSINESS_ACCOUNT_ID;

    const res = await publicar(ASSET_A);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ falta: "cuenta" });
    expect(pedidosDeToken).toBe(0);
    expect(lecturasDeMapeo).toEqual([]);
  });

  it("A mapeada y el token de la agencia revocado: `token`, no `mapeo`", async () => {
    // A sí tiene ficha; lo que falta es del lado de la agencia. Mandarla a
    // mapear sería mandarla a arreglar lo que está bien. Y el motivo fino del
    // token no viaja: es estado de la agencia, no de quien pidió publicar.
    miembroDe = [CLIENTE_A];
    respuestaDelToken = { ok: false, reason: "revoked", detail: "la autorización fue revocada" };

    const res = await publicar(ASSET_A);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, motivo: "sin-transporte", falta: "token" });
    expect(pedidosDeToken).toBe(1);
    expect(armados).toEqual([]);
  });
});
