/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la lista de quién escribe y quién aprueba diga una cosa en TypeScript y
 * otra en la base.
 *
 * `QUIEN_PUEDE.escribir` y `QUIEN_PUEDE.aprobar` repiten, a mano, los roles de
 * `current_user_writer_org_ids()` y `current_user_approver_org_ids()` de la 0031.
 * Es la misma situación que `forma_canonica.sql` cuida con el `property_ref`: dos
 * copias de una regla se separan, y la separación no avisa. Si la ruta deja
 * aprobar a un editor y la base no, el editor recibe un 404 donde la pantalla le
 * prometió un botón; al revés, la ruta niega lo que PostgREST deja hacer.
 *
 * Por eso se lee el TEXTO de la migración y se compara: un test que importara
 * las dos listas del mismo módulo no podría ver la divergencia.
 *
 * Y `permisoEn()` se mide contra un doble del cliente de sesión en sus cuatro
 * salidas, porque las rutas dependen de que distinga «no se pudo leer» de «no
 * sos miembro» de «tu rol no alcanza».
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUIEN_PUEDE, ROLES, permisoEn, rolPuede } from "../rol";

const MIGRACION = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0031_client_role.sql"),
  "utf8"
);

/** Los roles del `role IN (...)` del cuerpo de una función de la 0031. */
function rolesDeLaFuncion(nombre: string): string[] {
  const cuerpo = MIGRACION.match(
    new RegExp(`FUNCTION public\\.${nombre}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`)
  );
  if (!cuerpo) return [];
  const lista = cuerpo[1].match(/role IN \(([^)]*)\)/);
  if (!lista) return [];
  return [...lista[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
}

/** Los roles del CHECK de `org_members.role` que la 0031 deja puesto. */
function rolesDelCheck(): string[] {
  const check = MIGRACION.match(/ADD CONSTRAINT org_members_role_check\s+CHECK \(role IN \(([^)]*)\)\)/);
  if (!check) return [];
  return [...check[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
}

describe("las listas de rol.ts son las de la 0031", () => {
  it("anti-vacío: la migración tiene las dos funciones y el CHECK, con roles adentro", () => {
    expect(rolesDeLaFuncion("current_user_writer_org_ids").length).toBeGreaterThan(0);
    expect(rolesDeLaFuncion("current_user_approver_org_ids").length).toBeGreaterThan(0);
    expect(rolesDelCheck().length).toBeGreaterThan(0);
  });

  it("escribir === current_user_writer_org_ids()", () => {
    expect([...QUIEN_PUEDE.escribir].sort()).toEqual(rolesDeLaFuncion("current_user_writer_org_ids").sort());
  });

  it("aprobar === current_user_approver_org_ids()", () => {
    expect([...QUIEN_PUEDE.aprobar].sort()).toEqual(rolesDeLaFuncion("current_user_approver_org_ids").sort());
  });

  it("personal === current_user_staff_org_ids()", () => {
    // La tercera copia, que la primera versión no comparaba: una función de
    // personal escrita como `role <> 'client'` pasaba todo (medido por un
    // crítico el 2026-10-08). El bloque 215 lo mide en la base; esto, que la
    // pantalla pregunte lo mismo.
    expect(rolesDeLaFuncion("current_user_staff_org_ids").length).toBeGreaterThan(0);
    expect([...QUIEN_PUEDE.personal].sort()).toEqual(rolesDeLaFuncion("current_user_staff_org_ids").sort());
  });

  it("las tres funciones listan los roles que SÍ: ninguna es una lista de exclusión", () => {
    // `rolesDeLaFuncion` lee el primer `role IN (...)`; un cuerpo con un
    // `role <> ...` o un `NOT IN` además de él lo pasaría por alto.
    for (const nombre of [
      "current_user_writer_org_ids",
      "current_user_staff_org_ids",
      "current_user_approver_org_ids",
    ]) {
      const cuerpo = MIGRACION.match(
        new RegExp(`FUNCTION public\\.${nombre}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`)
      )?.[1];
      expect(cuerpo, nombre).toBeDefined();
      expect(cuerpo, nombre).toMatch(/role IN \(/);
      expect(cuerpo, nombre).not.toMatch(/role\s*(<>|!=|NOT\s+IN)/i);
    }
  });

  it("ROLES === el CHECK de org_members.role", () => {
    expect([...ROLES].sort()).toEqual(rolesDelCheck().sort());
  });

  it("client no está en ninguna de las acciones: es lo que D2 decidió", () => {
    for (const accion of ["escribir", "aprobar", "integrar", "personal"] as const) {
      expect(rolPuede("client", accion), accion).toBe(false);
    }
  });

  it("y un rol que no existe tampoco, ni la ausencia de rol", () => {
    expect(rolPuede("superadmin", "escribir")).toBe(false);
    expect(rolPuede(null, "escribir")).toBe(false);
    expect(rolPuede(undefined, "aprobar")).toBe(false);
  });
});

/** Un doble del cliente de sesión que contesta la lectura de `org_members`. */
function cliente(respuesta: { data: unknown; error: unknown }) {
  const filtros: Record<string, string> = {};
  const doble = {
    filtros,
    tabla: "",
    from(tabla: string) {
      doble.tabla = tabla;
      const cadena = {
        select: () => cadena,
        eq: (col: string, val: string) => {
          filtros[col] = val;
          return cadena;
        },
        limit: async () => respuesta,
      };
      return cadena;
    },
  };
  return doble;
}

describe("permisoEn: las cuatro salidas", () => {
  const USUARIO = "11111111-1111-4111-8111-111111111111";
  const ORG = "22222222-2222-4222-8222-222222222222";
  const pedir = (doble: ReturnType<typeof cliente>, accion: "escribir" | "aprobar" | "integrar") =>
    permisoEn(doble as never, USUARIO, ORG, accion);

  it("pregunta en org_members, por ese usuario y esa organización", async () => {
    const doble = cliente({ data: [{ role: "owner", state: "active" }], error: null });
    await pedir(doble, "aprobar");
    expect(doble.tabla).toBe("org_members");
    expect(doble.filtros).toEqual({ user_id: USUARIO, organization_id: ORG });
  });

  it("rol que alcanza: ok, con el rol", async () => {
    const r = await pedir(cliente({ data: [{ role: "manager", state: "active" }], error: null }), "aprobar");
    expect(r).toEqual({ ok: true, rol: "manager" });
  });

  it("rol que no alcanza: rol-insuficiente", async () => {
    const r = await pedir(cliente({ data: [{ role: "editor", state: "active" }], error: null }), "aprobar");
    expect(r).toEqual({ ok: false, motivo: "rol-insuficiente" });
  });

  it("sin fila, o con la fila archivada: sin-membresia", async () => {
    expect(await pedir(cliente({ data: [], error: null }), "escribir")).toEqual({
      ok: false,
      motivo: "sin-membresia",
    });
    expect(
      await pedir(cliente({ data: [{ role: "owner", state: "archived" }], error: null }), "escribir")
    ).toEqual({ ok: false, motivo: "sin-membresia" });
  });

  it("un error de lectura es ilegible aunque traiga filas: una caída no es un permiso", async () => {
    const r = await pedir(
      cliente({ data: [{ role: "owner", state: "active" }], error: { message: "a medias" } }),
      "escribir"
    );
    expect(r).toEqual({ ok: false, motivo: "ilegible" });
  });
});
