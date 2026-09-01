/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que una manera de no tener token se muestre como otra, que es lo que hace que
 * alguien rehaga un OAuth ya hecho, o que espere un reintento que nunca va a
 * servir.
 *
 * Las ramas de error son el objeto de este archivo y no un agregado: el camino
 * feliz lo prueba cualquiera y se rompe ruidosamente. Lo que se escribe una vez y
 * no se vuelve a mirar es qué pasa cuando el secreto no parsea, cuando Google
 * contesta 400, o cuando la escritura del refresco falla — y las tres tienen
 * respuestas distintas.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgencyTokenState } from "../agency";
import type { ExchangeResult } from "../oauth";
import { type TokenDeps, resolveAccessToken } from "../tokenStore";

const ORG = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";
const AHORA = new Date("2026-09-01T12:00:00.000Z");

const CONFIG = {
  ok: true as const,
  config: {
    clientId: "no-es-real.apps.googleusercontent.com",
    clientSecret: "no-es-un-secreto-real",
    redirectUri: "https://ejemplo.test/api/auth/google/callback",
  },
};

const REFRESCO_OK: ExchangeResult = {
  ok: true,
  token: { refreshToken: "rt", accessToken: "at-nuevo" },
  expiresAt: new Date("2026-09-01T13:00:00.000Z"),
};

function deps(over: Partial<TokenDeps> = {}): TokenDeps {
  return {
    agency: { ok: true, organizationId: ORG },
    config: CONFIG,
    ahora: AHORA,
    readState: async (): Promise<AgencyTokenState> => "active",
    readSecret: async () => JSON.stringify({ refresh_token: "rt", access_token: "at-guardado" }),
    writeRefreshed: async () => true,
    refresh: async () => REFRESCO_OK,
    ...over,
  };
}

describe("cuando ni siquiera se puede preguntar", () => {
  it("la agencia sin resolver no es «no hay token»", async () => {
    const r = await resolveAccessToken(deps({ agency: { ok: false, reason: "malformed" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("agency-unresolved");
  });

  it("y se contesta ANTES de tocar la base", async () => {
    const readState = vi.fn(async (): Promise<AgencyTokenState> => "active");
    await resolveAccessToken(deps({ agency: { ok: false, reason: "unset" }, readState }));
    expect(readState).not.toHaveBeenCalled();
  });

  it("sin credenciales de plataforma no hay con qué refrescar nada", async () => {
    const r = await resolveAccessToken(
      deps({ config: { ok: false, missing: ["GOOGLE_CLIENT_SECRET"] } })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("platform-not-configured");
      expect(r.detail).toContain("GOOGLE_CLIENT_SECRET");
    }
  });
});

describe("los estados que la pantalla ya distingue", () => {
  it("sin token, el motivo manda a hacer el OAuth", async () => {
    const r = await resolveAccessToken(deps({ readState: async () => "absent" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("absent");
  });

  it("revocado manda a rehacerlo, y NO a refrescar", async () => {
    const refresh = vi.fn(async () => REFRESCO_OK);
    const r = await resolveAccessToken(deps({ readState: async () => "revoked", refresh }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revoked");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("un estado que no se pudo leer NO se lee como «sin conectar»", async () => {
    const r = await resolveAccessToken(deps({ readState: async () => "unreadable" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unreadable");
  });
});

describe("con un token vivo", () => {
  it("devuelve el access token guardado sin llamar a Google", async () => {
    const refresh = vi.fn(async () => REFRESCO_OK);
    const r = await resolveAccessToken(deps({ refresh }));
    expect(r).toEqual({ ok: true, accessToken: "at-guardado" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("un secreto que no parsea es `unreadable` y no `absent`", async () => {
    const r = await resolveAccessToken(deps({ readSecret: async () => "{roto" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unreadable");
  });

  it("y un fallo al leerlo tampoco es «no hay token»", async () => {
    const r = await resolveAccessToken(deps({ readSecret: async () => null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unreadable");
  });
});

describe("cuando el access token venció", () => {
  it("refresca con el refresh token guardado y devuelve el nuevo", async () => {
    const refresh = vi.fn(async () => REFRESCO_OK);
    const r = await resolveAccessToken(deps({ readState: async () => "expired", refresh }));

    expect(r).toEqual({ ok: true, accessToken: "at-nuevo" });
    expect(refresh).toHaveBeenCalledWith(CONFIG.config, "rt", AHORA);
  });

  it("guarda lo refrescado sobre la conexión viva, y no acuña otra", async () => {
    const writeRefreshed = vi.fn(async () => true);
    await resolveAccessToken(deps({ readState: async () => "expired", writeRefreshed }));

    expect(writeRefreshed).toHaveBeenCalledTimes(1);
    const [org, secreto, vence] = writeRefreshed.mock.calls[0] as unknown as [string, string, Date];
    expect(org).toBe(ORG);
    expect(JSON.parse(secreto)).toEqual({ refresh_token: "rt", access_token: "at-nuevo" });
    expect(vence.toISOString()).toBe("2026-09-01T13:00:00.000Z");
  });

  it("si la escritura falla, el access token igual se devuelve: ya sirve", async () => {
    const r = await resolveAccessToken(
      deps({ readState: async () => "expired", writeRefreshed: async () => false })
    );
    expect(r).toEqual({ ok: true, accessToken: "at-nuevo" });
  });

  it("un rechazo de Google manda a reconectar", async () => {
    const r = await resolveAccessToken(
      deps({
        readState: async () => "expired",
        refresh: async () => ({ ok: false, reason: "http", detail: "Google contestó 400" }),
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refresh-rejected");
  });

  it("una caída de red NO manda a reconectar: eso se reintenta", async () => {
    const r = await resolveAccessToken(
      deps({
        readState: async () => "expired",
        refresh: async () => ({ ok: false, reason: "network", detail: "ECONNRESET" }),
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unreadable");
  });
});

describe("el caso que se pierde solo", () => {
  /**
   * Una fila `active` cuyo secreto guarda el access token vacío. Pasa después de
   * un refresco cuya escritura funcionó y cuyo cuerpo vino sin access token, y el
   * síntoma sería mandarle a Google una cabecera `Bearer ` vacía: un 401 que se
   * lee como token revocado y manda a reconectar una conexión que está bien.
   */
  it("un access token vacío se contesta como ilegible y no se manda", async () => {
    const refresh = vi.fn(async () => REFRESCO_OK);
    const r = await resolveAccessToken(
      deps({
        readSecret: async () => JSON.stringify({ refresh_token: "rt", access_token: "" }),
        refresh,
      })
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unreadable");
    expect(refresh).not.toHaveBeenCalled();
  });
});
