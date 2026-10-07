/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que una afirmación estratégica publicada se dé por respaldada sin que su
 * fuente exista. Es la puerta H1.4, en su versión corregida: el chequeo recorre
 * TODAS las afirmaciones de la versión publicada, informa el denominador N y el
 * número M de afirmaciones cuya evidencia no resuelve, y sólo pasa con M = 0 y
 * N > 0.
 *
 * LA PUERTA TIENE TRES TRAMPAS AUTODECLARATIVAS, Y CADA UNA TIENE SU CIERRE ACÁ
 *
 * 1. EL DENOMINADOR LO ELIGE QUIEN CARGA. Cerrado afuera de este archivo y
 *    comprobado adentro: `n` llega del `count(*)` de PostgreSQL sobre
 *    `profile_objectives` de la versión publicada, no del largo de una lista, y
 *    si la lista leída no tiene exactamente `n` filas esto no cuenta nada —
 *    devuelve `lectura-incompleta`—. Un denominador que no coincide con lo que
 *    se recorrió es un denominador inventado.
 * 2. EL PROPIO DOMINIO COMO FUENTE. Se compara con el host que calculó la base
 *    —`profile_evidence.source_host` contra `url_host(businesses.website)`, la
 *    misma función de los dos lados (decisión 10 de la `0026`)— y además se
 *    exige que el parser con el que de verdad se SALE a la red lea el mismo
 *    host. Con `https://propio.com\@otro.com/`, `url_host` dice `otro.com` y el
 *    `URL` de Node dice `propio.com`: la columna aprobaría una fuente que la
 *    petición iría a buscar al propio sitio. Cuando los dos parsers no coinciden
 *    la fuente NO resuelve (`url-ambigua`), en vez de elegir uno. Y cada salto
 *    de una redirección vuelve a compararse: una fuente ajena que redirige al
 *    propio sitio no es una fuente ajena.
 * 3. «VERIFICADA A MANO» SIN TECHO. Va a una cubeta propia, se publica con su
 *    porcentaje sobre N, y por encima del 20% el chequeo da rojo.
 *
 * Y la cuarta, que la `0026` dejó escrita para que no se descubriera sola: con
 * `businesses.website` vacío, `url_host('')` es `''` y «origen distinto» sería
 * cierto para cualquier fuente. Acá un dominio propio vacío, o que no tiene
 * forma de host, NO deja pasar nada: ninguna fuente sale a la red, todas son
 * `dominio-propio-desconocido`, y el veredicto es rojo con ese motivo.
 *
 * LA CONTRAPRUEBA VA EN LA MISMA CORRIDA, NO EN UN TEST APARTE
 *
 * Cada corrida clasifica, con el mismo código y las mismas dependencias que las
 * fuentes reales, dos fuentes de control: una URL inventada (`*.invalid`, que
 * por RFC 6761 no resuelve nunca) y una al propio dominio. Las dos tienen que
 * caer en «no resuelve», y la segunda con motivo `origen-propio` exacto. Si no,
 * el veredicto es rojo con `contraprueba-fallida`: un chequeo que no puede decir
 * que no no está diciendo que sí.
 *
 * Lo que la contraprueba NO prueba, dicho: ninguno de los dos controles llega
 * al transporte HTTP. La inventada muere en el DNS y la propia en el examen de
 * origen, armada en código y no leída de `source_host`. Un transporte que
 * contestara 200 a todo —un portal de egreso, una regresión en
 * `nodeTransport.ts`— pasaría la contraprueba; eso lo atrapan los tests con
 * sockets en CI, no la corrida en producción. Cerrarlo pide un tercer control
 * con una URL pública que conteste 404 de verdad, y elegir ese origen —propio
 * de Vulkan o de un tercero— es una decisión, no un arreglo.
 *
 * QUÉ ES SALIR A LA RED, Y POR QUÉ CADA RECHAZO ES «NO RESUELVE»
 *
 * El servidor sale a URLs que cargó un usuario, así que esto es superficie de
 * SSRF. Por cada salto: sólo `http:` y `https:`, sólo los puertos 80 y 443,
 * nada de `usuario:clave@`, ninguna IP literal (tampoco tiene dominio que
 * comparar con el propio), resolución DNS antes de conectar y rechazo si
 * CUALQUIER dirección resuelta no es pública (privadas, loopback, link-local
 * —ahí vive 169.254.169.254—, CGNAT, documentación, multicast, `fc00::/7`, y
 * todo IPv6 fuera de `2000::/3`). La conexión va a la dirección que se
 * comprobó, no a una segunda resolución: eso es lo que cierra el rebinding. Las
 * redirecciones se siguen a mano, como máximo tres, con el mismo examen en cada
 * una. Cada rechazo es «no resuelve» con su motivo, nunca un éxito.
 *
 * AUSENCIA, CERO Y FALLO
 *
 * Una afirmación sin evidencia cuenta en M, y se publica aparte
 * (`afirmacionesSinEvidencia`). Una corrida que no pudo leer todo es un fallo
 * con nombre (`lectura-incompleta`), no un N menor. Y una ficha vacía es N = 0, que es rojo: una ficha no pasa por estar
 * vacía.
 *
 * LO QUE ESTE ARCHIVO NO DECIDE
 *
 * No lee la base ni escribe en ella: eso es de la ruta, que sabe de sesiones y
 * de organizaciones. No sabe de `node:http`: el transporte y el resolvedor se
 * inyectan (`nodeTransport.ts` es el de verdad), así que los tests recorren la
 * secuencia completa —HEAD, 405, GET con `Range`, redirección, salto
 * rechazado— con dobles y también con sockets reales.
 *
 * VERIFICADO POR MUTACIÓN (R7), con `./scripts/mutar.sh` el 2026-10-06. Cada
 * línea es una garantía de este archivo rota a propósito, y dónde cayó (E =
 * `evidenceCheck.test.ts`, S = `evidenceCheck.sockets.test.ts`, R = el test de
 * la ruta). Ninguna sobrevivió:
 *
 *   M1  sin el chequeo de origen propio . . . . . . E, S y R: 12 tests
 *   M2  el origen propio sólo en el primer salto  . E «redirige al propio», S
 *   M3  sin el acuerdo entre los dos parsers  . . . E «url-ambigua», IDN/%/decimal
 *   M4  un dominio propio vacío deja pasar  . . . . E (7 formas) y R: 8 tests
 *   M5  loopback se acepta como pública . . . . . . E tabla de IP (en S no: `localhost`
 *       también resuelve a `::1`, que sigue sin ser pública)
 *   M6  el salto no vuelve al examen de IP  . . . . E nombre→10.0.0.7, S localhost
 *   M7  sin degradar a GET  . . . . . . . . . . . . E 405/403/501, S: 7 tests
 *   M7b el GET degradado sin `Range`  . . . . . . . S (el servidor da 400), E
 *   M8  sin el tope del 20% a mano  . . . . . . . . E «2 de 9 es 22,2%»
 *   M8b el tope con `>=` (el 20% exacto rojo) . . . E «1 de 5 es el 20%»
 *   M9  N = 0 pasa  . . . . . . . . . . . . . . . . E y R «sin versión publicada»
 *   M10 una afirmación sin evidencia no cuenta  . . E «sin ninguna evidencia»
 *   M11 el denominador sale del largo de la lista . E y R «página cortada»
 *   M12 la contraprueba fuera del veredicto . . . . E «si la inventada RESUELVE»
 *   M13 sin tope de redirecciones . . . . . . . . . E «la cuarta ya no se sigue»
 *   M14 credenciales en la URL  . . . . . . . . . . E «esquema, puerto y credenciales»
 *   M15 sin el examen de puertos  . . . . . . . . . E y S (127.0.0.1:<puerto>)
 *   M16 alcanza con UNA dirección pública . . . . . E «si UNA es privada»
 *   M17 el transporte no fija la dirección  . . . . S: 10 tests (nodeTransport.ts)
 *   M18 una IP literal se acepta como fuente  . . . E «IP literal, privada O PÚBLICA»
 *   M19 un error de certificado como sin-respuesta  S «qué error es TLS»
 *   M8c el tope contra las FUENTES, no contra N . . E «sobre N AFIRMACIONES», «el borde»
 *   M8d el porcentaje impreso contra las fuentes  . E los mismos dos
 *   M20 la línea con otro N y otro M  . . . . . . . E «la línea publica ESTE N y ESTE M»
 *   M21 el presupuesto por pedido, no por fuente  . E «cuatro saltos de 60 ms»
 *   M22 el DNS sin plazo  . . . . . . . . . . . . . E «un DNS que no contesta nunca»
 *   M23 sin tope de concurrencia  . . . . . . . . . E «nunca hay más fuentes en vuelo»
 *   M24 una manual sin FECHA alcanza  . . . . . . . E «las dos mitades»
 *   M25 la manual sin el acuerdo de los parsers . . E «una manual cuya columna…»
 *   M26 sin M por tipo  . . . . . . . . . . . . . . E «claim y goal»
 *   M26b sin el desglose por tipo en la línea . . . E «claim y goal»
 *   M27 last_status con el último status visto  . . E «un 301 hacia el propio sitio», R
 *   M28 last_status sólo de las resueltas . . . . . E «el 2xx… y el status de un http-»
 *   M29 el plazo no aborta la consulta DNS  . . . . E «la consulta se CORTA», S «DNS mudo»
 *
 * M18 y M19 no estaban en la primera ronda: salieron de refutar la primera
 * versión. La IP literal dejaba citar el propio sitio por la dirección de su
 * servidor; el error de TLS se midió a mano contra un servidor HTTPS local con
 * una CA de prueba, que no entra en CI porque necesita certificados generados.
 *
 * M8c a M29 salieron de refutar la segunda. Siete eran garantías ESCRITAS sin
 * test —el denominador del tope, la línea, el presupuesto total, el DNS con
 * plazo, la concurrencia, las dos mitades de una manual, el acuerdo de parsers
 * en una manual—: el código estaba bien y un cambio que lo rompiera dejaba CI
 * en verde. Las demás son arreglos: el DNS que no se cortaba (M29, y T1/T2 en
 * `nodeTransport.ts`), `last_status` con un 3xx de una fuente que no resuelve
 * (M27/M28) y el desglose claim/goal que la `0026` pedía (M26).
 */
import { BlockList, isIP } from "node:net";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Las tres cubetas de la puerta corregida, y ninguna más. */
export type Cubeta = "resuelta" | "no-resuelve" | "a-mano";

/**
 * Por qué una fuente no resuelve. Lista cerrada más `http-<status>`: un motivo
 * libre sería texto, y la puerta existe para que esto no sea texto.
 */
export type MotivoNoResuelve =
  | "dominio-propio-desconocido"
  | "url-ilegible"
  | "url-ambigua"
  | "esquema"
  | "credenciales"
  | "puerto"
  | "origen-propio"
  | "dns"
  | "ip-no-publica"
  | "ip-literal"
  | "timeout"
  | "sin-respuesta"
  | "tls"
  | "redireccion-sin-destino"
  | "demasiadas-redirecciones"
  | "tope-de-corrida"
  | "manual-sin-verificacion"
  | "tipo-desconocido"
  | `http-${number}`;

/** Una afirmación de la versión publicada: una fila de `profile_objectives`. */
export interface Afirmacion {
  id: string;
  tipo: string;
}

/** Una fuente: una fila de `profile_evidence`. */
export interface Fuente {
  id: string;
  objetivoId: string;
  /** `http` o `manual` por el CHECK de la `0026`; cualquier otra cosa no resuelve. */
  tipo: string;
  url: string;
  /** `profile_evidence.source_host`, la columna GENERADA. No se recalcula acá. */
  hostFuente: string | null;
  verificadaEn: string | null;
  verificadaPor: string | null;
}

export interface EntradaChequeo {
  /** El `count(*)` de PostgreSQL. Es el denominador, no `afirmaciones.length`. */
  n: number;
  afirmaciones: Afirmacion[];
  fuentes: Fuente[];
  /** `url_host(businesses.website)`, calculado por la base. `''` o null = desconocido. */
  hostPropio: string | null;
}

/** Un pedido HTTP ya examinado: la dirección a la que se conecta está decidida. */
export interface PedidoHttp {
  url: string;
  /** La dirección que pasó el examen de IP. El transporte conecta ACÁ, no re-resuelve. */
  ip: string;
  metodo: "HEAD" | "GET";
  /** `true` manda `Range: bytes=0-0`. */
  rango: boolean;
  timeoutMs: number;
}

export type RespuestaHttp =
  | { tipo: "respuesta"; status: number; location: string | null }
  | { tipo: "error"; motivo: "timeout" | "sin-respuesta" | "tls" };

export type Resolucion = { ok: true; direcciones: string[] } | { ok: false };

export interface Dependencias {
  /**
   * DNS. Devuelve TODAS las direcciones: una sola privada alcanza para rechazar.
   * La señal se aborta cuando vence el plazo de la fuente, y el resolvedor de
   * verdad CORTA la consulta (`nodeTransport.ts`): dejar de esperarla no
   * alcanza, porque una consulta abandonada sigue ocupando lo que ocupe.
   */
  resolver: (host: string, senal: AbortSignal) => Promise<Resolucion>;
  transporte: (pedido: PedidoHttp) => Promise<RespuestaHttp>;
  /** Sufijo aleatorio del host inventado de la contraprueba. */
  sufijoAleatorio: () => string;
}

export interface Opciones {
  /** Presupuesto TOTAL por fuente, sumando DNS, saltos y el GET degradado. */
  presupuestoPorFuenteMs: number;
  concurrencia: number;
  /** URLs http distintas que una corrida sale a mirar. Las que sobran no resuelven. */
  maxFuentesHttp: number;
  maxRedirecciones: number;
}

/**
 * Con 48 URLs más los dos controles de la contraprueba, 8 en paralelo y 6 s por
 * fuente, el peor caso es que cada obrero encadene 7 fuentes de 6 s: 42 s, que
 * entran en el `maxDuration = 60` de Vercel Hobby con lugar para las lecturas y
 * la escritura.
 *
 * Esa cuenta tiene tres supuestos, y cada uno tiene su test: que los 6 s son
 * TOTALES por fuente —DNS, saltos y GET degradado sumados, no 6 s por pedido—,
 * que nunca hay más de 8 fuentes en vuelo, y que cuando la corrida devuelve no
 * queda nada colgado. El tercero fue falso en la primera versión: el DNS
 * corría en el pool de libuv, el plazo dejaba de esperarlo sin cortarlo, y la
 * escritura posterior esperaba 79 s detrás de la cola (ver `nodeTransport.ts`).
 */
export const OPCIONES_POR_DEFECTO: Opciones = {
  presupuestoPorFuenteMs: 6_000,
  concurrencia: 8,
  maxFuentesHttp: 48,
  maxRedirecciones: 3,
};

/** El techo de la cubeta «verificada a mano», en porcentaje de N. */
export const TOPE_A_MANO_PORCENTAJE = 20;

export interface Clasificacion {
  cubeta: Cubeta;
  motivo: MotivoNoResuelve | null;
  /** El último status HTTP visto. `null` = no hubo respuesta HTTP, que no es un cero. */
  status: number | null;
  /** `true` si algún salto tuvo que pasar de HEAD a GET con `Range`. */
  degradada: boolean;
  saltos: number;
  /** `true` si hubo al menos una consulta DNS: la fuente se MIDIÓ, no sólo se juzgó. */
  medida: boolean;
}

export interface FuenteClasificada extends Clasificacion {
  id: string;
  objetivoId: string;
  url: string;
}

export type MotivoRojo =
  | "dominio-propio-desconocido"
  | "n-cero"
  | "afirmaciones-sin-evidencia-resoluble"
  | "fuentes-que-no-resuelven"
  | "a-mano-sobre-el-tope"
  | "contraprueba-fallida";

export interface Contraprueba {
  inventada: (Clasificacion & { url: string }) | null;
  propia: (Clasificacion & { url: string }) | null;
  /** Cuánto subió «no resuelve» al sumar los dos controles. Tiene que ser 2. */
  subioNoResuelve: number;
  ok: boolean;
}

export interface ResultadoChequeo {
  ok: true;
  n: number;
  m: number;
  /**
   * N y M por tipo de afirmación. `claim` y `goal` están siempre, aunque sea en
   * cero: el comentario de `profile_objectives` en la `0026` los declara «dos
   * cubetas distintas del denominador de H1.4», y una ficha toda de `goal`
   * —aspiraciones— no se publica con la misma línea que una de hechos.
   */
  porTipo: Record<string, { n: number; m: number }>;
  cubetas: { resuelta: number; noResuelve: number; aMano: number; degradadas: number };
  /** `aMano / n` en porcentaje, o null si N = 0: sin denominador no hay porcentaje. */
  porcentajeAMano: number | null;
  afirmacionesSinEvidencia: number;
  fuentes: FuenteClasificada[];
  afirmaciones: Array<{ id: string; resuelve: boolean; sinEvidencia: boolean }>;
  contraprueba: Contraprueba;
  motivosRojo: MotivoRojo[];
  verde: boolean;
  linea: string;
}

export type SalidaChequeo =
  | ResultadoChequeo
  | { ok: false; motivo: "lectura-incompleta"; n: number; leidas: number };

// ─────────────────────────────────────────────────────────────────────────────
// Qué dirección es pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IPv4 de uso especial (registro de IANA), que no son internet. Va por
 * EXCLUSIÓN porque en IPv4 casi todo es público; IPv6 va por inclusión, abajo.
 */
const V4_NO_PUBLICAS = new BlockList();
for (const [red, prefijo] of [
  ["0.0.0.0", 8], // «esta red»
  ["10.0.0.0", 8], // privada
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local: 169.254.169.254, la metadata de la nube
  ["172.16.0.0", 12], // privada
  ["192.0.0.0", 24], // asignaciones de protocolo
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.31.196.0", 24], // AS112
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // relé 6to4
  ["192.168.0.0", 16], // privada
  ["192.175.48.0", 24], // AS112
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservada, incluye 255.255.255.255
] as const) {
  V4_NO_PUBLICAS.addSubnet(red, prefijo, "ipv4");
}

/** IPv6 global unicast. Todo lo que está afuera —`::1`, `fe80::/10`, `fc00::/7`, `::ffff:0:0/96`— no es público. */
const V6_GLOBAL = new BlockList();
V6_GLOBAL.addSubnet("2000::", 3, "ipv6");

/** Lo que vive dentro de `2000::/3` y aun así no es un destino público directo. */
const V6_NO_PUBLICAS = new BlockList();
for (const [red, prefijo] of [
  ["2001::", 32], // Teredo: lleva una IPv4 adentro
  ["2001:2::", 48], // benchmarking
  ["2001:10::", 28], // ORCHID
  ["2001:20::", 28], // ORCHIDv2
  ["2001:db8::", 32], // documentación
  ["2002::", 16], // 6to4: lleva una IPv4 adentro, que puede ser privada
] as const) {
  V6_NO_PUBLICAS.addSubnet(red, prefijo, "ipv6");
}

/** ¿Es una dirección a la que el servidor puede salir sin ser un proxy hacia adentro? */
export function esIpPublica(ip: string): boolean {
  const familia = isIP(ip);
  if (familia === 4) return !V4_NO_PUBLICAS.check(ip, "ipv4");
  if (familia === 6) return V6_GLOBAL.check(ip, "ipv6") && !V6_NO_PUBLICAS.check(ip, "ipv6");
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// El dominio propio
// ─────────────────────────────────────────────────────────────────────────────

/** Etiquetas DNS en ASCII, al menos dos, y un TLD que no es un número. */
const FORMA_DE_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function normalizarHost(host: string): string {
  let h = host.trim().toLowerCase();
  while (h.endsWith(".")) h = h.slice(0, -1);
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

/**
 * El dominio propio, si tiene forma de host; si no, null.
 *
 * `''` es el caso que la `0026` nombra —`website` vacío—, y no es el único: un
 * `website` con espacios, un IDN que `url_host` deja en unicode o una IP pelada
 * dan un «dominio propio» que nunca va a coincidir con ninguna fuente, y
 * entonces «origen distinto» sería cierto para todas. Desconocido es
 * desconocido, aunque no esté vacío.
 */
export function dominioPropio(hostPropio: string | null): string | null {
  if (!hostPropio) return null;
  const h = normalizarHost(hostPropio);
  return FORMA_DE_HOST.test(h) ? h : null;
}

/**
 * ¿Es el propio dominio? En LOS DOS SENTIDOS, que es lo que la §1 de la `0026`
 * pide: `url_host` no saca el `www.`, así que `www.ejemplo.com` contra
 * `ejemplo.com` se normaliza acá, y además un subdominio del propio cuenta como
 * propio (`blog.ejemplo.com`) y el padre del propio también (sitio en
 * `tienda.ejemplo.com`, fuente en `ejemplo.com`).
 *
 * Lo que NO ve, dicho: dos hermanos cuando el sitio vive en un subdominio que no
 * es `www` (sitio en `tienda.ejemplo.com`, fuente en `blog.ejemplo.com`). Sin
 * la lista de sufijos públicos no hay forma barata de saber dónde termina el
 * dominio registrable, y adivinarlo con «las dos últimas etiquetas» declararía
 * propio a todo `.com.ar`.
 */
export function esOrigenPropio(host: string, propio: string): boolean {
  const h = normalizarHost(host);
  if (!h) return false;
  return h === propio || h.endsWith("." + propio) || propio.endsWith("." + h);
}

// ─────────────────────────────────────────────────────────────────────────────
// Una URL, hasta su respuesta o su rechazo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que la ruta escribe en `last_status`: el status de la respuesta que
 * DECIDIÓ la fuente, o null.
 *
 * No es «el último status que se vio». Una fuente que contesta 301 hacia el
 * propio sitio vio un 301, y la puerta define «resuelta» como «2xx o 3xx a
 * HEAD»: una auditoría con SQL sobre la tabla —que es como la puerta pide
 * contar— la leería resuelta, y es justo el caso que la puerta existe para
 * atrapar. Acá se guarda el 2xx de una resuelta, o el status de un
 * `http-<status>`. Todo lo demás —un salto rechazado después de un 3xx, un
 * timeout después de un 405, demasiadas redirecciones, un 3xx sin destino— es
 * null: se midió, y ninguna respuesta HTTP la decidió. La columna nunca dice
 * 2xx o 3xx de una fuente que el chequeo declaró que no resuelve.
 */
export function statusMedido(c: Clasificacion): number | null {
  if (c.cubeta === "resuelta") return c.status;
  if (c.motivo !== null && c.motivo.startsWith("http-")) return c.status;
  return null;
}

/** Los status con los que un origen rechaza HEAD sin decir nada del recurso. */
const RECHAZAN_HEAD = new Set([403, 405, 501]);

function noResuelve(
  motivo: MotivoNoResuelve,
  extra: Partial<Pick<Clasificacion, "status" | "degradada" | "saltos" | "medida">> = {}
): Clasificacion {
  return {
    cubeta: "no-resuelve",
    motivo,
    status: extra.status ?? null,
    degradada: extra.degradada ?? false,
    saltos: extra.saltos ?? 0,
    medida: extra.medida ?? false,
  };
}

/** El examen que se repite en CADA salto, antes de cualquier DNS. */
function examenDeSalto(url: URL, propio: string): MotivoNoResuelve | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "esquema";
  if (url.username !== "" || url.password !== "") return "credenciales";
  const puerto = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (puerto !== 80 && puerto !== 443) return "puerto";
  if (esIpLiteral(url)) return "ip-literal";
  if (esOrigenPropio(url.hostname, propio)) return "origen-propio";
  return null;
}

/**
 * Una IP pelada no tiene dominio que comparar con el propio. Sin esto,
 * `http://<la IP del servidor del cliente>/` pasaría la regla de origen distinto
 * justamente por no tener nombre: el propio sitio, citado por su dirección. Se
 * rechaza en cualquier salto, y es la dirección barata del error —ninguna
 * fuente legítima se cita por IP—. Los corchetes son de la URL, no de la
 * dirección.
 */
function esIpLiteral(url: URL): boolean {
  return isIP(url.hostname.replace(/^\[(.*)\]$/, "$1")) !== 0;
}

/**
 * Espera a `promesa` como mucho `ms`. Al vencer llama `alVencer`, que es lo que
 * CORTA el trabajo de abajo: sin eso, el plazo sólo deja de esperar.
 */
async function conPlazo<T>(promesa: Promise<T>, ms: number, alVencer?: () => void): Promise<T | "plazo"> {
  if (ms <= 0) {
    alVencer?.();
    return "plazo";
  }
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<"plazo">((listo) => {
    reloj = setTimeout(() => {
      alVencer?.();
      listo("plazo");
    }, ms);
  });
  try {
    return await Promise.race([promesa, plazo]);
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Sale a la red por una fuente `http`, salto por salto.
 *
 * `hostFuente` es la columna generada. La primera comprobación es que el `URL`
 * de Node lea el mismo host que leyó PostgreSQL: si no, la regla de origen
 * distinto estaría juzgando un host y la petición iría a otro.
 */
export async function clasificarUrl(
  urlTexto: string,
  hostFuente: string | null,
  hostPropio: string | null,
  deps: Dependencias,
  opciones: Opciones = OPCIONES_POR_DEFECTO
): Promise<Clasificacion> {
  const propio = dominioPropio(hostPropio);
  if (!propio) return noResuelve("dominio-propio-desconocido");

  let url: URL;
  try {
    url = new URL(urlTexto);
  } catch {
    return noResuelve("url-ilegible");
  }
  if (hostFuente === null || url.hostname !== hostFuente) return noResuelve("url-ambigua");

  const limite = Date.now() + opciones.presupuestoPorFuenteMs;
  const restante = () => limite - Date.now();
  let degradada = false;
  let medida = false;
  let ultimoStatus: number | null = null;

  for (let salto = 0; ; salto++) {
    const estado = () => ({ status: ultimoStatus, degradada, saltos: salto, medida });

    const rechazo = examenDeSalto(url, propio);
    if (rechazo) return noResuelve(rechazo, estado());

    // Desde acá la fuente se MIDE: hubo una consulta a la red.
    medida = true;
    const corte = new AbortController();
    const resolucion = await conPlazo(deps.resolver(url.hostname, corte.signal), restante(), () => corte.abort());
    if (resolucion === "plazo") return noResuelve("timeout", estado());
    if (!resolucion.ok || resolucion.direcciones.length === 0) return noResuelve("dns", estado());
    const direcciones = resolucion.direcciones;
    // TODAS: una respuesta mixta con una sola privada es exactamente cómo se
    // arma un rebinding.
    if (!direcciones.every(esIpPublica)) return noResuelve("ip-no-publica", estado());

    const ip = direcciones[0];
    // El plazo se impone ACÁ además de pasarse al transporte: un transporte que
    // lo ignore no puede colgar la corrida entera más allá del `maxDuration`.
    const pedir = async (metodo: "HEAD" | "GET"): Promise<RespuestaHttp> => {
      const r = await conPlazo(
        deps.transporte({
          url: url.toString(),
          ip,
          metodo,
          rango: metodo === "GET",
          timeoutMs: Math.max(restante(), 0),
        }),
        restante()
      );
      return r === "plazo" ? { tipo: "error", motivo: "timeout" } : r;
    };

    let respuesta = await pedir("HEAD");
    if (respuesta.tipo === "respuesta" && RECHAZAN_HEAD.has(respuesta.status)) {
      // El origen rechazó el MÉTODO, no dijo nada del recurso. Se pregunta de
      // nuevo con un GET de un solo byte, y queda anotado que se degradó.
      ultimoStatus = respuesta.status;
      degradada = true;
      respuesta = await pedir("GET");
    }

    if (respuesta.tipo === "error") return noResuelve(respuesta.motivo, estado());
    ultimoStatus = respuesta.status;

    if (respuesta.status >= 200 && respuesta.status < 300) {
      return { cubeta: "resuelta", motivo: null, ...estado() };
    }

    if (respuesta.status >= 300 && respuesta.status < 400) {
      if (!respuesta.location) return noResuelve("redireccion-sin-destino", estado());
      if (salto >= opciones.maxRedirecciones) return noResuelve("demasiadas-redirecciones", estado());
      try {
        url = new URL(respuesta.location, url);
      } catch {
        return noResuelve("url-ilegible", estado());
      }
      continue;
    }

    return noResuelve(`http-${respuesta.status}`, estado());
  }
}

/** Una fuente `manual`: no sale a la red, pero el origen propio y la forma sí cuentan. */
function clasificarManual(fuente: Fuente, hostPropio: string | null): Clasificacion {
  const propio = dominioPropio(hostPropio);
  if (!propio) return noResuelve("dominio-propio-desconocido");
  let url: URL;
  try {
    url = new URL(fuente.url);
  } catch {
    return noResuelve("url-ilegible");
  }
  if (fuente.hostFuente === null || url.hostname !== fuente.hostFuente) return noResuelve("url-ambigua");
  if (esIpLiteral(url)) return noResuelve("ip-literal");
  if (esOrigenPropio(url.hostname, propio)) return noResuelve("origen-propio");
  // El CHECK de la `0026` ya lo exige. Se vuelve a mirar porque una verificación
  // a mano sin fecha ni persona es una fuente que nadie miró declarada buena, y
  // este archivo no cuenta lo que no ve.
  if (!fuente.verificadaEn || !fuente.verificadaPor) return noResuelve("manual-sin-verificacion");
  return { cubeta: "a-mano", motivo: null, status: null, degradada: false, saltos: 0, medida: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// La corrida
// ─────────────────────────────────────────────────────────────────────────────

async function enParalelo<T, R>(items: T[], limite: number, trabajo: (item: T) => Promise<R>): Promise<R[]> {
  const salida = new Array<R>(items.length);
  let siguiente = 0;
  const obreros = Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      salida[i] = await trabajo(items[i]);
    }
  });
  await Promise.all(obreros);
  return salida;
}

function porcentaje(parte: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((parte * 1000) / total) / 10;
}

/**
 * La corrida entera: clasifica cada fuente, suma por afirmación, corre la
 * contraprueba y decide el veredicto.
 */
export async function chequearEvidencia(
  entrada: EntradaChequeo,
  deps: Dependencias,
  opciones: Opciones = OPCIONES_POR_DEFECTO
): Promise<SalidaChequeo> {
  // El denominador es el de PostgreSQL. Si lo que se recorrió no coincide, no
  // hay un N menor que informar: hay una lectura rota.
  if (entrada.afirmaciones.length !== entrada.n) {
    return { ok: false, motivo: "lectura-incompleta", n: entrada.n, leidas: entrada.afirmaciones.length };
  }
  const n = entrada.n;
  const propio = dominioPropio(entrada.hostPropio);

  // Las http se miran una vez por URL, aunque las citen dos afirmaciones.
  const urlsHttp: string[] = [];
  const hostPorUrl = new Map<string, string | null>();
  for (const f of entrada.fuentes) {
    if (f.tipo === "http" && !hostPorUrl.has(f.url)) {
      hostPorUrl.set(f.url, f.hostFuente);
      urlsHttp.push(f.url);
    }
  }
  const aMirar = urlsHttp.slice(0, opciones.maxFuentesHttp);
  const fueraDeTope = new Set(urlsHttp.slice(opciones.maxFuentesHttp));

  // Los controles, con el mismo código y las mismas dependencias. Sin dominio
  // propio no hay contraprueba de origen propio que construir, y la inventada
  // tampoco sale: con el veredicto ya rojo, salir a la red sólo gastaría.
  const controles: Array<{ url: string; host: string; cual: "inventada" | "propia" }> = [];
  if (propio) {
    const hostInventado = `evidencia-inventada-${deps.sufijoAleatorio()}.invalid`;
    controles.push({ url: `https://${hostInventado}/`, host: hostInventado, cual: "inventada" });
    controles.push({ url: `https://${propio}/`, host: propio, cual: "propia" });
  }

  const trabajos: Array<{ url: string; host: string | null }> = [
    ...aMirar.map((url) => ({ url, host: hostPorUrl.get(url) ?? null })),
    ...controles.map((c) => ({ url: c.url, host: c.host })),
  ];
  const clasificados = await enParalelo(trabajos, opciones.concurrencia, (t) =>
    clasificarUrl(t.url, t.host, entrada.hostPropio, deps, opciones)
  );
  const porUrl = new Map<string, Clasificacion>();
  aMirar.forEach((url, i) => porUrl.set(url, clasificados[i]));
  const resultadoControl = (cual: "inventada" | "propia") => {
    const i = controles.findIndex((c) => c.cual === cual);
    return i === -1 ? null : { url: controles[i].url, ...clasificados[aMirar.length + i] };
  };

  const fuentes: FuenteClasificada[] = entrada.fuentes.map((f) => {
    let c: Clasificacion;
    if (f.tipo === "http") {
      c = fueraDeTope.has(f.url)
        ? noResuelve("tope-de-corrida")
        : (porUrl.get(f.url) as Clasificacion);
    } else if (f.tipo === "manual") {
      c = clasificarManual(f, entrada.hostPropio);
    } else {
      c = noResuelve("tipo-desconocido");
    }
    return { id: f.id, objetivoId: f.objetivoId, url: f.url, ...c };
  });

  const cubetas = { resuelta: 0, noResuelve: 0, aMano: 0, degradadas: 0 };
  for (const f of fuentes) {
    if (f.cubeta === "resuelta") cubetas.resuelta++;
    else if (f.cubeta === "a-mano") cubetas.aMano++;
    else cubetas.noResuelve++;
    if (f.cubeta === "resuelta" && f.degradada) cubetas.degradadas++;
  }

  // M se cuenta por AFIRMACIÓN: sin evidencia, o con alguna fuente que no
  // resuelve. «Alguna» y no «todas»: la puerta dice rojo si alguna fuente no
  // responde, y una afirmación con una fuente rota y otra sana sigue citando
  // algo que no existe.
  const afirmaciones = entrada.afirmaciones.map((a) => {
    const suyas = fuentes.filter((f) => f.objetivoId === a.id);
    const sinEvidencia = suyas.length === 0;
    const resuelve = !sinEvidencia && suyas.every((f) => f.cubeta !== "no-resuelve");
    return { id: a.id, resuelve, sinEvidencia };
  });
  const m = afirmaciones.filter((a) => !a.resuelve).length;
  const afirmacionesSinEvidencia = afirmaciones.filter((a) => a.sinEvidencia).length;

  const porTipo: Record<string, { n: number; m: number }> = { claim: { n: 0, m: 0 }, goal: { n: 0, m: 0 } };
  entrada.afirmaciones.forEach((a, i) => {
    const cubeta = (porTipo[a.tipo] ??= { n: 0, m: 0 });
    cubeta.n++;
    if (!afirmaciones[i].resuelve) cubeta.m++;
  });

  const inventada = resultadoControl("inventada");
  const propiaControl = resultadoControl("propia");
  const subioNoResuelve =
    (inventada?.cubeta === "no-resuelve" ? 1 : 0) + (propiaControl?.cubeta === "no-resuelve" ? 1 : 0);
  const contraprueba: Contraprueba = {
    inventada,
    propia: propiaControl,
    subioNoResuelve,
    ok:
      inventada !== null &&
      propiaControl !== null &&
      inventada.cubeta === "no-resuelve" &&
      propiaControl.cubeta === "no-resuelve" &&
      propiaControl.motivo === "origen-propio" &&
      subioNoResuelve === 2,
  };

  const motivosRojo: MotivoRojo[] = [];
  if (!propio) motivosRojo.push("dominio-propio-desconocido");
  if (n === 0) motivosRojo.push("n-cero");
  if (m > 0) motivosRojo.push("afirmaciones-sin-evidencia-resoluble");
  if (cubetas.noResuelve > 0) motivosRojo.push("fuentes-que-no-resuelven");
  // En enteros: aMano / n <= 20% es 100·aMano <= 20·n. Sin flotantes que
  // redondeen un 20,4% a «20». El numerador cuenta FUENTES a mano y el
  // denominador AFIRMACIONES: mezcla unidades, y sólo puede hacer el tope más
  // estricto (una afirmación con dos manuales suma dos), nunca diluirlo.
  if (cubetas.aMano * 100 > TOPE_A_MANO_PORCENTAJE * n) motivosRojo.push("a-mano-sobre-el-tope");
  if (!contraprueba.ok) motivosRojo.push("contraprueba-fallida");

  const resultado: ResultadoChequeo = {
    ok: true,
    n,
    m,
    porTipo,
    cubetas,
    // Sobre N, que son AFIRMACIONES, y no sobre la cantidad de fuentes: con
    // fuentes en el denominador, cargar URLs sanas de relleno diluiría el 20%
    // sin bajar cuánto depende la ficha de lo declarado a mano.
    porcentajeAMano: porcentaje(cubetas.aMano, n),
    afirmacionesSinEvidencia,
    fuentes,
    afirmaciones,
    contraprueba,
    motivosRojo,
    verde: motivosRojo.length === 0,
    linea: "",
  };
  resultado.linea = lineaDeSalida(resultado);
  return resultado;
}

/**
 * La línea que la puerta pide, con las tres cubetas, el porcentaje a mano y la
 * contraprueba. Es lo que se pega en BLOQUEOS.md: un número sin su línea de
 * salida se recuerda, no se mide.
 */
export function lineaDeSalida(r: Omit<ResultadoChequeo, "linea">): string {
  const pct = r.porcentajeAMano === null ? "sin denominador" : `${r.porcentajeAMano}% de N`;
  const control = (c: Contraprueba["inventada"]) =>
    c === null ? "no corrió" : `${c.cubeta}${c.motivo ? ` (${c.motivo})` : ""}`;
  const tipos = [
    "claim",
    "goal",
    ...Object.keys(r.porTipo)
      .filter((t) => t !== "claim" && t !== "goal")
      .sort(),
  ]
    .map((t) => `${t} N=${r.porTipo[t]?.n ?? 0} M=${r.porTipo[t]?.m ?? 0}`)
    .join(", ");
  return (
    `${r.n} afirmaciones, ${r.m} sin evidencia resoluble` +
    ` | fuentes: ${r.cubetas.resuelta} resueltas (${r.cubetas.degradadas} degradadas a GET),` +
    ` ${r.cubetas.noResuelve} no resuelven, ${r.cubetas.aMano} verificadas a mano = ${pct}` +
    ` (tope ${TOPE_A_MANO_PORCENTAJE}%)` +
    ` | contraprueba: inventada ${control(r.contraprueba.inventada)},` +
    ` propia ${control(r.contraprueba.propia)}, no-resuelve +${r.contraprueba.subioNoResuelve}` +
    ` | por tipo: ${tipos}` +
    ` | ${r.verde ? "VERDE" : `ROJO: ${r.motivosRojo.join(", ")}`}`
  );
}
