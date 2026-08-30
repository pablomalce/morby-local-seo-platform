/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la lista de integraciones vuelva a ser una constante.
 *
 * Y sobre todo: que las tres superficies de Google digan «configurado» con el
 * OAuth puesto y el cliente sin mapear. Ésa es la mitad que un «configurado /
 * sin configurar» de dos estados no puede decir, y decirla mal manda a un
 * operador a buscar un problema donde no está.
 */
import { describe, expect, it } from "vitest";
import {
  PLATFORM_INTEGRATIONS,
  platformStatus,
} from "@/lib/integrations/platformStatus";

const VACIO = {} as unknown as NodeJS.ProcessEnv;
const de = (nombre: string, env: NodeJS.ProcessEnv) =>
  platformStatus(env).find((s) => s.name === nombre)!;

describe("el estado sale del entorno, no de un arreglo", () => {
  it("sin ninguna variable, ninguna está lista", () => {
    // Es el estado real de hoy. Que coincida con lo que la pantalla vieja decía
    // es exactamente por qué el defecto era invisible.
    expect(platformStatus(VACIO).every((s) => s.state === "not-configured")).toBe(true);
  });

  it("una integración de una sola variable se pone en `ready` cuando aparece", () => {
    const env = { OPENAI_API_KEY: "no-es-una-clave-real" } as unknown as NodeJS.ProcessEnv;
    expect(de("OpenAI API", env).state).toBe("ready");
    // Y sólo ésa: la de al lado necesita dos.
    expect(de("OpenAI Image Generation", env).state).toBe("not-configured");
  });
});

describe("las tres superficies de Google NO quedan listas con el OAuth", () => {
  const CONECTADA = {
    GOOGLE_CLIENT_ID: "no-es-un-client-id-real.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "no-es-un-secreto-real",
  } as unknown as NodeJS.ProcessEnv;

  it("pasan a `per-client`, que no es `ready`", () => {
    for (const n of ["Google Search Console", "Google Analytics GA4", "Google Business Profile"]) {
      expect(de(n, CONECTADA).state, n).toBe("per-client");
    }
  });

  it("y `per-client` es un estado distinto de los otros dos", () => {
    // Si esto colapsara a `ready`, la pantalla diría «configurado» sobre un
    // cliente sin mapear — la confusión que la pantalla de integraciones existe
    // para deshacer.
    const estados = new Set(platformStatus(CONECTADA).map((s) => s.state));
    expect(estados.has("per-client")).toBe(true);
    expect(estados.has("ready")).toBe(false);
  });

  it("con media credencial vuelven a `not-configured`, y dicen 1 de 2", () => {
    // Media credencial no completa ningún intercambio OAuth, y decir
    // «configurado» con media manda a investigar un fallo a quien tenía que
    // terminar una configuración.
    const media = { GOOGLE_CLIENT_ID: "algo" } as unknown as NodeJS.ProcessEnv;
    const s = de("Google Search Console", media);
    expect(s.state).toBe("not-configured");
    expect([s.present, s.required]).toEqual([1, 2]);
  });
});

describe("qué cuenta como puesta", () => {
  it("una cadena vacía NO cuenta", () => {
    expect(de("Resend", { RESEND_API_KEY: "" } as unknown as NodeJS.ProcessEnv).state).toBe(
      "not-configured"
    );
  });

  it("sólo espacios tampoco", () => {
    // Es la forma más común de «me olvidé de completarla», y contarla haría que
    // la pantalla dijera «listo» sobre algo que falla en la primera llamada.
    expect(de("Resend", { RESEND_API_KEY: "   " } as unknown as NodeJS.ProcessEnv).state).toBe(
      "not-configured"
    );
  });

  it("un valor con espacios alrededor sí cuenta", () => {
    expect(de("Resend", { RESEND_API_KEY: " re_algo " } as unknown as NodeJS.ProcessEnv).state).toBe(
      "ready"
    );
  });
});

describe("las que todavía no existen", () => {
  it("sin variable declarada quedan siempre en `not-configured`", () => {
    // No hay nada que mirar porque la integración no existe. Inventarle una
    // variable para que la pantalla se vea completa sería mentir de nuevo, en
    // otra dirección.
    const todo = {
      OPENAI_API_KEY: "x",
      OPENAI_IMAGE_MODEL: "x",
      GOOGLE_PLACES_API_KEY: "x",
      GOOGLE_PAGESPEED_API_KEY: "x",
      GOOGLE_CLIENT_ID: "x",
      GOOGLE_CLIENT_SECRET: "x",
      ANTHROPIC_API_KEY: "x",
      GOOGLE_GEMINI_API_KEY: "x",
      RESEND_API_KEY: "x",
      SENTRY_DSN: "x",
      POSTHOG_KEY: "x",
      GROWTH_OS_WEBHOOK_SECRET: "x",
    } as unknown as NodeJS.ProcessEnv;
    for (const n of ["LinkedIn", "Stripe", "X / Twitter"]) {
      expect(de(n, todo).state, n).toBe("not-configured");
      expect(de(n, todo).required, n).toBe(0);
    }
  });
});

describe("no se filtra ningún valor", () => {
  it("el resultado sólo trae nombre, estado y conteos", () => {
    // Un secreto que llega a una pantalla de ajustes es un secreto en el
    // historial del navegador de quien la abrió.
    const env = { RESEND_API_KEY: "re_un_secreto_muy_reconocible" } as unknown as NodeJS.ProcessEnv;
    const serializado = JSON.stringify(platformStatus(env));
    expect(serializado).not.toContain("re_un_secreto_muy_reconocible");
    expect(Object.keys(platformStatus(env)[0]).sort()).toEqual([
      "name",
      "present",
      "required",
      "state",
    ]);
  });
});

describe("la lista", () => {
  it("el webhook del Lead Engine está, y depende de su secreto", () => {
    // Sin él el endpoint de la ingesta contesta 401 a todo, y esta pantalla es
    // donde alguien se va a dar cuenta.
    const i = PLATFORM_INTEGRATIONS.find((x) => x.name === "Lead Engine webhook")!;
    expect(i.needs).toEqual(["GROWTH_OS_WEBHOOK_SECRET"]);
  });

  it("exactamente tres son por cliente, y son las tres de Google", () => {
    const porCliente = PLATFORM_INTEGRATIONS.filter((i) => i.perClient).map((i) => i.name);
    expect(porCliente.sort()).toEqual([
      "Google Analytics GA4",
      "Google Business Profile",
      "Google Search Console",
    ]);
  });
});
