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
 * DESDE LA 0035, TRES ESTADOS Y NO SEIS. Las organizaciones se resuelven en UNA
 * transacción de la base (`delete_account_organizations`), así que ya no hay
 * «salió de las ajenas pero no borró las propias»: o pasó todo, o la base lo
 * deshizo y lo dijo con un código (no se borró nada), o no contestó y no se
 * sabe (`yaBorrado` en `null`, que no es cero). El único «a medias» que queda
 * es el login, que GoTrue borra después en su propia transacción.
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
  /**
   * No se pudo establecer qué implica borrarla: no hubo cliente de servidor, o
   * la base contestó que no puede clasificar sin riesgo —una membresía que no
   * sabe leer (45009), una que cambió mientras corría (40001, 40P01) o un lock
   * que no llegó (55P03)—. La base deshizo todo. No se borró nada.
   */
  | "no-se-pudo-verificar"
  /**
   * Aprobó contenido en una organización que no es sólo suya y donde OTRA
   * persona activa aprueba. Su firma está en ese sello, y la base no deja borrar
   * a quien firmó (el CHECK de la 0015 no acepta un sello sin firmante). Donde
   * nadie más aprueba, la 0035 suelta el sello y esto no pasa. No se borró nada.
   */
  | "sello-en-otra-organizacion"
  /**
   * Publicó una versión de la ficha, verificó evidencia o aprobó una tarjeta en
   * una organización que no es sólo suya. La base rechaza su salida de esa
   * organización (0026 decisión 4, 0029 decisión 3). No se borró nada.
   */
  | "firma-en-otra-organizacion"
  /** La base contestó otro error al borrar o dejar sus organizaciones, y deshizo todo. No se borró nada. */
  | "no-se-pudieron-borrar-las-organizaciones"
  /**
   * La base no contestó, o contestó algo que no se puede leer: la transacción
   * pudo confirmarse o no. No se sabe qué ya no está; el login sigue.
   */
  | "no-se-sabe-que-se-borro"
  /** Sus organizaciones ya quedaron resueltas; el acceso no se borró. A medias. */
  | "no-se-pudo-borrar-el-acceso";

/**
 * Lo que ya no está cuando la cadena se corta. `null` en un campo es «pasó, pero
 * no se sabe cuántas»: no es lo mismo que cero, y la frase no inventa un número.
 * `null` en vez del objeto entero es otra cosa: no se sabe SI pasó (ver
 * `no-se-sabe-que-se-borro`).
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
  /**
   * Sellos suyos que volvieron a borrador en organizaciones donde nadie más
   * aprueba (0035): nadie podía re-firmarlos.
   */
  sellos: number | null;
}

export const NADA_BORRADO: YaBorrado = Object.freeze({ ajenas: 0, propias: 0, sellos: 0 });

const CABECERA: Record<MotivoDeBaja, string> = {
  "sin-sesion": "Your account was not deleted: we could not confirm that you are signed in.",
  "no-se-pudo-verificar":
    "Your account was not deleted: we could not check what deleting it involves.",
  "sello-en-otra-organizacion":
    "Your account was not deleted: you approved content in an organization that is not only yours, and that approval is signed with your name.",
  "firma-en-otra-organizacion":
    "Your account was not deleted: you published a company profile version, verified evidence or approved a task in an organization that is not only yours, and that record is signed with your name.",
  "no-se-pudieron-borrar-las-organizaciones":
    "Your account was not deleted: we could not delete the organizations that are only yours or remove you from the others.",
  "no-se-sabe-que-se-borro":
    "Your account was not deleted: we could not confirm whether your organizations were deleted.",
  "no-se-pudo-borrar-el-acceso": "Your account was not fully deleted: we could not delete your login.",
};

const QUE_HACER: Record<MotivoDeBaja, string> = {
  "sin-sesion": "Sign in again and retry.",
  "no-se-pudo-verificar": "Try again in a moment.",
  "sello-en-otra-organizacion":
    "Ask that organization to re-approve that content under another name or return it to draft, then try again.",
  "firma-en-otra-organizacion":
    "That organization has to decide first what happens with that record; then try again.",
  "no-se-pudieron-borrar-las-organizaciones": "Try again in a moment.",
  "no-se-sabe-que-se-borro": "Try again: the deletion resumes where it stopped.",
  "no-se-pudo-borrar-el-acceso": "Try again: the deletion resumes where it stopped.",
};

function cuantas(n: number | null, una: string, varias: string): string {
  if (n === null) return varias;
  return n === 1 ? `1 ${una}` : `${n} ${varias}`;
}

/** Qué ya no está, en una frase. Lo decide el estado, no el motivo. */
export function loQueYaNoEsta(ya: YaBorrado | null): string {
  // No se sabe SI pasó: ni «nothing» ni un número. Lo único seguro es que el
  // login no se tocó, porque se borra después.
  if (ya === null) {
    return "We cannot tell whether they are already gone; your login is still there.";
  }
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
  if (ya.sellos !== 0) {
    partes.push(
      `${cuantas(ya.sellos, "approval of yours", "approvals of yours")} ${ya.sellos === 1 ? "was" : "were"} withdrawn, back to draft, where no one else could approve`,
    );
  }
  if (partes.length === 0) return "Nothing was deleted.";
  return `Already done: ${partes.join("; ")}. Your login is still there.`;
}

/** La frase entera que ve la persona: por qué, qué ya no está, qué hacer. */
export function explicarBaja(motivo: MotivoDeBaja, ya: YaBorrado | null): string {
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
