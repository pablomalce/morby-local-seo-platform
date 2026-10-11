/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la ruta de auditoría AEO le pida a una dirección interna lo que le pide
 * a un sitio: el `robots.txt`, la portada, el `llms.txt` y una petición por
 * agente de IA.
 *
 * El destino sale de `businesses.website`, que cualquier miembro de la
 * organización puede escribir. Hasta este archivo esos pedidos iban por
 * `fetch` con `redirect: "follow"` y sin mirar la dirección: un negocio con
 * el sitio en `http://127.0.0.1:…`, o en un sitio público que contesta 302 a
 * `169.254.169.254`, hacía que la función de Vercel pidiera eso por quien
 * llamaba —y el status por agente viajaba de vuelta en la respuesta, que es un
 * escáner de puertos con la red de la plataforma—. El render en Chromium ya
 * examinaba la dirección (`renderizado.ts`); estos cuatro pedidos, que corren
 * al lado, no.
 *
 * Ahora cada pedido de la ruta pasa por acá, y cada SALTO de una cadena de
 * redirecciones pasa por el MISMO examen que el navegador:
 *
 *   1. el examinador de `renderizado.ts` —sólo http/https, puertos 80 y 443,
 *      sin credenciales, y TODAS las direcciones del nombre públicas, con la
 *      misma `esIpPublica` del chequeo de evidencia de H1.4—;
 *   2. el transporte de `transporteRender.ts`, que conecta a la dirección
 *      examinada y no vuelve a resolver el nombre (rebinding);
 *   3. las redirecciones NO las sigue el transporte: las sigue este archivo, y
 *      el destino de cada una se vuelve a examinar antes de pedirlo. Una
 *      redirección a loopback no es un salto más: es el final de la cadena,
 *      con su motivo.
 *
 * El plazo es TOTAL por cadena, no por salto: cinco redirecciones lentas no
 * suman cinco plazos.
 */
import {
  crearExaminador,
  type Examinador,
  type MotivoDeBloqueo,
  type MotivoDeTransporte,
  type Resolvedor,
  type Transporte,
} from "./renderizado";

export interface RedExaminada {
  examinar: Examinador;
  transporte: Transporte;
}

/**
 * Un examinador para toda la auditoría: el mismo nombre da la misma dirección
 * en la portada, el `robots.txt` y cada agente, y no cuesta una consulta DNS
 * por pedido.
 */
export function crearRedExaminada(deps: { resolver: Resolvedor; transporte: Transporte }): RedExaminada {
  return { examinar: crearExaminador(deps.resolver), transporte: deps.transporte };
}

export type MotivoDeTraida = MotivoDeBloqueo | MotivoDeTransporte | "redirecciones";

/** Los motivos que dicen «a ese destino no se pide», no «no contestó». */
export const MOTIVOS_DE_BLOQUEO: ReadonlySet<MotivoDeTraida> = new Set<MotivoDeTraida>([
  "esquema",
  "credenciales",
  "puerto",
  "red-no-publica",
]);

export type Traida =
  | {
      ok: true;
      status: number;
      /** La URL del último salto: adonde llevó la cadena de redirecciones. */
      url: string;
      cuerpo: Buffer;
    }
  | { ok: false; motivo: MotivoDeTraida; /** El salto que no salió. */ url: string };

export interface OpcionesTraida {
  userAgent: string;
  /** Plazo TOTAL de la cadena, examen y redirecciones incluidos. */
  timeoutMs: number;
  maxBytes: number;
  /** Sólo el status: el cuerpo no se lee. */
  sinCuerpo?: boolean;
  /** RFC 9309 pide seguir al menos cinco para el `robots.txt`; lo mismo vale acá. */
  maxSaltos?: number;
}

const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);

function ubicacion(encabezados: Record<string, string | string[]>): string | null {
  const valor = encabezados["location"];
  const unico = Array.isArray(valor) ? valor[0] : valor;
  return typeof unico === "string" && unico.trim() !== "" ? unico.trim() : null;
}

/**
 * Pide `url` como GET, examinando cada salto antes de conectarse. Nunca
 * rechaza: un destino prohibido, una red que no contesta o una cadena
 * demasiado larga vuelven como `{ ok: false, motivo }`.
 */
export async function traerExaminado(red: RedExaminada, url: string, opciones: OpcionesTraida): Promise<Traida> {
  const limite = Date.now() + opciones.timeoutMs;
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), Math.max(opciones.timeoutMs, 0));
  const maxSaltos = opciones.maxSaltos ?? 5;

  let actual: URL;
  try {
    actual = new URL(url);
  } catch {
    clearTimeout(reloj);
    return { ok: false, motivo: "esquema", url };
  }

  try {
    for (let salto = 0; salto <= maxSaltos; salto++) {
      const examen = await red.examinar(actual, corte.signal);
      if (corte.signal.aborted) return { ok: false, motivo: "timeout", url: actual.toString() };
      if (!examen.ok) return { ok: false, motivo: examen.motivo, url: actual.toString() };

      const restante = limite - Date.now();
      if (restante <= 0) return { ok: false, motivo: "timeout", url: actual.toString() };

      const respuesta = await red.transporte({
        url: actual.toString(),
        ip: examen.ip,
        metodo: "GET",
        encabezados: { "user-agent": opciones.userAgent, accept: "*/*" },
        timeoutMs: restante,
        maxBytes: opciones.maxBytes,
        sinCuerpo: opciones.sinCuerpo,
      });
      if (respuesta.tipo === "error") return { ok: false, motivo: respuesta.motivo, url: actual.toString() };

      const destino = REDIRECCIONES.has(respuesta.status) ? ubicacion(respuesta.encabezados) : null;
      if (destino === null) {
        return { ok: true, status: respuesta.status, url: actual.toString(), cuerpo: respuesta.cuerpo };
      }
      // El destino de la redirección es un pedido NUEVO: vuelve arriba y pasa
      // por el examen como el primero. Un `Location` que no es una URL corta
      // la cadena como un esquema que no sale.
      try {
        actual = new URL(destino, actual);
      } catch {
        return { ok: false, motivo: "esquema", url: destino };
      }
    }
    return { ok: false, motivo: "redirecciones", url: actual.toString() };
  } catch {
    // Un transporte o un examen que tiró no es un permiso: el pedido no salió.
    return { ok: false, motivo: "sin-respuesta", url: actual.toString() };
  } finally {
    clearTimeout(reloj);
  }
}
