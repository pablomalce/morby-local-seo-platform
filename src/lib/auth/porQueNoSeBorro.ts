/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la baja de una cuenta (el derecho al olvido, `deleteMyAccount`) falle y
 * la pantalla no diga POR QUÉ, QUÉ HACER, ni QUÉ YA NO ESTÁ.
 *
 * Son tres preguntas distintas y la persona necesita las tres. Un «no se pudo»
 * solo no le dice si tiene que esperar o pedirle algo a otra organización, y un
 * «no se borró nada» después de que sus organizaciones ya se fueron es otra
 * forma de mentir: medido en la réplica el 2026-10-11, con el orden viejo, una
 * persona que publicó una versión de la ficha en una organización ajena perdía
 * sus organizaciones propias y la pantalla le contestaba que la cuenta no se
 * había borrado.
 *
 * POR QUÉ ES PURO, Y POR QUÉ VIVE APARTE
 *
 * `account-actions.ts` es un módulo `"use server"`, y uno de esos sólo puede
 * exportar funciones asíncronas: una tabla de frases ahí rompe el build. Y lo
 * que hay que poder probar son las frases y a qué estado corresponde cada una,
 * igual que `porQueFalloElEnlace.ts`.
 *
 * SIN DETALLE DE LA BASE
 *
 * Ninguna frase incluye el `message`, el `code` ni el DETAIL de Postgres. El
 * DETAIL de un 23503 nombra el uuid de OTRA organización —medido: `Key
 * (organization_id, user_id)=(<uuid de la ajena>, <uuid de la persona>)`—, y el
 * nombre de una constraint no le dice nada a quien lo lee. El detalle va al log
 * del servidor; acá llega sólo el motivo con nombre.
 */

/** Por qué la cuenta no se borró (o no se borró entera). */
export type MotivoDeBaja =
  /**
   * No se pudo confirmar la sesión: no la hay, `getUser` contestó error o lanzó.
   * No se sabe de quién es la cuenta. No se borró nada.
   */
  | "sin-sesion"
  /** No se pudo leer qué implica borrarla (sus organizaciones, sus sellos). No se borró nada. */
  | "no-se-pudo-verificar"
  /**
   * Aprobó contenido en una organización que no es sólo suya. Su firma está en ese
   * sello, y la base no deja borrar a quien firmó (el CHECK de la 0015 no acepta
   * un sello sin firmante). No se borró nada.
   */
  | "sello-en-otra-organizacion"
  /**
   * Publicó una versión de la ficha, verificó evidencia o aprobó una tarjeta en
   * una organización que no es sólo suya. La base rechaza su salida de esa
   * organización (0026 decisión 4, 0029 decisión 3). No se borró nada.
   */
  | "firma-en-otra-organizacion"
  /** No se pudo salir de las organizaciones que no son sólo suyas, por otro motivo. No se borró nada. */
  | "no-se-pudo-salir"
  /** Salió de las demás, y las propias no se pudieron borrar. A medias. */
  | "no-se-pudieron-borrar-las-propias"
  /** Salió de las demás y las propias se borraron; el acceso no. A medias. */
  | "no-se-pudo-borrar-el-acceso";

/**
 * Lo que ya no está cuando la cadena se corta. `null` es «pasó, pero no se sabe
 * cuántas»: no es lo mismo que cero, y la frase no inventa un número.
 */
export interface YaBorrado {
  /**
   * Membresías ya quitadas en organizaciones que NO eran sólo suyas: de otra
   * persona, compartidas con otro owner activo, o de las que la habían
   * archivado. Esas organizaciones siguen.
   */
  ajenas: number | null;
  /** Organizaciones sólo suyas (owner activa, sin otro owner activo), ya borradas con todo. */
  propias: number | null;
}

export const NADA_BORRADO: YaBorrado = Object.freeze({ ajenas: 0, propias: 0 });

const CABECERA: Record<MotivoDeBaja, string> = {
  "sin-sesion": "Your account was not deleted: we could not confirm that you are signed in.",
  "no-se-pudo-verificar":
    "Your account was not deleted: we could not check what deleting it involves.",
  "sello-en-otra-organizacion":
    "Your account was not deleted: you approved content in an organization that is not only yours, and that approval is signed with your name.",
  "firma-en-otra-organizacion":
    "Your account was not deleted: you published a company profile version, verified evidence or approved a task in an organization that is not only yours, and that record is signed with your name.",
  "no-se-pudo-salir":
    "Your account was not deleted: we could not remove you from the organizations that are not only yours.",
  "no-se-pudieron-borrar-las-propias":
    "Your account was not fully deleted: we could not delete the organizations that are only yours.",
  "no-se-pudo-borrar-el-acceso": "Your account was not fully deleted: we could not delete your login.",
};

const QUE_HACER: Record<MotivoDeBaja, string> = {
  "sin-sesion": "Sign in again and retry.",
  "no-se-pudo-verificar": "Try again in a moment.",
  "sello-en-otra-organizacion":
    "Ask that organization to re-approve that content under another name or return it to draft, then try again.",
  "firma-en-otra-organizacion":
    "That organization has to decide first what happens with that record; then try again.",
  "no-se-pudo-salir": "Try again in a moment.",
  "no-se-pudieron-borrar-las-propias": "Try again: the deletion resumes where it stopped.",
  "no-se-pudo-borrar-el-acceso": "Try again: the deletion resumes where it stopped.",
};

function cuantas(n: number | null, una: string, varias: string): string {
  if (n === null) return varias;
  return n === 1 ? `1 ${una}` : `${n} ${varias}`;
}

/** Qué ya no está, en una frase. Lo decide el estado, no el motivo. */
export function loQueYaNoEsta(ya: YaBorrado): string {
  const partes: string[] = [];
  if (ya.ajenas !== 0) {
    partes.push(
      `you were removed from ${cuantas(ya.ajenas, "organization that is not only yours", "organizations that are not only yours")}`,
    );
  }
  if (ya.propias !== 0) {
    partes.push(
      ya.propias === null
        ? "the organizations that were only yours may have been deleted"
        : `${cuantas(ya.propias, "organization that was only yours", "organizations that were only yours")} ${ya.propias === 1 ? "was" : "were"} deleted with everything in ${ya.propias === 1 ? "it" : "them"}`,
    );
  }
  if (partes.length === 0) return "Nothing was deleted.";
  return `Already done: ${partes.join("; ")}. Your login is still there.`;
}

/** La frase entera que ve la persona: por qué, qué ya no está, qué hacer. */
export function explicarBaja(motivo: MotivoDeBaja, ya: YaBorrado): string {
  return `${CABECERA[motivo]} ${loQueYaNoEsta(ya)} ${QUE_HACER[motivo]}`;
}

/**
 * La acción no contestó: la pantalla no recibió ni un motivo ni un `redirect`.
 * Lo pone SÓLO la pantalla (`client.tsx`), por eso no está en `MotivoDeBaja`:
 * la acción nunca lo devuelve.
 */
export type MotivoEnPantalla = MotivoDeBaja | "sin-respuesta";

/**
 * Sin respuesta no se sabe qué pasó: la cadena pudo cortarse en cualquier paso,
 * o terminar y perderse la respuesta. La frase no dice «no se borró nada» ni
 * inventa lo que ya no está; dice que reintentar retoma.
 */
export const FRASE_SIN_RESPUESTA =
  "We could not confirm whether your account was deleted: the request did not finish, so we cannot tell what is already gone. Try again: the deletion resumes where it stopped.";
