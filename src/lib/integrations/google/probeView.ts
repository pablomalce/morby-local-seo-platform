/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla diga «error» y ahí se termine la conversación.
 *
 * `error` es todo lo que el vocabulario del reporte puede decir, y para quien
 * opera la plataforma no alcanza: un 403 se arregla dando permiso sobre la
 * property, un 401 es el token, un 400 suele ser el identificador mal mapeado, y
 * un timeout se reintenta. Cuatro acciones distintas detrás de la misma palabra.
 *
 * La 0022 guarda cuál fue. Este archivo lo traduce a algo que alguien pueda leer
 * sin abrir la base, y es PURO a propósito: la pantalla que lo muestra corre en
 * el navegador, y lo que se prueba acá son las frases, no el React.
 */

import type { GoogleSurface } from "./sources";

/** Una sonda, tal como la pantalla la recibe. */
export interface SondaVista {
  surface: GoogleSurface;
  outcome: string;
  httpStatus: number | null;
  propertyRef: string;
  checkedAt: string;
}

/**
 * Qué hacer con lo que pasó, en una frase.
 *
 * `null` cuando no hay nada que decir: la última consulta salió bien. Mostrar
 * «anduvo» al lado de una integración que ya dice `CONNECTED` es ruido, y el
 * ruido se ignora igual que el silencio.
 *
 * Los códigos se nombran de a uno y no por familia. `401` y `403` son los dos
 * 4xx que más se confunden y se arreglan en lugares opuestos: uno es el token de
 * la plataforma —una vez, para todos— y el otro el permiso sobre la property de
 * ESTE cliente.
 */
export function queHacer(sonda: SondaVista): string | null {
  switch (sonda.outcome) {
    case "ok":
      return null;
    case "timeout":
      return "Google tardó demasiado. Suele pasar y se arregla reintentando.";
    case "network":
      return "No hubo respuesta de Google. Es la red o un corte del lado de ellos: reintentá.";
    case "malformed":
      return "Google contestó, y el cuerpo no traía lo que el reporte usa. Esto es un defecto nuestro, no de la configuración.";
    case "no-credentials":
      return "Se intentó consultar sin credenciales. Esto es un defecto nuestro: no debería haber salido la petición.";
    case "http":
      return porCodigo(sonda);
    default:
      // Un `outcome` que este archivo no conoce todavía. Se dice así en vez de
      // callar: una palabra nueva en la base con una pantalla muda es exactamente
      // cómo se pierde un motivo.
      return `La última consulta terminó en "${sonda.outcome}", que esta pantalla todavía no sabe explicar.`;
  }
}

function porCodigo(sonda: SondaVista): string {
  const donde = sonda.propertyRef;
  switch (sonda.httpStatus) {
    case 401:
      return "Google rechazó el token de la plataforma. Se arregla reconectando arriba, una vez y para todos los clientes.";
    case 403:
      return `La cuenta de la agencia no tiene permiso sobre ${donde}, o la API de esa superficie no está habilitada. Se arregla por cliente, dando acceso de lectura a esa property.`;
    case 400:
      return `Google no aceptó el pedido sobre ${donde}. Casi siempre es el identificador: revisá que sea exactamente el que Google muestra.`;
    case 404:
      return `Google no encontró ${donde}. El identificador apunta a algo que no existe o que esta cuenta no ve.`;
    case 429:
      return "Se agotó la cuota de esa API de Google. Se resuelve esperando, o pidiendo más cuota.";
    default:
      if (sonda.httpStatus !== null && sonda.httpStatus >= 500) {
        return "Google devolvió un error de su lado. Reintentá más tarde.";
      }
      return `Google contestó ${sonda.httpStatus ?? "un código desconocido"} sobre ${donde}.`;
  }
}

/**
 * Hace cuánto se midió, en palabras.
 *
 * Importa tanto como el motivo: un 403 de hace un minuto es el estado actual, y
 * uno de hace tres semanas puede estar arreglado hace rato. Sin esto, la pantalla
 * mostraría un problema viejo con la misma cara que uno vivo.
 */
export function haceCuanto(checkedAt: string, ahora: Date = new Date()): string {
  const cuando = new Date(checkedAt).getTime();
  if (Number.isNaN(cuando)) return "en un momento que no se pudo leer";

  const minutos = Math.floor((ahora.getTime() - cuando) / 60000);
  if (minutos < 0) return "recién";
  if (minutos < 1) return "hace menos de un minuto";
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? "" : "s"}`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? "" : "s"}`;

  const dias = Math.floor(horas / 24);
  return `hace ${dias} día${dias === 1 ? "" : "s"}`;
}
