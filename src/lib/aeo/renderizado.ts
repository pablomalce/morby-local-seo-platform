/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría AEO diga cuánto texto trae el HTML SERVIDO y no tenga contra
 * qué compararlo. La puerta H2-GO-1 pide los dos números —«los caracteres de
 * texto del HTML sin ejecutar JS frente a los del DOM renderizado»— porque con
 * uno solo no se distingue una página corta de una que se dibuja en el cliente:
 * 300 caracteres servidos es un defecto de contenido si renderizada también
 * tiene 300, y es un defecto de JavaScript si renderizada tiene 3 000.
 *
 * Esto abre la URL en Chromium sin interfaz, espera a que el documento cargue y
 * la red se aquiete, y cuenta `document.body.innerText` con la MISMA función
 * que cuenta el lado servido (`contarCaracteres` de `lectura.ts`).
 *
 * Y EL LADO SERVIDO TAMBIÉN SE MIDE ACÁ, CON LA MISMA EXTRACCIÓN. Contar el
 * HTML servido sacándole las etiquetas (`textoSinJavaScript`) cuenta lo que
 * el CSS oculta, y `innerText` no: MEDIDO con Chrome 154 (P4), una página con
 * un mega-menú `display: none` de 1 671 caracteres servidos y TODO lo visible
 * (3 189) dibujado por JavaScript salía VERDE —1 671 es más de la mitad de
 * 3 189— aunque una persona no vea ni una letra que no venga del JavaScript.
 * Por eso, con el mismo navegador, se abre una segunda pestaña con el
 * JavaScript APAGADO, se le entrega el mismo documento que recibió la primera
 * (de la caché de esta medición: no se pide dos veces) y se cuenta su
 * `innerText`, sin `<noscript>`: es el texto que se VE sin ejecutar nada.
 *
 * TRES ESTADOS, Y NINGÚN CERO INVENTADO
 *
 * `medido` trae el número; `fallo` trae un código con nombre —`timeout`,
 * `sin-navegador`, `http_404`, `red-no-publica`…— y NINGÚN número. Un render que
 * no se pudo hacer no es una página vacía: si devolviera 0, «servido 0 contra
 * renderizado 0» se leería como «la página no depende de JavaScript», que es
 * exactamente el verde que la puerta prohíbe. El tercer estado es la AUSENCIA
 * del campo en una lectura vieja, y `hallazgos.ts` lo trata igual que un fallo:
 * no medido.
 *
 * EL NAVEGADOR SALE A URLs QUE ELIGIÓ UN CLIENTE, ASÍ QUE ESTO ES SSRF
 *
 * El sitio sale de `businesses.website`, que carga un usuario, y la página que
 * se abre ejecuta JavaScript ajeno: puede pedir lo que quiera, a donde quiera,
 * con la red de la plataforma. En la función de Vercel eso incluye la API de
 * runtime de Lambda en loopback y, en cualquier nube, la metadata en
 * `169.254.169.254`. Interceptar los pedidos y abortar los que van a una red
 * privada NO alcanza, y está MEDIDO con Chrome contra un servidor canario local
 * (ver `renderizado.integracion.test.ts`):
 *
 *   - un `WebSocket` no pasa por la intercepción de puppeteer: con la
 *     intercepción puesta y el pedido HTTP abortado, el canario recibió el
 *     `UPGRADE`;
 *   - un `<link rel="preconnect">` abre el socket TCP sin hacer ningún pedido
 *     HTTP: el canario contó 3 conexiones con todos los pedidos abortados;
 *   - y aunque se interceptara todo, `continue()` deja que Chromium resuelva el
 *     nombre OTRA VEZ por su cuenta. Entre el examen y la conexión hay una
 *     segunda consulta DNS, y un DNS hostil contesta una IP pública a la
 *     primera y `169.254.169.254` a la segunda (rebinding).
 *
 * Por eso el navegador NO TIENE RED. `chromium.ts` lo arranca con un proxy que
 * no existe (`127.0.0.1:1`, sin la excepción de loopback) y con su resolvedor
 * de nombres apagado: lo que Chromium intente por su cuenta —WebSocket,
 * preconnect, WebRTC, un service worker— muere en su propia máquina. Y TODO
 * pedido que el navegador necesita para dibujar la página lo hace este archivo,
 * en Node, y se lo ENTREGA con `responder()`:
 *
 *   1. sólo `http:` y `https:` salen a la red. `data:`, `blob:` y `about:` son
 *      del propio navegador y no salen; cualquier otro esquema se aborta;
 *   2. sólo los puertos 80 y 443, y nada de `usuario:clave@`;
 *   3. el nombre se resuelve ANTES de pedir, y se rechaza si CUALQUIERA de sus
 *      direcciones no es pública —la misma `esIpPublica` del chequeo de
 *      evidencia de H1.4, no una segunda lista—;
 *   4. el transporte conecta a la dirección examinada, no a una segunda
 *      resolución, y eso es lo que cierra el rebinding;
 *   5. las redirecciones NO las sigue Node: se le entrega el 3xx al navegador,
 *      que pide el destino, y ese pedido nuevo vuelve a pasar por 1–4. Una
 *      redirección a `127.0.0.1` es un pedido más, y se aborta como cualquiera;
 *   6. una respuesta que se declara descarga (`Content-Disposition:
 *      attachment`) no se entrega, y además el navegador tiene las descargas
 *      denegadas (`chromium.ts`).
 *
 * La URL inicial pasa por el mismo examen ANTES de arrancar el navegador: un
 * sitio cargado como `http://10.0.0.7/` no cuesta un Chromium, y la consulta
 * DNS que lo decide pasa por `node:dns`, donde la ve el espía de
 * `precondicionRutas.test.ts`.
 *
 * CUÁNDO SE LEE
 *
 * No a la primera quietud de red. MEDIDO con Chrome 154 (P2): una página que
 * pone 8 699 caracteres con un `setTimeout` de 1,5 s, sin pedir nada, salía
 * con 1 669 renderizados —se leía a los ~500 ms de red quieta— y el punto en
 * VERDE con el 84 % del texto dibujado por JavaScript. Lo mismo vale para la
 * hidratación perezosa, `requestIdleCallback` y las secciones que un
 * `IntersectionObserver` dibuja cuando se las ve. Por eso, después de la
 * quietud de red:
 *
 *   1. se recorre la página hasta el final (`desplazar`), para que lo que se
 *      dibuja al verse se dibuje;
 *   2. se lee el texto cada `sondeoMs` hasta que su MÁXIMO no crezca durante
 *      `quietudDomMs`, y se devuelve ese máximo —un carrusel que cambia de
 *      texto sin crecer no impide la lectura, y contar de más del lado
 *      renderizado empuja al rojo, nunca al verde—;
 *   3. si al vencer `topeDomMs` el texto SIGUE creciendo, el número no se
 *      devuelve: `inestable`, y el punto queda «no medido». Un número parcial
 *      sería el verde que la puerta prohíbe.
 *
 * Lo que NO alcanza, dicho: un texto que aparece más de `quietudDomMs`
 * después del último cambio no se ve. Es un umbral escrito, no una medición.
 *
 * EL TIEMPO
 *
 * `TOPE_MS` es TOTAL: arranque del navegador —en Vercel incluye descomprimir
 * Chromium la primera vez—, navegación, quietud, recorrido, lectura y la
 * pestaña sin JavaScript. La ruta lo corre en paralelo con los pedidos por
 * agente, después de traer la portada (8 s), así que el peor caso es 8 + 25 +
 * 5 de cierre = 38 s, dentro de los 59 s de `maxDuration` de la ruta (59 y no
 * 60 a propósito: ver la ruta). El navegador se cierra en `finally`, también
 * cuando vence el plazo, y si el cierre se cuelga `chromium.ts` mata el proceso.
 *
 * LO QUE ESTE ARCHIVO NO SABE
 *
 * No sabe de puppeteer ni de `node:http`: el navegador, el transporte y el DNS
 * se inyectan, como `peticion.ts` inyecta `fetch`. Así los tests recorren la
 * secuencia entera —redirección a loopback, subrecurso a la metadata, nombre que
 * resuelve a `10.x`— con dobles, y además con el Chromium de verdad.
 */
import { esIpPublica, type Resolucion } from "@/lib/profile/evidenceCheck";
import { contarCaracteres } from "./lectura";

// ─────────────────────────────────────────────────────────────────────────────
// El resultado
// ─────────────────────────────────────────────────────────────────────────────

/** Por qué el examen de un destino lo rechazó, antes de cualquier conexión. */
export type MotivoDeBloqueo =
  | "esquema"
  | "credenciales"
  | "puerto"
  | "red-no-publica"
  | "no-resuelve";

/** Por qué el transporte no trajo una respuesta. */
export type MotivoDeTransporte = "timeout" | "sin-respuesta" | "tls" | "demasiado-grande";

/**
 * Lista cerrada más `http_<status>`. Un motivo libre sería texto, y lo que se
 * hace con esto es decidir un color.
 */
export type CodigoDeFallo =
  | "timeout"
  | "sin-navegador"
  | "navegacion"
  | "lectura"
  | "lectura-servida"
  | "inestable"
  | "descarga"
  | MotivoDeBloqueo
  | MotivoDeTransporte
  | `http_${number}`;

export type ResultadoRenderizado =
  | {
      estado: "medido";
      /** El texto visible CON JavaScript. */
      caracteres: number;
      /**
       * El texto visible SIN JavaScript: el mismo documento en una pestaña con
       * el JavaScript apagado, con la misma extracción. Opcional para que las
       * lecturas viejas sigan valiendo; sin él, la regla usa el conteo del HTML.
       */
      servidos?: number;
    }
  | { estado: "fallo"; codigo: CodigoDeFallo };

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se inyecta
// ─────────────────────────────────────────────────────────────────────────────

/** Un pedido ya examinado: la dirección a la que se conecta está decidida. */
export interface PedidoHttp {
  url: string;
  /** La dirección que pasó el examen. El transporte conecta ACÁ, no re-resuelve. */
  ip: string;
  metodo: string;
  encabezados: Record<string, string>;
  cuerpo?: string;
  timeoutMs: number;
  /** Bytes de cuerpo como máximo, ya descomprimido. Pasado eso, `demasiado-grande`. */
  maxBytes: number;
  /**
   * Sólo el status y los encabezados: el cuerpo no se lee y la conexión se
   * corta. Lo usan los pedidos de la ruta que preguntan «¿cómo trata el sitio a
   * este agente?» (`red.ts`), no el navegador, que necesita el cuerpo.
   */
  sinCuerpo?: boolean;
}

export type RespuestaHttp =
  | {
      tipo: "respuesta";
      status: number;
      encabezados: Record<string, string | string[]>;
      cuerpo: Buffer;
    }
  | { tipo: "error"; motivo: MotivoDeTransporte };

export type Transporte = (pedido: PedidoHttp) => Promise<RespuestaHttp>;

/** El DNS: TODAS las direcciones del nombre. La señal corta la consulta. */
export type Resolvedor = (host: string, senal: AbortSignal) => Promise<Resolucion>;

/** Un pedido que el navegador quiere hacer, detenido antes de salir. */
export interface PedidoDelNavegador {
  url: string;
  metodo: string;
  encabezados: Record<string, string>;
  cuerpo?: string;
  /** El tipo de recurso como lo nombra Chromium: `document`, `script`, `image`… */
  tipo: string;
  /** La navegación del documento de la pestaña, incluido cada salto de redirección. */
  esDocumentoPrincipal: boolean;
  /** Sólo para lo que no sale a la red: `data:`, `blob:`, `about:`. */
  continuar(): Promise<void>;
  abortar(): Promise<void>;
  responder(respuesta: {
    status: number;
    encabezados: Record<string, string | string[]>;
    cuerpo: Buffer;
  }): Promise<void>;
}

export interface PaginaAbierta {
  /** Desde que esto resuelve, TODO pedido de la página pasa por `atender`. */
  interceptar(atender: (pedido: PedidoDelNavegador) => Promise<void>): Promise<void>;
  /** Navega hasta el `load` del documento, o rechaza: bloqueado, red, plazo. */
  navegar(url: string, timeoutMs: number): Promise<void>;
  /** Espera a que la red se aquiete, como mucho `timeoutMs`. Nunca rechaza. */
  esperarQuietud(timeoutMs: number): Promise<void>;
  /**
   * Recorre la página de arriba abajo, una ventana por vez, como mucho
   * `timeoutMs`: lo que se dibuja al verse (`IntersectionObserver`, carga
   * perezosa) se dibuja. Nunca rechaza.
   */
  desplazar(timeoutMs: number): Promise<void>;
  /** `document.body.innerText`, crudo: la normalización es de este archivo. */
  textoVisible(): Promise<string>;
}

export interface NavegadorAbierto {
  /**
   * `javascript: false` es la pestaña del lado servido: no corre ningún
   * script, y `textoVisible` no cuenta `<noscript>` (que sin JavaScript sí se
   * dibuja) para contar lo mismo que el lado renderizado.
   */
  nuevaPagina(opciones?: { javascript?: boolean }): Promise<PaginaAbierta>;
  /** Cierra, y si no cierra a tiempo, mata. Nunca rechaza. */
  cerrar(): Promise<void>;
}

export type AbrirNavegador = () => Promise<NavegadorAbierto>;

export interface DependenciasRender {
  abrirNavegador: AbrirNavegador;
  transporte: Transporte;
  resolver: Resolvedor;
  /** El reloj y la espera van juntos: un test con reloj propio no duerme de verdad. */
  ahora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

export interface OpcionesRender {
  /** Presupuesto TOTAL: arranque, navegación, quietud y lectura. */
  topeMs: number;
  /** Plazo de cada pedido que hace el transporte. */
  plazoPorPedidoMs: number;
  /** Cuánto se espera, después del `load`, a que la red quede quieta. */
  quietudMs: number;
  /** Cuánto se recorre la página, como mucho, para que se dibuje lo perezoso. */
  desplazarMs: number;
  /** Cuánto tiempo sin que el texto crezca hace falta para leerlo. */
  quietudDomMs: number;
  /** Cada cuánto se vuelve a leer el texto mientras se espera esa quietud. */
  sondeoMs: number;
  /** Cuánto se espera esa quietud, como mucho: pasado esto, `inestable`. */
  topeDomMs: number;
  /** Cuánto se espera al cierre antes de matar el proceso. */
  cierreMs: number;
  maxBytesPorRespuesta: number;
  maxBytesTotales: number;
}

export const OPCIONES_RENDER: OpcionesRender = {
  topeMs: 25_000,
  plazoPorPedidoMs: 8_000,
  quietudMs: 3_000,
  desplazarMs: 2_000,
  quietudDomMs: 2_000,
  sondeoMs: 250,
  topeDomMs: 8_000,
  cierreMs: 5_000,
  maxBytesPorRespuesta: 5 * 1024 * 1024,
  maxBytesTotales: 25 * 1024 * 1024,
};

// ─────────────────────────────────────────────────────────────────────────────
// El examen de un destino
// ─────────────────────────────────────────────────────────────────────────────

export type Examen = { ok: true; ip: string } | { ok: false; motivo: MotivoDeBloqueo };

const ESQUEMAS_DE_RED = new Set(["http:", "https:"]);
/** No salen a la red: el contenido ya está en el navegador. */
const ESQUEMAS_LOCALES = new Set(["data:", "blob:", "about:"]);

/**
 * La IP escrita en la URL, sin corchetes, o null si el host es un nombre.
 *
 * Se apoya en que el `URL` de WHATWG ya normalizó el host: `http://2130706433/`,
 * `http://0x7f000001/` y `http://127.1/` llegan acá como `127.0.0.1`, y una IPv6
 * llega siempre entre corchetes. Por eso alcanza con mirar la forma, y no hace
 * falta `node:net` en este archivo.
 */
function ipLiteral(hostname: string): string | null {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return hostname;
  return null;
}

/**
 * Examina un destino ANTES de cualquier conexión, y devuelve la dirección a la
 * que hay que conectar. Un examinador por medición, con su caché por nombre: el
 * mismo host da la misma dirección en toda la página, y un recurso no le
 * cuesta otra consulta DNS a cada imagen.
 */
export type Examinador = (url: URL, senal: AbortSignal) => Promise<Examen>;

export function crearExaminador(resolver: Resolvedor): Examinador {
  const cache = new Map<string, Promise<Resolucion>>();

  return async function examinar(url: URL, senal: AbortSignal): Promise<Examen> {
    if (!ESQUEMAS_DE_RED.has(url.protocol)) return { ok: false, motivo: "esquema" };
    if (url.username !== "" || url.password !== "") return { ok: false, motivo: "credenciales" };
    const puerto = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    if (puerto !== 80 && puerto !== 443) return { ok: false, motivo: "puerto" };

    // Una IP escrita en la URL no se resuelve: se examina tal cual. Una pública
    // pasa —un recurso servido por IP es raro, no peligroso—; cualquier otra no.
    const literal = ipLiteral(url.hostname);
    if (literal !== null) {
      return esIpPublica(literal) ? { ok: true, ip: literal } : { ok: false, motivo: "red-no-publica" };
    }

    const host = url.hostname.toLowerCase();
    let resolucion = cache.get(host);
    if (!resolucion) {
      resolucion = resolver(host, senal).catch((): Resolucion => ({ ok: false }));
      cache.set(host, resolucion);
    }
    const r = await resolucion;
    if (!r.ok || r.direcciones.length === 0) return { ok: false, motivo: "no-resuelve" };
    // TODAS públicas, no alguna: un nombre con una A pública y otra privada
    // deja que la conexión elija, y quien elige es el atacante.
    if (!r.direcciones.every(esIpPublica)) return { ok: false, motivo: "red-no-publica" };
    return { ok: true, ip: r.direcciones[0] };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// El interceptor
// ─────────────────────────────────────────────────────────────────────────────

/** Los métodos que una página usa para LEER. El resto escribe, y no se manda. */
const METODOS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);

/**
 * Tipos de recurso que no cambian `innerText`: una imagen, un video o una
 * fuente no agregan ni quitan un carácter de texto visible. Se abortan para que
 * el presupuesto de tiempo y de bytes vaya a lo que sí lo cambia —el documento,
 * los scripts, el CSS (que puede ocultar texto) y los datos que traen los
 * scripts—. El `alt` de una imagen tampoco está en `innerText`.
 */
const SIN_TEXTO = new Set(["image", "media", "font"]);

/** Encabezados que no se reenvían: son del salto, o los pone el transporte. */
const DEL_SALTO = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
  "content-length",
]);

/** Los que no se le devuelven al navegador: el cuerpo ya viene decodificado y medido. */
const DE_LA_RESPUESTA = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

export interface Bitacora {
  /** Cada pedido que no salió, con su motivo. Para los tests y para el diagnóstico. */
  bloqueados: Array<{ url: string; motivo: MotivoDeBloqueo | MotivoDeTransporte | "metodo" | "sin-texto" | "descarga" | "presupuesto" }>;
  /** Cada pedido que el transporte hizo de verdad, con la dirección a la que conectó. */
  pedidos: Array<{ url: string; ip: string }>;
  /** El status del documento principal, el último de la cadena de redirecciones. */
  statusDocumento: number | null;
  /** Si un salto del documento principal no salió, por qué. */
  falloDocumento: CodigoDeFallo | null;
}

function nuevaBitacora(): Bitacora {
  return { bloqueados: [], pedidos: [], statusDocumento: null, falloDocumento: null };
}

function esDescarga(encabezados: Record<string, string | string[]>): boolean {
  const disposicion = encabezados["content-disposition"];
  const valor = Array.isArray(disposicion) ? disposicion.join(",") : (disposicion ?? "");
  return /^\s*attachment/i.test(valor);
}

/**
 * Atiende UN pedido del navegador: lo deja pasar sin red, lo aborta, o lo hace
 * en Node y le entrega la respuesta. Nunca lo deja colgado: cualquier excepción
 * termina en `abortar()`.
 */
/** Las respuestas que ya se entregaron, por URL, para la pestaña sin JavaScript. */
export type CacheDeRespuestas = Map<
  string,
  { status: number; encabezados: Record<string, string | string[]>; cuerpo: Buffer }
>;

export function crearInterceptor(
  deps: Pick<DependenciasRender, "transporte" | "resolver">,
  opciones: OpcionesRender,
  bitacora: Bitacora,
  restanteMs: () => number,
  senal: AbortSignal,
  examinar: Examinador = crearExaminador(deps.resolver),
  cache: { guardarEn?: CacheDeRespuestas; servirDesde?: CacheDeRespuestas } = {}
) {
  let bytesTotales = 0;

  return async function atender(pedido: PedidoDelNavegador): Promise<void> {
    const bloquear = async (motivo: Bitacora["bloqueados"][number]["motivo"]) => {
      bitacora.bloqueados.push({ url: pedido.url, motivo });
      if (pedido.esDocumentoPrincipal && motivo !== "sin-texto") {
        bitacora.falloDocumento =
          motivo === "presupuesto" ? "timeout" : motivo === "metodo" ? "navegacion" : motivo;
      }
      await pedido.abortar();
    };

    try {
      let url: URL;
      try {
        url = new URL(pedido.url);
      } catch {
        return await bloquear("esquema");
      }

      if (ESQUEMAS_LOCALES.has(url.protocol)) return await pedido.continuar();
      if (!ESQUEMAS_DE_RED.has(url.protocol)) return await bloquear("esquema");
      if (!METODOS.has(pedido.metodo.toUpperCase())) return await bloquear("metodo");
      if (!pedido.esDocumentoPrincipal && SIN_TEXTO.has(pedido.tipo)) return await bloquear("sin-texto");
      if (senal.aborted) return await bloquear("presupuesto");

      // La pestaña sin JavaScript recibe lo MISMO que recibió la primera, sin
      // volver a la red: el examen ya se hizo cuando se pidió.
      const guardada = pedido.metodo.toUpperCase() === "GET" ? cache.servirDesde?.get(url.toString()) : undefined;
      if (guardada) {
        if (pedido.esDocumentoPrincipal) bitacora.statusDocumento = guardada.status;
        return await pedido.responder(guardada);
      }

      const examen = await examinar(url, senal);
      if (!examen.ok) return await bloquear(examen.motivo);

      const plazo = Math.min(opciones.plazoPorPedidoMs, restanteMs());
      const quedan = opciones.maxBytesTotales - bytesTotales;
      if (plazo <= 0 || quedan <= 0) return await bloquear("presupuesto");

      const encabezados: Record<string, string> = {};
      for (const [nombre, valor] of Object.entries(pedido.encabezados)) {
        if (!DEL_SALTO.has(nombre.toLowerCase())) encabezados[nombre.toLowerCase()] = valor;
      }

      bitacora.pedidos.push({ url: pedido.url, ip: examen.ip });
      const respuesta = await deps.transporte({
        url: url.toString(),
        ip: examen.ip,
        metodo: pedido.metodo.toUpperCase(),
        encabezados,
        cuerpo: pedido.cuerpo,
        timeoutMs: plazo,
        maxBytes: Math.min(opciones.maxBytesPorRespuesta, quedan),
      });
      if (respuesta.tipo === "error") return await bloquear(respuesta.motivo);
      if (esDescarga(respuesta.encabezados)) return await bloquear("descarga");

      bytesTotales += respuesta.cuerpo.length;
      if (pedido.esDocumentoPrincipal) bitacora.statusDocumento = respuesta.status;

      const devueltos: Record<string, string | string[]> = {};
      for (const [nombre, valor] of Object.entries(respuesta.encabezados)) {
        if (!DE_LA_RESPUESTA.has(nombre.toLowerCase())) devueltos[nombre.toLowerCase()] = valor;
      }
      const entregada = { status: respuesta.status, encabezados: devueltos, cuerpo: respuesta.cuerpo };
      if (pedido.metodo.toUpperCase() === "GET") cache.guardarEn?.set(url.toString(), entregada);
      await pedido.responder(entregada);
    } catch {
      // Un pedido que el interceptor no supo atender NO sale: abortado. Dejarlo
      // colgado frenaría el `load`, y dejarlo seguir sería salir sin examen.
      await pedido.abortar().catch(() => {});
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// La medición
// ─────────────────────────────────────────────────────────────────────────────

function fallo(codigo: CodigoDeFallo): ResultadoRenderizado {
  return { estado: "fallo", codigo };
}

const dormir = (ms: number) => new Promise<void>((listo) => setTimeout(listo, Math.max(ms, 0)));

/**
 * Lee el texto visible hasta que su MÁXIMO deje de crecer durante
 * `quietudDomMs`, y devuelve ese máximo. Si el tope llega con el texto todavía
 * creciendo, `inestable`: el número de ese momento es parcial, y un parcial
 * del lado renderizado es un verde inventado.
 */
async function leerCuandoSeQuede(
  pagina: PaginaAbierta,
  opciones: OpcionesRender,
  topeMs: number,
  ahora: () => number,
  esperar: (ms: number) => Promise<void>
): Promise<number | "inestable" | "plazo"> {
  const inicio = ahora();
  let maximo = contarCaracteres(await pagina.textoVisible());
  let crecioEn = inicio;
  while (ahora() - crecioEn < opciones.quietudDomMs) {
    // Al tope: si el texto creció mientras se miraba, sigue creciendo y el
    // número es parcial; si no creció pero no hubo tiempo de ver una quietud
    // entera, es el presupuesto el que no alcanzó, no la página.
    if (ahora() - inicio >= topeMs) return crecioEn === inicio ? "plazo" : "inestable";
    await esperar(opciones.sondeoMs);
    const n = contarCaracteres(await pagina.textoVisible());
    if (n > maximo) {
      maximo = n;
      crecioEn = ahora();
    }
  }
  return maximo;
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
 * Los caracteres de texto del DOM renderizado de `url`, o el motivo por el que
 * no se pudieron medir.
 *
 * `bitacora`, si se pasa, se llena con lo que salió y lo que no: la ruta no la
 * necesita, los tests sí.
 */
export async function medirRenderizado(
  url: string,
  deps: DependenciasRender,
  opciones: OpcionesRender = OPCIONES_RENDER,
  bitacora: Bitacora = nuevaBitacora()
): Promise<ResultadoRenderizado> {
  const ahora = deps.ahora ?? Date.now;
  const esperar = deps.esperar ?? dormir;
  const limite = ahora() + opciones.topeMs;
  const restante = () => limite - ahora();
  const corte = new AbortController();

  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return fallo("esquema");
  }

  // UN examinador para toda la medición: la URL inicial y cada pedido del
  // navegador comparten su caché, así que un nombre se resuelve una sola vez y
  // da la misma dirección de principio a fin. Dos examinadores serían dos
  // consultas DNS, y entre las dos un DNS hostil cambia la respuesta.
  const examinar = crearExaminador(deps.resolver);
  // Lo que la pestaña con JavaScript recibió, para entregárselo igual a la
  // pestaña sin JavaScript.
  const respuestas: CacheDeRespuestas = new Map();

  // La URL inicial se examina ANTES de arrancar nada: un destino prohibido no
  // cuesta un Chromium. El interceptor la vuelve a ver —es un pedido más— y la
  // caché le da la misma respuesta.
  const previo = await conPlazo(examinar(destino, corte.signal), restante(), () => corte.abort());
  if (previo === "plazo") return fallo("timeout");
  if (!previo.ok) return fallo(previo.motivo);

  // En un objeto y no en dos `let`: lo escribe el trabajo y lo lee el
  // `finally`, y así el cierre ve lo que de verdad pasó.
  const vivo: { navegador: NavegadorAbierto | null; arranque: Promise<NavegadorAbierto> | null } = {
    navegador: null,
    arranque: null,
  };

  const trabajo = async (): Promise<ResultadoRenderizado> => {
    try {
      vivo.arranque = deps.abrirNavegador();
      vivo.navegador = await vivo.arranque;
    } catch {
      return fallo("sin-navegador");
    }
    if (corte.signal.aborted) return fallo("timeout");

    try {
      const pagina = await vivo.navegador.nuevaPagina();
      await pagina.interceptar(
        crearInterceptor(deps, opciones, bitacora, restante, corte.signal, examinar, { guardarEn: respuestas })
      );

      try {
        await pagina.navegar(destino.toString(), Math.max(restante(), 1));
      } catch {
        // El motivo que vio el interceptor manda sobre el error de puppeteer:
        // `net::ERR_BLOCKED_BY_CLIENT` no dice si fue una IP privada o un DNS
        // que no contestó, y la bitácora sí.
        if (bitacora.falloDocumento) return fallo(bitacora.falloDocumento);
        return fallo(corte.signal.aborted || restante() <= 0 ? "timeout" : "navegacion");
      }

      await pagina.esperarQuietud(Math.min(opciones.quietudMs, Math.max(restante() - 1_000, 0)));

      // Después de la quietud, y no antes: un script puede mandar la pestaña a
      // otra URL —`location.href = …`— mientras se espera, y ese salto también
      // pasa por el examen. Si lo rechazó, o si contestó 4xx/5xx, lo que se
      // leería es una página de error de Chromium, no el sitio.
      if (bitacora.falloDocumento) return fallo(bitacora.falloDocumento);
      if (bitacora.statusDocumento === null) return fallo("navegacion");
      if (bitacora.statusDocumento >= 400) return fallo(`http_${bitacora.statusDocumento}`);

      // Lo que se dibuja al verse, y lo que llega tarde sin pedir nada a la
      // red: ver «CUÁNDO SE LEE» arriba. El recorrido y la espera salen del
      // mismo presupuesto total, y dejan un segundo para cerrar.
      await pagina.desplazar(Math.min(opciones.desplazarMs, Math.max(restante() - 1_000, 0)));
      let caracteres: number | "inestable" | "plazo";
      try {
        caracteres = await leerCuandoSeQuede(
          pagina,
          opciones,
          Math.min(opciones.topeDomMs, Math.max(restante() - 1_000, 0)),
          ahora,
          esperar
        );
      } catch {
        return fallo("lectura");
      }
      if (caracteres === "inestable") return fallo("inestable");
      if (caracteres === "plazo") return fallo("timeout");

      // El lado servido, con la misma extracción: ver el encabezado (P4). Si
      // no se puede medir, el resultado no se da: el número del HTML cuenta
      // lo oculto, y con él la página del mega-menú vuelve a salir verde.
      const servida = nuevaBitacora();
      try {
        const sinJs = await vivo.navegador.nuevaPagina({ javascript: false });
        await sinJs.interceptar(
          crearInterceptor(deps, opciones, servida, restante, corte.signal, examinar, { servirDesde: respuestas })
        );
        await sinJs.navegar(destino.toString(), Math.max(restante(), 1));
        bitacora.pedidos.push(...servida.pedidos);
        bitacora.bloqueados.push(...servida.bloqueados);
        if (servida.falloDocumento || servida.statusDocumento === null || servida.statusDocumento >= 400) {
          return fallo("lectura-servida");
        }
        const servidos = contarCaracteres(await sinJs.textoVisible());
        return { estado: "medido", caracteres, servidos };
      } catch {
        return fallo(corte.signal.aborted ? "timeout" : "lectura-servida");
      }
    } catch {
      return fallo(corte.signal.aborted ? "timeout" : "navegacion");
    }
  };

  try {
    const resultado = await conPlazo(trabajo(), restante(), () => corte.abort());
    return resultado === "plazo" ? fallo("timeout") : resultado;
  } finally {
    corte.abort();
    // El navegador se cierra SIEMPRE. Si el plazo venció durante el arranque,
    // `vivo.navegador` todavía es null y el arranque sigue en vuelo: se lo
    // espera —con tope— para cerrarlo, en vez de dejar un Chromium huérfano en
    // la función hasta la próxima invocación.
    let abierto = vivo.navegador;
    if (!abierto && vivo.arranque) {
      const tarde = await conPlazo(
        vivo.arranque.catch(() => null),
        opciones.cierreMs
      );
      abierto = tarde === "plazo" ? null : tarde;
    }
    if (abierto) await abierto.cerrar();
  }
}
