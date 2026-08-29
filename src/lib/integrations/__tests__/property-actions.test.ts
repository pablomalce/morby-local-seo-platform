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
import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

/** Hay sesión, y de quién. */
let usuario: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };
/** Las membresías que la lectura de sesión devuelve. */
let membresias: { organization_id: string }[] = [];
/** Un fallo de lectura de membresías, cuando el test lo pide. */
let errorDeMembresia: { message: string } | null = null;
/** Y si además del error el driver devuelve filas, que es lo que a veces hace. */
let membresiasJuntoAlError = false;
/**
 * Lo que contesta cada escritura, POR VERBO.
 *
 * Separado a propósito: un doble que conteste el mismo error a las dos hace que
 * el fallo del UPDATE tape al del INSERT, y el test del 23505 pasaría midiendo
 * el paso equivocado. Ya pasó al escribir este archivo.
 */
let errorPorVerbo: { update?: { code?: string; message: string }; insert?: { code?: string; message: string } } = {};

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
          return {
            data: errorDeMembresia && !membresiasJuntoAlError ? null : membresias,
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

beforeEach(() => {
  usuario = { id: "11111111-1111-4111-8111-111111111111" };
  membresias = [{ organization_id: ORG }];
  errorDeMembresia = null;
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
  it("el INSERT va por el cliente de servicio y nunca por el de sesión", async () => {
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/123456789",
    });

    expect(res).toEqual({ ok: true });
    const insert = escrituras().find((o) => o.verbo === "insert");
    expect(insert, "no se insertó el mapeo").toBeDefined();
    expect(insert!.cliente).toBe("servicio");
    expect(insert!.tabla).toBe("integration_properties");
    expect(insert!.valores).toEqual({
      organization_id: ORG,
      provider: "ga4",
      property_ref: "properties/123456789",
    });
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
    const insert = escrituras().find((o) => o.verbo === "insert");
    expect(insert!.valores!.property_ref).toBe("properties/123456789");
  });
});

describe("remapear: primero se desmapea, después se inserta", () => {
  it("el desmapeo ocurre ANTES del insert", async () => {
    // El índice `integration_properties_one_live_per_provider` rechaza el INSERT
    // mientras el anterior siga vivo, así que al revés no funciona nunca. Y como
    // los dos pasos no son una transacción, la caída en el medio deja al cliente
    // SIN mapear —que no muestra nada de nadie— en vez de con dos mapeos vivos,
    // que es la mitad de los reportes con los números del sitio equivocado.
    const { mapProperty } = await acciones();
    await mapProperty({ organizationId: ORG, surface: "ga4", propertyRef: "properties/1" });

    const orden = escrituras().map((o) => o.verbo);
    expect(orden).toEqual(["update", "insert"]);

    const update = escrituras()[0];
    expect(update.filtros).toMatchObject({
      organization_id: ORG,
      provider: "ga4",
      unmapped_at: null,
    });
  });

  it("si el desmapeo falla no se inserta", async () => {
    errorPorVerbo = { update: { message: "no se pudo" } };
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/1",
    });
    expect(res).toMatchObject({ code: "write-failed" });
    expect(escrituras().some((o) => o.verbo === "insert")).toBe(false);
  });
});

describe("la unicidad global, que es la fuga rechazada", () => {
  it("un 23505 se cuenta como «esa property ya es de otra organización»", async () => {
    // Acá 23505 sólo puede ser la unicidad GLOBAL: la de
    // `(organization_id, provider)` se despejó en el paso anterior. Decir «error
    // al guardar» dejaría al operador reintentando lo mismo para siempre.
    errorPorVerbo = { insert: { code: "23505", message: "duplicate key value" } };
    const { mapProperty } = await acciones();
    const res = await mapProperty({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/1",
    });
    expect(res).toMatchObject({ code: "property-taken" });
    expect(res.ok === false && res.message).toContain("otra organización");
  });

  it("cualquier otro fallo de la base no se disfraza de conflicto de property", async () => {
    errorPorVerbo = { insert: { code: "42501", message: "permission denied" } };
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
