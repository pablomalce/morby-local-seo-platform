import { AGENTES_IA, MINIMO_DE_TEXTO, type AgenteIA } from "./lectura";
import type { ResultadoRenderizado } from "./renderizado";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría diga «bloqueado» y ahí se termine la conversación.
 *
 * Es la misma idea que `probeView.ts` aplica a los códigos de Google, y por el
 * mismo motivo: varios problemas distintos comparten la palabra «error» y se
 * arreglan en lugares distintos. Un bloqueo de rastreadores se arregla en el
 * `robots.txt` o en el CDN; un sitio sin texto sin JavaScript se arregla
 * renderizando en el servidor; un schema ausente se arregla en la plantilla.
 * Tres acciones, tres personas, tres archivos distintos.
 *
 * Y HAY UNA COSA QUE NO SE CUENTA COMO LOGRO
 *
 * `llms.txt`. Google lo comparó públicamente con la vieja etiqueta `meta
 * keywords`: no influye en las citas. Se informa porque es barato ponerlo, y se
 * marca como INFORMATIVO — mostrarlo como posicionamiento sería una métrica de
 * vanidad, que es el cero inventado de esta pantalla.
 */

export interface LecturaDelSitio {
  /**
   * Lo que `robots.txt` DECLARA por agente. `null` es «no se sabe»: el robots
   * no se pudo leer por un timeout, un 5xx o una red que no contestó. No es un
   * permiso —RFC 9309 dice que ante un 5xx el rastreador asume que NO puede
   * entrar a nada— ni una prohibición que se pueda afirmar: es no medido. Un
   * 4xx sí es una respuesta («no hay robots») y vale como permiso.
   */
  acceso: Record<AgenteIA, boolean | null>;
  /** Por qué el robots quedó sin medir, cuando `acceso` trae `null`. */
  robotsNoMedido?: string;
  /**
   * Lo que el sitio HACE por agente: el código HTTP de una petición real con
   * ese user-agent, o `null` si no contestó. Es la mitad que faltaba: un CDN
   * puede devolver 403 a GPTBot con un `robots.txt` que lo permite, y leer sólo
   * el robots dejaba esa página en verde. Opcional para que las lecturas viejas
   * sigan valiendo, y su AUSENCIA —como cada `null`— se lee «no medido», nunca
   * «entra»: es la misma regla que `caracteresRenderizados`.
   */
  statusPorAgente?: Record<AgenteIA, number | null>;
  /** Caracteres de texto del HTML SERVIDO, sin ejecutar JavaScript. */
  caracteresSinJs: number;
  /**
   * Caracteres de texto del DOM RENDERIZADO (`renderizado.ts`), o el motivo por
   * el que no se pudo medir. Opcional para que las lecturas viejas sigan
   * valiendo, y su AUSENCIA se lee como «no medido», igual que un fallo: nunca
   * como un cero ni como un verde. Ver `contenidoSinJs`.
   */
  caracteresRenderizados?: ResultadoRenderizado;
  schema: string[];
  /** Lo que el validador encontró mal en el JSON-LD. Vacío es «no hay errores». */
  erroresDeSchema?: string[];
  tieneLlmsTxt: boolean;
}

/** Códigos con los que un sitio le dice a un rastreador «vos no». */
function bloqueadoPorHttp(status: number | null | undefined): boolean {
  return status === 401 || status === 403 || status === 429 || status === 451;
}

/**
 * `no-medido` no es una gravedad del SITIO: es la auditoría diciendo que no
 * pudo contestar. Va en la misma lista para que la pantalla lo muestre en el
 * mismo lugar que los hallazgos, y con su propia etiqueta para que nadie lo lea
 * como un problema del sitio —ni, sobre todo, como la ausencia de uno—.
 */
export type Gravedad = "bloqueante" | "importante" | "informativo" | "no-medido";

export interface Hallazgo {
  gravedad: Gravedad;
  quePasa: string;
  queHacer: string;
  /** Dónde se arregla. No es decorativo: evita mandar a la persona equivocada. */
  donde: string;
}

/** Los tipos que más rinden, en orden. Ver `ANALISIS_GEO_AEO.md`. */
const SCHEMA_QUE_IMPORTA = ["Organization", "LocalBusiness", "FAQPage"] as const;

export function hallazgos(lectura: LecturaDelSitio): Hallazgo[] {
  const salida: Hallazgo[] = [];

  // Bloqueado es: lo prohíbe el robots, O el servidor le contestó «no» a la
  // petición real con su user-agent. La segunda condición es la que la puerta
  // H2-GO-1 exige, y la que ninguna lista escrita a mano puede satisfacer.
  const bloqueados = AGENTES_IA.filter(
    (a) => lectura.acceso[a] === false || bloqueadoPorHttp(lectura.statusPorAgente?.[a])
  );
  const bloqueadosSoloPorHttp = AGENTES_IA.filter(
    (a) => lectura.acceso[a] === true && bloqueadoPorHttp(lectura.statusPorAgente?.[a])
  );
  if (bloqueadosSoloPorHttp.length > 0) {
    salida.push({
      gravedad: "bloqueante",
      quePasa: `El robots.txt permite a ${bloqueadosSoloPorHttp.join(", ")}, pero el servidor les contesta ${bloqueadosSoloPorHttp.map((a) => lectura.statusPorAgente?.[a]).join("/")} cuando llegan con su user-agent.`,
      queHacer:
        "El bloqueo no está en el robots: está en el CDN, el WAF o una regla de bots del hosting. Es el caso que una auditoría que sólo lee robots.txt no ve nunca.",
      donde: "el panel del CDN o del WAF (reglas de bots), no el robots.txt",
    });
  }

  if (bloqueados.length === AGENTES_IA.length) {
    salida.push({
      gravedad: "bloqueante",
      quePasa: "Ningún rastreador de IA puede entrar al sitio.",
      queHacer:
        "Es el fallo más común y el más barato de arreglar. Nada de lo demás sirve mientras esto siga así: el contenido puede ser perfecto y ningún motor lo va a ver.",
      donde: "robots.txt, y la configuración del CDN si el robots ya está bien",
    });
  } else if (bloqueados.length > 0) {
    salida.push({
      gravedad: "bloqueante",
      quePasa: `Bloqueados: ${bloqueados.join(", ")}. Los demás sí entran.`,
      queHacer:
        "Bloquear a algunos y no a otros suele ser un descuido heredado de una plantilla, no una decisión. Si es deliberado, conviene que esté escrito.",
      donde: "robots.txt",
    });
  }

  // Lo que NO se midió, de los que no están ya bloqueados: un agente
  // bloqueado no necesita la otra mitad para saberse rojo. Antes, un `null`
  // —el servidor no contestó a ese user-agent— se leía como «entra», y un
  // robots que dio timeout como «permite a todos»: con los cinco pedidos
  // caídos y el robots sin leer, la ruta devolvía cero hallazgos y la
  // pantalla decía «los rastreadores entran» (P3).
  const sinHttp = AGENTES_IA.filter(
    (a) => !bloqueados.includes(a) && (lectura.statusPorAgente?.[a] ?? null) === null
  );
  if (sinHttp.length > 0) {
    salida.push({
      gravedad: "no-medido",
      quePasa:
        lectura.statusPorAgente === undefined
          ? "La lectura no trae la petición con el user-agent de cada rastreador: no se sabe cómo los trata el servidor."
          : `El sitio no le contestó a ${sinHttp.join(", ")} cuando llegó con su user-agent (timeout, red, o una redirección que no se pudo seguir): no se sabe si entra.`,
      queHacer:
        "Volver a correr la auditoría. Esto NO es un verde: un WAF que corta o deja colgados a los rastreadores se ve exactamente así, y no se puede distinguir de un fallo de red pasajero sin otra medición.",
      donde: "la auditoría, no el sitio",
    });
  }
  const sinRobots = AGENTES_IA.filter((a) => !bloqueados.includes(a) && lectura.acceso[a] === null);
  if (sinRobots.length > 0) {
    salida.push({
      gravedad: "no-medido",
      quePasa: `No se pudo leer el robots.txt${lectura.robotsNoMedido ? ` (${lectura.robotsNoMedido})` : ""}: no se sabe qué les declara a ${sinRobots.join(", ")}.`,
      queHacer:
        "Volver a correr la auditoría. Si el robots.txt contesta 5xx de forma persistente, los rastreadores asumen que no pueden entrar a NADA (RFC 9309): ahí sí sería un bloqueo.",
      donde: "la auditoría, y el servidor si el 5xx se repite",
    });
  }

  const texto = contenidoSinJs(lectura);
  if (texto.hallazgo) salida.push(texto.hallazgo);

  if (lectura.erroresDeSchema && lectura.erroresDeSchema.length > 0) {
    salida.push({
      gravedad: "bloqueante",
      quePasa: `El JSON-LD tiene ${lectura.erroresDeSchema.length} error(es) que un motor no va a perdonar: ${lectura.erroresDeSchema.join("; ")}.`,
      queHacer:
        "Un schema roto vale menos que ninguno: el motor lo descarta entero y además lo cuenta como señal de descuido. Arreglar primero los bloques que no parsean, después @context y @type.",
      donde: "la plantilla que emite los <script type=\"application/ld+json\">",
    });
  }
  const faltantes = SCHEMA_QUE_IMPORTA.filter((t) => !lectura.schema.includes(t));
  if (faltantes.length > 0) {
    salida.push({
      gravedad: "importante",
      quePasa: `Falta el schema de ${faltantes.join(", ")}.`,
      queHacer:
        "Los motores de IA usan el schema como FUENTE, no como pista de formato: es la diferencia entre un dato que el modelo tiene que inferir y uno que puede verificar y citar.",
      donde: "la plantilla del sitio, como JSON-LD",
    });
  }

  if (!lectura.tieneLlmsTxt) {
    salida.push({
      gravedad: "informativo",
      quePasa: "No hay `llms.txt`.",
      queHacer:
        "Se puede agregar porque es barato, pero NO cuenta como posicionamiento: Google lo comparó con la vieja etiqueta `meta keywords` y no influye en las citas. Ponerlo antes que lo de arriba es ordenar por lo que suena.",
      donde: "la raíz del sitio",
    });
  }

  return salida;
}

/**
 * Si el sitio es legible por una IA.
 *
 * `false` EXACTAMENTE cuando hay algún hallazgo bloqueante — que son los que
 * dejan a un motor sin nada que leer. Los importantes empeoran la cita; los
 * bloqueantes la impiden, y mezclarlos haría que un sitio invisible se viera
 * igual que uno mejorable.
 *
 * `null` cuando no hay ningún bloqueante pero algo NO SE MIDIÓ: la respuesta
 * honesta es «no se sabe», y un `true` ahí sería el verde que la puerta H2-GO-1
 * prohíbe para un render que falló.
 */
export function esLegiblePorIA(lista: Hallazgo[]): boolean | null {
  if (lista.some((h) => h.gravedad === "bloqueante")) return false;
  if (lista.some((h) => h.gravedad === "no-medido")) return null;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// El punto «contenido sin JavaScript»: servido contra renderizado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La fracción mínima del texto renderizado que tiene que venir YA en el HTML
 * servido. Escrita a mano y en un solo lugar, como `MINIMO_DE_TEXTO`: es un
 * juicio, no una medición.
 */
export const FRACCION_MINIMA_SERVIDA = 0.5;

export type EstadoDelPunto = "rojo" | "verde" | "no-medido";

export interface PuntoContenidoSinJs {
  estado: EstadoDelPunto;
  servido: number;
  /** `null` si el renderizado no se midió: no es un cero. */
  renderizado: number | null;
  hallazgo: Hallazgo | null;
}

/**
 * LA REGLA, en una frase: el punto es VERDE sólo si el HTML servido trae al
 * menos `MINIMO_DE_TEXTO` caracteres Y al menos la mitad de los que trae el DOM
 * renderizado. Si falla cualquiera de las dos, ROJO. Si el renderizado no se
 * midió —falló, o la lectura es vieja—, la segunda condición no tiene
 * respuesta: NO MEDIDO, salvo que la primera ya dé rojo, que no necesita al
 * navegador para saberse.
 *
 * Por qué las dos y no una:
 *
 *   - sólo el mínimo absoluto deja en verde a un sitio que sirve el menú y el
 *     pie (1 500 caracteres) y dibuja el contenido con JavaScript (4 000 más):
 *     el rastreador lee el menú. Es el caso que la puerta describe —el auditor
 *     que no compara con el DOM renderizado no lo ve—;
 *   - sólo la proporción deja en verde a una página de 300 caracteres servidos
 *     y 300 renderizados: no depende de JavaScript, y aun así un motor no tiene
 *     qué citar. Ese rojo se dice distinto, porque se arregla en otro lugar.
 *
 * La mitad deja afuera el ruido que las dos extracciones no igualan
 * (`contarCaracteres` en `lectura.ts`: el `<title>`, las entidades, los
 * espacios que deja una etiqueta en línea) y un banner de cookies dibujado en
 * el cliente sobre una página real, y atrapa la página de control, que sirve
 * 40 caracteres y dibuja más de 1 600.
 */
export function contenidoSinJs(lectura: LecturaDelSitio): PuntoContenidoSinJs {
  const servido = lectura.caracteresSinJs;
  const render = lectura.caracteresRenderizados;
  const renderizado = render?.estado === "medido" ? render.caracteres : null;
  const motivoNoMedido = render === undefined ? "lectura sin renderizado" : render.estado === "fallo" ? render.codigo : null;

  if (renderizado === null) {
    if (servido < MINIMO_DE_TEXTO) {
      return {
        estado: "rojo",
        servido,
        renderizado,
        hallazgo: {
          gravedad: "bloqueante",
          quePasa: `Sin ejecutar JavaScript la página trae ${servido} caracteres de texto. El DOM renderizado no se pudo medir (${motivoNoMedido}), así que no se sabe si el texto aparece con JavaScript o no existe.`,
          queHacer:
            "Los rastreadores de IA no ejecutan JavaScript: para ellos la página está vacía. Se arregla renderizando en el servidor el contenido que importa.",
          donde: "el renderizado del sitio",
        },
      };
    }
    return {
      estado: "no-medido",
      servido,
      renderizado,
      hallazgo: {
        gravedad: "no-medido",
        quePasa: `Sin JavaScript la página trae ${servido} caracteres, pero el DOM renderizado no se pudo medir (${motivoNoMedido}): no se sabe cuánto del texto aparece sólo con JavaScript.`,
        queHacer:
          "Volver a correr la auditoría. Esto NO es un verde: sin el número renderizado, una página que dibuja la mitad de su contenido en el cliente se ve igual que una que no.",
        donde: "la auditoría, no el sitio",
      },
    };
  }

  // Las dos ramas rojas se dicen distinto porque se arreglan en lugares
  // distintos. Depende de JavaScript: lo servido es una fracción chica de lo
  // renderizado, o no llega al mínimo y renderizada sí.
  const dependeDeJs =
    servido < renderizado * FRACCION_MINIMA_SERVIDA ||
    (servido < MINIMO_DE_TEXTO && renderizado >= MINIMO_DE_TEXTO);
  if (dependeDeJs) {
    return {
      estado: "rojo",
      servido,
      renderizado,
      hallazgo: {
        gravedad: "bloqueante",
        quePasa: `Sin ejecutar JavaScript la página trae ${servido} caracteres de texto; renderizada, ${renderizado}. El texto que ve una persona no existe, o no alcanza, para un rastreador.`,
        queHacer:
          "Los rastreadores de IA no ejecutan JavaScript: leen sólo lo que viene en el HTML. Se arregla renderizando en el servidor el contenido que importa.",
        donde: "el renderizado del sitio",
      },
    };
  }

  // Acá `renderizado` también está por debajo del mínimo.
  if (servido < MINIMO_DE_TEXTO) {
    return {
      estado: "rojo",
      servido,
      renderizado,
      hallazgo: {
        gravedad: "bloqueante",
        quePasa: `La página trae ${servido} caracteres de texto sin JavaScript y ${renderizado} renderizada: poco texto en los dos casos.`,
        queHacer:
          "No es un problema de JavaScript —renderizar en el servidor no agrega nada—: la página no tiene texto que un motor pueda citar. Se arregla escribiendo el contenido.",
        donde: "el contenido de la página",
      },
    };
  }

  return { estado: "verde", servido, renderizado, hallazgo: null };
}
