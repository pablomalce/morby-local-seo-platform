/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla de login le muestre a una persona la jerga de Supabase y ahí
 * se termine la conversación.
 *
 * `/auth/callback` toma el `error.message` que devuelve `exchangeCodeForSession`
 * y lo reenvía tal cual en `?error=`. Lo que se ve, textual, medido el
 * 2026-09-05 en producción:
 *
 *     code challenge does not match previously saved code verifier
 *
 * No contiene ninguna acción. Y la acción existe, es corta, y se explica en una
 * línea: pedí el enlace desde el mismo navegador donde lo vas a abrir.
 *
 * Es la misma idea que `probeView.ts` aplica a los códigos de Google, y por el
 * mismo motivo: cuatro fallos distintos comparten la palabra «error» y se
 * arreglan en lugares distintos.
 *
 * POR QUÉ ES PURO
 *
 * La pantalla corre en el navegador; lo que hay que poder probar son las frases
 * y a qué mensaje corresponde cada una, no el React.
 *
 * EL CASO DESCONOCIDO DEVUELVE EL MENSAJE CRUDO, A PROPÓSITO
 *
 * Un fallo que este archivo todavía no conoce tiene que llegar a la pantalla
 * igual. Tragárselo detrás de un «algo salió mal» convierte un mensaje feo pero
 * informativo en uno inútil — y nadie se entera de que apareció algo nuevo.
 */

/** Por qué no se pudo entrar con el enlace. */
export type FalloDeEnlace =
  /** El enlace se pidió en un navegador o perfil, y se abrió en otro. */
  | "verificador-de-otro-navegador"
  /** El enlace ya se usó, venció, o lo invalidó uno más nuevo. */
  | "enlace-vencido-o-usado"
  /** Se llegó al callback sin `code`: no hubo enlace que canjear. */
  | "sin-codigo"
  /** Algo que este archivo todavía no sabe explicar. */
  | "desconocido";

export interface Explicacion {
  fallo: FalloDeEnlace;
  /** Qué pasó, en la lengua de quien lo lee. */
  quePaso: string;
  /** Qué hacer. Siempre hay algo: si no lo hubiera, no valdría la pena decirlo. */
  queHacer: string;
  /**
   * Si el mensaje crudo de Supabase se muestra igual. Sólo en `desconocido`:
   * en los tres conocidos ya se dijo algo mejor, y agregar la jerga al lado
   * vuelve a enterrar la acción.
   */
  mostrarCrudo: boolean;
}

/**
 * El verificador PKCE vive en una cookie del navegador que PIDIÓ el enlace, y
 * cada pedido nuevo lo pisa. O sea que este fallo tiene dos causas y una sola
 * salida: pedirlo de nuevo, acá, y abrirlo acá.
 */
const VERIFICADOR = /code[_ ]verifier|code challenge/i;

/**
 * Vencido, usado y reemplazado terminan igual para quien mira: hay que pedir
 * otro. No se separan porque separarlos no cambiaría lo que esa persona hace.
 */
const GASTADO = /expired|invalid|already used|otp_expired|access_denied|token has expired/i;

export function porQueFalloElEnlace(mensajeCrudo: string): Explicacion {
  const mensaje = mensajeCrudo.trim();

  if (mensaje === "missing_code") {
    return {
      fallo: "sin-codigo",
      quePaso: "Se llegó acá sin ningún enlace que canjear.",
      queHacer: "Pedí un enlace nuevo abajo y abrilo desde el correo.",
      mostrarCrudo: false,
    };
  }

  // El verificador se comprueba ANTES que «gastado»: el mensaje de PKCE contiene
  // la palabra `invalid` en algunas versiones de Supabase, y decir «pedí otro»
  // sobre este fallo manda a repetir exactamente lo que ya falló — otro enlace
  // pedido acá y abierto allá vuelve a fallar igual.
  if (VERIFICADOR.test(mensaje)) {
    return {
      fallo: "verificador-de-otro-navegador",
      quePaso:
        "Este enlace se pidió desde otro navegador, otro perfil, u otro dispositivo — o se pidió uno más nuevo después, que dejó a éste sin su llave.",
      queHacer:
        "Pedí un enlace nuevo desde ACÁ, en este mismo navegador, y abrilo también acá. No pidas otro hasta abrir el que llegue: cada pedido invalida el anterior.",
      mostrarCrudo: false,
    };
  }

  if (GASTADO.test(mensaje)) {
    return {
      fallo: "enlace-vencido-o-usado",
      quePaso: "Ese enlace ya no sirve: se usó, venció, o lo reemplazó uno más nuevo.",
      queHacer: "Pedí uno nuevo abajo y abrilo dentro de la hora, en este navegador.",
      mostrarCrudo: false,
    };
  }

  return {
    fallo: "desconocido",
    quePaso: "No se pudo iniciar sesión con ese enlace.",
    queHacer: "Pedí uno nuevo abajo. Si vuelve a pasar, esto es lo que contestó el servidor:",
    mostrarCrudo: true,
  };
}
