/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el fallo de un ensayo se muestre como un único «no se pudo», fundiendo
 * situaciones que se arreglan en lugares distintos y por personas distintas.
 *
 * `POST /api/publishing/rehearse` contesta SIETE códigos —200, 400, 401, 404,
 * 409, 429, 500 y 502—, ocho lecturas contando el 200 que no es un ensayo, y
 * dos de ellos llegan por caminos que no se distinguen por el status sino por
 * el cuerpo. Hay una novena clase que no viene de ningún status: cuando el
 * `fetch` no llega a contestar. Medido sobre `route.ts` al 2026-09-26:
 *
 *   * 404 es «este usuario no alcanza ese asset», y la RLS de la `0014` le da el
 *     MISMO 404 a un id inventado y a un asset de otra organización. Se arregla
 *     recargando o cambiando de organización, y NO se reservó nada;
 *   * 409 es «el sello no está o quedó viejo». Se arregla en OTRA pantalla
 *     —aprobando en `/app/content`— y el operador no tiene nada que reintentar
 *     acá. Llega por dos ramas del servidor (`route.ts:90`, sin hash; y
 *     `route.ts:114`, con el hash rechazado por la FK compuesta de la `0016`)
 *     que para quien mira la pantalla significan lo mismo;
 *   * 429 es «veinte por minuto y esa IP los gastó» (`rate-limit.ts`), y está
 *     ANTES de la sesión: se arregla esperando, y confundirlo con un fallo real
 *     manda a alguien a revisar la base por nada;
 *   * 502 son DOS lugares distintos donde mirar, y sólo el cuerpo los separa:
 *     sólo `{ error: "asset unreadable" }` dice que el ledger no se tocó;
 *     cualquier OTRO 502 —incluido uno de un proxy, o un cuerpo que no parsea—
 *     deja sin saber si quedó una fila reservada. La diferencia decide si hay
 *     que ir a mirar la base, así que la certeza exige la marca positiva;
 *   * 500 y un 200 con un estado que el `dry-run` no puede producir dicen lo
 *     mismo y son lo peor: el servidor dejó de estar en el modo que esta
 *     pantalla cree. Eso no se reintenta, se arregla en el código.
 *
 * Un solo mensaje para todo eso deja a alguien apretando el botón de nuevo en
 * los cuatro casos en los que apretarlo no puede funcionar.
 *
 * ES PURO A PROPÓSITO, Y NO IMPORTA `server-only`
 *
 * Lo que hay que poder probar son las lecturas, no el React —el mismo argumento
 * de `ledgerView.ts`—, y lo importa un componente CLIENTE: un `server-only` acá
 * rompería el build de la pantalla.
 *
 * LO QUE ESTE ARCHIVO NO HACE
 *
 * No decide si se puede ensayar ni compara hashes. Quién puede y con qué sello
 * lo deciden la RLS y la FK compuesta; copiar ese criterio acá sería la copia que
 * este repositorio no quiere, y una copia diverge.
 */

/** Un asset aprobado, en lo único que el selector mira de él. */
export interface AssetEnsayable {
  id: string;
  /** `content_assets.title` es nullable: la etiqueta cae a `kind`. */
  title: string | null;
  kind: string;
  locale: string;
}

/**
 * Las clases, declaradas como lista para que el test pueda recorrerlas.
 *
 * Con el tipo escrito a mano, un caso nuevo sin frase propia pasaría
 * desapercibido: la anti-vacuidad de `ensayoVisto.test.ts` compara la cantidad
 * de clases contra la cantidad de frases DISTINTAS, y para eso necesita saber
 * cuántas clases hay sin que nadie lo escriba dos veces.
 */
export const CLASES_DE_ENSAYO = [
  "ensayado",
  "ya-publicado",
  "no-aprobado",
  "asset-ausente",
  "sin-sesion",
  "demasiados",
  "ledger-ilegible",
  "asset-ilegible",
  "defecto-del-servidor",
  "pedido-invalido",
  // No viene de un status: es el `fetch` que rechazó —red caída, DNS, la
  // pestaña que se duerme—. Un escéptico midió que sin esta clase la pantalla
  // no mostraba NADA y el click se leía como si no hubiera pasado, que es la
  // peor de las lecturas: el pedido pudo haber llegado.
  "sin-respuesta",
] as const;

export type ClaseDeEnsayo = (typeof CLASES_DE_ENSAYO)[number];

export interface LecturaDeEnsayo {
  clase: ClaseDeEnsayo;
  /** Qué pasó, para alguien que no leyó `route.ts`. */
  quePaso: string;
  /** Qué hacer, o `null` cuando no hay nada que hacer. */
  queHacer: string | null;
}

/**
 * Una frase por clase, en un solo lugar.
 *
 * Están juntas para que fundir dos sea visible en el diff: si dos entradas dicen
 * lo mismo, el conteo de frases distintas baja y el test se pone rojo.
 */
export const LECTURAS: Record<ClaseDeEnsayo, LecturaDeEnsayo> = {
  ensayado: {
    clase: "ensayado",
    quePaso:
      "Ensayado. La base aceptó la reserva —o sea que el asset está aprobado y su texto no cambió— y no se llamó a ninguna red.",
    // NO dice "la fila NUEVA": `reservar()` recupera la fila que ya estaba
    // cuando el mismo asset se ensaya dos veces (`transport.ts:189-207`), y el
    // resultado es el mismo `estado: "ensayado"`. Un escéptico midió que la
    // frase anterior afirmaba una fila nueva que en el segundo ensayo no
    // existe. La reserva es por asset y destino, una sola, y eso es lo que se
    // dice.
    queHacer:
      "La reserva está en el ledger, acá abajo: una por asset y destino, así que si ya habías ensayado este asset es la misma fila de antes. Es el resultado: no hay nada más que mirar.",
  },
  "ya-publicado": {
    clase: "ya-publicado",
    quePaso:
      "Este asset YA había salido a su destino, así que el ensayo no reservó nada nuevo y no reintentó nada. El ledger quedó igual.",
    queHacer: "La fila que ya estaba, abajo, dice cuándo salió y con qué id. No hace falta ensayar de nuevo.",
  },
  "no-aprobado": {
    clase: "no-aprobado",
    quePaso:
      "El sello de aprobación no está, o quedó viejo porque el texto cambió después de aprobarse. La base rechazó la reserva y no se escribió ninguna fila.",
    queHacer: "Hay que volver a aprobar el asset en /app/content, y recién entonces ensayar.",
  },
  "asset-ausente": {
    clase: "asset-ausente",
    quePaso:
      "Ese asset ya no se alcanza desde esta sesión: puede haberse borrado, o puede ser de otra organización. No se reservó nada.",
    queHacer: "Recargá la lista, y si sigue apareciendo revisá qué organización está activa.",
  },
  "sin-sesion": {
    clase: "sin-sesion",
    quePaso: "La sesión se cayó antes de que el ensayo llegara a tocar el ledger.",
    queHacer: "Hay que volver a entrar. Nada de lo de acá se escribió.",
  },
  demasiados: {
    clase: "demasiados",
    quePaso:
      "Demasiados ensayos seguidos: la ruta acepta veinte por minuto por IP. Este pedido no llegó ni a mirar el asset.",
    queHacer: "Esperar un minuto y volver a intentar. No hay nada roto.",
  },
  "ledger-ilegible": {
    clase: "ledger-ilegible",
    quePaso:
      "El ledger no se pudo leer ni escribir, así que NO SE SABE si quedó una fila reservada. Esto no es «no pasó nada».",
    queHacer:
      "Antes de volver a ensayar hay que mirar el ledger en la base: un segundo ensayo sobre el mismo asset recupera la fila que hubiera quedado, pero conviene saber qué hay.",
  },
  "asset-ilegible": {
    clase: "asset-ilegible",
    quePaso:
      "No se pudo leer el asset, así que el ensayo no empezó. El ledger no se tocó: no hay ninguna fila nueva.",
    queHacer: "Se puede reintentar tal cual. Si sigue, el problema está en la lectura del contenido, no en la publicación.",
  },
  "defecto-del-servidor": {
    clase: "defecto-del-servidor",
    quePaso:
      "El servidor contestó algo que un ensayo no puede contestar: dejó de estar en el modo de ensayo que esta pantalla da por hecho.",
    queHacer: "No reintentar. Esto es un defecto del código y hay que mirarlo antes de tocar nada más.",
  },
  "pedido-invalido": {
    clase: "pedido-invalido",
    quePaso: "La ruta rechazó el pedido: el id del asset no llegó, o no es un uuid.",
    queHacer: "No es algo que se arregle apretando de nuevo: es un defecto de esta pantalla.",
  },
  "sin-respuesta": {
    clase: "sin-respuesta",
    quePaso:
      "El pedido no llegó a contestar —red, DNS o la pestaña dormida—, así que NO SE SABE si el ensayo ocurrió: pudo haber quedado una reserva.",
    queHacer:
      "Recargá la pantalla y mirá el ledger antes de volver a ensayar. Si la fila está, el ensayo ocurrió; ensayar de nuevo el mismo asset recupera esa misma fila y no duplica nada.",
  },
};

interface CuerpoDeEnsayo {
  estado?: unknown;
  motivo?: unknown;
  error?: unknown;
}

function leerCuerpo(cuerpo: unknown): CuerpoDeEnsayo {
  return typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as CuerpoDeEnsayo) : {};
}

/**
 * Cómo se lee la respuesta del ensayo.
 *
 * El status manda, salvo en los dos lugares donde no alcanza: el 200, que trae
 * el `estado` del transporte, y el 502, que se parte según el cuerpo traiga o
 * no la marca de «no se pudo leer el asset» — la única forma de saber que el
 * ledger quedó intacto.
 */
export function lecturaDeEnsayo(status: number, cuerpo: unknown): LecturaDeEnsayo {
  const { estado, error } = leerCuerpo(cuerpo);

  if (status === 200) {
    if (estado === "ensayado") return LECTURAS.ensayado;
    if (estado === "ya-publicado") return LECTURAS["ya-publicado"];
    // Un 200 con `publicado` —o con cualquier otra cosa— significa que el modo
    // dejó de ser `dry-run`: exactamente lo mismo que el 500, y por eso comparte
    // su lectura en vez de leerse como un éxito.
    return LECTURAS["defecto-del-servidor"];
  }

  if (status === 400) return LECTURAS["pedido-invalido"];
  if (status === 401) return LECTURAS["sin-sesion"];
  if (status === 404) return LECTURAS["asset-ausente"];
  if (status === 409) return LECTURAS["no-aprobado"];
  if (status === 429) return LECTURAS.demasiados;
  if (status === 502) {
    // `{ error: "asset unreadable" }` viene de `route.ts:86` y es el ÚNICO 502
    // del que se sabe que el ledger no se tocó. Por eso la certeza exige la
    // marca positiva: la primera versión leía cualquier 502 sin `motivo` como
    // "el ledger no se tocó", y un 502 de un proxy —o un cuerpo que no
    // parsea— caía ahí. Un escéptico lo midió: la incertidumbre mostrada como
    // certeza es la peor de las dos equivocaciones, porque manda a nadie a
    // mirar la base.
    return error === "asset unreadable" ? LECTURAS["asset-ilegible"] : LECTURAS["ledger-ilegible"];
  }

  // 500 y cualquier cosa que no esté medida. No se inventa un éxito.
  return LECTURAS["defecto-del-servidor"];
}

/**
 * Qué decir cuando no hay ningún asset aprobado.
 *
 * No es «todavía nada»: es el estado NORMAL hoy —al 2026-09-05 `content_assets`
 * en hosted está en 0, lo mide el encabezado de `ledgerView.ts`— y el ensayo se
 * dispara sobre un asset aprobado, así que sin aprobados no hay botón que pueda
 * funcionar. Un botón ahí sería una capacidad anunciada que no existe.
 */
export const SIN_APROBADOS = {
  quePaso: "Esta organización no tiene ningún contenido APROBADO, así que no hay nada que ensayar.",
  queHacer:
    "Se aprueba en /app/content: aprobar sella el texto tal como está, y ese sello es lo que la base exige para reservar.",
} as const;

/**
 * Lo que la pantalla tiene que decir del ensayo, y no es un detalle.
 *
 * `publicar()` inserta la fila con `service_role` ANTES de mirar el modo
 * (`transport.ts:171-181`; el corte por `dry-run` está en la 258). O sea: el
 * ensayo no llama a ninguna red, pero escribe. Y desde acá no hay cómo borrar
 * esa fila.
 */
export const EL_ENSAYO_ESCRIBE =
  "El ensayo NO publica nada en Google: llega hasta el borde y corta. Pero RESERVA una fila de verdad en el ledger, una por asset y destino, y desde esta pantalla no se puede borrar.";

/**
 * Si esta lectura es un ensayo que ocurrió.
 *
 * Vive acá y no en la pantalla porque decide DOS cosas —si se refresca el ledger
 * y si el texto se dibuja como resultado o como fallo—, y dos copias del
 * criterio divergen: un 200 con un estado que el `dry-run` no puede producir
 * tiene que refrescar tan poco como un 500.
 */
export function salioBien(clase: ClaseDeEnsayo): boolean {
  return clase === "ensayado" || clase === "ya-publicado";
}
