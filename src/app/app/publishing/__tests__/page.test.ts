/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PARED
 *
 * Que esta pantalla lea el ledger con la llave que lo alcanza todo.
 *
 * `publications` tiene RLS —una permisiva y una RESTRICTIVE, `0016`— y
 * `GRANT SELECT ... TO authenticated`. Leer con el cliente ADMIN saltearía las
 * dos: la pantalla mostraría las publicaciones de cualquier organización, y
 * ningún test de render lo notaría, porque las filas se ven igual.
 *
 * Le pregunta al archivo, como `rutas.test.ts` y `marcaEnLaCascara.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGINA = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");

describe("cómo lee el ledger esta pantalla", () => {
  it("usa el cliente de SESIÓN", () => {
    expect(PAGINA).toContain("createSupabaseServerClient");
  });

  it("NO usa el cliente admin", () => {
    // `service_role` saltea la RLS por definición. Acá eso sería mostrarle a un
    // miembro las publicaciones de otra organización.
    expect(PAGINA).not.toContain("createSupabaseAdminClient");
    expect(PAGINA).not.toContain("supabase/admin");
  });

  it("manda al login si no hay sesión, y no dibuja un ledger vacío", () => {
    // Sin esto, alguien sin sesión vería «no hay publicaciones» — que es falso y
    // se lee como un dato.
    expect(PAGINA).toMatch(/if \(!user\) redirect\(/);
  });

  it("distingue un fallo de lectura de un ledger vacío", () => {
    // El cero inventado de esta pantalla: decir «no hay publicaciones» cuando la
    // consulta falló.
    expect(PAGINA).toContain("ledger-ilegible");
    expect(PAGINA).toMatch(/error \?/);
  });
});
