/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PARED
 *
 * Que el lugar propio del producto vuelva a llenarse de datos sembrados.
 *
 * Es el defecto que motivó todo este frente: la demo y el producto eran la misma
 * pantalla porque la pantalla dibujaba `@/lib/mock/universal`. Un test de render
 * no lo vería: un negocio sembrado y uno real se dibujan idénticos.
 *
 * Le pregunta al archivo, como `rutas.test.ts` y `marcaEnLaCascara.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGINA = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
const CLIENTE = readFileSync(join(__dirname, "..", "client.tsx"), "utf8");

describe("de dónde salen los datos de esta pantalla", () => {
  it("NO importa nada sembrado", () => {
    // Se busca la forma de un IMPORT y no el nombre suelto, porque el nombre
    // suelto aparece en los comentarios de estos mismos archivos —explicando
    // justamente que no se importa— y la primera versión de esta pared se cayó
    // contra su propia prosa. Un muro que busca texto tiene que buscar código.
    for (const archivo of [PAGINA, CLIENTE]) {
      expect(archivo).not.toMatch(/from "@\/lib\/mock/);
      expect(archivo).not.toMatch(/from "@\/lib\/store\/tenantStore/);
    }
  });

  it("y la pared distingue un import de una mención", () => {
    // Anti-vacuidad: si el patrón no reconociera un import de verdad, el test de
    // arriba pasaría siempre y no estaría sosteniendo nada.
    expect('import { businesses } from "@/lib/mock/universal";').toMatch(/from "@\/lib\/mock/);
  });

  it("lee con el cliente de SESIÓN y no con el admin", () => {
    // `service_role` saltea la RLS por definición: sería mostrarle a alguien los
    // negocios de otra organización.
    expect(PAGINA).toContain("createSupabaseServerClient");
    expect(PAGINA).not.toContain("createSupabaseAdminClient");
  });

  it("manda al login si no hay sesión, y no dibuja una organización vacía", () => {
    expect(PAGINA).toMatch(/if \(!user\) redirect\(/);
  });

  it("distingue «no hay organización» de «la organización está vacía»", () => {
    // Contar sobre una cuenta sin organización daría ceros, y los ceros se leen
    // como «no falta nada» — que es el peor mensaje posible ahí.
    expect(PAGINA).toContain("sin-organizacion");
  });

  it("delega la organización activa en UN solo lugar", () => {
    // La regla «sólo membresías activas» vivía acá y se mudó a
    // `@/lib/org/servidor`, porque cuatro pantallas con cuatro copias del
    // criterio divergen en cuanto una agregue una regla — y entonces dos
    // pantallas de la misma sesión muestran clientes distintos.
    //
    // La pared se mudó con el código en vez de borrarse: lo que sostiene ahora
    // es que la pantalla NO resuelva la organización por su cuenta.
    expect(PAGINA).toContain("organizacionActiva()");
    expect(PAGINA).not.toMatch(/\.eq\("user_id", user\.id\)/);
  });
});
