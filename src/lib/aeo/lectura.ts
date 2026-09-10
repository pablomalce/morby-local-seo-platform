/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que no sepamos si el sitio de un cliente deja entrar a las inteligencias
 * artificiales.
 *
 * Es la mitad más barata del posicionamiento en motores de respuesta y la que
 * más rompe: el fallo más común es **bloquear a los rastreadores de IA** en el
 * `robots.txt` o en el CDN, y el segundo es que el contenido necesite JavaScript
 * para existir — los rastreadores no lo ejecutan, así que la página les llega
 * vacía.
 *
 * Los dos son binarios y se miden con una petición HTTP. Por eso van primero, y
 * no la cuota de voz en IA, que es lo que más suena y lo que más cuesta.
 *
 * ES PURO A PROPÓSITO
 *
 * Recibe texto y devuelve hechos. Quien hace las peticiones es la ruta; acá se
 * puede probar cada regla contra un `robots.txt` escrito a mano, que es la única
 * manera de saber que la interpretación es la correcta y no la que nos conviene.
 */

/**
 * Los agentes que importan hoy. Se guardan en minúscula porque el nombre del
 * agente en `robots.txt` es insensible a mayúsculas, y así se comparan.
 */
export const AGENTES_IA = [
  "gptbot",
  "claudebot",
  "perplexitybot",
  "google-extended",
  "ccbot",
] as const;

export type AgenteIA = (typeof AGENTES_IA)[number];

/** Una regla de `robots.txt`, ya normalizada. */
interface Grupo {
  agentes: string[];
  permite: string[];
  bloquea: string[];
}

/**
 * Parte un `robots.txt` en grupos.
 *
 * Un grupo son varios `User-agent` seguidos y las reglas que los siguen. Es la
 * forma que el estándar define, y la que hace que `User-agent: *` seguido de
 * `User-agent: GPTBot` compartan las mismas reglas — un detalle que, leído mal,
 * hace decir «bloqueado» sobre un sitio abierto.
 */
function parsear(robots: string): Grupo[] {
  const grupos: Grupo[] = [];
  let actual: Grupo | null = null;
  let ultimaFueAgente = false;

  for (const cruda of robots.split("\n")) {
    const linea = cruda.split("#")[0].trim();
    if (!linea) continue;

    const corte = linea.indexOf(":");
    if (corte < 0) continue;

    const campo = linea.slice(0, corte).trim().toLowerCase();
    const valor = linea.slice(corte + 1).trim();

    if (campo === "user-agent") {
      if (!actual || !ultimaFueAgente) {
        actual = { agentes: [], permite: [], bloquea: [] };
        grupos.push(actual);
      }
      actual.agentes.push(valor.toLowerCase());
      ultimaFueAgente = true;
      continue;
    }

    if (!actual) continue;
    ultimaFueAgente = false;

    if (campo === "disallow") actual.bloquea.push(valor);
    if (campo === "allow") actual.permite.push(valor);
  }

  return grupos;
}

/**
 * Si una ruta cae bajo un patrón de `robots.txt`.
 *
 * Un `Disallow:` VACÍO no bloquea nada — es la manera estándar de decir «pasá»,
 * y tratarlo como prefijo vacío bloquearía el sitio entero. Es el error que hace
 * que una herramienta informe «bloqueado» sobre un sitio abierto.
 */
function aplica(patron: string, ruta: string): boolean {
  if (patron === "") return false;
  return ruta.startsWith(patron);
}

/**
 * Si un agente puede entrar a una ruta.
 *
 * Gana el grupo MÁS ESPECÍFICO: si el agente está nombrado, sus reglas mandan y
 * las de `*` no se miran. Es lo que dice el estándar, y lo contrario haría que un
 * `Disallow: /` general se leyera como bloqueo aunque el sitio permita al agente
 * explícitamente.
 *
 * Y a igualdad, gana `Allow` sobre `Disallow`, que es cómo se abre una excepción.
 */
export function agentePuede(robots: string, agente: string, ruta = "/"): boolean {
  const grupos = parsear(robots);
  const nombre = agente.toLowerCase();

  const propio = grupos.filter((g) => g.agentes.includes(nombre));
  const aplicables = propio.length > 0 ? propio : grupos.filter((g) => g.agentes.includes("*"));

  // Sin reglas para nadie, `robots.txt` permite. La ausencia de una prohibición
  // NO es una prohibición.
  if (aplicables.length === 0) return true;

  const permite = aplicables.some((g) => g.permite.some((p) => aplica(p, ruta)));
  if (permite) return true;

  return !aplicables.some((g) => g.bloquea.some((p) => aplica(p, ruta)));
}

/** Qué agentes de IA pueden entrar, uno por uno. */
export function accesoDeLasIA(robots: string, ruta = "/"): Record<AgenteIA, boolean> {
  const salida = {} as Record<AgenteIA, boolean>;
  for (const agente of AGENTES_IA) salida[agente] = agentePuede(robots, agente, ruta);
  return salida;
}

/**
 * Los tipos de schema.org declarados en el HTML.
 *
 * Se leen los `application/ld+json`, que es lo que los motores usan como FUENTE
 * —no como pista de formato— y por eso es lo que decide si un dato se puede citar
 * o hay que inferirlo. Se aplana `@graph`, que es donde vive la mitad de los
 * sitios reales.
 */
export function tiposDeSchema(html: string): string[] {
  const tipos = new Set<string>();
  const bloques = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const bloque of bloques) {
    let datos: unknown;
    try {
      datos = JSON.parse(bloque[1].trim());
    } catch {
      // Un JSON-LD roto no es un tipo ausente ni uno presente: el motor tampoco
      // lo va a poder leer. Se ignora, y la ausencia habla sola.
      continue;
    }
    recolectar(datos, tipos);
  }

  return [...tipos].sort();
}

function recolectar(nodo: unknown, tipos: Set<string>): void {
  if (Array.isArray(nodo)) {
    for (const hijo of nodo) recolectar(hijo, tipos);
    return;
  }
  if (!nodo || typeof nodo !== "object") return;

  const objeto = nodo as Record<string, unknown>;
  const tipo = objeto["@type"];
  if (typeof tipo === "string") tipos.add(tipo);
  if (Array.isArray(tipo)) for (const t of tipo) if (typeof t === "string") tipos.add(t);

  if (Array.isArray(objeto["@graph"])) recolectar(objeto["@graph"], tipos);
}

/**
 * Cuánto texto real trae el HTML sin ejecutar JavaScript.
 *
 * No devuelve un booleano porque la pregunta no lo es: una página con un
 * encabezado y nada más está técnicamente renderizada y para un motor está
 * vacía. Se devuelve el número, y quien lo muestra decide con el umbral escrito
 * en un solo lugar.
 */
export function textoSinJavaScript(html: string): number {
  const limpio = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return limpio.length;
}

/**
 * El umbral por debajo del cual un motor no tiene qué leer.
 *
 * Está escrito a mano y en un solo lugar a propósito: es un juicio, no una
 * medición, y conviene que se pueda discutir en una línea en vez de estar
 * repartido por la pantalla.
 */
export const MINIMO_DE_TEXTO = 500;
