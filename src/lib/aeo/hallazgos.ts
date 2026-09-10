import { AGENTES_IA, MINIMO_DE_TEXTO, type AgenteIA } from "./lectura";

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
  acceso: Record<AgenteIA, boolean>;
  caracteresSinJs: number;
  schema: string[];
  tieneLlmsTxt: boolean;
}

export type Gravedad = "bloqueante" | "importante" | "informativo";

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

  const bloqueados = AGENTES_IA.filter((a) => !lectura.acceso[a]);

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

  if (lectura.caracteresSinJs < MINIMO_DE_TEXTO) {
    salida.push({
      gravedad: "bloqueante",
      quePasa: `Sin ejecutar JavaScript la página trae ${lectura.caracteresSinJs} caracteres de texto.`,
      queHacer:
        "Los rastreadores de IA no ejecutan JavaScript: para ellos la página está vacía. Se arregla renderizando en el servidor el contenido que importa.",
      donde: "el renderizado del sitio",
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
 * `false` EXACTAMENTE cuando hay algún hallazgo bloqueante — que son los dos que
 * dejan a un motor sin nada que leer. Los importantes empeoran la cita; los
 * bloqueantes la impiden, y mezclarlos haría que un sitio invisible se viera
 * igual que uno mejorable.
 */
export function esLegiblePorIA(lista: Hallazgo[]): boolean {
  return !lista.some((h) => h.gravedad === "bloqueante");
}
