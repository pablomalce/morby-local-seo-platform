/**
 * Un navegador de mentira que se porta, en lo que importa, como Chromium detrás
 * del interceptor de `renderizado.ts`.
 *
 * QUÉ SIMULA, Y POR QUÉ ALCANZA
 *
 * Lo que la medición necesita de un navegador es: pedir el documento, seguir
 * las redirecciones que se le ENTREGAN (pidiendo el destino, que vuelve a pasar
 * por el interceptor), pedir los subrecursos que el documento declara, y
 * dibujar texto con lo que le llegó. Este doble hace eso con reglas escritas:
 *
 *   - el texto «servido» es el del documento sin etiquetas ni `<script>`;
 *   - cada `<script src>` y cada `data-fetch` que el interceptor ENTREGÓ suma su
 *     cuerpo al texto, como si el JavaScript lo escribiera en el DOM. Uno que el
 *     interceptor abortó no suma nada;
 *   - `<img src>` se pide como `image`, `<iframe src>` como `document` de un
 *     marco que no es el principal.
 *
 * Así, si la guarda deja pasar un subrecurso a la metadata, el texto dibujado
 * trae lo que «contestó» la metadata y el transporte registra el pedido: las
 * dos cosas que los tests miran.
 *
 * Lo que NO simula, dicho: la red propia de Chromium —WebSocket, preconnect,
 * WebRTC—. Eso no pasa por el interceptor y por eso no se puede probar con un
 * doble: lo mide `renderizado.integracion.test.ts` con un Chrome de verdad y un
 * canario que cuenta conexiones TCP.
 */
import type {
  AbrirNavegador,
  NavegadorAbierto,
  PaginaAbierta,
  PedidoDelNavegador,
  PedidoHttp,
  Resolvedor,
  RespuestaHttp,
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
}

/** El «internet» del doble: qué contesta cada URL. Lo que no está, `sin-respuesta`. */
export type Sitio = Record<string, PaginaDelSitio>;

export function transporteDoble(sitio: Sitio) {
  const pedidos: PedidoHttp[] = [];
  const transporte: Transporte = async (pedido) => {
    pedidos.push(pedido);
    const pagina = sitio[pedido.url];
    if (!pagina) return { tipo: "error", motivo: "sin-respuesta" } satisfies RespuestaHttp;
    return {
      tipo: "respuesta",
      status: pagina.status ?? 200,
      encabezados: { "content-type": "text/html", ...(pagina.encabezados ?? {}) },
      cuerpo: Buffer.from(pagina.cuerpo ?? ""),
    };
  };
  return { transporte, pedidos };
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

function textoDelHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/**
 * Lo que la pestaña SIN JavaScript «ve»: el HTML sin scripts, sin `<noscript>`
 * y sin los elementos ocultos por CSS en línea o por `hidden` (sin anidar: al
 * doble le alcanza con eso). Es la regla del lado servido de `renderizado.ts`.
 */
function textoVisibleSinJs(html: string): string {
  return textoDelHtml(
    html
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(\w+)[^>]*(?:\shidden\b|display:\s*none)[^>]*>[\s\S]*?<\/\1>/gi, " ")
  );
}

/**
 * Un reloj que sólo avanza cuando la medición «duerme»: la espera de quietud
 * del DOM corre en tiempo virtual, y los tests no esperan dos segundos reales
 * por cada medición. Va en `DependenciasRender` (`ahora` y `esperar`) y en el
 * navegador doble (`reloj`), que lo usa para el texto que llega tarde.
 */
export function relojVirtual() {
  let t = 0;
  return {
    ahora: () => t,
    esperar: async (ms: number) => {
      t += ms;
    },
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
  reloj?: { ahora: () => number };
  /** El arranque falla, como un Chromium que no está. */
  arranqueFalla?: boolean;
  /** El arranque tarda esto antes de devolver el navegador. */
  arranqueMs?: number;
  /** `navegar` no termina nunca: un sitio que no llega al `load`. */
  navegacionColgada?: boolean;
  /** `nuevaPagina` tira: el navegador murió entre el arranque y la pestaña. */
  paginaFalla?: boolean;
  /**
   * Reemplaza el texto dibujado CON JavaScript: para probar la normalización
   * con un `innerText` exacto. La pestaña sin JavaScript no lo usa.
   */
  textoCrudo?: string;
  /** La pestaña SIN JavaScript no se puede abrir: el lado servido queda sin medir. */
  paginaSinJsFalla?: boolean;
}

export function navegadorDoble(opciones: OpcionesDoble = {}) {
  const registro = {
    aperturas: 0,
    cierres: 0,
    /** Cada pedido que el navegador hizo, y cómo terminó. */
    pedidos: [] as Array<{ url: string; tipo: string; desenlace: Desenlace["tipo"] }>,
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
    esDocumentoPrincipal: boolean
  ): Promise<Desenlace> {
    let resolver!: (d: Desenlace) => void;
    const desenlace = new Promise<Desenlace>((r) => (resolver = r));
    const pedido: PedidoDelNavegador = {
      url,
      metodo: "GET",
      encabezados: { accept: "*/*", "user-agent": "doble" },
      tipo,
      esDocumentoPrincipal,
      continuar: async () => resolver({ tipo: "continuado" }),
      abortar: async () => resolver({ tipo: "abortado" }),
      responder: async (r) => resolver({ tipo: "respondido", ...r }),
    };
    await atender(pedido);
    const d = await desenlace;
    registro.pedidos.push({ url, tipo, desenlace: d.tipo });
    return d;
  }

  function pagina(sinJs: boolean): PaginaAbierta {
    let atender: ((p: PedidoDelNavegador) => Promise<void>) | null = null;
    let texto = "";
    let navegadoEn: number | null = null;
    let recorrida = false;

    return {
      async interceptar(a) {
        atender = a;
      },
      async navegar(url) {
        if (!atender) throw new Error("el doble necesita el interceptor antes de navegar");
        if (opciones.navegacionColgada) await new Promise(() => {});

        let actual = url;
        let documento: Extract<Desenlace, { tipo: "respondido" }> | null = null;
        for (let saltos = 0; saltos < 10 && !documento; saltos++) {
          const d = await emitir(atender, actual, "document", true);
          if (d.tipo !== "respondido") throw new Error(`net::ERR_BLOCKED_BY_CLIENT at ${actual}`);
          const destino = d.encabezados.location;
          if (d.status >= 300 && d.status < 400 && typeof destino === "string") {
            actual = new URL(destino, actual).toString();
            continue;
          }
          documento = d;
        }
        if (!documento) throw new Error("net::ERR_TOO_MANY_REDIRECTS");

        const html = documento.cuerpo.toString("utf8");
        if (sinJs) {
          // Sin JavaScript no corre ningún script: ni los que el documento
          // trae, ni los tardíos, ni los que dibujan al verse.
          texto = textoVisibleSinJs(html);
          registro.paginasSinJs += 1;
          return;
        }
        const partes = [textoDelHtml(html)];
        const declarados: Array<{ url: string; tipo: string; principal: boolean }> = [];
        for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) declarados.push({ url: m[1], tipo: "script", principal: false });
        for (const m of html.matchAll(/data-fetch="([^"]+)"/g)) declarados.push({ url: m[1], tipo: "fetch", principal: false });
        for (const m of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) declarados.push({ url: m[1], tipo: "image", principal: false });
        for (const m of html.matchAll(/<iframe[^>]*\ssrc="([^"]+)"/g)) declarados.push({ url: m[1], tipo: "document", principal: false });

        for (const r of declarados) {
          const absoluta = new URL(r.url, actual).toString();
          const d = await emitir(atender, absoluta, r.tipo, r.principal);
          if (d.tipo === "respondido" && (r.tipo === "script" || r.tipo === "fetch")) {
            partes.push(d.cuerpo.toString("utf8"));
          }
        }
        texto = partes.join(" ");
        registro.textoDibujado = texto;
        navegadoEn = opciones.reloj?.ahora() ?? null;
      },
      async esperarQuietud() {},
      async desplazar() {
        recorrida = true;
        registro.recorridos += 1;
      },
      async textoVisible() {
        if (sinJs) return texto;
        const base = opciones.textoCrudo ?? texto;
        const ahora = opciones.reloj?.ahora();
        const tardio = (opciones.textoTardio ?? [])
          .filter((t) => navegadoEn !== null && ahora !== undefined && ahora - navegadoEn >= t.enMs)
          .map((t) => t.texto);
        const alVerse = recorrida && opciones.textoAlVerse ? [opciones.textoAlVerse] : [];
        return [base, ...tardio, ...alVerse].join(" ");
      },
    };
  }

  const abrirNavegador: AbrirNavegador = async () => {
    if (opciones.arranqueMs) await new Promise((r) => setTimeout(r, opciones.arranqueMs));
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
