/**
 * QUÉ IMPIDE ESTE ARCHIVO — EL BORRADO QUE DICE QUE BORRÓ
 *
 * Que el derecho al olvido le conteste «listo» a una persona a la que no se le
 * borró nada.
 *
 * Medido en la réplica el 2026-09-30, revisando H1.2: con una versión publicada
 * de la ficha (la `0026`), el `DELETE` de la organización muere con
 * `23503 | update or delete on table "org_members" violates foreign key
 * constraint "company_profiles_published_by_member_fkey"`. `deleteMyAccount` no
 * miraba el `error` de ninguno de sus cuatro pasos: el borrado de la
 * organización fallaba, el de las membresías también, el de `auth.users`
 * también —la misma FK, por la cascada a `org_members`— y la función terminaba
 * en `redirect("/")`, que en la pantalla se lee como éxito.
 *
 * La `0026` ya no traba la baja de la organización entera (su decisión 18),
 * pero sigue negándose, a propósito, a borrar a UN miembro que publicó o
 * verificó mientras la versión exista (decisión 4). Ese rechazo es correcto y
 * tiene que llegarle a la persona. Este archivo sostiene que cualquier error de
 * cualquier paso corta la cadena y vuelve como `ok: false`, sin redirigir.
 *
 * El cliente de Supabase es un doble, y lo que el doble NO prueba está dicho:
 * que el `DELETE` real pase o falle es asunto de los bloques 95 a 97 de
 * `supabase/qa/defects_test.sql`, que corren contra la réplica. Acá se mide
 * sólo qué hace la función con lo que la base le contesta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const USUARIO = { id: "11111111-1111-4111-8111-111111111111" };

let sesion: { user: typeof USUARIO | null; error: unknown };
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sesion.user }, error: sesion.error }) },
  }),
}));

// El doble del cliente admin. Cada paso de `deleteMyAccount` es una operación
// con nombre; el test decide qué contesta cada una y lee en qué orden se
// pidieron. Lo que no se configura contesta éxito.
type Respuesta = { data?: unknown; error: { code?: string; message: string } | null };
let respuestas: Record<string, Respuesta>;
let pedidas: string[];

function consulta(nombre: string) {
  // Encadenable como el builder de supabase-js (`.eq().eq()`, `.in()`) y
  // awaitable al final, que es donde la base contesta.
  const q = {
    eq: () => q,
    in: () => q,
    then: (resolver: (r: Respuesta) => unknown, rechazar?: (e: unknown) => unknown) => {
      pedidas.push(nombre);
      return Promise.resolve(respuestas[nombre] ?? { data: null, error: null }).then(resolver, rechazar);
    },
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (tabla: string) => ({
      select: () => consulta(`${tabla}.select`),
      delete: () => consulta(`${tabla}.delete`),
    }),
    auth: {
      admin: {
        deleteUser: async () => {
          pedidas.push("auth.deleteUser");
          return respuestas["auth.deleteUser"] ?? { data: {}, error: null };
        },
      },
    },
  }),
}));

const { deleteMyAccount } = await import("../account-actions");

// La respuesta que la base da hoy al borrar una organización con una versión
// publicada, si la FK volviera a comprobarse antes de que la cascada termine.
const FK_PUBLICADA = {
  code: "23503",
  message:
    'update or delete on table "org_members" violates foreign key constraint "company_profiles_published_by_member_fkey" on table "company_profiles"',
};

beforeEach(() => {
  sesion = { user: USUARIO, error: null };
  pedidas = [];
  redirect.mockClear();
  respuestas = {
    "org_members.select": { data: [{ organization_id: "o1" }], error: null },
  };
});

describe("deleteMyAccount", () => {
  it("CONTROL: con los cuatro pasos en verde, borra en orden y recién ahí redirige", async () => {
    // Sin este caso, una función que nunca redirigiera —o que no borrara nada—
    // pasaría todos los de abajo.
    await deleteMyAccount();
    expect(pedidas).toEqual([
      "org_members.select",
      "organizations.delete",
      "org_members.delete",
      "auth.deleteUser",
    ]);
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("si el borrado de la organización falla, NO sigue, NO redirige y lo dice", async () => {
    respuestas["organizations.delete"] = { error: FK_PUBLICADA };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false });
    expect(r?.message).toMatch(/not deleted/i);
    expect(pedidas).not.toContain("org_members.delete");
    expect(pedidas).not.toContain("auth.deleteUser");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("si no puede leer qué organizaciones son suyas, no borra NADA", async () => {
    // Antes: `data` venía en null, el paso 1 se salteaba en silencio y los pasos
    // 2 y 3 borraban la persona dejando sus organizaciones sin dueño.
    respuestas["org_members.select"] = { data: null, error: { message: "timeout" } };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false });
    expect(pedidas).toEqual(["org_members.select"]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("si no puede sacar sus membresías en organizaciones ajenas, no borra la cuenta", async () => {
    // El caso que la `0026` rechaza a propósito: publicó o verificó en una
    // organización que no es suya, y esa versión sigue ahí.
    respuestas["org_members.delete"] = { error: FK_PUBLICADA };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false });
    expect(r?.message).toMatch(/not deleted/i);
    expect(pedidas).not.toContain("auth.deleteUser");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("si el borrado de auth.users falla, no redirige como si hubiera borrado", async () => {
    respuestas["auth.deleteUser"] = { data: null, error: { message: "Database error deleting user" } };
    const r = await deleteMyAccount();
    expect(r).toMatchObject({ ok: false });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("dice qué quedó borrado cuando la cadena se corta a la mitad", async () => {
    // Las organizaciones ya se fueron cuando falla el paso 2: un «no se borró
    // nada» sería otra forma de mentir.
    respuestas["org_members.delete"] = { error: FK_PUBLICADA };
    const r = await deleteMyAccount();
    expect(r?.message).toMatch(/organizations you owned were deleted/i);
  });

  it("sin organizaciones propias, igual saca las membresías y borra la cuenta", async () => {
    respuestas["org_members.select"] = { data: [], error: null };
    await deleteMyAccount();
    expect(pedidas).toEqual(["org_members.select", "org_members.delete", "auth.deleteUser"]);
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("sin sesión no toca nada", async () => {
    sesion = { user: null, error: null };
    const r = await deleteMyAccount();
    expect(r).toEqual({ ok: false, message: "Not authenticated" });
    expect(pedidas).toEqual([]);
  });
});
