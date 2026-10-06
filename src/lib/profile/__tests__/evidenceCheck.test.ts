/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el chequeo de H1.4 dé verde por alguna de las salidas autodeclarativas
 * que la puerta corregida nombra: un denominador elegido a mano, una ficha
 * vacía, la evidencia en el propio dominio, el «verificada a mano» sin techo, o
 * un chequeo que no sabe decir que no.
 *
 * LOS DOBLES RECORREN LA SECUENCIA (R13)
 *
 * `internet` es un doble con estado: un DNS que contesta por nombre y un
 * transporte que contesta por URL Y MÉTODO, y que anota cada pedido en orden.
 * No se le pregunta «¿resolvió?»: se le pregunta qué pidió el chequeo, en qué
 * orden y a qué dirección — HEAD, después GET con `Range` si el origen rechazó
 * HEAD, después el salto de la redirección. Un doble que contestara el veredicto
 * final empezaría en el estado final, que es lo que R13 prohíbe.
 *
 * Los sockets reales están en `evidenceCheck.sockets.test.ts`; acá se mide la
 * lógica con todos sus caminos, que con un servidor de verdad serían lentos o
 * imposibles (una IP privada en un DNS, un 6to4).
 */
import { describe, expect, it } from "vitest";
import {
  chequearEvidencia,
  clasificarUrl,
  dominioPropio,
  esIpPublica,
  esOrigenPropio,
  OPCIONES_POR_DEFECTO,
  type Afirmacion,
  type Dependencias,
  type EntradaChequeo,
  type Fuente,
  type PedidoHttp,
  type ResultadoChequeo,
} from "../evidenceCheck";

// ─────────────────────────────────────────────────────────────────────────────
// El doble de internet
// ─────────────────────────────────────────────────────────────────────────────

const IP_PUBLICA = "93.184.216.34";
const IP_PUBLICA_2 = "151.101.1.69";

type Respuesta = { status: number; location?: string } | "cuelga" | "error";
type Manejador = (pedido: PedidoHttp) => Respuesta;

function crearInternet() {
  const dns = new Map<string, string[]>();
  const sitios = new Map<string, Manejador>();
  const pedidos: Array<{ metodo: string; url: string; ip: string; rango: boolean }> = [];
  const consultasDns: string[] = [];

  const deps: Dependencias = {
    resolver: async (host) => {
      consultasDns.push(host);
      const ips = dns.get(host);
      return ips ? { ok: true, direcciones: ips } : { ok: false };
    },
    transporte: async (pedido) => {
      pedidos.push({ metodo: pedido.metodo, url: pedido.url, ip: pedido.ip, rango: pedido.rango });
      const manejador = sitios.get(pedido.url);
      const r = manejador ? manejador(pedido) : { status: 404 };
      if (r === "cuelga") return new Promise(() => {});
      if (r === "error") return { tipo: "error", motivo: "sin-respuesta" };
      return { tipo: "respuesta", status: r.status, location: r.location ?? null };
    },
    sufijoAleatorio: () => "0123456789abcdef",
  };

  return {
    deps,
    pedidos,
    consultasDns,
    /** Un host público que contesta lo que diga `manejador` por cada URL suya. */
    sitio(url: string, manejador: Manejador, ips: string[] = [IP_PUBLICA]) {
      dns.set(new URL(url).hostname, ips);
      sitios.set(url, manejador);
    },
    dns,
  };
}

const sano: Manejador = () => ({ status: 200 });

function hostDe(url: string): string {
  // El doble de `url_host` de la 0026 para URLs bien formadas: esquema, path,
  // puerto, `usuario@` y mayúsculas afuera. Los casos donde diverge de Node son
  // justamente los que un test de abajo construye a mano.
  return url.split("://")[1].split("/")[0].replace(/^[^@/]*@/, "").split(":")[0].toLowerCase();
}

let siguienteId = 0;
function fuenteHttp(objetivoId: string, url: string, extra: Partial<Fuente> = {}): Fuente {
  return {
    id: `fuente-${++siguienteId}`,
    objetivoId,
    tipo: "http",
    url,
    hostFuente: hostDe(url),
    verificadaEn: null,
    verificadaPor: null,
    ...extra,
  };
}
function fuenteManual(objetivoId: string, url: string): Fuente {
  return fuenteHttp(objetivoId, url, {
    tipo: "manual",
    verificadaEn: "2026-10-01T10:00:00Z",
    verificadaPor: "11111111-1111-4111-8111-111111111111",
  });
}
function afirmaciones(cuantas: number): Afirmacion[] {
  return Array.from({ length: cuantas }, (_, i) => ({ id: `obj-${i + 1}`, tipo: "claim" }));
}

const PROPIO = "ejemplo-propio.com";

async function correr(entrada: Partial<EntradaChequeo> & { afirmaciones: Afirmacion[] }, internet = crearInternet()) {
  const salida = await chequearEvidencia(
    {
      n: entrada.n ?? entrada.afirmaciones.length,
      afirmaciones: entrada.afirmaciones,
      fuentes: entrada.fuentes ?? [],
      hostPropio: entrada.hostPropio === undefined ? PROPIO : entrada.hostPropio,
    },
    internet.deps
  );
  if (!salida.ok) throw new Error(`la corrida no terminó: ${salida.motivo}`);
  return salida as ResultadoChequeo;
}

// ─────────────────────────────────────────────────────────────────────────────
// El control positivo primero: el verde existe
// ─────────────────────────────────────────────────────────────────────────────

describe("el verde existe, y es la única forma de que el resto de este archivo signifique algo", () => {
  it("dos afirmaciones con fuentes ajenas que responden 200: verde, M = 0, y la línea lo dice", async () => {
    const internet = crearInternet();
    internet.sitio("https://fuente-uno.org/informe", sano);
    internet.sitio("https://fuente-dos.org/dato", sano);
    const r = await correr(
      {
        afirmaciones: afirmaciones(2),
        fuentes: [
          fuenteHttp("obj-1", "https://fuente-uno.org/informe"),
          fuenteHttp("obj-2", "https://fuente-dos.org/dato"),
        ],
      },
      internet
    );

    expect(r.motivosRojo).toEqual([]);
    expect(r.verde).toBe(true);
    expect(r.n).toBe(2);
    expect(r.m).toBe(0);
    expect(r.cubetas).toEqual({ resuelta: 2, noResuelve: 0, aMano: 0, degradadas: 0 });
    expect(r.linea.startsWith("2 afirmaciones, 0 sin evidencia resoluble")).toBe(true);
    expect(r.linea).toContain("VERDE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El denominador
// ─────────────────────────────────────────────────────────────────────────────

describe("el denominador es el de PostgreSQL, no el de la lista", () => {
  it("si la lista leída no tiene N filas, no cuenta: lectura-incompleta", async () => {
    // Mutación 11: usar `afirmaciones.length` como N haría que una página cortada
    // por PostgREST se informe como una ficha más chica — y en verde.
    const internet = crearInternet();
    internet.sitio("https://fuente-uno.org/informe", sano);
    const salida = await chequearEvidencia(
      {
        n: 3,
        afirmaciones: afirmaciones(1),
        fuentes: [fuenteHttp("obj-1", "https://fuente-uno.org/informe")],
        hostPropio: PROPIO,
      },
      internet.deps
    );

    expect(salida).toEqual({ ok: false, motivo: "lectura-incompleta", n: 3, leidas: 1 });
    expect(internet.pedidos, "una lectura rota no sale a la red").toEqual([]);
  });

  it("N = 0 es rojo: una ficha vacía no pasa por estar vacía", async () => {
    // Mutación 9.
    const r = await correr({ afirmaciones: [] });
    expect(r.verde).toBe(false);
    expect(r.motivosRojo).toContain("n-cero");
    expect(r.linea.startsWith("0 afirmaciones, 0 sin evidencia resoluble")).toBe(true);
    expect(r.porcentajeAMano, "sin denominador no hay porcentaje, y no es 0%").toBeNull();
  });

  it("una afirmación sin ninguna evidencia cuenta en M", async () => {
    // Mutación 10: si «sin evidencia» no contara, borrar las fuentes rotas de
    // una afirmación la sacaría de M.
    const internet = crearInternet();
    internet.sitio("https://fuente-uno.org/informe", sano);
    const r = await correr(
      { afirmaciones: afirmaciones(2), fuentes: [fuenteHttp("obj-1", "https://fuente-uno.org/informe")] },
      internet
    );
    expect(r.m).toBe(1);
    expect(r.afirmacionesSinEvidencia).toBe(1);
    expect(r.afirmaciones.find((a) => a.id === "obj-2")).toEqual({ id: "obj-2", resuelve: false, sinEvidencia: true });
    expect(r.motivosRojo).toContain("afirmaciones-sin-evidencia-resoluble");
    expect(r.verde).toBe(false);
  });

  it("una afirmación con una fuente sana y otra rota cuenta en M: alguna, no todas", async () => {
    const internet = crearInternet();
    internet.sitio("https://fuente-uno.org/informe", sano);
    internet.sitio("https://fuente-dos.org/borrada", () => ({ status: 404 }));
    const r = await correr(
      {
        afirmaciones: afirmaciones(1),
        fuentes: [
          fuenteHttp("obj-1", "https://fuente-uno.org/informe"),
          fuenteHttp("obj-1", "https://fuente-dos.org/borrada"),
        ],
      },
      internet
    );
    expect(r.m).toBe(1);
    expect(r.cubetas.noResuelve).toBe(1);
    expect(r.fuentes.find((f) => f.url.endsWith("/borrada"))?.motivo).toBe("http-404");
    expect(r.verde).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HEAD, y cuándo se degrada
// ─────────────────────────────────────────────────────────────────────────────

describe("HEAD primero, y GET con Range sólo si el origen rechaza el método", () => {
  for (const rechazo of [405, 403, 501]) {
    it(`un ${rechazo} a HEAD se pregunta de nuevo con GET y Range, y queda anotado`, async () => {
      // Mutación 7: sin la degradación, un sitio que no implementa HEAD se
      // contaría como fuente caída por un motivo que no es el que se mide.
      const internet = crearInternet();
      internet.sitio("https://sin-head.org/pdf", (p) => (p.metodo === "HEAD" ? { status: rechazo } : { status: 206 }));
      const c = await clasificarUrl("https://sin-head.org/pdf", "sin-head.org", PROPIO, internet.deps);

      expect(internet.pedidos.map((p) => `${p.metodo}${p.rango ? "+rango" : ""}`)).toEqual(["HEAD", "GET+rango"]);
      expect(c).toMatchObject({ cubeta: "resuelta", degradada: true, status: 206, motivo: null });
    });
  }

  it("un 404 a HEAD NO se degrada: el origen habló del recurso, no del método", async () => {
    const internet = crearInternet();
    internet.sitio("https://fuente.org/no-esta", () => ({ status: 404 }));
    const c = await clasificarUrl("https://fuente.org/no-esta", "fuente.org", PROPIO, internet.deps);
    expect(internet.pedidos.map((p) => p.metodo)).toEqual(["HEAD"]);
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "http-404", status: 404, medida: true });
  });

  it("degradado y aun así 403: no resuelve, con el status del GET", async () => {
    const internet = crearInternet();
    internet.sitio("https://cerrado.org/x", () => ({ status: 403 }));
    const c = await clasificarUrl("https://cerrado.org/x", "cerrado.org", PROPIO, internet.deps);
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "http-403", degradada: true });
  });

  it("las degradadas se publican aparte dentro de las resueltas", async () => {
    const internet = crearInternet();
    internet.sitio("https://sin-head.org/pdf", (p) => (p.metodo === "HEAD" ? { status: 405 } : { status: 206 }));
    const r = await correr(
      { afirmaciones: afirmaciones(1), fuentes: [fuenteHttp("obj-1", "https://sin-head.org/pdf")] },
      internet
    );
    expect(r.cubetas).toMatchObject({ resuelta: 1, degradadas: 1 });
    expect(r.linea).toContain("1 resueltas (1 degradadas a GET)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Redirecciones
// ─────────────────────────────────────────────────────────────────────────────

describe("las redirecciones se siguen a mano, con el examen en cada salto", () => {
  it("301 a otro host ajeno y después 200: resuelta, un salto, y cada salto pasa por DNS", async () => {
    const internet = crearInternet();
    internet.sitio("http://viejo.org/a", () => ({ status: 301, location: "https://nuevo.org/a" }));
    internet.sitio("https://nuevo.org/a", sano, [IP_PUBLICA_2]);
    const c = await clasificarUrl("http://viejo.org/a", "viejo.org", PROPIO, internet.deps);

    expect(c).toMatchObject({ cubeta: "resuelta", saltos: 1 });
    expect(internet.consultasDns).toEqual(["viejo.org", "nuevo.org"]);
    expect(internet.pedidos.map((p) => [p.url, p.ip])).toEqual([
      ["http://viejo.org/a", IP_PUBLICA],
      ["https://nuevo.org/a", IP_PUBLICA_2],
    ]);
  });

  it("una fuente ajena que redirige al propio dominio no es una fuente ajena", async () => {
    // Mutación 2: con el examen de origen sólo en el primer salto, cualquiera
    // pasa la regla poniendo un acortador delante del propio sitio.
    const internet = crearInternet();
    internet.sitio("https://acortador.io/x", () => ({ status: 302, location: `https://www.${PROPIO}/sobre-nosotros` }));
    const c = await clasificarUrl("https://acortador.io/x", "acortador.io", PROPIO, internet.deps);

    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "origen-propio", status: 302 });
    expect(internet.pedidos.map((p) => p.url)).toEqual(["https://acortador.io/x"]);
  });

  it("un salto a la metadata de la nube por IP se rechaza en el salto, sin pedirle nada", async () => {
    const internet = crearInternet();
    internet.sitio("https://trampolin.org/x", () => ({ status: 302, location: "http://169.254.169.254/latest/meta-data/" }));
    const c = await clasificarUrl("https://trampolin.org/x", "trampolin.org", PROPIO, internet.deps);

    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-literal" });
    expect(internet.pedidos.map((p) => p.url)).toEqual(["https://trampolin.org/x"]);
  });

  it("un salto a un NOMBRE que resuelve a una IP privada se rechaza en el examen de IP", async () => {
    // Mutación 6: sin re-examinar la dirección del salto, una fuente pública es
    // un trampolín hacia la red interna.
    const internet = crearInternet();
    internet.sitio("https://trampolin.org/y", () => ({ status: 307, location: "http://interno.corp/admin" }));
    internet.dns.set("interno.corp", ["10.0.0.7"]);
    const c = await clasificarUrl("https://trampolin.org/y", "trampolin.org", PROPIO, internet.deps);
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-no-publica" });
    expect(internet.pedidos).toHaveLength(1);
  });

  it("tres redirecciones y después 200 resuelve; la cuarta ya no se sigue", async () => {
    // Mutación 13: sin tope, un bucle de redirecciones se come el presupuesto
    // de la corrida entera.
    const internet = crearInternet();
    for (let i = 0; i < 4; i++) {
      internet.sitio(`https://r.org/${i}`, () => ({ status: 302, location: `https://r.org/${i + 1}` }));
    }
    internet.sitio("https://r.org/3-ok", sano);
    internet.sitio("https://r.org/2b", () => ({ status: 302, location: "https://r.org/3-ok" }));
    internet.sitio("https://r.org/1b", () => ({ status: 302, location: "https://r.org/2b" }));
    internet.sitio("https://r.org/0b", () => ({ status: 302, location: "https://r.org/1b" }));

    const tres = await clasificarUrl("https://r.org/0b", "r.org", PROPIO, internet.deps);
    expect(tres).toMatchObject({ cubeta: "resuelta", saltos: 3 });

    const cuatro = await clasificarUrl("https://r.org/0", "r.org", PROPIO, internet.deps);
    expect(cuatro).toMatchObject({ cubeta: "no-resuelve", motivo: "demasiadas-redirecciones", saltos: 3 });
  });

  it("un 3xx sin Location no resuelve", async () => {
    const internet = crearInternet();
    internet.sitio("https://raro.org/x", () => ({ status: 302 }));
    const c = await clasificarUrl("https://raro.org/x", "raro.org", PROPIO, internet.deps);
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "redireccion-sin-destino" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El dominio propio
// ─────────────────────────────────────────────────────────────────────────────

describe("el propio dominio no es una fuente", () => {
  it("una fuente en el propio dominio no sale a la red y no resuelve", async () => {
    // Mutación 1.
    const internet = crearInternet();
    internet.sitio(`https://${PROPIO}/casos`, sano);
    const c = await clasificarUrl(`https://${PROPIO}/casos`, PROPIO, PROPIO, internet.deps);
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "origen-propio", medida: false });
    expect(internet.pedidos).toEqual([]);
    expect(internet.consultasDns).toEqual([]);
  });

  it("en los dos sentidos, con y sin www, y los subdominios", () => {
    const propio = dominioPropio("www.ejemplo.com") as string;
    expect(propio).toBe("ejemplo.com");
    for (const host of ["ejemplo.com", "www.ejemplo.com", "blog.ejemplo.com", "EJEMPLO.com.", "a.b.ejemplo.com"]) {
      expect(esOrigenPropio(host, propio), host).toBe(true);
    }
    // El padre del propio, cuando el sitio vive en un subdominio.
    expect(esOrigenPropio("ejemplo.com", dominioPropio("tienda.ejemplo.com") as string)).toBe(true);
    for (const host of ["ejemplo.com.ar", "otroejemplo.com", "ejemplo.com.evil.net", "com"]) {
      expect(esOrigenPropio(host, propio), host).toBe(host === "com");
    }
  });

  it("cuando la base y Node leen hosts distintos, no se elige uno: url-ambigua", async () => {
    // Mutación 3. `url_host` de la 0026 lee `otro.org` (saca todo hasta la @);
    // el URL de Node trata la barra invertida como separador y lee el PROPIO
    // dominio. Con sólo la columna, la regla de origen distinto aprobaría una
    // fuente que la petición iría a buscar al propio sitio.
    const internet = crearInternet();
    internet.sitio(`https://${PROPIO}/`, sano);
    const url = `https://${PROPIO}\\@otro.org/`;
    expect(new URL(url).hostname).toBe(PROPIO);
    expect(hostDe(url)).toBe("otro.org");

    const c = await clasificarUrl(url, hostDe(url), PROPIO, internet.deps);
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "url-ambigua" });
    expect(internet.pedidos).toEqual([]);
  });

  it("un IDN, un host con %, una IP decimal: los dos parsers no coinciden y no resuelve", async () => {
    const internet = crearInternet();
    for (const [url, columna] of [
      ["https://café.se/x", "café.se"],
      ["http://ex%61mple.org/", "ex%61mple.org"],
      ["http://2130706433/", "2130706433"],
    ]) {
      const c = await clasificarUrl(url, columna, PROPIO, internet.deps);
      expect(c.motivo, url).toBe("url-ambigua");
    }
    expect(internet.pedidos).toEqual([]);
  });

  for (const website of ["", null, "   ", "café.se", "1.2.3.4", "localhost", "ejemplo .com"]) {
    it(`dominio propio ${JSON.stringify(website)}: el chequeo se niega, no deja pasar nada y no sale a la red`, async () => {
      // Mutación 4. Es el riesgo que la 0026 dejó escrito: con `url_host('')` =
      // '' la regla «origen distinto» es cierta para cualquier fuente, incluida
      // una del propio sitio.
      const internet = crearInternet();
      internet.sitio("https://fuente-uno.org/informe", sano);
      const r = await correr(
        {
          afirmaciones: afirmaciones(1),
          fuentes: [fuenteHttp("obj-1", "https://fuente-uno.org/informe")],
          hostPropio: website,
        },
        internet
      );
      expect(r.verde).toBe(false);
      expect(r.motivosRojo).toContain("dominio-propio-desconocido");
      expect(r.fuentes[0]).toMatchObject({ cubeta: "no-resuelve", motivo: "dominio-propio-desconocido" });
      expect(internet.pedidos).toEqual([]);
      expect(internet.consultasDns).toEqual([]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SSRF
// ─────────────────────────────────────────────────────────────────────────────

describe("el servidor no sale a donde no debe", () => {
  it("ninguna dirección interna, reservada o de documentación es pública", () => {
    // Mutación 5.
    const internas = [
      "127.0.0.1", "127.255.255.254", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "100.64.0.1", "192.0.2.10", "198.51.100.1", "203.0.113.9",
      "198.18.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1",
      "::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
      "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "2001:0:4136:e378::1", "ff02::1",
      "no-es-una-ip",
    ];
    for (const ip of internas) expect(esIpPublica(ip), ip).toBe(false);
    for (const ip of [IP_PUBLICA, "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) {
      expect(esIpPublica(ip), ip).toBe(true);
    }
  });

  it("si UNA de las direcciones resueltas es privada, no se conecta a ninguna", async () => {
    const internet = crearInternet();
    internet.sitio("https://mixto.org/x", sano, [IP_PUBLICA, "10.0.0.1"]);
    const c = await clasificarUrl("https://mixto.org/x", "mixto.org", PROPIO, internet.deps);
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-no-publica" });
    expect(internet.pedidos).toEqual([]);
  });

  it("se conecta a la dirección examinada, la primera, y no a otra", async () => {
    const internet = crearInternet();
    internet.sitio("https://dos-ips.org/x", sano, [IP_PUBLICA_2, IP_PUBLICA]);
    await clasificarUrl("https://dos-ips.org/x", "dos-ips.org", PROPIO, internet.deps);
    expect(internet.pedidos[0].ip).toBe(IP_PUBLICA_2);
  });

  it("una IP literal, privada O PÚBLICA, no es una fuente: no tiene dominio que comparar con el propio", async () => {
    // Mutación 18. Con la comparación por nombre sola, el propio sitio citado
    // por la IP de su servidor pasaría la regla de origen distinto.
    const internet = crearInternet();
    for (const [url, columna] of [
      ["http://127.0.0.1/", "127.0.0.1"],
      [`http://${IP_PUBLICA}/casos`, IP_PUBLICA],
    ]) {
      const c = await clasificarUrl(url, columna, PROPIO, internet.deps);
      expect(c, url).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-literal", medida: false });
    }
    const r = await correr({
      afirmaciones: afirmaciones(1),
      fuentes: [fuenteManual("obj-1", `https://${IP_PUBLICA}/x`)],
    });
    expect(r.fuentes[0]).toMatchObject({ cubeta: "no-resuelve", motivo: "ip-literal" });
    expect(internet.pedidos).toEqual([]);
    expect(internet.consultasDns).toEqual([]);
  });

  it("esquema, puerto y credenciales se rechazan antes de cualquier DNS", async () => {
    // Mutación 14: credenciales en la URL.
    const internet = crearInternet();
    internet.dns.set("fuente.org", [IP_PUBLICA]);
    const casos: Array<[string, string]> = [
      ["https://fuente.org:8443/x", "puerto"],
      ["http://fuente.org:22/x", "puerto"],
      ["https://usuario:clave@fuente.org/x", "credenciales"],
      ["https://usuario@fuente.org/x", "credenciales"],
    ];
    for (const [url, motivo] of casos) {
      const c = await clasificarUrl(url, "fuente.org", PROPIO, internet.deps);
      expect(c.motivo, url).toBe(motivo);
    }
    // Un esquema que no es http/https sólo puede llegar por una redirección:
    // el CHECK de la 0026 ya no deja cargarlo.
    internet.sitio("https://fuente.org/a-ftp", () => ({ status: 302, location: "ftp://fuente.org/archivo" }));
    expect((await clasificarUrl("https://fuente.org/a-ftp", "fuente.org", PROPIO, internet.deps)).motivo).toBe("esquema");
    // Puertos 80 y 443 explícitos sí valen, en cualquiera de los dos esquemas.
    internet.sitio("https://fuente.org/ok", sano);
    expect((await clasificarUrl("https://fuente.org:443/ok", "fuente.org", PROPIO, internet.deps)).cubeta).toBe("resuelta");

    expect(internet.consultasDns.filter((h) => h === "fuente.org")).toHaveLength(2);
  });

  it("un DNS que no contesta es «dns», y un transporte que cuelga es «timeout» dentro del presupuesto", async () => {
    const internet = crearInternet();
    expect((await clasificarUrl("https://no-existe.org/", "no-existe.org", PROPIO, internet.deps)).motivo).toBe("dns");

    internet.sitio("https://lenta.org/", () => "cuelga");
    const antes = Date.now();
    const c = await clasificarUrl("https://lenta.org/", "lenta.org", PROPIO, internet.deps, {
      ...OPCIONES_POR_DEFECTO,
      presupuestoPorFuenteMs: 80,
    });
    expect(c).toMatchObject({ cubeta: "no-resuelve", motivo: "timeout", medida: true, status: null });
    expect(Date.now() - antes).toBeLessThan(2_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Verificada a mano
// ─────────────────────────────────────────────────────────────────────────────

describe("verificada a mano es una cubeta aparte, con techo", () => {
  async function conManuales(n: number, manuales: number) {
    const internet = crearInternet();
    const fuentes: Fuente[] = [];
    for (let i = 1; i <= n; i++) {
      if (i <= manuales) fuentes.push(fuenteManual(`obj-${i}`, `https://detras-de-login.org/${i}`));
      else {
        internet.sitio(`https://fuente.org/${i}`, sano);
        fuentes.push(fuenteHttp(`obj-${i}`, `https://fuente.org/${i}`));
      }
    }
    return { r: await correr({ afirmaciones: afirmaciones(n), fuentes }, internet), internet };
  }

  it("1 de 5 es el 20% exacto: entra, y el porcentaje se imprime", async () => {
    const { r, internet } = await conManuales(5, 1);
    expect(r.cubetas).toMatchObject({ resuelta: 4, aMano: 1, noResuelve: 0 });
    expect(r.porcentajeAMano).toBe(20);
    expect(r.verde).toBe(true);
    expect(r.linea).toContain("1 verificadas a mano = 20% de N (tope 20%)");
    expect(internet.pedidos.some((p) => p.url.includes("detras-de-login")), "una manual no sale a la red").toBe(false);
  });

  it("2 de 9 es 22,2%: rojo, aunque todas resuelvan", async () => {
    // Mutación 8.
    const { r } = await conManuales(9, 2);
    expect(r.m).toBe(0);
    expect(r.porcentajeAMano).toBe(22.2);
    expect(r.motivosRojo).toEqual(["a-mano-sobre-el-tope"]);
    expect(r.verde).toBe(false);
  });

  it("una manual sin fecha o sin persona no es una verificación", async () => {
    const r = await correr({
      afirmaciones: afirmaciones(1),
      fuentes: [{ ...fuenteManual("obj-1", "https://detras-de-login.org/1"), verificadaPor: null }],
    });
    expect(r.fuentes[0]).toMatchObject({ cubeta: "no-resuelve", motivo: "manual-sin-verificacion" });
  });

  it("una manual en el propio dominio tampoco vale", async () => {
    const r = await correr({ afirmaciones: afirmaciones(1), fuentes: [fuenteManual("obj-1", `https://${PROPIO}/x`)] });
    expect(r.fuentes[0]).toMatchObject({ cubeta: "no-resuelve", motivo: "origen-propio" });
  });

  it("un tipo que no es http ni manual no resuelve", async () => {
    const r = await correr({
      afirmaciones: afirmaciones(1),
      fuentes: [fuenteHttp("obj-1", "https://fuente.org/1", { tipo: "texto" })],
    });
    expect(r.fuentes[0]).toMatchObject({ cubeta: "no-resuelve", motivo: "tipo-desconocido" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La contraprueba, en la misma corrida
// ─────────────────────────────────────────────────────────────────────────────

describe("la contraprueba corre en la misma corrida y entra en el veredicto", () => {
  it("la inventada pasa por el DNS de verdad del chequeo y la propia no sale: las dos suben «no resuelve»", async () => {
    const internet = crearInternet();
    internet.sitio("https://fuente-uno.org/informe", sano);
    const r = await correr(
      { afirmaciones: afirmaciones(1), fuentes: [fuenteHttp("obj-1", "https://fuente-uno.org/informe")] },
      internet
    );

    expect(internet.consultasDns).toContain("evidencia-inventada-0123456789abcdef.invalid");
    expect(internet.pedidos.map((p) => p.url)).toEqual(["https://fuente-uno.org/informe"]);
    expect(r.contraprueba).toMatchObject({
      inventada: { cubeta: "no-resuelve", motivo: "dns", url: "https://evidencia-inventada-0123456789abcdef.invalid/" },
      propia: { cubeta: "no-resuelve", motivo: "origen-propio", url: `https://${PROPIO}/` },
      subioNoResuelve: 2,
      ok: true,
    });
    // Los controles no entran en N ni en las cubetas de la ficha.
    expect(r.cubetas.noResuelve).toBe(0);
    expect(r.linea).toContain("contraprueba: inventada no-resuelve (dns), propia no-resuelve (origen-propio), no-resuelve +2");
  });

  it("si la URL inventada RESUELVE, el chequeo no sabe decir que no: rojo con todo lo demás sano", async () => {
    // Mutación 12. Es el caso de un resolvedor que secuestra NXDOMAIN y contesta
    // con su propia página: en ese entorno un enlace roto «responde 200», y la
    // corrida no puede afirmar nada.
    const internet = crearInternet();
    internet.sitio("https://fuente-uno.org/informe", sano);
    internet.sitio("https://evidencia-inventada-0123456789abcdef.invalid/", sano);
    const r = await correr(
      { afirmaciones: afirmaciones(1), fuentes: [fuenteHttp("obj-1", "https://fuente-uno.org/informe")] },
      internet
    );
    expect(r.m).toBe(0);
    expect(r.contraprueba.ok).toBe(false);
    expect(r.contraprueba.subioNoResuelve).toBe(1);
    expect(r.motivosRojo).toEqual(["contraprueba-fallida"]);
    expect(r.verde).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La corrida entra en el tiempo
// ─────────────────────────────────────────────────────────────────────────────

describe("la corrida tiene tope, y lo que queda afuera no se da por bueno", () => {
  it("las URLs que exceden el tope no salen y no resuelven; una URL repetida sale una sola vez", async () => {
    const internet = crearInternet();
    const fuentes: Fuente[] = [];
    const tope = OPCIONES_POR_DEFECTO.maxFuentesHttp;
    for (let i = 1; i <= tope + 2; i++) {
      internet.sitio(`https://fuente.org/${i}`, sano);
      fuentes.push(fuenteHttp(`obj-${i}`, `https://fuente.org/${i}`));
    }
    // La misma URL citada por otra afirmación.
    fuentes.push(fuenteHttp("obj-1", "https://fuente.org/1"));
    const r = await correr({ afirmaciones: afirmaciones(tope + 2), fuentes }, internet);

    const pedidosFuente = internet.pedidos.filter((p) => p.url.startsWith("https://fuente.org/"));
    expect(pedidosFuente).toHaveLength(tope);
    expect(r.fuentes.filter((f) => f.motivo === "tope-de-corrida")).toHaveLength(2);
    expect(r.cubetas.resuelta).toBe(tope + 1);
    expect(r.verde).toBe(false);
  });
});
