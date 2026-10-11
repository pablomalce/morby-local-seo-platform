/**
 * QUÉ IMPIDE ESTE ARCHIVO — EL BORRADO QUE DICE QUE BORRÓ, EL QUE BORRA A
 * MEDIAS, Y EL QUE BORRA LO QUE NO ERA SUYO
 *
 * Tres defectos de `deleteMyAccount`, el derecho al olvido.
 *
 * 1. Tragarse el error. Hasta el 2026-10-01 ningún paso miraba su `error` y la
 *    función terminaba en `redirect("/")`, que en la pantalla se lee como
 *    éxito. Cualquier fallo de cualquier paso —la sesión incluida— tiene que
 *    volver como `ok: false` con un MOTIVO CON NOMBRE, sin redirigir, sin
 *    detalle de Postgres y diciendo lo que ya se borró.
 *
 * 2. Borrar a medias lo que se podía no borrar. Medido en la réplica el
 *    2026-10-11 con el orden anterior (propias → membresías → acceso): quien
 *    publicó una versión de la ficha o aprobó una tarjeta en una organización
 *    AJENA perdía primero sus organizaciones propias y después la base le
 *    rechazaba la salida de la ajena (23503); quien selló contenido en una ajena
 *    perdía organizaciones y membresías y la base le rechazaba el borrado de
 *    `auth.users` (23514, el SET NULL de `approved_by` contra el CHECK de la
 *    0015). Tres rechazos que nadie arregla reintentando, todos después del paso
 *    irreversible.
 *
 * 3. Llevarse una organización que no era sólo suya. «Propias» se leía como
 *    `role = owner`, y el esquema deja varios owners por organización y owners
 *    archivados. Medido en la réplica el 2026-10-11: la baja de un co-owner se
 *    llevaba la organización de la otra owner con sus negocios, y la de una
 *    owner archivada también.
 *
 * EL DOBLE RECORRE LA SECUENCIA (R13). No es una lista de respuestas por
 * llamada: es una base chiquita —organizaciones, membresías con rol y estado,
 * sellos, firmas y logins— que aplica cada lectura y cada borrado con los
 * filtros que la función le pasa, hace las cascadas, y rechaza lo que la réplica
 * rechazó con el mismo código. Así los tests miran el ESTADO que queda después
 * de que la cadena se corta en cada paso, no sólo qué se llamó.
 *
 * Lo que el doble NO prueba: que la base real rechace eso. Eso lo miden los
 * bloques 119 y 132 (salir con una firma → 23503), 118 y 131 (la baja entera de
 * una organización pasa) y 400 y 401 (las FK hacia `auth.users` y el rechazo del
 * sello) de `supabase/qa/defects_test.sql`, contra la réplica.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NADA_BORRADO, type YaBorrado } from "../porQueNoSeBorro";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const UMA = "11111111-1111-4111-8111-111111111111"; // la que se va
const VERA = "22222222-2222-4222-8222-222222222222"; // dueña de la ajena
const WALT = "33333333-3333-4333-8333-333333333333"; // editor en la propia de uma
const PROPIA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROPIA_2 = "abababab-abab-4bab-8bab-abababababab";
const AJENA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPARTIDA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // uma y vera, las dos owners activas
const ARCHIVADA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // uma, owner archivada
const TERCERA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let sesion: { user: { id: string } | null; error: unknown };
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (lanza["server"]) throw lanza["server"];
    return {
      auth: {
        getUser: async () => {
          if (lanza["getUser"]) throw lanza["getUser"];
          return { data: { user: sesion.user }, error: sesion.error };
        },
      },
    };
  },
}));

// ── La base del doble ────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
type ErrorDeBase = { code?: string; message: string; details?: string };

interface Base {
  organizations: Fila[];
  org_members: Fila[];
  content_assets: Fila[];
  /** Registros firmados por una persona en una organización: published_by, verified_by, approver. */
  firmas: { organization_id: string; user_id: string; constraint: string }[];
  logins: Set<string>;
}

let base: Base;
/** Un paso que contesta error sin tocar nada (la sentencia se deshace entera). */
let fallas: Record<string, ErrorDeBase>;
/** Un paso que LANZA en vez de contestar. */
let lanza: Record<string, Error>;
/** Un paso que contesta sin error y con otra forma (data null, count null). */
let deforme: Record<string, Partial<{ data: unknown; count: number | null }>>;
let pedidas: string[];
/**
 * Cuántas veces se pidió cada `tabla.op`. La segunda lectura de `org_members`
 * —los OTROS owners de las que es owner— se llama `org_members.select#2`, para
 * poder hacerla fallar sola.
 */
let vistas: Record<string, number>;

function miembro(organization_id: string, user_id: string, role: string, state = "active"): Fila {
  return { organization_id, user_id, role, state };
}

function sembrar(): Base {
  return {
    organizations: [{ id: PROPIA }, { id: AJENA }],
    org_members: [
      miembro(PROPIA, UMA, "owner"),
      miembro(PROPIA, WALT, "editor"),
      miembro(AJENA, VERA, "owner"),
      miembro(AJENA, UMA, "manager"),
    ],
    content_assets: [
      // Un sello de uma en SU organización: se va con la cascada, no traba nada.
      { id: "c-propio", organization_id: PROPIA, approved_by: UMA },
      // Un sello de vera en la ajena: no es de uma.
      { id: "c-vera", organization_id: AJENA, approved_by: VERA },
    ],
    firmas: [],
    logins: new Set([UMA, VERA, WALT]),
  };
}

/** Suma una organización con sus membresías y lo que tiene adentro. */
function sumar(id: string, miembros: Fila[], contenido: Fila[] = []) {
  base.organizations.push({ id });
  base.org_members.push(...miembros);
  base.content_assets.push(...contenido);
}

/** `(a,b,c)` → ["a","b","c"], como lo lee PostgREST en `not.in`. */
function lista(v: unknown): string[] {
  const t = String(v).trim();
  if (!t.startsWith("(") || !t.endsWith(")")) throw new Error(`doble: lista mal formada: ${t}`);
  return t.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean);
}

function borrarOrganizaciones(ids: string[]) {
  // ON DELETE CASCADE desde organizations: membresías, contenido y lo firmado ahí.
  base.organizations = base.organizations.filter((o) => !ids.includes(o.id as string));
  base.org_members = base.org_members.filter((m) => !ids.includes(m.organization_id as string));
  base.content_assets = base.content_assets.filter((c) => !ids.includes(c.organization_id as string));
  base.firmas = base.firmas.filter((f) => !ids.includes(f.organization_id));
}

/** La membresía que una firma traba, si alguna de `filas` lo está. */
function trabada(filas: Fila[]) {
  return base.firmas.find((f) =>
    filas.some((m) => m.organization_id === f.organization_id && m.user_id === f.user_id),
  );
}

function rechazoDeFirma(f: { organization_id: string; user_id: string; constraint: string }): ErrorDeBase {
  // Textual a lo medido en la réplica, DETAIL incluido: nombra la otra organización.
  return {
    code: "23503",
    message: `update or delete on table "org_members" violates foreign key constraint "${f.constraint}" on table "company_profiles"`,
    details: `Key (organization_id, user_id)=(${f.organization_id}, ${f.user_id}) is still referenced from table "company_profiles".`,
  };
}

function consulta(tabla: keyof Base, op: "select" | "delete", conteo: boolean) {
  const filtros: ((f: Fila) => boolean)[] = [];
  let limite: number | undefined;

  async function ejecutar() {
    const raiz = `${tabla}.${op}`;
    vistas[raiz] = (vistas[raiz] ?? 0) + 1;
    const nombre = vistas[raiz] === 1 ? raiz : `${raiz}#${vistas[raiz]}`;
    pedidas.push(nombre);
    if (lanza[nombre]) throw lanza[nombre];
    if (fallas[nombre]) return { data: null, error: fallas[nombre], count: null };
    const filas = (base[tabla] as Fila[]).filter((f) => filtros.every((p) => p(f)));

    let r: { data: unknown; error: ErrorDeBase | null; count: number | null };
    if (op === "select") {
      r = { data: filas.slice(0, limite ?? filas.length).map((f) => ({ ...f })), error: null, count: null };
    } else if (tabla === "org_members") {
      // UNA sentencia: si una fila está trabada por una firma, no se borra ninguna.
      const firma = trabada(filas);
      if (firma) return { data: null, error: rechazoDeFirma(firma), count: null };
      base.org_members = base.org_members.filter((m) => !filas.includes(m));
      r = { data: null, error: null, count: conteo ? filas.length : null };
    } else if (tabla === "organizations") {
      borrarOrganizaciones(filas.map((o) => o.id as string));
      r = { data: null, error: null, count: conteo ? filas.length : null };
    } else {
      throw new Error(`doble: ${raiz} no está modelado`);
    }
    return { ...r, ...(deforme[nombre] ?? {}) };
  }

  const q = {
    eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
    neq: (c: string, v: unknown) => (filtros.push((f) => f[c] !== v), q),
    in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[c])), q),
    not: (c: string, operador: string, v: unknown) => {
      if (operador !== "in") throw new Error(`doble: not.${operador} no está modelado`);
      const vs = lista(v);
      filtros.push((f) => !vs.includes(String(f[c])));
      return q;
    },
    limit: (n: number) => ((limite = n), q),
    then: (ok: (r: unknown) => unknown, mal?: (e: unknown) => unknown) => ejecutar().then(ok, mal),
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (lanza["admin"]) throw lanza["admin"];
    return {
      from: (tabla: keyof Base) => ({
        select: () => consulta(tabla, "select", false),
        delete: (o?: { count?: string }) => consulta(tabla, "delete", o?.count === "exact"),
      }),
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            pedidas.push("auth.deleteUser");
            if (lanza["auth.deleteUser"]) throw lanza["auth.deleteUser"];
            if (fallas["auth.deleteUser"]) return { data: null, error: fallas["auth.deleteUser"] };
            // Lo que la réplica rechaza al borrar de `auth.users`, y GoTrue
            // devuelve como «Database error deleting user»:
            //  * un sello firmado por la persona (SET NULL contra el CHECK: 23514);
            //  * una membresía que cae por cascada y está trabada por una firma (23503).
            const membresias = base.org_members.filter((m) => m.user_id === id);
            if (base.content_assets.some((c) => c.approved_by === id) || trabada(membresias)) {
              return { data: null, error: { status: 500, message: "Database error deleting user" } };
            }
            base.logins.delete(id);
            base.org_members = base.org_members.filter((m) => m.user_id !== id);
            return { data: {}, error: null };
          },
        },
      },
    };
  },
}));

const { deleteMyAccount } = await import("../account-actions");

const NOMBRES: Record<string, string> = {
  [PROPIA]: "propia",
  [PROPIA_2]: "propia2",
  [AJENA]: "ajena",
  [COMPARTIDA]: "compartida",
  [ARCHIVADA]: "archivada",
  [TERCERA]: "tercera",
};

/** Lo que queda de uma en la base. */
function deUma() {
  return {
    propia: base.organizations.some((o) => o.id === PROPIA),
    membresias: base.org_members
      .filter((m) => m.user_id === UMA)
      .map((m) => `${NOMBRES[m.organization_id as string] ?? "otra"}:${m.role}${m.state === "active" ? "" : `:${m.state}`}`)
      .sort(),
    login: base.logins.has(UMA),
  };
}

/** Lo que queda de una organización: si existe, quiénes la integran y qué contenido tiene. */
function deLaOrganizacion(id: string) {
  return {
    existe: base.organizations.some((o) => o.id === id),
    miembros: base.org_members
      .filter((m) => m.organization_id === id)
      .map((m) => `${m.user_id === UMA ? "uma" : m.user_id === VERA ? "vera" : "walt"}:${m.role}`)
      .sort(),
    contenido: base.content_assets.filter((c) => c.organization_id === id).map((c) => c.id),
  };
}

const INTACTA = { propia: true, membresias: ["ajena:manager", "propia:owner"], login: true };
const SECUENCIA = [
  "org_members.select",
  "org_members.select#2",
  "content_assets.select",
  "org_members.delete",
  "organizations.delete",
  "auth.deleteUser",
];

let consola: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sesion = { user: { id: UMA }, error: null };
  base = sembrar();
  fallas = {};
  lanza = {};
  deforme = {};
  pedidas = [];
  vistas = {};
  redirect.mockClear();
  consola = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consola.mockRestore());

/** Nada de la base en la frase que ve la persona. */
function sinDetalleDeLaBase(mensaje: string) {
  expect(mensaje).not.toMatch(/23503|23514|foreign key|constraint|org_members|company_profiles|Database error/i);
  expect(mensaje).not.toContain(AJENA);
  expect(mensaje).not.toContain(UMA);
}

describe("deleteMyAccount — la secuencia entera", () => {
  it("CONTROL: con todo en verde, recorre los seis pasos en orden, no deja nada de uma y recién ahí redirige", async () => {
    // Sin este caso, una función que nunca borrara —o nunca redirigiera—
    // pasaría todos los de abajo.
    expect(deUma()).toEqual(INTACTA); // anti-vacuidad: la fixture tiene lo que dice
    await deleteMyAccount();
    expect(pedidas).toEqual(SECUENCIA);
    expect(deUma()).toEqual({ propia: false, membresias: [], login: false });
    expect(redirect).toHaveBeenCalledWith("/");
    // La ajena sigue: uma se fue de ella, no la borró.
    expect(base.organizations.map((o) => o.id)).toEqual([AJENA]);
    expect(base.org_members.filter((m) => m.organization_id === AJENA).map((m) => m.user_id)).toEqual([VERA]);
  });

  it("un sello suyo en SU organización no traba nada: se va con la cascada", async () => {
    expect(base.content_assets.some((c) => c.approved_by === UMA && c.organization_id === PROPIA)).toBe(true);
    await deleteMyAccount();
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("sin organizaciones propias, sale de las ajenas y borra el acceso", async () => {
    base.organizations = base.organizations.filter((o) => o.id !== PROPIA);
    base.org_members = base.org_members.filter((m) => m.organization_id !== PROPIA);
    base.content_assets = base.content_assets.filter((c) => c.organization_id !== PROPIA);
    await deleteMyAccount();
    expect(pedidas).toEqual(["org_members.select", "content_assets.select", "org_members.delete", "auth.deleteUser"]);
    expect(deUma()).toEqual({ propia: false, membresias: [], login: false });
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("con DOS propias, borra las dos", async () => {
    sumar(PROPIA_2, [miembro(PROPIA_2, UMA, "owner")]);
    await deleteMyAccount();
    expect(base.organizations.map((o) => o.id)).toEqual([AJENA]);
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("sin sesión no toca nada y lo dice con nombre", async () => {
    sesion = { user: null, error: null };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "sin-sesion", yaBorrado: NADA_BORRADO });
    expect(r.message).toMatch(/could not confirm that you are signed in/);
    expect(pedidas).toEqual([]);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("deleteMyAccount — sólo se borra la organización que es SÓLO suya", () => {
  // El defecto medido en la réplica el 2026-10-11: «propias» era `role = owner`.
  // Un owner suma un admin, el admin se sube a owner por la RLS, y la baja del
  // segundo se llevaba la organización del primero con todo lo que tenía.

  it("con OTRO owner activo, la organización es compartida: sale de ella y queda entera para la otra", async () => {
    sumar(
      COMPARTIDA,
      [miembro(COMPARTIDA, VERA, "owner"), miembro(COMPARTIDA, UMA, "owner")],
      [{ id: "c-vera-compartida", organization_id: COMPARTIDA, approved_by: VERA }],
    );
    await deleteMyAccount();
    expect(redirect).toHaveBeenCalledWith("/");
    expect(deLaOrganizacion(COMPARTIDA)).toEqual({
      existe: true,
      miembros: ["vera:owner"],
      contenido: ["c-vera-compartida"],
    });
    // La que sí era sólo suya, se fue.
    expect(deLaOrganizacion(PROPIA).existe).toBe(false);
    expect(deUma()).toEqual({ propia: false, membresias: [], login: false });
  });

  it("owner ARCHIVADA (ya la sacaron): no es suya, sale y la organización queda", async () => {
    // Como en hosted el 2026-10-11: membresías owner archivadas en
    // organizaciones sin otro miembro activo.
    sumar(
      ARCHIVADA,
      [miembro(ARCHIVADA, UMA, "owner", "archived")],
      [{ id: "c-archivada", organization_id: ARCHIVADA, approved_by: null }],
    );
    await deleteMyAccount();
    expect(redirect).toHaveBeenCalledWith("/");
    expect(deLaOrganizacion(ARCHIVADA)).toEqual({ existe: true, miembros: [], contenido: ["c-archivada"] });
    expect(deUma()).toEqual({ propia: false, membresias: [], login: false });
  });

  it("owner archivada donde otra es owner activa: tampoco la borra", async () => {
    sumar(ARCHIVADA, [miembro(ARCHIVADA, VERA, "owner"), miembro(ARCHIVADA, UMA, "owner", "archived")]);
    await deleteMyAccount();
    expect(deLaOrganizacion(ARCHIVADA)).toMatchObject({ existe: true, miembros: ["vera:owner"] });
  });

  it("el OTRO owner archivado no la vuelve compartida: es sólo suya y se borra", async () => {
    // Sin el filtro de estado en la lectura de los otros owners, la propia se
    // leería compartida, uma saldría de ella y la organización quedaría sin
    // ningún owner activo, con todo lo que tiene.
    base.org_members = base.org_members.map((m) =>
      m.organization_id === PROPIA && m.user_id === WALT ? { ...m, role: "owner", state: "archived" } : m,
    );
    await deleteMyAccount();
    expect(redirect).toHaveBeenCalledWith("/");
    expect(deLaOrganizacion(PROPIA).existe).toBe(false);
  });

  it("selló contenido en la COMPARTIDA: no se borra nada (esa organización no se va, y el sello traba el acceso)", async () => {
    sumar(
      COMPARTIDA,
      [miembro(COMPARTIDA, VERA, "owner"), miembro(COMPARTIDA, UMA, "owner")],
      [{ id: "c-uma-compartida", organization_id: COMPARTIDA, approved_by: UMA }],
    );
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "sello-en-otra-organizacion", yaBorrado: NADA_BORRADO });
    expect(deUma()).toEqual({ ...INTACTA, membresias: ["ajena:manager", "compartida:owner", "propia:owner"] });
    expect(pedidas).not.toContain("org_members.delete");
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", "active"],
    ["manager", "active"],
    ["editor", "active"],
    ["viewer", "active"],
    ["client", "active"],
    ["owner", "active"], // compartida: vera también es owner activa
    ["owner", "archived"],
    ["manager", "archived"],
  ])(
    "sale de una organización donde es %s (%s) ANTES de borrar la propia: una firma ahí no deja nada a medias",
    async (role, state) => {
      // Una membresía que el paso de salir NO quita la encuentra después la
      // cascada de `auth.users`, con la propia ya borrada: queda sólo el login.
      sumar(TERCERA, [miembro(TERCERA, VERA, "owner"), miembro(TERCERA, UMA, role, state)]);
      base.firmas.push({ organization_id: TERCERA, user_id: UMA, constraint: "company_profiles_published_by_member_fkey" });
      const r = await deleteMyAccount();
      expect(r).toMatchObject({ ok: false, motivo: "firma-en-otra-organizacion", yaBorrado: NADA_BORRADO });
      expect(deLaOrganizacion(PROPIA).existe).toBe(true);
      expect(base.logins.has(UMA)).toBe(true);
      expect(pedidas).not.toContain("organizations.delete");
      expect(redirect).not.toHaveBeenCalled();
    },
  );
});

describe("deleteMyAccount — los rechazos que deciden otros, ANTES de borrar nada", () => {
  it("publicó una versión de la ficha en la ajena: NO se borra nada, ni siquiera la propia", async () => {
    // El defecto medido: con el orden viejo, la propia ya se había ido cuando
    // la base rechazaba la salida de la ajena.
    base.firmas.push({ organization_id: AJENA, user_id: UMA, constraint: "company_profiles_published_by_member_fkey" });
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "firma-en-otra-organizacion", yaBorrado: { ajenas: 0, propias: 0 } });
    expect(deUma()).toEqual(INTACTA);
    expect(pedidas).not.toContain("organizations.delete");
    expect(pedidas).not.toContain("auth.deleteUser");
    expect(r.message).toMatch(/Nothing was deleted/);
    sinDetalleDeLaBase(r.message);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("aprobó una tarjeta en la ajena: lo mismo, con la FK del aprobador", async () => {
    base.firmas.push({ organization_id: AJENA, user_id: UMA, constraint: "board_cards_approver_member_fkey" });
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "firma-en-otra-organizacion" });
    expect(deUma()).toEqual(INTACTA);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("selló contenido en la ajena: lo ve ANTES de salir de nada, y no borra nada", async () => {
    // El rechazo que la base da recién en `auth.users`. Sin la verificación,
    // la cadena llegaba ahí con la propia y las membresías ya borradas.
    base.content_assets.push({ id: "c-uma-en-ajena", organization_id: AJENA, approved_by: UMA });
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "sello-en-otra-organizacion", yaBorrado: { ajenas: 0, propias: 0 } });
    expect(deUma()).toEqual(INTACTA);
    expect(pedidas).toEqual(["org_members.select", "org_members.select#2", "content_assets.select"]);
    expect(r.message).toMatch(/Nothing was deleted/);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("deleteMyAccount — un fallo en CADA paso vuelve con su motivo y dice qué quedó (R13)", () => {
  it("paso 1, no puede leer sus membresías: no borra nada", async () => {
    fallas["org_members.select"] = { message: "timeout" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-verificar" });
    expect(pedidas).toEqual(["org_members.select"]);
    expect(deUma()).toEqual(INTACTA);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("paso 1, sin error y SIN FILAS (data null): no es cero, no sigue", async () => {
    // Con `data ?? []` el paso de las propias se salteaba y el del acceso las
    // dejaba sin dueño: la cascada de `auth.users` se lleva la membresía owner y
    // la organización queda, inalcanzable.
    deforme["org_members.select"] = { data: null };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-verificar" });
    expect(deUma()).toEqual(INTACTA);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("paso 2, no puede leer los OTROS owners: no borra nada (no sabe cuál es sólo suya)", async () => {
    fallas["org_members.select#2"] = { message: "timeout" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-verificar", yaBorrado: NADA_BORRADO });
    expect(pedidas).toEqual(["org_members.select", "org_members.select#2"]);
    expect(deUma()).toEqual(INTACTA);
  });

  it("paso 2, sin error y sin filas: tampoco sigue (ausencia de otros owners no es «ninguno»)", async () => {
    // Leído como cero, una compartida se borraría como si fuera sólo suya.
    sumar(COMPARTIDA, [miembro(COMPARTIDA, VERA, "owner"), miembro(COMPARTIDA, UMA, "owner")]);
    deforme["org_members.select#2"] = { data: null };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-verificar" });
    expect(deLaOrganizacion(COMPARTIDA).existe).toBe(true);
    expect(deLaOrganizacion(PROPIA).existe).toBe(true);
  });

  it("paso 3, no puede verificar los sellos: no borra nada", async () => {
    fallas["content_assets.select"] = { message: "permission denied" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-verificar" });
    expect(pedidas).toEqual(["org_members.select", "org_members.select#2", "content_assets.select"]);
    expect(deUma()).toEqual(INTACTA);
  });

  it("paso 3, sin error y sin filas: tampoco sigue", async () => {
    deforme["content_assets.select"] = { data: null };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-verificar" });
    expect(deUma()).toEqual(INTACTA);
  });

  it("paso 4, no puede salir de las demás por otro motivo: no borra nada y no lo llama firma", async () => {
    fallas["org_members.delete"] = { code: "57014", message: "canceling statement due to statement timeout" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-salir" });
    expect(deUma()).toEqual(INTACTA);
    expect(pedidas).not.toContain("organizations.delete");
    sinDetalleDeLaBase(r.message);
  });

  it("paso 5, no puede borrar las propias: ya salió de la ajena, y lo DICE", async () => {
    fallas["organizations.delete"] = { message: "timeout" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({
      ok: false,
      motivo: "no-se-pudieron-borrar-las-propias",
      yaBorrado: { ajenas: 1, propias: 0 },
    });
    expect(deUma()).toEqual({ propia: true, membresias: ["propia:owner"], login: true });
    expect(pedidas).not.toContain("auth.deleteUser");
    expect(r.message).toMatch(/removed from 1 organization that is not only yours/);
    expect(r.message).not.toMatch(/Nothing was deleted/);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("paso 5, borra MENOS de las que leyó: no sigue al acceso (dejaría organizaciones sin dueño)", async () => {
    deforme["organizations.delete"] = { count: 0 };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudieron-borrar-las-propias" });
    expect(pedidas).not.toContain("auth.deleteUser");
    expect(base.logins.has(UMA)).toBe(true);
  });

  it("paso 5, no dice CUÁNTAS borró (count null): tampoco sigue al acceso, y no inventa el número", async () => {
    // Sin error no es «todas»: si no se sabe, el paso 6 podría dejar alguna
    // propia sin dueño por la cascada de `auth.users`.
    deforme["organizations.delete"] = { count: null };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({
      ok: false,
      motivo: "no-se-pudieron-borrar-las-propias",
      yaBorrado: { ajenas: 1, propias: null },
    });
    expect(pedidas).not.toContain("auth.deleteUser");
    expect(base.logins.has(UMA)).toBe(true);
    expect(r.message).toMatch(/organizations that were only yours may have been deleted/);
    expect(r.message).not.toMatch(/Nothing was deleted/);
  });

  it("paso 4 no dice cuántas quitó (count null) y después se corta: la frase dice que salió, sin número", async () => {
    deforme["org_members.delete"] = { count: null };
    fallas["auth.deleteUser"] = { message: "Database error deleting user" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-borrar-el-acceso", yaBorrado: { ajenas: null, propias: 1 } });
    expect(r.message).toMatch(/you were removed from organizations that are not only yours;/);
  });

  it("paso 4 no dice cuántas quitó y el 5 falla: NO dice «Nothing was deleted»", async () => {
    deforme["org_members.delete"] = { count: null };
    fallas["organizations.delete"] = { message: "timeout" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, yaBorrado: { ajenas: null, propias: 0 } });
    expect(r.message).not.toMatch(/Nothing was deleted/);
    expect(r.message).toMatch(/removed from organizations that are not only yours/);
  });

  it("paso 6, no puede borrar el acceso: dice que salió de la ajena, que la propia se borró, y que queda el login", async () => {
    fallas["auth.deleteUser"] = { message: "Database error deleting user" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({
      ok: false,
      motivo: "no-se-pudo-borrar-el-acceso",
      yaBorrado: { ajenas: 1, propias: 1 },
    });
    expect(deUma()).toEqual({ propia: false, membresias: [], login: true });
    expect(r.message).toMatch(/removed from 1 organization that is not only yours/);
    expect(r.message).toMatch(/1 organization that was only yours was deleted/);
    expect(r.message).toMatch(/login is still there/);
    expect(r.message).not.toMatch(/Nothing was deleted/);
    sinDetalleDeLaBase(r.message);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("después de un corte en el paso 6, reintentar retoma y termina", async () => {
    fallas["auth.deleteUser"] = { message: "Database error deleting user" };
    await deleteMyAccount();
    delete fallas["auth.deleteUser"];
    pedidas = [];
    vistas = {};
    await deleteMyAccount();
    expect(pedidas).toEqual(["org_members.select", "content_assets.select", "org_members.delete", "auth.deleteUser"]);
    expect(deUma()).toEqual({ propia: false, membresias: [], login: false });
    expect(redirect).toHaveBeenCalledWith("/");
  });

  const SALIO: YaBorrado = { ajenas: 1, propias: 0 };
  const SALIO_Y_BORRO: YaBorrado = { ajenas: 1, propias: 1 };
  it.each([
    ["server", "sin-sesion", NADA_BORRADO, INTACTA],
    ["getUser", "sin-sesion", NADA_BORRADO, INTACTA],
    ["admin", "no-se-pudo-verificar", NADA_BORRADO, INTACTA],
    ["org_members.select", "no-se-pudo-verificar", NADA_BORRADO, INTACTA],
    ["org_members.select#2", "no-se-pudo-verificar", NADA_BORRADO, INTACTA],
    ["content_assets.select", "no-se-pudo-verificar", NADA_BORRADO, INTACTA],
    ["org_members.delete", "no-se-pudo-salir", NADA_BORRADO, INTACTA],
    ["organizations.delete", "no-se-pudieron-borrar-las-propias", SALIO, { propia: true, membresias: ["propia:owner"], login: true }],
    ["auth.deleteUser", "no-se-pudo-borrar-el-acceso", SALIO_Y_BORRO, { propia: false, membresias: [], login: true }],
  ])(
    "un paso que LANZA (%s) vuelve con el motivo de ese paso y con lo que ya se borró, no como excepción",
    async (paso, motivo, yaBorrado, queda) => {
      lanza[paso] = new Error("fetch failed");
      const r = await deleteMyAccount();
      expect(r).toMatchObject({ ok: false, motivo });
      // Lo que ya no está no se olvida porque el paso lanzó en vez de contestar.
      expect(r.yaBorrado).toEqual(yaBorrado);
      expect(deUma()).toEqual(queda);
      if (yaBorrado.ajenas === 0 && yaBorrado.propias === 0) expect(r.message).toMatch(/Nothing was deleted/);
      else expect(r.message).not.toMatch(/Nothing was deleted/);
      expect(redirect).not.toHaveBeenCalled();
      sinDetalleDeLaBase(r.message);
      expect(r.message).not.toContain("fetch failed");
    },
  );

  it("el detalle de la base va al log, no a la pantalla", async () => {
    base.firmas.push({ organization_id: AJENA, user_id: UMA, constraint: "company_profiles_published_by_member_fkey" });
    const r = await deleteMyAccount();
    sinDetalleDeLaBase(r.message);
    // Y SÍ llega al log: un motivo con nombre no puede costar el diagnóstico.
    expect(consola.mock.calls.flat().join(" ")).toMatch(/23503/);
  });
});
