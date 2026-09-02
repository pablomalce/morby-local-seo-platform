/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un fallo de Google se pierda sin dejar dicho cuál fue.
 *
 * El reporte muestra `error`, y eso está bien: quien lo lee no puede hacer nada
 * distinto con un 403 que con un timeout. Quien OPERA la plataforma sí — y hasta
 * el 2026-09-01 no tenía dónde mirarlo. GA4 falló en el primer reporte real y no
 * quedó registro de si era permiso, identificador o red.
 *
 * Lo que se mide acá es que el motivo se anote y que NO se anote de más: un log
 * que aparece también cuando todo salió bien es ruido, y el ruido se ignora
 * exactamente igual que el silencio.
 *
 * El registrador se inyecta. Espiar `console.warn` mediría el espía y ataría el
 * test a que el mensaje salga por ahí, que es una decisión del llamador.
 */
import { describe, expect, it, vi } from "vitest";
import { describirFallo, hydrateGoogle } from "../hydrate";

const MAPEOS = [
  { provider: "search_console" as const, propertyRef: "sc-domain:ejemplo.test" },
  { provider: "ga4" as const, propertyRef: "properties/123456789" },
];

const ENV = {
  GOOGLE_CLIENT_ID: "no-es-real.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "no-es-un-secreto-real",
} as unknown as NodeJS.ProcessEnv;

const TOKEN = { ok: true as const, accessToken: "no-es-un-token-real" };

function deps(over: Record<string, unknown> = {}) {
  return {
    mappings: MAPEOS,
    token: TOKEN,
    env: ENV,
    fetchSearchConsole: async () => ({ outcome: { kind: "ok" as const }, totals: null }),
    fetchGa4: async () => ({ outcome: { kind: "ok" as const }, totals: null }),
    ...over,
  } as Parameters<typeof hydrateGoogle>[0];
}

describe("describirFallo", () => {
  it("dice el código HTTP entero, no una familia", () => {
    expect(describirFallo({ kind: "http", status: 403 }, "properties/1")).toBe(
      "http 403 sobre properties/1"
    );
    // 401 y 403 se arreglan en lugares distintos: uno es el token, el otro el
    // permiso sobre la property. Un mensaje que dijera «4xx» los perdería.
    expect(describirFallo({ kind: "http", status: 401 }, "properties/1")).toContain("401");
  });

  it("distingue las tres maneras de no tener respuesta", () => {
    expect(describirFallo({ kind: "timeout" }, "p")).toContain("tiempo");
    expect(describirFallo({ kind: "network" }, "p")).toContain("respuesta");
    expect(describirFallo({ kind: "malformed" }, "p")).toContain("2xx");
  });

  it("no dice nada cuando salió bien", () => {
    expect(describirFallo({ kind: "ok" }, "properties/1")).toBeNull();
  });

  it("nombra la property, que es el dato que suele estar mal", () => {
    expect(describirFallo({ kind: "http", status: 400 }, "sc-domain:ejemplo.test")).toContain(
      "sc-domain:ejemplo.test"
    );
  });
});

describe("hydrateGoogle y el registro", () => {
  it("anota el motivo de GA4 con su código y su property", async () => {
    const anotado: string[] = [];
    await hydrateGoogle(
      deps({
        fetchGa4: async () => ({ outcome: { kind: "http" as const, status: 403 }, totals: null }),
        log: (m: string) => anotado.push(m),
      })
    );

    expect(anotado).toHaveLength(1);
    expect(anotado[0]).toContain("ga4");
    expect(anotado[0]).toContain("403");
    expect(anotado[0]).toContain("properties/123456789");
  });

  it("anota el de Search Console por separado, no uno solo por reporte", async () => {
    const anotado: string[] = [];
    await hydrateGoogle(
      deps({
        fetchSearchConsole: async () => ({ outcome: { kind: "timeout" as const }, totals: null }),
        fetchGa4: async () => ({ outcome: { kind: "http" as const, status: 400 }, totals: null }),
        log: (m: string) => anotado.push(m),
      })
    );

    // Dos fuentes fallan por motivos distintos: un mensaje que las juntara
    // obligaría a leer el código para saber cuál es cuál.
    expect(anotado).toHaveLength(2);
    expect(anotado.some((m) => m.startsWith("[google] search_console"))).toBe(true);
    expect(anotado.some((m) => m.startsWith("[google] ga4"))).toBe(true);
  });

  it("no anota nada cuando las dos salen bien", async () => {
    const log = vi.fn();
    await hydrateGoogle(deps({ log }));
    expect(log).not.toHaveBeenCalled();
  });

  it("no anota el token en ninguna parte del mensaje", async () => {
    const anotado: string[] = [];
    await hydrateGoogle(
      deps({
        fetchGa4: async () => ({ outcome: { kind: "http" as const, status: 403 }, totals: null }),
        log: (m: string) => anotado.push(m),
      })
    );
    expect(anotado.join(" ")).not.toContain("no-es-un-token-real");
  });
});

/**
 * QUÉ IMPIDE ESTE BLOQUE
 *
 * Que el motivo siga viviendo sólo en un log que se borra.
 *
 * La #67 anotaba en el log del servidor. En el plan Hobby de Vercel eso dura
 * minutos: el 2026-09-02, con GA4 fallando, el panel contestó «There are no
 * request logs in this time range». La sonda va a la base y sobrevive.
 */
describe("la sonda que sobrevive al log", () => {
  const ORG = "df6743a9-6f98-400e-8efb-fdcc37b3cb45";

  it("guarda el código y la property cuando falla", async () => {
    const sondas: Record<string, unknown>[] = [];
    await hydrateGoogle(
      deps({
        organizationId: ORG,
        recordProbe: async (s: Record<string, unknown>) => {
          sondas.push(s);
        },
        fetchGa4: async () => ({ outcome: { kind: "http" as const, status: 403 }, totals: null }),
      })
    );

    const ga = sondas.find((s) => s.provider === "ga4");
    expect(ga).toMatchObject({
      organizationId: ORG,
      outcome: "http",
      httpStatus: 403,
      propertyRef: "properties/123456789",
    });
  });

  it("guarda también cuando salió bien, que es la mitad del diagnóstico", async () => {
    // «Anduvo hace un minuto» es lo que distingue «se rompió recién» de «nunca
    // anduvo». Una tabla que sólo tiene fallos no puede decir la diferencia.
    const sondas: Record<string, unknown>[] = [];
    await hydrateGoogle(
      deps({
        organizationId: ORG,
        recordProbe: async (s: Record<string, unknown>) => {
          sondas.push(s);
        },
      })
    );

    expect(sondas).toHaveLength(2);
    expect(sondas.every((s) => s.outcome === "ok")).toBe(true);
    expect(sondas.every((s) => s.httpStatus === null)).toBe(true);
  });

  it("sin organización no guarda nada: un reporte de demostración no tiene tenant", async () => {
    const sondas: unknown[] = [];
    await hydrateGoogle(
      deps({
        organizationId: null,
        recordProbe: async (s: unknown) => {
          sondas.push(s);
        },
        fetchGa4: async () => ({ outcome: { kind: "http" as const, status: 403 }, totals: null }),
      })
    );
    expect(sondas).toHaveLength(0);
  });

  it("si la escritura falla, el reporte sigue", async () => {
    // La sonda es telemetría. Un reporte que se cae porque no pudo anotar por qué
    // falló otra cosa convierte una molestia en una caída.
    const r = await hydrateGoogle(
      deps({
        organizationId: ORG,
        recordProbe: async () => {
          throw new Error("la base no contestó");
        },
      })
    );
    expect(r.searchConsole).toBe("live");
    expect(r.ga4).toBe("live");
  });
});
