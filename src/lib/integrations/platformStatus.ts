/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que una pantalla diga «sin conectar» catorce veces porque está escrita así.
 *
 * `/settings` tenía un arreglo de catorce nombres y una insignia fija al lado de
 * cada uno. Era la respuesta correcta hoy y por el motivo equivocado: correcta
 * porque de verdad no hay nada conectado, no porque alguien lo hubiera mirado. El
 * día que se conecte algo, el arreglo sigue ahí y la pantalla sigue diciendo lo
 * mismo — que es exactamente el defecto que el #55 sacó del orquestador y el #56
 * de la pantalla de integraciones. Éste es el tercer lugar.
 *
 * NO ALCANZA CON DOS ESTADOS, Y ÉSA ES LA PARTE QUE IMPORTA
 *
 * Una lista de «configurado / sin configurar» sería un arreglo peor que el
 * problema para tres de las catorce. Search Console, GA4 y Google Business
 * Profile NO quedan listas cuando la plataforma tiene credenciales: además hace
 * falta que ESTE cliente tenga su property mapeada, y eso se arregla en otro
 * lado y por cliente.
 *
 * Decir «configurado» ahí, con el OAuth puesto y el cliente sin mapear, mandaría
 * a un operador a buscar un problema donde no está — la misma confusión que la
 * pantalla de integraciones existe para deshacer. Por eso hay un tercer estado y
 * por eso apunta a dónde se termina.
 *
 * NO SE IMPRIME NINGÚN VALOR
 *
 * Se mira si la variable está y si no está vacía. Nada de esto devuelve, registra
 * ni compara contenidos: un secreto que llega a una pantalla de ajustes es un
 * secreto en el historial del navegador de quien la abrió.
 */

/** Qué hace falta para que una integración esté lista, y dónde se termina. */
export interface PlatformIntegration {
  /** El nombre que se muestra. */
  name: string;
  /**
   * Las variables que necesita. TODAS: media credencial no completa ningún
   * intercambio, y decir «configurado» con media manda a investigar un fallo a
   * quien tenía que terminar una configuración.
   */
  needs: readonly string[];
  /**
   * Si además hace falta mapear cada cliente. Cuando es `true` y la plataforma
   * está configurada, el estado NO es «listo»: es «falta por cliente».
   */
  perClient?: boolean;
}

/**
 * Las catorce, con lo que cada una necesita.
 *
 * Las que no tienen variable declarada en `.env.example` llevan `needs: []` a
 * propósito, y eso las deja SIEMPRE en «sin configurar»: no hay nada que mirar
 * porque la integración no existe todavía. Es la verdad, y se distingue de las
 * que sí tienen una variable que resulta estar vacía.
 */
export const PLATFORM_INTEGRATIONS: readonly PlatformIntegration[] = [
  { name: "OpenAI API", needs: ["OPENAI_API_KEY"] },
  { name: "OpenAI Image Generation", needs: ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL"] },
  { name: "Google Places API", needs: ["GOOGLE_PLACES_API_KEY"] },
  { name: "Google PageSpeed Insights", needs: ["GOOGLE_PAGESPEED_API_KEY"] },
  {
    name: "Google Business Profile",
    needs: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    perClient: true,
  },
  {
    name: "Google Search Console",
    needs: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    perClient: true,
  },
  {
    name: "Google Analytics GA4",
    needs: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    perClient: true,
  },
  { name: "Anthropic API", needs: ["ANTHROPIC_API_KEY"] },
  { name: "Google Gemini", needs: ["GOOGLE_GEMINI_API_KEY"] },
  { name: "Resend", needs: ["RESEND_API_KEY"] },
  { name: "Sentry", needs: ["SENTRY_DSN"] },
  { name: "PostHog", needs: ["POSTHOG_KEY"] },
  { name: "Lead Engine webhook", needs: ["GROWTH_OS_WEBHOOK_SECRET"] },
  // Sin variable todavía: no hay integración que mirar, y decirlo así es más
  // honesto que inventarle una variable para que la pantalla se vea completa.
  { name: "LinkedIn", needs: [] },
  { name: "Meta (Facebook & Instagram)", needs: [] },
  { name: "X / Twitter", needs: [] },
  { name: "Buffer / Metricool", needs: [] },
  { name: "Stripe", needs: [] },
];

export type PlatformState =
  /** Tiene todo lo que necesita y no depende de nadie más. */
  | "ready"
  /** La plataforma está, y falta mapear cada cliente. Se termina en /app/integrations. */
  | "per-client"
  /** Le falta al menos una variable, o no tiene ninguna declarada. */
  | "not-configured";

export interface PlatformIntegrationStatus {
  name: string;
  state: PlatformState;
  /** Cuántas de las que necesita están puestas, y cuántas necesita. Nunca los valores. */
  present: number;
  required: number;
}

/**
 * El estado de las catorce, medido.
 *
 * `env` entra como parámetro para que esto se pueda probar sin tocar el proceso,
 * que es lo mismo que hace `platformIsConnected()` en `sources.ts` y por el mismo
 * motivo.
 */
export function platformStatus(env: NodeJS.ProcessEnv = process.env): PlatformIntegrationStatus[] {
  return PLATFORM_INTEGRATIONS.map((i) => {
    // Vacío NO cuenta como puesta. Una variable declarada en blanco es la forma
    // más común de «me olvidé de completarla», y contarla haría que la pantalla
    // dijera «listo» sobre una integración que va a fallar en la primera llamada.
    const present = i.needs.filter((k) => {
      const v = env[k];
      return typeof v === "string" && v.trim() !== "";
    }).length;

    const completa = i.needs.length > 0 && present === i.needs.length;
    const state: PlatformState = !completa
      ? "not-configured"
      : i.perClient
        ? "per-client"
        : "ready";

    return { name: i.name, state, present, required: i.needs.length };
  });
}
