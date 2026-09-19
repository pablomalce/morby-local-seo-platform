/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el destino del login siga siendo una demostración con un cartel encima.
 *
 * `DESTINO_POST_LOGIN` era `/dashboard`, que es la demo pública: el login
 * depositaba al usuario DENTRO de la demostración. El #75 puso una marca para
 * que al menos se supiera cuál se estaba mirando, y declaró explícitamente que
 * no cerraba la decisión de fondo — darle al producto un lugar propio.
 *
 * Éste es ese lugar. Y lo que lo vuelve producto y no un tablero de adorno es
 * que contesta UNA pregunta: **qué falta ahora**.
 *
 * POR QUÉ SE DERIVA Y NO SE ESCRIBE UNA LISTA
 *
 * Una lista de pasos escrita a mano es una foto: el día que alguien conecta
 * Google, la lista sigue diciendo que hay que conectarlo. Es el mismo defecto
 * que el #55 sacó del orquestador, el #56 de la pantalla de integraciones y
 * `platformStatus.ts` de `/settings`. Éste es el cuarto lugar, y por eso el paso
 * sale de contar lo que hay.
 *
 * EL ORDEN NO ES ESTÉTICO
 *
 * Es de dependencia, y cada eslabón es inútil sin el anterior: sin negocio no
 * hay a quién mapearle una property; sin mapeo el reporte no puede traer datos
 * reales; sin contenido aprobado no hay nada que publicar. Saltearse uno deja a
 * alguien configurando algo que todavía no se puede usar.
 */

/** Lo que hay, contado. Nada de esto se infiere: son filas. */
export interface EstadoDelProducto {
  negocios: number;
  /** Mapeos VIVOS de Google para esta organización. */
  mapeos: number;
  /** Sondas que NO están en `ok` en la última medición. */
  fuentesFallando: number;
  reportes: number;
  /** Assets con `approved_hash` puesto. */
  contenidoAprobado: number;
  publicaciones: number;
}

export interface ProximoPaso {
  /** Qué hacer, en la lengua de quien lo lee. */
  que: string;
  /** Dónde se hace. Una ruta de esta aplicación, siempre. */
  donde: string;
  /** Por qué es ESTE y no el siguiente. */
  porque: string;
}

/**
 * El próximo paso, o `null` cuando no falta nada.
 *
 * `null` es un resultado y no un hueco: significa que la organización tiene
 * negocio, Google conectado, un reporte y contenido aprobado. Inventar un paso
 * ahí sería darle trabajo a alguien que ya terminó.
 */
export function proximoPaso(estado: EstadoDelProducto): ProximoPaso | null {
  if (estado.negocios === 0) {
    return {
      que: "Crear el primer negocio de esta organización",
      donde: "/onboarding/new-business",
      porque: "Todo lo demás cuelga de un negocio: las properties, los reportes y el contenido.",
    };
  }

  if (estado.mapeos === 0) {
    return {
      que: "Conectar Google y mapear las properties de este cliente",
      donde: "/app/integrations",
      porque:
        "Sin mapeo el reporte se arma con datos sintéticos. El mapeo es lo único que separa los números de un cliente de los de otro.",
    };
  }

  // Va ANTES que el reporte a propósito: generar uno sobre una fuente que está
  // fallando produce un reporte con huecos y con la fecha de hoy, que después se
  // lee como si fuera bueno.
  if (estado.fuentesFallando > 0) {
    return {
      que: "Arreglar las fuentes de Google que están fallando",
      donde: "/app/integrations",
      porque:
        "Cada fuente guarda POR QUÉ falló, y cada motivo se arregla en un lugar distinto. Un reporte generado encima de esto sale con huecos y con fecha de hoy.",
    };
  }

  if (estado.reportes === 0) {
    return {
      que: "Generar el primer reporte con datos reales",
      donde: "/app/reports",
      porque: "Es lo que convierte las integraciones conectadas en algo que un cliente puede leer.",
    };
  }

  if (estado.contenidoAprobado === 0) {
    return {
      que: "Aprobar contenido, que es lo que se puede publicar",
      donde: "/content",
      porque:
        "La publicación se reserva contra el sello del texto aprobado. Sin ninguno aprobado no hay nada que reservar, y el ledger va a seguir vacío.",
    };
  }

  return null;
}
