/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el renderizado de la auditoría AEO se dé por probado con un navegador de
 * mentira. El doble de `renderizado.test.ts` prueba la lógica; acá el oráculo
 * es de un tercero (R11): un Chrome de verdad, sockets de verdad y dos
 * servidores HTTP locales.
 *
 *   - el SITIO sirve la página de control de la puerta —el mismo
 *     `public/aeo-control/index.html` que despliega Vercel, leído del disco—, una
 *     página SSR, redirecciones hostiles y una página llena de subrecursos que
 *     apuntan adentro;
 *   - el CANARIO cuenta CONEXIONES TCP y DATAGRAMAS UDP, no pedidos HTTP. Un
 *     STUN de WebRTC manda UDP sin pasar por ningún proxy; un `WebSocket` o un
 *     `<link rel="preconnect">` abren un socket sin pedir nada, y MEDIDO al
 *     escribir esto: con la intercepción de puppeteer puesta y sin las
 *     banderas de `chromium.ts`, el canario contó 3 conexiones y un `UPGRADE`.
 *     Con ellas, cero. Ése es el número que se afirma acá.
 *
 * El DNS es un doble (los `.test` no existen) y el transporte es el de
 * producción con `conectarA`: lo que el examen dejó pasar por una dirección
 * pública va al SITIO, y TODO lo demás va al CANARIO. Así, si la guarda dejara
 * pasar loopback, la metadata o una red privada, el pedido llegaría al canario
 * y el número dejaría de ser cero.
 *
 * CUÁNDO CORRE
 *
 * Sólo con `AEO_CHROME_PATH` apuntando a un Chrome que exista. En la Mac:
 *
 *   AEO_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     npx vitest run src/lib/aeo/__tests__/renderizado.integracion.test.ts
 *
 * Sin la variable se saltea con el motivo escrito en el nombre del bloque, y
 * eso NO es un verde: el CI de este repo no la define, así que ahí estos casos
 * no corren.
 */
import dgram from "node:dgram";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { abrirChromium, BANDERAS_SIN_RED, capasDeRed } from "../chromium";
import { contenidoSinJs, type LecturaDelSitio } from "../hallazgos";
import { AGENTES_IA, MINIMO_DE_TEXTO, textoSinJavaScript } from "../lectura";
import { medirRenderizado, OPCIONES_RENDER, type Bitacora, type DependenciasRender } from "../renderizado";
import { crearTransporteRender } from "../transporteRender";
import { resolvedorDoble } from "./navegadorDoble";

const CHROME = process.env.AEO_CHROME_PATH;
const HAY_CHROME = Boolean(CHROME && existsSync(CHROME));
const MOTIVO = HAY_CHROME
  ? `con ${CHROME}`
  : "SALTEADO: no hay Chrome local — exportá AEO_CHROME_PATH con la ruta de un Chrome para correrlo";

const PUBLICA = "93.184.216.34";
const CONTROL = readFileSync(path.join(process.cwd(), "public", "aeo-control", "index.html"), "utf8");
const SSR = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Clínica de prueba</title></head>
<body><main><h1>Clínica de prueba</h1>
<p>${"Atendemos de lunes a viernes, con turnos por teléfono y en el mostrador. ".repeat(30)}</p>
</main><script>document.body.dataset.listo = "1";</script></body></html>`;

/** Un menú servido de 60 enlaces: lo que el rastreador lee de una página que dibuja el resto. */
const MENU = `<nav>${Array.from({ length: 60 }, (_, i) => `<a href="/s${i}">Sección ${i} del sitio</a>`).join(" ")}</nav>`;
const CONTENIDO_TARDE = "Contenido real que el JavaScript pone con un temporizador. ".repeat(147);

/** P2: el contenido llega con un temporizador, sin un solo pedido a la red. */
const TARDE = `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<main id="app"></main>
<script>setTimeout(() => { document.getElementById("app").textContent = ${JSON.stringify(CONTENIDO_TARDE)}; }, 1500);</script>
</body></html>`;

/** P2: una sección debajo del pliegue que se dibuja cuando se la ve. */
const AL_VERSE = `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}
<div style="height: 4000px"></div><section id="abajo" style="min-height: 10px"></section>
<script>new IntersectionObserver((entradas, o) => {
  if (entradas.some((e) => e.isIntersecting)) { document.getElementById("abajo").textContent = ${JSON.stringify(CONTENIDO_TARDE)}; o.disconnect(); }
}).observe(document.getElementById("abajo"));</script>
</body></html>`;

/** P2: un texto que no deja de crecer. */
const CRECIENTE = `<!doctype html><html><head><meta charset="utf-8"></head><body>${MENU}<div id="goteo"></div>
<script>let i = 0; setInterval(() => { const p = document.createElement("p"); p.textContent = "línea número " + (i++) + " agregada sin parar"; document.getElementById("goteo").appendChild(p); }, 300);</script>
</body></html>`;

let sitio: http.Server;
let canario: http.Server;
let canarioUdp: dgram.Socket;
let puertoSitio = 0;
let puertoCanario = 0;
let puertoUdp = 0;
const enCanario = { conexiones: 0, pedidos: [] as string[], udp: 0 };

function escuchar(servidor: http.Server): Promise<number> {
  return new Promise((listo) => servidor.listen(0, "127.0.0.1", () => listo((servidor.address() as AddressInfo).port)));
}

function paginaConSubrecursos(): string {
  // Todo lo que una página hostil puede intentar, a cada red que importa. Los
  // nombres `.test` los contesta el doble de DNS; las IP van literales.
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="http://127.0.0.1:${puertoCanario}">
<link rel="preconnect" href="http://169.254.169.254">
<link rel="dns-prefetch" href="http://interno.test">
<link rel="stylesheet" href="http://interno.test/estilo.css">
</head><body>
<h1>Página con subrecursos hostiles</h1>
<p>${"Texto visible de la página. ".repeat(30)}</p>
<img src="http://127.0.0.1/pixel.gif">
<iframe src="http://169.254.169.254/latest/meta-data/"></iframe>
<script src="http://interno.test/interno.js"></script>
<script src="http://127.0.0.1:${puertoCanario}/directo.js"></script>
<script>
  fetch("http://169.254.169.254/latest/meta-data/iam/").catch(() => {});
  fetch("http://10.0.0.7/").catch(() => {});
  fetch("http://mixto.test/").catch(() => {});
  try { new WebSocket("ws://127.0.0.1:${puertoCanario}/ws"); } catch (e) {}
  try { new WebSocket("ws://169.254.169.254/ws"); } catch (e) {}
  try { new EventSource("http://127.0.0.1:${puertoCanario}/sse"); } catch (e) {}
  navigator.sendBeacon && navigator.sendBeacon("http://127.0.0.1/beacon", "x");
  // WebRTC: UDP directo a un STUN en loopback, y el mismo intento con el
  // constructor sacado de un iframe recién creado.
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${puertoUdp}" }] });
    pc.createDataChannel("d");
    pc.createOffer().then((o) => pc.setLocalDescription(o));
  } catch (e) {}
  try {
    const f = document.createElement("iframe");
    document.body.appendChild(f);
    const R = f.contentWindow.RTCPeerConnection;
    const pc2 = new R({ iceServers: [{ urls: "stun:127.0.0.1:${puertoUdp}" }] });
    pc2.createDataChannel("d");
    pc2.createOffer().then((o) => pc2.setLocalDescription(o));
  } catch (e) {}
  new Worker(URL.createObjectURL(new Blob([
    "fetch('http://169.254.169.254/w').catch(()=>{}); try { new WebSocket('ws://127.0.0.1:${puertoCanario}/w') } catch (e) {}"
  ])));
  const p = document.createElement("p");
  p.textContent = "Párrafo agregado por JavaScript.";
  document.body.appendChild(p);
</script>
</body></html>`;
}

beforeAll(async () => {
  if (!HAY_CHROME) return;
  canario = http.createServer((req, res) => {
    enCanario.pedidos.push(`${req.method} ${req.url}`);
    res.end("CANARIO");
  });
  canario.on("connection", () => {
    enCanario.conexiones += 1;
  });
  canario.on("upgrade", (req, socket) => {
    enCanario.pedidos.push(`UPGRADE ${req.url}`);
    socket.destroy();
  });
  puertoCanario = await escuchar(canario);
  canarioUdp = dgram.createSocket("udp4");
  canarioUdp.on("message", () => {
    enCanario.udp += 1;
  });
  puertoUdp = await new Promise<number>((listo) =>
    canarioUdp.bind(0, "127.0.0.1", () => listo(canarioUdp.address().port))
  );

  sitio = http.createServer((req, res) => {
    const html = (cuerpo: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(cuerpo);
    };
    switch (req.url) {
      case "/control":
        return html(CONTROL);
      case "/ssr":
        return html(SSR);
      case "/tarde":
        return html(TARDE);
      case "/al-verse":
        return html(AL_VERSE);
      case "/creciente":
        return html(CRECIENTE);
      case "/subrecursos":
        return html(paginaConSubrecursos());
      case "/redir-loopback":
        res.writeHead(302, { location: `http://127.0.0.1/admin` });
        return res.end();
      case "/redir-metadata":
        res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      case "/redir-interno":
        res.writeHead(302, { location: "http://interno.test/" });
        return res.end();
      case "/redir-sana":
        res.writeHead(302, { location: "/ssr" });
        return res.end();
      case "/descarga-blob":
        // La descarga que arma el JavaScript no pasa por la red: ningún
        // `Content-Disposition` que el transporte pueda rechazar.
        return html(`<body><p>${"Página que descarga sola. ".repeat(30)}</p><script>
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob(["x".repeat(1000)]));
          a.download = "aeo-descarga.txt";
          document.body.appendChild(a);
          a.click();
        </script></body>`);
      case "/descarga":
        res.writeHead(200, { "content-type": "application/zip", "content-disposition": "attachment; filename=x.zip" });
        return res.end("PK");
      default:
        res.writeHead(404, { "content-type": "text/html" });
        return res.end("<h1>no</h1>");
    }
  });
  puertoSitio = await escuchar(sitio);
});

afterAll(async () => {
  if (!HAY_CHROME) return;
  await new Promise((listo) => sitio.close(listo));
  await new Promise((listo) => canario.close(listo));
  await new Promise<void>((listo) => canarioUdp.close(() => listo()));
});

beforeEach(() => {
  enCanario.conexiones = 0;
  enCanario.pedidos = [];
  enCanario.udp = 0;
});

function deps(
  banderas: readonly string[] = BANDERAS_SIN_RED,
  quitarWebRtc = true
): DependenciasRender & { aperturas: () => number; cierres: () => number } {
  let aperturas = 0;
  let cierres = 0;
  const abrir = abrirChromium({ ejecutable: CHROME, banderas, quitarWebRtc });
  return {
    abrirNavegador: async () => {
      const n = await abrir();
      aperturas += 1;
      return {
        nuevaPagina: () => n.nuevaPagina(),
        cerrar: async () => {
          await n.cerrar();
          cierres += 1;
        },
      };
    },
    // Lo que pasó el examen con la dirección pública va al sitio; cualquier
    // otra dirección, al canario. Producción no pasa `conectarA`.
    transporte: crearTransporteRender({
      conectarA: ({ ip }) => ({ ip: "127.0.0.1", puerto: ip === PUBLICA ? puertoSitio : puertoCanario }),
    }),
    resolver: resolvedorDoble({
      "sitio.test": [PUBLICA],
      "interno.test": ["10.0.0.7"],
      "mixto.test": [PUBLICA, "127.0.0.1"],
    }).resolver,
    aperturas: () => aperturas,
    cierres: () => cierres,
  };
}

function bitacora(): Bitacora {
  return { bloqueados: [], pedidos: [], statusDocumento: null, falloDocumento: null };
}

/** Chromium pide `/favicon.ico` por su cuenta, al mismo origen: no es de la página. */
function sinFavicon<T extends { url: string }>(pedidos: T[]): T[] {
  return pedidos.filter((p) => !p.url.endsWith("/favicon.ico"));
}

/** El canario mide después de una pausa: un socket tardío también cuenta. */
async function canarioDespues(ms = 1_000) {
  await new Promise((listo) => setTimeout(listo, ms));
  return { ...enCanario, pedidos: [...enCanario.pedidos] };
}

const TODOS_ENTRAN = Object.fromEntries(AGENTES_IA.map((a) => [a, true])) as LecturaDelSitio["acceso"];

describe.skipIf(!HAY_CHROME)(`el renderizado con un Chromium de verdad (${MOTIVO})`, () => {
  it(
    "la página de CONTROL: servido casi cero, renderizado por encima del mínimo, punto ROJO",
    async () => {
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/control", d);
      const servido = textoSinJavaScript(CONTROL);
      console.log(`[H2-GO-1 control] servido=${servido} renderizado=${JSON.stringify(render)}`);

      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(servido).toBeLessThan(60);
      expect(render.caracteres).toBeGreaterThan(MINIMO_DE_TEXTO);

      const punto = contenidoSinJs({
        acceso: TODOS_ENTRAN,
        caracteresSinJs: servido,
        caracteresRenderizados: render,
        schema: [],
        tieneLlmsTxt: false,
      });
      expect(punto.estado).toBe("rojo");
      expect(d.cierres()).toBe(d.aperturas());
    },
    30_000
  );

  it(
    "una página SSR en la MISMA corrida: servido ≈ renderizado, punto VERDE",
    async () => {
      // El control positivo: un auditor que diera rojo siempre pasaría el caso
      // de arriba. Éste es el que no puede pasar.
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/ssr", d);
      const servido = textoSinJavaScript(SSR);
      console.log(`[H2-GO-1 ssr] servido=${servido} renderizado=${JSON.stringify(render)}`);

      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(Math.abs(render.caracteres - servido) / servido).toBeLessThan(0.05);
      expect(
        contenidoSinJs({
          acceso: TODOS_ENTRAN,
          caracteresSinJs: servido,
          caracteresRenderizados: render,
          schema: [],
          tieneLlmsTxt: false,
        }).estado
      ).toBe("verde");
    },
    30_000
  );

  it(
    "P2 — contenido puesto con un temporizador de 1,5 s, sin red: se cuenta, y el punto sale ROJO",
    async () => {
      const render = await medirRenderizado("http://sitio.test/tarde", deps());
      const servido = textoSinJavaScript(TARDE);
      console.log(`[P2 /tarde] servido=${servido} renderizado=${JSON.stringify(render)}`);
      expect(render.estado).toBe("medido");
      if (render.estado !== "medido") return;
      expect(render.caracteres).toBeGreaterThan(servido + 8_000);
      expect(
        contenidoSinJs({ acceso: TODOS_ENTRAN, caracteresSinJs: servido, caracteresRenderizados: render, schema: [], tieneLlmsTxt: false })
          .estado
      ).toBe("rojo");
    },
    30_000
  );

  it(
    "P2 — una sección que un IntersectionObserver dibuja debajo del pliegue: se recorre y se cuenta",
    async () => {
      const render = await medirRenderizado("http://sitio.test/al-verse", deps());
      console.log(`[P2 /al-verse] servido=${textoSinJavaScript(AL_VERSE)} renderizado=${JSON.stringify(render)}`);
      expect(render.estado === "medido" && render.caracteres).toBeGreaterThan(textoSinJavaScript(AL_VERSE) + 8_000);
    },
    30_000
  );

  it(
    "P2 — un texto que no deja de crecer: `inestable`, no un número parcial",
    async () => {
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/creciente", d, { ...OPCIONES_RENDER, topeDomMs: 3_000 });
      expect(render).toEqual({ estado: "fallo", codigo: "inestable" });
      expect(d.cierres()).toBe(d.aperturas());
    },
    30_000
  );

  it(
    "una redirección SANA se sigue: la entrega el transporte y la pide el navegador",
    async () => {
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/redir-sana", deps(), undefined, b);
      expect(render.estado).toBe("medido");
      expect(sinFavicon(b.pedidos).map((p) => p.url)).toEqual(["http://sitio.test/redir-sana", "http://sitio.test/ssr"]);
    },
    30_000
  );

  it.each([
    ["/redir-loopback", "http://127.0.0.1/admin"],
    ["/redir-metadata", "http://169.254.169.254/latest/meta-data/"],
    ["/redir-interno", "http://interno.test/"],
  ])(
    "una redirección hostil (%s) se aborta: red-no-publica, y el canario no recibe nada",
    async (ruta, destino) => {
      const b = bitacora();
      const d = deps();
      const render = await medirRenderizado(`http://sitio.test${ruta}`, d, undefined, b);
      expect(render).toEqual({ estado: "fallo", codigo: "red-no-publica" });
      expect(b.bloqueados).toContainEqual({ url: destino, motivo: "red-no-publica" });
      expect(await canarioDespues(300)).toEqual({ conexiones: 0, pedidos: [], udp: 0 });
      expect(d.cierres()).toBe(d.aperturas());
    },
    30_000
  );

  it.each([
    ["todas las capas", BANDERAS_SIN_RED, true],
    // TCP: sólo el proxy. WebRTC: sólo el constructor borrado.
    ["sólo el proxy inexistente", capasDeRed.proxy, true],
    // TCP: sólo el resolvedor. WebRTC: sólo el constructor borrado.
    ["sólo el resolvedor apagado", capasDeRed.resolvedor, true],
    // WebRTC: sólo la bandera, con el constructor intacto.
    ["las banderas y el constructor de WebRTC intacto", BANDERAS_SIN_RED, false],
  ] as const)(
    "SUBRECURSOS hostiles —loopback, metadata, 10.x, WebSocket, preconnect, worker, WebRTC— con %s: CERO conexiones al canario",
    async (capa, banderas, quitarWebRtc) => {
      const b = bitacora();
      const render = await medirRenderizado("http://sitio.test/subrecursos", deps(banderas, quitarWebRtc), undefined, b);
      const visto = await canarioDespues();
      console.log(`[ssrf ${capa}] render=${JSON.stringify(render)} bloqueados=${b.bloqueados.length} canario=${JSON.stringify(visto)}`);

      expect(render.estado).toBe("medido");
      if (render.estado === "medido") expect(render.caracteres).toBeGreaterThan(MINIMO_DE_TEXTO);
      expect(visto, "ni un socket ni un datagrama llegó a una dirección que no es pública").toEqual({
        conexiones: 0,
        pedidos: [],
        udp: 0,
      });
      // Y salió a la red SÓLO el documento, por la dirección pública.
      expect(sinFavicon(b.pedidos)).toEqual([{ url: "http://sitio.test/subrecursos", ip: PUBLICA }]);
      const motivos = new Set(b.bloqueados.map((x) => x.motivo));
      expect(motivos.has("red-no-publica")).toBe(true);
      expect(b.bloqueados.map((x) => x.url)).toEqual(
        expect.arrayContaining([
          "http://interno.test/interno.js",
          "http://169.254.169.254/latest/meta-data/iam/",
          "http://10.0.0.7/",
          "http://mixto.test/",
        ])
      );
    },
    30_000
  );

  it(
    "el canario VE: sin las banderas, la misma página le abre sockets —el cero de arriba no es un canario sordo—",
    async () => {
      // El control del instrumento, como «el espía registra Y rechaza» en
      // `precondicionRutas.test.ts`: un cero medido por un canario que no puede
      // ver nada se lee igual que un cero de verdad. Sin banderas y con el
      // constructor de WebRTC intacto, el interceptor sigue abortando todos los
      // pedidos HTTP —por eso `pedidos` puede quedar vacío—, y aun así el
      // WebSocket y los preconnect abren sockets, y el STUN manda datagramas.
      const render = await medirRenderizado("http://sitio.test/subrecursos", deps([], false));
      const visto = await canarioDespues();
      console.log(`[ssrf sin banderas] render=${JSON.stringify(render)} canario=${JSON.stringify(visto)}`);
      expect(visto.conexiones).toBeGreaterThan(0);
      expect(visto.udp).toBeGreaterThan(0);
    },
    30_000
  );

  it(
    "una DESCARGA no llega al navegador",
    async () => {
      expect(await medirRenderizado("http://sitio.test/descarga", deps())).toEqual({
        estado: "fallo",
        codigo: "descarga",
      });
    },
    30_000
  );

  it(
    "una descarga que arma el JavaScript (blob + `a.download`) no escribe nada en disco",
    async () => {
      // Esta no la para el transporte —no hay respuesta con `attachment`—: la
      // para `Browser.setDownloadBehavior: deny` en `chromium.ts`. Para poder
      // mirar dónde caería, el perfil es uno temporal con la carpeta de
      // descargas apuntando adentro; nada toca ~/Downloads. MEDIDO: sin la
      // negación, el archivo aparece en esa carpeta.
      const perfil = mkdtempSync(path.join(os.tmpdir(), "aeo-perfil-"));
      const descargas = path.join(perfil, "descargas");
      mkdirSync(descargas);
      mkdirSync(path.join(perfil, "Default"));
      writeFileSync(
        path.join(perfil, "Default", "Preferences"),
        JSON.stringify({ download: { default_directory: descargas, prompt_for_download: false } })
      );
      try {
        const render = await medirRenderizado(
          "http://sitio.test/descarga-blob",
          deps([...BANDERAS_SIN_RED, `--user-data-dir=${perfil}`])
        );
        expect(render.estado).toBe("medido");
        await new Promise((listo) => setTimeout(listo, 1_000));
        expect(readdirSync(descargas)).toEqual([]);
      } finally {
        rmSync(perfil, { recursive: true, force: true });
      }
    },
    30_000
  );

  it(
    "un 404 es `http_404`, no los caracteres de una página de error",
    async () => {
      expect(await medirRenderizado("http://sitio.test/no-existe", deps())).toEqual({
        estado: "fallo",
        codigo: "http_404",
      });
    },
    30_000
  );

  it(
    "el plazo vence con Chromium de verdad: `timeout`, y el navegador queda cerrado",
    async () => {
      const d = deps();
      const render = await medirRenderizado("http://sitio.test/ssr", d, {
        ...OPCIONES_RENDER,
        topeMs: 1,
        plazoPorPedidoMs: 1,
        quietudMs: 0,
        cierreMs: 5_000,
        maxBytesPorRespuesta: 1024,
        maxBytesTotales: 1024,
      });
      expect(render.estado).toBe("fallo");
      expect(d.cierres()).toBe(d.aperturas());
    },
    30_000
  );
});
