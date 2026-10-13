/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría mezcle lo que impide una cita con lo que la empeora, y que
 * `llms.txt` se cuente como posicionamiento.
 */
import { describe, expect, it } from "vitest";
import { AGENTES_IA, MINIMO_DE_TEXTO } from "../lectura";
import {
  contenidoSinJs,
  esLegiblePorIA,
  FRACCION_MINIMA_SERVIDA,
  hallazgos,
  puntosDeLaPuerta,
  type LecturaDelSitio,
} from "../hallazgos";

const TODOS_ENTRAN = Object.fromEntries(AGENTES_IA.map((a) => [a, true])) as LecturaDelSitio["acceso"];

/**
 * Un sitio sin ningún problema, que los casos van rompiendo.
 *
 * Desde que existe el renderizado, «sin ningún problema» incluye que se MIDIÓ:
 * una lectura sin el número renderizado es «no medido» en el punto del texto
 * (ver `contenidoSinJs`), y un sitio sano no puede serlo por no haber mirado.
 */
const TODOS_200 = Object.fromEntries(AGENTES_IA.map((a) => [a, 200])) as NonNullable<LecturaDelSitio["statusPorAgente"]>;

const SANO: LecturaDelSitio = {
  acceso: TODOS_ENTRAN,
  // Y lo mismo con el acceso: «sin problemas» es que cada agente recibió una
  // respuesta, no que nadie preguntó (P3).
  statusPorAgente: TODOS_200,
  caracteresSinJs: 4000,
  caracteresRenderizados: { estado: "medido", caracteres: 4000 },
  schema: ["Organization", "LocalBusiness", "FAQPage"],
  tieneLlmsTxt: true,
};

describe("qué encuentra la auditoría", () => {
  it("un sitio sano no tiene hallazgos", () => {
    // Sin esto, cualquier lista no vacía pasaría los casos de abajo y la pantalla
    // siempre mostraría algo que arreglar.
    expect(hallazgos(SANO)).toEqual([]);
    expect(esLegiblePorIA([])).toBe(true);
  });

  it("bloquear a TODOS los rastreadores es bloqueante", () => {
    const bloqueados = Object.fromEntries(AGENTES_IA.map((a) => [a, false])) as LecturaDelSitio["acceso"];
    const lista = hallazgos({ ...SANO, acceso: bloqueados });
    expect(lista[0].gravedad).toBe("bloqueante");
    expect(lista[0].donde).toMatch(/robots\.txt/);
    expect(esLegiblePorIA(lista)).toBe(false);
  });

  it("bloquear a algunos lo dice CON NOMBRE, y no lo funde con bloquear a todos", () => {
    // Son dos situaciones distintas: una es una decisión de configuración, la
    // otra suele ser un descuido heredado. Fundirlas manda a revisar de más.
    const lista = hallazgos({ ...SANO, acceso: { ...TODOS_ENTRAN, claudebot: false } });
    expect(lista[0].quePasa).toContain("claudebot");
    expect(lista[0].quePasa).toMatch(/los demás sí entran/i);
  });

  it("un sitio que necesita JavaScript es bloqueante, y dice dónde se arregla", () => {
    const lista = hallazgos({ ...SANO, caracteresSinJs: 40 });
    const h = lista.find((x) => x.quePasa.includes("JavaScript"));
    expect(h?.gravedad).toBe("bloqueante");
    expect(h?.donde).toMatch(/renderizado/);
  });

  it("el schema faltante es IMPORTANTE, no bloqueante", () => {
    // Empeora la cita, no la impide. Marcarlo bloqueante haría que un sitio
    // visible pero mejorable se viera igual que uno invisible.
    const lista = hallazgos({ ...SANO, schema: [] });
    expect(lista[0].gravedad).toBe("importante");
    expect(esLegiblePorIA(lista)).toBe(true);
  });

  it("dice QUÉ tipo de schema falta, no que falte schema", () => {
    const lista = hallazgos({ ...SANO, schema: ["Organization", "LocalBusiness"] });
    expect(lista[0].quePasa).toContain("FAQPage");
    expect(lista[0].quePasa).not.toContain("Organization");
  });

  it("`llms.txt` es INFORMATIVO y dice que no cuenta como posicionamiento", () => {
    // Es la métrica de vanidad de esta pantalla. Si algún día se marca como
    // importante, este test tiene que ponerse rojo y obligar a discutirlo.
    const lista = hallazgos({ ...SANO, tieneLlmsTxt: false });
    expect(lista[0].gravedad).toBe("informativo");
    expect(lista[0].queHacer).toMatch(/no cuenta como posicionamiento/i);
    expect(esLegiblePorIA(lista)).toBe(true);
  });

  it("un sitio roto entero acumula los hallazgos, sin perder ninguno", () => {
    const bloqueados = Object.fromEntries(AGENTES_IA.map((a) => [a, false])) as LecturaDelSitio["acceso"];
    const lista = hallazgos({
      acceso: bloqueados,
      caracteresSinJs: 10,
      schema: [],
      tieneLlmsTxt: false,
    });
    expect(lista).toHaveLength(4);
    expect(lista.filter((h) => h.gravedad === "bloqueante")).toHaveLength(2);
    expect(esLegiblePorIA(lista)).toBe(false);
  });

  it("todos los hallazgos dicen dónde se arregla", () => {
    // Un hallazgo sin lugar es un «error» sin motivo: manda a buscar.
    const bloqueados = Object.fromEntries(AGENTES_IA.map((a) => [a, false])) as LecturaDelSitio["acceso"];
    const lista = hallazgos({ acceso: bloqueados, caracteresSinJs: 10, schema: [], tieneLlmsTxt: false });
    for (const h of lista) {
      expect(h.donde.length, h.quePasa).toBeGreaterThan(0);
      expect(h.queHacer.length, h.quePasa).toBeGreaterThan(0);
    }
  });
});

/**
 * P3. «No medido» en el eje de ACCESO. El render ya decía «no medido» cuando
 * fallaba; el acceso no: un agente cuyo pedido no volvió (`null`) se leía como
 * «entra», y un robots que dio timeout como «permite a todos». Con los cinco
 * pedidos caídos —un WAF que corta a los bots se ve así— y el robots sin leer,
 * la ruta devolvía cero hallazgos y `esLegiblePorIA` daba `true`.
 */
describe("P3: en el eje de acceso, lo que no se midió no es un verde", () => {
  const SIN_RESPUESTA = Object.fromEntries(AGENTES_IA.map((a) => [a, null])) as NonNullable<
    LecturaDelSitio["statusPorAgente"]
  >;
  const ROBOTS_SIN_LEER = Object.fromEntries(AGENTES_IA.map((a) => [a, null])) as LecturaDelSitio["acceso"];

  it("los cinco agentes sin respuesta: un hallazgo «no medido» que los nombra, y la respuesta es «no se sabe»", () => {
    const lista = hallazgos({ ...SANO, statusPorAgente: SIN_RESPUESTA });
    expect(lista.map((h) => h.gravedad)).toEqual(["no-medido"]);
    for (const a of AGENTES_IA) expect(lista[0].quePasa).toContain(a);
    expect(esLegiblePorIA(lista)).toBeNull();
  });

  it("UN agente sin respuesta alcanza: no es «entra», y nombra sólo a ése", () => {
    const lista = hallazgos({ ...SANO, statusPorAgente: { ...TODOS_200, perplexitybot: null } });
    expect(lista.map((h) => h.gravedad)).toEqual(["no-medido"]);
    expect(lista[0].quePasa).toContain("perplexitybot");
    expect(lista[0].quePasa).not.toContain("gptbot");
    expect(esLegiblePorIA(lista)).toBeNull();
  });

  it("una lectura VIEJA, sin los pedidos por agente, es «no medido» igual que el render", () => {
    const vieja: LecturaDelSitio = { ...SANO };
    delete vieja.statusPorAgente;
    const lista = hallazgos(vieja);
    expect(lista.map((h) => h.gravedad)).toEqual(["no-medido"]);
    expect(esLegiblePorIA(lista)).toBeNull();
  });

  it("un robots que no se pudo leer (timeout, 5xx) es «no medido», con el motivo, y cita la RFC 9309", () => {
    const lista = hallazgos({ ...SANO, acceso: ROBOTS_SIN_LEER, robotsNoMedido: "http 503" });
    expect(lista.map((h) => h.gravedad)).toEqual(["no-medido"]);
    expect(lista[0].quePasa).toContain("http 503");
    expect(lista[0].queHacer).toMatch(/RFC 9309/);
    expect(esLegiblePorIA(lista)).toBeNull();
  });

  it("el reproducido: robots sin leer Y los cinco sin respuesta — nunca cero hallazgos", () => {
    const lista = hallazgos({ ...SANO, acceso: ROBOTS_SIN_LEER, robotsNoMedido: "timeout", statusPorAgente: SIN_RESPUESTA });
    expect(lista.length).toBe(2);
    expect(lista.every((h) => h.gravedad === "no-medido")).toBe(true);
    expect(esLegiblePorIA(lista)).toBeNull();
  });

  it("un 403 manda aunque el robots no se haya leído: eso sí se sabe, y es bloqueante", () => {
    const lista = hallazgos({ ...SANO, acceso: ROBOTS_SIN_LEER, statusPorAgente: { ...TODOS_200, gptbot: 403 } });
    const bloqueante = lista.find((h) => h.gravedad === "bloqueante");
    expect(bloqueante?.quePasa).toMatch(/Bloqueados: gptbot/);
    // Y el no medido del robots no lo vuelve a nombrar: ya está bloqueado.
    const noMedido = lista.find((h) => h.gravedad === "no-medido");
    expect(noMedido?.quePasa).not.toContain("gptbot");
    expect(esLegiblePorIA(lista)).toBe(false);
  });

  it("un agente bloqueado por el robots no pide además un «no medido» por su pedido caído", () => {
    const lista = hallazgos({
      ...SANO,
      acceso: { ...TODOS_ENTRAN, claudebot: false },
      statusPorAgente: { ...TODOS_200, claudebot: null },
    });
    expect(lista.map((h) => h.gravedad)).toEqual(["bloqueante"]);
  });
});

/**
 * QUÉ IMPIDE ESTE BLOQUE
 *
 * Que el punto «contenido sin JavaScript» se conteste con un solo número. La
 * puerta H2-GO-1 compara el HTML servido con el DOM renderizado, y cada caso de
 * abajo es una página que con uno solo de los dos números sale del color
 * equivocado. La regla, en `contenidoSinJs`: verde sólo si lo servido llega al
 * mínimo Y a la mitad de lo renderizado; rojo si falla cualquiera; no medido si
 * el renderizado no está y lo servido no alcanza a decidir.
 */
describe("el punto «contenido sin JavaScript»: servido contra renderizado", () => {
  const con = (servido: number, renderizado: LecturaDelSitio["caracteresRenderizados"]) =>
    contenidoSinJs({ ...SANO, caracteresSinJs: servido, caracteresRenderizados: renderizado });

  it("la página de control —servido casi cero, renderizado lleno— es ROJO, y dice los dos números", () => {
    const punto = con(40, { estado: "medido", caracteres: 1_680 });
    expect(punto.estado).toBe("rojo");
    expect(punto.hallazgo?.gravedad).toBe("bloqueante");
    expect(punto.hallazgo?.donde).toMatch(/renderizado/);
    expect(punto.hallazgo?.quePasa).toContain("40");
    expect(punto.hallazgo?.quePasa).toContain("1680");
  });

  it("una página SSR —servido ≈ renderizado— NO es rojo", () => {
    // El <title> cuenta servido y no renderizado, así que servido suele ser
    // un poco MÁS. Y al revés, un banner de cookies dibujado en el cliente
    // suma un poco a lo renderizado. Ninguno de los dos es depender de JS.
    expect(con(4_050, { estado: "medido", caracteres: 4_000 }).estado).toBe("verde");
    expect(con(4_000, { estado: "medido", caracteres: 4_600 }).estado).toBe("verde");
    expect(hallazgos({ ...SANO, caracteresSinJs: 4_050 })).toEqual([]);
  });

  it("servir el menú y dibujar el contenido es ROJO aunque lo servido pase el mínimo", () => {
    // Éste es el caso que sólo el umbral absoluto deja en verde: 1 500
    // caracteres servidos son más que 500, y el rastreador lee el menú.
    const punto = con(1_500, { estado: "medido", caracteres: 5_500 });
    expect(1_500).toBeGreaterThan(MINIMO_DE_TEXTO);
    expect(punto.estado).toBe("rojo");
    expect(punto.hallazgo?.donde).toMatch(/renderizado/);
  });

  it("el borde es la MITAD exacta: la mitad es verde, un carácter menos es rojo", () => {
    expect(FRACCION_MINIMA_SERVIDA).toBe(0.5);
    expect(con(1_000, { estado: "medido", caracteres: 2_000 }).estado).toBe("verde");
    expect(con(999, { estado: "medido", caracteres: 2_000 }).estado).toBe("rojo");
  });

  it("por debajo del mínimo y renderizada por encima es JavaScript, aunque sea más de la mitad", () => {
    const punto = con(400, { estado: "medido", caracteres: 700 });
    expect(punto.estado).toBe("rojo");
    expect(punto.hallazgo?.donde).toMatch(/renderizado/);
  });

  it("poco texto en los DOS lados es rojo, pero se arregla en el contenido, no en el renderizado", () => {
    // Mandar a «renderizar en el servidor» a una página que no depende de JS
    // es mandar a la persona equivocada.
    const punto = con(300, { estado: "medido", caracteres: 320 });
    expect(punto.estado).toBe("rojo");
    expect(punto.hallazgo?.donde).toMatch(/contenido/);
    expect(punto.hallazgo?.queHacer).toMatch(/No es un problema de JavaScript/);
  });

  it("un render que FALLÓ es «no medido» con su código, nunca verde", () => {
    const punto = con(4_000, { estado: "fallo", codigo: "timeout" });
    expect(punto.estado).toBe("no-medido");
    expect(punto.renderizado, "un fallo no es un cero").toBeNull();
    expect(punto.hallazgo?.gravedad).toBe("no-medido");
    expect(punto.hallazgo?.quePasa).toContain("timeout");
    const lista = hallazgos({ ...SANO, caracteresRenderizados: { estado: "fallo", codigo: "sin-navegador" } });
    expect(lista).not.toEqual([]);
    expect(esLegiblePorIA(lista), "sin el número, la respuesta es «no se sabe»").toBeNull();
  });

  it("una lectura VIEJA, sin el campo, es «no medido» igual que un fallo", () => {
    const vieja: LecturaDelSitio = { ...SANO };
    delete vieja.caracteresRenderizados;
    const punto = contenidoSinJs(vieja);
    expect(punto.estado).toBe("no-medido");
    expect(punto.hallazgo?.quePasa).toMatch(/no se pudo medir/);
  });

  it("si lo servido ya no llega al mínimo, es rojo aunque el render haya fallado", () => {
    // Esa mitad del veredicto no necesita al navegador: un rastreador ve
    // menos de 500 caracteres, se dibujen o no después.
    const punto = con(40, { estado: "fallo", codigo: "http_403" });
    expect(punto.estado).toBe("rojo");
    expect(punto.hallazgo?.quePasa).toContain("http_403");
  });

  // P5: los bordes, en las tres ramas. Sin estos casos sobrevivían a la suite
  // entera `servido < 301` en la rama de poco texto (con(450,450) pasaba a
  // verde), 499 en la de no medido y `>` en vez de `>=` en la de JavaScript.
  it("borde de la rama de poco texto: 499 y 499 es ROJO de contenido; 500 y 500, verde", () => {
    expect(con(450, { estado: "medido", caracteres: 450 }).estado).toBe("rojo");
    const justo = con(499, { estado: "medido", caracteres: 499 });
    expect(justo.estado).toBe("rojo");
    expect(justo.hallazgo?.donde).toMatch(/contenido/);
    expect(con(500, { estado: "medido", caracteres: 500 }).estado).toBe("verde");
  });

  it("borde de la rama no medida: 499 con el render caído es ROJO; 500, «no medido»", () => {
    expect(con(499, { estado: "fallo", codigo: "timeout" }).estado).toBe("rojo");
    expect(con(500, { estado: "fallo", codigo: "timeout" }).estado).toBe("no-medido");
  });

  it("borde de la rama de JavaScript: servido bajo el mínimo y renderizado JUSTO en el mínimo es JavaScript", () => {
    const punto = con(400, { estado: "medido", caracteres: 500 });
    expect(punto.estado).toBe("rojo");
    expect(punto.hallazgo?.donde).toMatch(/renderizado/);
    // Un carácter menos renderizado y ya no alcanza el mínimo: es contenido.
    expect(con(400, { estado: "medido", caracteres: 499 }).hallazgo?.donde).toMatch(/contenido/);
  });

  it("con `servidos` medido en el mismo documento, manda ése, no el del pedido aparte de la ruta", () => {
    // El render midió 1 669 servidos y 4 841 en el DOM (el mega-menú oculto
    // cuenta de los dos lados, P4, Chrome 154); la ruta, con otro
    // user-agent, trajo otro HTML. Decide el del mismo documento.
    const mismo = con(4_000, { estado: "medido", caracteres: 4_841, servidos: 1_669 });
    expect(mismo.estado).toBe("rojo");
    expect(mismo.servido).toBe(1_669);
    expect(mismo.servidoEnHtml).toBe(4_000);
    expect(mismo.hallazgo?.quePasa).toMatch(/el HTML trae 1669 caracteres/);
    // Y al revés no regala nada: el del documento bajo, el de la ruta alto, sigue rojo.
    expect(con(4_000, { estado: "medido", caracteres: 4_000, servidos: 100 }).estado).toBe("rojo");
    // Una lectura vieja, sin `servidos`, decide con el HTML de la ruta como antes.
    expect(con(1_671, { estado: "medido", caracteres: 3_189 }).estado).toBe("verde");
  });

  it("un renderizado medido en CERO es un dato, no un fallo", () => {
    // Una página que no dibuja nada existe. Lo prohibido es inventar el cero
    // cuando no se midió, no informarlo cuando sí.
    expect(con(0, { estado: "medido", caracteres: 0 }).renderizado).toBe(0);
  });
});

/**
 * GATE-7: ni la respuesta ni la pantalla traían el color de cada punto, y
 * «rojo 3 de 3» había que sacarlo de la prosa. Acá cada regla, con sus bordes.
 */
describe("GATE-7: los tres puntos de la puerta, cada uno con su estado", () => {
  const CON_VALIDADOR: LecturaDelSitio = { ...SANO, erroresDeSchema: [] };

  it("un sitio sano: verde en los tres", () => {
    expect(puntosDeLaPuerta(CON_VALIDADOR)).toEqual({ acceso: "verde", contenidoSinJs: "verde", schema: "verde" });
  });

  it("ACCESO: rojo por el robots, rojo por el HTTP con el robots abierto, y no medido sin respuesta", () => {
    expect(puntosDeLaPuerta({ ...CON_VALIDADOR, acceso: { ...TODOS_ENTRAN, gptbot: false } }).acceso).toBe("rojo");
    expect(puntosDeLaPuerta({ ...CON_VALIDADOR, statusPorAgente: { ...TODOS_200, ccbot: 403 } }).acceso).toBe("rojo");
    expect(puntosDeLaPuerta({ ...CON_VALIDADOR, statusPorAgente: { ...TODOS_200, ccbot: null } }).acceso).toBe("no-medido");
    expect(puntosDeLaPuerta({ ...CON_VALIDADOR, acceso: { ...TODOS_ENTRAN, ccbot: null } }).acceso).toBe("no-medido");
    const vieja: LecturaDelSitio = { ...CON_VALIDADOR };
    delete vieja.statusPorAgente;
    expect(puntosDeLaPuerta(vieja).acceso, "sin la petición por agente no se sabe").toBe("no-medido");
    // Un bloqueado es rojo aunque otro no se haya medido.
    expect(
      puntosDeLaPuerta({ ...CON_VALIDADOR, acceso: { ...TODOS_ENTRAN, gptbot: false }, statusPorAgente: { ...TODOS_200, ccbot: null } })
        .acceso
    ).toBe("rojo");
  });

  it("CONTENIDO: el mismo estado que `contenidoSinJs`", () => {
    const js: LecturaDelSitio = { ...CON_VALIDADOR, caracteresSinJs: 40, caracteresRenderizados: { estado: "medido", caracteres: 1_677 } };
    expect(puntosDeLaPuerta(js).contenidoSinJs).toBe("rojo");
    const caido: LecturaDelSitio = { ...CON_VALIDADOR, caracteresRenderizados: { estado: "fallo", codigo: "subrecurso-timeout" } };
    expect(puntosDeLaPuerta(caido).contenidoSinJs).toBe("no-medido");
  });

  it("SCHEMA: rojo con errores o sin ningún tipo; no medido sin el validador; verde aunque falte un tipo que rinde", () => {
    expect(puntosDeLaPuerta({ ...CON_VALIDADOR, erroresDeSchema: ["bloque 1: sin @context"] }).schema).toBe("rojo");
    expect(puntosDeLaPuerta({ ...CON_VALIDADOR, schema: [] }).schema).toBe("rojo");
    const sinValidador: LecturaDelSitio = { ...SANO };
    delete sinValidador.erroresDeSchema;
    expect(puntosDeLaPuerta(sinValidador).schema).toBe("no-medido");
    const incompleto = { ...CON_VALIDADOR, schema: ["Organization"] };
    expect(puntosDeLaPuerta(incompleto).schema).toBe("verde");
    expect(hallazgos(incompleto).map((h) => h.gravedad)).toEqual(["importante"]);
  });
});

/**
 * PU-1: el verde falso del acceso. Un agente con un código que no fuera 401,
 * 403, 429 ni 451 —un 503 de Wordfence, un 404, un 406, un 500— con la
 * portada en 200 salía VERDE, `legible` y sin ningún bloqueante: reproducido
 * por la ruta con la página sana y GPTBot en 503 (`control.test.ts`). La
 * comparación es contra la LÍNEA DE BASE: la portada, misma URL, con el
 * user-agent de la auditoría.
 */
describe("PU-1: un agente que no termina en 2xx con la portada en 2xx está rechazado, sea cual sea el código", () => {
  const MEDIDO: LecturaDelSitio = { ...SANO, erroresDeSchema: [], statusPortada: 200 };
  const SIN_BASE: LecturaDelSitio = { ...SANO, erroresDeSchema: [] };

  it.each([503, 404, 406, 500, 302, 418])("GPTBot recibe %i y la portada 200: acceso ROJO, bloqueante y no legible", (codigo) => {
    const lectura = { ...MEDIDO, statusPorAgente: { ...TODOS_200, gptbot: codigo } };
    expect(puntosDeLaPuerta(lectura).acceso).toBe("rojo");
    const lista = hallazgos(lectura);
    const bloqueante = lista.find((h) => h.gravedad === "bloqueante" && /CDN|WAF/.test(h.donde));
    expect(bloqueante?.quePasa).toContain(`les contesta ${codigo}`);
    expect(bloqueante?.quePasa).toContain("le contesta 200");
    expect(esLegiblePorIA(lista)).toBe(false);
  });

  it("cualquier 2xx entra: un 204 o un 206 con la portada en 200 no es un rechazo", () => {
    const lectura = { ...MEDIDO, statusPorAgente: { ...TODOS_200, gptbot: 204, ccbot: 206 } };
    expect(puntosDeLaPuerta(lectura)).toEqual({ acceso: "verde", contenidoSinJs: "verde", schema: "verde" });
    expect(hallazgos(lectura)).toEqual([]);
  });

  it("sin línea de base, un 503 no se puede leer: NO MEDIDO, nunca verde", () => {
    const lectura = { ...SIN_BASE, statusPorAgente: { ...TODOS_200, gptbot: 503 } };
    expect(puntosDeLaPuerta(lectura).acceso).toBe("no-medido");
    const lista = hallazgos(lectura);
    expect(lista.map((h) => h.gravedad)).toEqual(["no-medido"]);
    expect(lista[0].quePasa).toMatch(/gptbot le contestó 503.*no hay una portada en 2xx/);
    expect(esLegiblePorIA(lista)).toBeNull();
  });

  it("con la portada fuera de 2xx tampoco: un sitio caído para todos no es uno que bloquea", () => {
    const lectura = { ...MEDIDO, statusPortada: 503, statusPorAgente: { ...TODOS_200, gptbot: 503 } };
    expect(puntosDeLaPuerta(lectura).acceso).toBe("no-medido");
  });

  it("los cuatro códigos de «vos no» siguen siendo rechazo aunque no haya línea de base", () => {
    for (const codigo of [401, 403, 429, 451]) {
      expect(puntosDeLaPuerta({ ...SIN_BASE, statusPorAgente: { ...TODOS_200, claudebot: codigo } }).acceso, String(codigo)).toBe("rojo");
    }
  });
});
