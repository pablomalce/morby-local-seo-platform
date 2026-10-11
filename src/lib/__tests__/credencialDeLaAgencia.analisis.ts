/**
 * EL ANALIZADOR DE LA PARED DEL TOKEN DE LA AGENCIA
 *
 * Lo usa `credencialDeLaAgencia.test.ts`, dos veces: sobre el árbol real de
 * `src`, leído del disco, y sobre fuentes escritas en memoria que reproducen
 * cada forma conocida de saltarse la pared. La segunda pasada es la que dice que
 * esta primera ve algo. Sin ella, un detector ciego da el mismo verde que un
 * árbol limpio.
 *
 * POR QUÉ CON EL COMPILADOR ENTERO Y NO CON EL PARSER
 *
 * La versión anterior parseaba archivo por archivo y reconocía la variable por
 * su FORMA: un literal pelado, una constante de módulo inicializada con ese
 * literal. Medido el 2026-10-11 en la revisión del PR #118, con la suite entera
 * en verde, pasaban tres variantes:
 *
 *   - `const K = "VULKAN_AGENCY_ORG_ID" as const` (un `AsExpression`, no un
 *     literal);
 *   - la misma constante declarada DENTRO de una función (no es de módulo);
 *   - el mismo código en un `.js` (`allowJs: true`), que el recorrido ni leía.
 *
 * Las tres tienen algo en común que el parser no ve y el verificador de tipos
 * sí: la clave con la que se indexa el entorno tiene TIPO literal
 * `"VULKAN_AGENCY_ORG_ID"`. Así que la pregunta deja de ser «¿se parece a una
 * lectura?» y pasa a ser «¿qué claves puede tener esta lectura del entorno?».
 * Y el mundo es CERRADO: una lectura del entorno cuya clave no se puede saber
 * —un `string` armado en ejecución, un `Object.entries(process.env)`, un
 * `process.env` pasado a algo que no lo tipa como entorno— no se tolera como
 * «probablemente no es la de la agencia». Es una falla de la pared, porque es
 * exactamente por donde pasaría la próxima.
 *
 * LO QUE COSECHA, POR ARCHIVO
 *
 *   importa          los imports de VALOR resueltos dentro del árbol, con la
 *                    misma resolución que usa `tsc` (los `paths` de tsconfig,
 *                    las extensiones, los `index`). Un `import type` se borra al
 *                    compilar y no es un camino;
 *   sinResolver      un `import()` o `require()` cuyo destino no es un literal,
 *                    y todo especificador literal que `tsc` no resuelve a un
 *                    módulo del árbol ni a un paquete: un camino que el grafo no
 *                    puede seguir. El mundo es cerrado también acá (ver abajo);
 *   usa              los símbolos de VALOR exportados por OTRO módulo del árbol
 *                    que este módulo usa, resueltos por el verificador hasta su
 *                    declaración —a través de cualquier reexportación— como
 *                    `ruta#nombre`;
 *   exporta          los nombres que el módulo exporta como valor, también los
 *                    reexportados;
 *   leeEnv           las claves del entorno que lee, con su tipo literal;
 *   envOpaco         las lecturas del entorno de clave desconocida, y los
 *                    `process.env` que se escapan a algo que no es un entorno;
 *   custodia         los nombres de la custodia del token que menciona en
 *                    código (no en comentarios): las RPC de la `0021`, la tabla
 *                    `integration_tokens` y la vista del Vault;
 *   supabaseOpaco    una llamada de Supabase (`rpc`, `from`, `schema`) con un
 *                    nombre que no es literal;
 *   esquemas         los esquemas que pide con `.schema()`.
 *
 * POR QUÉ TAMBIÉN SÍMBOLOS, Y NO SÓLO EL GRAFO DE ARCHIVOS
 *
 * El grafo dice qué MÓDULO llega a la credencial, y la pared exime módulos: la
 * puerta, y los de conexión. Medido el 2026-10-11 en la revisión del #118 con
 * la suite entera en verde: una línea `export { agencyAccessToken } from
 * "./tokenStore"` en la puerta, y cualquier módulo de datos nuevo llegaba al
 * token «por la puerta»; y una server action nueva en `property-actions.ts`
 * —exento entero— pedía el token de la agencia para cualquier property. Las dos
 * pasaban porque la unidad que se medía era el archivo, y lo que falla es el
 * SÍMBOLO (R14). Con `usa` y `exporta` la pared pregunta quién usa
 * `agencyAccessToken`, qué exporta la puerta y qué pieza de la credencial toca
 * cada exención.
 *
 * Y POR QUÉ UN ESPECIFICADOR QUE NO RESUELVE ES UNA FALLA
 *
 * La versión anterior descartaba en silencio todo import que `tsc` no
 * resolvía, igual que uno a un paquete. Medido en la misma revisión: un `.js` de
 * `src` que importaba `../integrations/google/tokenStore.ts?fallback` llegaba al
 * token sin que la pared lo viera, y `next build` lo empaquetaba —webpack se
 * saca el `?query`, `tsc` no—. Ahora un especificador con `?` o `#`, o uno que
 * no resuelve, va a `sinResolver`. Las únicas excepciones están escritas en
 * `RESUELVE_EL_BUNDLER`, con su razón.
 *
 * QUÉ NO VE, Y ESTÁ DICHO
 *
 * Un módulo que se carga por un nombre armado en ejecución sin `import()` ni
 * `require()` (un `eval`, un `new Function`), y un secreto que llegue por la red
 * desde otro servicio sin nombrar ninguna de estas cosas. La pared es sobre el
 * código de este repositorio y la custodia de la `0021`; la frontera de la base
 * la sostienen sus GRANT, que `defects_test.sql` mide.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";

/** Las extensiones que el build de Next compila. `allowJs: true` está en el tsconfig. */
const FUENTE = /\.(?:[cm]?[jt]sx?)$/;
const DECLARACION = /\.d\.[cm]?ts$/;

/** Los nombres de la custodia del token, tal como aparecen en el código que la toca. */
export const NOMBRES_DE_CUSTODIA = [
  "integration_token_secret",
  "refresh_integration_token",
  "store_integration_token",
  "integration_tokens",
  "decrypted_secrets",
] as const;

export interface Lectura {
  importa: string[];
  sinResolver: string[];
  usa: Set<string>;
  exporta: string[];
  leeEnv: Set<string>;
  envOpaco: string[];
  custodia: Set<string>;
  supabaseOpaco: string[];
  esquemas: Set<string>;
}

export interface Analisis {
  /** Todo módulo fuente bajo la raíz, relativo a ella, también los tests. */
  archivos: string[];
  lecturas: Map<string, Lectura>;
}

/** Todo archivo fuente bajo `dir`, recursivo. */
export function fuentesEn(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) salida.push(...fuentesEn(completo));
    else if (FUENTE.test(entrada) && !DECLARACION.test(entrada)) salida.push(completo);
  }
  return salida;
}

/**
 * Qué módulo es un test, y por eso no es producción.
 *
 * Por SEGMENTO exacto, no por subcadena. Medido el 2026-10-11 en la revisión
 * del #118: con `r.includes("__tests__")`, `src/app/api/clics__tests__/route.ts`
 * —que Next sirve como ruta, porque el segmento no empieza con `_`— quedaba
 * fuera de la pared y llamaba a `agencyAccessToken()` con la suite en verde. Un
 * directorio `__tests__` sí empieza con `_`: es una carpeta privada para Next y
 * no se rutea.
 */
export const esTest = (r: string) =>
  /(^|\/)__tests__\//.test(r) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(r) || r.startsWith("src/test/");

/**
 * Especificadores que `tsc` no resuelve y el bundler sí, y que no llegan a
 * código de este repositorio. La lista es cerrada: lo que no está acá y no
 * resuelve es una falla de la pared.
 */
export const RESUELVE_EL_BUNDLER: ReadonlyArray<{ acepta: (especificador: string) => boolean; porque: string }> = [
  {
    acepta: (e) => e.startsWith("node:") && builtinModules.includes(e.slice("node:".length)),
    porque: "un módulo de Node: `@types/node` lo declara como módulo ambiental, no como archivo",
  },
  {
    acepta: (e) => e === "server-only" || e === "client-only",
    porque: "Next los provee desde su copia compilada; no son un paquete de node_modules ni código del repo",
  },
  {
    acepta: (e) => /^\.{1,2}\/[^?#]*\.(css|scss|sass)$/.test(e),
    porque: "una hoja de estilos: la procesa el loader de CSS, no ejecuta JavaScript del repo",
  },
];

/** Las opciones de `tsc`, leídas del `tsconfig.json` de verdad. */
export function opcionesDelProyecto(raiz: string): ts.CompilerOptions {
  const leido = ts.getParsedCommandLineOfConfigFile(
    path.join(raiz, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      },
    }
  );
  if (!leido) throw new Error("no se pudo leer tsconfig.json");
  return { ...leido.options, noEmit: true, incremental: false, allowJs: true, checkJs: false };
}

/** El entorno, como tipo: `NodeJS.ProcessEnv`, con o sin `undefined`. */
function esEntorno(checker: ts.TypeChecker, tipo: ts.Type): boolean {
  const t = checker.getNonNullableType(tipo);
  if (t.isUnion()) return t.types.every((m) => esEntorno(checker, m));
  const simbolo = t.aliasSymbol ?? t.getSymbol();
  return simbolo?.getName() === "ProcessEnv";
}

/** Las claves que puede tomar una expresión, si su tipo las fija. `null` = no se sabe. */
function clavesDe(checker: ts.TypeChecker, nodo: ts.Node): string[] | null {
  const t = checker.getTypeAtLocation(nodo);
  const miembros = t.isUnion() ? t.types : [t];
  const claves: string[] = [];
  for (const m of miembros) {
    if (m.isStringLiteral()) claves.push(m.value);
    else if (m.isNumberLiteral()) claves.push(String(m.value));
    else return null;
  }
  return claves;
}

/** Los textos literales de código: los que viajan, no los comentarios. */
function textoLiteral(nodo: ts.Node): string | null {
  if (
    ts.isStringLiteral(nodo) ||
    ts.isNoSubstitutionTemplateLiteral(nodo) ||
    ts.isTemplateHead(nodo) ||
    ts.isTemplateMiddle(nodo) ||
    ts.isTemplateTail(nodo)
  ) {
    return nodo.text;
  }
  return null;
}

/** Un import que se borra al compilar no ejecuta nada. */
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

/** Un nodo que es el NOMBRE de algo que se declara, no un uso. */
function esNombreDeclarado(nodo: ts.Node): boolean {
  const padre = nodo.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
  if (!padre) return false;
  if (ts.isShorthandPropertyAssignment(padre)) return false; // `{ env }` es un uso
  if (ts.isPropertyAccessExpression(padre)) return padre.name === nodo;
  if (ts.isQualifiedName(padre)) return true;
  return padre.name === nodo || padre.propertyName === nodo;
}

/**
 * Analiza `archivos` (absolutos) con un programa de `tsc`.
 *
 * `host` es para las fuentes escritas en memoria; sin él, el disco.
 */
export function analizar(
  raiz: string,
  archivosAbs: string[],
  opciones: ts.CompilerOptions,
  host?: ts.CompilerHost
): Analisis {
  const programa = ts.createProgram({ rootNames: archivosAbs, options: opciones, host });
  const checker = programa.getTypeChecker();
  const hostDeResolucion: ts.ModuleResolutionHost = host ?? ts.sys;
  const rel = (abs: string) => path.relative(raiz, abs).replace(/\\/g, "/");
  const enArbol = new Set(archivosAbs.map((a) => path.resolve(a)));

  // Adónde lleva un especificador LITERAL: un módulo del árbol, algo de afuera
  // (un paquete, un JSON, un asset que el bundler procesa), o ninguna de las
  // dos, y entonces es una falla con su motivo. Ver el encabezado: el mundo es
  // cerrado.
  type Destino = { arbol: string } | { afuera: true } | { falla: string };
  const resolver = (desde: string, especificador: string): Destino => {
    if (/[?#]/.test(especificador)) {
      return { falla: "lleva ? o #: el bundler lo resuelve sacándoselo y tsc no" };
    }
    const r = ts.resolveModuleName(especificador, desde, opciones, hostDeResolucion).resolvedModule;
    if (!r) {
      if (RESUELVE_EL_BUNDLER.some((e) => e.acepta(especificador))) return { afuera: true };
      return { falla: "tsc no lo resuelve" };
    }
    const destino = path.resolve(r.resolvedFileName);
    if (enArbol.has(destino)) return { arbol: rel(destino) };
    if (r.isExternalLibraryImport || destino.includes(`${path.sep}node_modules${path.sep}`)) return { afuera: true };
    if (/\.json$/.test(destino)) return { afuera: true };
    // Resuelve a un archivo del repo que la pared no analiza (una declaración
    // `.d.ts` al lado de un `.js`, por ejemplo): en ejecución carga otra cosa.
    return { falla: `resuelve a ${rel(destino)}, que la pared no analiza` };
  };

  // Lo que exporta cada módulo del árbol, resuelto hasta la declaración: un
  // símbolo usado cuenta si es uno de éstos (no una propiedad de un objeto que
  // vino de otro módulo).
  const resolverAlias = (s: ts.Symbol): ts.Symbol => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
  const exportado = new Map<ts.Symbol, string>();

  // ¿Este nodo ES un entorno? Preguntarle el tipo a cada expresión del árbol es
  // verificarlo entero dos veces (medido: 12 s sobre 30 mil identificadores). Las
  // hojas que pueden valer un entorno son identificadores y accesos a una
  // propiedad, y su tipo es el de su SÍMBOLO, que se calcula una vez. Lo que
  // vale un entorno sin ser una hoja —un `a ?? process.env`, un paréntesis— se
  // alcanza subiendo desde la hoja, en `usoDelEntorno`. Lo que vuelve de una
  // llamada no: ver ahí.
  const porSimbolo = new Map<ts.Symbol, boolean>();
  const simboloEsEntorno = (s: ts.Symbol): boolean => {
    const real = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
    let es = porSimbolo.get(real);
    if (es === undefined) {
      es = esEntorno(checker, checker.getTypeOfSymbol(real));
      porSimbolo.set(real, es);
    }
    return es;
  };
  const esUnEntorno = (nodo: ts.Node): boolean => {
    if (ts.isIdentifier(nodo)) {
      if (esNombreDeclarado(nodo)) return false;
      const s = checker.getSymbolAtLocation(nodo);
      return !!s && simboloEsEntorno(s);
    }
    if (ts.isPropertyAccessExpression(nodo)) {
      const s = checker.getSymbolAtLocation(nodo.name);
      return !!s && simboloEsEntorno(s);
    }
    if (ts.isElementAccessExpression(nodo)) {
      return esEntorno(checker, checker.getTypeAtLocation(nodo));
    }
    return false;
  };

  const lecturas = new Map<string, Lectura>();

  // Las raíces, y además todo lo que ellas importan dentro de la raíz: un
  // módulo en una carpeta de tests que la producción importa es producción.
  const cargados = programa
    .getSourceFiles()
    .map((sf) => path.resolve(sf.fileName))
    .filter((f) => f.startsWith(raiz + path.sep) && !f.includes(`${path.sep}node_modules${path.sep}`) && !DECLARACION.test(f));
  for (const f of cargados) enArbol.add(f);

  // Primero lo que exporta cada uno: el uso de abajo se compara contra esto.
  const exportaDe = new Map<string, string[]>();
  for (const abs of cargados) {
    const sf = programa.getSourceFile(abs);
    const modulo = sf && checker.getSymbolAtLocation(sf);
    const nombres: string[] = [];
    if (modulo) {
      for (const e of checker.getExportsOfModule(modulo)) {
        const destino = resolverAlias(e);
        if (!(destino.flags & ts.SymbolFlags.Value)) continue;
        nombres.push(e.getName());
        const decl = destino.valueDeclaration ?? destino.declarations?.[0];
        if (!decl) continue;
        const archivo = path.resolve(decl.getSourceFile().fileName);
        if (enArbol.has(archivo) && !exportado.has(destino)) exportado.set(destino, `${rel(archivo)}#${destino.getName()}`);
      }
    }
    exportaDe.set(abs, nombres.sort());
  }

  for (const abs of cargados) {
    const sf = programa.getSourceFile(abs);
    if (!sf) throw new Error(`el programa no cargó ${abs}`);
    const lectura: Lectura = {
      importa: [],
      sinResolver: [],
      usa: new Set(),
      exporta: [],
      leeEnv: new Set(),
      envOpaco: [],
      custodia: new Set(),
      supabaseOpaco: [],
      esquemas: new Set(),
    };
    const donde = (n: ts.Node) => `${rel(abs)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const seguir = (n: ts.Node, especificador: string) => {
      const d = resolver(abs, especificador);
      if ("arbol" in d) lectura.importa.push(d.arbol);
      else if ("falla" in d) lectura.sinResolver.push(`${donde(n)} ${JSON.stringify(especificador)}: ${d.falla}`);
    };
    const tipoEntorno = (n: ts.Node) => esEntorno(checker, checker.getTypeAtLocation(n));
    const vistos = new Set<ts.Node>();

    const leerClaves = (nodoClave: ts.Node, sitio: ts.Node) => {
      const claves = clavesDe(checker, nodoClave);
      if (claves === null) lectura.envOpaco.push(`${donde(sitio)} clave de tipo no literal: ${nodoClave.getText(sf)}`);
      else for (const c of claves) lectura.leeEnv.add(c);
    };

    // Un `process.env` (o algo tipado como entorno) en esta posición: ¿qué lee, o adónde va?
    const usoDelEntorno = (n: ts.Node): void => {
      if (vistos.has(n)) return;
      vistos.add(n);
      const p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        lectura.leeEnv.add(p.name.text);
        return;
      }
      if (ts.isElementAccessExpression(p) && p.expression === n) {
        leerClaves(p.argumentExpression, p);
        return;
      }
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InKeyword && p.right === n) {
        leerClaves(p.left, p);
        return;
      }
      if (ts.isVariableDeclaration(p) && p.initializer === n) {
        if (ts.isObjectBindingPattern(p.name)) {
          for (const e of p.name.elements) {
            if (e.dotDotDotToken) {
              lectura.envOpaco.push(`${donde(e)} resto de un destructuring del entorno`);
              continue;
            }
            const clave = e.propertyName ?? e.name;
            if (ts.isIdentifier(clave) || ts.isStringLiteral(clave) || ts.isNumericLiteral(clave)) {
              lectura.leeEnv.add(clave.text);
            } else if (ts.isComputedPropertyName(clave)) {
              leerClaves(clave.expression, e);
            } else {
              lectura.envOpaco.push(`${donde(e)} clave de destructuring desconocida`);
            }
          }
          return;
        }
        if (ts.isIdentifier(p.name) && tipoEntorno(p.name)) return; // sigue siendo un entorno: se analizan sus usos
        lectura.envOpaco.push(`${donde(p)} el entorno se guarda en algo que no es un entorno`);
        return;
      }
      if (ts.isParameter(p) && p.initializer === n) {
        if (ts.isIdentifier(p.name) && tipoEntorno(p.name)) return;
        lectura.envOpaco.push(`${donde(p)} el entorno es el valor por defecto de algo que no es un entorno`);
        return;
      }
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (p.left === n) return; // se le asigna: no lee nada
        if (tipoEntorno(p.left)) return;
        lectura.envOpaco.push(`${donde(p)} el entorno se asigna a algo que no es un entorno`);
        return;
      }
      if (ts.isConditionalExpression(p) && p.condition === n) return;
      if (ts.isPrefixUnaryExpression(p) || ts.isExpressionStatement(p) || ts.isTypeOfExpression(p)) return;
      if (ts.isIfStatement(p) && p.expression === n) return;
      if (
        (ts.isParenthesizedExpression(p) ||
          ts.isBinaryExpression(p) ||
          ts.isConditionalExpression(p) ||
          ts.isNonNullExpression(p) ||
          ts.isAwaitExpression(p) ||
          ts.isAsExpression(p) ||
          ts.isSatisfiesExpression(p) ||
          ts.isTypeAssertionExpression(p)) &&
        tipoEntorno(p)
      ) {
        usoDelEntorno(p); // el padre sigue siendo un entorno: lo que importa es adónde va él
        return;
      }
      // Ninguna función devuelve el entorno: lo que vuelve de una llamada no se
      // sigue, así que devolverlo es perderlo de vista.
      if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === n)) {
        lectura.envOpaco.push(`${donde(n)} una función devuelve el entorno`);
        return;
      }
      // Argumento, retorno, propiedad de un objeto: vale si el lugar adonde va
      // ESPERA un entorno. Un `Object.entries(process.env)` no lo espera.
      let contextual: ts.Type | undefined;
      if (ts.isShorthandPropertyAssignment(p)) {
        const delObjeto = checker.getContextualType(p.parent as ts.ObjectLiteralExpression);
        const prop = delObjeto?.getProperty(p.name.text);
        contextual = prop ? checker.getTypeOfSymbolAtLocation(prop, p) : undefined;
      } else if (ts.isExpression(n)) {
        contextual = checker.getContextualType(n);
      }
      if (contextual && esEntorno(checker, contextual)) return;
      lectura.envOpaco.push(`${donde(n)} el entorno se escapa: ${p.getText(sf).slice(0, 80)}`);
    };

    const visitar = (nodo: ts.Node): void => {
      // Lo que no ejecuta: un tipo, una interfaz, un alias de tipo, una
      // declaración ambiental. No hay lectura del entorno ni import adentro.
      if (
        ts.isTypeNode(nodo) ||
        ts.isInterfaceDeclaration(nodo) ||
        ts.isTypeAliasDeclaration(nodo) ||
        (ts.canHaveModifiers(nodo) && ts.getModifiers(nodo)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword))
      ) {
        return;
      }
      // Los imports de valor.
      if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier) && !soloTipos(nodo)) {
        seguir(nodo, nodo.moduleSpecifier.text);
      }
      if (ts.isImportDeclaration(nodo)) return;
      if (
        ts.isExportDeclaration(nodo) &&
        !nodo.isTypeOnly &&
        nodo.moduleSpecifier &&
        ts.isStringLiteral(nodo.moduleSpecifier)
      ) {
        seguir(nodo, nodo.moduleSpecifier.text);
      }
      if (
        ts.isImportEqualsDeclaration(nodo) &&
        !nodo.isTypeOnly &&
        ts.isExternalModuleReference(nodo.moduleReference) &&
        ts.isStringLiteral(nodo.moduleReference.expression)
      ) {
        seguir(nodo, nodo.moduleReference.expression.text);
      }
      // `import("x")` y `require("x")`: también ejecutan x. Con un destino que
      // no es literal, el grafo no lo puede seguir, y eso es una falla.
      if (ts.isCallExpression(nodo)) {
        const esImport = nodo.expression.kind === ts.SyntaxKind.ImportKeyword;
        const esRequire = ts.isIdentifier(nodo.expression) && nodo.expression.text === "require";
        if (esImport || esRequire) {
          const arg = nodo.arguments[0];
          if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
            seguir(nodo, arg.text);
          } else {
            lectura.sinResolver.push(`${donde(nodo)} ${nodo.getText(sf).slice(0, 80)}`);
          }
        }
        // Las llamadas de Supabase que nombran algo de la base.
        const callee = nodo.expression;
        const metodo = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isElementAccessExpression(callee)
            ? textoLiteral(callee.argumentExpression)
            : null;
        if (metodo === "rpc" || metodo === "from" || metodo === "schema") {
          const declaracion = checker.getResolvedSignature(nodo)?.getDeclaration();
          const receptor = checker.getTypeAtLocation((callee as ts.PropertyAccessExpression).expression);
          const deSupabase =
            (declaracion && /[\\/]@supabase[\\/]/.test(declaracion.getSourceFile().fileName)) ||
            (receptor.flags & ts.TypeFlags.Any) !== 0;
          if (deSupabase && nodo.arguments[0]) {
            const nombres = clavesDe(checker, nodo.arguments[0]);
            if (nombres === null) {
              lectura.supabaseOpaco.push(`${donde(nodo)} .${metodo}(${nodo.arguments[0].getText(sf)})`);
            } else if (metodo === "schema") {
              for (const n of nombres) lectura.esquemas.add(n);
            } else {
              for (const n of nombres) {
                for (const c of NOMBRES_DE_CUSTODIA) if (n.includes(c)) lectura.custodia.add(c);
              }
            }
          }
        }
      }
      // La custodia nombrada en un texto de código: una URL de PostgREST armada
      // a mano, un nombre de RPC pasado por otro lado.
      const texto = textoLiteral(nodo);
      if (texto !== null) {
        for (const c of NOMBRES_DE_CUSTODIA) if (texto.includes(c)) lectura.custodia.add(c);
      }
      // Los símbolos de otro módulo del árbol que este usa. Por el verificador y
      // hasta la declaración: un `import { x } from "./puerta"` que la puerta
      // reexporta de `tokenStore.ts` es un uso de `tokenStore.ts#x`.
      if (ts.isIdentifier(nodo)) {
        const padre = nodo.parent;
        let s =
          padre && ts.isShorthandPropertyAssignment(padre) && padre.name === nodo
            ? checker.getShorthandAssignmentValueSymbol(padre)
            : checker.getSymbolAtLocation(nodo);
        if (s) {
          s = resolverAlias(s);
          const clave = exportado.get(s);
          if (clave && !clave.startsWith(`${rel(abs)}#`)) lectura.usa.add(clave);
        }
      }
      // El entorno. Ver `esUnEntorno`: por símbolo, no por expresión.
      if (esUnEntorno(nodo)) usoDelEntorno(nodo);
      ts.forEachChild(nodo, visitar);
    };
    visitar(sf);
    lectura.exporta = exportaDe.get(abs) ?? [];
    lecturas.set(rel(abs), lectura);
  }

  return { archivos: cargados.map(rel).sort(), lecturas };
}

/** El camino de `desde` a alguno de `hasta` por imports de valor, sin pasar por `sacado`. */
export function camino(
  lecturas: Map<string, Lectura>,
  desde: string,
  hasta: ReadonlySet<string>,
  sacado: string | null
): string[] | null {
  const previo = new Map<string, string | null>([[desde, null]]);
  const cola = [desde];
  while (cola.length > 0) {
    const actual = cola.shift()!;
    if (hasta.has(actual) && actual !== desde) {
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

/** Un módulo de CONEXIÓN y las piezas de la credencial que puede usar, exactas. */
export interface Exencion {
  modulo: string;
  /** `ruta#nombre` de cada símbolo de la superficie de la credencial que usa. */
  usa: readonly string[];
}

/** Lo que una política declara: quién puede leer qué, y quién está exento de la pared. */
export interface Politica {
  /** La variable de la agencia y su único lector. */
  variable: string;
  lector: string;
  /** Variables que no lee nadie. */
  nadieLee: readonly string[];
  /** La puerta: el único camino de un módulo de datos a la credencial. */
  puerta: string;
  /** Lo que la puerta exporta como valor, exacto: su regla y nada más. */
  exportaLaPuerta: readonly string[];
  /** Los símbolos que PRODUCEN el token (`ruta#nombre`): sólo la puerta los usa. */
  productoresDelToken: readonly string[];
  /** Quién puede nombrar cada pieza de la custodia. Una pieza sin dueños no la nombra nadie. */
  custodia: Readonly<Record<(typeof NOMBRES_DE_CUSTODIA)[number], readonly string[]>>;
  /**
   * Los módulos de CONEXIÓN: pueden llegar a la credencial sin pasar por la
   * puerta, y SÓLO por los símbolos que declaran. Un módulo exento entero
   * —«este archivo puede»— deja entrar cualquier export nuevo del archivo.
   */
  conexion: readonly Exencion[];
}

export interface Veredicto {
  /** Los módulos sujetos a la pared: los de producción, y lo que ellos importen. */
  produccion: string[];
  lectoresDe: (variable: string) => string[];
  /** Pieza de custodia → quién la nombra. */
  custodios: Record<string, string[]>;
  /** Las credenciales: el lector de la variable y los custodios declarados. */
  sumideros: Set<string>;
  /** Lecturas del entorno de clave desconocida, en producción. */
  envOpaco: string[];
  supabaseOpaco: string[];
  sinResolver: string[];
  esquemas: string[];
  /** Los módulos que llegan a una credencial SIN la puerta y no están exentos. */
  fugas: string[];
  /** Las exenciones que ya no llegan a nada, o que no existen. */
  vencidas: string[];
  /** Los módulos que llegan a una credencial sólo por la puerta. */
  porLaPuerta: string[];
  /** Quién usa cada productor del token, en producción, fuera del módulo que lo declara. */
  usosDelToken: Record<string, string[]>;
  /** Lo que la puerta exporta como valor, medido. */
  exportaLaPuerta: string[];
  /**
   * Los símbolos de la superficie de la credencial —lo que exportan el lector,
   * los custodios, la puerta y los módulos de conexión— que usa cada módulo de
   * conexión, medidos.
   */
  conexionUsa: Record<string, string[]>;
}

export function juzgar(a: Analisis, politica: Politica): Veredicto {
  const noTests = a.archivos.filter((r) => !esTest(r));
  // Un módulo en una carpeta de tests que la producción importa ES producción.
  const produccion = new Set(noTests);
  const cola = [...noTests];
  while (cola.length > 0) {
    for (const d of a.lecturas.get(cola.shift()!)?.importa ?? []) {
      if (!produccion.has(d)) {
        produccion.add(d);
        cola.push(d);
      }
    }
  }
  const prod = [...produccion].sort();
  const de = (r: string) => a.lecturas.get(r)!;

  const lectoresDe = (variable: string) => prod.filter((r) => de(r).leeEnv.has(variable));
  const custodios: Record<string, string[]> = {};
  for (const c of NOMBRES_DE_CUSTODIA) custodios[c] = prod.filter((r) => de(r).custodia.has(c));

  // Las credenciales: lo declarado Y lo medido. Un módulo que lee la variable o
  // nombra la custodia sin estar autorizado ya pone en rojo su propia regla; lo
  // que esto agrega es que quien LO importe también es una fuga, aunque la
  // lectura viva un archivo más abajo.
  const sumideros = new Set<string>([
    politica.lector,
    ...Object.values(politica.custodia).flat(),
    ...lectoresDe(politica.variable),
    ...Object.values(custodios).flat(),
  ]);
  const modulosDeConexion = politica.conexion.map((c) => c.modulo);
  const conexion = new Set(modulosDeConexion);

  const fugas: string[] = [];
  const porLaPuerta: string[] = [];
  for (const r of prod) {
    if (sumideros.has(r) || r === politica.puerta) continue;
    const sin = camino(a.lecturas, r, sumideros, politica.puerta);
    if (sin && !conexion.has(r)) fugas.push(sin.join(" -> "));
    if (!sin && camino(a.lecturas, r, sumideros, null)) porLaPuerta.push(r);
  }

  const vencidas = modulosDeConexion.filter(
    (c) => !produccion.has(c) || sumideros.has(c) || camino(a.lecturas, c, sumideros, politica.puerta) === null
  );

  // Por símbolo (R14): lo que el grafo de archivos no distingue.
  const usosDelToken: Record<string, string[]> = {};
  for (const productor of politica.productoresDelToken) {
    usosDelToken[productor] = prod.filter((r) => de(r).usa.has(productor));
  }
  const superficie = new Set([...sumideros, politica.puerta, ...modulosDeConexion]);
  const enLaSuperficie = (simbolo: string) => superficie.has(simbolo.slice(0, simbolo.lastIndexOf("#")));
  const conexionUsa: Record<string, string[]> = {};
  for (const c of modulosDeConexion) {
    conexionUsa[c] = a.lecturas.has(c) ? [...de(c).usa].filter(enLaSuperficie).sort() : [];
  }

  return {
    produccion: prod,
    lectoresDe,
    custodios,
    sumideros,
    envOpaco: prod.flatMap((r) => de(r).envOpaco),
    supabaseOpaco: prod.flatMap((r) => de(r).supabaseOpaco),
    sinResolver: prod.flatMap((r) => de(r).sinResolver),
    esquemas: [...new Set(prod.flatMap((r) => [...de(r).esquemas]))].sort(),
    fugas,
    vencidas,
    porLaPuerta,
    usosDelToken,
    exportaLaPuerta: a.lecturas.get(politica.puerta)?.exporta ?? [],
    conexionUsa,
  };
}

/** Un host de compilación que sirve `virtuales` desde memoria y el resto del disco. */
export function hostEnMemoria(opciones: ts.CompilerOptions, virtuales: Map<string, string>): ts.CompilerHost {
  const base = ts.createCompilerHost(opciones, true);
  const resolver = (f: string) => path.resolve(f);
  return {
    ...base,
    fileExists: (f) => virtuales.has(resolver(f)) || base.fileExists(f),
    readFile: (f) => virtuales.get(resolver(f)) ?? base.readFile(f),
    directoryExists: (d) =>
      [...virtuales.keys()].some((v) => v.startsWith(resolver(d) + path.sep)) ||
      (base.directoryExists ? base.directoryExists(d) : existsSync(d)),
    getSourceFile: (f, idioma, onError, crear) => {
      const texto = virtuales.get(resolver(f));
      if (texto !== undefined) return ts.createSourceFile(f, texto, idioma, true);
      return base.getSourceFile(f, idioma, onError, crear);
    },
  };
}
