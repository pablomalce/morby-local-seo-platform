/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la cuenta de la puerta H2-GO-3 dé otro número que el que la puerta
 * define: la grilla declarada con su tope y sin puntos fuera del mapa; cada
 * observación en la coordenada de su celda; el denominador de cinco números,
 * contado por celda declarada; la distancia entre matrices con «no aparece» =
 * el valor declarado y las celdas fallidas FUERA; la distancia `insuficiente`
 * con menos de N/2 celdas; y verde sólo si d(A,A') < d(A,B)/3 y d(A,B) > 0, con
 * TRES corridas distintas de la misma aprobación, la grilla de la puerta (3x3) y
 * el desplazamiento de la puerta (8 km).
 *
 * Las matrices de los casos están escritas a mano y su distancia calculada a
 * mano en el comentario de cada caso: el oráculo es la definición de la puerta,
 * no `grilla.ts`. Las COORDENADAS de las observaciones salen de
 * `planificarGrilla` —son la fixture, no el oráculo—, y lo que dice si una
 * coordenada es la de su celda se mide aparte, con un punto corrido 10 m y con
 * el centro repetido nueve veces.
 */
import { describe, expect, it } from "vitest";
import {
  DESPLAZAMIENTO_DE_LA_PUERTA_M,
  PUNTOS_DE_LA_PUERTA,
  TOPE_DE_CORRIDAS_POR_APROBACION,
  TOPE_DE_PUNTOS,
  denominador,
  desplazar,
  distanciaEntreCentros,
  distanciaEntreCorridas,
  planificarGrilla,
  ubicarObservaciones,
  veredicto,
  type Coordenada,
  type CorridaDeLaPrueba,
  type Observacion,
} from "../grilla";

const C = { lat: 59.3293, lng: 18.0686 };
const B_CENTRO = desplazar(C, 0, 8000);

/** El punto que el plan le da a cada celda de la grilla de 3x3 (o de `lado`) con ese centro. */
function puntosDelPlan(centro: Coordenada, lado = 3, paso = 1500) {
  const plan = planificarGrilla({ centro, radioM: 1000, pasoM: paso, lado });
  if (!plan.ok) throw new Error("el plan se negó");
  return new Map(plan.puntos.map((p) => [`${p.fila},${p.columna}`, p]));
}

/**
 * Una matriz escrita como texto: un número es posición, `-` no aparece, `x`
 * falló, `.` sin observación. Cada observación, en la coordenada de su celda.
 */
function matriz(filas: string[], centro: Coordenada = C): Observacion[] {
  const plan = puntosDelPlan(centro, filas.length);
  const obs: Observacion[] = [];
  filas.forEach((fila, f) =>
    fila
      .trim()
      .split(/\s+/)
      .forEach((celda, c) => {
        if (celda === ".") return;
        const punto = plan.get(`${f},${c}`) as Coordenada;
        const base = { fila: f, columna: c, lat: punto.lat, lng: punto.lng, observadaEn: "2026-10-08T10:00:00.000Z" };
        if (celda === "-") obs.push({ ...base, resultado: "absent", posicion: null, codigoDeError: null });
        else if (celda === "x") obs.push({ ...base, resultado: "failed", posicion: null, codigoDeError: "http_429" });
        else obs.push({ ...base, resultado: "position", posicion: Number(celda), codigoDeError: null });
      })
  );
  return obs;
}

const corrida = (obs: Observacion[], valorNoAparece = 21, centro: Coordenada = C) => ({
  centro,
  radioM: 1000,
  pasoM: 1500,
  puntos: 9,
  valorNoAparece,
  observaciones: obs,
});

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

  it("UN punto fuera del mapa y no sale ninguno: a 89,9° con 50 km de paso, la fila norte pasa de 90°", () => {
    // El caso que midió la revisión del 2026-10-09: la ruta mandaba los nueve
    // pedidos y la base rechazaba el lote entero de observaciones.
    const r = planificarGrilla({ centro: { lat: 89.9, lng: 18 }, radioM: 1000, pasoM: 50_000, lado: 3 });
    expect(r).toMatchObject({ ok: false, motivo: "punto-fuera-del-mapa", fila: 0, columna: 0 });
    expect(r.ok === false && r.motivo === "punto-fuera-del-mapa" && r.lat).toBeGreaterThan(90);
    // Y lo mismo al sur.
    expect(planificarGrilla({ centro: { lat: -89.9, lng: 18 }, radioM: 1000, pasoM: 50_000, lado: 3 })).toMatchObject({
      ok: false,
      motivo: "punto-fuera-del-mapa",
      fila: 2,
    });
    // El control: con 5 km de paso, a 89,9° todavía entra (la fila norte queda en 89,945°).
    expect(planificarGrilla({ centro: { lat: 89.9, lng: 18 }, radioM: 1000, pasoM: 5_000, lado: 3 })).toMatchObject({
      ok: true,
    });
  });
});

describe("desplazar y distanciaEntreCentros: el desplazamiento declarado se puede medir", () => {
  it("8 km al este de Estocolmo están a 8000 m (±1 m), y al norte también", () => {
    expect(distanciaEntreCentros(C, desplazar(C, 0, 8000))).toBeCloseTo(8000, 0);
    expect(distanciaEntreCentros(C, desplazar(C, 8000, 0))).toBeCloseTo(8000, 0);
    expect(distanciaEntreCentros(C, C)).toBe(0);
  });
});

describe("ubicarObservaciones: cada observación, en la coordenada de su celda", () => {
  it("las nueve de `matriz` están en su celda: ninguna fuera", () => {
    const u = ubicarObservaciones(corrida(matriz(["1 2 3", "4 5 6", "7 8 9"])));
    expect(u.porCelda.size).toBe(9);
    expect(u.fueraDeLaGrilla).toBe(0);
  });

  it("LA GRILLA DECORATIVA: nueve observaciones en el centro son UNA de su celda y ocho fuera", () => {
    // Lo que escribía el mutante de la ruta que consultaba el centro en los
    // nueve puntos: nueve celdas, la misma coordenada.
    const centro = matriz(["1 1 1", "1 1 1", "1 1 1"]).map((o) => ({ ...o, lat: C.lat, lng: C.lng }));
    const u = ubicarObservaciones(corrida(centro));
    expect(u.fueraDeLaGrilla).toBe(8);
    expect([...u.porCelda.keys()]).toEqual(["1,1"]);
  });

  it("un punto corrido 10 m de su celda queda fuera; uno corrido medio metro, no", () => {
    const obs = matriz(["1 1 1", "1 1 1", "1 1 1"]);
    const diez = desplazar(obs[0], 10, 0);
    const medio = desplazar(obs[1], 0.5, 0);
    const movidas = [{ ...obs[0], ...diez }, { ...obs[1], ...medio }, ...obs.slice(2)];
    const u = ubicarObservaciones(corrida(movidas));
    expect(u.fueraDeLaGrilla).toBe(1);
    expect(u.porCelda.has("0,0")).toBe(false);
    expect(u.porCelda.has("0,1")).toBe(true);
  });

  it("una celda fuera del lado, o repetida, queda fuera; si N no es un cuadrado, quedan todas fuera", () => {
    const obs = matriz(["1 1 1", "1 1 1", "1 1 1"]);
    const deMas = { ...obs[0], fila: 3 };
    const repetida = { ...obs[4] };
    expect(ubicarObservaciones(corrida([...obs, deMas, repetida])).fueraDeLaGrilla).toBe(2);
    expect(ubicarObservaciones({ ...corrida(obs), puntos: 8 }).fueraDeLaGrilla).toBe(9);
  });
});

describe("denominador: los cinco números, contados por celda declarada y por resultado", () => {
  it("N, devolvieron dato (aparece + no aparece), fallaron, sin observación y fuera de la grilla", () => {
    const obs = matriz(["1 - x", "4 x -", "7 8 ."]);
    expect(denominador(corrida(obs))).toEqual({
      puntos: 9,
      devolvieronDato: 6,
      aparece: 4,
      noAparece: 2,
      fallaron: 2,
      sinObservacion: 1,
      fueraDeLaGrilla: 0,
    });
  });

  it("UNA corrida de un punto con nueve observaciones no publica nueve datos: publica uno, y ocho fuera", () => {
    // El estado que la base aceptaba antes del 2026-10-09: `denominador(1, obs)`
    // daba devolvieronDato 9 sobre 1 punto.
    const nueve = matriz(["1 1 1", "1 1 1", "1 1 1"]).map((o) => ({ ...o, lat: C.lat, lng: C.lng }));
    const d = denominador({ centro: C, radioM: 1000, pasoM: 1500, puntos: 1, observaciones: nueve });
    expect(d).toEqual({
      puntos: 1,
      devolvieronDato: 1,
      aparece: 1,
      noAparece: 0,
      fallaron: 0,
      sinObservacion: 0,
      fueraDeLaGrilla: 8,
    });
  });

  it("LA GRILLA DECORATIVA: nueve observaciones en el centro son UN dato, ocho celdas sin observación y ocho fuera", () => {
    const centro = matriz(["1 1 1", "1 1 1", "1 1 1"]).map((o) => ({ ...o, lat: C.lat, lng: C.lng }));
    expect(denominador(corrida(centro))).toEqual({
      puntos: 9,
      devolvieronDato: 1,
      aparece: 1,
      noAparece: 0,
      fallaron: 0,
      sinObservacion: 8,
      fueraDeLaGrilla: 8,
    });
  });

  it("siempre: devolvieron + fallaron + sin observación = N", () => {
    for (const filas of [["1 - x", "4 x -", "7 8 ."], [". . .", ". . .", ". . ."], ["x x x", "x x x", "x x x"]]) {
      const d = denominador(corrida(matriz(filas)));
      expect(d.devolvieronDato + d.fallaron + d.sinObservacion).toBe(9);
    }
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
      fueraDeLaGrilla: 0,
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

  it("una observación fuera de su coordenada no es de su celda: la celda queda sin observación", () => {
    // La (0,0) de A está en el centro: no es la de la (0,0). |1 − 9| = 8 en esa
    // celda daría 8/9; sin ella, las ocho restantes son iguales → 0.
    const a = matriz(["1 1 1", "1 1 1", "1 1 1"]).map((o, i) => (i === 0 ? { ...o, lat: C.lat, lng: C.lng } : o));
    const b = matriz(["9 1 1", "1 1 1", "1 1 1"]);
    expect(distanciaEntreCorridas(corrida(a), corrida(b))).toEqual({
      estado: "numero",
      valor: 0,
      comparables: 8,
      excluidasPorFallo: 0,
      sinObservacion: 1,
      fueraDeLaGrilla: 1,
      puntos: 9,
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
      fueraDeLaGrilla: 0,
      puntos: 9,
      minimo: 5,
    });
  });

  it("dos grillas distintas —N, paso o radio—, o dos «no aparece» distintos, no se comparan", () => {
    const a = corrida(matriz(["1 1 1", "1 1 1", "1 1 1"]));
    expect(distanciaEntreCorridas(a, { ...a, puntos: 4 })).toEqual({ estado: "incomparable", motivo: "grilla-distinta" });
    expect(distanciaEntreCorridas(a, { ...a, pasoM: 2000 })).toEqual({ estado: "incomparable", motivo: "grilla-distinta" });
    expect(distanciaEntreCorridas(a, { ...a, radioM: 500 })).toEqual({ estado: "incomparable", motivo: "grilla-distinta" });
    expect(distanciaEntreCorridas(a, { ...a, valorNoAparece: 30 })).toEqual({
      estado: "incomparable",
      motivo: "valor-no-aparece-distinto",
    });
  });
});

describe("veredicto: verde sólo si d(A,A') < d(A,B)/3 y d(A,B) > 0", () => {
  const INICIO: Record<string, string> = {
    A: "2026-10-08T10:00:00.000Z",
    A2: "2026-10-08T10:05:00.000Z",
    B: "2026-10-08T10:10:00.000Z",
  };
  /** Una corrida de la prueba con su matriz puesta en SU grilla: la del centro que lleve. */
  const prueba = (id: string, filas: string[], extra: Partial<CorridaDeLaPrueba> = {}): CorridaDeLaPrueba => {
    const centro = extra.centro ?? (id === "B" ? B_CENTRO : C);
    return {
      id,
      palabraClave: "fotvård",
      lugarObjetivo: "ChIJobjetivoDeLaGrilla01",
      centro,
      radioM: 1000,
      pasoM: 1500,
      puntos: 9,
      valorNoAparece: 21,
      desplazamientoDeclaradoM: 8000,
      empezoEn: INICIO[id] ?? "2026-10-08T10:15:00.000Z",
      aprobacion: "aprobacion-de-la-puerta",
      observaciones: matriz(filas, centro),
      ...extra,
    };
  };
  const A = ["3 2 4", "2 1 2", "4 2 3"];
  // d(A, A2) = (1 + 1) / 9
  const A2 = ["3 2 4", "2 2 2", "4 2 4"];
  // d(A, B) = (18+19+17 + 19+20+19 + 17+19+18) / 9 = 166 / 9
  const B = ["- - -", "- - -", "- - -"];

  it("las constantes de la puerta: 3x3, 8 km, 3 corridas por aprobación", () => {
    expect(PUNTOS_DE_LA_PUERTA).toBe(9);
    expect(DESPLAZAMIENTO_DE_LA_PUERTA_M).toBe(8000);
    expect(TOPE_DE_CORRIDAS_POR_APROBACION).toBe(3);
  });

  it("ruido chico y geografía grande: verde, con las dos distancias", () => {
    const v = veredicto(prueba("A", A), prueba("A2", A2), prueba("B", B));
    expect(v.motivos).toEqual([]);
    expect(v.verde).toBe(true);
    expect(v.ruido).toMatchObject({ estado: "numero", valor: 2 / 9 });
    expect(v.geografia).toMatchObject({ estado: "numero", valor: 166 / 9 });
    expect(v.desplazamientoMedidoM).toBeCloseTo(8000, 0);
  });

  it("en el borde: d(A,A') = d(A,B)/3 exacto NO es verde (la desigualdad es estricta)", () => {
    // d(A, A2) = 3/9 y d(A, B) = 9/9: 3 × 3/9 = 1 = d(A, B).
    const v = veredicto(
      prueba("A", ["1 1 1", "1 1 1", "1 1 1"]),
      prueba("A2", ["4 1 1", "1 1 1", "1 1 1"]),
      prueba("B", ["2 2 2", "2 2 2", "2 2 2"])
    );
    expect(v.verde).toBe(false);
    expect(v.motivos).toEqual(["geografia-no-supera-al-ruido"]);
  });

  it("el desplazado idéntico al original —el mapa no se movió— es rojo, y lo dice", () => {
    const v = veredicto(prueba("A", A), prueba("A2", A), prueba("B", A));
    expect(v.verde).toBe(false);
    expect(v.motivos).toContain("desplazado-identico");
  });

  it("LA REPETICIÓN ES OTRA CORRIDA: A' = A es rojo aunque las distancias den verde", () => {
    // La trampa que midieron dos revisiones el 2026-10-09: con `repeatId =
    // runId`, d(A,A') = 0 por construcción y la puerta quedaba en d(A,B) > 0.
    const a = prueba("A", A);
    const v = veredicto(a, a, prueba("B", B));
    expect(v.verde).toBe(false);
    expect(v.motivos).toContain("corridas-repetidas");
    expect(v.ruido).toMatchObject({ estado: "numero", valor: 0 });
    // Y B = A también.
    expect(veredicto(a, prueba("A2", A2), { ...a }).motivos).toContain("corridas-repetidas");
  });

  it("la repetición empieza DESPUÉS de la original: a la misma hora o antes, rojo", () => {
    const misma = veredicto(prueba("A", A), prueba("A2", A2, { empezoEn: INICIO.A }), prueba("B", B));
    expect(misma.motivos).toEqual(["repeticion-no-es-posterior"]);
    const antes = veredicto(prueba("A", A), prueba("A2", A2, { empezoEn: "2026-10-08T09:59:00.000Z" }), prueba("B", B));
    expect(antes.motivos).toEqual(["repeticion-no-es-posterior"]);
  });

  it("las tres, de la MISMA aprobación de gasto: una de otra, o sin aprobación, es rojo", () => {
    const otra = veredicto(prueba("A", A), prueba("A2", A2), prueba("B", B, { aprobacion: "otra-aprobacion" }));
    expect(otra.motivos).toEqual(["aprobacion-distinta"]);
    const sin = veredicto(prueba("A", A, { aprobacion: null }), prueba("A2", A2, { aprobacion: null }), prueba("B", B, { aprobacion: null }));
    expect(sin.motivos).toEqual(["aprobacion-distinta"]);
  });

  it("LA GRILLA DE LA PUERTA ES 3x3: tres corridas de un punto —un llamado cada una— son rojo", () => {
    // Medido el 2026-10-09 por HTTP: con gridSize 1, verde con una «distancia»
    // de una sola resta.
    const uno = (id: string, filas: string[]) => {
      const c = prueba(id, ["1 1 1", "1 1 1", "1 1 1"]);
      return { ...c, puntos: 1, observaciones: matriz(filas, c.centro) };
    };
    const v = veredicto(uno("A", ["1"]), uno("A2", ["1"]), uno("B", ["-"]));
    expect(v.motivos).toEqual(["grilla-no-es-la-de-la-puerta"]);
    expect(v.ruido).toMatchObject({ estado: "numero", comparables: 1 });
  });

  it("UNA OBSERVACIÓN FUERA DE SU COORDENADA es rojo: la grilla decorativa no cruza la puerta", () => {
    // B con sus nueve observaciones en el centro de B: el mapa «se mueve» igual
    // —B está a 8 km—, pero no es un mapa.
    const b = prueba("B", B);
    const decorativa = { ...b, observaciones: b.observaciones.map((o) => ({ ...o, lat: B_CENTRO.lat, lng: B_CENTRO.lng })) };
    const v = veredicto(prueba("A", A), prueba("A2", A2), decorativa);
    expect(v.verde).toBe(false);
    expect(v.motivos).toContain("observaciones-fuera-de-la-grilla");
  });

  it("un desplazamiento no declarado, distinto entre las tres, otro que el de la puerta, o mal medido, es rojo", () => {
    const sinDeclarar = veredicto(prueba("A", A), prueba("A2", A2), prueba("B", B, { desplazamientoDeclaradoM: null }));
    expect(sinDeclarar.motivos).toContain("desplazamiento-no-declarado");

    const distinto = veredicto(prueba("A", A), prueba("A2", A2, { desplazamientoDeclaradoM: 5000 }), prueba("B", B));
    expect(distinto.motivos).toContain("desplazamiento-distinto");

    // Las tres declaran 5 km y B está a 5 km: coherente, pero no es la puerta.
    const cinco = desplazar(C, 0, 5000);
    const otraPuerta = veredicto(
      prueba("A", A, { desplazamientoDeclaradoM: 5000 }),
      prueba("A2", A2, { desplazamientoDeclaradoM: 5000 }),
      prueba("B", B, { desplazamientoDeclaradoM: 5000, centro: cinco })
    );
    expect(otraPuerta.motivos).toEqual(["desplazamiento-no-es-el-de-la-puerta"]);

    // Declararon 8 km y B está a 5 km.
    const malMedido = veredicto(prueba("A", A), prueba("A2", A2), prueba("B", B, { centro: cinco }));
    expect(malMedido.verde).toBe(false);
    expect(malMedido.motivos).toEqual(["desplazamiento-medido-distinto"]);
  });

  it("una repetición con otro centro no es una repetición", () => {
    const v = veredicto(prueba("A", A), prueba("A2", A2, { centro: desplazar(C, 50, 0) }), prueba("B", B));
    expect(v.motivos).toEqual(["repeticion-con-otro-centro"]);
  });

  it("otra palabra, otro lugar, otra grilla u otra sesión no se comparan", () => {
    const B_ = prueba("B", B);
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
    const v = veredicto(prueba("A", A), prueba("A2", ["x x x", "x x 1", "1 1 1"]), prueba("B", B));
    expect(v.verde).toBe(false);
    expect(v.motivos).toEqual(["distancia-a-repeticion-no-es-numero"]);
  });
});
