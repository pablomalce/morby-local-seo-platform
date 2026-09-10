/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que los límites de escala se descubran cuando ya molestan.
 *
 * Son cinco, y ninguno está en el modelo de datos: dar de alta el cliente número
 * cincuenta funciona igual que el número tres, porque el aislamiento es por RLS y
 * no se degrada con la cantidad. Lo que se degrada es todo lo que está ALREDEDOR.
 *
 * POR QUÉ SE DERIVA DE LA CANTIDAD DE CLIENTES
 *
 * Una lista escrita a mano es una foto: el día que se sube el plan, la pantalla
 * sigue diciendo que hay que subirlo. Es el mismo defecto que el #55 sacó del
 * orquestador, el #56 de la pantalla de integraciones, `platformStatus.ts` de
 * `/settings` y `proximoPaso.ts` del tablero. Éste es el quinto lugar, y por eso
 * los avisos salen de contar organizaciones.
 *
 * LO QUE NO SE PUEDE MEDIR SE FECHA, NO SE AFIRMA
 *
 * El plan de Supabase y el de Vercel NO son legibles desde la aplicación: hacen
 * falta credenciales de gestión que la aplicación no tiene ni debe tener. Así que
 * esos dos se muestran con la FECHA en que se midieron y con el lugar donde se
 * vuelven a mirar. Decirlos como estado vivo sería exactamente la mentira que
 * este archivo existe para no repetir.
 */

/** Cuándo se miraron los planes por última vez, a mano. */
export const MEDIDO_EL = "2026-09-06";

export type ClaseDeAviso = "ahora" | "pronto" | "fechado";

export interface Aviso {
  clase: ClaseDeAviso;
  titulo: string;
  detalle: string;
  /** Dónde se resuelve. Casi nunca dentro de esta aplicación. */
  donde: string;
}

/** A partir de cuántos clientes el selector de organización deja de servir. */
export const CLIENTES_PARA_BUSCADOR = 8;
/** A partir de cuántos conviene revisar los planes antes de que aprieten. */
export const CLIENTES_PARA_REVISAR_PLANES = 5;

/**
 * Los avisos que corresponden a la escala actual.
 *
 * `clientes` son las organizaciones ACTIVAS del usuario. Con una sola no hay nada
 * que avisar: los cinco límites aparecen al crecer, y un cartel sobre un problema
 * que no tenés todavía es ruido que enseña a ignorar los carteles.
 */
export function avisosDeEscala(clientes: number): Aviso[] {
  const salida: Aviso[] = [];

  if (clientes >= CLIENTES_PARA_BUSCADOR) {
    salida.push({
      clase: "ahora",
      titulo: `El selector de organización no sirve con ${clientes} clientes`,
      detalle:
        "Está hecho como una fila de botones. Con esta cantidad hay que cambiarlo por un buscador; es trabajo de una tarde y no depende de ningún plan.",
      donde: "la propia plataforma",
    });
  }

  if (clientes >= 2) {
    salida.push({
      clase: "ahora",
      titulo: "Cada cliente nuevo exige que te den acceso en su Google",
      detalle:
        "El modelo es de UN token de agencia con permiso sobre las properties de todos. Escala bien técnicamente, pero cada alta cuesta una gestión: el cliente tiene que agregarte como usuario en su Analytics y en su Search Console. Con credenciales propias por cliente eso desaparece, y es una decisión de producto sin tomar.",
      donde: "Analytics y Search Console de cada cliente",
    });

    salida.push({
      clase: "ahora",
      titulo: "Las cuotas de Google son por proyecto, no por cliente",
      detalle:
        "Places, PageSpeed, Search Console y GA4 comparten una sola cuota. Con pocos clientes no se nota; una grilla geográfica son unas 245 llamadas por corrida y por cliente, así que ahí sí.",
      donde: "Google Cloud, cuotas del proyecto",
    });
  }

  if (clientes >= CLIENTES_PARA_REVISAR_PLANES) {
    salida.push({
      clase: "pronto",
      titulo: `Con ${clientes} clientes conviene revisar los planes`,
      detalle:
        "Antes de que aprieten, y en este orden: Supabase primero —el tope de correo por hora se comparte entre todas las altas y todos los inicios de sesión— y Vercel después.",
      donde: "los paneles de Supabase y de Vercel",
    });
  }

  salida.push({
    clase: "fechado",
    titulo: `Planes medidos el ${MEDIDO_EL}`,
    detalle:
      "Supabase en plan free y Vercel en Hobby. La aplicación NO puede leer esto —haría falta una credencial de gestión que no tiene ni debe tener— así que es una foto de esa fecha y no el estado de hoy. Y una advertencia que no es de capacidad: la licencia Hobby de Vercel es para uso NO comercial.",
    donde: "los paneles de Supabase y de Vercel",
  });

  return salida;
}
