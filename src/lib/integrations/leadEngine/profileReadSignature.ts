/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la ficha publicada de un cliente —su ICP y su oferta— la lea cualquiera
 * que sepa dos uuid.
 *
 * `GET /api/profile/published` lee con `service_role`, sin RLS: quien llama es
 * el Lead Engine, que no tiene sesión de navegador ni es miembro de ninguna
 * organización de Growth OS. Lo único que separa una lectura legítima de una
 * enumeración de fichas ajenas es esta firma. Por eso la ruta no crea el
 * cliente de servicio hasta que esta función dice `ok`.
 *
 * CÓMO SE MANTIENE IDÉNTICO
 *
 * El bloque que va del título del contrato (la línea que empieza con «EL
 * CONTRATO (H1.3») hasta la que cierra el comando de ejemplo
 * (`| openssl dgst -sha256 -hmac "$SECRETO"`), las dos inclusive, es el mismo,
 * letra por letra, que el del encabezado de
 * `lib/integrations/growthosProfile.ts` del Lead Engine, que lo copia de este
 * archivo tal como quedó en 836f89f. `__tests__/contratoDeLectura.test.ts` lo
 * extrae de acá, le saca el prefijo de comentario y compara su SHA-256 con uno
 * fijado (el comando `awk | sed | shasum` que lo recalcula sin TypeScript está
 * en ese test): editarlo de un solo lado pone ese test en rojo, y el arreglo es
 * editarlo en los dos repositorios y mover los dos números juntos.
 * Hasta la revisión del 2026-10-07 los dos encabezados decían cosas
 * distintas —el del Lead Engine no tenía `icp: … | null` ni el 400— y cada
 * lado medía contra el suyo.
 *
 * EL CONTRATO (H1.3, decisión 8a) — IDÉNTICO EN LOS DOS REPOSITORIOS
 *
 * Esto es el contrato, no un comentario sobre el código. El otro lado
 * (`lib/integrations/growthosProfile.ts` del Lead Engine) lo copia letra por
 * letra, y el test de cada lado firma con el algoritmo del OTRO escrito desde
 * este texto, no importado de su propio módulo (R11).
 *
 *   Pedido     GET /api/profile/published?organization_id=<uuid>&business_id=<uuid>
 *
 *   Cabeceras  x-vulkan-timestamp  segundos epoch, entero decimal (sin milisegundos)
 *              x-vulkan-signature  hex EN MINÚSCULAS, 64 caracteres, SIN prefijo
 *                                  (no es el `sha256=` del webhook de lead-won)
 *
 *   Firma      hex(HMAC-SHA256(VULKAN_PROFILE_READ_SECRET, mensaje)), con
 *
 *                mensaje = "GET\n/api/profile/published\n"
 *                          + organization_id + "\n"
 *                          + business_id + "\n"
 *                          + timestamp
 *
 *              en UTF-8 y sin salto de línea final; los dos ids tal como
 *              viajan en la query y el timestamp tal como viaja en su cabecera.
 *
 *   Ventana    |ahora - timestamp| <= 300 s, en los dos sentidos. Fuera, 401.
 *
 *   Secreto    VULKAN_PROFILE_READ_SECRET, PROPIO: no es GROWTH_OS_WEBHOOK_SECRET.
 *              Ausente o vacío en este lado = 503, nunca «pasá».
 *
 *   Respuestas
 *     200  { organization_id, business_id, version_id, version, published_at,
 *            icp: { definition, disqualifiers, buying_trigger, budget_band } | null,
 *            offers: [{ name, description, price_band, promise }] }
 *          `icp` es null cuando la versión publicada no tiene fila de ICP: la
 *          base no lo exige para publicar. El consumidor tiene que FALLAR con
 *          nombre ahí, nunca rellenar con un texto propio. `offers` va ordenado
 *          por `position` y puede venir vacío.
 *     400  { error: "parametros-invalidos" }   firmado, pero un id no es un uuid
 *     401  { error: "firma-rechazada" }        sin firma, mal formada, otra o vieja
 *                                              (el motivo NO viaja: es el mapa)
 *     404  { error: "sin-version-publicada" }  no hay versión publicada para ESE
 *                                              par; también si el negocio no es
 *                                              de esa organización
 *     502  { error: "lectura-fallida" }        la base falló (ausencia ≠ fallo);
 *                                              nunca detalle de Postgres
 *     503  { error: "sin-secreto" }            este lado no tiene el secreto
 *
 *   Vector de prueba, calculado con `openssl dgst -sha256 -hmac` y no con este
 *   código (es el oráculo de un tercero para los dos lados):
 *
 *     secreto    secreto-de-ejemplo-del-contrato-h13
 *     org        018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00
 *     negocio    018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c11
 *     timestamp  1790000000
 *     firma      ee4a08307808b8196b96fc65b7ca25276b695458cd19d75e150d9fa48cc41fe6
 *
 *     printf 'GET\n/api/profile/published\n%s\n%s\n%s' "$ORG" "$NEGOCIO" "$TS" \
 *       | openssl dgst -sha256 -hmac "$SECRETO"
 *
 * CÓMO SE QUEDA ADENTRO DE ESE CONTRATO ESTE LADO
 *
 * Esto no es contrato: es lo que hace la ruta con estados que su base permite.
 *
 *   - Una versión publicada sin fila de ICP se sirve con `icp: null`, como dice
 *     el bloque; una con `definition` vacío o en blanco, tal cual. Es el Lead
 *     Engine el que les pone nombre (`sin-icp`) y no arma el prompt. Ninguno de
 *     los dos lados rellena un ICP.
 *   - Una oferta con `name` en blanco se sirve tal cual (`profile_offers.name`
 *     es NOT NULL y admite `''`); el Lead Engine la deja afuera sin tumbar la
 *     ficha.
 *   - `organization_id` y `business_id` del 200 son los de la FILA leída, no
 *     los de la query, y si la fila no es del par pedido la ruta contesta 502.
 *     Así el chequeo de eco del Lead Engine mide algo que este lado SÍ puede
 *     romper (hallazgo de la revisión: antes devolvía los de la query).
 *   - Cualquier excepción después de la firma —falta
 *     `SUPABASE_SERVICE_ROLE_KEY` y `createClient` tira, por ejemplo— es 502
 *     `lectura-fallida`, nunca un 500 de Next.
 *   - El secreto «vacío» incluye el que es sólo espacios: 503 igual.
 *
 * POR QUÉ LA FIRMA CUBRE LOS DOS IDS Y LA HORA
 *
 * Los ids, porque una firma que sólo cubriera la hora sería un pase: quien
 * capture un pedido podría cambiarle el `business_id` y leer otra ficha con la
 * misma firma. La hora, porque sin ella un pedido capturado se puede repetir
 * para siempre. Trescientos segundos alcanzan para un reloj desfasado y no
 * para un archivo de pedidos viejos.
 *
 * POR QUÉ FALLA CERRADO SIN SECRETO
 *
 * Es la lección de `requireInternalSecret` (src/lib/api/internal-guard.ts): ese
 * guardia contestaba «pasá» cuando faltaba su variable, y siete rutas quedaron
 * abiertas a cualquiera mientras nadie la configuró. «No puedo verificar» no es
 * «verificado».
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** El path que entra en el mensaje firmado. Va literal: es contrato. */
export const RUTA_DE_LECTURA = "/api/profile/published";

/** Cuántos segundos de diferencia con el reloj de este lado se toleran. */
export const VENTANA_SEGUNDOS = 300;

export type VeredictoDeLectura =
  /** La firma corresponde a los dos ids, a la hora y al secreto, y es reciente. */
  | { ok: true }
  /** Falta `VULKAN_PROFILE_READ_SECRET` (o está vacío): no se puede verificar nada. */
  | { ok: false; motivo: "sin-secreto" }
  /** Falta una cabecera, o no tiene la forma del contrato. */
  | { ok: false; motivo: "mal-formada" }
  /** Bien formada, y la hora está fuera de la ventana. */
  | { ok: false; motivo: "vieja" }
  /** Bien formada, a tiempo, y no corresponde. */
  | { ok: false; motivo: "no-corresponde" };

export interface PedidoDeLectura {
  /** `organization_id` tal como vino en la query ("" si no vino). */
  organizationId: string;
  /** `business_id` tal como vino en la query ("" si no vino). */
  businessId: string;
  /** La cabecera `x-vulkan-timestamp`, cruda. */
  timestamp: string | null;
  /** La cabecera `x-vulkan-signature`, cruda. */
  firma: string | null;
  /** `process.env.VULKAN_PROFILE_READ_SECRET`. */
  secreto: string | undefined;
  /** El reloj de este lado, en segundos epoch. Se inyecta para poder medir la ventana. */
  ahoraSegundos: number;
}

/**
 * Si este pedido de lectura lo firmó quien tiene el secreto, hace poco.
 *
 * El orden importa en un solo punto: el secreto se mira PRIMERO, para que su
 * ausencia sea siempre `sin-secreto` y nunca se confunda con una firma mala. Es
 * lo que deja a la ruta contestar 503 —«este lado no está configurado»— en vez
 * de un 401 que mandaría a buscar el problema del lado del Lead Engine.
 */
export function verificarFirmaDeLectura(p: PedidoDeLectura): VeredictoDeLectura {
  if (!p.secreto || p.secreto.trim() === "") return { ok: false, motivo: "sin-secreto" };

  // Entero decimal. El tope de doce dígitos NO es lo que rechaza un timestamp
  // en milisegundos —eso lo hace la ventana: trece dígitos están a siglos del
  // reloj—, y por eso la mutación que lo sube a trece SOBREVIVE (M09,
  // 2026-10-07): es un mutante equivalente. El tope queda para que `Number()`
  // no reciba una cadena de mil dígitos.
  if (!p.timestamp || !/^\d{1,12}$/.test(p.timestamp)) return { ok: false, motivo: "mal-formada" };
  // Hexadecimal en minúsculas y del largo exacto de un SHA-256, ANTES de
  // comparar: `timingSafeEqual` TIRA si los largos difieren, y una excepción acá
  // sería un 500 —una respuesta distinta de un 401 que le dice al que prueba
  // que encontró algo—.
  if (!p.firma || !/^[0-9a-f]{64}$/.test(p.firma)) return { ok: false, motivo: "mal-formada" };

  if (Math.abs(p.ahoraSegundos - Number(p.timestamp)) > VENTANA_SEGUNDOS) {
    return { ok: false, motivo: "vieja" };
  }

  const mensaje =
    "GET\n" + RUTA_DE_LECTURA + "\n" + p.organizationId + "\n" + p.businessId + "\n" + p.timestamp;
  const esperada = createHmac("sha256", p.secreto).update(mensaje, "utf8").digest();

  // Tiempo constante. Un `===` corta en el primer byte distinto, y esa
  // diferencia se mide: alcanza para reconstruir la firma byte por byte.
  const recibida = Buffer.from(p.firma, "hex");
  if (recibida.length !== esperada.length) return { ok: false, motivo: "mal-formada" };
  return timingSafeEqual(recibida, esperada) ? { ok: true } : { ok: false, motivo: "no-corresponde" };
}
