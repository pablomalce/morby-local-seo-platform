/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el alta de un negocio le muestre a un `viewer` o a un `client` el error
 * crudo de la RLS.
 *
 * Desde la 0031 (H4.1, D3) la base le niega a esos roles el INSERT en
 * `businesses` con 42501. El onboarding (`/onboarding/new-business`) escribe con
 * el cliente de NAVEGADOR en la organización activa, y mostraba el mensaje de
 * Postgres tal cual (crítico del 2026-10-08). Lo que se mide: el 42501 se dice
 * como negativa de rol, no se sigue con las ubicaciones ni los servicios, y
 * cualquier OTRO error conserva su mensaje — convertir todo fallo en «tu rol no
 * alcanza» mandaría a pedir un permiso a quien tiene otro problema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let errorDelInsert: { code?: string; message: string } | null = null;
let tablasEscritas: string[] = [];

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    from: (tabla: string) => ({
      insert: () => {
        tablasEscritas.push(tabla);
        const fila = { id: "b-1" };
        return {
          select: () => ({
            single: async () => (errorDelInsert ? { data: null, error: errorDelInsert } : { data: fila, error: null }),
          }),
          then: (r: (v: unknown) => unknown) => r({ data: null, error: null }),
        };
      },
    }),
  }),
}));

const { createTenantInDb, SIN_ROL_PARA_CREAR_NEGOCIO } = await import("../supabaseTenantStore");

const ALTA = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  business: {
    name: "Negocio",
    website: "https://ejemplo.test/",
    industry: "salud",
    brandTone: "",
    primaryLocale: "es" as const,
    valueProposition: "",
    logoColor: "#EF4C24",
  },
  firstLocation: {
    label: "Local",
    addressLine: "",
    city: "",
    region: "",
    country: "se",
    primaryGeoQuery: "",
  },
};

beforeEach(() => {
  errorDelInsert = null;
  tablasEscritas = [];
});

describe("el alta de un negocio, según lo que contesta la base", () => {
  it("un 42501 se dice como negativa de rol, y no sigue con la ubicación", async () => {
    errorDelInsert = {
      code: "42501",
      message: 'new row violates row-level security policy "businesses_role_insert" for table "businesses"',
    };

    await expect(createTenantInDb(ALTA as never)).rejects.toThrow(SIN_ROL_PARA_CREAR_NEGOCIO);
    expect(SIN_ROL_PARA_CREAR_NEGOCIO).toMatch(/owner, admin, manager o editor/);
    expect(SIN_ROL_PARA_CREAR_NEGOCIO).not.toMatch(/row-level security/);
    expect(tablasEscritas).toEqual(["businesses"]);
  });

  it("cualquier otro error conserva su mensaje: no todo es un rol", async () => {
    errorDelInsert = { code: "23505", message: "duplicate key value violates unique constraint" };

    await expect(createTenantInDb(ALTA as never)).rejects.toThrow("duplicate key value");
  });

  it("la contraprueba: sin error, el alta sigue con la ubicación", async () => {
    await expect(createTenantInDb(ALTA as never)).resolves.toEqual({ businessId: "b-1" });
    expect(tablasEscritas).toEqual(["businesses", "business_locations"]);
  });
});
