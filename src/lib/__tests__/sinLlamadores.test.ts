/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PARED
 *
 * Que un módulo con treinta tests y ningún llamador se lea como una capacidad.
 *
 * EL CASO QUE LA MOTIVA, MEDIDO
 *
 * `src/lib/publishing/googleBusinessProfile.ts` — el publicador real de Business
 * Profile, la última pieza de código de F4 — existe, está probado, y su ÚNICO
 * importador en todo `src` es su propio archivo de test. Ninguna ruta lo
 * inyecta. Espera un `accessToken` que nadie le pasa. Desde afuera se lee como
 * "el publicador está hecho"; desde adentro no hay ningún camino que llegue
 * hasta él.
 *
 * Y eso no es un descuido aislado: es la forma que tiene este repositorio de
 * equivocarse. `POST /api/content` y `POST /api/publishing/rehearse` son dos de
 * las rutas mejor construidas que hay, con once tests cada una, y **ninguna
 * pantalla las llama**. El encabezado de `rehearse` ya advierte contra esto
 * exactamente.
 *
 * POR QUÉ ES UNA PARED Y NO UNA FASE
 *
 * Porque el defecto no se cierra una vez. Cuatro horizontes del plan se pueden
 * cruzar enteros con el publicador huérfano: nada en ninguna de sus puertas
 * pregunta si el módulo está enchufado. Esto sí, y lo pregunta en cada corrida.
 *
 * QUÉ NO DICE
 *
 * No dice que el módulo funcione, ni que el camino que lo alcanza sea correcto.
 * Dice que existe un camino. Es el piso, no el techo: la puerta de F4 sigue
 * siendo una publicación real en una ficha de prueba, y esto no la reemplaza.
 *
 * DÓNDE MIRA, Y POR QUÉ SÓLO AHÍ
 *
 * `src/lib/publishing` y `src/lib/integrations` son los dos directorios donde
 * vive lo que cruza hacia un tercero. Un módulo huérfano en cualquier otro lado
 * es deuda; acá es una capacidad anunciada que no existe, que es lo que este
 * proyecto no se puede permitir seguir haciendo.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** Los dos directorios donde un módulo sin llamadores miente sobre el producto. */
const VIGILADOS = ["src/lib/publishing", "src/lib/integrations"];

/**
 * Lo que se acepta que no tenga llamadores de producción, con su razón.
 *
 * Agregar una entrada acá es una decisión, no un trámite: dice que este módulo
 * no es alcanzable desde la aplicación y que igual queremos tenerlo. La razón se
 * escribe para que la próxima persona pueda discutirla.
 *
 * Está vacía a propósito. Si el día de mañana hace falta, que se note en el
 * diff.
 */
const HUERFANOS_A_PROPOSITO: Array<{ modulo: string; porque: string }> = [];

function fuentes(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) salida.push(...fuentes(completo));
    else if (/\.tsx?$/.test(entrada)) salida.push(completo);
  }
  return salida;
}

const archivos = fuentes(SRC).map((f) => ({
  rel: path.relative(ROOT, f).replace(/\\/g, "/"),
  src: readFileSync(f, "utf8"),
}));

const esTest = (rel: string) => rel.includes("__tests__") || /\.test\.tsx?$/.test(rel);

const vigilados = archivos.filter(
  (f) =>
    VIGILADOS.some((d) => f.rel.startsWith(d)) && !esTest(f.rel) && !f.rel.endsWith("/index.ts")
);

/**
 * Quién importa este módulo, separando los tests del resto.
 *
 * Se busca por el nombre del archivo y no por la ruta completa porque los
 * imports son con alias (`@/lib/...`) y relativos según quién importe. Un
 * `basename` puede colisionar entre directorios, y esa colisión sólo puede
 * hacer que un módulo parezca MÁS acompañado de lo que está — nunca menos. O
 * sea que el error posible es dejar pasar un huérfano, no inventar uno.
 */
function importadores(rel: string) {
  const base = path.basename(rel).replace(/\.tsx?$/, "");
  const patron = new RegExp(`from\\s+["'][^"']*/${base}["']`);
  const todos = archivos.filter((o) => o.rel !== rel && patron.test(o.src));
  return {
    produccion: todos.filter((o) => !esTest(o.rel)).map((o) => o.rel),
    tests: todos.filter((o) => esTest(o.rel)).map((o) => o.rel),
  };
}

describe("un módulo sin llamadores no es una capacidad", () => {
  // Anti-vacuidad. Si el recorrido no encuentra nada — los directorios se
  // mudaron, la extensión cambió — la afirmación de abajo pasa sobre una lista
  // vacía y este archivo informa éxito sin haber mirado nada.
  it("encuentra los módulos vigilados", () => {
    expect(vigilados.length).toBeGreaterThan(20);
  });

  it("todo módulo que cruza hacia un tercero tiene al menos un llamador de producción", () => {
    const exentos = new Set(HUERFANOS_A_PROPOSITO.map((e) => e.modulo));

    const huerfanos = vigilados
      .filter((m) => !exentos.has(m.rel))
      .map((m) => ({ rel: m.rel, ...importadores(m.rel) }))
      .filter((m) => m.produccion.length === 0)
      .map((m) => `${m.rel} (lo importan ${m.tests.length} tests y nada más)`);

    expect(
      huerfanos,
      `Estos módulos existen, están probados, y NINGUNA ruta ni pantalla los ` +
        `alcanza. Un módulo así se lee como una capacidad y no lo es. O se ` +
        `cablea a un camino real, o se borra, o se agrega a ` +
        `HUERFANOS_A_PROPOSITO con la razón escrita.`
    ).toEqual([]);
  });

  // Una exención para un módulo que ya no existe no cubre nada y esconde la
  // siguiente.
  it("no guarda exenciones vencidas", () => {
    const presentes = new Set(vigilados.map((m) => m.rel));
    const idos = HUERFANOS_A_PROPOSITO.filter((e) => !presentes.has(e.modulo)).map((e) => e.modulo);

    expect(idos, "exento a propósito pero ya no existe").toEqual([]);
  });
});
