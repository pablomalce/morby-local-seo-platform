/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la puerta H2-GO-3 se conteste mirando dos mapas a ojo. La puerta (versión
 * CORREGIDA por el crítico, ESPINA_VULKAN_II.md) es una cuenta: tres corridas en
 * la misma sesión —A (centro C), A' (centro C, repetida), B (centro C desplazado
 * una distancia DECLARADA antes de correr)—, una distancia entre matrices, y
 * verde sólo si d(A,A') < d(A,B)/3 y d(A,B) > 0. «Produce un mapa distinto» no
 * distingue geografía de ruido: dos corridas con el MISMO centro también salen
 * distintas, y un cliente que devuelve resultados al azar pasaba la versión
 * vieja. Esta es la cuenta, escrita una vez y sin red: todo lo de acá es puro.
 *
 * QUÉ HAY
 *
 *   * `planificarGrilla`: la grilla declarada (centro, radio, paso, lado) en
 *     puntos con coordenada, con el TOPE de nueve puntos —acto humano de la
 *     puerta, decidido por la sesión directora (recomendación 11a)—. La 0032
 *     repite el tope en la base;
 *   * `denominador`: N puntos, cuántos devolvieron dato (aparece + no aparece),
 *     cuántos fallaron, y cuántos no tienen observación (una corrida que se
 *     cortó a la mitad). Los cuatro números que el informe publica;
 *   * `distanciaEntreCorridas`: la media de |posición A − posición B| celda a
 *     celda, con «no aparece» = el valor fijo DECLARADO en las corridas. Una
 *     celda que FALLÓ en cualquiera de las dos se EXCLUYE y se cuenta aparte
 *     —mapearla a algo sería inventar una posición— y si quedan menos de N/2
 *     celdas comparables la distancia es `insuficiente`, no un número;
 *   * `veredicto`: la cuenta de la puerta, con sus precondiciones dichas como
 *     motivos: misma palabra, mismo lugar, misma grilla, el desplazamiento
 *     declarado igual en las tres y MEDIDO entre los centros de A y B.
 *
 * LO QUE NO HACE
 *
 * No sale a la red (eso es `corrida.ts` con `posicionEnPunto`) ni escribe nada
 * (eso es `POST /api/geo/grid`).
 */

/** Acto humano de H2-GO-3: máximo 9 puntos por corrida (3x3). La 0032 lo repite en la base. */
export const TOPE_DE_PUNTOS = 9;

/** «No aparece», mapeado a un valor fijo FUERA del rango de posiciones (1..20). */
export const VALOR_NO_APARECE_POR_DEFECTO = 21;

/** Radio medio de la Tierra, en metros (IUGG). */
const RADIO_TIERRA_M = 6_371_008.8;

/**
 * Cuánto puede separarse la distancia MEDIDA entre los centros de A y B de la
 * declarada, como fracción de la declarada. El desplazamiento lo calcula
 * `desplazar()` sobre una esfera y lo mide `distanciaEntreCentros()` con
 * haversine sobre la misma esfera: con 1 % sobra para el redondeo de las
 * coordenadas que alguien escriba a mano.
 */
export const TOLERANCIA_DEL_DESPLAZAMIENTO = 0.01;

/** Una repetición es «el mismo centro» si sus centros están a menos de esto. */
export const MISMO_CENTRO_M = 1;

/** «La misma sesión»: las tres corridas empiezan dentro de esta ventana. */
export const VENTANA_DE_LA_SESION_MS = 3 * 60 * 60 * 1000;

export interface Coordenada {
  lat: number;
  lng: number;
}

export interface GrillaDeclarada {
  centro: Coordenada;
  /** El radio del círculo de `locationBias` en cada punto, en metros. */
  radioM: number;
  /** La distancia entre puntos vecinos, en metros. */
  pasoM: number;
  /** Puntos por lado: la grilla es de `lado × lado`. */
  lado: number;
}

export interface PuntoDeGrilla extends Coordenada {
  /** 0 es la fila de más al norte. */
  fila: number;
  /** 0 es la columna de más al oeste. */
  columna: number;
}

export type Plan =
  | { ok: true; puntos: PuntoDeGrilla[] }
  | { ok: false; motivo: "tope-de-puntos"; pedidos: number; tope: number }
  | { ok: false; motivo: "lado-invalido" };

const aRad = (grados: number) => (grados * Math.PI) / 180;
const aGrados = (rad: number) => (rad * 180) / Math.PI;

/** Normaliza una longitud a [-180, 180). */
function normalizarLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * El punto a `norteM` metros al norte y `esteM` al este de `origen`, sobre la
 * esfera. Para los kilómetros de una grilla local, desplazar en latitud y
 * después en longitud con el coseno de la latitud de partida es exacto a menos
 * de un metro.
 */
export function desplazar(origen: Coordenada, norteM: number, esteM: number): Coordenada {
  const lat = origen.lat + aGrados(norteM / RADIO_TIERRA_M);
  const lng = origen.lng + aGrados(esteM / (RADIO_TIERRA_M * Math.cos(aRad(origen.lat))));
  return { lat, lng: normalizarLng(lng) };
}

/** La distancia entre dos coordenadas, en metros (haversine, misma esfera que `desplazar`). */
export function distanciaEntreCentros(a: Coordenada, b: Coordenada): number {
  const dLat = aRad(b.lat - a.lat);
  const dLng = aRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aRad(a.lat)) * Math.cos(aRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * La grilla declarada, en puntos. Se niega ANTES de calcular un solo punto si
 * pide más del tope: quien llama no tiene nada que mandar a la red.
 */
export function planificarGrilla(grilla: GrillaDeclarada): Plan {
  const { lado } = grilla;
  if (!Number.isInteger(lado) || lado < 1) return { ok: false, motivo: "lado-invalido" };
  const pedidos = lado * lado;
  if (pedidos > TOPE_DE_PUNTOS) return { ok: false, motivo: "tope-de-puntos", pedidos, tope: TOPE_DE_PUNTOS };

  const mitad = (lado - 1) / 2;
  const puntos: PuntoDeGrilla[] = [];
  for (let fila = 0; fila < lado; fila++) {
    for (let columna = 0; columna < lado; columna++) {
      const { lat, lng } = desplazar(grilla.centro, (mitad - fila) * grilla.pasoM, (columna - mitad) * grilla.pasoM);
      puntos.push({ fila, columna, lat, lng });
    }
  }
  return { ok: true, puntos };
}

export type Resultado = "position" | "absent" | "failed";

export interface Observacion {
  fila: number;
  columna: number;
  lat: number;
  lng: number;
  observadaEn: string;
  resultado: Resultado;
  posicion: number | null;
  codigoDeError: string | null;
}

export interface Denominador {
  /** Los puntos DECLARADOS de la corrida. */
  puntos: number;
  /** Respuesta viva de Google: aparece + noAparece. */
  devolvieronDato: number;
  aparece: number;
  noAparece: number;
  fallaron: number;
  /** Declarados sin observación: la corrida se cortó antes de escribirlos. */
  sinObservacion: number;
}

/**
 * Los números que el informe publica. Se cuentan por RESULTADO, uno por uno:
 * `fallaron` no es «puntos menos los que dieron dato», porque entonces un
 * punto sin observación se contaría como fallo y uno fallido escrito como
 * `absent` no se vería nunca.
 */
export function denominador(puntos: number, observaciones: readonly Observacion[]): Denominador {
  const aparece = observaciones.filter((o) => o.resultado === "position").length;
  const noAparece = observaciones.filter((o) => o.resultado === "absent").length;
  const fallaron = observaciones.filter((o) => o.resultado === "failed").length;
  return {
    puntos,
    devolvieronDato: aparece + noAparece,
    aparece,
    noAparece,
    fallaron,
    sinObservacion: Math.max(0, puntos - observaciones.length),
  };
}

/** Lo que la distancia necesita de una corrida. */
export interface CorridaComparable {
  puntos: number;
  valorNoAparece: number;
  observaciones: readonly Observacion[];
}

export type Distancia =
  | {
      estado: "numero";
      valor: number;
      comparables: number;
      excluidasPorFallo: number;
      sinObservacion: number;
      puntos: number;
    }
  | {
      estado: "insuficiente";
      comparables: number;
      excluidasPorFallo: number;
      sinObservacion: number;
      puntos: number;
      /** Cuántas celdas comparables hacían falta. */
      minimo: number;
    }
  | { estado: "incomparable"; motivo: "grilla-distinta" | "valor-no-aparece-distinto" };

/**
 * La distancia entre dos corridas de la MISMA grilla: la media, sobre las celdas
 * comparables, de |posición en A − posición en B|, con «no aparece» = el valor
 * declarado. Una celda es comparable si las DOS corridas tienen una observación
 * viva (`position` o `absent`) en ella.
 *
 * `insuficiente` cuando las comparables son MENOS DE LA MITAD de los puntos: con
 * 9 puntos hacen falta 5. Un promedio de dos celdas no es el mapa.
 */
export function distanciaEntreCorridas(a: CorridaComparable, b: CorridaComparable): Distancia {
  if (a.puntos !== b.puntos) return { estado: "incomparable", motivo: "grilla-distinta" };
  if (a.valorNoAparece !== b.valorNoAparece) return { estado: "incomparable", motivo: "valor-no-aparece-distinto" };

  const puntos = a.puntos;
  const lado = Math.round(Math.sqrt(puntos));
  const valor = (o: Observacion, noAparece: number) => (o.resultado === "position" ? (o.posicion as number) : noAparece);
  const celda = (obs: readonly Observacion[], fila: number, columna: number) =>
    obs.find((o) => o.fila === fila && o.columna === columna);

  let suma = 0;
  let comparables = 0;
  let excluidasPorFallo = 0;
  let sinObservacion = 0;
  for (let fila = 0; fila < lado; fila++) {
    for (let columna = 0; columna < lado; columna++) {
      const oa = celda(a.observaciones, fila, columna);
      const ob = celda(b.observaciones, fila, columna);
      if (!oa || !ob) {
        sinObservacion++;
        continue;
      }
      if (oa.resultado === "failed" || ob.resultado === "failed") {
        excluidasPorFallo++;
        continue;
      }
      suma += Math.abs(valor(oa, a.valorNoAparece) - valor(ob, b.valorNoAparece));
      comparables++;
    }
  }

  if (2 * comparables < puntos) {
    return {
      estado: "insuficiente",
      comparables,
      excluidasPorFallo,
      sinObservacion,
      puntos,
      minimo: Math.ceil(puntos / 2),
    };
  }
  return { estado: "numero", valor: suma / comparables, comparables, excluidasPorFallo, sinObservacion, puntos };
}

/** Lo que el veredicto necesita de una corrida, además de sus observaciones. */
export interface CorridaDeLaPrueba extends CorridaComparable {
  id: string;
  palabraClave: string;
  lugarObjetivo: string;
  centro: Coordenada;
  radioM: number;
  pasoM: number;
  desplazamientoDeclaradoM: number | null;
  empezoEn: string;
}

export type MotivoRojo =
  | "palabra-distinta"
  | "lugar-distinto"
  | "grilla-distinta"
  | "valor-no-aparece-distinto"
  | "desplazamiento-no-declarado"
  | "desplazamiento-distinto"
  | "repeticion-con-otro-centro"
  | "desplazamiento-medido-distinto"
  | "fuera-de-la-misma-sesion"
  | "distancia-a-repeticion-no-es-numero"
  | "distancia-al-desplazado-no-es-numero"
  | "desplazado-identico"
  | "geografia-no-supera-al-ruido";

export interface Veredicto {
  verde: boolean;
  motivos: MotivoRojo[];
  /** d(A, A'): el ruido de repetir. */
  ruido: Distancia;
  /** d(A, B): el efecto de mover el centro. */
  geografia: Distancia;
  desplazamientoDeclaradoM: number | null;
  desplazamientoMedidoM: number;
}

/**
 * La puerta: verde sólo si d(A,A') < d(A,B)/3 y d(A,B) > 0, con las tres
 * corridas comparables entre sí.
 *
 * Se compara `3 × d(A,A') < d(A,B)` en vez de dividir, que es la misma
 * desigualdad sin el redondeo de la división.
 *
 * `d(A,B) > 0` está implicado por la desigualdad —con d(A,B) = 0 haría falta
 * d(A,A') < 0, que una media de valores absolutos no puede dar— y está escrito
 * igual, con su propio motivo, porque la puerta lo nombra y porque el motivo
 * «desplazado idéntico» es exactamente el modo de fallo que la puerta
 * describe: el mapa no se movió. Un mutante que lo saque es EQUIVALENTE en el
 * resultado `verde`, y no en los motivos: el test lo mide por el motivo.
 */
export function veredicto(a: CorridaDeLaPrueba, repeticion: CorridaDeLaPrueba, desplazada: CorridaDeLaPrueba): Veredicto {
  const motivos: MotivoRojo[] = [];
  const tres = [a, repeticion, desplazada];

  if (tres.some((c) => c.palabraClave !== a.palabraClave)) motivos.push("palabra-distinta");
  if (tres.some((c) => c.lugarObjetivo !== a.lugarObjetivo)) motivos.push("lugar-distinto");
  if (tres.some((c) => c.puntos !== a.puntos || c.radioM !== a.radioM || c.pasoM !== a.pasoM)) {
    motivos.push("grilla-distinta");
  }
  if (tres.some((c) => c.valorNoAparece !== a.valorNoAparece)) motivos.push("valor-no-aparece-distinto");

  const declarado = a.desplazamientoDeclaradoM;
  if (tres.some((c) => c.desplazamientoDeclaradoM === null)) {
    motivos.push("desplazamiento-no-declarado");
  } else if (tres.some((c) => c.desplazamientoDeclaradoM !== declarado)) {
    motivos.push("desplazamiento-distinto");
  }

  if (distanciaEntreCentros(a.centro, repeticion.centro) >= MISMO_CENTRO_M) {
    motivos.push("repeticion-con-otro-centro");
  }
  const medido = distanciaEntreCentros(a.centro, desplazada.centro);
  if (declarado !== null && Math.abs(medido - declarado) > TOLERANCIA_DEL_DESPLAZAMIENTO * declarado) {
    motivos.push("desplazamiento-medido-distinto");
  }

  const inicios = tres.map((c) => Date.parse(c.empezoEn));
  if (inicios.some(Number.isNaN) || Math.max(...inicios) - Math.min(...inicios) > VENTANA_DE_LA_SESION_MS) {
    motivos.push("fuera-de-la-misma-sesion");
  }

  const ruido = distanciaEntreCorridas(a, repeticion);
  const geografia = distanciaEntreCorridas(a, desplazada);
  if (ruido.estado !== "numero") motivos.push("distancia-a-repeticion-no-es-numero");
  if (geografia.estado !== "numero") motivos.push("distancia-al-desplazado-no-es-numero");
  if (ruido.estado === "numero" && geografia.estado === "numero") {
    if (!(geografia.valor > 0)) motivos.push("desplazado-identico");
    if (!(3 * ruido.valor < geografia.valor)) motivos.push("geografia-no-supera-al-ruido");
  }

  return {
    verde: motivos.length === 0,
    motivos,
    ruido,
    geografia,
    desplazamientoDeclaradoM: declarado,
    desplazamientoMedidoM: medido,
  };
}
