/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que una corrida de la grilla consulte de otra forma que una vez por punto con
 * la coordenada de ese punto, que dispare más consultas en vuelo de las que
 * declara, que pase el tope, o que un punto que no tuvo respuesta se anote como
 * «no aparece».
 *
 * EL DOBLE RECORRE LA SECUENCIA (R13). `googleGeografico` registra los pedidos
 * en orden, y los tests afirman en el PRIMER tramo —cuántas consultas salieron
 * antes de que ninguna volviera, cuál fue la primera coordenada— y no sólo
 * sobre la lista final. Y tiene geografía: ordena por distancia al centro del
 * sesgo. Con eso, la cadena entera que la puerta H2-GO-3 mide —corrida,
 * `posicionEnPunto`, distancia, veredicto— corre acá sin Google y sin gasto.
 *
 * LA RED CORTADA A MITAD DE CORRIDA es la prueba que la puerta exige para el
 * denominador de fallos: tiene que subir `fallaron`, no `no aparece`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { posicionEnPunto } from "@/lib/integrations/google/places";
import { correrGrilla } from "../corrida";
import {
  denominador,
  desplazar,
  distanciaEntreCorridas,
  planificarGrilla,
  veredicto,
  type CorridaDeLaPrueba,
  type Observacion,
  type PuntoDeGrilla,
} from "../grilla";
import { googleGeografico, lugaresAlrededor, vaciarCola } from "./googleGeografico";

const C = { lat: 59.3293, lng: 18.0686 };
const B_CENTRO = desplazar(C, 0, 8000);
/** 60 lugares en espiral alrededor de C, a ~1 km entre sí; el objetivo es el del centro. */
const LUGARES = lugaresAlrededor(C, 60);
const OBJETIVO = LUGARES[0].id;

function puntos(centro = C): PuntoDeGrilla[] {
  const plan = planificarGrilla({ centro, radioM: 1000, pasoM: 1500, lado: 3 });
  if (!plan.ok) throw new Error("el plan se negó");
  return plan.puntos;
}

const encargo = (centro = C) => ({ keyword: "fotvård", targetPlaceId: OBJETIVO, radiusM: 1000, puntos: puntos(centro) });

const envPrevio = process.env.GOOGLE_PLACES_API_KEY;
beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "clave-falsa-de-places";
});
afterEach(() => {
  if (envPrevio === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = envPrevio;
});

async function correrCon(google: ReturnType<typeof googleGeografico>, centro = C) {
  const r = await correrGrilla(encargo(centro), { consultar: (c) => posicionEnPunto(c, google.transporte) });
  if (!r.ok) throw new Error("la corrida se negó");
  return r.observaciones;
}

describe("una consulta por punto, con la coordenada de ese punto", () => {
  it("nueve pedidos, y el centro del sesgo de cada uno es SU punto, en el orden del plan", async () => {
    const google = googleGeografico(LUGARES);
    const obs = await correrCon(google);

    expect(google.pedidos).toHaveLength(9);
    const plan = puntos();
    // El primero, solo: la secuencia arranca en la esquina noroeste, no en el centro.
    expect(google.pedidos[0].cuerpo.locationBias?.circle?.center).toEqual({
      latitude: plan[0].lat,
      longitude: plan[0].lng,
    });
    expect(google.pedidos.map((p) => p.cuerpo.locationBias?.circle?.center)).toEqual(
      plan.map((p) => ({ latitude: p.lat, longitude: p.lng }))
    );
    expect(obs.map((o) => [o.fila, o.columna, o.lat, o.lng])).toEqual(plan.map((p) => [p.fila, p.columna, p.lat, p.lng]));
  });

  it("el mapa NO es plano: con geografía, las nueve celdas no dicen todas lo mismo", async () => {
    const obs = await correrCon(googleGeografico(LUGARES));
    const valores = new Set(obs.map((o) => (o.resultado === "position" ? o.posicion : o.resultado)));
    expect(valores.size).toBeGreaterThan(1);
    // El objetivo está en el centro de la grilla: ahí es el primero.
    expect(obs[4]).toMatchObject({ fila: 1, columna: 1, resultado: "position", posicion: 1 });
  });

  it("la hora de cada observación es la de su respuesta, no una sola para la corrida", async () => {
    const google = googleGeografico(LUGARES);
    let tic = Date.parse("2026-10-08T10:00:00.000Z");
    const r = await correrGrilla(encargo(), {
      consultar: (c) => posicionEnPunto(c, google.transporte),
      reloj: () => new Date((tic += 1000)),
    });
    if (!r.ok) throw new Error("se negó");
    expect(new Set(r.observaciones.map((o) => o.observadaEn)).size).toBe(9);
  });
});

describe("de a tres en vuelo (R13: el doble se cuelga y el test mira el primer tramo)", () => {
  it("salen tres, ninguna más hasta que vuelve una, y al final salieron las nueve", async () => {
    const google = googleGeografico(LUGARES, { retener: true });
    const corrida = correrGrilla(encargo(), {
      consultar: (c) => posicionEnPunto(c, google.transporte, 60_000),
    });

    await vaciarCola();
    // El primer tramo: tres pedidos en vuelo, ninguno contestado.
    expect(google.pedidos).toHaveLength(3);
    expect(google.enVuelo).toBe(3);

    google.soltar();
    await vaciarCola();
    expect(google.pedidos).toHaveLength(4);
    expect(google.enVuelo).toBe(3);

    while (google.colgados > 0) {
      google.soltar();
      await vaciarCola();
    }
    const r = await corrida;
    expect(r.ok && r.observaciones).toHaveLength(9);
    expect(google.pedidos).toHaveLength(9);
    expect(google.maximoEnVuelo).toBe(3);
  });
});

describe("el tope, la última línea antes del gasto", () => {
  it("diez puntos no salen: ni uno solo llega a consultar", async () => {
    let consultas = 0;
    const diez = [...puntos(), ...puntos().slice(0, 1)];
    const r = await correrGrilla(
      { keyword: "fotvård", targetPlaceId: OBJETIVO, radiusM: 1000, puntos: diez },
      {
        consultar: async () => {
          consultas++;
          return { outcome: "absent" };
        },
      }
    );
    expect(r).toEqual({ ok: false, motivo: "tope-de-puntos", pedidos: 10, tope: 9 });
    expect(consultas).toBe(0);
  });

  it("nueve sí", async () => {
    const r = await correrGrilla(encargo(), { consultar: async () => ({ outcome: "absent" }) });
    expect(r.ok && r.observaciones).toHaveLength(9);
  });
});

describe("LA RED SE CORTA A MITAD DE CORRIDA: sube «fallaron», no «no aparece»", () => {
  it("con la red cortada desde el quinto pedido, los cinco últimos son failed/network y no aparece no sube", async () => {
    const entera = await correrCon(googleGeografico(LUGARES));
    const cortada = await correrCon(googleGeografico(LUGARES, { cortarDesde: 5 }));

    const antes = denominador(9, entera);
    const despues = denominador(9, cortada);
    expect(antes.fallaron).toBe(0);
    expect(despues.fallaron).toBe(5);
    expect(despues.noAparece).toBeLessThanOrEqual(antes.noAparece);
    expect(despues.devolvieronDato).toBe(4);
    expect(despues.puntos).toBe(despues.devolvieronDato + despues.fallaron);

    // Los cuatro primeros son los MISMOS que en la corrida entera: el corte no
    // los toca. Los cinco de después, todos con su código.
    expect(cortada.slice(0, 4)).toEqual(entera.slice(0, 4).map((o, i) => ({ ...o, observadaEn: cortada[i].observadaEn })));
    for (const o of cortada.slice(4)) {
      expect(o).toMatchObject({ resultado: "failed", posicion: null, codigoDeError: "network" });
    }
  });

  it("un 429 de cuota a mitad de corrida es failed/http_429 en ese punto, no absent", async () => {
    const google = googleGeografico(LUGARES, {
      responder: (p) => (p.numero === 2 ? new Response("{}", { status: 429 }) : undefined),
    });
    const obs = await correrCon(google);
    expect(obs[1]).toMatchObject({ resultado: "failed", codigoDeError: "http_429", posicion: null });
    expect(denominador(9, obs).fallaron).toBe(1);
  });

  it("si consultar TIRA, el punto es failed, nunca absent", async () => {
    let n = 0;
    const r = await correrGrilla(encargo(), {
      consultar: async () => {
        n++;
        if (n === 3) throw new Error("un transporte nuevo que tira");
        return { outcome: "absent" };
      },
    });
    if (!r.ok) throw new Error("se negó");
    expect(r.observaciones.filter((o) => o.resultado === "failed")).toHaveLength(1);
    expect(r.observaciones.find((o) => o.resultado === "failed")?.codigoDeError).toBe("network");
  });
});

describe("la cadena entera de la puerta, sin Google: A, A' y B", () => {
  const comoPrueba = (id: string, centro: { lat: number; lng: number }, observaciones: Observacion[]): CorridaDeLaPrueba => ({
    id,
    palabraClave: "fotvård",
    lugarObjetivo: OBJETIVO,
    centro,
    radioM: 1000,
    pasoM: 1500,
    puntos: 9,
    valorNoAparece: 21,
    desplazamientoDeclaradoM: 8000,
    empezoEn: "2026-10-08T10:00:00.000Z",
    observaciones,
  });

  it("con la coordenada en cada pedido, B (8 km) se aleja de A y la repetición no: verde", async () => {
    const A = await correrCon(googleGeografico(LUGARES), C);
    const A2 = await correrCon(googleGeografico(LUGARES), C);
    const B = await correrCon(googleGeografico(LUGARES), B_CENTRO);

    const v = veredicto(comoPrueba("A", C, A), comoPrueba("A2", C, A2), comoPrueba("B", B_CENTRO, B));
    expect(v.motivos).toEqual([]);
    expect(v.verde).toBe(true);
    expect(v.geografia.estado === "numero" && v.geografia.valor).toBeGreaterThan(0);
  });

  it("SIN locationBias el doble contesta lo mismo en todos lados: B da el mismo mapa que A, y es rojo", async () => {
    // Lo que haría un cliente que pregunta sin coordenada: el modo de fallo que
    // la puerta nombra. Se arma acá quitando el sesgo del pedido que
    // `posicionEnPunto` construye, para que el doble lo vea como lo vería Google.
    const sinSesgo = (google: ReturnType<typeof googleGeografico>): typeof fetch =>
      (async (url: RequestInfo | URL, init?: RequestInit) => {
        const cuerpo = JSON.parse(String(init?.body));
        delete cuerpo.locationBias;
        return google.transporte(url, { ...init, body: JSON.stringify(cuerpo) });
      }) as typeof fetch;
    const correrSinSesgo = async (centro: { lat: number; lng: number }) => {
      const google = googleGeografico(LUGARES);
      const r = await correrGrilla(encargo(centro), { consultar: (c) => posicionEnPunto(c, sinSesgo(google)) });
      if (!r.ok) throw new Error("se negó");
      return r.observaciones;
    };

    const A = await correrSinSesgo(C);
    const B = await correrSinSesgo(B_CENTRO);
    expect(distanciaEntreCorridas(comoPrueba("A", C, A), comoPrueba("B", B_CENTRO, B))).toMatchObject({
      estado: "numero",
      valor: 0,
    });
    const v = veredicto(comoPrueba("A", C, A), comoPrueba("A2", C, A), comoPrueba("B", B_CENTRO, B));
    expect(v.verde).toBe(false);
    expect(v.motivos).toContain("desplazado-identico");
  });
});
