/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que alguien escriba en `publications` sin pasar por `transport.ts`.
 *
 * `transport.ts` garantiza lo que pasa POR ÉL: que un ensayo no publique, que un
 * reintento no duplique, que la red y el ledger no se separen. Lo que no puede
 * garantizar es ser la única puerta — eso no es una propiedad del módulo sino del
 * árbol de archivos, y sólo un test que mire el árbol la sostiene.
 *
 * Es la misma pared que `src/lib/ai/__tests__/sinAtajos.test.ts` levanta alrededor
 * del egreso, y por el mismo motivo: sin ella, el módulo queda perfecto y una
 * ruta nueva con un `insert` directo deja el ledger diciendo lo que quiera. **Una
 * puerta sin pared no es una puerta.**
 *
 * ES ESTÁTICO, Y TIENE QUE SERLO. El fallo que previene ocurre en un archivo que
 * todavía no existe.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");
/** El único lugar donde se puede escribir el ledger. */
const PUERTA = path.join(SRC, "lib", "publishing");

/**
 * La señal de que un archivo escribe el ledger.
 *
 * Es la ESCRITURA sobre la tabla, no la palabra: `publications` aparece —y tiene
 * que poder aparecer— en cualquier pantalla que lea el ledger para mostrarlo. Lo
 * que no puede aparecer afuera es un `insert`, un `update`, un `upsert` o un
 * `delete` encadenado a `from("publications")`.
 */
const ESCRITURAS = ["insert", "update", "upsert", "delete"] as const;

/**
 * El patrón que delata una escritura, en UN solo lugar.
 *
 * Está acá y no repetido en cada test por lo que costó una mutación: con el
 * patrón escrito dos veces, vaciar `ESCRITURAS` dejaba la pared sin buscar nada
 * y el test que decía comprobarla seguía en verde, porque comprobaba SU copia.
 *
 * `from("publications")` y el verbo pegado o con espacios y saltos en el medio,
 * que es como el encadenamiento de supabase-js se escribe de verdad.
 */
function patronDe(verbo: string): RegExp {
  return new RegExp(`from\\(\\s*["'\`]publications["'\`]\\s*\\)[\\s\\S]{0,200}?\\.${verbo}\\(`);
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("la pared alrededor del ledger", () => {
  it("nadie fuera de src/lib/publishing escribe en `publications`", () => {
    const culpables: string[] = [];

    for (const archivo of archivos(SRC)) {
      if (archivo.startsWith(PUERTA + path.sep)) continue;

      const texto = readFileSync(archivo, "utf8");
      for (const verbo of ESCRITURAS) {
        if (patronDe(verbo).test(texto)) {
          culpables.push(`${path.relative(SRC, archivo)} — .${verbo}()`);
        }
      }
    }

    expect(culpables).toEqual([]);
  });

  it("la pared mira de verdad el árbol, y no una lista vacía", () => {
    // Sin esto, un `archivos()` que devolviera nada dejaría el test anterior en
    // verde para siempre. **Un cero no llama la atención de nadie.**
    //
    // El 50 es un piso, no una medida: bajarlo a -1 SOBREVIVE la mutación y es un
    // mutante equivalente, porque lo mutado es el oráculo mismo. Lo que este test
    // mide es `archivos()`, y esa mutación —hacerlo devolver `[]`— sí lo tira.
    const vistos = archivos(SRC).filter((a) => !a.startsWith(PUERTA + path.sep));
    expect(vistos.length).toBeGreaterThan(50);
  });

  it("y encontraría cada una de las cuatro escrituras si estuviera", () => {
    // El mutante que este test expresa, y que ya sobrevivió una vez: una lista de
    // verbos VACÍA deja el primer test buscando nada, y buscar nada siempre está
    // en verde. El cuatro está escrito a mano a propósito — es el denominador, y
    // si alguien saca un verbo tiene que ponerse rojo acá.
    expect(ESCRITURAS).toHaveLength(4);

    for (const verbo of ESCRITURAS) {
      const ejemplo = `await admin.from("publications")\n  .${verbo}({ status: "published" });`;
      expect(patronDe(verbo).test(ejemplo)).toBe(true);
      // Y no matchea lo que NO es una escritura al ledger: un `select` sobre la
      // misma tabla tiene que poder existir en cualquier pantalla que lo muestre.
      expect(patronDe(verbo).test(`await admin.from("publications").select("id");`)).toBe(false);
    }
  });
});
