/**
 * UN GOOGLE FALSO QUE TIENE GEOGRAFÍA — el doble del transporte de la grilla.
 *
 * QUÉ IMPIDE
 *
 * Que los tests de H2-GO-3 se pongan verdes con un doble que contesta lo mismo
 * en todos los puntos. Un doble así no puede distinguir una grilla geográfica de
 * una decorativa: es exactamente el «cliente mock» que la puerta nombra como
 * modo de fallo, puesto del lado del test.
 *
 * Este ordena sus lugares por DISTANCIA al centro de `locationBias.circle` del
 * pedido —como haría un buscador local— y contesta los primeros `pageSize`. Sin
 * `locationBias`, contesta SIEMPRE el mismo orden: el de la lista. Así, una
 * corrida que no manda la coordenada del punto da un mapa plano, y una que la
 * manda da un mapa que cambia cuando el centro se mueve. Es determinista, así
 * que A y A' (la repetición) dan el mismo mapa: el ruido de Google lo mide la
 * corrida con gasto, no esto.
 *
 * SALVO CON `ruido`: unos pocos intercambios de vecinos en el orden de cada
 * respuesta, sorteados con una semilla que avanza pedido a pedido. Así A' sale
 * PARECIDA a A y no igual —d(A,A') > 0—, que es lo que hace falta para que un
 * veredicto que ignorara A' (o que aceptara A' = A) se vea en un test: con el
 * doble determinista, d(A,A') ya era cero y las dos trampas pasaban (medido el
 * 2026-10-09).
 *
 * RECORRE LA SECUENCIA (R13): registra cada pedido en el orden en que llegó, con
 * su cuerpo y sus cabeceras, y deja programar qué contesta el pedido N —un 429,
 * una red cortada desde el pedido N en adelante, un pedido que cuelga hasta que
 * el test lo suelta—. Los tests afirman sobre el primer pedido y sobre los del
 * medio, no sólo sobre el final.
 */
/**
 * Su propia distancia, y no la de `grilla.ts`: el doble es el oráculo de la
 * geografía, y si compartiera la función que se prueba, una mutación de esa
 * función movería al oráculo con ella. Para ORDENAR lugares a pocos kilómetros,
 * la equirrectangular alcanza.
 */
function lejania(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const x = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = b.lat - a.lat;
  return x * x + y * y;
}

export interface LugarFalso {
  id: string;
  lat: number;
  lng: number;
}

export interface PedidoVisto {
  /** 1 es el primero. */
  numero: number;
  url: string;
  metodo: string;
  cabeceras: Record<string, string>;
  cuerpo: {
    textQuery?: string;
    pageSize?: number;
    maxResultCount?: number;
    locationBias?: { circle?: { center?: { latitude: number; longitude: number }; radius?: number } };
  };
  init: RequestInit;
}

export interface OpcionesDelGoogleFalso {
  /** Desde este pedido (1 es el primero), la red está cortada: `fetch` rechaza como lo hace undici. */
  cortarDesde?: number;
  /** Para el pedido N, una respuesta propia en vez de la geográfica. */
  responder?: (pedido: PedidoVisto) => Response | Promise<Response> | undefined;
  /** Si es true, cada pedido queda colgado hasta que el test llama a `soltar()`. */
  retener?: boolean;
  /** Si se pasa, un evento por pedido en esta lista compartida (para ordenar con la base). */
  eventos?: string[];
  /** Intercambios de vecinos sorteados en cada respuesta: el ruido de repetir (ver el encabezado). */
  ruido?: { semilla: number; intercambios: number };
}

/** Un generador lineal congruente: determinista, para que el test sea el mismo en cada corrida. */
export function sorteo(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(estado, 1103515245) + 12345) >>> 0;
    return estado / 2 ** 32;
  };
}

export function lugaresAlrededor(centro: { lat: number; lng: number }, cantidad: number, pasoGrados = 0.01): LugarFalso[] {
  // Una espiral cuadrada de lugares alrededor del centro: densa cerca, rala lejos.
  const lugares: LugarFalso[] = [];
  let x = 0;
  let y = 0;
  let dx = 1;
  let dy = 0;
  let tramo = 1;
  let dados = 0;
  let giros = 0;
  while (lugares.length < cantidad) {
    lugares.push({
      id: `ChIJfalso${String(lugares.length).padStart(4, "0")}aaaaaa`,
      lat: centro.lat + y * pasoGrados,
      lng: centro.lng + x * pasoGrados,
    });
    x += dx;
    y += dy;
    dados++;
    if (dados === tramo) {
      dados = 0;
      [dx, dy] = [-dy, dx];
      giros++;
      if (giros % 2 === 0) tramo++;
    }
  }
  return lugares;
}

export function googleGeografico(lugares: readonly LugarFalso[], opciones: OpcionesDelGoogleFalso = {}) {
  const pedidos: PedidoVisto[] = [];
  const colgados: Array<() => void> = [];
  let enVuelo = 0;
  let maximoEnVuelo = 0;
  const azar = opciones.ruido ? sorteo(opciones.ruido.semilla) : null;

  const contestar = (pedido: PedidoVisto): Response => {
    const centro = pedido.cuerpo.locationBias?.circle?.center;
    const orden = centro
      ? [...lugares].sort(
          (a, b) =>
            lejania({ lat: centro.latitude, lng: centro.longitude }, a) -
              lejania({ lat: centro.latitude, lng: centro.longitude }, b) || a.id.localeCompare(b.id)
        )
      : [...lugares];
    if (azar && opciones.ruido) {
      for (let i = 0; i < opciones.ruido.intercambios; i++) {
        const k = Math.floor(azar() * Math.min(19, orden.length - 1));
        [orden[k], orden[k + 1]] = [orden[k + 1], orden[k]];
      }
    }
    const cuantos = pedido.cuerpo.pageSize ?? pedido.cuerpo.maxResultCount ?? 20;
    const elegidos = orden.slice(0, Math.min(cuantos, 20));
    const cuerpo = elegidos.length
      ? { places: elegidos.map((l) => ({ id: l.id, displayName: { text: `Lugar ${l.id}`, languageCode: "sv" } })) }
      : {};
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "content-type": "application/json" } });
  };

  const transporte = (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    const pedido: PedidoVisto = {
      numero: pedidos.length + 1,
      url,
      metodo: init.method ?? "GET",
      cabeceras: Object.fromEntries(new Headers(init.headers).entries()),
      cuerpo: JSON.parse(String(init.body ?? "{}")),
      init,
    };
    pedidos.push(pedido);
    opciones.eventos?.push(`fetch#${pedido.numero}`);
    enVuelo++;
    maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo);
    try {
      if (opciones.retener) {
        await new Promise<void>((soltar, cortar) => {
          colgados.push(soltar);
          init.signal?.addEventListener("abort", () => cortar(new DOMException("aborted", "AbortError")));
        });
      }
      if (opciones.cortarDesde !== undefined && pedido.numero >= opciones.cortarDesde) {
        // Lo que tira undici cuando no hay red: un TypeError, no una respuesta.
        throw new TypeError("fetch failed");
      }
      const propia = await opciones.responder?.(pedido);
      return propia ?? contestar(pedido);
    } finally {
      enVuelo--;
    }
  }) as typeof fetch;

  return {
    transporte,
    pedidos,
    get enVuelo() {
      return enVuelo;
    },
    get maximoEnVuelo() {
      return maximoEnVuelo;
    },
    /** Suelta el pedido colgado más viejo. */
    soltar() {
      colgados.shift()?.();
    },
    get colgados() {
      return colgados.length;
    },
  };
}

/** Deja correr las promesas pendientes (sin timers). */
export async function vaciarCola(vueltas = 20): Promise<void> {
  for (let i = 0; i < vueltas; i++) await Promise.resolve();
}
