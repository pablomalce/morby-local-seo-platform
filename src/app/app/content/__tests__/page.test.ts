/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PARED
 *
 * Que la pantalla de producto vuelva a dibujar contenido sembrado, y que lea con
 * la llave que lo alcanza todo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGINA = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
const CLIENTE = readFileSync(join(__dirname, "..", "client.tsx"), "utf8");

describe("de dónde salen los datos de esta pantalla", () => {
  it("NO importa nada sembrado", () => {
    // Se busca la forma de un IMPORT y no el nombre suelto: el nombre aparece en
    // los comentarios de estos archivos explicando justamente que no se importa.
    for (const archivo of [PAGINA, CLIENTE]) {
      expect(archivo).not.toMatch(/from "@\/lib\/mock/);
      expect(archivo).not.toMatch(/from "@\/lib\/store\/tenantStore/);
    }
  });

  it("y la pared distingue un import de una mención", () => {
    expect('import { content } from "@/lib/mock/universal";').toMatch(/from "@\/lib\/mock/);
  });

  it("lee con el cliente de SESIÓN y no con el admin", () => {
    expect(PAGINA).toContain("createSupabaseServerClient");
    expect(PAGINA).not.toContain("createSupabaseAdminClient");
  });

  it("manda al login si no hay sesión", () => {
    expect(PAGINA).toMatch(/if \(!user\) redirect\(/);
  });

  it("sólo mira membresías ACTIVAS", () => {
    expect(PAGINA).toMatch(/\.eq\("state", "active"\)/);
  });

  it("distingue un fallo de lectura de «no hay contenido»", () => {
    expect(PAGINA).toContain("contenido-ilegible");
    expect(PAGINA).toMatch(/assetsRes\.error/);
  });

  it("trae el `payload_hash`, que es lo único que distingue un sello vivo de uno viejo", () => {
    // Sin esa columna, `leerAsset` no puede comparar y un sello viejo se
    // dibujaría como aprobado.
    expect(PAGINA).toContain("payload_hash");
  });
});
