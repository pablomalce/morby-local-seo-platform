/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el ledger de publicaciones sólo se pueda mirar con una consulta SQL.
 *
 * La `0016` dejó `public.publications` con cuatro garantías, el #74 escribió el
 * transporte y el #76 la ruta que lo llama. Nada de eso se ve: al 2026-09-05 la
 * única manera de saber qué reservó o publicó la plataforma es abrir la base.
 *
 * POR QUÉ TRADUCE Y NO MUESTRA LA COLUMNA
 *
 * `status` tiene tres palabras y describen CINCO situaciones distintas, y dos de
 * ellas se arreglan en lugares opuestos:
 *
 *   * `pending` con `attempts` en 0 es una RESERVA: el ensayo llegó hasta el
 *     borde y no se llamó a la red. El encabezado del transporte lo dice
 *     textual — un ensayo y un intento en vivo cortado antes de llamar dejan la
 *     misma fila, y las dos significan lo mismo;
 *   * `pending` con `attempts` mayor que 0 es otra cosa: se llamó a la red y la
 *     fila nunca se cerró. Eso es lo que deja el caso más grave del transporte,
 *     el de «se publicó y no se pudo anotar»;
 *   * `published` sin `external_id` NO DEBERÍA EXISTIR: lo prohíbe el CHECK
 *     `publications_published_is_complete`. Si aparece, el ledger está roto y
 *     hay que decirlo, no dibujar una fila verde.
 *
 * Mostrar la columna cruda deja esas cinco como tres, y funde la reserva con el
 * intento perdido — que es exactamente la diferencia que alguien abre esta
 * pantalla para ver.
 *
 * ES PURO A PROPÓSITO: lo que hay que poder probar son las lecturas, no el React.
 */

/** Una fila del ledger, en lo que la pantalla mira de ella. */
export interface FilaLedger {
  id: string;
  assetId: string;
  destination: string;
  status: string;
  externalId: string | null;
  attempts: number;
  createdAt: string;
  publishedAt: string | null;
}

/** Cómo se lee una fila. El tono es el de la pantalla, no una palabra suelta. */
export type ClaseDeFila = "reservada" | "intento-perdido" | "publicada" | "fallada" | "incoherente";

export interface LecturaDeFila {
  clase: ClaseDeFila;
  /** Qué pasó, para alguien que no leyó la `0016`. */
  quePaso: string;
  /** Qué hacer, o `null` cuando no hay nada que hacer. */
  queHacer: string | null;
}

export function leerFila(fila: FilaLedger): LecturaDeFila {
  if (fila.status === "published") {
    // El CHECK lo prohíbe. Si llegó acá, la garantía se cayó y taparlo con una
    // fila verde es peor que no tener pantalla.
    if (!fila.externalId || !fila.publishedAt) {
      return {
        clase: "incoherente",
        quePaso:
          "Dice publicada y le falta el id de la red o la fecha. El CHECK de la 0016 no lo permite, así que esto es el ledger roto, no una publicación.",
        queHacer: "No publicar encima. Hay que mirar la fila en la base antes de tocar nada.",
      };
    }
    return {
      clase: "publicada",
      quePaso: `Salió, y la red devolvió ${fila.externalId}.`,
      queHacer: null,
    };
  }

  if (fila.status === "failed") {
    return {
      clase: "fallada",
      quePaso: `La red la rechazó. Intentos: ${fila.attempts}.`,
      queHacer: "Se puede reintentar: la unicidad hace que el reintento use esta misma fila y no cree otra.",
    };
  }

  if (fila.status === "pending") {
    if (fila.attempts === 0) {
      return {
        clase: "reservada",
        quePaso:
          "Reservada y no publicada. La base aceptó la reserva —o sea que el asset está aprobado y su texto no cambió— y nunca se llamó a la red.",
        queHacer: null,
      };
    }
    return {
      clase: "intento-perdido",
      quePaso: `Se llamó a la red ${fila.attempts} ${fila.attempts === 1 ? "vez" : "veces"} y la fila quedó abierta.`,
      queHacer:
        "Puede haberse publicado sin poder anotarse. Antes de reintentar hay que mirar en el destino si el contenido ya está.",
    };
  }

  return {
    clase: "incoherente",
    quePaso: `Estado "${fila.status}", que el CHECK de la 0016 no permite.`,
    queHacer: "El ledger tiene una fila que no debería existir. Mirarla en la base.",
  };
}

/**
 * Qué decir cuando no hay ninguna fila.
 *
 * No es «todavía nada»: un ledger vacío en este proyecto significa algo
 * concreto y medido —al 2026-09-05, `content_assets` en hosted está en 0—, así
 * que la pantalla dice qué falta en vez de dejar a alguien esperando.
 */
export const LEDGER_VACIO = {
  quePaso: "No hay ninguna publicación ni ningún ensayo todavía.",
  queHacer:
    "El ensayo se dispara sobre un asset APROBADO. Mientras no haya contenido aprobado para esta organización, no hay nada que reservar.",
} as const;
