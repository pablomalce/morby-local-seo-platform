/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PARED
 *
 * Que la pantalla número doce nazca sin la marca y nadie se entere.
 *
 * No renderiza: le pregunta al ÁRBOL DE ARCHIVOS, igual que `rutas.test.ts`,
 * porque lo que hay que sostener no es cómo se ve una pantalla sino DÓNDE está
 * enganchada la marca. Está en `AppShell`, y `AppShell` lo monta el root layout
 * alrededor de todo: mientras esas dos cosas sigan siendo ciertas, una página
 * nueva nace marcada sin que su autor tenga que acordarse.
 *
 * Cada afirmación de acá abajo es un eslabón. Si alguno se corta —sacar
 * `<AppShell>` del root, sacar `<MarcaDeDatos />` de la cáscara, o volver a
 * decidir la marca por la sesión— la cadena entera deja de sostener nada, y
 * esto se pone en rojo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("la marca cuelga de la cáscara, y la cáscara envuelve todo", () => {
  it("el root layout monta AppShell alrededor de las páginas", () => {
    const root = leer(join("app", "layout.tsx"));
    expect(root).toContain("<AppShell>");
    expect(root).toContain('from "@/components/layout"');
  });

  it("AppShell dibuja la marca", () => {
    const cascara = leer(join("components", "layout.tsx"));
    expect(cascara).toContain("<MarcaDeDatos />");
    expect(cascara).toContain('from "@/components/MarcaDeDatos"');
  });

  it("la marca decide por el dato y NO por la sesión", () => {
    // El defecto que esto impide tiene nombre y línea: `SelectionContext.tsx`
    // decía `isAuthenticated ? true : isUserCreated(business.id)`, o sea que con
    // sesión daba «real» sobre los datos sembrados que el proveedor muestra
    // mientras espera a la base.
    const marca = leer(join("components", "MarcaDeDatos.tsx"));
    expect(marca).toContain("marcaDeDatos(business.id)");
    expect(marca).not.toMatch(/useAuth|isAuthenticated/);

    const contexto = leer(join("lib", "context", "SelectionContext.tsx"));
    expect(contexto).toMatch(/isUserCreatedBusiness:\s*isUserCreated\(business\.id\)/);
    expect(contexto).not.toMatch(/isUserCreatedBusiness:\s*isAuthenticated/);
  });

  it("la cáscara no vuelve a traer una marca CONSTANTE, que es la que no marcaba nada", () => {
    // Había un literal `DEMO` fijo en la franja de estado: decía exactamente lo
    // mismo sobre Mörby y sobre el negocio de un cliente real. Una marca que no
    // depende del dato es peor que ninguna, porque parece que hay una.
    const cascara = leer(join("components", "layout.tsx"));
    const literalSuelto = />\s*(DEMO|LIVE|DEMO DATA|LIVE DATA)\s*</;
    expect(cascara).not.toMatch(literalSuelto);
  });
});
