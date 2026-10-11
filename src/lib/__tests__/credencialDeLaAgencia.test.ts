/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PARED DEL TOKEN DE LA AGENCIA
 *
 * Que una ruta de DATOS llegue a la organización de la agencia por un costado.
 *
 * El token de Google es uno, el de la organización que nombra
 * `VULKAN_AGENCY_ORG_ID`, y sirve a todos los clientes. La regla que decide a
 * quién se le presta vive en UN lugar, `servicioCompartido.ts`: sólo a una
 * organización con mapeo vivo, sólo sobre sus properties. Esa regla no vale nada
 * si al lado existe otro camino al token o a la variable — y el defecto que la
 * Espina nombra, «el fallback silencioso al token de la agencia», es justamente
 * ese otro camino: un `?? process.env.VULKAN_AGENCY_ORG_ID`, un
 * `agencyAccessToken()` llamado directo, un mapeo leído de la organización de la
 * agencia cuando el cliente no tiene. Cada uno es una línea, y ninguno rompe un
 * test que mire el camino feliz.
 *
 * LO QUE MIDE, Y CÓMO
 *
 * 1. QUIÉN LEE LA VARIABLE. Por AST, no por texto: un acceso
 *    `x.VULKAN_AGENCY_ORG_ID`, `x["VULKAN_AGENCY_ORG_ID"]`, un destructuring de
 *    ese nombre, o `x[CONST]` con una constante que vale ese literal (local o
 *    importada). Los mensajes de error y los comentarios que la NOMBRAN no son
 *    lecturas, y un `grep` no los distingue (R14). Tiene que ser exactamente un
 *    archivo, `agency.ts`. Y las tres properties de la agencia que
 *    `.env.example` declara (`GA4_PROPERTY_ID`,
 *    `GOOGLE_SEARCH_CONSOLE_SITE_URL`, `GOOGLE_BUSINESS_LOCATION_ID`) no las
 *    lee ninguno: son el valor por defecto de cualquier fallback.
 *
 * 2. QUÉ ENTRADAS LLEGAN A ESA LECTURA. El inventario de entradas se lee del
 *    disco —todo `route.ts`, `page.tsx` y `layout.tsx` bajo `src/app`, todo
 *    módulo con la directiva `"use server"`, y el middleware—, nunca de una
 *    lista. El grafo es el de los imports de VALOR: un `import type` se borra al
 *    compilar y no ejecuta nada, así que no es un camino.
 *
 * 3. LA PARED: con `servicioCompartido.ts` sacado del grafo, NINGUNA entrada de
 *    datos llega a `agency.ts`. Las únicas que pueden llegar directo son las de
 *    CONEXIÓN, declaradas abajo con su razón — y cada una tiene que seguir
 *    llegando, o la exención está vencida y esconde la próxima.
 *
 * QUÉ NO DICE
 *
 * No dice que la regla de `servicioCompartido.ts` sea correcta: eso lo miden
 * `servicioCompartido.test.ts` y los dos tests de dos organizaciones (el reporte
 * y la publicación). Dice que no hay otra puerta.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** La variable. Escrita acá y no importada: un test que compara contra la constante que prueba no mide nada. */
const VARIABLE = "VULKAN_AGENCY_ORG_ID";

/**
 * Las properties de la AGENCIA, en el entorno. `.env.example` todavía las
 * declara y NADA las lee: el mapeo de cada cliente vive en
 * `integration_properties`. Son el valor por defecto que un fallback usaría —
 * «si el cliente no tiene Search Console mapeado, consultá el sitio de la
 * agencia»—, y con el token de la agencia eso sirve los datos de la agencia en
 * el reporte de otro. Que nadie las lea es la garantía, no un dato.
 */
const PROPERTIES_DE_LA_AGENCIA = ["GA4_PROPERTY_ID", "GOOGLE_SEARCH_CONSOLE_SITE_URL", "GOOGLE_BUSINESS_LOCATION_ID"];

const VIGILADAS = [VARIABLE, ...PROPERTIES_DE_LA_AGENCIA];

/** El único archivo que puede leerla. */
const LECTOR = "src/lib/integrations/google/agency.ts";

/** La regla del servicio compartido: el único camino de una ruta de datos al token. */
const PUERTA = "src/lib/integrations/google/servicioCompartido.ts";

/**
 * Las entradas de CONEXIÓN: las que operan la credencial de la agencia, no
 * leen datos de un cliente con ella. Pueden llegar a la variable sin pasar por
 * la puerta, porque su pregunta ES «¿quién es la agencia?».
 *
 * Agregar una entrada acá es una decisión, no un trámite: dice que esa entrada
 * no sirve datos de nadie con el token. Una ruta de datos no entra acá; entra
 * por `servicioCompartido.ts`.
 */
const CONEXION: Array<{ entrada: string; porque: string }> = [
  {
    entrada: "src/app/api/auth/google/start/route.ts",
    porque: "arranca el OAuth de la agencia, y sólo deja entrar a su operador (agencyGuard)",
  },
  {
    entrada: "src/app/api/auth/google/callback/route.ts",
    porque: "guarda el token bajo la organización de la agencia (saveAgencyToken)",
  },
  {
    entrada: "src/app/app/integrations/page.tsx",
    porque: "la pantalla de conexión: muestra el estado del token de la agencia, no datos de un cliente",
  },
  {
    entrada: "src/lib/integrations/property-actions.ts",
    porque: "server action del mapeo: sólo un operador de la agencia apunta una property a un cliente",
  },
];

// ---------------------------------------------------------------------------
// El árbol, leído del disco
// ---------------------------------------------------------------------------

function fuentes(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) salida.push(...fuentes(completo));
    else if (/\.tsx?$/.test(entrada) && !/\.d\.ts$/.test(entrada)) salida.push(completo);
  }
  return salida;
}

const rel = (abs: string) => path.relative(ROOT, abs).replace(/\\/g, "/");
const esTest = (r: string) => r.includes("__tests__") || /\.(test|spec)\.tsx?$/.test(r) || r.startsWith("src/test/");

const archivos = fuentes(SRC)
  .map(rel)
  .filter((r) => !esTest(r));

const arboles = new Map<string, ts.SourceFile>(
  archivos.map((r) => [
    r,
    ts.createSourceFile(r, readFileSync(path.join(ROOT, r), "utf8"), ts.ScriptTarget.Latest, true),
  ])
);

/** `@/x` y `./x` a un archivo de `src`, o `null` si es un paquete. */
function resolver(desde: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = path.join(SRC, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(path.join(ROOT, desde)), especificador);
  else return null;
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidato) && statSync(candidato).isFile()) return rel(candidato);
  }
  return null;
}

/** Un import que se borra al compilar no ejecuta nada: no es un camino. */
function soloTipos(nodo: ts.ImportDeclaration): boolean {
  const clausula = nodo.importClause;
  if (!clausula) return false; // `import "x"` ejecuta x
  if (clausula.isTypeOnly) return true;
  if (clausula.name) return false;
  const nombres = clausula.namedBindings;
  if (!nombres) return false;
  if (ts.isNamespaceImport(nombres)) return false;
  return nombres.elements.length > 0 && nombres.elements.every((e) => e.isTypeOnly);
}

interface Lectura {
  /** Los imports de VALOR de cada archivo, resueltos dentro de `src`. */
  importa: string[];
  /** Cuáles de las variables vigiladas lee el archivo. */
  lee: Set<string>;
  /** Si abre con `"use server"`. */
  usaServidor: boolean;
}

/**
 * Las constantes que valen el literal de una variable vigilada, por archivo:
 * nombre de la constante → nombre de la variable. Primera pasada, para poder
 * ver `env[AGENCY_ORG_ID_ENV]` — en el mismo archivo o importada.
 */
function constantesVigiladas(arbol: ts.SourceFile): { locales: Map<string, string>; exportadas: Map<string, string> } {
  const locales = new Map<string, string>();
  const exportadas = new Map<string, string>();
  for (const sentencia of arbol.statements) {
    if (!ts.isVariableStatement(sentencia)) continue;
    const exporta = sentencia.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    for (const d of sentencia.declarationList.declarations) {
      if (
        ts.isIdentifier(d.name) &&
        d.initializer &&
        (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer)) &&
        VIGILADAS.includes(d.initializer.text)
      ) {
        locales.set(d.name.text, d.initializer.text);
        if (exporta) exportadas.set(d.name.text, d.initializer.text);
      }
    }
  }
  return { locales, exportadas };
}

const constantes = new Map([...arboles].map(([r, a]) => [r, constantesVigiladas(a)]));

function leer(r: string, arbol: ts.SourceFile): Lectura {
  const importa: string[] = [];
  const alias = new Map(constantes.get(r)!.locales);
  const lee = new Set<string>();
  const literal = (n: ts.Node) =>
    (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && VIGILADAS.includes(n.text) ? n.text : null;

  const primera = arbol.statements[0];
  const usaServidor =
    !!primera &&
    ts.isExpressionStatement(primera) &&
    ts.isStringLiteral(primera.expression) &&
    primera.expression.text === "use server";

  // Los imports primero, para saber qué identificadores importados valen el literal.
  for (const sentencia of arbol.statements) {
    if (ts.isImportDeclaration(sentencia) && ts.isStringLiteral(sentencia.moduleSpecifier)) {
      const destino = resolver(r, sentencia.moduleSpecifier.text);
      if (!destino) continue;
      if (!soloTipos(sentencia)) importa.push(destino);
      const exportadas = constantes.get(destino)?.exportadas;
      const nombres = sentencia.importClause?.namedBindings;
      if (exportadas && nombres && ts.isNamedImports(nombres)) {
        for (const e of nombres.elements) {
          const variable = exportadas.get((e.propertyName ?? e.name).text);
          if (variable) alias.set(e.name.text, variable);
        }
      }
    }
    if (
      ts.isExportDeclaration(sentencia) &&
      !sentencia.isTypeOnly &&
      sentencia.moduleSpecifier &&
      ts.isStringLiteral(sentencia.moduleSpecifier)
    ) {
      const destino = resolver(r, sentencia.moduleSpecifier.text);
      if (destino) importa.push(destino);
    }
  }

  const visitar = (nodo: ts.Node): void => {
    // import("x") dinámico: también ejecuta x.
    if (
      ts.isCallExpression(nodo) &&
      nodo.expression.kind === ts.SyntaxKind.ImportKeyword &&
      nodo.arguments[0] &&
      ts.isStringLiteral(nodo.arguments[0])
    ) {
      const destino = resolver(r, nodo.arguments[0].text);
      if (destino) importa.push(destino);
    }
    if (ts.isPropertyAccessExpression(nodo) && VIGILADAS.includes(nodo.name.text)) lee.add(nodo.name.text);
    if (ts.isElementAccessExpression(nodo)) {
      const arg = nodo.argumentExpression;
      const directo = literal(arg);
      if (directo) lee.add(directo);
      if (ts.isIdentifier(arg) && alias.has(arg.text)) lee.add(alias.get(arg.text)!);
    }
    if (ts.isBindingElement(nodo) && ts.isObjectBindingPattern(nodo.parent)) {
      const clave = nodo.propertyName ?? nodo.name;
      if (ts.isIdentifier(clave) && VIGILADAS.includes(clave.text)) lee.add(clave.text);
      if (nodo.propertyName && !ts.isIdentifier(nodo.propertyName)) {
        const directo = literal(nodo.propertyName);
        if (directo) lee.add(directo);
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);

  return { importa, lee, usaServidor };
}

const lecturas = new Map([...arboles].map(([r, a]) => [r, leer(r, a)]));

const lectoresDe = (variable: string) =>
  [...lecturas].filter(([, l]) => l.lee.has(variable)).map(([r]) => r).sort();
const lectores = lectoresDe(VARIABLE);

const entradas = archivos
  .filter(
    (r) =>
      (r.startsWith("src/app/") && /\/(route|page|layout)\.tsx?$/.test(r)) ||
      r === "src/middleware.ts" ||
      lecturas.get(r)!.usaServidor
  )
  .sort();

/** El camino de `desde` a `hasta` por imports de valor, sin pasar por `sacado`. `null` si no hay. */
function camino(desde: string, hasta: string, sacado: string | null): string[] | null {
  const previo = new Map<string, string | null>([[desde, null]]);
  const cola = [desde];
  while (cola.length > 0) {
    const actual = cola.shift()!;
    if (actual === hasta) {
      const salida: string[] = [];
      for (let p: string | null = actual; p !== null; p = previo.get(p) ?? null) salida.unshift(p);
      return salida;
    }
    for (const siguiente of lecturas.get(actual)?.importa ?? []) {
      if (siguiente === sacado || previo.has(siguiente)) continue;
      previo.set(siguiente, actual);
      cola.push(siguiente);
    }
  }
  return null;
}

const conexion = new Set(CONEXION.map((c) => c.entrada));
const deDatos = entradas.filter((e) => !conexion.has(e));

// ---------------------------------------------------------------------------

describe("el inventario se lee del disco, y no está vacío", () => {
  it("encuentra las rutas, las páginas y las server actions", () => {
    // Anti-vacuidad: si el recorrido no encuentra nada, la pared de abajo pasa
    // sobre una lista vacía e informa éxito sin haber mirado.
    expect(entradas.filter((e) => e.endsWith("/route.ts")).length).toBeGreaterThan(15);
    expect(entradas.filter((e) => e.endsWith("/page.tsx")).length).toBeGreaterThan(15);
    expect(entradas.filter((e) => lecturas.get(e)!.usaServidor).length).toBeGreaterThan(0);
  });

  it("distingue un import de tipos de uno que ejecuta", () => {
    // `hydrate.ts` importa de `tokenStore.ts` SÓLO tipos. Si el grafo los
    // contara, la pared vería caminos que no ejecutan nada y habría que llenarla
    // de exenciones falsas — o, al revés, se aprendería a ignorarla.
    expect(lecturas.get("src/lib/integrations/google/hydrate.ts")!.importa).not.toContain(
      "src/lib/integrations/google/tokenStore.ts"
    );
    expect(lecturas.get(PUERTA)!.importa).toContain("src/lib/integrations/google/tokenStore.ts");
  });
});

describe("la variable de la agencia la lee un solo archivo", () => {
  it(`sólo ${LECTOR} lee ${VARIABLE}`, () => {
    // Que `agency.ts` aparezca es también la anti-vacuidad del detector: lee la
    // variable por una constante (`env[AGENCY_ORG_ID_ENV]`), que es la forma
    // más difícil de ver. Si el detector no la viera, vería cero lectores y
    // esto no mediría nada.
    expect(
      lectores,
      `Leer ${VARIABLE} fuera de agency.ts es la forma más corta del fallback: ` +
        `«si el cliente no tiene, usá lo de la agencia». Pedí la organización por ` +
        `resolveAgencyOrgId() desde una ruta de conexión, o el token por ` +
        `servirConLaAgencia() desde una de datos.`
    ).toEqual([LECTOR]);
  });
});

describe("las properties de la agencia no las lee nadie", () => {
  for (const variable of PROPERTIES_DE_LA_AGENCIA) {
    it(`${variable}: cero lectores`, () => {
      expect(
        lectoresDe(variable),
        `${variable} es una property de la AGENCIA. Leerla como valor por defecto ` +
          `para una organización sin mapeo sirve los datos de la agencia en el ` +
          `reporte —o la ficha— de otro. El mapeo vive en integration_properties.`
      ).toEqual([]);
    });
  }
});

describe("ninguna ruta de datos llega a la agencia salvo por la regla del servicio compartido", () => {
  it("la puerta existe y llega a la variable", () => {
    expect(arboles.has(PUERTA), `${PUERTA} no existe`).toBe(true);
    expect(camino(PUERTA, LECTOR, null), "la puerta no llega a agency.ts: la pared no separa nada").not.toBeNull();
  });

  it("hay rutas de datos que llegan a la agencia, y todas pasan por la puerta", () => {
    // Anti-vacuidad: si ninguna entrada de datos llegara a la variable ni
    // siquiera CON la puerta, el resultado de abajo sería verde por no haber
    // camino que cortar — que es lo que pasaría si el grafo dejara de resolver
    // los `@/` imports.
    const llegan = deDatos.filter((e) => camino(e, LECTOR, null) !== null);
    expect(llegan.length, "ninguna ruta de datos llega a la agencia: el grafo no está resolviendo").toBeGreaterThan(1);
    for (const e of llegan) {
      expect(camino(e, PUERTA, null), `${e} llega a la agencia sin pasar por la puerta`).not.toBeNull();
    }
  });

  it("sin la puerta en el medio, ninguna ruta de datos alcanza la variable", () => {
    const fugas = deDatos
      .map((e) => camino(e, LECTOR, PUERTA))
      .filter((c): c is string[] => c !== null)
      .map((c) => c.join(" -> "));

    expect(
      fugas,
      `Estas entradas leen la organización de la agencia por un costado. El token ` +
        `de la agencia se presta SÓLO por servirConLaAgencia(), que exige un mapeo ` +
        `vivo de la organización del recurso. Si es una ruta de conexión, va a ` +
        `CONEXION con su razón.`
    ).toEqual([]);
  });

  it("las exenciones de conexión existen, son entradas y siguen llegando", () => {
    // Una exención que ya no llega a la variable no exime nada y le hace lugar a
    // la próxima sin que se note en el diff.
    const vencidas = CONEXION.filter(
      (c) => !entradas.includes(c.entrada) || camino(c.entrada, LECTOR, PUERTA) === null
    ).map((c) => c.entrada);

    expect(vencidas, "exenta como conexión pero ya no es entrada o no llega a la agencia").toEqual([]);
  });
});
