/**
 * Un navegador de mentira que se porta, en lo que importa, como Chromium detrás
 * del interceptor de `renderizado.ts`.
 *
 * QUÉ SIMULA, Y POR QUÉ ALCANZA
 *
 * Lo que la medición necesita de un navegador es: pedir el documento, seguir
 * las redirecciones que se le ENTREGAN (pidiendo el destino, que vuelve a pasar
 * por el interceptor), pedir los subrecursos que el documento declara, y
 * devolver su DOM serializado con lo que le llegó. Este doble hace eso con
 * reglas escritas:
 *
 *   - la pestaña SIN JavaScript devuelve el documento tal cual llegó. Como
 *     Chromium con el JavaScript apagado, PIDE las hojas de estilo, las
 *     imágenes y los marcos —también los que están dentro de `<noscript>`,
 *     que sin JavaScript son elementos— y no los scripts;
 *   - en la pestaña CON JavaScript, cada `<script src>` y cada `data-fetch` que
 *     el interceptor ENTREGÓ agrega su cuerpo al DOM, como si el JavaScript lo
 *     escribiera. Uno que el interceptor abortó no agrega nada;
 *   - `<img src>` se pide como `image`, `<iframe src>` como `document` de un
 *     marco que no es el principal;
 *   - cada pedido dice desde qué marco sale (`urlDelMarco`): el documento de
 *     la pestaña, salvo un pedido en segundo plano con `marco`, que sale del
 *     `<iframe>` con esa URL —un widget de otro sitio y lo que pide adentro
 *     (RT-4)—. Lo que pide un marco no se escribe en el DOM de la página. La
 *     navegación de un `<iframe>` sale de `about:blank`, como en Chromium:
 *     MEDIDO con Chrome 155 y el headless shell 153, el marco que navega
 *     todavía no tiene la URL a la que va;
 *   - un pedido en segundo plano con `marco: null` sale SIN marco, como el de
 *     un worker, y con `worker` dice la URL del script de ese worker como la
 *     da Chromium (`urlDelWorker`, W-1). Lo que trae se escribe en el DOM
 *     sea de quien sea el worker: los tests de un worker de otro sitio lo
 *     usan con pedidos que no llegan;
 *   - cada pedido dice también cuál es el documento CONFIRMADO de la pestaña
 *     (`urlDeLaPagina`): el del último salto de la navegación que llegó, como
 *     `page.mainFrame().url()`. Una navegación de la pestaña en segundo plano
 *     (`principal`) sale y se entrega, pero NO se confirma —un 204, una
 *     descarga, un `window.stop()`—: el documento, su DOM y esa URL siguen
 *     siendo los de antes (FV-1).
 *
 * Así, si la guarda deja pasar un subrecurso a la metadata, el texto dibujado
 * trae lo que «contestó» la metadata y el transporte registra el pedido: las
 * dos cosas que los tests miran.
 *
 * Lo que NO simula, dicho: la red propia de Chromium —WebSocket, preconnect,
 * WebRTC—. Eso no pasa por el interceptor y por eso no se puede probar con un
 * doble: lo mide `renderizado.integracion.test.ts` con un Chrome de verdad y un
 * canario que cuenta conexiones TCP. Del `WebSocket` simula sólo el AVISO que
 * Chromium da por CDP (`salidasPropias`, F3), con el origen del contexto que
 * lo abrió: que el aviso llegue con ese origen lo mide la integración, con los
 * dos binarios.
 */
import type {
  AbrirNavegador,
  MotivoDeTransporte,
  NavegadorAbierto,
  PaginaAbierta,
  PedidoDelNavegador,
  PedidoHttp,
  Resolvedor,
  RespuestaHttp,
  SalidaPropia,
  SalidaPropiaVista,
  Transporte,
} from "../renderizado";

type Desenlace =
  | { tipo: "continuado" }
  | { tipo: "abortado" }
  | { tipo: "respondido"; status: number; encabezados: Record<string, string | string[]>; cuerpo: Buffer };

export interface PaginaDelSitio {
  status?: number;
  encabezados?: Record<string, string>;
  cuerpo?: string;
  /** El transporte no la trae: `timeout`, `tls`, `demasiado-grande`… (RT-1). */
  error?: MotivoDeTransporte;
  /** La respuesta sale recién cuando esto resuelve: un origen lento (con `relojVirtual().alcanzar`). */
  llegaCuando?: () => Promise<void>;
}

/** El «internet» del doble: qué contesta cada URL. Lo que no está, `sin-respuesta`. */
export type Sitio = Record<string, PaginaDelSitio>;

export interface OpcionesTransporteDoble {
  /**
   * El cuerpo llega en partes de este tamaño, y cada una se descuenta de
   * `PedidoHttp.presupuesto` como en `transporteRender.ts`, con un turno del
   * event loop entre parte y parte: los pedidos en paralelo bajan a la vez
   * (RED-121-2). Sin esto, el cuerpo llega entero y nada se descuenta: es un
   * transporte que no usa el presupuesto, y el interceptor lo descuenta al
   * entregar.
   */
  porPartes?: number;
}

export function transporteDoble(sitio: Sitio, opciones: OpcionesTransporteDoble = {}) {
  const pedidos: PedidoHttp[] = [];
  /** Lo que el presupuesto ACEPTÓ, por URL: lo que de verdad se bajó parte por parte. */
  const bajados: Record<string, number> = {};
  const transporte: Transporte = async (pedido) => {
    pedidos.push(pedido);
    const pagina = sitio[pedido.url];
    if (!pagina) return { tipo: "error", motivo: "sin-respuesta" } satisfies RespuestaHttp;
    if (pagina.llegaCuando) await pagina.llegaCuando();
    if (pagina.error) return { tipo: "error", motivo: pagina.error } satisfies RespuestaHttp;
    const cuerpo = Buffer.from(pagina.cuerpo ?? "");
    if (opciones.porPartes) {
      let leidos = 0;
      for (let i = 0; i < cuerpo.length; i += opciones.porPartes) {
        await new Promise((listo) => setImmediate(listo));
        const parte = Math.min(opciones.porPartes, cuerpo.length - i);
        leidos += parte;
        if (leidos > pedido.maxBytes || (pedido.presupuesto && !pedido.presupuesto(parte))) {
          return { tipo: "error", motivo: "demasiado-grande" } satisfies RespuestaHttp;
        }
        bajados[pedido.url] = (bajados[pedido.url] ?? 0) + parte;
      }
    }
    return {
      tipo: "respuesta",
      status: pagina.status ?? 200,
      encabezados: { "content-type": "text/html", ...(pagina.encabezados ?? {}) },
      cuerpo,
    };
  };
  return { transporte, pedidos, bajados };
}

/** Un DNS escrito: cada nombre, sus direcciones. Cuenta cuántas veces se preguntó por cada uno. */
export function resolvedorDoble(tabla: Record<string, string[] | (() => string[])>) {
  const consultas: string[] = [];
  const resolver: Resolvedor = async (host) => {
    consultas.push(host);
    const entrada = tabla[host];
    const direcciones = typeof entrada === "function" ? entrada() : entrada;
    return direcciones && direcciones.length > 0 ? { ok: true, direcciones } : { ok: false };
  };
  return { resolver, consultas };
}

/** Un texto que el «JavaScript» escribe en el DOM, como lo serializaría el navegador. */
function escrito(texto: string): string {
  return `<div>${texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
}

/**
 * Un reloj que sólo avanza cuando la medición «duerme»: la espera de quietud
 * del DOM corre en tiempo virtual, y los tests no esperan dos segundos reales
 * por cada medición. Va en `DependenciasRender` (`ahora` y `esperar`) y en el
 * navegador doble (`reloj`), que lo usa para el texto que llega tarde.
 */
export function relojVirtual() {
  let t = 0;
  const alarmas: Array<{ en: number; sonar: () => void }> = [];
  return {
    ahora: () => t,
    esperar: async (ms: number) => {
      t += ms;
      for (const a of alarmas.filter((x) => x.en <= t)) {
        alarmas.splice(alarmas.indexOf(a), 1);
        a.sonar();
      }
    },
    /** Resuelve cuando el reloj llega a `ms`: un origen que contesta a esa hora. */
    alcanzar: (ms: number) => new Promise<void>((sonar) => (ms <= t ? sonar() : alarmas.push({ en: ms, sonar }))),
  };
}

export interface OpcionesDoble {
  /**
   * Texto que el «JavaScript» agrega después de la navegación, sin pedir nada
   * a la red: cada entrada aparece a los `enMs` del reloj. Es la página que
   * dibuja con un `setTimeout`, o con `requestIdleCallback`.
   */
  textoTardio?: Array<{ enMs: number; texto: string }>;
  /** Texto que aparece SÓLO si la página se recorrió: lo que un `IntersectionObserver` dibuja al verse. */
  textoAlVerse?: string;
  /** El reloj de `textoTardio`. Sin él, el tardío nunca aparece. */
  reloj?: { ahora: () => number; esperar?: (ms: number) => Promise<void>; alcanzar?: (ms: number) => Promise<void> };
  /** El arranque falla, como un Chromium que no está. */
  arranqueFalla?: boolean;
  /** El arranque tarda esto antes de devolver el navegador. */
  arranqueMs?: number;
  /**
   * El arranque y la navegación de la pestaña con JavaScript, en tiempo
   * VIRTUAL (avanzan `reloj`): un arranque en frío y una página lenta, sin
   * que el test duerma (RT-2).
   */
  arranqueVirtualMs?: number;
  navegacionVirtualMs?: number;
  /** `navegar` no termina nunca: un sitio que no llega al `load`. */
  navegacionColgada?: boolean;
  /** `nuevaPagina` tira: el navegador murió entre el arranque y la pestaña. */
  paginaFalla?: boolean;
  /**
   * Reemplaza el DOM serializado de la pestaña CON JavaScript: lo que el
   * navegador devolvería después de correr la página. Con una función, por la
   * URL del documento (la del último salto), y `undefined` deja el del doble.
   * La pestaña sin JavaScript no lo usa: ella devuelve el documento que llegó.
   */
  htmlCrudo?: string | ((urlDelDocumento: string) => string | undefined);
  /** La pestaña SIN JavaScript no se puede abrir: el lado servido queda sin medir. */
  paginaSinJsFalla?: boolean;
  /**
   * Pedidos que el «JavaScript» hace DESPUÉS del `load`, sin que la navegación
   * los espere: un chunk perezoso, los datos de una hidratación. Si llegan,
   * su cuerpo se escribe en el DOM cuando llegan (RT-1).
   */
  enSegundoPlano?: Array<{
    url: string;
    tipo: string;
    /**
     * La URL del marco desde el que sale el pedido, si no es la página: lo
     * que pide un `<iframe>` por dentro (RT-4). Lo que trae no se escribe en
     * el DOM de la página, como en Chromium: el contenido de un marco no está
     * en la serialización del documento. `null` es un pedido SIN marco —un
     * worker—, y lo que trae sí se escribe: el worker se lo pasa.
     */
    marco?: string | null;
    /**
     * Con `marco: null`, la URL del script del worker del que sale, como la
     * daría Chromium (`documentURL` en la sesión del worker, W-1). Sin esto,
     * Chromium no lo atribuyó a ningún worker.
     */
    worker?: string;
    /**
     * Una navegación de la PESTAÑA (`location.href = …`) que no se confirma:
     * sale como documento principal, el interceptor la atiende, y el
     * documento sigue siendo el de antes —como un 204, una descarga denegada
     * o un `window.stop()` en Chromium (FV-1)—.
     */
    principal?: boolean;
    /** Sale cuando el reloj llega a `enMs`, y no apenas termina la navegación (necesita `reloj.alcanzar`). */
    enMs?: number;
    /** El método y el cuerpo, si no es un `GET` (SEC-A2, F2). */
    metodo?: string;
    cuerpo?: string;
  }>;
  /**
   * Lo que la pestaña con JavaScript intenta abrir SIN pasar por el
   * interceptor —un `WebSocket`—, como lo avisaría Chromium por CDP (F3).
   * `origen` es el del contexto que lo abrió: sin decirlo, el de la página;
   * `null`, sin aviso. `worker`, lo abrió un worker: con la URL de su script
   * como la da Chromium (W-1), o `true` si no se supo.
   */
  salidasPropias?: Array<{
    url: string;
    tipo: SalidaPropia;
    origen?: string | null;
    worker?: string | true;
    /** El documento de la pestaña cuando Chromium lo avisó, si no es el que se navegó: `null`, ninguno confirmado. */
    pagina?: string | null;
  }>;
  /**
   * `responder` TIRA para estas URLs, como el de puppeteer con un encabezado
   * que Chromium no acepta (`Invalid header`): el pedido queda sin entregar
   * (PU-3).
   */
  responderFalla?: (url: string) => boolean;
  /**
   * La pestaña con JavaScript termina la navegación con ESTE documento sin
   * que el interceptor lo haya visto —lo sirvió Chromium por su cuenta, de su
   * caché—: la medición no tiene status del documento (M12).
   */
  documentoPorFuera?: string;
}

export function navegadorDoble(opciones: OpcionesDoble = {}) {
  const registro = {
    aperturas: 0,
    cierres: 0,
    /** Cada pedido que el navegador hizo, y cómo terminó. */
    pedidos: [] as Array<{ url: string; tipo: string; desenlace: Desenlace["tipo"] }>,
    /** El DOM que dibujó la pestaña con JavaScript, serializado. */
    textoDibujado: null as string | null,
    /** Cuántas veces se recorrió una página de arriba abajo. */
    recorridos: 0,
    /** Cuántas pestañas sin JavaScript llegaron a dibujar un documento. */
    paginasSinJs: 0,
  };

  async function emitir(
    atender: (p: PedidoDelNavegador) => Promise<void>,
    url: string,
    tipo: string,
    esDocumentoPrincipal: boolean,
    urlDelMarco: string | null,
    urlDeLaPagina: string | null,
    metodo = "GET",
    cuerpo?: string,
    urlDelWorker: string | null = null
  ): Promise<Desenlace> {
    let resolver!: (d: Desenlace) => void;
    const desenlace = new Promise<Desenlace>((r) => (resolver = r));
    const pedido: PedidoDelNavegador = {
      url,
      metodo,
      encabezados: { accept: "*/*", "user-agent": "doble" },
      ...(cuerpo !== undefined ? { cuerpo } : {}),
      tipo,
      esDocumentoPrincipal,
      urlDelMarco,
      urlDelWorker,
      urlDeLaPagina,
      continuar: async () => resolver({ tipo: "continuado" }),
      abortar: async () => resolver({ tipo: "abortado" }),
      responder: async (r) => {
        if (opciones.responderFalla?.(url)) throw new Error("Protocol error (Fetch.fulfillRequest): Invalid header");
        resolver({ tipo: "respondido", ...r });
      },
    };
    await atender(pedido);
    const d = await desenlace;
    registro.pedidos.push({ url, tipo, desenlace: d.tipo });
    return d;
  }

  function pagina(sinJs: boolean): PaginaAbierta {
    let atender: ((p: PedidoDelNavegador) => Promise<void>) | null = null;
    let html = "";
    let urlDelDocumento = "";
    let navegadoEn: number | null = null;
    let recorrida = false;

    return {
      salidasPropias(): SalidaPropiaVista[] {
        // Sólo la pestaña que corre JavaScript abre sockets, y sólo después de navegar.
        if (sinJs || urlDelDocumento === "") return [];
        return (opciones.salidasPropias ?? []).map((s) => ({
          url: s.url,
          tipo: s.tipo,
          deUnWorker: s.worker !== undefined,
          urlDelWorker: typeof s.worker === "string" ? s.worker : null,
          origenDelMarco: s.worker ? null : s.origen === undefined ? new URL(urlDelDocumento).origin : s.origen,
          urlDeLaPagina: s.pagina === undefined ? urlDelDocumento : s.pagina,
        }));
      },
      async interceptar(a) {
        atender = a;
      },
      async navegar(url) {
        if (!atender) throw new Error("el doble necesita el interceptor antes de navegar");
        if (opciones.navegacionColgada) await new Promise(() => {});
        if (!sinJs && opciones.navegacionVirtualMs) await opciones.reloj?.esperar?.(opciones.navegacionVirtualMs);
        if (!sinJs && opciones.documentoPorFuera !== undefined) {
          urlDelDocumento = url;
          html = opciones.documentoPorFuera;
          registro.textoDibujado = html;
          navegadoEn = opciones.reloj?.ahora() ?? null;
          return;
        }

        let actual = url;
        let documento: Extract<Desenlace, { tipo: "respondido" }> | null = null;
        for (let saltos = 0; saltos < 10 && !documento; saltos++) {
          // Mientras la cadena no termina, la pestaña sigue en el documento
          // anterior: nada confirmado todavía, o el de una navegación previa.
          const d = await emitir(atender, actual, "document", true, urlDelDocumento || null, urlDelDocumento || null);
          if (d.tipo !== "respondido") throw new Error(`net::ERR_BLOCKED_BY_CLIENT at ${actual}`);
          const destino = d.encabezados.location;
          if (d.status >= 300 && d.status < 400 && typeof destino === "string") {
            actual = new URL(destino, actual).toString();
            continue;
          }
          documento = d;
        }
        if (!documento) throw new Error("net::ERR_TOO_MANY_REDIRECTS");
        urlDelDocumento = actual;

        const documentoHtml = documento.cuerpo.toString("utf8");
        if (sinJs) {
          // Sin JavaScript no corre ningún script: ni los que el documento
          // trae, ni los tardíos, ni los que dibujan al verse. Lo demás sí se
          // pide, y no cambia el DOM.
          for (const [patron, tipo] of [
            [/<link[^>]*rel="stylesheet"[^>]*\shref="([^"]+)"/g, "stylesheet"],
            [/<img[^>]*\ssrc="([^"]+)"/g, "image"],
            [/<iframe[^>]*\ssrc="([^"]+)"/g, "document"],
          ] as const) {
            for (const m of documentoHtml.matchAll(patron)) {
              await emitir(atender, new URL(m[1], actual).toString(), tipo, false, tipo === "document" ? "about:blank" : actual, actual);
            }
          }
          html = documentoHtml;
          registro.paginasSinJs += 1;
          return;
        }
        const partes = [documentoHtml];
        // Con JavaScript, el contenido de `<noscript>` es texto: no pide nada.
        const conJs = documentoHtml.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
        const declarados: Array<{ url: string; tipo: string; principal: boolean }> = [];
        for (const m of conJs.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) declarados.push({ url: m[1], tipo: "script", principal: false });
        for (const m of conJs.matchAll(/data-fetch="([^"]+)"/g)) declarados.push({ url: m[1], tipo: "fetch", principal: false });
        for (const m of conJs.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) declarados.push({ url: m[1], tipo: "image", principal: false });
        for (const m of conJs.matchAll(/<iframe[^>]*\ssrc="([^"]+)"/g)) declarados.push({ url: m[1], tipo: "document", principal: false });

        for (const r of declarados) {
          const absoluta = new URL(r.url, actual).toString();
          const d = await emitir(atender, absoluta, r.tipo, r.principal, r.tipo === "document" ? "about:blank" : actual, actual);
          if (d.tipo === "respondido" && (r.tipo === "script" || r.tipo === "fetch")) {
            partes.push(escrito(d.cuerpo.toString("utf8")));
          }
        }
        html = partes.join("\n");
        registro.textoDibujado = html;
        navegadoEn = opciones.reloj?.ahora() ?? null;
        for (const r of opciones.enSegundoPlano ?? []) {
          const deUnMarco = typeof r.marco === "string";
          const marco = r.marco === null ? null : deUnMarco ? new URL(r.marco as string, actual).toString() : actual;
          const principal = r.principal === true;
          const at = atender;
          // La URL de la página se lee al SALIR el pedido, como en Chromium.
          const salir = () =>
            emitir(
              at,
              new URL(r.url, actual).toString(),
              r.tipo,
              principal,
              marco,
              urlDelDocumento || null,
              r.metodo,
              r.cuerpo,
              marco === null ? (r.worker ?? null) : null
            ).then((d) => {
              // Una navegación de la pestaña que no se confirma no cambia el
              // documento: ni su DOM ni su URL.
              if (d.tipo !== "respondido" || deUnMarco || principal) return;
              html = `${html}\n${escrito(d.cuerpo.toString("utf8"))}`;
              registro.textoDibujado = html;
            });
          if (r.enMs === undefined) {
            void salir();
          } else {
            const alcanzar = opciones.reloj?.alcanzar;
            if (!alcanzar) throw new Error("el doble necesita `reloj.alcanzar` para un pedido con `enMs`");
            void alcanzar(r.enMs).then(salir);
          }
        }
      },
      async esperarQuietud() {},
      async desplazar() {
        recorrida = true;
        registro.recorridos += 1;
      },
      async html() {
        if (sinJs) return html;
        const crudo = typeof opciones.htmlCrudo === "function" ? opciones.htmlCrudo(urlDelDocumento) : opciones.htmlCrudo;
        const base = crudo ?? html;
        const ahora = opciones.reloj?.ahora();
        const tardio = (opciones.textoTardio ?? [])
          .filter((t) => navegadoEn !== null && ahora !== undefined && ahora - navegadoEn >= t.enMs)
          .map((t) => escrito(t.texto));
        const alVerse = recorrida && opciones.textoAlVerse ? [escrito(opciones.textoAlVerse)] : [];
        return [base, ...tardio, ...alVerse].join("\n");
      },
    };
  }

  const abrirNavegador: AbrirNavegador = async () => {
    if (opciones.arranqueMs) await new Promise((r) => setTimeout(r, opciones.arranqueMs));
    if (opciones.arranqueVirtualMs) await opciones.reloj?.esperar?.(opciones.arranqueVirtualMs);
    if (opciones.arranqueFalla) throw new Error("no hay Chromium");
    registro.aperturas += 1;
    const navegador: NavegadorAbierto = {
      async nuevaPagina(opcionesPagina) {
        if (opciones.paginaFalla) throw new Error("Target closed");
        if (opcionesPagina?.javascript === false && opciones.paginaSinJsFalla) throw new Error("Target closed");
        return pagina(opcionesPagina?.javascript === false);
      },
      async cerrar() {
        registro.cierres += 1;
      },
    };
    return navegador;
  };

  return { abrirNavegador, registro };
}
