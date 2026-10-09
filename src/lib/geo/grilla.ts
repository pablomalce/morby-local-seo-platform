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
 *     puerta, decidido por la sesión directora (recomendación 11a)— y sin un
 *     solo punto fuera del mapa. La 0032 repite el tope en la base;
 *   * `ubicarObservaciones`: qué observación es la de cada celda DECLARADA. Una
 *     observación cuenta sólo si su celda está en la grilla, es la primera de
 *     esa celda y su coordenada es la que el plan le da a esa celda. Las demás
 *     son `fueraDeLaGrilla`: una corrida que consultó el centro nueve veces
 *     —la grilla decorativa— tiene ocho;
 *   * `denominador`: N puntos, cuántos devolvieron dato (aparece + no aparece),
 *     cuántos fallaron, cuántos no tienen observación (una corrida que se
 *     cortó a la mitad) y cuántas observaciones quedaron fuera de la grilla.
 *     Por CELDA declarada: devolvieron + fallaron + sin observación = N,
 *     siempre, aunque la base tuviera filas de más;
 *   * `distanciaEntreCorridas`: la media de |posición A − posición B| celda a
 *     celda, con «no aparece» = el valor fijo DECLARADO en las corridas. Una
 *     celda que FALLÓ en cualquiera de las dos se EXCLUYE y se cuenta aparte
 *     —mapearla a algo sería inventar una posición— y si quedan menos de N/2
 *     celdas comparables la distancia es `insuficiente`, no un número;
 *   * `veredicto`: la cuenta de la puerta, con sus precondiciones dichas como
 *     motivos: TRES corridas distintas, con la repetición DESPUÉS de la
 *     original, de la MISMA aprobación de gasto; misma palabra, mismo lugar,
 *     la grilla decidida (3x3) con cada observación en su coordenada; el
 *     desplazamiento declarado —el de la puerta, 8 km— igual en las tres y
 *     MEDIDO entre los centros de A y B.
 *
 * LO QUE NO HACE
 *
 * No sale a la red (eso es `corrida.ts` con `posicionEnPunto`) ni escribe nada
 * (eso es `POST /api/geo/grid`).
 */

/** Acto humano de H2-GO-3: máximo 9 puntos por corrida (3x3). La 0032 lo repite en la base. */
export const TOPE_DE_PUNTOS = 9;

/**
 * Acto humano de H2-GO-3, la otra mitad: tres corridas por aprobación de gasto
 * (recomendación 11a: 3 corridas, ~27 llamadas, menos de USD 1). La aprobación
 * es una fila de `geo_grid_spend_approvals` que sólo escribe `service_role`, y
 * cada corrida toma un cupo numerado de 1 a `max_runs` —único por aprobación—.
 * La 0032 lo hace cumplir en la base (`max_runs` entre 1 y 3); la ruta lo
 * repite. Subirlo es una decisión de gasto: una migración y un PR.
 */
export const TOPE_DE_CORRIDAS_POR_APROBACION = 3;

/**
 * La grilla con la que se cruza la puerta: la del tope, 3x3. Una corrida de
 * 1x1 es UN llamado con coordenada, y tres de ésas daban verde: la «distancia
 * entre matrices» degeneraba en una resta. Una grilla más chica se puede correr
 * —cuesta menos y sirve para mirar—, pero no cruza la puerta.
 */
export const PUNTOS_DE_LA_PUERTA = TOPE_DE_PUNTOS;

/**
 * El desplazamiento de B, DECLARADO por escrito antes de correr: 8 km
 * (ESPINA_VULKAN_II.md, H2-GO-3 corregida). Está escrito acá, en un commit, y
 * no se elige al pedir el veredicto: un desplazamiento que se elige después de
 * ver los mapas no es una declaración. Cambiarlo es un PR.
 */
export const DESPLAZAMIENTO_DE_LA_PUERTA_M = 8_000;

/**
 * Cuánto puede separarse la coordenada guardada de una observación de la que el
 * plan le da a su celda. La base exige 1e-6 grados (~0,1 m) en la `0032`; acá
 * alcanza un metro: lo que se descarta es una coordenada que no es la de la
 * celda —el centro repetido nueve veces está a 1,5 km—, no el redondeo.
 */
export const TOLERANCIA_DE_LA_COORDENADA_M = 1;

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
  | { ok: false; motivo: "lado-invalido" }
  | { ok: false; motivo: "punto-fuera-del-mapa"; fila: number; columna: number; lat: number };

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
 *
 * Y se niega si UN punto cae fuera del mapa (latitud fuera de [-90, 90]). Con
 * un centro a 89,9° y un paso de 50 km, la fila norte salía a 90,35°: la ruta
 * mandaba los nueve pedidos —seis facturables—, y después la base rechazaba el
 * lote entero de observaciones por su CHECK de coordenadas. Gasto sin registro.
 * Ahora no sale nada.
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
      if (!(lat >= -90 && lat <= 90) || !Number.isFinite(lng)) {
        return { ok: false, motivo: "punto-fuera-del-mapa", fila, columna, lat };
      }
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
  /** Celdas declaradas sin observación: la corrida se cortó antes de escribirlas. */
  sinObservacion: number;
  /**
   * Observaciones que NO son de ninguna celda declarada: fuera de la grilla,
   * repetidas, o con una coordenada que no es la de su celda. No cuentan en
   * nada de lo de arriba, y se publican para que no se pierdan de vista.
   */
  fueraDeLaGrilla: number;
}

/** Lo que hace falta para saber qué observación es la de cada celda: la grilla declarada y lo observado. */
export interface CorridaDeclarada {
  centro: Coordenada;
  radioM: number;
  pasoM: number;
  /** N, los puntos declarados: `lado × lado`. */
  puntos: number;
  observaciones: readonly Observacion[];
}

export interface Ubicacion {
  /** La observación de cada celda declarada, por `"fila,columna"`. */
  porCelda: Map<string, Observacion>;
  fueraDeLaGrilla: number;
}

const claveDeCelda = (fila: number, columna: number) => `${fila},${columna}`;

/**
 * Qué observación es la de cada celda DECLARADA. Una observación es de su celda
 * si la celda existe en la grilla de N puntos, si es la primera de esa celda, y
 * si su coordenada es la que el plan le da a esa celda (a menos de
 * `TOLERANCIA_DE_LA_COORDENADA_M`). Cualquier otra es `fueraDeLaGrilla`.
 *
 * QUÉ IMPIDE: la grilla decorativa. Una corrida que consultó el centro en los
 * nueve puntos tenía nueve observaciones «con coordenada», las nueve en el
 * centro: el denominador decía nueve datos, la distancia comparaba las nueve
 * celdas y el veredicto no miraba nunca lat/lng. Ahora ocho de las nueve están
 * fuera de la grilla, y el veredicto lo nombra.
 *
 * Si N no es un cuadrado, o el plan se niega, NINGUNA observación es de una
 * celda: no hay grilla declarada contra la cual ubicarlas.
 */
export function ubicarObservaciones(corrida: CorridaDeclarada): Ubicacion {
  const porCelda = new Map<string, Observacion>();
  const lado = Math.round(Math.sqrt(corrida.puntos));
  const plan =
    lado * lado === corrida.puntos
      ? planificarGrilla({ centro: corrida.centro, radioM: corrida.radioM, pasoM: corrida.pasoM, lado })
      : null;
  if (!plan || !plan.ok) return { porCelda, fueraDeLaGrilla: corrida.observaciones.length };

  const planeado = new Map(plan.puntos.map((p) => [claveDeCelda(p.fila, p.columna), p]));
  let fueraDeLaGrilla = 0;
  for (const o of corrida.observaciones) {
    const clave = claveDeCelda(o.fila, o.columna);
    const punto = planeado.get(clave);
    if (!punto || porCelda.has(clave) || !(distanciaEntreCentros(punto, o) <= TOLERANCIA_DE_LA_COORDENADA_M)) {
      fueraDeLaGrilla++;
      continue;
    }
    porCelda.set(clave, o);
  }
  return { porCelda, fueraDeLaGrilla };
}

/**
 * Los números que el informe publica. Se cuentan por CELDA DECLARADA y por
 * RESULTADO, uno por uno: `fallaron` no es «puntos menos los que dieron dato»,
 * porque entonces un punto sin observación se contaría como fallo y uno fallido
 * escrito como `absent` no se vería nunca. Y como se cuenta por celda,
 * devolvieronDato + fallaron + sinObservacion = puntos SIEMPRE: una corrida de
 * un punto con nueve filas en la base no puede publicar nueve datos devueltos.
 */
export function denominador(corrida: CorridaDeclarada): Denominador {
  const { porCelda, fueraDeLaGrilla } = ubicarObservaciones(corrida);
  const ubicadas = [...porCelda.values()];
  const aparece = ubicadas.filter((o) => o.resultado === "position").length;
  const noAparece = ubicadas.filter((o) => o.resultado === "absent").length;
  const fallaron = ubicadas.filter((o) => o.resultado === "failed").length;
  return {
    puntos: corrida.puntos,
    devolvieronDato: aparece + noAparece,
    aparece,
    noAparece,
    fallaron,
    sinObservacion: corrida.puntos - ubicadas.length,
    fueraDeLaGrilla,
  };
}

/** Lo que la distancia necesita de una corrida: su grilla declarada, lo observado y el valor de «no aparece». */
export interface CorridaComparable extends CorridaDeclarada {
  valorNoAparece: number;
}

export type Distancia =
  | {
      estado: "numero";
      valor: number;
      comparables: number;
      excluidasPorFallo: number;
      sinObservacion: number;
      /** Observaciones de las dos corridas que no son de ninguna celda declarada (ver `ubicarObservaciones`). */
      fueraDeLaGrilla: number;
      puntos: number;
    }
  | {
      estado: "insuficiente";
      comparables: number;
      excluidasPorFallo: number;
      sinObservacion: number;
      fueraDeLaGrilla: number;
      puntos: number;
      /** Cuántas celdas comparables hacían falta. */
      minimo: number;
    }
  | { estado: "incomparable"; motivo: "grilla-distinta" | "valor-no-aparece-distinto" };

/**
 * La distancia entre dos corridas de la MISMA grilla —mismos N, paso y radio;
 * el centro puede ser otro, que es lo que la puerta mueve—: la media, sobre las
 * celdas comparables, de |posición en A − posición en B|, con «no aparece» = el
 * valor declarado. Una celda es comparable si las DOS corridas tienen en ella
 * una observación UBICADA (`ubicarObservaciones`) y viva (`position` o
 * `absent`). Una observación fuera de la grilla no es de ninguna celda: su
 * celda queda sin observación.
 *
 * `insuficiente` cuando las comparables son MENOS DE LA MITAD de los puntos: con
 * 9 puntos hacen falta 5. Un promedio de dos celdas no es el mapa.
 */
export function distanciaEntreCorridas(a: CorridaComparable, b: CorridaComparable): Distancia {
  if (a.puntos !== b.puntos || a.pasoM !== b.pasoM || a.radioM !== b.radioM) {
    return { estado: "incomparable", motivo: "grilla-distinta" };
  }
  if (a.valorNoAparece !== b.valorNoAparece) return { estado: "incomparable", motivo: "valor-no-aparece-distinto" };

  const puntos = a.puntos;
  const lado = Math.round(Math.sqrt(puntos));
  const valor = (o: Observacion, noAparece: number) => (o.resultado === "position" ? (o.posicion as number) : noAparece);
  const ua = ubicarObservaciones(a);
  const ub = ubicarObservaciones(b);

  let suma = 0;
  let comparables = 0;
  let excluidasPorFallo = 0;
  let sinObservacion = 0;
  for (let fila = 0; fila < lado; fila++) {
    for (let columna = 0; columna < lado; columna++) {
      const oa = ua.porCelda.get(claveDeCelda(fila, columna));
      const ob = ub.porCelda.get(claveDeCelda(fila, columna));
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
  const fueraDeLaGrilla = ua.fueraDeLaGrilla + ub.fueraDeLaGrilla;

  if (2 * comparables < puntos) {
    return {
      estado: "insuficiente",
      comparables,
      excluidasPorFallo,
      sinObservacion,
      fueraDeLaGrilla,
      puntos,
      minimo: Math.ceil(puntos / 2),
    };
  }
  return {
    estado: "numero",
    valor: suma / comparables,
    comparables,
    excluidasPorFallo,
    sinObservacion,
    fueraDeLaGrilla,
    puntos,
  };
}

/** Lo que el veredicto necesita de una corrida, además de su grilla y sus observaciones. */
export interface CorridaDeLaPrueba extends CorridaComparable {
  id: string;
  palabraClave: string;
  lugarObjetivo: string;
  desplazamientoDeclaradoM: number | null;
  empezoEn: string;
  /**
   * La aprobación de gasto con la que se pagó (`geo_grid_spend_approvals`, 0032).
   * `null` sólo en una corrida que no salió de la base.
   */
  aprobacion: string | null;
}

export type MotivoRojo =
  | "corridas-repetidas"
  | "repeticion-no-es-posterior"
  | "aprobacion-distinta"
  | "palabra-distinta"
  | "lugar-distinto"
  | "grilla-distinta"
  | "grilla-no-es-la-de-la-puerta"
  | "observaciones-fuera-de-la-grilla"
  | "valor-no-aparece-distinto"
  | "desplazamiento-no-declarado"
  | "desplazamiento-distinto"
  | "desplazamiento-no-es-el-de-la-puerta"
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
 *
 * LAS TRES SON TRES. La repetición tiene que ser OTRA corrida, empezada
 * DESPUÉS de la original: con A' = A, d(A,A') vale cero por construcción y la
 * puerta se reducía a d(A,B) > 0 —la versión vieja que el crítico corrigió—.
 * Medido el 2026-10-09 con un cliente que ignora la coordenada y contesta al
 * azar: el trío honesto daba rojo (ruido 5,11, geografía 8,56) y el mismo par
 * con `repeatId = runId` daba verde. Y las tres de la MISMA aprobación de gasto
 * (3 corridas como máximo, 0032): no se puede correr A' hasta que salga una que
 * dé verde sin pedir otra aprobación, y esa otra aprobación no arma trío con
 * ésta.
 *
 * LA GRILLA ES LA DECIDIDA, Y CADA OBSERVACIÓN ESTÁ EN SU PUNTO. Tres corridas
 * de 1x1 —un llamado cada una— daban verde con una «distancia» de una sola
 * resta; y una corrida que consultó el centro nueve veces tenía una matriz de
 * nueve celdas que no medían nada distinto. Por eso `PUNTOS_DE_LA_PUERTA` y
 * `ubicarObservaciones`.
 *
 * EL DESPLAZAMIENTO ES EL DECLARADO POR LA PUERTA, 8 km, y no uno que se elige
 * al pedir el veredicto.
 */
export function veredicto(a: CorridaDeLaPrueba, repeticion: CorridaDeLaPrueba, desplazada: CorridaDeLaPrueba): Veredicto {
  const motivos: MotivoRojo[] = [];
  const tres = [a, repeticion, desplazada];

  if (new Set(tres.map((c) => c.id)).size !== 3) motivos.push("corridas-repetidas");
  if (!(Date.parse(repeticion.empezoEn) > Date.parse(a.empezoEn))) motivos.push("repeticion-no-es-posterior");
  if (tres.some((c) => c.aprobacion === null || c.aprobacion !== a.aprobacion)) motivos.push("aprobacion-distinta");

  if (tres.some((c) => c.palabraClave !== a.palabraClave)) motivos.push("palabra-distinta");
  if (tres.some((c) => c.lugarObjetivo !== a.lugarObjetivo)) motivos.push("lugar-distinto");
  if (tres.some((c) => c.puntos !== a.puntos || c.radioM !== a.radioM || c.pasoM !== a.pasoM)) {
    motivos.push("grilla-distinta");
  }
  if (tres.some((c) => c.puntos !== PUNTOS_DE_LA_PUERTA)) motivos.push("grilla-no-es-la-de-la-puerta");
  if (tres.some((c) => ubicarObservaciones(c).fueraDeLaGrilla > 0)) motivos.push("observaciones-fuera-de-la-grilla");
  if (tres.some((c) => c.valorNoAparece !== a.valorNoAparece)) motivos.push("valor-no-aparece-distinto");

  const declarado = a.desplazamientoDeclaradoM;
  if (tres.some((c) => c.desplazamientoDeclaradoM === null)) {
    motivos.push("desplazamiento-no-declarado");
  } else if (tres.some((c) => c.desplazamientoDeclaradoM !== declarado)) {
    motivos.push("desplazamiento-distinto");
  } else if (declarado !== DESPLAZAMIENTO_DE_LA_PUERTA_M) {
    motivos.push("desplazamiento-no-es-el-de-la-puerta");
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
