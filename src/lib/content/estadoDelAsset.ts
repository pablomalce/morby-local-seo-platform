/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla de contenido muestre la columna `status` y ya.
 *
 * `status` tiene siete palabras y la que decide si algo se puede publicar no es
 * ninguna de ellas: es si `approved_hash` está puesto Y coincide con el texto.
 * La `0015` lo dice en su CHECK — para estar en `approved`, `scheduled` o
 * `published` hace falta que el sello EXISTA y que sea DE ESTE payload.
 *
 * Y hay un caso que la columna sola no puede expresar: un asset que estuvo
 * aprobado y cuyo texto se editó después. El trigger lo devuelve a `draft` y le
 * borra el sello, así que en la base queda idéntico a uno que nunca se aprobó —
 * y para quien mira NO es lo mismo: uno nunca pasó por revisión y el otro la
 * perdió al editarse.
 *
 * No se puede distinguir mirando una fila, y por eso esta función NO lo intenta:
 * lo dice. Inventar la diferencia sería peor que no tenerla.
 */

export interface AssetVisto {
  id: string;
  title: string | null;
  kind: string;
  locale: string;
  status: string;
  approvedHash: string | null;
  payloadHash: string | null;
}

export type ClaseDeAsset = "aprobado" | "borrador" | "sello-viejo" | "incoherente";

export interface LecturaDeAsset {
  clase: ClaseDeAsset;
  quePasa: string;
  /** Si tiene sentido ofrecer el botón de aprobar. */
  sePuedeAprobar: boolean;
}

/** Los tres estados que la `0015` considera «aprobado» para el CHECK. */
const IMPLICAN_APROBACION = new Set(["approved", "scheduled", "published"]);

export function leerAsset(a: AssetVisto): LecturaDeAsset {
  const dice = IMPLICAN_APROBACION.has(a.status);

  if (dice && !a.approvedHash) {
    // El CHECK de la 0015 lo prohíbe. Ofrecer «aprobar» acá taparía una garantía
    // caída con una acción.
    return {
      clase: "incoherente",
      quePasa: `Dice "${a.status}" y no tiene sello. El CHECK de la 0015 no lo permite: esto es la base rota, no un asset.`,
      sePuedeAprobar: false,
    };
  }

  if (dice && a.approvedHash && a.payloadHash && a.approvedHash !== a.payloadHash) {
    // Tampoco debería existir: el CHECK compara los dos. Si aparece, el sello ya
    // no describe el texto que está guardado.
    return {
      clase: "sello-viejo",
      quePasa: "El sello no coincide con el texto actual: el asset no describe lo que se aprobó.",
      sePuedeAprobar: false,
    };
  }

  if (dice) {
    return {
      clase: "aprobado",
      quePasa: "Aprobado: el sello coincide con el texto, así que se puede publicar.",
      sePuedeAprobar: false,
    };
  }

  return {
    clase: "borrador",
    quePasa:
      "Sin aprobar. Editar el texto de un asset aprobado lo devuelve acá y le borra el sello, así que esto puede ser un borrador nuevo o uno que perdió su aprobación.",
    sePuedeAprobar: true,
  };
}
