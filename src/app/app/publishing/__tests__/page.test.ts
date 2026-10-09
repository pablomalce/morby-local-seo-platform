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
const CLIENTE = readFileSync(join(__dirname, "..", "client.tsx"), "utf8");

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

describe("de dónde salen los assets que se pueden ensayar", () => {
  it("sólo los APROBADOS, con el predicado del sello", () => {
    // Sin este filtro el selector ofrecería borradores, y todo ensayo sobre uno
    // daría 409 `no-aprobado`: un botón que no puede funcionar, ofrecido igual.
    // Es el mismo predicado literal de `dashboard/page.tsx` y el mismo que
    // comprueba `rehearse/route.ts`.
    expect(PAGINA).toContain('.not("approved_hash", "is", null)');
  });

  it("y los lee con el cliente de SESIÓN, no con el admin", () => {
    // `service_role` saltea la RLS de la `0014`: el selector ofrecería el
    // contenido de otra organización y ningún render lo notaría. Un
    // `.eq("organization_id", …)` de más no alcanza si la llave alcanza todo.
    expect(PAGINA).toMatch(/from\("content_assets"\)/);
    expect(PAGINA).not.toContain("createSupabaseAdminClient");
  });

  it("NO importa nada sembrado: la lista de aprobados no puede venir de una semilla", () => {
    for (const archivo of [PAGINA, CLIENTE]) {
      expect(archivo).not.toMatch(/from "@\/lib\/mock/);
      expect(archivo).not.toMatch(/from "@\/lib\/store\/tenantStore/);
    }
  });

  it("el botón de ensayar lo decide el rol de la organización activa, con la lista de rol.ts (H4.1, D4)", () => {
    // Ensayar pide lo mismo que aprobar: owner, admin o manager.
    expect(PAGINA).toMatch(/puedeEnsayar=\{rolPuede\(organizacion\.rol, "aprobar"\)\}/);
  });

  it("delega la organización activa en UN solo lugar", () => {
    expect(PAGINA).toContain("organizacionActiva()");
    expect(PAGINA).not.toMatch(/\.eq\("user_id", user\.id\)/);
  });

  it("sin organización activa lo DICE, en vez de dibujar el ledger vacío", () => {
    // Era el cero inventado más caro de esta pantalla: un ledger vacío se lee
    // como «este cliente no publicó nada».
    expect(PAGINA).toContain("sin-organizacion");
  });

  it("distingue «no pude leer los aprobados» de «no hay aprobados»", () => {
    expect(PAGINA).toContain("aprobados-ilegibles");
    expect(PAGINA).toMatch(/aprobadosRes\.error/);
    // Y sin pisar el bloque que ya existía para el ledger.
    expect(PAGINA).toContain("ledger-ilegible");
  });

  it("esta pantalla NO puede crecer hacia la publicación real sin ponerse roja", () => {
    // El modo en vivo necesita un publicador que no existe, cuota de Business
    // Profile que no tenemos, y una decisión sobre quién puede mandar algo a la
    // ficha de un cliente. Hasta entonces la pantalla no lo ofrece: ni un botón,
    // ni un campo, ni un modo.
    expect(PAGINA + CLIENTE).not.toMatch(/publishing\/publish|"en-vivo"/);
    // Y la pared distingue una mención de la ruta de verdad.
    expect('fetch("/api/publishing/publish"').toMatch(/publishing\/publish|"en-vivo"/);
  });

  it("el cableado del ensayo está en el cliente, con el id del asset y nada más", () => {
    // La pared de este frente: si el `fetch` desaparece, la ruta vuelve a ser un
    // módulo que nadie llama y el render seguiría igual de lindo.
    expect(CLIENTE).toContain('fetch("/api/publishing/rehearse"');
    expect(CLIENTE).toMatch(/JSON\.stringify\(\{ assetId/);
  });
});
