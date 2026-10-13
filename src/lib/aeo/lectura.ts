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
 * Los bloques JSON-LD del HTML: `<script type="application/ld+json">` con el
 * atributo entre comillas dobles, simples o SIN comillas, con parámetros
 * (`; charset=utf-8`) y en cualquier caja. Antes sólo se veía con comillas
 * (GATE-9): un bloque con `type=application/ld+json` no aportaba tipos y,
 * roto, tampoco era un error.
 */
const BLOQUE_JSON_LD =
  /<script\b[^>]*?\stype\s*=\s*(?:"\s*application\/ld\+json\s*(?:;[^"]*)?"|'\s*application\/ld\+json\s*(?:;[^']*)?'|application\/ld\+json(?:;[^\s>]*)?(?=[\s>]))[^>]*>([\s\S]*?)<\/script\s*>/gi;

function bloquesJsonLd(html: string): string[] {
  return [...html.matchAll(BLOQUE_JSON_LD)].map((m) => m[1]);
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
    recolectar(datos, tipos);
  }

  return [...tipos].sort();
}

function recolectar(nodo: unknown, tipos: Set<string>): void {
  if (Array.isArray(nodo)) {
    for (const hijo of nodo) recolectar(hijo, tipos);
    return;
  }
  if (!nodo || typeof nodo !== "object") return;

  const objeto = nodo as Record<string, unknown>;
  const tipo = objeto["@type"];
  if (typeof tipo === "string") tipos.add(tipo);
  if (Array.isArray(tipo)) for (const t of tipo) if (typeof t === "string") tipos.add(t);

  if (Array.isArray(objeto["@graph"])) recolectar(objeto["@graph"], tipos);
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
 * Cuatro errores, cada uno con el bloque en el que está, para que el hallazgo
 * apunte a algo que se pueda abrir y corregir:
 *   - no parsea (con el mensaje del parser);
 *   - parsea pero no declara `@context`, sin lo cual no es JSON-LD sino JSON;
 *   - declara un `@context` que no es schema.org, y entonces sus `@type` no son
 *     los de schema.org: un motor no los lee como tales (GATE-9);
 *   - parsea pero algún nodo no declara `@type`, o sea que no dice qué es.
 *
 * Lo que NO valida, dicho: que cada `@type` exista en el vocabulario de
 * schema.org, ni las propiedades de cada tipo. Para eso hace falta el
 * vocabulario, y este repo no lo tiene.
 */
export function erroresDeSchema(html: string): string[] {
  const errores: string[] = [];
  bloquesJsonLd(html).forEach((bloque, i) => {
    const n = i + 1;
    let datos: unknown;
    try {
      datos = JSON.parse(bloque.trim());
    } catch (e) {
      errores.push(`bloque ${n}: no parsea (${(e as Error).message})`);
      return;
    }
    const raices = Array.isArray(datos) ? datos : [datos];
    for (const raiz of raices) {
      if (!raiz || typeof raiz !== "object") {
        errores.push(`bloque ${n}: la raíz no es un objeto`);
        continue;
      }
      const objeto = raiz as Record<string, unknown>;
      if (!("@context" in objeto)) errores.push(`bloque ${n}: sin @context`);
      else if (!esContextoDeSchemaOrg(objeto["@context"])) {
        errores.push(`bloque ${n}: @context no es schema.org (${JSON.stringify(objeto["@context"]).slice(0, 80)})`);
      }
      const nodos = Array.isArray(objeto["@graph"]) ? objeto["@graph"] : [objeto];
      for (const nodo of nodos) {
        if (nodo && typeof nodo === "object" && !("@type" in (nodo as object))) {
          errores.push(`bloque ${n}: un nodo sin @type`);
        }
      }
    }
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
    // cuenta, y contarlos acá era ruido a favor del verde (P4).
    .replace(/<title[\s\S]*?<\/title>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
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
