/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la regla del servicio compartido se confunda con su fallback.
 *
 * «La agencia sirve a la organización X con su token, sobre las properties
 * mapeadas a X» y «si X no tiene, la agencia le presta lo suyo» se escriben
 * casi igual. La primera es H4.4; la segunda es la fuga entre clientes que la
 * Espina nombra. Un test que sólo pruebe «A mapeada recibe el token de la
 * agencia» queda verde con las dos, y por eso la mitad de este archivo son
 * organizaciones que NO tienen que recibir nada.
 *
 * El token de la agencia es un doble que CUENTA: lo que se mide no es sólo qué
 * se devolvió, sino si se llegó a pedir. Pedirlo para una organización sin
 * mapeo ya es usarlo —lee el secreto con `service_role` y puede refrescarlo
 * contra Google—, aunque después no se consulte nada.
 *
 * Y EL TOKEN NO SALE
 *
 * Desde la cuarta revisión del #118 la regla no devuelve el token: devuelve su
 * estado y consultas que lo usan adentro, atadas a los mapeos que leyó. Antes, un
 * módulo de datos nuevo pedía el servicio de una organización mapeada y gastaba
 * el token en la property de una organización sin mapeo, con la pared en verde.
 * `fetch` es un espía que anota la URL —donde va la property— y la cabecera
 * `Authorization` —donde va el token—, y el token del doble es un texto que se
 * busca en todo lo que la regla devuelve.
 *
 * Y LAS FILAS LAS DA LA BASE, NO EL TEST
 *
 * Desde la segunda revisión del #118 la regla lee el mapeo ella misma: un
 * llamador que le pasaba filas inventadas conseguía el token para una
 * organización sin mapeo. El doble de la sesión devuelve lo que se le cargue
 * SIN aplicar filtros —como una base cuyo filtro se perdió— y anota la consulta,
 * así se mide por separado que la regla PIDE bien y que no se CREE lo que vuelve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** La agencia: tiene el token, y además es una organización con su propio sitio. */
const AGENCIA = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
/** Un cliente mapeado. */
const CLIENTE_A = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00";
/** Un cliente sembrado SIN token propio y SIN mapeo: el caso de la Espina. */
const CLIENTE_B = "0b0b0b0b-1111-4222-8333-444455556666";

type Fila = { organization_id: string; provider: string; property_ref: string; unmapped_at: string | null };

const MAPEOS_A: Fila[] = [
  { organization_id: CLIENTE_A, provider: "search_console", property_ref: "https://cliente-a.test/", unmapped_at: null },
  { organization_id: CLIENTE_A, provider: "ga4", property_ref: "properties/111111111", unmapped_at: null },
];
const MAPEOS_AGENCIA: Fila[] = [
  { organization_id: AGENCIA, provider: "search_console", property_ref: "https://vulkan.test/", unmapped_at: null },
];

/** Lo que la base devuelve a la lectura del mapeo, tal cual, sin filtrar. */
let filas: Fila[] = [];
let errorDeLectura: { code?: string; message: string } | null = null;
let clienteLanza = false;
/** Cada consulta que la regla hizo: tabla, columnas y filtros. */
let consultas: { tabla: string; columnas: string; filtros: Record<string, unknown> }[] = [];

const createSupabaseServerClient = vi.fn(async () => {
  if (clienteLanza) throw new Error("sin sesión: el cliente no se pudo construir");
  return {
    from(tabla: string) {
      const consulta = { tabla, columnas: "", filtros: {} as Record<string, unknown> };
      consultas.push(consulta);
      const cadena = {
        select: (columnas: string) => {
          consulta.columnas = columnas;
          return cadena;
        },
        eq: (col: string, val: unknown) => {
          consulta.filtros[col] = val;
          return cadena;
        },
        is: (col: string, val: unknown) => {
          consulta.filtros[col] = val;
          return cadena;
        },
        then: (resolver: (v: unknown) => unknown) =>
          Promise.resolve(errorDeLectura ? { data: null, error: errorDeLectura } : { data: filas, error: null }).then(
            resolver
          ),
      };
      return cadena;
    },
  };
});
// Una envoltura, no la función: `vi.mock` sube arriba de todo y la constante
// todavía no existe cuando el módulo de la regla se carga.
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createSupabaseServerClient() }));

/** El token de la agencia, contado. */
let pedidosDeToken = 0;
let respuestaDelToken: { ok: true; accessToken: string } | { ok: false; reason: string; detail: string } = {
  ok: true,
  accessToken: "ACCESO-de-la-agencia",
};
vi.mock("../tokenStore", () => ({
  agencyAccessToken: async () => {
    pedidosDeToken += 1;
    return respuestaDelToken;
  },
}));

import { type Servicio, servirConLaAgencia } from "../servicioCompartido";

/** El token del doble: se busca, textual, en todo lo que la regla devuelve. */
const TOKEN = "ACCESO-de-la-agencia";

/** Google, del otro lado: anota qué se le pidió y con qué token, y contesta bien. */
let salidas: { url: string; autorizacion: string | null }[] = [];
function googleContesta() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    salidas.push({ url: String(url), autorizacion: new Headers(init?.headers).get("authorization") });
    const u = String(url);
    const cuerpo = u.includes("searchconsole.googleapis.com")
      ? { rows: [{ clicks: 9, impressions: 90, ctr: 0.1, position: 3 }] }
      : u.includes("analyticsdata.googleapis.com")
        ? { metricHeaders: [{ name: "sessions" }, { name: "keyEvents" }], rows: [{ metricValues: [{ value: "7" }, { value: "1" }] }] }
        : { name: "accounts/123/locations/100/localPosts/1" };
    return { ok: true, status: 200, json: async () => cuerpo } as unknown as Response;
  });
}

/** Todo texto alcanzable desde `valor`, por cualquier propiedad propia, también las no enumerables. */
function textosDe(valor: unknown, vistos = new Set<unknown>()): string[] {
  if (typeof valor === "string") return [valor];
  if (valor === null || (typeof valor !== "object" && typeof valor !== "function") || vistos.has(valor)) return [];
  vistos.add(valor);
  return Reflect.ownKeys(valor as object).flatMap((k) => [
    ...(typeof k === "string" ? [k] : []),
    ...textosDe((valor as Record<PropertyKey, unknown>)[k], vistos),
  ]);
}

const AHORA = new Date("2026-10-13T12:00:00.000Z");

beforeEach(() => {
  filas = [];
  errorDeLectura = null;
  clienteLanza = false;
  consultas = [];
  pedidosDeToken = 0;
  respuestaDelToken = { ok: true, accessToken: TOKEN };
  createSupabaseServerClient.mockClear();
  salidas = [];
  googleContesta();
});

afterEach(() => {
  delete process.env.VULKAN_AGENCY_ORG_ID;
  vi.unstubAllGlobals();
});

describe("lo legítimo: la agencia sirve a una organización sobre SUS mapeos", () => {
  it("A mapeada recibe el token de la agencia y sólo sus properties", async () => {
    filas = MAPEOS_A;

    const s = await servirConLaAgencia(CLIENTE_A);

    // El estado, no el token: el token se usa adentro de las consultas.
    expect(s.token).toEqual({ ok: true });
    expect(s.mapeos).toEqual([
      { provider: "search_console", propertyRef: "https://cliente-a.test/" },
      { provider: "ga4", propertyRef: "properties/111111111" },
    ]);
    // Una vez, no una por mapeo: es el mismo token para las tres superficies.
    expect(pedidosDeToken).toBe(1);
  });

  it("la agencia se sirve a sí misma por SUS mapeos, como cualquier otra", async () => {
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
    filas = MAPEOS_AGENCIA;

    const s = await servirConLaAgencia(AGENCIA);

    expect(s.mapeos).toEqual([{ provider: "search_console", propertyRef: "https://vulkan.test/" }]);
    expect(pedidosDeToken).toBe(1);
  });
});

describe("la lectura es de la regla: con la sesión, filtrada, y sin creerle a lo que vuelve", () => {
  it("lo que el llamador le pase NO es un mapeo: sin filas en la base, `not-mapped` y el token ni se pide", async () => {
    // La mutación m13 de la segunda revisión del #118: un módulo de datos le
    // pasaba a la regla una fila inventada y conseguía el token de la agencia
    // para una organización sin ningún mapeo. Con la firma de hoy eso no
    // compila; a la fuerza (`as never`), tampoco sirve: la regla lee la base.
    const inventadas = [{ organizationId: CLIENTE_B, provider: "search_console", propertyRef: "sc-domain:vulkan.test" }];

    const s = await servirConLaAgencia(CLIENTE_B, inventadas as never);

    expect(s.mapeos).toEqual([]);
    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(pedidosDeToken).toBe(0);
  });

  it("pide los vivos de ESA organización, con la sesión, y lee organization_id y unmapped_at", async () => {
    filas = MAPEOS_A;

    await servirConLaAgencia(CLIENTE_A);

    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
    expect(consultas).toHaveLength(1);
    expect(consultas[0].tabla).toBe("integration_properties");
    expect(consultas[0].filtros).toEqual({ organization_id: CLIENTE_A, unmapped_at: null });
    expect(consultas[0].columnas.split(",").map((c) => c.trim()).sort()).toEqual([
      "organization_id",
      "property_ref",
      "provider",
      "unmapped_at",
    ]);
  });

  it("con una superficie, la pide a la base y descarta la de otra que vuelva", async () => {
    filas = [
      { organization_id: CLIENTE_A, provider: "google_business_profile", property_ref: "locations/1", unmapped_at: null },
      { organization_id: CLIENTE_A, provider: "ga4", property_ref: "properties/111111111", unmapped_at: null },
    ];
    const avisos: string[] = [];

    const s = await servirConLaAgencia(CLIENTE_A, { superficie: "google_business_profile", log: (m) => avisos.push(m) });

    expect(consultas[0].filtros).toEqual({
      organization_id: CLIENTE_A,
      provider: "google_business_profile",
      unmapped_at: null,
    });
    expect(s.mapeos).toEqual([{ provider: "google_business_profile", propertyRef: "locations/1" }]);
    expect(avisos).toEqual([expect.stringMatching(/1 mapeo\(s\) de otra superficie descartado/)]);
  });

  it("sólo con la de otra superficie: `not-mapped`, y el token ni se pide", async () => {
    filas = [{ organization_id: CLIENTE_A, provider: "ga4", property_ref: "properties/111111111", unmapped_at: null }];

    const s = await servirConLaAgencia(CLIENTE_A, { superficie: "google_business_profile", log: () => {} });

    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(pedidosDeToken).toBe(0);
  });

  it("una fila desmapeada que vuelva no se sirve: el historial no es un mapeo", async () => {
    // Si la consulta pierde su `unmapped_at is null` (la mutación m03 de la
    // segunda revisión), la regla lo ve igual: lo compara en la fila.
    filas = [{ ...MAPEOS_A[0], unmapped_at: "2026-10-01T00:00:00.000Z" }];
    const avisos: string[] = [];

    const s = await servirConLaAgencia(CLIENTE_A, { log: (m) => avisos.push(m) });

    expect(s.mapeos).toEqual([]);
    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(pedidosDeToken).toBe(0);
    expect(avisos).toEqual([expect.stringMatching(/1 mapeo\(s\) desmapeado\(s\) descartado/)]);
  });
});

describe("el fallback: nunca se presta el token de la agencia a quien no tiene mapeo", () => {
  it("B sembrada sin token ni mapeo: falla con motivo, y el token NI SE PIDE", async () => {
    const s = await servirConLaAgencia(CLIENTE_B);

    expect(s.mapeos).toEqual([]);
    expect(s.token.ok).toBe(false);
    if (!s.token.ok) {
      // El motivo tiene nombre propio. No es `absent` —la agencia SÍ tiene
      // token—, ni `unreadable`: es que esta organización no tiene con qué
      // pedirlo.
      expect(s.token.reason).toBe("not-mapped");
      expect(s.token.detail).toMatch(/no tiene ningún mapeo vivo/);
    }
    expect(pedidosDeToken).toBe(0);
  });

  it("aunque el token de la agencia esté vivo y la variable puesta, B no lo recibe", async () => {
    // El fallback clásico mira la variable: «si no hay mapeo, la agencia».
    // Con la variable puesta y un token perfecto del otro lado, sigue sin
    // pedirse.
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;

    const s = await servirConLaAgencia(CLIENTE_B);

    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(pedidosDeToken).toBe(0);
  });

  it("la agencia SIN mapeo propio tampoco: ser la agencia no es un mapeo", async () => {
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;

    const s = await servirConLaAgencia(AGENCIA);

    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(pedidosDeToken).toBe(0);
  });

  it("sin organización —el reporte de demostración— no hay mapeo propio ni lectura, aunque la base tenga filas", async () => {
    filas = [...MAPEOS_A, ...MAPEOS_AGENCIA];

    const s = await servirConLaAgencia(null);

    expect(s.mapeos).toEqual([]);
    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(pedidosDeToken).toBe(0);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});

describe("un mapeo que no se pudo leer no es un mapeo que falta", () => {
  it("A, con la lectura caída: `mapping-unreadable`, no `not-mapped`, y el token NI SE PIDE", async () => {
    // Medido en la revisión del #118: los dos lectores convertían un error de
    // la consulta en la lista vacía, y la regla lo anotaba como «no tiene ningún
    // mapeo vivo». A puede estar mapeada: decirle «mapeá» la manda a arreglar lo
    // que está bien. Y prestarle el token «por las dudas» es prestarlo sin
    // ninguna property que sea suya.
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
    filas = MAPEOS_A;
    errorDeLectura = { code: "57014", message: "canceling statement due to statement timeout" };

    const s = await servirConLaAgencia(CLIENTE_A);

    expect(s.mapeos).toEqual([]);
    expect(s.token).toMatchObject({ ok: false, reason: "mapping-unreadable" });
    if (!s.token.ok) {
      expect(s.token.detail).toContain("57014");
      // El código, no el mensaje de PostgreSQL: puede nombrar tablas.
      expect(s.token.detail).not.toContain("statement timeout");
    }
    expect(pedidosDeToken).toBe(0);
  });

  it("un cliente de sesión que no se puede construir tampoco es «sin mapear»", async () => {
    clienteLanza = true;

    const s = await servirConLaAgencia(CLIENTE_A);

    expect(s.token).toMatchObject({ ok: false, reason: "mapping-unreadable" });
    expect(pedidosDeToken).toBe(0);
  });
});

describe("el mapeo ajeno: lo que la RLS deja ver a quien es miembro de dos organizaciones", () => {
  // Un operador de la agencia que es también miembro de A ve, bajo la RLS, los
  // mapeos de las DOS. Si la consulta pierde su filtro por organización, le
  // llegan los dos juegos. La regla compara la columna y no se lo cree al
  // filtro.
  //
  // Y la variable de la agencia está PUESTA, como en producción. Sin ella, un
  // «la agencia ve todo lo que lee» (`org === VULKAN_AGENCY_ORG_ID ? leidos`)
  // no se activa nunca y estos tests quedan verdes con él adentro. Medido con
  // `mutar.sh` el 2026-10-11: sobrevivía hasta que se puso esta línea.
  beforeEach(() => {
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
  });

  it("el reporte de la AGENCIA no se lleva la property de A", async () => {
    filas = [...MAPEOS_A, ...MAPEOS_AGENCIA];
    const avisos: string[] = [];

    const s = await servirConLaAgencia(AGENCIA, { log: (m) => avisos.push(m) });

    expect(s.mapeos).toEqual([{ provider: "search_console", propertyRef: "https://vulkan.test/" }]);
    expect(s.mapeos.map((m) => m.propertyRef)).not.toContain("properties/111111111");
    // Y se anota: una fila ajena sólo llega si el lector perdió su filtro, que
    // es un defecto que alguien tiene que ir a buscar.
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/2 mapeo\(s\) de otra organización descartado/);
  });

  it("B sin mapeo, con los de A y la agencia a la vista: nada, y el token no se pide", async () => {
    filas = [...MAPEOS_A, ...MAPEOS_AGENCIA];

    const s = await servirConLaAgencia(CLIENTE_B, { log: () => {} });

    expect(s.mapeos).toEqual([]);
    expect(s.token).toMatchObject({ ok: false, reason: "not-mapped" });
    expect(pedidosDeToken).toBe(0);
  });

  it("sin filas ajenas no hay aviso: el log habla sólo cuando hay algo raro", async () => {
    filas = MAPEOS_A;
    const avisos: string[] = [];

    await servirConLaAgencia(CLIENTE_A, { log: (m) => avisos.push(m) });

    expect(avisos).toEqual([]);
  });
});

describe("un token que no se pudo resolver viaja con su motivo", () => {
  it("A mapeada con el token de la agencia revocado: el motivo de la agencia, no `not-mapped`", async () => {
    filas = MAPEOS_A;
    respuestaDelToken = { ok: false, reason: "revoked", detail: "la autorización fue revocada" };

    const s = await servirConLaAgencia(CLIENTE_A);

    // A sí tiene con qué pedirlo; lo que falta es del lado de la agencia. Decir
    // «sin mapeo» mandaría a mapear a quien ya está mapeado.
    expect(s.token).toMatchObject({ ok: false, reason: "revoked" });
    expect(s.mapeos).toHaveLength(2);
    expect(pedidosDeToken).toBe(1);
  });
});

describe("el token no sale de la regla: se usa adentro, y sólo sobre sus mapeos", () => {
  // La cuarta revisión del #118 (F2): la regla devolvía el token como texto, y un
  // módulo de datos lo gastaba en la property que quisiera. Ahora lo que vuelve
  // son consultas atadas a los mapeos que la regla leyó.

  it("lo que devuelve no lleva el token: ni en `token` ni en ninguna otra parte", async () => {
    filas = MAPEOS_A;

    const s = await servirConLaAgencia(CLIENTE_A);

    // Lo que devuelve, exacto: un miembro nuevo es una decisión, no un descuido.
    expect(Object.keys(s).sort()).toEqual(["ga4", "mapeos", "publicadorDeFicha", "searchConsole", "token"]);
    expect(s.token).toEqual({ ok: true });
    // Y el TIPO tampoco lo lleva: si `TokenDelServicio` vuelve a tener el token,
    // esta línea deja de ser un error y `tsc` falla por la directiva sin uso.
    if (s.token.ok) {
      // @ts-expect-error el estado del token no lleva el token (cuarta revisión del #118)
      expect(s.token.accessToken).toBeUndefined();
    }
    expect(pedidosDeToken).toBe(1);
    const textos = textosDe(s);
    expect(textos.length).toBeGreaterThan(5); // anti-vacuidad: el recorrido ve los mapeos
    expect(textos).toContain("https://cliente-a.test/");
    expect(textos.some((t) => t.includes(TOKEN)), "el token está en lo que la regla devuelve").toBe(false);
  });

  it("Search Console: sobre SU property sale con el token; sobre cualquier otra, nada sale", async () => {
    filas = MAPEOS_A;
    const avisos: string[] = [];
    const s = await servirConLaAgencia(CLIENTE_A, { log: (m) => avisos.push(m) });

    const propia = await s.searchConsole("https://cliente-a.test/", AHORA);
    expect(propia.outcome).toEqual({ kind: "ok" });
    expect(salidas).toHaveLength(1);
    expect(decodeURIComponent(salidas[0].url)).toContain("https://cliente-a.test/");
    expect(salidas[0].autorizacion).toBe(`Bearer ${TOKEN}`);

    // La de una organización sin mapeo, y la de GA4 de A pedida como Search
    // Console: ninguna sale, y las dos se anotan.
    for (const ajena of ["https://cliente-b.test/", "sc-domain:cliente-b.test", "properties/111111111"]) {
      const r = await s.searchConsole(ajena, AHORA);
      expect(r, ajena).toEqual({ outcome: { kind: "no-credentials" }, totals: null });
    }
    expect(salidas).toHaveLength(1);
    expect(avisos).toHaveLength(3);
    expect(avisos[0]).toMatch(/no es un mapeo vivo de esta organización/);
  });

  it("GA4: lo mismo, con su superficie", async () => {
    filas = MAPEOS_A;
    const s = await servirConLaAgencia(CLIENTE_A, { log: () => {} });

    const propia = await s.ga4("properties/111111111", AHORA);
    expect(propia.outcome).toEqual({ kind: "ok" });
    expect(salidas.map((x) => decodeURIComponent(x.url))).toEqual([expect.stringContaining("properties/111111111")]);
    expect(salidas[0].autorizacion).toBe(`Bearer ${TOKEN}`);

    for (const ajena of ["properties/999999999", "https://cliente-a.test/"]) {
      expect(await s.ga4(ajena, AHORA), ajena).toEqual({ outcome: { kind: "no-credentials" }, totals: null });
    }
    expect(salidas).toHaveLength(1);
  });

  it("el caso de la revisión: el servicio de la agencia, mapeada, no consulta la property de B, que no tiene mapeo", async () => {
    // El módulo de datos de la cuarta revisión: pide el servicio de una
    // organización mapeada de quien llama —la agencia— y apunta el token a una
    // property cualquiera. El token se resolvió (la agencia está mapeada), y no
    // sale hacia ella.
    process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
    filas = MAPEOS_AGENCIA;
    const s = await servirConLaAgencia(AGENCIA, { log: () => {} });
    expect(pedidosDeToken).toBe(1);

    expect(await s.searchConsole("https://cliente-b.test/", AHORA)).toEqual({
      outcome: { kind: "no-credentials" },
      totals: null,
    });
    expect(await s.ga4("properties/222222222", AHORA)).toEqual({ outcome: { kind: "no-credentials" }, totals: null });
    expect(s.publicadorDeFicha("locations/200", { accountId: "123", cuerpo: "x" })).toBeNull();
    expect(salidas).toEqual([]);
  });

  it("los mapeos que devuelve son una copia: agregarle o cambiarle uno no abre ninguna consulta", async () => {
    filas = MAPEOS_A;
    const s: Servicio = await servirConLaAgencia(CLIENTE_A, { log: () => {} });

    s.mapeos.push({ provider: "search_console", propertyRef: "https://cliente-b.test/" });
    s.mapeos[0].propertyRef = "sc-domain:cliente-b.test";

    expect((await s.searchConsole("https://cliente-b.test/", AHORA)).outcome).toEqual({ kind: "no-credentials" });
    expect((await s.searchConsole("sc-domain:cliente-b.test", AHORA)).outcome).toEqual({ kind: "no-credentials" });
    expect(salidas).toEqual([]);
    // Y lo que la base dijo sigue valiendo.
    expect((await s.searchConsole("https://cliente-a.test/", AHORA)).outcome).toEqual({ kind: "ok" });
    expect(salidas).toHaveLength(1);
  });

  it("sin token —revocado, sin mapeo, o con el mapeo ilegible— no sale nada, ni sobre su propia property", async () => {
    filas = MAPEOS_A;
    respuestaDelToken = { ok: false, reason: "revoked", detail: "la autorización fue revocada" };
    const revocado = await servirConLaAgencia(CLIENTE_A);
    expect(revocado.token).toEqual({ ok: false, reason: "revoked", detail: "la autorización fue revocada" });
    expect((await revocado.searchConsole("https://cliente-a.test/", AHORA)).outcome).toEqual({ kind: "no-credentials" });
    expect((await revocado.ga4("properties/111111111", AHORA)).outcome).toEqual({ kind: "no-credentials" });

    filas = [];
    const sinMapeo = await servirConLaAgencia(CLIENTE_B);
    expect((await sinMapeo.searchConsole("https://cliente-a.test/", AHORA)).outcome).toEqual({ kind: "no-credentials" });

    filas = MAPEOS_A;
    errorDeLectura = { code: "57014", message: "timeout" };
    const ilegible = await servirConLaAgencia(CLIENTE_A);
    expect((await ilegible.searchConsole("https://cliente-a.test/", AHORA)).outcome).toEqual({ kind: "no-credentials" });

    expect(salidas).toEqual([]);
  });

  it("el publicador: sólo su ficha, y sólo un asset de su organización", async () => {
    filas = [
      { organization_id: CLIENTE_A, provider: "google_business_profile", property_ref: "locations/100", unmapped_at: null },
    ];
    const s = await servirConLaAgencia(CLIENTE_A, { superficie: "google_business_profile", log: () => {} });

    expect(s.publicadorDeFicha("locations/999", { accountId: "123", cuerpo: "Texto de A." })).toBeNull();
    const p = s.publicadorDeFicha("locations/100", { accountId: "123", cuerpo: "Texto de A." });
    expect(p).not.toBeNull();

    const entrada = { assetId: "7d703707-4f9d-43bf-9305-6bc22eddf4a1", approvedHash: "h", destino: "google_business_profile" as const };
    // Un asset de B con el publicador de A: no sale.
    expect(await p!.publicar({ ...entrada, organizationId: CLIENTE_B })).toEqual({
      ok: false,
      motivo: "sin-datos-para-publicar",
    });
    expect(salidas).toEqual([]);

    expect(await p!.publicar({ ...entrada, organizationId: CLIENTE_A })).toEqual({
      ok: true,
      externalId: "accounts/123/locations/100/localPosts/1",
    });
    expect(salidas).toHaveLength(1);
    expect(salidas[0].url).toBe("https://mybusiness.googleapis.com/v4/accounts/123/locations/100/localPosts");
    expect(salidas[0].autorizacion).toBe(`Bearer ${TOKEN}`);
  });
});
