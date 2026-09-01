/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el flujo pida un consentimiento que devuelve un token inservible, y que la
 * respuesta de Google se lea de una manera que confunda «no hay» con «falló».
 *
 * Los literales se escriben ENTEROS y no se importan del módulo que prueban. Un
 * test que compara `url.searchParams.get("prompt")` contra la constante que el
 * módulo exporta pasa igual el día que esa constante cambie a cualquier cosa: lo
 * único que mide es que el módulo sea igual a sí mismo.
 */
import { describe, expect, it } from "vitest";
import {
  buildConsentUrl,
  exchangeCode,
  parseStoredToken,
  readCallback,
  readTokenBody,
  refreshAccessToken,
  resolveOAuthConfig,
  serializeToken,
} from "../oauth";

const CONFIG = {
  clientId: "no-es-real.apps.googleusercontent.com",
  clientSecret: "no-es-un-secreto-real",
  redirectUri: "https://ejemplo.test/api/auth/google/callback",
};

const AHORA = new Date("2026-09-01T12:00:00.000Z");

/** Un `fetch` que contesta lo que se le diga y anota lo que le pidieron. */
function fetchQueContesta(
  respuesta: { ok: boolean; status: number; json: () => Promise<unknown> },
  registro: { url?: string; body?: string } = {}
) {
  return async (url: string, init: RequestInit) => {
    registro.url = url;
    registro.body = String(init.body);
    return respuesta as unknown as Response;
  };
}

describe("resolveOAuthConfig", () => {
  it("nombra las tres que faltan, y no sólo la primera", () => {
    const r = resolveOAuthConfig({} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual([
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REDIRECT_URI",
      ]);
    }
  });

  it("una variable de puros espacios cuenta como ausente", () => {
    const r = resolveOAuthConfig({
      GOOGLE_CLIENT_ID: "algo",
      GOOGLE_CLIENT_SECRET: "   ",
      GOOGLE_REDIRECT_URI: "https://ejemplo.test/cb",
    } as unknown as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["GOOGLE_CLIENT_SECRET"]);
  });

  it("con las tres puestas devuelve la configuración recortada", () => {
    const r = resolveOAuthConfig({
      GOOGLE_CLIENT_ID: " algo ",
      GOOGLE_CLIENT_SECRET: "secreto",
      GOOGLE_REDIRECT_URI: "https://ejemplo.test/cb",
    } as unknown as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.clientId).toBe("algo");
  });
});

describe("buildConsentUrl", () => {
  const url = new URL(buildConsentUrl(CONFIG, "el-estado"));

  it("pide acceso offline, que es lo único que devuelve un refresh token", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("fuerza el consentimiento, así la SEGUNDA conexión también trae refresh token", () => {
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("pide sólo los dos permisos que este flujo usa", () => {
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly"
    );
  });

  it("no acumula permisos concedidos antes", () => {
    expect(url.searchParams.get("include_granted_scopes")).toBeNull();
  });

  it("manda el estado y el redirect que Google tiene registrado", () => {
    expect(url.searchParams.get("state")).toBe("el-estado");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://ejemplo.test/api/auth/google/callback"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("readCallback", () => {
  it("un rechazo se lee como rechazo y NO como vuelta incompleta", () => {
    const r = readCallback(new URLSearchParams("error=access_denied&state=x"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("denied");
  });

  it("el error gana aunque venga un código al lado", () => {
    const r = readCallback(new URLSearchParams("error=access_denied&code=abc&state=x"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("denied");
  });

  it("sin código no hay nada que canjear", () => {
    const r = readCallback(new URLSearchParams("state=x"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("incomplete");
  });

  it("sin estado tampoco, porque no habría con qué comparar", () => {
    const r = readCallback(new URLSearchParams("code=abc"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("incomplete");
  });

  it("con los dos, devuelve los dos", () => {
    const r = readCallback(new URLSearchParams("code=abc&state=xyz"));
    expect(r).toEqual({ ok: true, code: "abc", state: "xyz" });
  });
});

describe("readTokenBody", () => {
  it("calcula el vencimiento sumando expires_in al momento del canje", () => {
    const r = readTokenBody(
      { access_token: "at", refresh_token: "rt", expires_in: 3599 },
      AHORA
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expiresAt.toISOString()).toBe("2026-09-01T12:59:59.000Z");
  });

  it("sin refresh token, el motivo es propio y no «malformado»", () => {
    const r = readTokenBody({ access_token: "at", expires_in: 3599 }, AHORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-refresh-token");
  });

  it("en el REFRESCO, la ausencia de refresh token no es un fallo", () => {
    const r = readTokenBody({ access_token: "nuevo", expires_in: 60 }, AHORA, "el-de-antes");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.token.refreshToken).toBe("el-de-antes");
      expect(r.token.accessToken).toBe("nuevo");
    }
  });

  it("un expires_in que no es número es un cuerpo mal formado", () => {
    const r = readTokenBody(
      { access_token: "at", refresh_token: "rt", expires_in: "3599" },
      AHORA
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed");
  });

  it("un expires_in de cero también, porque no describe ninguna vida útil", () => {
    const r = readTokenBody(
      { access_token: "at", refresh_token: "rt", expires_in: 0 },
      AHORA
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed");
  });

  it("sin access token no hay nada que usar", () => {
    const r = readTokenBody({ refresh_token: "rt", expires_in: 60 }, AHORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed");
  });
});

describe("el secreto que viaja al Vault", () => {
  it("va y vuelve igual", () => {
    const token = { refreshToken: "rt", accessToken: "at" };
    expect(parseStoredToken(serializeToken(token))).toEqual(token);
  });

  it("se guarda con los nombres que Google usa, no con los de TypeScript", () => {
    expect(JSON.parse(serializeToken({ refreshToken: "rt", accessToken: "at" }))).toEqual({
      refresh_token: "rt",
      access_token: "at",
    });
  });

  it("lo que no parsea devuelve null, que NO es «no hay token»", () => {
    expect(parseStoredToken("{esto no es json")).toBeNull();
    expect(parseStoredToken("")).toBeNull();
    expect(parseStoredToken(null)).toBeNull();
  });

  it("un JSON sin refresh token no alcanza para llamar mañana", () => {
    expect(parseStoredToken('{"access_token":"at"}')).toBeNull();
  });

  it("un JSON con el refresh token vacío tampoco", () => {
    expect(parseStoredToken('{"refresh_token":"","access_token":"at"}')).toBeNull();
  });
});

describe("exchangeCode", () => {
  it("manda el código, el redirect y el grant que Google espera", async () => {
    const registro: { url?: string; body?: string } = {};
    await exchangeCode(
      CONFIG,
      "el-codigo",
      AHORA,
      fetchQueContesta(
        {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 60 }),
        },
        registro
      )
    );

    expect(registro.url).toBe("https://oauth2.googleapis.com/token");
    const cuerpo = new URLSearchParams(registro.body ?? "");
    expect(cuerpo.get("grant_type")).toBe("authorization_code");
    expect(cuerpo.get("code")).toBe("el-codigo");
    expect(cuerpo.get("redirect_uri")).toBe("https://ejemplo.test/api/auth/google/callback");
    expect(cuerpo.get("client_secret")).toBe("no-es-un-secreto-real");
  });

  it("un código que no es 2xx es `http` y lleva el número adentro", async () => {
    const r = await exchangeCode(
      CONFIG,
      "x",
      AHORA,
      fetchQueContesta({ ok: false, status: 400, json: async () => ({}) })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("http");
      expect(r.detail).toContain("400");
    }
  });

  it("un fetch que tira es `network` y no `http`: no hubo respuesta que leer", async () => {
    const r = await exchangeCode(CONFIG, "x", AHORA, async () => {
      throw new Error("ECONNRESET");
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("network");
  });

  it("un 200 con cuerpo que no es JSON es `malformed`", async () => {
    const r = await exchangeCode(
      CONFIG,
      "x",
      AHORA,
      fetchQueContesta({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token");
        },
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed");
  });
});

describe("refreshAccessToken", () => {
  it("canjea el refresh token y conserva el que ya se tenía", async () => {
    const registro: { url?: string; body?: string } = {};
    const r = await refreshAccessToken(
      CONFIG,
      "el-refresh",
      AHORA,
      fetchQueContesta(
        { ok: true, status: 200, json: async () => ({ access_token: "nuevo", expires_in: 3600 }) },
        registro
      )
    );

    const cuerpo = new URLSearchParams(registro.body ?? "");
    expect(cuerpo.get("grant_type")).toBe("refresh_token");
    expect(cuerpo.get("refresh_token")).toBe("el-refresh");

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.token.accessToken).toBe("nuevo");
      expect(r.token.refreshToken).toBe("el-refresh");
      expect(r.expiresAt.toISOString()).toBe("2026-09-01T13:00:00.000Z");
    }
  });

  it("un 400 sigue siendo `http`: es la forma que tiene un invalid_grant", async () => {
    const r = await refreshAccessToken(
      CONFIG,
      "el-refresh",
      AHORA,
      fetchQueContesta({ ok: false, status: 400, json: async () => ({}) })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("http");
  });
});
