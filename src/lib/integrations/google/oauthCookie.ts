/**
 * El nombre y la vida de la cookie que lleva el `state` del OAuth.
 *
 * Vive en su propio archivo porque lo comparten las DOS rutas —la que la escribe
 * y la que la compara— y un nombre distinto en cada una no rompe nada de manera
 * visible: la comparación simplemente nunca coincide, y todo consentimiento
 * legítimo se rechaza como si fuera un CSRF.
 *
 * Diez minutos porque eso es lo que dura elegir una cuenta y aceptar una
 * pantalla. Más es una ventana más grande para que alguien reutilice un `state`
 * que quedó dando vueltas; menos es rechazar a quien se distrajo.
 */
export const ESTADO_COOKIE = "vulkan_google_oauth_state";

/** Segundos. */
export const VIDA_DEL_ESTADO = 600;
