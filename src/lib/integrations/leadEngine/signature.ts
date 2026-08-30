/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que cualquiera cree clientes en Growth OS mandando un POST.
 *
 * El endpoint de la ingesta escribe organizaciones, negocios, locations y
 * contactos con `service_role`, sin RLS de por medio — tiene que ser así, porque
 * crea la organización cuyo eje de tenant recién existe al terminar. O sea que
 * **lo único que separa una entrega legítima de una inventada es esta firma.**
 *
 * SE FIRMA EL CUERPO CRUDO, Y ESO NO ES UN DETALLE
 *
 * El HMAC se calcula sobre los bytes que llegaron, no sobre el JSON reparseado.
 * `JSON.parse` seguido de `JSON.stringify` reordena claves, cambia el escapado y
 * normaliza números: dos serializaciones del mismo objeto dan dos firmas
 * distintas, así que verificar contra el reparseado rechaza entregas buenas —
 * y el arreglo tentador para ese síntoma es aflojar la verificación.
 *
 * LA CLAVE DE IDEMPOTENCIA SALE DEL CUERPO, NO DE LA CABECERA
 *
 * El productor manda `x-vulkan-idempotency-key` además de ponerla en el payload.
 * La cabecera NO está firmada: el HMAC cubre el cuerpo y nada más. Usarla sería
 * dejar que cualquiera que pueda tocar la petición en tránsito cambie la clave
 * sobre la que se deduplica — y con eso, o duplicar un cliente, o hacer que una
 * entrega verdadera se descarte como repetida.
 *
 * `source.idempotency_key` viaja adentro del cuerpo y por lo tanto adentro de la
 * firma. Ésa es la que vale. La cabecera queda para la infraestructura.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureVerdict =
  /** La firma corresponde al cuerpo y al secreto. */
  | { ok: true }
  /** No hay `GROWTH_OS_WEBHOOK_SECRET`: el endpoint no puede verificar nada. */
  | { ok: false; reason: "no-secret" }
  /** No vino la cabecera, o no tiene la forma `sha256=<hex>`. */
  | { ok: false; reason: "malformed" }
  /** Vino bien formada y no corresponde. */
  | { ok: false; reason: "mismatch" };

/** El prefijo que el productor escribe. Va literal: es contrato con el otro repo. */
const PREFIJO = "sha256=";

/**
 * Si esta petición la firmó quien dice.
 *
 * `raw` son los bytes del cuerpo tal como llegaron. Ver el encabezado.
 */
export function verifySignature(
  raw: string,
  header: string | null,
  secret: string | undefined
): SignatureVerdict {
  // Sin secreto no se puede verificar, y "no se puede verificar" NO es
  // "verificado". Un endpoint que acepta cuando le falta la configuración es un
  // endpoint abierto durante el rato exacto en que alguien se olvidó una
  // variable de entorno.
  if (!secret) return { ok: false, reason: "no-secret" };

  if (!header || !header.startsWith(PREFIJO)) return { ok: false, reason: "malformed" };

  const recibida = header.slice(PREFIJO.length);
  // Hexadecimal y del largo exacto de un SHA-256. Se comprueba ANTES de comparar
  // porque `timingSafeEqual` TIRA si los largos difieren, y una excepción acá se
  // convertiría en un 500 — que es una respuesta distinta de un 401 y le dice al
  // que prueba que encontró algo.
  if (!/^[0-9a-f]{64}$/.test(recibida)) return { ok: false, reason: "malformed" };

  const esperada = createHmac("sha256", secret).update(raw, "utf8").digest("hex");

  // Comparación de tiempo constante. Un `===` sobre strings corta en el primer
  // byte distinto, y esa diferencia de tiempo se mide: alcanza para reconstruir
  // la firma byte por byte sin conocer el secreto.
  const a = Buffer.from(recibida, "hex");
  const b = Buffer.from(esperada, "hex");
  if (a.length !== b.length) return { ok: false, reason: "malformed" };

  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}
