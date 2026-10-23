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
  /**
   * La LÍNEA DE BASE de `statusPorAgente`: el status con el que la portada le
   * contestó a la ruta —la misma URL, con el user-agent de la auditoría—,
   * después de las redirecciones. Con una base 2xx, un agente que no termina
   * en 2xx es un agente al que el sitio trata distinto: rechazado, sea cual
   * sea el código (PU-1). Sin base, un código raro no se puede leer y queda
   * «no medido». Opcional para que las lecturas viejas sigan valiendo.
   */
  statusPortada?: number;
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

/** Códigos con los que un sitio le dice a un rastreador «vos no», haya línea de base o no. */
function bloqueadoPorHttp(status: number | null | undefined): boolean {
  return status === 401 || status === 403 || status === 429 || status === 451;
}

const es2xx = (status: number) => status >= 200 && status < 300;

/**
 * Lo que la petición REAL con el user-agent de un agente dice de él.
 *
 *   - `entra`: terminó en 2xx, después de las redirecciones;
 *   - `rechazado`: un código que dice «vos no» (401, 403, 429, 451), o
 *     CUALQUIER otro que no sea 2xx cuando la portada le contestó 2xx a la
 *     auditoría. Antes sólo contaban los cuatro de la lista, y un 503 a GPTBot
 *     —con lo que Wordfence bloquea en un WordPress— con la portada en 200
 *     salía VERDE, `legible` y sin un bloqueante (PU-1, reproducido por la
 *     ruta con 503, 404, 406 y 500);
 *   - `no-medido`: no contestó, o contestó algo que sin línea de base no se
 *     puede leer —un 503 para todos es un sitio caído, no uno que bloquea—.
 */
function veredictoHttp(lectura: LecturaDelSitio, agente: AgenteIA): "entra" | "rechazado" | "no-medido" {
  const status = lectura.statusPorAgente?.[agente] ?? null;
  if (status === null) return "no-medido";
  if (es2xx(status)) return "entra";
  if (bloqueadoPorHttp(status)) return "rechazado";
  return lectura.statusPortada !== undefined && es2xx(lectura.statusPortada) ? "rechazado" : "no-medido";
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
    (a) => lectura.acceso[a] === false || veredictoHttp(lectura, a) === "rechazado"
  );
  const bloqueadosSoloPorHttp = AGENTES_IA.filter(
    (a) => lectura.acceso[a] === true && veredictoHttp(lectura, a) === "rechazado"
  );
  if (bloqueadosSoloPorHttp.length > 0) {
    const base = lectura.statusPortada !== undefined ? ` (a la auditoría, con su propio user-agent, le contesta ${lectura.statusPortada})` : "";
    salida.push({
      gravedad: "bloqueante",
      quePasa: `El robots.txt permite a ${bloqueadosSoloPorHttp.join(", ")}, pero el servidor les contesta ${bloqueadosSoloPorHttp.map((a) => lectura.statusPorAgente?.[a]).join("/")} cuando llegan con su user-agent${base}.`,
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
  const sinHttp = AGENTES_IA.filter((a) => !bloqueados.includes(a) && veredictoHttp(lectura, a) === "no-medido");
  if (sinHttp.length > 0) {
    const sinRespuesta = sinHttp.filter((a) => (lectura.statusPorAgente?.[a] ?? null) === null);
    const sinBase = sinHttp.filter((a) => !sinRespuesta.includes(a));
    const partes = [
      sinRespuesta.length > 0
        ? `El sitio no le contestó a ${sinRespuesta.join(", ")} cuando llegó con su user-agent (timeout, red, o una redirección que no se pudo seguir): no se sabe si entra.`
        : null,
      sinBase.length > 0
        ? `A ${sinBase.map((a) => `${a} le contestó ${lectura.statusPorAgente?.[a]}`).join(", ")}, y no hay una portada en 2xx con qué compararlo: no se sabe si es un bloqueo o un sitio caído.`
        : null,
    ].filter((p): p is string => p !== null);
    salida.push({
      gravedad: "no-medido",
      quePasa:
        lectura.statusPorAgente === undefined
          ? "La lectura no trae la petición con el user-agent de cada rastreador: no se sabe cómo los trata el servidor."
          : partes.join(" "),
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
// Los tres puntos de la puerta, con su color
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los tres puntos que la puerta H2-GO-1 cuenta —«rojo 3 de 3», «verde 3 de 3»—,
 * cada uno con su estado. Antes el color había que sacarlo de la prosa de los
 * hallazgos (GATE-7): el test del control decidía los ejes con expresiones
 * regulares sobre `quePasa`, y el eje del schema no tenía definido cuándo es
 * verde.
 */
export interface PuntosDeLaPuerta {
  acceso: EstadoDelPunto;
  contenidoSinJs: EstadoDelPunto;
  schema: EstadoDelPunto;
}

/**
 * LAS REGLAS, una por punto:
 *
 *   - ACCESO: rojo si algún agente está bloqueado —por el robots, o porque el
 *     servidor le contestó «no» a la petición con su user-agent: un 401, 403,
 *     429 o 451, o cualquier código que no sea 2xx con la portada en 2xx
 *     (`veredictoHttp`)—; si ninguno
 *     lo está pero falta medir algo —un robots que no se pudo leer, un agente
 *     sin respuesta, una lectura sin la petición por agente—, no medido; si
 *     no, verde.
 *   - CONTENIDO SIN JAVASCRIPT: el de `contenidoSinJs`.
 *   - SCHEMA: rojo si el validador encontró errores, o si no hay ningún tipo
 *     declarado —no hay nada que verificar—; no medido si la lectura no trae
 *     el validador; verde si hay JSON-LD con tipos y sin errores. Que falte
 *     alguno de los tipos que más rinden es un hallazgo IMPORTANTE, no un
 *     schema inválido: no lo pone rojo.
 */
export function puntosDeLaPuerta(lectura: LecturaDelSitio): PuntosDeLaPuerta {
  const bloqueado = AGENTES_IA.some(
    (a) => lectura.acceso[a] === false || veredictoHttp(lectura, a) === "rechazado"
  );
  const sinMedir = AGENTES_IA.some((a) => lectura.acceso[a] === null || veredictoHttp(lectura, a) === "no-medido");
  const errores = lectura.erroresDeSchema;
  return {
    acceso: bloqueado ? "rojo" : sinMedir ? "no-medido" : "verde",
    contenidoSinJs: contenidoSinJs(lectura).estado,
    schema:
      errores === undefined ? "no-medido" : errores.length > 0 || lectura.schema.length === 0 ? "rojo" : "verde",
  };
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
  /**
   * El número servido con el que se decidió: los caracteres de texto del HTML
   * sin ejecutar JavaScript, del MISMO documento que el renderizado si el
   * render lo midió (`servidos`), y si no, del HTML que trajo la ruta.
   */
  servido: number;
  /** Los caracteres de texto del HTML que trajo la ruta (`caracteresSinJs`). */
  servidoEnHtml: number;
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
 * Los dos números salen de la MISMA extracción —`textoSinJavaScript` sobre el
 * DOM del mismo documento, con el JavaScript apagado y prendido
 * (`renderizado.ts`)—, y ninguna aplica CSS: un rastreador sin JavaScript lee
 * también el texto que una hoja de estilos oculta (GATE-1). La mitad deja
 * afuera un banner de cookies o un chat dibujados en el cliente sobre una
 * página real, y atrapa la página de control, que no trae nada sin
 * JavaScript y dibuja más de 1 600.
 *
 * Lo que la mitad NO atrapa, dicho: un boilerplate servido (un menú) que llega
 * a la mitad de lo renderizado. MEDIDO con Chrome 154: menú de 1 675 y
 * contenido sólo-JS de 1 623 da 0,51 y sale verde (GATE-8). Subir el umbral, o
 * separar el menú del contenido, es un juicio sobre cuánto JavaScript legítimo
 * tolera una página SSR (un banner de 800 sobre 2 000 ya es 0,71), y no se
 * toca acá.
 */

export function contenidoSinJs(lectura: LecturaDelSitio): PuntoContenidoSinJs {
  const render = lectura.caracteresRenderizados;
  const servidoEnHtml = lectura.caracteresSinJs;
  // Del lado servido manda el número del MISMO documento que se renderizó,
  // contado por el mismo navegador (`servidos`). El de la ruta —el HTML que
  // trajo con su propio user-agent— es la misma extracción sobre un pedido
  // aparte, y se usa sólo cuando el render no se midió.
  const servido = render?.estado === "medido" && render.servidos !== undefined ? render.servidos : servidoEnHtml;
  const renderizado = render?.estado === "medido" ? render.caracteres : null;
  const motivoNoMedido = render === undefined ? "lectura sin renderizado" : render.estado === "fallo" ? render.codigo : null;

  if (renderizado === null) {
    if (servido < MINIMO_DE_TEXTO) {
      return {
        estado: "rojo",
        servido,
        servidoEnHtml,
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
      servidoEnHtml,
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
      servidoEnHtml,
      renderizado,
      hallazgo: {
        gravedad: "bloqueante",
        quePasa: `Sin ejecutar JavaScript el HTML trae ${servido} caracteres de texto; renderizado, el DOM tiene ${renderizado}. El texto que agrega el JavaScript no existe para un rastreador.`,
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
      servidoEnHtml,
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

  return { estado: "verde", servido, servidoEnHtml, renderizado, hallazgo: null };
}
