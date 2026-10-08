/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el contrato de `GET /api/profile/published` diga una cosa en Growth OS y
 * otra en el Lead Engine, y que cada lado siga verde midiendo contra el suyo.
 *
 * Pasó: en 836f89f (Growth OS) el bloque decía `icp: {…} | null` y tenía el
 * `400 parametros-invalidos`; en c47c366 (Lead Engine) el encabezado de
 * `lib/integrations/growthosProfile.ts` decía `icp` como objeto obligatorio y
 * no tenía el 400. Growth OS servía un 200 con `icp: null` —un estado que su
 * base permite— y el Lead Engine lo leía como «respuesta fuera del contrato»
 * (`lectura-fallida`), que manda a buscar un fallo técnico donde lo que falta
 * es cargar el ICP y publicar. Lo encontró la revisión del 2026-10-07.
 *
 * CÓMO LO IMPIDE
 *
 * El bloque del contrato —de la línea que empieza con «EL CONTRATO (H1.3»
 * hasta la que cierra el comando de ejemplo
 * (`| openssl dgst -sha256 -hmac "$SECRETO"`), las dos incluidas— es el mismo
 * texto en los dos repositorios. Este test lo extrae de `profileReadSignature.ts`, le
 * saca el prefijo de comentario y compara su SHA-256 con uno FIJADO. El Lead
 * Engine fija el mismo número sobre su copia. Editar el bloque de un solo lado
 * pone en rojo el test de ese lado; el arreglo es editarlo en los dos y mover
 * los dos números juntos.
 *
 * La extracción es la de este comando, para que el número se pueda recalcular
 * sin este código (R11) y en el otro repositorio sin TypeScript:
 *
 *   awk '/^ \* EL CONTRATO \(H1.3/{f=1} f{print} f && /\| openssl dgst -sha256 -hmac/{exit}' \
 *     src/lib/integrations/leadEngine/profileReadSignature.ts \
 *     | sed -E 's/^ \*( |$)//' | shasum -a 256
 *
 * (Cada línea con su salto, también la última: es lo que imprime `awk`. El
 * final se busca CON la barra: la frase «calculado con `openssl dgst -sha256
 * -hmac`» de más arriba también nombra el comando, y cortar ahí dejaría el
 * vector afuera del número — la primera versión de este test lo hacía.)
 *
 * MEDIDO con `scripts/mutar.sh` (2026-10-08), cada una sola contra el árbol
 * entero:
 *
 *   G-K1 sacarle `| null` al `icp` del bloque      cae acá (número y anti-vacuidad),
 *                                                  y en ningún otro archivo
 *   G-K2 cambiar un dígito de la firma del vector  cae acá (número y vector leído
 *                                                  del bloque)
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El SHA-256 del bloque, calculado con el comando de arriba sobre este archivo
 * el 2026-10-08 y comparado con el mismo comando sobre el encabezado de
 * `lib/integrations/growthosProfile.ts` del Lead Engine: los dos dieron este
 * número.
 */
const SHA256_DEL_BLOQUE = "ce8c02c93a82684b61448de9900983b3550bdc24af871fc4e5ad541113885a0b";

const FUENTE = readFileSync(join(__dirname, "..", "profileReadSignature.ts"), "utf8");

/** El bloque, como lo extrae el comando del encabezado. */
function bloqueDelContrato(fuente: string): string[] {
  const lineas = fuente.split("\n");
  const desde = lineas.findIndex((l) => /^ \* EL CONTRATO \(H1\.3/.test(l));
  if (desde < 0) throw new Error("no está la línea «EL CONTRATO (H1.3» en profileReadSignature.ts");
  const hastaRelativo = lineas.slice(desde).findIndex((l) => l.includes("| openssl dgst -sha256 -hmac"));
  if (hastaRelativo < 0) throw new Error("el bloque del contrato no termina en la línea de openssl");
  return lineas.slice(desde, desde + hastaRelativo + 1).map((l) => l.replace(/^ \*( |$)/, ""));
}

const BLOQUE = bloqueDelContrato(FUENTE);
const TEXTO = BLOQUE.join("\n");

describe("el bloque del contrato es el mismo texto que copia el Lead Engine", () => {
  it("su SHA-256 es el fijado (el mismo que fija el Lead Engine)", () => {
    const sha = createHash("sha256").update(BLOQUE.map((l) => l + "\n").join(""), "utf8").digest("hex");
    expect(
      sha,
      "el bloque del contrato cambió: si fue a propósito, cambialo IGUAL en lib/integrations/" +
        "growthosProfile.ts del Lead Engine y mové el número fijado en los dos repositorios"
    ).toBe(SHA256_DEL_BLOQUE);
  });

  it("anti-vacuidad: el bloque extraído es el contrato entero, no un pedazo", () => {
    expect(BLOQUE[0]).toMatch(/^EL CONTRATO \(H1\.3, decisión 8a\)/);
    expect(BLOQUE.at(-1)).toContain('| openssl dgst -sha256 -hmac "$SECRETO"');
    expect(BLOQUE).toHaveLength(57);
    // Las piezas que la revisión encontró distintas entre los dos lados.
    expect(TEXTO).toContain("budget_band } | null,");
    expect(TEXTO).toMatch(/400 +\{ error: "parametros-invalidos" \}/);
    // Y las que los dos lados miden.
    for (const pieza of [
      "GET /api/profile/published?organization_id=<uuid>&business_id=<uuid>",
      "x-vulkan-timestamp",
      "x-vulkan-signature",
      "VULKAN_PROFILE_READ_SECRET",
      '401  { error: "firma-rechazada" }',
      '404  { error: "sin-version-publicada" }',
      '502  { error: "lectura-fallida" }',
      '503  { error: "sin-secreto" }',
      "|ahora - timestamp| <= 300 s",
    ]) {
      expect(TEXTO, pieza).toContain(pieza);
    }
    // Sin el prefijo de comentario: si la extracción lo dejara, el número
    // dependería del estilo de comentario de cada repositorio.
    expect(BLOQUE.some((l) => l.startsWith(" *"))).toBe(false);
  });

  it("el vector que el bloque trae se verifica con el mensaje que el bloque describe, leído DEL BLOQUE", () => {
    // R11: los valores salen del texto, no de una constante de este test ni del
    // módulo. Si alguien cambia la firma del bloque sin recalcularla con
    // openssl, esto lo dice.
    const valor = (clave: string) => {
      const m = TEXTO.match(new RegExp(`^\\s+${clave}\\s+(\\S+)$`, "m"));
      if (!m) throw new Error(`el bloque no trae «${clave}»`);
      return m[1];
    };
    const mensaje =
      "GET\n/api/profile/published\n" + valor("org") + "\n" + valor("negocio") + "\n" + valor("timestamp");
    const firma = createHmac("sha256", valor("secreto")).update(mensaje, "utf8").digest("hex");
    expect(firma).toBe(valor("firma"));
  });
});
