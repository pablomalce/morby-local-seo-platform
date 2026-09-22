import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El menú no puede mandar a una pantalla que el middleware esconde.
 *
 * QUÉ AGUJERO CIERRA
 *
 * El 2026-09-19 la pantalla de reportes se movió de `/reports` a
 * `/app/reports`, porque la ruta que genera el reporte gasta (Places +
 * PageSpeed) y ahora pide sesión. El enlace del menú se movió con ella —y
 * nada lo sostenía: un `href` es texto en un array, y devolverlo a `/reports`
 * daría un 404 sin que ningún test se entere. Un barrido lo midió y lo dijo
 * así: "nada mide el href del nav".
 *
 * Esto es estático a propósito: la relación que cuida no es de render, es
 * entre dos archivos —el menú y el árbol de páginas— y un test de render no
 * la vería mejor.
 */

const RAIZ = process.cwd();
const NAV = readFileSync(path.join(RAIZ, "src/components/layout.tsx"), "utf8");

/** Los `href:` del array `nav`, en orden. */
const hrefs = [...NAV.matchAll(/\{\s*href:\s*"([^"]+)"/g)].map((m) => m[1]);

/** La página que Next serviría para ese href, si existe. */
const pagina = (href: string) => path.join(RAIZ, "src/app", href.replace(/^\//, ""), "page.tsx");

describe("el menú apunta a pantallas que existen", () => {
  it("encuentra los enlaces del menú (anti-vacuidad: sin esto, todo lo de abajo pasaría sobre una lista vacía)", () => {
    expect(hrefs.length).toBeGreaterThanOrEqual(10);
    expect(hrefs).toContain("/dashboard");
  });

  it("cada href tiene su page.tsx en el árbol (defecto: un enlace a una pantalla movida o borrada, que da 404 en producción y en ningún test)", () => {
    const rotos = hrefs.filter((h) => {
      try {
        readFileSync(pagina(h));
        return false;
      } catch {
        return true;
      }
    });
    expect(rotos, `estos href del menú no tienen página: ${rotos.join(", ")}`).toEqual([]);
  });

  it("el enlace de reportes apunta a /app/reports, que es donde vive desde que la ruta pide sesión (defecto: volver a /reports, que es 404 desde el 2026-09-19)", () => {
    expect(NAV).toMatch(/href:\s*"\/app\/reports",\s*labelKey:\s*"nav\.reports"/);
    expect(hrefs).not.toContain("/reports");
  });
});
