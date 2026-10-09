/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que conectar Google —reemplazar el token con el que se sirven TODOS los
 * clientes— lo arranque cualquier miembro de la agencia.
 *
 * Hasta la puerta H4.1 esta ruta no tenía test propio: el barrido
 * (`precondicionRutas.test.ts`) la mide sin sesión, y `agencyGuard.ts` decidía
 * sólo por membresía. Lo que se afirma acá es lo que cambia con el rol (D4):
 * owner o admin de la agencia arrancan el consentimiento; cualquier otro rol
 * recibe 403 SIN que se siembre la cookie del `state` ni se redirija a Google.
 *
 * La corrección del crítico, aplicada: las negativas son DENTRO de la agencia,
 * donde el admin sí puede. Un 404 por no ser de la agencia mide la
 * organización, no el rol, y ése es otro caso (el último).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCIA = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";

/** Lo que se le pidió a la cookie del `state`. Un 403 no puede sembrarla. */
let cookiesSembradas: string[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    delete: () => {},
    set: (nombre: string) => {
      cookiesSembradas.push(nombre);
    },
  }),
}));

let usuario: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };
/** La membresía en la agencia, leída como el usuario. */
let membresias: { role: string; state: string }[] = [];
let filtrosDeMembresia: Record<string, string> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: () => ({
      select: () => {
        const cadena = {
          eq: (col: string, val: string) => {
            filtrosDeMembresia[col] = val;
            return cadena;
          },
          limit: async () => ({ data: membresias, error: null }),
        };
        return cadena;
      },
    }),
  }),
}));

const { GET } = await import("../route");

/** Toda salida a la red. Arrancar el consentimiento es un redirect, no un fetch. */
let salidas = 0;

const pedir = () => GET(new Request("https://ejemplo.test/api/auth/google/start"));

beforeEach(() => {
  usuario = { id: "11111111-1111-4111-8111-111111111111" };
  membresias = [{ role: "admin", state: "active" }];
  filtrosDeMembresia = {};
  cookiesSembradas = [];
  salidas = 0;
  process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
  process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "no-es-un-secreto-real";
  process.env.GOOGLE_REDIRECT_URI = "https://ejemplo.test/api/auth/google/callback";
  vi.stubGlobal("fetch", async () => {
    salidas += 1;
    throw new Error("arrancar el consentimiento no sale a la red");
  });
});

describe("GET /api/auth/google/start — quién conecta Google (H4.1, D4)", () => {
  for (const rol of ["client", "viewer", "editor", "manager"]) {
    it(`un ${rol} de la agencia recibe 403: ni cookie de state ni redirect a Google`, async () => {
      membresias = [{ role: rol, state: "active" }];

      const r = await pedir();

      expect(r.status).toBe(403);
      expect(r.headers.get("location")).toBeNull();
      expect(cookiesSembradas).toEqual([]);
      expect(salidas).toBe(0);
    });
  }

  for (const rol of ["admin", "owner"]) {
    it(`un ${rol} de la agencia arranca el consentimiento`, async () => {
      membresias = [{ role: rol, state: "active" }];

      const r = await pedir();

      expect(r.status).toBe(307);
      expect(r.headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
      expect(cookiesSembradas).toEqual(["vulkan_google_oauth_state"]);
      expect(salidas).toBe(0);
    });
  }

  it("el rol se pregunta en la organización de la AGENCIA y por quien tiene la sesión", async () => {
    await pedir();

    expect(filtrosDeMembresia).toEqual({
      user_id: "11111111-1111-4111-8111-111111111111",
      organization_id: AGENCIA,
    });
  });

  it("quien no es de la agencia sigue recibiendo 404, no 403: no se entera de que la ruta existe", async () => {
    membresias = [];

    const r = await pedir();

    expect(r.status).toBe(404);
    expect(cookiesSembradas).toEqual([]);
  });
});
