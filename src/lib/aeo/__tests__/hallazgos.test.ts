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

  it("un renderizado medido en CERO es un dato, no un fallo", () => {
    // Una página que no dibuja nada existe. Lo prohibido es inventar el cero
    // cuando no se midió, no informarlo cuando sí.
    expect(con(0, { estado: "medido", caracteres: 0 }).renderizado).toBe(0);
  });
});
