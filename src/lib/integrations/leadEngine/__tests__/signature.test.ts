/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la verificación de firma acepte algo que no debería, en cualquiera de las
 * cuatro formas en que eso pasa: sin secreto, con la cabecera mal formada, con
 * una firma que no corresponde, o —la que se descubre tarde— firmando el JSON
 * reparseado en vez de los bytes que llegaron.
 *
 * El endpoint escribe con `service_role` y sin RLS. Esta firma es lo único que
 * separa una entrega legítima de un POST cualquiera, así que cada uno de estos
 * casos es la diferencia entre un cliente real y uno inventado.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "@/lib/integrations/leadEngine/signature";

const SECRETO = "no-es-un-secreto-real";
const CUERPO = '{"event":"lead.won","source":{"system":"vulkan-lead-engine"}}';

/** El productor firma así. Escrito acá, no importado del módulo que se prueba. */
function firmar(cuerpo: string, secreto = SECRETO): string {
  return "sha256=" + createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
}

describe("una firma que corresponde", () => {
  it("se acepta", () => {
    expect(verifySignature(CUERPO, firmar(CUERPO), SECRETO)).toEqual({ ok: true });
  });

  it("el prefijo es `sha256=`, literal", () => {
    // Es contrato con el otro repositorio: `signWebhookBody()` del Lead Engine
    // escribe exactamente eso. Cambiarlo acá rompe la integración sin que ningún
    // test de aquel lado se entere.
    const hex = createHmac("sha256", SECRETO).update(CUERPO, "utf8").digest("hex");
    expect(verifySignature(CUERPO, `sha256=${hex}`, SECRETO)).toEqual({ ok: true });
    expect(verifySignature(CUERPO, `sha1=${hex}`, SECRETO)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifySignature(CUERPO, hex, SECRETO)).toEqual({ ok: false, reason: "malformed" });
  });

  it("un prefijo equivocado DEL MISMO LARGO no se cuela", () => {
    // Lo dijo una mutación que sobrevivió, y el test que había no lo medía.
    //
    // `sha256=` mide siete caracteres. El código recorta siete y después exige
    // hexadecimal de 64, así que un prefijo equivocado MÁS CORTO —`sha1=`, cinco—
    // se cae solo: el recorte se come dos dígitos y quedan 62. Ese caso pasaba
    // aunque la comprobación del prefijo no existiera.
    //
    // Un prefijo equivocado del MISMO largo es otra cosa: el recorte deja los 64
    // hexadecimales intactos y la firma verifica. Sin `startsWith`, esto se
    // aceptaría — o sea que la comprobación del prefijo no es decorativa, y esta
    // es la única línea que lo mide.
    const hex = createHmac("sha256", SECRETO).update(CUERPO, "utf8").digest("hex");
    expect("sha512=".length).toBe("sha256=".length);
    expect(verifySignature(CUERPO, `sha512=${hex}`, SECRETO)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("se firma el cuerpo CRUDO", () => {
  it("un cuerpo reserializado NO verifica contra la firma del original", () => {
    // Ésta es la trampa entera. `JSON.parse` + `JSON.stringify` produce un texto
    // distinto —reordena claves, cambia el escapado— así que verificar contra el
    // reparseado rechaza entregas buenas. Y el arreglo tentador para ese síntoma
    // es aflojar la verificación.
    const original = '{"b":1,"a":"\\u00e9"}';
    const reserializado = JSON.stringify(JSON.parse(original));
    expect(reserializado).not.toBe(original);
    expect(verifySignature(reserializado, firmar(original), SECRETO)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("un solo byte distinto en el cuerpo la invalida", () => {
    expect(verifySignature(CUERPO + " ", firmar(CUERPO), SECRETO)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });
});

describe("lo que se rechaza, y cada uno por su motivo", () => {
  it("sin secreto configurado no se puede verificar, y eso NO es verificado", () => {
    // Un endpoint que acepta cuando le falta la configuración está abierto
    // durante el rato exacto en que alguien se olvidó una variable de entorno.
    expect(verifySignature(CUERPO, firmar(CUERPO), undefined)).toEqual({
      ok: false,
      reason: "no-secret",
    });
    expect(verifySignature(CUERPO, firmar(CUERPO), "")).toEqual({
      ok: false,
      reason: "no-secret",
    });
  });

  it("sin cabecera", () => {
    expect(verifySignature(CUERPO, null, SECRETO)).toEqual({ ok: false, reason: "malformed" });
  });

  it("una firma con el secreto equivocado", () => {
    expect(verifySignature(CUERPO, firmar(CUERPO, "otro-secreto"), SECRETO)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("una cabecera que no es hexadecimal de 64, y NO explota", () => {
    // `timingSafeEqual` TIRA si los largos difieren. Una excepción acá se
    // convertiría en un 500, que es una respuesta distinta de un 401 — y esa
    // diferencia le dice al que prueba que encontró algo.
    for (const basura of ["sha256=", "sha256=zz", "sha256=" + "0".repeat(63), "sha256=" + "g".repeat(64), "sha256=" + "0".repeat(65)]) {
      expect(() => verifySignature(CUERPO, basura, SECRETO)).not.toThrow();
      expect(verifySignature(CUERPO, basura, SECRETO)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("una firma válida en mayúsculas se rechaza como mal formada, no se acepta", () => {
    // El productor escribe hexadecimal en minúsculas. Aceptar mayúsculas sería
    // ensanchar el contrato de un lado solo.
    const hex = createHmac("sha256", SECRETO).update(CUERPO, "utf8").digest("hex");
    expect(verifySignature(CUERPO, `sha256=${hex.toUpperCase()}`, SECRETO)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
