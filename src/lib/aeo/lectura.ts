/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que no sepamos si el sitio de un cliente deja entrar a las inteligencias
 * artificiales.
 *
 * Es la mitad más barata del posicionamiento en motores de respuesta y la que
 * más rompe: el fallo más común es **bloquear a los rastreadores de IA** en el
 * `robots.txt` o en el CDN, y el segundo es que el contenido necesite JavaScript
 * para existir — los rastreadores no lo ejecutan, así que la página les llega
 * vacía.
 *
 * Los dos son binarios y se miden con una petición HTTP. Por eso van primero, y
 * no la cuota de voz en IA, que es lo que más suena y lo que más cuesta.
 *
 * ES PURO A PROPÓSITO
 *
 * Recibe texto y devuelve hechos. Quien hace las peticiones es la ruta; acá se
 * puede probar cada regla contra un `robots.txt` escrito a mano, que es la única
 * manera de saber que la interpretación es la correcta y no la que nos conviene.
 */
import {
  CLASES_DE_SCHEMA_ORG,
  SUBTIPOS_DE_LOCAL_BUSINESS,
  SUBTIPOS_DE_ORGANIZATION,
} from "./vocabularioSchemaOrg";

/**
 * Los agentes que importan hoy. Se guardan en minúscula porque el nombre del
 * agente en `robots.txt` es insensible a mayúsculas, y así se comparan.
 */
export const AGENTES_IA = [
  "gptbot",
  "claudebot",
  "perplexitybot",
  "google-extended",
  "ccbot",
] as const;

export type AgenteIA = (typeof AGENTES_IA)[number];

/**
 * Los topes del `robots.txt`. Lo escribe el sitio auditado —un tercero— y la
 * ruta lo lee en el servidor: sin topes, un archivo armado para eso decide
 * cuánto trabajo hace la función.
 *
 * Coincidir una regla es LINEAL en el largo de la ruta y del patrón
 * (`coincide`), así que lo que queda por acotar es cuántas veces se hace y
 * con qué: un patrón kilométrico, o miles de reglas para el mismo agente —y
 * la suma de todo, con `PRESUPUESTO_DE_COINCIDENCIA`, porque la ruta también
 * la elige el sitio—. Pasado cualquiera, lo que ese grupo declara NO SE MIDE —`null`,
 * «no medido» en la auditoría—. Ignorar la regla podía volver un `Disallow` un
 * permiso, y truncarla, otro patrón: los dos son verdes inventados.
 *
 * Escritos a mano y en un solo lugar: son un juicio, no una medición. Un
 * patrón real mide decenas de caracteres; un `robots.txt` real grande, cientos
 * de reglas por grupo.
 */
export const MAX_LARGO_DE_PATRON = 2_048;
export const MAX_REGLAS_POR_GRUPO = 5_000;

/**
 * Una regla de `robots.txt`, ya preparada para coincidir: el patrón se parte
 * en tramos y se mide UNA vez, al parsear, y no una vez por agente y por regla.
 */
interface Regla {
  permite: boolean;
  /** El largo del patrón en octetos: el que RFC 9309 compara para «gana la más larga». */
  largo: number;
  /** Los tramos literales entre comodines `*`. Siempre al menos uno. */
  tramos: string[];
  /** Termina en `$`: el último tramo tiene que llegar al final de la ruta. */
  anclado: boolean;
}

interface Grupo {
  agentes: string[];
  reglas: Regla[];
  /** Por qué este grupo no se puede evaluar, si pasó un tope. */
  fueraDeTope: string | null;
}

/** Uno por módulo: antes se creaba uno por regla y por agente. */
const CODIFICADOR = new TextEncoder();

function preparar(patron: string, permite: boolean): Regla {
  const anclado = patron.endsWith("$");
  const cuerpo = anclado ? patron.slice(0, -1) : patron;
  return { permite, largo: CODIFICADOR.encode(patron).length, tramos: cuerpo.split("*"), anclado };
}

/**
 * Parte un `robots.txt` en grupos.
 *
 * Un grupo son varios `User-agent` seguidos y las reglas que los siguen. Es la
 * forma que el estándar define, y la que hace que `User-agent: *` seguido de
 * `User-agent: GPTBot` compartan las mismas reglas — un detalle que, leído mal,
 * hace decir «bloqueado» sobre un sitio abierto.
 *
 * Un `Disallow:` o `Allow:` VACÍO no se guarda: no coincide con nada. Es la
 * manera estándar de decir «pasá», y tratarlo como prefijo vacío bloquearía el
 * sitio entero — el error que hace informar «bloqueado» sobre un sitio abierto.
 */
function parsear(robots: string): Grupo[] {
  const grupos: Grupo[] = [];
  let actual: Grupo | null = null;
  let ultimaFueAgente = false;

  for (const cruda of robots.split("\n")) {
    const linea = cruda.split("#")[0].trim();
    if (!linea) continue;

    const corte = linea.indexOf(":");
    if (corte < 0) continue;

    const campo = linea.slice(0, corte).trim().toLowerCase();
    const valor = linea.slice(corte + 1).trim();

    if (campo === "user-agent") {
      if (!actual || !ultimaFueAgente) {
        actual = { agentes: [], reglas: [], fueraDeTope: null };
        grupos.push(actual);
      }
      actual.agentes.push(valor.toLowerCase());
      ultimaFueAgente = true;
      continue;
    }

    if (!actual) continue;
    ultimaFueAgente = false;

    if (campo !== "disallow" && campo !== "allow") continue;
    if (valor === "" || actual.fueraDeTope) continue;
    if (valor.length > MAX_LARGO_DE_PATRON) {
      actual.fueraDeTope = `una regla de ${valor.length} caracteres, y el tope es ${MAX_LARGO_DE_PATRON}`;
      actual.reglas = [];
      continue;
    }
    if (actual.reglas.length >= MAX_REGLAS_POR_GRUPO) {
      actual.fueraDeTope = `más de ${MAX_REGLAS_POR_GRUPO} reglas en un grupo`;
      actual.reglas = [];
      continue;
    }
    actual.reglas.push(preparar(valor, campo === "allow"));
  }

  return grupos;
}

/**
 * Si una ruta cae bajo una regla de `robots.txt`, con la coincidencia de RFC
 * 9309 (§2.2.3): `*` es cualquier secuencia de caracteres, un `$` al final
 * ancla el fin de la ruta, y todo lo demás se compara literal desde el
 * principio.
 *
 * SIN `RegExp`, A PROPÓSITO (REDOS). Antes cada `*` se traducía a `.*` y la
 * expresión hacía backtracking: MEDIDO en Node 26, `/*a*a*a*a*a*b` contra «/»
 * y 100 «a» tardaba 15 s, y con 30 comodines no terminaba — con un patrón que
 * escribe el sitio auditado, en el servidor. Ahora cada tramo literal se
 * busca con `indexOf` DESDE donde terminó el anterior, sin volver atrás: tomar
 * la PRIMERA aparición de cada tramo deja el mayor resto posible para los que
 * siguen, así que si esa no alcanza, ninguna alcanza. El último, si está
 * anclado, tiene que ser el final de la ruta y empezar después de lo ya
 * consumido.
 *
 * Antes de la `RegExp` esto era `startsWith` (GATE-4): `Disallow: /*` no
 * bloqueaba ni la raíz, y `Disallow: /aeo-control$` no bloqueaba `/aeo-control`.
 */
function coincide(regla: Regla, ruta: string, presupuesto: { restante: number }): boolean | "presupuesto" {
  const { tramos, anclado } = regla;
  const primero = tramos[0];
  // Lo que cada paso puede recorrer, cobrado ANTES de recorrerlo: el primer
  // tramo se compara en su lugar; los demás barren, como mucho, lo que queda
  // de la ruta y lo que queda del patrón.
  presupuesto.restante -= primero.length + 1;
  if (presupuesto.restante < 0) return "presupuesto";
  if (!ruta.startsWith(primero)) return false;
  if (tramos.length === 1) return !anclado || ruta.length === primero.length;
  presupuesto.restante -= ruta.length - primero.length + regla.largo;
  if (presupuesto.restante < 0) return "presupuesto";

  let desde = primero.length;
  const ultimo = tramos.length - 1;
  for (let i = 1; i < ultimo; i++) {
    const tramo = tramos[i];
    if (tramo === "") continue;
    const en = ruta.indexOf(tramo, desde);
    if (en < 0) return false;
    desde = en + tramo.length;
  }
  const fin = tramos[ultimo];
  if (anclado) return ruta.length - fin.length >= desde && ruta.endsWith(fin);
  return fin === "" || ruta.indexOf(fin, desde) >= 0;
}

/** Lo que un `robots.txt` le declara a un agente para una ruta: entra, no entra, o no se sabe y por qué. */
type Decision = { puede: boolean } | { puede: null; fueraDeTope: string };

/**
 * Cuánto trabajo puede costar decidir el acceso de los cinco agentes, en
 * caracteres: cada regla cobra lo que como mucho recorre `coincide` —su
 * primer tramo y, si la ruta empieza con él, el resto de la ruta y del
 * patrón—.
 *
 * Los dos topes de arriba no alcanzan solos, porque la RUTA también la elige
 * el sitio (es la del último salto de la portada, y un `Location` puede medir
 * 16 KB). MEDIDO con vitest en esta Mac: 5 grupos propios de 5 000 reglas
 * `/*ab<n>` contra una ruta de 2 000 «a» tardaron 0,4 s, y contra 16 000, más
 * de 3 s — dentro de los topes. Con el presupuesto, un `robots.txt` real
 * (cientos de reglas, rutas de decenas de caracteres) gasta decenas de miles;
 * el que lo agota deja a los agentes que faltan en «no medido».
 */
export const PRESUPUESTO_DE_COINCIDENCIA = 10_000_000;

/**
 * Los grupos que gobiernan a un agente. Gana el grupo MÁS ESPECÍFICO: si el
 * agente está nombrado, sus reglas mandan y las de `*` no se miran. Es lo que
 * dice el estándar, y lo contrario haría que un `Disallow: /` general se
 * leyera como bloqueo aunque el sitio permita al agente explícitamente. Varios
 * grupos para el mismo agente se FUSIONAN (RFC 9309 §2.2.1).
 */
function aplicablesA(grupos: Grupo[], agente: string): Grupo[] {
  const nombre = agente.toLowerCase();
  const propio = grupos.filter((g) => g.agentes.includes(nombre));
  return propio.length > 0 ? propio : grupos.filter((g) => g.agentes.includes("*"));
}

/**
 * Si los grupos `aplicables` dejan entrar a `ruta`.
 *
 * Gana la regla MÁS LARGA que coincide —la más específica, en octetos del
 * patrón— y, a igual largo, `Allow` (RFC 9309 §2.2.2). Antes ganaba cualquier
 * `Allow` que coincidiera, y con `Allow: /` y `Disallow: /aeo-control` la
 * página de control salía abierta (GATE-4).
 */
function decidir(aplicables: Grupo[], ruta: string, presupuesto: { restante: number }): Decision {
  // RFC 9309 §2.2.2: `/robots.txt` se puede leer siempre.
  if (ruta === "/robots.txt") return { puede: true };

  // Sin reglas para nadie, `robots.txt` permite. La ausencia de una prohibición
  // NO es una prohibición.
  if (aplicables.length === 0) return { puede: true };

  const excedido = aplicables.find((g) => g.fueraDeTope !== null);
  if (excedido?.fueraDeTope) return { puede: null, fueraDeTope: excedido.fueraDeTope };
  // El tope de reglas cuenta el grupo FUSIONADO: dos grupos de `*` que no lo
  // pasan solos lo pasan juntos.
  const total = aplicables.reduce((n, g) => n + g.reglas.length, 0);
  if (total > MAX_REGLAS_POR_GRUPO) {
    return { puede: null, fueraDeTope: `${total} reglas para el mismo agente, y el tope es ${MAX_REGLAS_POR_GRUPO}` };
  }

  let gana: { largo: number; permite: boolean } | null = null;
  for (const g of aplicables) {
    for (const regla of g.reglas) {
      const { largo, permite } = regla;
      // Una regla que ya no puede ganar no se compara, ni cobra.
      if (gana && (largo < gana.largo || (largo === gana.largo && (!permite || gana.permite)))) continue;
      const r = coincide(regla, ruta, presupuesto);
      if (r === "presupuesto") {
        return {
          puede: null,
          fueraDeTope: `comparar ${total} reglas contra una ruta de ${ruta.length} caracteres pasa el presupuesto de ${PRESUPUESTO_DE_COINCIDENCIA}`,
        };
      }
      if (r) gana = { largo, permite };
    }
  }
  // Ninguna regla coincide: se permite.
  return { puede: gana?.permite ?? true };
}

/**
 * Si un agente puede entrar a una ruta. `null` es «no se sabe»: el grupo que
 * lo gobierna pasó un tope (ver `MAX_LARGO_DE_PATRON`).
 */
export function agentePuede(robots: string, agente: string, ruta = "/"): boolean | null {
  const grupos = parsear(robots);
  return decidir(aplicablesA(grupos, agente), ruta, { restante: PRESUPUESTO_DE_COINCIDENCIA }).puede;
}

/**
 * Qué agentes de IA pueden entrar, uno por uno, con el `robots.txt` parseado
 * UNA vez para los cinco, y decidido una vez por cada conjunto de grupos
 * distinto: los agentes sin grupo propio comparten el de `*`. `fueraDeTope`
 * dice por qué alguno quedó en `null`.
 */
export function leerAcceso(
  robots: string,
  ruta = "/"
): { acceso: Record<AgenteIA, boolean | null>; fueraDeTope: string | null } {
  const grupos = parsear(robots);
  const presupuesto = { restante: PRESUPUESTO_DE_COINCIDENCIA };
  const yaDecididos = new Map<string, Decision>();
  const acceso = {} as Record<AgenteIA, boolean | null>;
  let fueraDeTope: string | null = null;
  for (const agente of AGENTES_IA) {
    const aplicables = aplicablesA(grupos, agente);
    const clave = aplicables.map((g) => grupos.indexOf(g)).join(",");
    const d = yaDecididos.get(clave) ?? decidir(aplicables, ruta, presupuesto);
    yaDecididos.set(clave, d);
    acceso[agente] = d.puede;
    if (d.puede === null) fueraDeTope ??= d.fueraDeTope;
  }
  return { acceso, fueraDeTope };
}

/** Qué agentes de IA pueden entrar, uno por uno. */
export function accesoDeLasIA(robots: string, ruta = "/"): Record<AgenteIA, boolean | null> {
  return leerAcceso(robots, ruta).acceso;
}

/**
 * Los tipos de schema.org declarados en el HTML.
 *
 * Se leen los `application/ld+json`, que es lo que los motores usan como FUENTE
 * —no como pista de formato— y por eso es lo que decide si un dato se puede citar
 * o hay que inferirlo. Se aplana `@graph`, que es donde vive la mitad de los
 * sitios reales.
 */
/**
 * Un `<script>` cuyo `type` es JSON-LD: con el atributo entre comillas
 * dobles, simples o SIN comillas, con parámetros (`; charset=utf-8`) y en
 * cualquier caja. Antes sólo se veía con comillas (GATE-9): un bloque con
 * `type=application/ld+json` no aportaba tipos y, roto, tampoco era un error.
 */
const TYPE_JSON_LD =
  /\stype\s*=\s*(?:"\s*application\/ld\+json\s*(?:;[^"]*)?"|'\s*application\/ld\+json\s*(?:;[^']*)?'|application\/ld\+json(?:;[^\s>]*)?(?=[\s>/]))/i;

/**
 * Lo que abre algo que un parser de HTML NO lee como elementos: un
 * comentario; un `<template>`, cuyo contenido es inerte; `<textarea>` y
 * `<title>`, que son texto; `<style>`, `<xmp>`, `<iframe>`, `<noembed>` y
 * `<noframes>`, texto crudo; `<noscript>`, texto crudo para un navegador con
 * JavaScript —que es como lee un motor que renderiza—; y `<plaintext>`, que
 * vuelve texto el resto del documento. Y `<script>`, cuyo contenido es suyo:
 * un `<!--` o un `<template>` escritos adentro no abren nada.
 */
const APERTURA =
  /<!--|<(script|template|textarea|title|style|xmp|iframe|noembed|noframes|noscript|plaintext)(?=[\s/>])[^>]*>/gi;

/** El cierre de un elemento: `</nombre` seguido de espacio, `/` o `>`, como en HTML. */
function cierre(nombre: string): RegExp {
  return new RegExp(`</${nombre}(?=[\\s/>])[^>]*>`, "gi");
}

/** Dónde termina el `<template>` que se abrió antes de `desde`, contando los anidados. */
function finDeTemplate(html: string, desde: number): number {
  const marca = /<template(?=[\s/>])[^>]*>|<\/template(?=[\s/>])[^>]*>/gi;
  marca.lastIndex = desde;
  let abiertos = 1;
  for (let m = marca.exec(html); m; m = marca.exec(html)) {
    abiertos += m[0][1] === "/" ? -1 : 1;
    if (abiertos === 0) return m.index + m[0].length;
  }
  return html.length;
}

/**
 * Los bloques JSON-LD del HTML: el contenido de cada `<script>` JSON-LD que
 * un parser de HTML ve como elemento.
 *
 * Se RECORRE el documento en orden, como lo tokeniza un parser, y no se busca
 * con una expresión regular sobre el texto crudo (PU-4): así, un JSON-LD
 * dentro de un comentario, de un `<template>`, de un `<textarea>` o de un
 * `<noscript>` no cuenta —antes contaba, y la página sana con su JSON-LD
 * comentado salía con schema VERDE y los tres tipos—, y lo que hay dentro de
 * un `<script>` no abre un comentario. Un `<script>` sin cerrar no aporta un
 * bloque, como antes.
 */
function bloquesJsonLd(html: string): string[] {
  const bloques: string[] = [];
  let i = 0;
  while (i < html.length) {
    APERTURA.lastIndex = i;
    const m = APERTURA.exec(html);
    if (!m) break;
    const despues = m.index + m[0].length;

    if (m[0] === "<!--") {
      // `<!-->` y `<!--->` cierran en el acto; uno sin cerrar llega al final.
      if (html.startsWith(">", despues)) i = despues + 1;
      else if (html.startsWith("->", despues)) i = despues + 2;
      else {
        const fin = html.indexOf("-->", despues);
        i = fin < 0 ? html.length : fin + 3;
      }
      continue;
    }

    const nombre = m[1].toLowerCase();
    if (nombre === "plaintext") break;
    if (nombre === "template") {
      i = finDeTemplate(html, despues);
      continue;
    }
    const fin = cierre(nombre);
    fin.lastIndex = despues;
    const c = fin.exec(html);
    if (!c) break;
    if (nombre === "script" && TYPE_JSON_LD.test(m[0])) bloques.push(html.slice(despues, c.index));
    i = c.index + c[0].length;
  }
  return bloques;
}

/** Un `@type` que dice qué es el nodo: un texto no vacío, o una lista no vacía de ellos. */
function tipoValido(tipo: unknown): boolean {
  const valido = (t: unknown) => typeof t === "string" && t.trim() !== "";
  return Array.isArray(tipo) ? tipo.length > 0 && tipo.every(valido) : valido(tipo);
}

export function tiposDeSchema(html: string): string[] {
  const tipos = new Set<string>();

  for (const bloque of bloquesJsonLd(html)) {
    let datos: unknown;
    try {
      datos = JSON.parse(bloque.trim());
    } catch {
      // Un JSON-LD roto no es un tipo ausente ni uno presente: el motor tampoco
      // lo va a poder leer. Se ignora, y la ausencia habla sola.
      continue;
    }
    for (const raiz of raicesDelBloque(datos)) {
      if (!raiz || typeof raiz !== "object") continue;
      for (const nodo of nodosDeLaRaiz(raiz as Record<string, unknown>)) {
        // Un `@type` vacío no es un tipo: es el error que `erroresDeSchema`
        // informa (PU-4). Antes `""` entraba como tipo y el punto salía verde.
        const tipo = nodo["@type"];
        for (const t of Array.isArray(tipo) ? tipo : [tipo]) {
          if (typeof t === "string" && t.trim() !== "") tipos.add(t.trim());
        }
      }
    }
  }

  return [...tipos].sort();
}

/** Las raíces de un bloque: el objeto, o cada elemento si el bloque es un arreglo. */
function raicesDelBloque(datos: unknown): unknown[] {
  return Array.isArray(datos) ? datos : [datos];
}

/**
 * Los nodos de una raíz que se ACREDITAN y se JUZGAN: el ÚNICO recorrido, el
 * mismo para `tiposDeSchema` y para `erroresDeSchema` (FV-125-1). Antes cada
 * una recorría a su manera: `tiposDeSchema` sumaba el `@type` de una raíz que
 * además traía `@graph` y bajaba a los `@graph` anidados, y `erroresDeSchema`
 * miraba sólo el `@graph` de primer nivel. Reproducido por la revisión:
 * `{"@type":"Bananaa","@graph":[…]}`, un `LocalBusiness` sin `name` ni
 * `address` en esa raíz, y uno con un `FAQPage` sin preguntas en un `@graph`
 * anidado salían VERDES, con el tipo acreditado y sin un error.
 *
 * Qué es un nodo:
 *   - una raíz sin `@graph` (o con un `@graph` que no es un arreglo): ella;
 *   - una raíz con `@graph`: ELLA si declara `@type` —sin `@type` es sólo el
 *     envase, como siempre—, y cada elemento de su `@graph`;
 *   - cada elemento de un `@graph`, tenga o no su propio `@graph`, tiene que
 *     decir qué es, como antes; y si trae `@graph`, sus elementos también, a
 *     cualquier profundidad.
 *
 * Lo que dentro de un `@graph` no es un objeto se ignora, como antes. Un
 * arreglo dentro de un `@graph` es un nodo sin `@type` —el error de siempre—
 * y no se abre: lo que trae adentro no se acredita, porque no se juzga.
 *
 * Con una pila y no con recursión: un `@graph` anidado mil veces no agota la
 * pila del proceso.
 */
function nodosDeLaRaiz(raiz: Record<string, unknown>): Array<Record<string, unknown>> {
  const grafo = raiz["@graph"];
  if (!Array.isArray(grafo)) return [raiz];
  const nodos: Array<Record<string, unknown>> = [];
  if ("@type" in raiz) nodos.push(raiz);
  const pila: Array<{ elementos: unknown[]; i: number }> = [{ elementos: grafo, i: 0 }];
  while (pila.length > 0) {
    const tope = pila[pila.length - 1];
    if (tope.i >= tope.elementos.length) {
      pila.pop();
      continue;
    }
    const elemento = tope.elementos[tope.i++];
    if (!elemento || typeof elemento !== "object") continue;
    const nodo = elemento as Record<string, unknown>;
    nodos.push(nodo);
    const adentro = nodo["@graph"];
    if (Array.isArray(adentro)) pila.push({ elementos: adentro, i: 0 });
  }
  return nodos;
}

/**
 * Cuánto texto real trae el HTML sin ejecutar JavaScript.
 *
 * No devuelve un booleano porque la pregunta no lo es: una página con un
 * encabezado y nada más está técnicamente renderizada y para un motor está
 * vacía. Se devuelve el número, y quien lo muestra decide con el umbral escrito
 * en un solo lugar.
 */
/**
 * Lo que está MAL en el JSON-LD, no sólo lo que hay.
 *
 * `tiposDeSchema` ignora un bloque que no parsea, y eso era correcto para su
 * pregunta —«¿qué tipos declara?»— y un agujero para la puerta H2-GO-1: un
 * JSON-LD roto salía igual que uno ausente, y «no tiene schema» y «tiene un
 * schema que ningún motor puede leer» son hallazgos distintos con arreglos
 * distintos. La puerta lo dice: *si el JSON-LD sólo se comprueba por presencia,
 * el schema inválido sale verde*.
 *
 * Los errores, cada uno con el bloque en el que está, para que el hallazgo
 * apunte a algo que se pueda abrir y corregir:
 *   - no parsea (con el mensaje del parser);
 *   - parsea pero no declara `@context`, sin lo cual no es JSON-LD sino JSON;
 *   - declara un `@context` que no es schema.org, y entonces sus `@type` no son
 *     los de schema.org: un motor no los lee como tales (GATE-9);
 *   - parsea pero algún nodo no declara `@type`, o lo declara vacío o no
 *     como texto (`""`, `5`, `[]`): no dice qué es (PU-4);
 *   - un `@type` que schema.org NO DEFINE (F6): `"Bananaa"` salía verde. Se
 *     compara contra la instantánea del vocabulario
 *     (`vocabularioSchemaOrg.ts`);
 *   - a uno de los tipos que la auditoría pide —`Organization`,
 *     `LocalBusiness`, `FAQPage`, y sus subtipos— le falta lo mínimo que lo
 *     hace citable, o lo trae con un valor que no es del tipo (F6): un
 *     `LocalBusiness` sin `name` ni `address`, o con `telephone: {x: 1}`,
 *     `address: 42` y `openingHours: true`, salía verde. Ver
 *     `erroresDeLosTiposQueImportan`.
 *
 * Los nodos que se juzgan son los de `nodosDeLaRaiz`, los MISMOS que
 * `tiposDeSchema` acredita (FV-125-1): una raíz con `@type` y `@graph`, y los
 * `@graph` anidados a cualquier profundidad, también.
 *
 * Lo que NO valida, dicho: las propiedades de los DEMÁS tipos, ni las de los
 * nodos que cuelgan de una PROPIEDAD (el `publisher` de un `Article`), ni que
 * una propiedad pertenezca a su tipo. Esas faltas no ponen el punto en verde
 * por sí solas: no lo ponen en ningún color. Un nodo que cuelga de una
 * propiedad tampoco se acredita como tipo.
 */
export function erroresDeSchema(html: string): string[] {
  const errores: string[] = [];
  /** Los nodos juzgados —los de `nodosDeLaRaiz`—, con su bloque, para mirar los tipos que importan al final. */
  const juzgados: Array<{ nodo: Record<string, unknown>; bloque: number }> = [];
  bloquesJsonLd(html).forEach((bloque, i) => {
    const n = i + 1;
    let datos: unknown;
    try {
      datos = JSON.parse(bloque.trim());
    } catch (e) {
      errores.push(`bloque ${n}: no parsea (${(e as Error).message})`);
      return;
    }
    for (const raiz of raicesDelBloque(datos)) {
      if (!raiz || typeof raiz !== "object") {
        errores.push(`bloque ${n}: la raíz no es un objeto`);
        continue;
      }
      const objeto = raiz as Record<string, unknown>;
      if (!("@context" in objeto)) errores.push(`bloque ${n}: sin @context`);
      else if (!esContextoDeSchemaOrg(objeto["@context"])) {
        errores.push(`bloque ${n}: @context no es schema.org (${JSON.stringify(objeto["@context"]).slice(0, 80)})`);
      }
      for (const nodo of nodosDeLaRaiz(objeto)) {
        juzgados.push({ nodo, bloque: n });
        if (!("@type" in nodo)) errores.push(`bloque ${n}: un nodo sin @type`);
        else if (!tipoValido(nodo["@type"])) {
          errores.push(`bloque ${n}: un nodo con @type vacío o que no es texto (${JSON.stringify(nodo["@type"]).slice(0, 40)})`);
        } else {
          for (const tipo of tiposDelNodo(nodo)) {
            if (!CLASES_DE_SCHEMA_ORG.has(tipo)) {
              errores.push(`bloque ${n}: @type "${tipo.slice(0, 60)}" no es un tipo de schema.org`);
            }
          }
        }
      }
    }
  });
  errores.push(...erroresDeLosTiposQueImportan(juzgados));
  return errores;
}

/** El nombre de la clase: `"LocalBusiness"`, `"schema:LocalBusiness"` y el IRI dicen lo mismo. */
function claseDe(tipo: string): string {
  return tipo.trim().replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, "");
}

/** Las clases que declara un nodo, normalizadas. Sólo las de texto: el resto ya es un error. */
function tiposDelNodo(nodo: Record<string, unknown>): string[] {
  const tipo = nodo["@type"];
  return (Array.isArray(tipo) ? tipo : [tipo])
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .map(claseDe);
}

/** Un valor de texto de JSON-LD: texto no vacío, `{"@value": texto}`, o una lista no vacía de ellos. */
function esTexto(valor: unknown): boolean {
  const uno = (v: unknown): boolean => {
    if (typeof v === "string") return v.trim() !== "";
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const literal = (v as Record<string, unknown>)["@value"];
    return typeof literal === "string" && literal.trim() !== "";
  };
  return Array.isArray(valor) ? valor.length > 0 && valor.every(uno) : uno(valor);
}

/** Un nodo —un objeto, también una referencia `{"@id": …}`— o un texto, o una lista no vacía de ellos. */
function esNodoOTexto(valor: unknown): boolean {
  const uno = (v: unknown) => esTexto(v) || (!!v && typeof v === "object" && !Array.isArray(v));
  return Array.isArray(valor) ? valor.length > 0 && valor.every(uno) : uno(valor);
}

/** Un nodo, o una lista no vacía de nodos: no un texto ni un número. */
function esNodo(valor: unknown): boolean {
  const uno = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  return Array.isArray(valor) ? valor.length > 0 && valor.every(uno) : uno(valor);
}

/**
 * Lo que tiene que traer cada propiedad de `Organization` y `LocalBusiness`
 * SI ESTÁ: el tipo de valor que schema.org le asigna, en la forma que admite
 * JSON-LD. `address` admite `PostalAddress` o texto; `geo`, sólo un nodo.
 */
const FORMA_DE_PROPIEDAD: Record<string, { valida: (v: unknown) => boolean; que: string }> = {
  name: { valida: esTexto, que: "texto" },
  legalName: { valida: esTexto, que: "texto" },
  description: { valida: esTexto, que: "texto" },
  telephone: { valida: esTexto, que: "texto" },
  email: { valida: esTexto, que: "texto" },
  faxNumber: { valida: esTexto, que: "texto" },
  openingHours: { valida: esTexto, que: "texto" },
  priceRange: { valida: esTexto, que: "texto" },
  url: { valida: esNodoOTexto, que: "una URL" },
  sameAs: { valida: esNodoOTexto, que: "una URL" },
  logo: { valida: esNodoOTexto, que: "una URL o un ImageObject" },
  image: { valida: esNodoOTexto, que: "una URL o un ImageObject" },
  address: { valida: esNodoOTexto, que: "un PostalAddress o texto" },
  geo: { valida: esNodo, que: "un GeoCoordinates" },
  openingHoursSpecification: { valida: esNodo, que: "un OpeningHoursSpecification" },
};

/**
 * Los mínimos de los tipos que la auditoría pide (F6), sobre los nodos
 * juzgados (`nodosDeLaRaiz`) FUSIONADOS por `@id` —como los fusiona JSON-LD:
 * un plugin puede declarar el `LocalBusiness` en un nodo y su dirección en
 * otro con el mismo `@id`—:
 *
 *   - `Organization` y sus subtipos: `name`;
 *   - `LocalBusiness` y sus subtipos: además, `address` —sin ella no es un
 *     negocio LOCAL, y Google la pide—;
 *   - cada propiedad de `FORMA_DE_PROPIEDAD` que esté, con su forma;
 *   - `FAQPage`: `mainEntity`, con cada `Question` con `name` y un
 *     `acceptedAnswer` con `text`. Una pregunta puede venir como referencia
 *     (`{"@id": …}`) a un nodo de la página, como la escribe Yoast.
 */
function erroresDeLosTiposQueImportan(nodos: Array<{ nodo: Record<string, unknown>; bloque: number }>): string[] {
  const errores: string[] = [];
  const porId = new Map<string, { nodo: Record<string, unknown>; bloque: number }>();
  const fusionados: Array<{ nodo: Record<string, unknown>; bloque: number }> = [];
  for (const { nodo, bloque } of nodos) {
    const id = typeof nodo["@id"] === "string" ? nodo["@id"] : null;
    const previo = id !== null ? porId.get(id) : undefined;
    if (previo) {
      // El primero que declara una propiedad la conserva; los tipos se suman.
      const tipos = [...tiposDelNodo(previo.nodo), ...tiposDelNodo(nodo)];
      previo.nodo = { ...nodo, ...previo.nodo, "@type": tipos.length > 0 ? tipos : previo.nodo["@type"] };
      continue;
    }
    const entrada = { nodo: { ...nodo }, bloque };
    if (id !== null) porId.set(id, entrada);
    fusionados.push(entrada);
  }

  for (const { nodo, bloque } of fusionados) {
    const tipos = tiposDelNodo(nodo);
    const organizacion = tipos.find((t) => SUBTIPOS_DE_ORGANIZATION.has(t));
    const local = tipos.find((t) => SUBTIPOS_DE_LOCAL_BUSINESS.has(t));
    const quien = local ?? organizacion;
    if (quien) {
      if (!("name" in nodo)) errores.push(`bloque ${bloque}: ${quien} sin "name"`);
      if (local && !("address" in nodo)) errores.push(`bloque ${bloque}: ${local} sin "address"`);
      for (const [propiedad, forma] of Object.entries(FORMA_DE_PROPIEDAD)) {
        if (propiedad in nodo && !forma.valida(nodo[propiedad])) {
          errores.push(
            `bloque ${bloque}: ${quien} con "${propiedad}" que no es ${forma.que} (${JSON.stringify(nodo[propiedad]).slice(0, 40)})`
          );
        }
      }
    }
    if (tipos.includes("FAQPage")) errores.push(...erroresDeFaq(nodo, bloque, porId));
  }
  return errores;
}

function erroresDeFaq(
  faq: Record<string, unknown>,
  bloque: number,
  porId: Map<string, { nodo: Record<string, unknown> }>
): string[] {
  const principal = faq["mainEntity"];
  const preguntas = Array.isArray(principal) ? principal : principal === undefined ? [] : [principal];
  if (preguntas.length === 0) return [`bloque ${bloque}: FAQPage sin "mainEntity" (las preguntas)`];
  const errores: string[] = [];
  preguntas.forEach((cruda, i) => {
    let pregunta = cruda as Record<string, unknown> | null;
    if (pregunta && typeof pregunta === "object" && !("@type" in pregunta) && typeof pregunta["@id"] === "string") {
      pregunta = porId.get(pregunta["@id"])?.nodo ?? null;
      if (!pregunta) {
        errores.push(`bloque ${bloque}: FAQPage, la pregunta ${i + 1} apunta a un @id que la página no declara`);
        return;
      }
    }
    if (!pregunta || typeof pregunta !== "object" || Array.isArray(pregunta) || !tiposDelNodo(pregunta).includes("Question")) {
      errores.push(`bloque ${bloque}: FAQPage, la entrada ${i + 1} de "mainEntity" no es una Question`);
      return;
    }
    if (!esTexto(pregunta["name"])) errores.push(`bloque ${bloque}: FAQPage, la pregunta ${i + 1} sin "name"`);
    const respuestas = pregunta["acceptedAnswer"];
    const lista = Array.isArray(respuestas) ? respuestas : respuestas === undefined ? [] : [respuestas];
    const conTexto = lista.some(
      (r) => !!r && typeof r === "object" && esTexto((r as Record<string, unknown>)["text"])
    );
    if (!conTexto) errores.push(`bloque ${bloque}: FAQPage, la pregunta ${i + 1} sin "acceptedAnswer" con "text"`);
  });
  return errores;
}

/** `https://schema.org`, con http o https y con o sin barra final. */
const SCHEMA_ORG = /^https?:\/\/schema\.org\/?$/i;

/** Un `@context` que pone los términos en schema.org: el IRI, un arreglo que lo trae, o `@vocab`. */
function esContextoDeSchemaOrg(contexto: unknown): boolean {
  if (typeof contexto === "string") return SCHEMA_ORG.test(contexto.trim());
  if (Array.isArray(contexto)) return contexto.some(esContextoDeSchemaOrg);
  if (contexto && typeof contexto === "object") {
    const vocab = (contexto as Record<string, unknown>)["@vocab"];
    return typeof vocab === "string" && SCHEMA_ORG.test(vocab.trim());
  }
  return false;
}

export function textoSinJavaScript(html: string): number {
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    // Ni el `<title>` ni un `<template>` se dibujan: `innerText` no los
    // cuenta, y contarlos acá era ruido a favor del verde (P4). SALVO el
    // `<template shadowrootmode>`, que es un shadow root DECLARATIVO: el
    // parser lo dibuja sin JavaScript, y es también como `chromium.ts`
    // serializa cada sombra del DOM renderizado (PU-2). Sus etiquetas caen
    // con las demás y su texto cuenta.
    .replace(/<title[\s\S]*?<\/title>/gi, " ")
    .replace(/<template\b(?![^>]*\sshadowrootmode\s*=\s*["']?(?:open|closed)["'\s>])[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    // Una entidad es UN carácter dibujado: `&amp;` es «&», `&#8217;` es «’».
    // El espacio duro es espacio, como lo trata `contarCaracteres` del otro
    // lado. Antes las numéricas se contaban crudas (siete caracteres por
    // apóstrofo) y las con nombre como un espacio (P5).
    .replace(/&(?:nbsp|#0*160|#x0*a0);/gi, " ")
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, "x");
  return contarCaracteres(texto);
}

/**
 * Cuántos caracteres de texto hay, con UNA sola normalización para los dos
 * lados de la comparación: el HTML servido (`textoSinJavaScript`) y el DOM
 * renderizado (`renderizado.ts`, sobre `document.body.innerText`).
 *
 * Es una función aparte, y no una línea repetida en cada archivo, por lo que la
 * puerta H2-GO-1 compara: «servido frente a renderizado». Si cada lado colapsara
 * el espacio a su manera, la diferencia entre los dos números sería en parte
 * inventada por el código que los cuenta —por ejemplo, `innerText` mete `\n\n`
 * entre párrafos donde el HTML sin etiquetas deja espacios—, y un umbral sobre
 * esa diferencia mediría la normalización y no el sitio.
 *
 * Lo que NO iguala, dicho: la EXTRACCIÓN. Del HTML se sacan las etiquetas, el
 * `<title>`, los `<template>` y los comentarios, y cada entidad cuenta como un
 * carácter; del DOM sale el texto que el navegador ya decodificó y dibujó. Lo
 * que el HTML trae OCULTO por CSS (`display: none`) cuenta de este lado y no
 * del otro, y eso no es ruido de pocos caracteres: un mega-menú oculto puede
 * ser la mitad de lo servido. Por eso el número servido que decide el punto
 * es el VISIBLE, medido en el mismo Chromium sin JavaScript
 * (`renderizado.ts`); éste queda para cuando el navegador no está.
 */
export function contarCaracteres(texto: string): number {
  return texto.replace(/\s+/g, " ").trim().length;
}

/**
 * El umbral por debajo del cual un motor no tiene qué leer.
 *
 * Está escrito a mano y en un solo lugar a propósito: es un juicio, no una
 * medición, y conviene que se pueda discutir en una línea en vez de estar
 * repartido por la pantalla.
 */
export const MINIMO_DE_TEXTO = 500;
