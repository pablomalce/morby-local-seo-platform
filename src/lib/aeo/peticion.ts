import type { AgenteIA } from "./lectura";
import { AGENTES_IA } from "./lectura";
import { PLAZO_POR_PEDIDO_DE_LA_RUTA_MS, traerExaminado, type RedExaminada } from "./red";

/**
 * La petición REAL con el user-agent del rastreador, y el código que volvió.
 *
 * `accesoDeLasIA` lee `robots.txt` y dice lo que el sitio DECLARA. Esto mide lo
 * que el sitio HACE: un CDN o un WAF puede contestar 403 a GPTBot con un
 * `robots.txt` que lo permite, y al revés. La puerta H2-GO-1 nombra el riesgo
 * con todas las letras: *si el chequeo de rastreador se resuelve leyendo
 * robots.txt sin hacer la petición con ese user-agent, la página bloqueada sale
 * verde*. Y también por qué no alcanza una lista escrita a mano: agregar un
 * nombre al array pasaría la puerta sin probar nada. Acá no hay lista que
 * pasar: hay un código HTTP por agente, registrado.
 *
 * `null` es «no contestó» —timeout, DNS, red— y se distingue de un 5xx porque
 * un sitio caído para todos no es un sitio que bloquea a las IA. También es
 * `null` el agente al que el sitio REDIRIGE a una dirección que no es pública:
 * cada salto pasa por el examen de `red.ts`, y el pedido no sale. Que ese
 * agente quede sin código, y no con el de la dirección interna, es lo que
 * impide que este número sea un escáner de puertos.
 */
export const USER_AGENTS: Record<AgenteIA, string> = {
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  claudebot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  perplexitybot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "google-extended": "Mozilla/5.0 (compatible; Google-Extended)",
  ccbot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
};

export type StatusPorAgente = Record<AgenteIA, number | null>;

export async function statusPorAgente(
  url: string,
  red: RedExaminada,
  timeoutMs = PLAZO_POR_PEDIDO_DE_LA_RUTA_MS
): Promise<StatusPorAgente> {
  const salida = {} as StatusPorAgente;
  await Promise.all(
    AGENTES_IA.map(async (agente) => {
      const traida = await traerExaminado(red, url, {
        userAgent: USER_AGENTS[agente],
        timeoutMs,
        maxBytes: 0,
        sinCuerpo: true,
      });
      salida[agente] = traida.ok ? traida.status : null;
    })
  );
  return salida;
}

/** Códigos con los que un sitio le dice a un rastreador «vos no». */
export function bloqueadoPorHttp(status: number | null): boolean {
  return status === 401 || status === 403 || status === 429 || status === 451;
}
