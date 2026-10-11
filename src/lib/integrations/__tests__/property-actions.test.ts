/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el mapeo de propiedades termine escribiéndose con la llave del navegador.
 *
 * La `0017` le da a `authenticated` sólo SELECT sobre `integration_properties`, y
 * el bloque 38 de `supabase/qa/defects_test.sql` lo mide del lado del esquema. Lo
 * que ese bloque NO puede ver es de qué lado del cable escribe la aplicación: un
 * `createSupabaseServerClient()` en vez de un `createSupabaseAdminClient()` acá
 * adentro deja la base intacta y la escritura rechazada — o peor, si algún día
 * alguien "arregla" el rechazo devolviéndole el privilegio a `authenticated`, la
 * fuga entera queda abierta y el bloque 38 es lo único que la ve.
 *
 * Este archivo mide el otro lado: que la membresía se compruebe con la sesión,
 * que la escritura vaya por el servicio, y que nada se escriba cuando la
 * comprobación falla.
 *
 * POR QUÉ SE AFIRMA CONTRA QUÉ CLIENTE SE LLAMÓ Y NO SÓLO EL RESULTADO
 *
 * Porque los dos clientes contestan igual en un doble. Un test que sólo mire el
 * `{ ok: true }` pasa con la escritura hecha desde la sesión, que es exactamente
 * el defecto. Lo que separa una cosa de la otra es QUIÉN escribió.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

/** Hay sesión, y de quién. */
let usuario: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };
/**
 * Las membresías que la lectura de sesión devuelve. Con rol desde H4.1: mapear
 * pide owner o admin (D4), y admin es el más bajo que alcanza.
 */
let membresias: { organization_id: string; role?: string; state?: string }[] = [];
/** Un fallo de lectura de membresías, cuando el test lo pide. */
let errorDeMembresia: { message: string } | null = null;
/** Y si además del error el driver devuelve filas, que es lo que a veces hace. */
let membresiasJuntoAlError = false;
/** Un fallo de lectura SÓLO al preguntar por esta organización. */
let errorDeMembresiaEn: string | null = null;
/**
 * Lo que contesta cada escritura, POR VERBO.
 *
 * Separado a propósito: un doble que conteste el mismo error a las dos hace que
 * el fallo del UPDATE tape al del INSERT, y el test del 23505 pasaría midiendo
 * el paso equivocado. Ya pasó al escribir este archivo.
 */
let errorPorVerbo: {
  update?: { code?: string; message: string };
  insert?: { code?: string; message: string };
  rpc?: { code?: string; message: string };
} = {};

/** Cada operación, con el cliente que la hizo. Es lo que se afirma. */
let operaciones: {
  cliente: "sesion" | "servicio";
  tabla: string;
  verbo: string;
  valores?: Record<string, unknown>;
  filtros: Record<string, unknown>;
}[] = [];

const ORG = "22222222-2222-4222-8222-222222222222";
const AJENA = "33333333-3333-4333-8333-333333333333";

function clienteFalso(cliente: "sesion" | "servicio") {
  return {
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    // Una RPC es UNA escritura, y se registra con su nombre y sus argumentos.
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      operaciones.push({ cliente, tabla: nombre, verbo: "rpc", valores: args, filtros: {} });
      return { data: null, error: errorPorVerbo.rpc ?? null };
    },
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      let verbo = "select";
      let valores: Record<string, unknown> | undefined;

      const registrar = () => {
        operaciones.push({ cliente, tabla, verbo, valores, filtros: { ...filtros } });
      };

      const respuesta = () => {
        if (verbo === "select") {
          // Filas y error a la vez es un estado que el driver produce, y es el
          // ÚNICO donde la comprobación de `error` hace algo: con `data: null`
          // el `!data` la tapa y la rama queda sin medir. Lo dijo una mutación
          // que sobrevivió.
          //
          // Filtrado por organización, como la base: desde que el mapeo también
          // pregunta por la AGENCIA, un doble que devolviera todas las
          // membresías a cualquier pregunta contestaría «admin de la agencia»
          // con la fila de otra organización.
          const delFiltro = membresias.filter(
            (m) => filtros.organization_id === undefined || m.organization_id === filtros.organization_id
          );
          if (errorDeMembresiaEn && filtros.organization_id === errorDeMembresiaEn) {
            return { data: null, error: { message: "la lectura de la agencia falló" } };
          }
          return {
            data: errorDeMembresia && !membresiasJuntoAlError ? null : delFiltro,
            error: errorDeMembresia,
          };
        }
        return { data: null, error: errorPorVerbo[verbo as "update" | "insert"] ?? null };
      };

      const encadenable: Record<string, unknown> = {
        select: () => encadenable,
        insert: (v: Record<string, unknown>) => {
          verbo = "insert";
          valores = v;
          registrar();
          return Promise.resolve(respuesta());
        },
        update: (v: Record<string, unknown>) => {
          verbo = "update";
          valores = v;
          return encadenable;
        },
        delete: () => {
          verbo = "delete";
          return encadenable;
        },
        eq: (col: string, val: unknown) => {
          filtros[col] = val;
          return encadenable;
        },
        is: (col: string, val: unknown) => {
          filtros[col] = val;
          registrar();
          return Promise.resolve(respuesta());
        },
        limit: () => {
          registrar();
          return Promise.resolve(respuesta());
        },
      };
      return encadenable;
    },
  };
}

const createSupabaseServerClient = vi.fn(async () => clienteFalso("sesion"));
const createSupabaseAdminClient = vi.fn(() => clienteFalso("servicio"));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

async function acciones() {
  return import("@/lib/integrations/property-actions");
}

/** Todo lo que se escribió, sea quien sea que lo haya escrito. */
const escrituras = () => operaciones.filter((o) => o.verbo !== "select");
/** Lo que se escribió desde el navegador. Tiene que estar vacío siempre. */
const escrituraDeSesion = () => escrituras().filter((o) => o.cliente === "sesion");

// El entorno y `fetch` se tocan por test: sin esto, la variable de la agencia
// de un describe se filtra al siguiente.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  usuario = { id: "11111111-1111-4111-8111-111111111111" };
  membresias = [{ organization_id: ORG, role: "admin", state: "active" }];
  // La agencia ES la organización que se mapea, salvo en el describe de la
  // llave: así el admin de arriba es también operador de la agencia, y los
  // tests que miden otra cosa no dependen de la segunda pregunta.
  vi.stubEnv("VULKAN_AGENCY_ORG_ID", ORG);
  errorDeMembresia = null;
  errorDeMembresiaEn = null;
  membresiasJuntoAlError = false;
  errorPorVerbo = {};
  operaciones = [];
  revalidatePath.mockReset();
});

describe("quién puede escribir un mapeo", () => {
  it("sin sesión no se escribe nada", () => {
    usuario = null;
    return acciones().then(async ({ mapProperty }) => {
      const res = await mapProperty({
        organizationId: ORG,
        surface: "ga4",
        propertyRef: "properties/123456789",
      });
      expect(res).toEqual({ ok: false, code: "not-authenticated", message: expect.any(String) });
      expect(escrituras()).toHaveLength(0);
    });
  });

  it("un usuario que no es de esa organización no escribe nada", async () => {
    // El `organizationId` viene del navegador y un navegador manda cualquiera.
    // Esta comprobación es la que reemplaza a la RLS que `service_role` saltea.
    membresias = [];
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: AJENA,
      surface: "ga4",
      propertyRef: "properties/123456789",
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ code: "not-a-member" });
    expect(escrituras()).toHaveLength(0);
  });

  it("un fallo al leer la membresía NO es una membresía", async () => {
    // Devolver «miembro» ante un error de la base convierte una caída de
    // Supabase en un permiso.
    errorDeMembresia = { message: "la lectura falló" };
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/123456789",
    });
    expect(res).toMatchObject({ code: "not-a-member" });
    expect(escrituras()).toHaveLength(0);
  });

  it("un error CON filas al lado tampoco es una membresía", async () => {
    // El caso de arriba no medía la comprobación de `error`: el doble devolvía
    // `data: null` junto con el error, así que el `!data` la tapaba y sacarla
    // dejaba la suite en verde. Lo dijo una mutación que sobrevivió.
    //
    // Y no es un caso inventado: un driver puede contestar con filas y un error
    // a la vez —una lectura parcial, una respuesta a medio armar—, y leer esas
    // filas como una membresía es exactamente convertir una falla en un permiso.
    errorDeMembresia = { message: "la lectura falló a medias" };
    membresiasJuntoAlError = true;
    membresias = [{ organization_id: ORG }];
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/123456789",
    });
    expect(res).toMatchObject({ code: "not-a-member" });
    expect(escrituras()).toHaveLength(0);
  });

  it("la membresía se pregunta con la sesión, no con la llave de servicio", async () => {
    // Preguntar «¿qué alcanza este usuario?» con una llave que lo alcanza todo
    // se contesta siempre que sí.
    const { mapProperty } = await acciones();
    await mapProperty({ organizationId: ORG, surface: "ga4", propertyRef: "properties/1" });

    const lectura = operaciones.find((o) => o.tabla === "org_members");
    expect(lectura, "no se comprobó la membresía").toBeDefined();
    expect(lectura!.cliente).toBe("sesion");
    expect(lectura!.filtros.user_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(lectura!.filtros.organization_id).toBe(ORG);
  });
});

describe("el privilegio: el mapeo se escribe desde el servidor", () => {
  it("el remapeo va por el cliente de servicio, en UNA llamada a la RPC de la 0034, y nunca por el de sesión", async () => {
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/123456789",
    });

    expect(res).toEqual({ ok: true });
    expect(escrituras()).toEqual([
      {
        cliente: "servicio",
        tabla: "remap_integration_property",
        verbo: "rpc",
        valores: { p_organization_id: ORG, p_provider: "ga4", p_property_ref: "properties/123456789" },
        filtros: {},
      },
    ]);
    expect(escrituraDeSesion(), "algo se escribió con la llave del navegador").toHaveLength(0);
  });

  it("el desmapeo también va por el servicio", async () => {
    const { unmapProperty } = await acciones();
    const res = await unmapProperty({ organizationId: ORG, surface: "search_console" });

    expect(res).toEqual({ ok: true });
    expect(escrituraDeSesion()).toHaveLength(0);
    expect(escrituras().every((o) => o.cliente === "servicio")).toBe(true);
  });
});

describe("la forma canónica se comprueba antes de escribir", () => {
  it("un identificador mal escrito no llega a la base", async () => {
    // La barra final: ninguna respuesta de Search Console la omite y un humano
    // la omite siempre.
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "search_console",
      propertyRef: "https://ejemplo.com",
    });
    expect(res).toMatchObject({ code: "bad-shape" });
    expect(escrituras()).toHaveLength(0);
  });

  it("el mensaje nombra la forma que se esperaba", async () => {
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "123456789",
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toContain("properties/N");
  });

  it("un campo vacío se distingue de una forma equivocada", async () => {
    const { mapProperty } = await acciones();
    const res = await mapProperty({ organizationId: ORG, surface: "ga4", propertyRef: "  " });
    expect(res.ok === false && res.message).toContain("Falta");
  });

  it("una superficie inventada se rechaza", async () => {
    // Lo que llega de un formulario es texto. El CHECK de la 0017 termina en
    // `ELSE false` por lo mismo.
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "google",
      propertyRef: "properties/123456789",
    });
    expect(res).toMatchObject({ code: "unknown-surface" });
    expect(escrituras()).toHaveLength(0);
  });

  it("recorta los espacios antes de guardar", async () => {
    const { mapProperty } = await acciones();
    await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "  properties/123456789 ",
    });
    const remapeo = escrituras().find((o) => o.verbo === "rpc");
    expect(remapeo!.valores!.p_property_ref).toBe("properties/123456789");
  });
});

describe("remapear es UNA transacción: un choque no deja a la organización sin su mapeo", () => {
  // Segunda revisión del #118 (F5), medido con este mismo doble: con un 23P01
  // en el INSERT, las escrituras eran [update unmapped_at, insert] y ninguna
  // tercera que devolviera el mapeo. La organización quedaba SIN su mapeo vivo
  // anterior, que era válido, y el mensaje no lo decía. Ahora el desmapeo y el
  // INSERT son una sola llamada (`remap_integration_property`, 0034), y que la
  // base revierta el desmapeo cuando el INSERT choca lo mide el bloque 240 de
  // `supabase/qa/defects_test.sql`. Lo que se mide acá es que no quede ningún
  // paso suelto de este lado del cable.
  for (const [codigo, esperado] of [
    ["23P01", "property-overlaps"],
    ["23505", "property-taken"],
    ["23514", "bad-shape"],
  ] as const) {
    it(`con un ${codigo}, la única escritura fue la RPC: no hay un desmapeo suelto que quede hecho`, async () => {
      errorPorVerbo = { rpc: { code: codigo, message: "choca" } };
      const { mapProperty } = await acciones();

      const res = await mapProperty({
        organizationId: ORG,
        surface: "search_console",
        propertyRef: "https://www.ejemplo.test/",
      });

      expect(res).toMatchObject({ ok: false, code: esperado });
      expect(escrituras().map((o) => `${o.verbo} ${o.tabla}`)).toEqual(["rpc remap_integration_property"]);
      // Y lo dice: el operador no tiene que ir a ver si su cliente quedó sin mapeo.
      expect(res.ok === false && res.message).toContain("El mapeo anterior de esta organización sigue como estaba.");
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  }

  it("sin la 0034 en la base (la función no existe), no se toca nada y lo dice", async () => {
    errorPorVerbo = { rpc: { code: "PGRST202", message: "Could not find the function" } };
    const { mapProperty } = await acciones();

    const res = await mapProperty({ organizationId: ORG, surface: "ga4", propertyRef: "properties/1" });

    expect(res).toMatchObject({ ok: false, code: "write-failed" });
    expect(res.ok === false && res.message).toContain("0034");
    expect(escrituras().map((o) => o.verbo)).toEqual(["rpc"]);
  });
});

describe("la unicidad global, que es la fuga rechazada", () => {
  it("un 23505 se cuenta como «esa property ya es de otra organización»", async () => {
    // Acá 23505 sólo puede ser la unicidad GLOBAL: la de
    // `(organization_id, provider)` se despejó en el paso anterior. Decir «error
    // al guardar» dejaría al operador reintentando lo mismo para siempre.
    errorPorVerbo = { rpc: { code: "23505", message: "duplicate key value" } };
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/1",
    });
    expect(res).toMatchObject({ code: "property-taken" });
    expect(res.ok === false && res.message).toContain("otra organización");
  });

  it("un 23P01 es el solape de Search Console de la 0034, y se dice así", async () => {
    // Medido en la revisión del #118: `sc-domain:x` en una organización y
    // `https://www.x/` en otra son textos distintos, la 0017 los deja vivos a
    // los dos, y son el mismo tráfico. La 0034 lo rechaza con 23P01, y el
    // operador tiene que leer «se solapa», no «ya está mapeada» —no hay un texto
    // idéntico que buscar— ni «error al guardar».
    errorPorVerbo = { rpc: { code: "23P01", message: "se solapa con la de otra organización" } };
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "search_console",
      propertyRef: "https://www.ejemplo.test/",
    });
    expect(res).toMatchObject({ code: "property-overlaps" });
    expect(res.ok === false && res.message).toContain("se solapa");
  });

  it("un 23514 es la forma canónica de Search Console de la 0034, y se dice así", async () => {
    // `validarPropertyRef` deja pasar `https://bücher.example/`: tiene la forma
    // de la 0017. La 0034 no le encuentra forma canónica (el host no es ASCII)
    // y lo rechaza con 23514; el operador tiene que leer qué escribir.
    errorPorVerbo = { rpc: { code: "23514", message: "sin forma canónica" } };
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "search_console",
      propertyRef: "https://bücher.example/",
    });
    expect(res).toMatchObject({ code: "bad-shape" });
    expect(res.ok === false && res.message).toContain("punycode");
  });

  it("cualquier otro fallo de la base no se disfraza de conflicto de property", async () => {
    errorPorVerbo = { rpc: { code: "42501", message: "permission denied" } };
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/1",
    });
    expect(res).toMatchObject({ code: "write-failed" });
  });
});

describe("desmapear no borra", () => {
  it("escribe unmapped_at sobre el mapeo vivo, y no hace DELETE", async () => {
    // El historial es lo que permite contestar «¿de quién eran estos números el
    // mes pasado?», y esa pregunta se hace justo cuando se sospecha que un
    // reporte mostró lo que no era.
    const { unmapProperty } = await acciones();
    await unmapProperty({ organizationId: ORG, surface: "google_business_profile" });

    expect(escrituras().some((o) => o.verbo === "delete")).toBe(false);
    const update = escrituras()[0];
    expect(update.verbo).toBe("update");
    expect(update.valores!.unmapped_at).toEqual(expect.any(String));
    expect(update.filtros).toMatchObject({
      organization_id: ORG,
      provider: "google_business_profile",
      unmapped_at: null,
    });
  });

  it("un fallo de la base se informa y no se da por hecho", async () => {
    errorPorVerbo = { update: { message: "no se pudo" } };
    const { unmapProperty } = await acciones();
    const res = await unmapProperty({ organizationId: ORG, surface: "ga4" });
    expect(res).toMatchObject({ code: "write-failed" });
  });
});

describe("la pantalla se refresca sólo cuando algo cambió", () => {
  it("después de mapear", async () => {
    const { mapProperty } = await acciones();
    await mapProperty({ organizationId: ORG, surface: "ga4", propertyRef: "properties/1" });
    expect(revalidatePath).toHaveBeenCalledWith("/app/integrations");
  });

  it("no después de un rechazo", async () => {
    membresias = [];
    const { mapProperty } = await acciones();
    await mapProperty({ organizationId: AJENA, surface: "ga4", propertyRef: "properties/1" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("quién mapea: el rol, no sólo la membresía (H4.1, D4)", () => {
  // La corrección del crítico: todas las negativas son en la MISMA organización
  // donde el admin sí mapea. Sin rol, un client de la organización movía la
  // frontera entre clientes con `service_role`, que ninguna policy frena.
  let salidas = 0;
  beforeEach(() => {
    salidas = 0;
    // El espía del cliente de servicio acumula de los describe de arriba: sin
    // limpiarlo, «no se construyó» no mediría este test.
    createSupabaseAdminClient.mockClear();
    vi.stubGlobal("fetch", async () => {
      salidas += 1;
      throw new Error("mapear no sale a la red");
    });
  });

  for (const rol of ["client", "viewer", "editor", "manager"]) {
    it(`un ${rol} de la organización no mapea ni desmapea: not-allowed y cero escrituras`, async () => {
      membresias = [{ organization_id: ORG, role: rol, state: "active" }];
      const { mapProperty, unmapProperty } = await acciones();

      const mapeo = await mapProperty({ organizationId: ORG, surface: "ga4", propertyRef: "properties/123456789" });
      const desmapeo = await unmapProperty({ organizationId: ORG, surface: "ga4" });

      expect(mapeo).toEqual({ ok: false, code: "not-allowed", message: expect.any(String) });
      expect(desmapeo).toEqual({ ok: false, code: "not-allowed", message: expect.any(String) });
      expect(escrituras()).toHaveLength(0);
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(salidas).toBe(0);
    });
  }

  for (const rol of ["admin", "owner"]) {
    it(`un ${rol} de la misma organización mapea, por el servicio`, async () => {
      membresias = [{ organization_id: ORG, role: rol, state: "active" }];
      const { mapProperty } = await acciones();

      const res = await mapProperty({ organizationId: ORG, surface: "ga4", propertyRef: "properties/123456789" });

      expect(res).toEqual({ ok: true });
      expect(escrituras().some((o) => o.verbo === "rpc" && o.cliente === "servicio")).toBe(true);
    });
  }

  it("un owner ARCHIVADO no mapea: la membresía tiene que estar activa", async () => {
    membresias = [{ organization_id: ORG, role: "owner", state: "archived" }];
    const { mapProperty } = await acciones();

    const res = await mapProperty({ organizationId: ORG, surface: "ga4", propertyRef: "properties/123456789" });

    expect(res).toMatchObject({ ok: false, code: "not-a-member" });
    expect(escrituras()).toHaveLength(0);
  });
});

describe("la llave es de la agencia: owner de la organización destino no alcanza (H4.1, crítico del 2026-10-08)", () => {
  // Toda cuenta es owner de su organización personal (handle_new_user, 0001) y
  // de las que cree con create_client_organization (0024). Con sólo el rol en la
  // organización destino, clara —client de X— mapeaba en SU organización P una
  // property ajena, y el reporte de P la leía con el token de la agencia.
  const AGENCIA = "44444444-4444-4444-8444-444444444444";
  const X = "55555555-5555-4555-8555-555555555555";
  const P = "66666666-6666-4666-8666-666666666666";
  let salidas = 0;

  beforeEach(() => {
    vi.stubEnv("VULKAN_AGENCY_ORG_ID", AGENCIA);
    createSupabaseAdminClient.mockClear();
    salidas = 0;
    vi.stubGlobal("fetch", async () => {
      salidas += 1;
      throw new Error("mapear no sale a la red");
    });
  });

  /** clara, como es de verdad: client de X y owner de su organización personal. */
  const clara = () => [
    { organization_id: X, role: "client", state: "active" },
    { organization_id: P, role: "owner", state: "active" },
  ];

  function sinEfecto() {
    expect(escrituras()).toHaveLength(0);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(salidas).toBe(0);
  }

  it("clara, owner de su organización personal, no mapea ahí: not-agency y cero escrituras", async () => {
    membresias = clara();
    const { mapProperty } = await acciones();

    const res = await mapProperty({
      organizationId: P,
      surface: "search_console",
      propertyRef: "sc-domain:otro-cliente-de-la-agencia.example",
    });

    expect(res).toEqual({ ok: false, code: "not-agency", message: expect.stringContaining("agencia") });
    sinEfecto();
  });

  it("ni desmapea ahí", async () => {
    membresias = clara();
    const { unmapProperty } = await acciones();

    const res = await unmapProperty({ organizationId: P, surface: "search_console" });

    expect(res).toMatchObject({ ok: false, code: "not-agency" });
    sinEfecto();
  });

  it("y en X sigue siendo not-allowed: la primera pregunta no cambió", async () => {
    membresias = clara();
    const { mapProperty } = await acciones();

    const res = await mapProperty({ organizationId: X, surface: "ga4", propertyRef: "properties/123456789" });

    expect(res).toMatchObject({ ok: false, code: "not-allowed" });
    sinEfecto();
  });

  it("la segunda pregunta es por la AGENCIA, con la sesión, y por ese usuario", async () => {
    membresias = clara();
    const { mapProperty } = await acciones();
    await mapProperty({ organizationId: P, surface: "ga4", propertyRef: "properties/123456789" });

    const lecturas = operaciones.filter((o) => o.tabla === "org_members");
    expect(lecturas.map((o) => o.filtros.organization_id)).toEqual([P, AGENCIA]);
    expect(lecturas.every((o) => o.cliente === "sesion")).toBe(true);
    expect(lecturas.every((o) => o.filtros.user_id === "11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  for (const rol of ["manager", "editor", "viewer", "client"]) {
    it(`owner de P y ${rol} de la agencia: not-agency`, async () => {
      membresias = [...clara(), { organization_id: AGENCIA, role: rol, state: "active" }];
      const { mapProperty } = await acciones();

      const res = await mapProperty({ organizationId: P, surface: "ga4", propertyRef: "properties/123456789" });

      expect(res).toMatchObject({ ok: false, code: "not-agency" });
      sinEfecto();
    });
  }

  it("admin de la agencia ARCHIVADO: not-agency", async () => {
    membresias = [...clara(), { organization_id: AGENCIA, role: "admin", state: "archived" }];
    const { mapProperty } = await acciones();

    const res = await mapProperty({ organizationId: P, surface: "ga4", propertyRef: "properties/123456789" });

    expect(res).toMatchObject({ ok: false, code: "not-agency" });
    sinEfecto();
  });

  it("un fallo al leer la membresía en la agencia NO es un permiso", async () => {
    membresias = [...clara(), { organization_id: AGENCIA, role: "admin", state: "active" }];
    errorDeMembresiaEn = AGENCIA;
    const { mapProperty } = await acciones();

    const res = await mapProperty({ organizationId: P, surface: "ga4", propertyRef: "properties/123456789" });

    expect(res).toMatchObject({ ok: false, code: "not-agency" });
    sinEfecto();
  });

  for (const [nombre, valor] of [
    ["sin VULKAN_AGENCY_ORG_ID", ""],
    ["con VULKAN_AGENCY_ORG_ID mal escrita", "no-es-un-uuid"],
  ] as const) {
    it(`${nombre}, nadie mapea: agency-unresolved`, async () => {
      vi.stubEnv("VULKAN_AGENCY_ORG_ID", valor);
      membresias = [{ organization_id: P, role: "owner", state: "active" }];
      const { mapProperty } = await acciones();

      const res = await mapProperty({ organizationId: P, surface: "ga4", propertyRef: "properties/123456789" });

      expect(res).toMatchObject({ ok: false, code: "agency-unresolved" });
      sinEfecto();
    });
  }

  for (const rol of ["owner", "admin"]) {
    it(`la contraprueba: owner de la organización destino y ${rol} de la agencia mapea, por el servicio`, async () => {
      membresias = [
        { organization_id: P, role: "owner", state: "active" },
        { organization_id: AGENCIA, role: rol, state: "active" },
      ];
      const { mapProperty } = await acciones();

      const res = await mapProperty({ organizationId: P, surface: "ga4", propertyRef: "properties/123456789" });

      expect(res).toEqual({ ok: true });
      const remapeo = escrituras().find((o) => o.verbo === "rpc");
      expect(remapeo?.cliente).toBe("servicio");
      expect(remapeo?.valores).toMatchObject({ p_organization_id: P, p_property_ref: "properties/123456789" });
    });
  }
});
