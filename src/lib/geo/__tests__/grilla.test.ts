/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la cuenta de la puerta H2-GO-3 dé otro número que el que la puerta
 * define: la grilla declarada con su tope, el denominador de cuatro números, la
 * distancia entre matrices con «no aparece» = el valor declarado y las celdas
 * fallidas FUERA, la distancia `insuficiente` con menos de N/2 celdas, y verde
 * sólo si d(A,A') < d(A,B)/3 y d(A,B) > 0.
 *
 * Las matrices de los casos están escritas a mano y su distancia calculada a
 * mano en el comentario de cada caso: el oráculo es la definición de la puerta,
 * no `grilla.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  TOPE_DE_PUNTOS,
  denominador,
  desplazar,
  distanciaEntreCentros,
  distanciaEntreCorridas,
  planificarGrilla,
  veredicto,
  type CorridaDeLaPrueba,
  type Observacion,
} from "../grilla";

const C = { lat: 59.3293, lng: 18.0686 };

/** Una matriz 3x3 escrita como texto: un número es posición, `-` no aparece, `x` falló, `.` sin observación. */
function matriz(filas: string[]): Observacion[] {
  const obs: Observacion[] = [];
  filas.forEach((fila, f) =>
    fila
      .trim()
      .split(/\s+/)
      .forEach((celda, c) => {
        if (celda === ".") return;
        const base = { fila: f, columna: c, lat: 0, lng: 0, observadaEn: "2026-10-08T10:00:00.000Z" };
        if (celda === "-") obs.push({ ...base, resultado: "absent", posicion: null, codigoDeError: null });
        else if (celda === "x") obs.push({ ...base, resultado: "failed", posicion: null, codigoDeError: "http_429" });
        else obs.push({ ...base, resultado: "position", posicion: Number(celda), codigoDeError: null });
      })
  );
  return obs;
}

const corrida = (obs: Observacion[], valorNoAparece = 21) => ({ puntos: 9, valorNoAparece, observaciones: obs });

describe("planificarGrilla: la grilla declarada, con su tope", () => {
  it("3x3: nueve puntos, el del medio es el centro, la fila 0 al norte y la columna 0 al oeste", () => {
    const plan = planificarGrilla({ centro: C, radioM: 1000, pasoM: 1500, lado: 3 });
    if (!plan.ok) throw new Error("se negó");
    expect(plan.puntos).toHaveLength(9);
    expect(plan.puntos.map((p) => `${p.fila},${p.columna}`)).toEqual([
      "0,0", "0,1", "0,2", "1,0", "1,1", "1,2", "2,0", "2,1", "2,2",
    ]);
    const medio = plan.puntos[4];
    expect(medio.lat).toBeCloseTo(C.lat, 10);
    expect(medio.lng).toBeCloseTo(C.lng, 10);
    expect(plan.puntos[0].lat).toBeGreaterThan(C.lat);
    expect(plan.puntos[0].lng).toBeLessThan(C.lng);
    expect(plan.puntos[8].lat).toBeLessThan(C.lat);
    expect(plan.puntos[8].lng).toBeGreaterThan(C.lng);
  });

  it("los vecinos están a un paso, y las esquinas a paso × √2 del centro", () => {
    const plan = planificarGrilla({ centro: C, radioM: 1000, pasoM: 1500, lado: 3 });
    if (!plan.ok) throw new Error("se negó");
    expect(distanciaEntreCentros(plan.puntos[4], plan.puntos[5])).toBeCloseTo(1500, 0);
    expect(distanciaEntreCentros(plan.puntos[4], plan.puntos[1])).toBeCloseTo(1500, 0);
    expect(distanciaEntreCentros(plan.puntos[4], plan.puntos[0])).toBeCloseTo(1500 * Math.SQRT2, -1);
  });

  it("EL TOPE: un lado de 4 (16 puntos) se niega, con cuántos pidió y cuál es el tope", () => {
    expect(TOPE_DE_PUNTOS).toBe(9);
    expect(planificarGrilla({ centro: C, radioM: 1000, pasoM: 1500, lado: 4 })).toEqual({
      ok: false,
      motivo: "tope-de-puntos",
      pedidos: 16,
      tope: 9,
    });
  });

  it("lado 1 y 2 entran; lado 0 o fraccionario no", () => {
    expect(planificarGrilla({ centro: C, radioM: 1000, pasoM: 1500, lado: 1 })).toMatchObject({ ok: true });
    const dos = planificarGrilla({ centro: C, radioM: 1000, pasoM: 1500, lado: 2 });
    expect(dos.ok && dos.puntos.length).toBe(4);
    expect(planificarGrilla({ centro: C, radioM: 1000, pasoM: 1500, lado: 0 })).toEqual({ ok: false, motivo: "lado-invalido" });
    expect(planificarGrilla({ centro: C, radioM: 1000, pasoM: 1500, lado: 2.5 })).toEqual({ ok: false, motivo: "lado-invalido" });
  });
});

describe("desplazar y distanciaEntreCentros: el desplazamiento declarado se puede medir", () => {
  it("8 km al este de Estocolmo están a 8000 m (±1 m), y al norte también", () => {
    expect(distanciaEntreCentros(C, desplazar(C, 0, 8000))).toBeCloseTo(8000, 0);
    expect(distanciaEntreCentros(C, desplazar(C, 8000, 0))).toBeCloseTo(8000, 0);
    expect(distanciaEntreCentros(C, C)).toBe(0);
  });
});

describe("denominador: los cuatro números, contados por resultado", () => {
  it("N, devolvieron dato (aparece + no aparece), fallaron y sin observación", () => {
    const obs = matriz(["1 - x", "4 x -", "7 8 ."]);
    expect(denominador(9, obs)).toEqual({
      puntos: 9,
      devolvieronDato: 6,
      aparece: 4,
      noAparece: 2,
      fallaron: 2,
      sinObservacion: 1,
    });
  });
});

describe("distanciaEntreCorridas: media de |posición| celda a celda", () => {
  it("dos matrices iguales están a 0", () => {
    const a = matriz(["1 2 3", "4 5 6", "7 8 9"]);
    expect(distanciaEntreCorridas(corrida(a), corrida(a))).toMatchObject({ estado: "numero", valor: 0, comparables: 9 });
  });

  it("«no aparece» vale el valor declarado: |3 − 21| = 18 en una celda de nueve → 2", () => {
    const a = matriz(["3 1 1", "1 1 1", "1 1 1"]);
    const b = matriz(["- 1 1", "1 1 1", "1 1 1"]);
    expect(distanciaEntreCorridas(corrida(a), corrida(b))).toMatchObject({ estado: "numero", valor: 2, comparables: 9 });
    // Con el valor declarado en 30, la misma celda pesa |3 − 30| = 27 → 3.
    expect(distanciaEntreCorridas(corrida(a, 30), corrida(b, 30))).toMatchObject({ estado: "numero", valor: 3 });
  });

  it("una celda que FALLÓ en cualquiera de las dos se excluye y se cuenta aparte", () => {
    // Comparables: las ocho que no son la (0,0). Diferencias: 0 en siete, |2 − 5| = 3 en la (2,2) → 3/8.
    const a = matriz(["x 1 1", "1 1 1", "1 1 2"]);
    const b = matriz(["1 1 1", "1 1 1", "1 1 5"]);
    expect(distanciaEntreCorridas(corrida(a), corrida(b))).toEqual({
      estado: "numero",
      valor: 3 / 8,
      comparables: 8,
      excluidasPorFallo: 1,
      sinObservacion: 0,
      puntos: 9,
    });
  });

  it("una celda sin observación tampoco entra, y se cuenta como tal", () => {
    const a = matriz([". 1 1", "1 1 1", "1 1 1"]);
    const b = matriz(["1 1 1", "1 1 1", "1 1 1"]);
    expect(distanciaEntreCorridas(corrida(a), corrida(b))).toMatchObject({
      estado: "numero",
      comparables: 8,
      excluidasPorFallo: 0,
      sinObservacion: 1,
    });
  });

  it("con menos de N/2 celdas comparables es insuficiente: 4 de 9 no alcanza, 5 de 9 sí", () => {
    const cinco = matriz(["x x x", "x 1 1", "1 1 1"]);
    const cuatro = matriz(["x x x", "x x 1", "1 1 1"]);
    const llena = corrida(matriz(["1 1 1", "1 1 1", "1 1 1"]));
    expect(distanciaEntreCorridas(corrida(cinco), llena)).toMatchObject({ estado: "numero", comparables: 5 });
    expect(distanciaEntreCorridas(corrida(cuatro), llena)).toEqual({
      estado: "insuficiente",
      comparables: 4,
      excluidasPorFallo: 5,
      sinObservacion: 0,
      puntos: 9,
      minimo: 5,
    });
  });

  it("dos grillas distintas, o dos «no aparece» distintos, no se comparan", () => {
    const a = corrida(matriz(["1 1 1", "1 1 1", "1 1 1"]));
    expect(distanciaEntreCorridas(a, { ...a, puntos: 4 })).toEqual({ estado: "incomparable", motivo: "grilla-distinta" });
    expect(distanciaEntreCorridas(a, { ...a, valorNoAparece: 30 })).toEqual({
      estado: "incomparable",
      motivo: "valor-no-aparece-distinto",
    });
  });
});

describe("veredicto: verde sólo si d(A,A') < d(A,B)/3 y d(A,B) > 0", () => {
  const B_CENTRO = desplazar(C, 0, 8000);
  const prueba = (id: string, obs: Observacion[], extra: Partial<CorridaDeLaPrueba> = {}): CorridaDeLaPrueba => ({
    id,
    palabraClave: "fotvård",
    lugarObjetivo: "ChIJobjetivoDeLaGrilla01",
    centro: C,
    radioM: 1000,
    pasoM: 1500,
    puntos: 9,
    valorNoAparece: 21,
    desplazamientoDeclaradoM: 8000,
    empezoEn: "2026-10-08T10:00:00.000Z",
    observaciones: obs,
    ...extra,
  });
  const A = matriz(["3 2 4", "2 1 2", "4 2 3"]);
  // d(A, A2) = (1 + 1) / 9
  const A2 = matriz(["3 2 4", "2 2 2", "4 2 4"]);
  // d(A, B) = (18+19+17 + 19+20+19 + 17+19+18) / 9 = 166 / 9
  const B = matriz(["- - -", "- - -", "- - -"]);

  it("ruido chico y geografía grande: verde, con las dos distancias", () => {
    const v = veredicto(prueba("A", A), prueba("A2", A2), prueba("B", B, { centro: B_CENTRO }));
    expect(v.motivos).toEqual([]);
    expect(v.verde).toBe(true);
    expect(v.ruido).toMatchObject({ estado: "numero", valor: 2 / 9 });
    expect(v.geografia).toMatchObject({ estado: "numero", valor: 166 / 9 });
    expect(v.desplazamientoMedidoM).toBeCloseTo(8000, 0);
  });

  it("en el borde: d(A,A') = d(A,B)/3 exacto NO es verde (la desigualdad es estricta)", () => {
    // d(A, A2) = 3/9 y d(A, B) = 9/9: 3 × 3/9 = 1 = d(A, B).
    const a = matriz(["1 1 1", "1 1 1", "1 1 1"]);
    const a2 = matriz(["4 1 1", "1 1 1", "1 1 1"]);
    const b = matriz(["2 2 2", "2 2 2", "2 2 2"]);
    const v = veredicto(prueba("A", a), prueba("A2", a2), prueba("B", b, { centro: B_CENTRO }));
    expect(v.verde).toBe(false);
    expect(v.motivos).toEqual(["geografia-no-supera-al-ruido"]);
  });

  it("el desplazado idéntico al original —el mapa no se movió— es rojo, y lo dice", () => {
    const v = veredicto(prueba("A", A), prueba("A2", A), prueba("B", A, { centro: B_CENTRO }));
    expect(v.verde).toBe(false);
    expect(v.motivos).toContain("desplazado-identico");
  });

  it("un desplazamiento no declarado, distinto entre las tres, o mal medido, es rojo", () => {
    const sinDeclarar = veredicto(
      prueba("A", A),
      prueba("A2", A2),
      prueba("B", B, { centro: B_CENTRO, desplazamientoDeclaradoM: null })
    );
    expect(sinDeclarar.motivos).toContain("desplazamiento-no-declarado");

    const distinto = veredicto(
      prueba("A", A),
      prueba("A2", A2, { desplazamientoDeclaradoM: 5000 }),
      prueba("B", B, { centro: B_CENTRO })
    );
    expect(distinto.motivos).toContain("desplazamiento-distinto");

    // Declararon 8 km y B está a 5 km.
    const malMedido = veredicto(prueba("A", A), prueba("A2", A2), prueba("B", B, { centro: desplazar(C, 0, 5000) }));
    expect(malMedido.verde).toBe(false);
    expect(malMedido.motivos).toEqual(["desplazamiento-medido-distinto"]);
  });

  it("una repetición con otro centro no es una repetición", () => {
    const v = veredicto(prueba("A", A), prueba("A2", A2, { centro: desplazar(C, 50, 0) }), prueba("B", B, { centro: B_CENTRO }));
    expect(v.motivos).toEqual(["repeticion-con-otro-centro"]);
  });

  it("otra palabra, otro lugar, otra grilla u otra sesión no se comparan", () => {
    const B_ = prueba("B", B, { centro: B_CENTRO });
    expect(veredicto(prueba("A", A), prueba("A2", A2, { palabraClave: "otra" }), B_).motivos).toContain("palabra-distinta");
    expect(veredicto(prueba("A", A), prueba("A2", A2, { lugarObjetivo: "ChIJotroLugarDistinto" }), B_).motivos).toContain(
      "lugar-distinto"
    );
    expect(veredicto(prueba("A", A), prueba("A2", A2, { pasoM: 2000 }), B_).motivos).toContain("grilla-distinta");
    expect(
      veredicto(prueba("A", A), prueba("A2", A2, { empezoEn: "2026-10-08T14:00:00.000Z" }), B_).motivos
    ).toContain("fuera-de-la-misma-sesion");
  });

  it("si una distancia es insuficiente, el veredicto es rojo y lo nombra: no hay número que comparar", () => {
    const casiTodoFallo = matriz(["x x x", "x x 1", "1 1 1"]);
    const v = veredicto(prueba("A", A), prueba("A2", casiTodoFallo), prueba("B", B, { centro: B_CENTRO }));
    expect(v.verde).toBe(false);
    expect(v.motivos).toEqual(["distancia-a-repeticion-no-es-numero"]);
  });
});
