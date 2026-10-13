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
 * la red se aquiete, y cuenta el texto del DOM con la MISMA función que cuenta
 * el HTML servido (`textoSinJavaScript` de `lectura.ts`) sobre la
 * serialización del DOM CON SUS SOMBRAS (`html()`, que en Chromium es
 * `DOM.getOuterHTML` con `includeShadowDOM`: ver `chromium.ts`, PU-2).
 *
 * Y EL LADO SERVIDO TAMBIÉN SE MIDE ACÁ, CON LA MISMA EXTRACCIÓN. Con el mismo
 * navegador se abre una segunda pestaña con el JavaScript APAGADO, se le
 * entrega el mismo documento que recibió la primera (de la caché de esta
 * medición: no se pide dos veces) y se cuenta su DOM con la misma función. Es
 * el número que la puerta nombra —«los caracteres de texto del HTML sin
 * ejecutar JS»— leído del mismo documento que el renderizado.
 *
 * NINGÚN LADO APLICA CSS, A PROPÓSITO (GATE-1). Un rastreador que no ejecuta
 * JavaScript tampoco aplica CSS: lee el texto del HTML entero, también el que
 * una hoja de estilos oculta. Contar «lo visible sin JavaScript» (`innerText`)
 * ponía BLOQUEANTE a las páginas SSR que ocultan su texto hasta que corre el
 * JavaScript —`elementor-invisible`, un anti-FOUC en `<html>`, un `<style>`
 * dentro de `<noscript>`—: MEDIDO con Chrome 154 y la ruta, la web de Vulkan
 * (WordPress con Elementor) salía 1 550 servidos contra 4 405, y con el HTML
 * son 5 447. Y del lado renderizado tampoco se aplica: si sólo un lado contara
 * lo oculto, la diferencia la inventaría la extracción. Así, un mega-menú
 * `display: none` servido cuenta de los dos lados, y lo que el JavaScript
 * agrega —visible u oculto— cuenta sólo del renderizado: es texto que el
 * rastreador no recibe. MEDIDO con Chrome 154: P4 sigue rojo (1 669 servidos
 * contra 4 841), y `elementor-invisible`, el anti-FOUC y el `<style>` en
 * `<noscript>` salen verdes (servido igual a renderizado).
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
 * Y UN NÚMERO SÓLO VALE SI LLEGÓ LO QUE ESCRIBE EL TEXTO (RT-1)
 *
 * El JavaScript de la página escribe el texto con lo que el transporte le
 * entregó: sus scripts, los datos que esos scripts piden (`xhr`, `fetch`) y
 * sus marcos. Si uno de esos pedidos NO LLEGÓ —`timeout`, `sin-respuesta`,
 * `tls`, `demasiado-grande`, o el presupuesto de bytes o de tiempo ya
 * gastado—, el DOM que se cuenta es el que quedó sin hidratar, o la pantalla
 * de error del cliente. MEDIDO con el headless shell de producción en AL2023
 * con 1 vCPU: una página con un menú servido y el contenido en `app.js` daba
 * `medido 1249/1249` —VERDE— con el bundle demorado 9 s o de 6 MB, y contra
 * el despliegue real, 3 de 43 renders salieron `medido` con chunks de Next.js
 * en `timeout` (uno con «Application error» como todo el texto). Por eso:
 *
 *   1. si al leer queda alguno de esos pedidos EN VUELO, se lo espera y se
 *      vuelve a leer, mientras quede presupuesto; si se acaba con algo en
 *      vuelo, `subrecurso-pendiente`;
 *   2. si alguno no llegó, `subrecurso-<motivo>`, sin número: el punto queda
 *      «no medido», nunca verde.
 *
 * Lo que NO cuenta como «no llegó»: lo que se rechazó por política —una red
 * que no es pública, un puerto, un esquema, un método que escribe—, que un
 * navegador del público tampoco recibiría de esta auditoría, y un nombre que
 * NO EXISTE (`no-resuelve`: NXDOMAIN, o sin registros). Un DNS que no contestó
 * —timeout, SERVFAIL— SÍ cuenta (`dns-sin-respuesta`): antes los dos eran
 * `no-resuelve`, y un bundle cuyo CDN tuvo un timeout de DNS quedaba fuera
 * (PU-3). Tampoco cuenta lo que no escribe texto: imágenes, fuentes, CSS y
 * videos.
 *
 * NI LO QUE PIDE UN MARCO DE OTRO SITIO (RT-4)
 *
 * Lo que decide es DESDE DÓNDE sale el pedido, no sólo su tipo. Cuentan los
 * de la página, los de sus marcos del mismo sitio —su JavaScript puede
 * escribir en ella— y los que no salen de un marco (un worker le pasa los
 * datos a la página). No cuentan los que salen de un marco de OTRO sitio, ni
 * la navegación de ese marco: la política del mismo origen no le deja
 * escribir en el DOM de la página, y su propio contenido no está en la
 * serialización (`chromium.ts`, PU-2). Ante la duda —un marco `about:blank`,
 * `blob:` o sin URL— cuenta. El sitio se aproxima hacia arriba (los dos
 * últimos rótulos del nombre): se cuenta de más, nunca de menos.
 *
 * La página es el documento CONFIRMADO de la pestaña (`urlDeLaPagina`, que
 * `chromium.ts` lee de `page.mainFrame().url()`), y no el último PEDIDO de
 * navegación. Reproducido por la revisión con Chrome 155 y el headless shell
 * 153 (FV-1): una página que mandaba la pestaña a otro sitio con una
 * navegación que no se confirma —un 204, un archivo que Chromium trata como
 * descarga, un `window.stop()`— seguía siendo el documento que se lee, pero
 * sus propios `fetch` se juzgaban «de otro sitio»: el que no llegaba no
 * contaba, y salía `medido 1249/1249`, VERDE. Y lo que se decide de un pedido
 * se decide al entrar: uno de la página que estaba en vuelo cuando la pestaña
 * intentó irse cuenta igual si después no llega.
 *
 * MEDIDO contra la web real. https://vulkan-studios.com salía
 * `subrecurso-sin-respuesta` en producción (2 de 2), y acá con Chrome 155 con
 * todo lo de la página entregado. El que no llegaba era un `fetch` a
 * `brunhild.challenges.cloudflare.com` —un nombre con SÓLO registros AAAA—
 * desde el desafío de Cloudflare, dentro del reproductor de
 * `player.vimeo.com`, dentro de la página: sin ruta IPv6 no llega, y un Chrome
 * normal en una red sin IPv6 tampoco lo trae (`net::ERR_ADDRESS_UNREACHABLE`).
 * Con el headless shell 153 en un contenedor AL2023 salía
 * `subrecurso-presupuesto` 3 de 3: los `xhr` del video de Vimeo y de los
 * cinco reproductores de YouTube se esperaban como si escribieran texto, y
 * bajaban 25 MB contra 1,35 MB de la página. Con esta regla, 10 de 11
 * corridas con los dos binarios dieron `medido`, 5 892 renderizados contra
 * 5 456 servidos; la otra, un script DE LA PÁGINA que no conectó en 8 s, y
 * eso sigue siendo `subrecurso-timeout`. Por lo mismo, los bytes de esos
 * marcos salen de un presupuesto aparte (`maxBytesDeOtrosSitios`): no le
 * quitan bytes a la página.
 *
 * Lo que NO cubre, dicho: un marco de otro sitio que le pasa datos a la
 * página con `postMessage` y la página escribe texto con ellos. Si a ese
 * marco no le llegó algo, la página escribe menos y no se ve.
 *
 * EL TIEMPO
 *
 * `topeMs` es TOTAL: arranque del navegador —en Vercel incluye descomprimir
 * Chromium la primera vez—, navegación, quietud, recorrido, lectura y la
 * pestaña sin JavaScript. La ruta lo corre en paralelo con los pedidos por
 * agente, después de traer la portada (8 s), así que el peor caso es 8 + 40 +
 * 5 de cierre = 53 s, dentro de los 59 s de `maxDuration` de la ruta (59 y no
 * 60 a propósito: ver la ruta; `renderizado.test.ts` suma la cuenta). El
 * navegador se cierra en `finally`, también cuando vence el plazo, y si el
 * cierre se cuelga `chromium.ts` mata el proceso.
 *
 * 40 y no 25 (RT-2). MEDIDO con el headless shell de producción en AL2023 con
 * 1 vCPU: el arranque en frío tardó hasta 7,1 s, una página estática de
 * Next.js hasta 22,9 s en frío —y una de siete corridas, `timeout` a los
 * 24,4 s—, y la web de Vulkan 27,3 s en caliente (`timeout`). Con 25 s, la
 * primera auditoría de una instancia fría no medía sin que el sitio cambiara,
 * y la puerta pide rojo 3/3 y verde 3/3 en la MISMA corrida.
 *
 * LO QUE ESTE ARCHIVO NO SABE
 *
 * No sabe de puppeteer ni de `node:http`: el navegador, el transporte y el DNS
 * se inyectan, como `peticion.ts` inyecta `fetch`. Así los tests recorren la
 * secuencia entera —redirección a loopback, subrecurso a la metadata, nombre que
 * resuelve a `10.x`— con dobles, y además con el Chromium de verdad.
 */
import { esIpPublica, type Resolucion } from "@/lib/profile/evidenceCheck";
import { textoSinJavaScript } from "./lectura";

// ─────────────────────────────────────────────────────────────────────────────
// El resultado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Por qué el examen de un destino lo rechazó, antes de cualquier conexión.
 * `dns-sin-respuesta` NO es una política: el DNS no contestó (timeout,
 * SERVFAIL, cancelado), y un subrecurso así NO LLEGÓ —RT-1 lo cuenta—, a
 * diferencia de `no-resuelve`, que es un nombre que no existe (PU-3).
 */
export type MotivoDeBloqueo =
  | "esquema"
  | "credenciales"
  | "puerto"
  | "red-no-publica"
  | "no-resuelve"
  | "dns-sin-respuesta";

/** Por qué el transporte no trajo una respuesta. */
export type MotivoDeTransporte = "timeout" | "sin-respuesta" | "tls" | "demasiado-grande";

/**
 * Lista cerrada más `http_<status>`. Un motivo libre sería texto, y lo que se
 * hace con esto es decidir un color.
 */
/** Un pedido que escribe texto y no llegó, o que seguía en vuelo al leer (RT-1). */
export type MotivoDeSubrecurso = MotivoDeTransporte | "presupuesto" | "pendiente" | "dns-sin-respuesta";

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
  | `subrecurso-${MotivoDeSubrecurso}`
  | `http_${number}`;

export type ResultadoRenderizado =
  | {
      estado: "medido";
      /** Los caracteres de texto del DOM CON JavaScript (sin aplicar CSS). */
      caracteres: number;
      /**
       * Los caracteres de texto del HTML SIN JavaScript: el mismo documento en
       * una pestaña con el JavaScript apagado, con la misma extracción.
       * Opcional para que las lecturas viejas sigan valiendo; sin él, la regla
       * usa el conteo del HTML que trajo la ruta.
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
  /**
   * Las OTRAS direcciones del mismo nombre, todas examinadas, en orden (IPv4
   * primero): si la conexión a `ip` no se establece, el transporte prueba la
   * siguiente dentro del mismo plazo (PU-3). Ninguna es de una segunda
   * resolución.
   */
  alternativas?: string[];
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
  /**
   * La URL del documento del MARCO desde el que sale el pedido: la de la
   * página para lo que pide la página, la de un `<iframe>` para lo que pide
   * ese marco (RT-4). `null` si no sale de un marco —un worker— o no se sabe.
   * En la navegación de un marco (`document` que no es el principal) no se
   * usa: ahí el marco todavía tiene el documento anterior, y manda la URL del
   * pedido.
   */
  urlDelMarco: string | null;
  /**
   * La URL del documento CONFIRMADO de la pestaña cuando sale el pedido —el
   * que se lee—, no la del último PEDIDO de navegación (RT-4, FV-1). Una
   * navegación de la pestaña que no se confirma —un 204, una descarga
   * denegada, un `window.stop()`, una que sigue en vuelo— no cambia el
   * documento ni esto. `null`, o una URL que no es `http(s)` —`about:blank`
   * antes de la primera navegación—, no dice de qué sitio es la página, y el
   * pedido cuenta como de ella.
   */
  urlDeLaPagina: string | null;
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
  /**
   * El DOM serializado, tal como está ahora, CON cada shadow root de autor
   * como `<template shadowrootmode>` (PU-2): `outerHTML` las deja afuera, y
   * el contenido que un componente dibuja en su sombra no contaba. La
   * extracción del texto es de este archivo —`textoSinJavaScript`, la misma
   * del HTML servido—, no del navegador: ver «NINGÚN LADO APLICA CSS» arriba.
   */
  html(): Promise<string>;
}

export interface NavegadorAbierto {
  /**
   * `javascript: false` es la pestaña del lado servido: no corre ningún
   * script. Su `<noscript>` se parsea como elementos y el de la pestaña con
   * JavaScript como texto crudo; `textoSinJavaScript` lo saca de los dos.
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
  /** Bytes de lo que pide la PÁGINA —el documento, sus subrecursos y sus marcos del mismo sitio—, sumados. */
  maxBytesTotales: number;
  /**
   * Bytes de lo que piden los marcos de OTRO SITIO, sumados, en un
   * presupuesto aparte: no escriben el texto que se cuenta (RT-4), y no le
   * pueden quitar bytes a la página. MEDIDO en https://vulkan-studios.com:
   * sus cinco reproductores de YouTube y uno de Vimeo bajaron de 8,4 a 25 MB
   * por corrida, contra 1,35 MB de la página.
   */
  maxBytesDeOtrosSitios: number;
}

export const OPCIONES_RENDER: OpcionesRender = {
  topeMs: 40_000,
  plazoPorPedidoMs: 8_000,
  quietudMs: 3_000,
  desplazarMs: 2_000,
  quietudDomMs: 2_000,
  sondeoMs: 250,
  topeDomMs: 8_000,
  cierreMs: 5_000,
  maxBytesPorRespuesta: 5 * 1024 * 1024,
  maxBytesTotales: 25 * 1024 * 1024,
  maxBytesDeOtrosSitios: 10 * 1024 * 1024,
};

// ─────────────────────────────────────────────────────────────────────────────
// El examen de un destino
// ─────────────────────────────────────────────────────────────────────────────

export type Examen =
  | { ok: true; ip: string; /** Las demás direcciones del nombre, ya examinadas. */ alternativas?: string[] }
  | { ok: false; motivo: MotivoDeBloqueo };

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
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function ipLiteral(hostname: string): string | null {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1);
  if (IPV4.test(hostname)) return hostname;
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
      // Un resolvedor que TIRA no dijo que el nombre no exista: no contestó.
      resolucion = resolver(host, senal).catch((): Resolucion => ({ ok: false, transitorio: true }));
      cache.set(host, resolucion);
    }
    const r = await resolucion;
    if (!r.ok) return { ok: false, motivo: r.transitorio ? "dns-sin-respuesta" : "no-resuelve" };
    if (r.direcciones.length === 0) return { ok: false, motivo: "no-resuelve" };
    // TODAS públicas, no alguna: un nombre con una A pública y otra privada
    // deja que la conexión elija, y quien elige es el atacante.
    if (!r.direcciones.every(esIpPublica)) return { ok: false, motivo: "red-no-publica" };
    // IPv4 primero, sea cual sea el orden del DNS: una función sin ruta IPv6
    // no puede conectar a una AAAA (PU-3), y las demás quedan de alternativa.
    const ordenadas = [...r.direcciones.filter((d) => IPV4.test(d)), ...r.direcciones.filter((d) => !IPV4.test(d))];
    const [ip, ...alternativas] = ordenadas;
    return alternativas.length > 0 ? { ok: true, ip, alternativas } : { ok: true, ip };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// El interceptor
// ─────────────────────────────────────────────────────────────────────────────

/** Los métodos que una página usa para LEER. El resto escribe, y no se manda. */
const METODOS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);

/**
 * Tipos de recurso que no cambian el texto del DOM: una imagen, un video o una
 * fuente no agregan ni quitan un carácter. Se abortan para que el presupuesto
 * de tiempo y de bytes vaya a lo que sí lo cambia —el documento, los scripts y
 * los datos que traen los scripts—. El `alt` de una imagen es un atributo, y
 * tampoco cuenta.
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
  /**
   * Los pedidos que ESCRIBEN texto (scripts, datos, marcos) y no llegaron por
   * el transporte o por el presupuesto. Uno solo deja el render sin número.
   */
  noLlegaron: Array<{ url: string; tipo: string; motivo: MotivoDeTransporte | "presupuesto" | "dns-sin-respuesta" }>;
  /** Cuántos de esos pedidos están en el transporte ahora mismo. */
  enVuelo: number;
}

export function nuevaBitacora(): Bitacora {
  return { bloqueados: [], pedidos: [], statusDocumento: null, falloDocumento: null, noLlegaron: [], enVuelo: 0 };
}

/**
 * Los tipos de pedido con los que el JavaScript de la página escribe texto en
 * el DOM: el código, los datos que el código trae, y un marco (`document` que
 * no es el principal), que puede ser del mismo origen y escribir en él.
 */
const ESCRIBEN_TEXTO = new Set(["script", "xhr", "fetch", "document"]);

/**
 * El sitio de un host, aproximado HACIA ARRIBA: la IP tal cual, o los dos
 * últimos rótulos del nombre (`player.vimeo.com` → `vimeo.com`). Dos marcos
 * que comparten dominio registrable —lo único con lo que `document.domain`
 * los deja tocarse— comparten siempre esos dos rótulos; al revés no
 * (`a.co.uk` y `b.co.uk`), y entonces se los trata como del mismo sitio:
 * se cuentan de más, que empuja a «no medido», nunca a verde (RT-4).
 */
function sitioAproximado(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (ipLiteral(host) !== null) return host;
  return host.split(".").slice(-2).join(".");
}

/** La URL si es `http(s)`; si no lo es, o no es una URL, `null`. */
function urlDeRed(url: string | null): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ESQUEMAS_DE_RED.has(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

/**
 * Si el pedido sale de un marco de OTRO SITIO que la página, o es la
 * navegación de un marco a otro sitio (RT-4). Ante la duda, `false`: un
 * pedido sin marco (un worker de la página puede traer datos y pasárselos),
 * un marco `about:blank`, `blob:` o `srcdoc` —heredan el origen de quien lo
 * creó— y una página que todavía no se conoce cuentan como de la página.
 *
 * La página es `urlDeLaPagina`, el documento CONFIRMADO de la pestaña y no el
 * último pedido de navegación (FV-1, ver el encabezado). Se decide sólo con
 * lo que el pedido trae, sin estado del interceptor.
 */
function deOtroSitio(pedido: PedidoDelNavegador): boolean {
  if (pedido.esDocumentoPrincipal) return false;
  const pagina = urlDeRed(pedido.urlDeLaPagina);
  const desde = urlDeRed(pedido.tipo === "document" ? pedido.url : pedido.urlDelMarco);
  if (pagina === null || desde === null) return false;
  return sitioAproximado(desde.hostname) !== sitioAproximado(pagina.hostname);
}

/**
 * Si un pedido puede cambiar el texto que se cuenta: es de un tipo que lo
 * escribe y sale de un lugar desde el que se puede escribir en la página.
 */
function escribeTexto(pedido: PedidoDelNavegador): boolean {
  return !pedido.esDocumentoPrincipal && ESCRIBEN_TEXTO.has(pedido.tipo) && !deOtroSitio(pedido);
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
  pestana: {
    guardarEn?: CacheDeRespuestas;
    servirDesde?: CacheDeRespuestas;
    /**
     * La pestaña sin JavaScript: sólo el documento. Sin scripts que corran,
     * ningún subrecurso cambia el texto de su DOM —el CSS ya no cuenta, y un
     * marco no está en la serialización del principal—, así que no sale nada
     * más a la red.
     */
    soloDocumento?: boolean;
  } = {}
) {
  let bytesTotales = 0;
  let bytesDeOtrosSitios = 0;

  return async function atender(pedido: PedidoDelNavegador): Promise<void> {
    // Si escribe el texto que se cuenta, y si sale de otro sitio (RT-4): se
    // decide UNA vez, al entrar, con lo que el pedido trae. Antes se volvía a
    // juzgar al fallar contra el último pedido de navegación, y un `fetch` de
    // la página que estaba en vuelo cuando la pestaña intentó irse a otro
    // sitio se descartaba al no llegar (FV-1).
    const escribe = escribeTexto(pedido);
    const ajeno = deOtroSitio(pedido);
    // Si este pedido ya tiene un desenlace decidido —se bloqueó con su
    // motivo, o se le entregó la respuesta—. Lo que tire ANTES de eso, en el
    // `catch` de abajo, es un pedido que no llegó y nadie anotó (PU-3).
    let decidido = false;
    const bloquear = async (motivo: Bitacora["bloqueados"][number]["motivo"]) => {
      decidido = true;
      bitacora.bloqueados.push({ url: pedido.url, motivo });
      if (
        escribe &&
        (motivo === "timeout" ||
          motivo === "sin-respuesta" ||
          motivo === "tls" ||
          motivo === "demasiado-grande" ||
          motivo === "presupuesto" ||
          motivo === "dns-sin-respuesta")
      ) {
        bitacora.noLlegaron.push({ url: pedido.url, tipo: pedido.tipo, motivo });
      }
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

      if (ESQUEMAS_LOCALES.has(url.protocol)) {
        decidido = true;
        return await pedido.continuar();
      }
      if (!ESQUEMAS_DE_RED.has(url.protocol)) return await bloquear("esquema");
      if (!METODOS.has(pedido.metodo.toUpperCase())) return await bloquear("metodo");
      if (!pedido.esDocumentoPrincipal && (SIN_TEXTO.has(pedido.tipo) || pestana.soloDocumento)) {
        return await bloquear("sin-texto");
      }
      if (senal.aborted) return await bloquear("presupuesto");

      // La pestaña sin JavaScript recibe lo MISMO que recibió la primera, sin
      // volver a la red: el examen ya se hizo cuando se pidió.
      const guardada = pedido.metodo.toUpperCase() === "GET" ? pestana.servirDesde?.get(url.toString()) : undefined;
      if (guardada) {
        if (pedido.esDocumentoPrincipal) bitacora.statusDocumento = guardada.status;
        await pedido.responder(guardada);
        decidido = true;
        return;
      }

      const examen = await examinar(url, senal);
      if (!examen.ok) return await bloquear(examen.motivo);

      const plazo = Math.min(opciones.plazoPorPedidoMs, restanteMs());
      // Lo de un marco de otro sitio sale de su propio presupuesto (RT-4).
      const quedan = ajeno
        ? opciones.maxBytesDeOtrosSitios - bytesDeOtrosSitios
        : opciones.maxBytesTotales - bytesTotales;
      if (plazo <= 0 || quedan <= 0) return await bloquear("presupuesto");

      const encabezados: Record<string, string> = {};
      for (const [nombre, valor] of Object.entries(pedido.encabezados)) {
        if (!DEL_SALTO.has(nombre.toLowerCase())) encabezados[nombre.toLowerCase()] = valor;
      }

      bitacora.pedidos.push({ url: pedido.url, ip: examen.ip });
      // En vuelo desde que sale hasta que el navegador lo tiene (o se aborta):
      // la lectura no se da por buena mientras un pedido que escribe texto
      // siga en camino.
      if (escribe) bitacora.enVuelo += 1;
      try {
        let respuesta: RespuestaHttp;
        try {
          respuesta = await deps.transporte({
            url: url.toString(),
            ip: examen.ip,
            ...(examen.alternativas ? { alternativas: examen.alternativas } : {}),
            metodo: pedido.metodo.toUpperCase(),
            encabezados,
            cuerpo: pedido.cuerpo,
            timeoutMs: plazo,
            maxBytes: Math.min(opciones.maxBytesPorRespuesta, quedan),
          });
        } catch {
          // Un transporte que RECHAZA no trajo nada: es «sin respuesta», con
          // su lugar en `noLlegaron`, y no una excepción que el `catch` de
          // abajo sólo aborta. MEDIDO (PU-3): el `TypeError` de un connect
          // IPv6 sin ruta dejaba fuera de RT-1 al bundle, y el render salía
          // `medido` y VERDE.
          respuesta = { tipo: "error", motivo: "sin-respuesta" };
        }
        await entregar(respuesta, url.toString());
      } finally {
        if (escribe) bitacora.enVuelo -= 1;
      }
    } catch {
      // Un pedido que el interceptor no supo atender NO sale: abortado. Dejarlo
      // colgado frenaría el `load`, y dejarlo seguir sería salir sin examen.
      //
      // Y si escribe texto y no tenía desenlace —tiró el examen, o el
      // navegador no aceptó la respuesta (`responder` tira con un encabezado
      // inválido)—, NO LLEGÓ: se anota, y el render no da número (PU-3).
      if (!decidido && escribe) {
        bitacora.noLlegaron.push({ url: pedido.url, tipo: pedido.tipo, motivo: "sin-respuesta" });
      }
      await pedido.abortar().catch(() => {});
    }

    async function entregar(respuesta: RespuestaHttp, clave: string) {
      if (respuesta.tipo === "error") return await bloquear(respuesta.motivo);
      if (esDescarga(respuesta.encabezados)) return await bloquear("descarga");

      if (ajeno) bytesDeOtrosSitios += respuesta.cuerpo.length;
      else bytesTotales += respuesta.cuerpo.length;
      if (pedido.esDocumentoPrincipal) bitacora.statusDocumento = respuesta.status;

      const devueltos: Record<string, string | string[]> = {};
      for (const [nombre, valor] of Object.entries(respuesta.encabezados)) {
        if (!DE_LA_RESPUESTA.has(nombre.toLowerCase())) devueltos[nombre.toLowerCase()] = valor;
      }
      const entregada = { status: respuesta.status, encabezados: devueltos, cuerpo: respuesta.cuerpo };
      if (pedido.metodo.toUpperCase() === "GET") pestana.guardarEn?.set(clave, entregada);
      await pedido.responder(entregada);
      decidido = true;
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
 * Lee el texto del DOM hasta que su MÁXIMO deje de crecer durante
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
  let maximo = textoSinJavaScript(await pagina.html());
  let crecioEn = inicio;
  while (ahora() - crecioEn < opciones.quietudDomMs) {
    // Al tope: si el texto creció mientras se miraba, sigue creciendo y el
    // número es parcial; si no creció pero no hubo tiempo de ver una quietud
    // entera, es el presupuesto el que no alcanzó, no la página.
    if (ahora() - inicio >= topeMs) return crecioEn === inicio ? "plazo" : "inestable";
    await esperar(opciones.sondeoMs);
    const n = textoSinJavaScript(await pagina.html());
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
      const leer = async (): Promise<number | ResultadoRenderizado> => {
        let leidos: number | "inestable" | "plazo";
        try {
          leidos = await leerCuandoSeQuede(
            pagina,
            opciones,
            Math.min(opciones.topeDomMs, Math.max(restante() - 1_000, 0)),
            ahora,
            esperar
          );
        } catch {
          return fallo("lectura");
        }
        if (leidos === "inestable") return fallo("inestable");
        if (leidos === "plazo") return fallo("timeout");
        return leidos;
      };
      let caracteres = await leer();
      if (typeof caracteres !== "number") return caracteres;

      // RT-1: lo que escribe el texto tiene que haber LLEGADO. Lo que sigue en
      // vuelo se espera y se vuelve a leer, mientras quede presupuesto: cada
      // pedido tiene su propio plazo, así que lo que no termina es una página
      // que no deja de pedir, y al acabarse el presupuesto se dice
      // `subrecurso-pendiente`. Una página que pide cada tanto (un sondeo
      // corto) se lee en un momento en que no hay nada en vuelo.
      while (bitacora.enVuelo > 0) {
        while (bitacora.enVuelo > 0 && restante() > 1_000) await esperar(opciones.sondeoMs);
        if (bitacora.enVuelo > 0) return fallo("subrecurso-pendiente");
        caracteres = await leer();
        if (typeof caracteres !== "number") return caracteres;
      }
      const perdido = bitacora.noLlegaron[0];
      if (perdido) return fallo(`subrecurso-${perdido.motivo}`);

      // El lado servido, del MISMO documento y con la misma extracción: ver
      // el encabezado. Si no se puede medir, el resultado no se da: un número
      // servido de otro documento (el que trajo la ruta, con otro
      // user-agent) compararía dos páginas que pueden no ser la misma.
      const servida = nuevaBitacora();
      try {
        const sinJs = await vivo.navegador.nuevaPagina({ javascript: false });
        await sinJs.interceptar(
          crearInterceptor(deps, opciones, servida, restante, corte.signal, examinar, {
            servirDesde: respuestas,
            soloDocumento: true,
          })
        );
        await sinJs.navegar(destino.toString(), Math.max(restante(), 1));
        bitacora.pedidos.push(...servida.pedidos);
        // Lo que la pestaña sin JavaScript no pidió a propósito (todo lo que no
        // es el documento) no es un hallazgo: sería ruido en la bitácora.
        bitacora.bloqueados.push(...servida.bloqueados.filter((b) => b.motivo !== "sin-texto"));
        if (servida.falloDocumento || servida.statusDocumento === null || servida.statusDocumento >= 400) {
          return fallo("lectura-servida");
        }
        const servidos = textoSinJavaScript(await sinJs.html());
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
