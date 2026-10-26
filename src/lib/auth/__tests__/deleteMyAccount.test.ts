/**
 * QUÉ IMPIDE ESTE ARCHIVO — EL BORRADO QUE DICE QUE BORRÓ, EL QUE DICE QUE NO
 * BORRÓ SIN SABERLO, Y EL QUE CLASIFICA FUERA DE LA BASE
 *
 * 1. Tragarse el error. Hasta el 2026-10-01 ningún paso miraba su `error` y la
 *    función terminaba en `redirect("/")`, que en la pantalla se lee como
 *    éxito. Cualquier fallo —la sesión incluida— tiene que volver como
 *    `ok: false` con un MOTIVO CON NOMBRE, sin redirigir y sin detalle de
 *    Postgres.
 *
 * 2. Clasificar con pedidos sueltos. Hasta #117 (`faade08`) la función leía
 *    membresías y otros owners por PostgREST y borraba con otros pedidos: una
 *    carrera entre co-owners dejaba una organización sin nadie, y una lectura
 *    truncada por `max_rows` convertía una compartida en propia (bloques 402 y
 *    403 de `supabase/qa/defects_test.sql`). Desde la 0035 eso lo hace
 *    `delete_account_organizations` en una transacción, y este archivo exige
 *    que la acción no vuelva a leer ni a borrar tablas por su cuenta: UNA
 *    llamada a la base y después el login.
 *
 * 3. Decir «no se borró nada» sin saberlo. Un error que CONTESTÓ la base (un
 *    SQLSTATE o un PGRST con status HTTP) quiere decir que la transacción se
 *    deshizo. Pero postgrest-js también devuelve `error` cuando el `fetch` se
 *    corta (status 0, con el `code` del error de red, que puede tener forma de
 *    SQLSTATE: `EPIPE`) o cuando un proxy contesta HTML: ahí la transacción
 *    pudo confirmarse. Y una respuesta sin error pero sin la forma prometida
 *    es una base que confirmó algo que no se puede contar. En los dos casos la
 *    frase dice que no se sabe, `yaBorrado` va en `null` y el login NO se toca.
 *
 * EL DOBLE. La clasificación ya no vive acá, así que el doble no la imita: es
 * la frontera tal como la ve la acción —una sesión, una llamada `rpc` con la
 * forma exacta de respuesta de postgrest-js 1.17 (`{ data, error, status }`,
 * ver `PostgrestBuilder.js`) y un `deleteUser`— más el estado que importa: si
 * la base CONFIRMÓ la transacción y si el login sigue. Y `from()` lanza: una
 * lectura o un borrado directo de tablas es la regresión que esto impide.
 *
 * Lo que el doble NO prueba: que la función de la base clasifique bien, se
 * niegue con esos códigos o aguante la carrera. Eso lo miden los bloques 402 a
 * 408 de `defects_test.sql` y `supabase/qa/baja_concurrente.sh`, contra la
 * réplica.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NADA_BORRADO } from "../porQueNoSeBorro";

const redirect = vi.fn();
// Como el de Next: `redirect` LANZA (NEXT_REDIRECT). Con un mock que devuelve,
// mover el `redirect` adentro del `try` pasaba todos los tests, y en producción
// el `catch` se tragaba la baja ya terminada y contestaba «no se pudo borrar el
// acceso» sobre una cuenta borrada (revisión del 2026-10-26).
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirect(url);
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const UMA = "11111111-1111-4111-8111-111111111111"; // la que se va
const PROPIA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AJENA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPARTIDA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ASSET = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

// ── La frontera ──────────────────────────────────────────────────────────────
/**
 * Lo que devuelve `rpc()`, más `confirmo`: si la base confirmó la transacción.
 * Eso no viaja en la respuesta —es lo que la acción NO puede ver— y el doble lo
 * usa para el estado.
 */
type Respuesta = { data: unknown; error: Record<string, unknown> | null; status: number; confirmo?: boolean };

/** Lo que la función de la base devuelve cuando confirma. */
function resultado(deleted: string[], left: string[], released: string[]) {
  return { deleted_organizations: deleted, left_organizations: left, released_seals: released };
}

const TODO_HECHO = resultado([PROPIA], [AJENA, COMPARTIDA], [ASSET]);

/** Un error que contestó la base: PostgREST lo manda con status HTTP y código. */
function contesto(code: string, status = 400, message = "algo", details = ""): Respuesta {
  return { data: null, error: { code, message, details, hint: null }, status, confirmo: false };
}

let respuesta: Respuesta;
/** Si la base confirmó la transacción. Con la respuesta perdida, puede ser `true` igual. */
let confirmo: boolean;
let login: boolean;
/** Lo que contesta auth-js: `AuthApiError` si GoTrue contestó, `AuthRetryableFetchError`/`AuthUnknownError` si no. */
let falloDelLogin: { message: string; name?: string; status?: number; code?: string } | null;
/** Si GoTrue borró el login antes de que se perdiera la respuesta. */
let borroYPerdio: boolean;
let lanza: Record<string, Error>;
let pedidas: string[];
let argumentos: unknown[];

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (lanza["admin"]) throw lanza["admin"];
    return {
      from: (tabla: string) => {
        pedidas.push(`from:${tabla}`);
        throw new Error(`doble: la acción no lee ni borra tablas (${tabla}); eso lo hace la 0035`);
      },
      rpc: async (fn: string, args: unknown) => {
        pedidas.push(`rpc:${fn}`);
        argumentos.push(args);
        if (lanza["rpc"]) {
          // La llamada salió: la base pudo confirmar antes de que se cortara.
          confirmo = true;
          throw lanza["rpc"];
        }
        const { confirmo: c, ...vista } = respuesta;
        confirmo = c ?? respuesta.error === null;
        return vista;
      },
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            pedidas.push("auth.deleteUser");
            if (lanza["auth.deleteUser"]) throw lanza["auth.deleteUser"];
            if (borroYPerdio && id === UMA) login = false;
            if (falloDelLogin) return { data: null, error: falloDelLogin };
            if (id === UMA) login = false;
            return { data: {}, error: null };
          },
        },
      },
    };
  },
}));

const { deleteMyAccount } = await import("../account-actions");

const SECUENCIA = ["rpc:delete_account_organizations", "auth.deleteUser"];

let consola: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sesion = { user: { id: UMA }, error: null };
  respuesta = { data: TODO_HECHO, error: null, status: 200 };
  confirmo = false;
  login = true;
  falloDelLogin = null;
  borroYPerdio = false;
  lanza = {};
  pedidas = [];
  argumentos = [];
  redirect.mockClear();
  consola = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consola.mockRestore());

/** Una baja que TERMINÓ: no vuelve, lanza el NEXT_REDIRECT de `redirect("/")`. */
async function terminada() {
  const e = await deleteMyAccount().then(
    (r) => ({ volvio: r }),
    (e: unknown) => e,
  );
  expect(e).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/;/) });
  expect(redirect).toHaveBeenCalledWith("/");
}

/** Nada de la base en la frase que ve la persona. */
function sinDetalleDeLaBase(mensaje: string) {
  expect(mensaje).not.toMatch(/23503|45008|45009|40001|55P03|PGRST|EPIPE|foreign key|constraint|org_members|Database error/i);
  expect(mensaje).not.toContain(AJENA);
  expect(mensaje).not.toContain(UMA);
}

describe("deleteMyAccount — una llamada a la base y después el login", () => {
  it("CONTROL: con todo en verde, llama a la función con SU id, borra el login y recién ahí redirige", async () => {
    // Sin este caso, una acción que nunca borrara —o nunca redirigiera—
    // pasaría todos los de abajo.
    expect(login).toBe(true); // anti-vacuidad
    await terminada();
    expect(pedidas).toEqual(SECUENCIA);
    expect(argumentos).toEqual([{ p_user_id: UMA }]);
    expect(login).toBe(false);
  });

  it("el redirect queda FUERA del try: la baja terminada no se convierte en un fallo con motivo", async () => {
    // Si el catch atajara el NEXT_REDIRECT, la acción devolvería un BajaFallida
    // (con el login ya borrado) en vez de lanzar, y la pantalla mostraría un
    // error sobre una cuenta que ya no existe.
    await terminada();
    expect(consola).not.toHaveBeenCalled();
  });

  it("no lee ni borra ninguna tabla por su cuenta: la clasificación es de la base (bloques 402 y 403)", async () => {
    await terminada();
    expect(pedidas.filter((p) => p.startsWith("from:"))).toEqual([]);
    expect(pedidas.filter((p) => p.startsWith("rpc:"))).toEqual(["rpc:delete_account_organizations"]);
  });

  it("sin organizaciones ni sellos (la función devuelve todo vacío) también borra el login: reintentar retoma", async () => {
    respuesta = { data: resultado([], [], []), error: null, status: 200 };
    await terminada();
    expect(pedidas).toEqual(SECUENCIA);
    expect(login).toBe(false);
  });

  it("sin sesión no llama a la base y lo dice con nombre", async () => {
    sesion = { user: null, error: null };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "sin-sesion", yaBorrado: NADA_BORRADO });
    expect(r.message).toMatch(/could not confirm that you are signed in/);
    expect(pedidas).toEqual([]);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("deleteMyAccount — la base CONTESTÓ un error: se deshizo todo, y el código dice por qué", () => {
  it.each([
    // [código, status con el que lo manda PostgREST, motivo, frase]
    ["45008", 400, "sello-en-otra-organizacion", /Ask that organization/],
    ["45010", 400, "sello-publicado-sin-quien-decida", /Contact support/],
    ["23503", 409, "firma-en-otra-organizacion", /That organization has to decide/],
    ["45009", 400, "no-se-pudo-verificar", /could not check what deleting it involves/],
    ["40001", 500, "no-se-pudo-verificar", /could not check what deleting it involves/],
    ["40P01", 500, "no-se-pudo-verificar", /could not check what deleting it involves/],
    ["55P03", 500, "no-se-pudo-verificar", /could not check what deleting it involves/],
    ["22023", 400, "no-se-pudieron-borrar-las-organizaciones", /could not delete the organizations that are only yours/],
    // Una sentencia cancelada por statement_timeout: se deshizo, aunque venga con 500.
    ["57014", 500, "no-se-pudieron-borrar-las-organizaciones", /could not delete the organizations that are only yours/],
    ["42501", 403, "no-se-pudieron-borrar-las-organizaciones", /could not delete the organizations that are only yours/],
    // La función no existe (la 0035 sin aplicar): PostgREST no abrió la transacción.
    ["PGRST202", 404, "no-se-pudieron-borrar-las-organizaciones", /could not delete the organizations that are only yours/],
    // Sin conexión del pool, o sin conectar: tampoco.
    ["PGRST003", 504, "no-se-pudieron-borrar-las-organizaciones", /could not delete the organizations that are only yours/],
    ["PGRST000", 503, "no-se-pudieron-borrar-las-organizaciones", /could not delete the organizations that are only yours/],
  ])("%s (%s) → «%s», «Nothing was deleted», y el login no se toca", async (code, status, motivo, frase) => {
    respuesta = contesto(code, status, "texto de postgres",
      `Key (organization_id, user_id)=(${AJENA}, ${UMA}) is still referenced`);
    const r = await deleteMyAccount();
    expect(confirmo).toBe(false); // anti-vacuidad: el doble deshizo
    expect(r).toMatchObject({ ok: false, motivo, yaBorrado: NADA_BORRADO });
    expect(r.message).toMatch(frase);
    expect(r.message).toMatch(/Nothing was deleted/);
    expect(pedidas).toEqual(["rpc:delete_account_organizations"]);
    expect(login).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
    sinDetalleDeLaBase(r.message);
  });

  it("el detalle de la base va al log, no a la pantalla", async () => {
    respuesta = contesto("23503", 409, "update or delete on table \"org_members\" violates foreign key constraint");
    const r = await deleteMyAccount();
    sinDetalleDeLaBase(r.message);
    // Y SÍ llega al log: un motivo con nombre no puede costar el diagnóstico.
    expect(consola.mock.calls.flat().join(" ")).toMatch(/23503/);
  });
});

describe("deleteMyAccount — la base NO contestó: no se sabe, y no lo disfraza de cero", () => {
  it.each([
    ["el fetch se cortó (status 0, sin código)",
      { data: null, error: { message: "TypeError: fetch failed", code: "" }, status: 0, confirmo: true }],
    // `EPIPE` tiene la forma de un SQLSTATE: cinco mayúsculas. El status 0 dice que no contestó nadie.
    ["el socket se rompió (status 0, código EPIPE)",
      { data: null, error: { message: "Error: write EPIPE", code: "EPIPE" }, status: 0, confirmo: true }],
    ["un proxy contestó HTML (502, sin código)",
      { data: null, error: { message: "<html>Bad Gateway</html>" }, status: 502, confirmo: true }],
    ["un 504 de la puerta, con un código que no es de la base",
      { data: null, error: { message: "timeout", code: "GATEWAY" }, status: 504, confirmo: true }],
    // PostgREST perdió la conexión con Postgres mientras mandaba el COMMIT o leía
    // su respuesta (revisión del 2026-10-26): pudo confirmarse.
    ["PGRST001: PostgREST perdió la conexión con la base (503)",
      { data: null, error: { message: "Database client error. Retrying the connection.", code: "PGRST001" }, status: 503, confirmo: true }],
    ["08006: la conexión se cayó (503)",
      { data: null, error: { message: "connection failure", code: "08006" }, status: 503, confirmo: true }],
    // Con réplica sincrónica, el apagado llega con el COMMIT ya escrito.
    ["57P01: el servidor se apagó (503)",
      { data: null, error: { message: "terminating connection due to administrator command", code: "57P01" }, status: 503, confirmo: true }],
    ["XX000: error interno (500)",
      { data: null, error: { message: "internal error", code: "XX000" }, status: 500, confirmo: true }],
    ["53100: sin disco (503)",
      { data: null, error: { message: "could not extend file", code: "53100" }, status: 503, confirmo: true }],
    ["un PGRST que no se conoce",
      { data: null, error: { message: "algo nuevo", code: "PGRST999" }, status: 500, confirmo: true }],
  ])("%s → «no-se-sabe-que-se-borro», yaBorrado null, y el login no se toca", async (_caso, r0) => {
    respuesta = r0 as Respuesta;
    const r = await deleteMyAccount();
    expect(confirmo).toBe(true); // anti-vacuidad: el doble confirmó y perdió la respuesta
    expect(r).toMatchObject({ ok: false, motivo: "no-se-sabe-que-se-borro", yaBorrado: null });
    expect(r.message).not.toMatch(/Nothing was deleted|Already done/);
    expect(r.message).toMatch(/could not confirm whether your organizations were deleted/);
    expect(r.message).toMatch(/login is still there/);
    expect(pedidas).not.toContain("auth.deleteUser");
    expect(login).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
    sinDetalleDeLaBase(r.message);
  });

  it.each([
    ["data null", null],
    ["un objeto vacío", {}],
    ["falta released_seals", { deleted_organizations: [], left_organizations: [] }],
    ["un arreglo que no es de ids", { deleted_organizations: [1], left_organizations: [], released_seals: [] }],
    ["un número en vez de un arreglo", { deleted_organizations: 1, left_organizations: [], released_seals: [] }],
    ["un arreglo de filas (forma SETOF)", [TODO_HECHO]],
  ])("sin error y sin la forma prometida (%s): no se sabe qué borró, y no borra el login", async (_caso, data) => {
    // La base CONFIRMÓ algo. Contarlo como cero y seguir al login sería borrar
    // el acceso sobre una suposición.
    respuesta = { data, error: null, status: 200 };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-sabe-que-se-borro", yaBorrado: null });
    expect(pedidas).toEqual(["rpc:delete_account_organizations"]);
    expect(login).toBe(true);
  });
});

describe("deleteMyAccount — el login, después: lo que ya se hizo se dice", () => {
  it("no puede borrar el acceso: dice qué organizaciones se fueron, de cuáles salió, qué sellos soltó, y que queda el login", async () => {
    // Un 4xx: GoTrue rechazó el pedido y no borró.
    falloDelLogin = { name: "AuthApiError", status: 403, code: "not_admin", message: "User not allowed" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({
      ok: false,
      motivo: "no-se-pudo-borrar-el-acceso",
      yaBorrado: { ajenas: 2, propias: 1, sellos: 1 },
    });
    expect(r.message).toMatch(/removed from 2 organizations that are not only yours/);
    expect(r.message).toMatch(/1 organization that was only yours was deleted/);
    expect(r.message).toMatch(/1 approval of yours was withdrawn/);
    expect(r.message).toMatch(/login is still there/);
    expect(r.message).not.toMatch(/Nothing was deleted/);
    expect(login).toBe(true);
    sinDetalleDeLaBase(r.message);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("después de un corte en el login, reintentar retoma: la función no tiene nada que hacer, y el login se borra", async () => {
    falloDelLogin = { name: "AuthApiError", status: 403, code: "not_admin", message: "User not allowed" };
    await deleteMyAccount();
    falloDelLogin = null;
    respuesta = { data: resultado([], [], []), error: null, status: 200 };
    pedidas = [];
    await terminada();
    expect(pedidas).toEqual(SECUENCIA);
    expect(login).toBe(false);
  });

  it.each([
    ["el fetch se cortó (status 0)", { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }],
    ["la puerta contestó 504", { name: "AuthRetryableFetchError", status: 504, message: "Gateway Timeout" }],
    ["el cuerpo no se pudo leer", { name: "AuthUnknownError", message: "Unexpected token <" }],
  ])("GoTrue no contestó (%s): NO dice que el login sigue, dice que no se sabe", async (_caso, err) => {
    // GoTrue pudo borrar `auth.users` y perder la respuesta (revisión del
    // 2026-10-26). Decir «Your login is still there» sería afirmar lo que no se sabe.
    borroYPerdio = true;
    falloDelLogin = err;
    const r = await deleteMyAccount();
    expect(login).toBe(false); // anti-vacuidad: el doble lo borró y perdió la respuesta
    expect(r).toMatchObject({
      ok: false,
      motivo: "no-se-sabe-si-se-borro-el-acceso",
      yaBorrado: { ajenas: 2, propias: 1, sellos: 1 },
    });
    expect(r.message).toMatch(/could not confirm whether your login was deleted/);
    expect(r.message).toMatch(/We cannot tell whether your login is still there/);
    expect(r.message).not.toMatch(/Your login is still there/);
    expect(r.message).toMatch(/Already done: you were removed from 2 organizations/);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("GoTrue CONTESTÓ un 4xx (AuthApiError 403): ahí sí se sabe que el login sigue", async () => {
    falloDelLogin = { name: "AuthApiError", status: 403, code: "not_admin", message: "User not allowed" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-borrar-el-acceso" });
    expect(r.message).toMatch(/Your login is still there/);
    expect(login).toBe(true);
  });

  it("GoTrue contestó un 5xx (unexpected_failure): no dice que el login sigue, porque su COMMIT pudo pasar", async () => {
    // Es también lo que contesta GoTrue si pierde la conexión en su propio COMMIT
    // (revisión del 2026-10-26): el análogo del PGRST001 de PostgREST.
    borroYPerdio = true;
    falloDelLogin = { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "Database error deleting user" };
    const r = await deleteMyAccount();
    expect(login).toBe(false); // anti-vacuidad: el doble lo borró y contestó 500
    expect(r).toMatchObject({ ok: false, motivo: "no-se-sabe-si-se-borro-el-acceso" });
    expect(r.message).not.toMatch(/Your login is still there/);
  });

  it("GoTrue dice que el login ya no existe (404 user_not_found, otra pestaña terminó): la baja terminó", async () => {
    // Decir «no pudimos borrar tu login… sigue ahí» sobre un login que ya no
    // existe sería falso (revisión del 2026-10-26).
    login = false;
    falloDelLogin = { name: "AuthApiError", status: 404, code: "user_not_found", message: "User not found" };
    await terminada();
    expect(pedidas).toEqual(SECUENCIA);
  });

  it("un 404 que NO es user_not_found no se lee como borrado", async () => {
    falloDelLogin = { name: "AuthApiError", status: 404, code: "not_found", message: "Not Found" };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo: "no-se-pudo-borrar-el-acceso" });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("deleteMyAccount — un paso que LANZA vuelve con el motivo de ese paso, no como excepción", () => {
  const HECHO = { ajenas: 2, propias: 1, sellos: 1 };
  it.each([
    ["server", "sin-sesion", NADA_BORRADO],
    ["getUser", "sin-sesion", NADA_BORRADO],
    ["admin", "no-se-pudo-verificar", NADA_BORRADO],
    // La llamada salió y no volvió: pudo confirmarse.
    ["rpc", "no-se-sabe-que-se-borro", null],
    // Lanzó adentro de auth-js: no se sabe si GoTrue llegó a borrarlo.
    ["auth.deleteUser", "no-se-sabe-si-se-borro-el-acceso", HECHO],
  ])("%s → «%s», con lo que ya se sabe que se borró", async (paso, motivo, yaBorrado) => {
    lanza[paso] = new Error("fetch failed");
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false, motivo });
    expect(r.yaBorrado).toEqual(yaBorrado);
    if (yaBorrado === null) expect(r.message).not.toMatch(/Nothing was deleted|Already done/);
    else if (yaBorrado === NADA_BORRADO) expect(r.message).toMatch(/Nothing was deleted/);
    else expect(r.message).toMatch(/Already done/);
    if (paso !== "auth.deleteUser") expect(pedidas).not.toContain("auth.deleteUser");
    expect(login).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
    sinDetalleDeLaBase(r.message);
    expect(r.message).not.toContain("fetch failed");
  });
});
