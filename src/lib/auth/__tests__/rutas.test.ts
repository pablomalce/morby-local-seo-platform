/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el destino de después del login vuelva a apuntar a una página que no
 * existe.
 *
 * Este test no compara la constante contra otra cadena escrita al lado — eso
 * mediría que el módulo es igual a sí mismo. Le pregunta al ÁRBOL DE ARCHIVOS,
 * que es la única fuente que sabe qué rutas existen de verdad, igual que
 * `sinAtajos.test.ts` hace con las llamadas a modelos de IA.
 *
 * El defecto que lo motiva ocurrió: `/app/dashboard` estuvo escrito en cuatro
 * lugares y nunca existió. Sobrevivió porque hasta el 2026-09-01 la producción
 * apuntaba a un proyecto Supabase borrado y ningún login llegaba hasta ahí.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESTINO_POST_LOGIN } from "../rutas";

/** La raíz del árbol de rutas, desde este archivo. */
const APP = join(__dirname, "..", "..", "..", "app");

describe("el destino de después del login", () => {
  it("corresponde a una página que existe en el árbol", () => {
    const pagina = join(APP, DESTINO_POST_LOGIN, "page.tsx");
    expect(
      existsSync(pagina),
      `DESTINO_POST_LOGIN apunta a "${DESTINO_POST_LOGIN}" y no hay ninguna página en ${pagina}`
    ).toBe(true);
  });

  it("empieza con barra y no termina con barra, que es lo que hace traducible la ruta", () => {
    // Sin esto, un valor como "dashboard/" o "dashboard" seguiría navegando bien
    // y el test de arriba dejaría de encontrar el archivo — o sea que la
    // comprobación se apagaría sola sin que nada se pusiera en rojo.
    expect(DESTINO_POST_LOGIN.startsWith("/")).toBe(true);
    expect(DESTINO_POST_LOGIN.endsWith("/")).toBe(false);
  });

  it("está bajo /app, que es la mitad que el middleware gatea", () => {
    // ESTA REGLA SE INVIRTIÓ, y conviene que quede escrito por qué.
    //
    // Decía «NO debajo de /app», y era correcta en su momento por un motivo que
    // ya no existe: entonces `/app/dashboard` no existía y el destino era un 404
    // —el defecto que arregló la #65— así que la regla protegía contra apuntar a
    // una página inventada. De eso ya se ocupa el primer test de este archivo,
    // que le pregunta al árbol.
    //
    // Lo que hay que sostener es lo otro: que el destino del login esté GATEADO.
    // Un destino público es, por definición, un lugar al que se puede llegar sin
    // haber entrado — y eso fue exactamente el defecto del 2026-09-04, con el
    // login depositando al usuario en la demo pública.
    expect(DESTINO_POST_LOGIN.startsWith("/app/")).toBe(true);
  });

  it("y el middleware gatea de verdad el prefijo al que apunta", () => {
    // Sin esto, la afirmación de arriba mide una convención de nombres. Le
    // pregunta al middleware, que es quien decide.
    const middleware = readFileSync(join(__dirname, "..", "..", "..", "middleware.ts"), "utf8");
    expect(middleware).toContain('url.pathname.startsWith("/app")');
  });
});
