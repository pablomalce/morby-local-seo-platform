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
import { existsSync } from "node:fs";
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

  it("no está bajo /app, que es la mitad gateada y donde vivía el 404", () => {
    // No es una regla de estilo. `/app/*` lo gatea el middleware y sólo tiene
    // `account` e `integrations`; el destino natural de un login es el dashboard,
    // que vive fuera. Escribirlo bajo `/app` es exactamente el error que este
    // archivo existe para impedir.
    expect(DESTINO_POST_LOGIN.startsWith("/app/")).toBe(false);
  });
});
