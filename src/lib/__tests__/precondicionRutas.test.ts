/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PRECONDICIÓN GLOBAL
 *
 * Que «las rutas están protegidas» se pueda afirmar leyendo el texto de los
 * archivos en vez de llamándolos.
 *
 * Un `grep` de `getUser` sobre `src/app/api` da dieciséis coincidencias y suena
 * a dieciséis rutas con sesión. Ocho de esas coincidencias son
 * `requireInternalSecret`, que NO mira quién llama: compara un secreto
 * compartido y es un no-op cuando la variable falta —
 * `src/lib/api/internal-guard.ts:14-15`, `if (!secret) return null`. El texto
 * dice «hay un guardia»; la llamada dice `200`. Este archivo llama.
 *
 * LAS TRES PROPIEDADES, Y POR QUÉ SON TRES Y NO UNA
 *
 * 1. EL INVENTARIO SE LEE DEL DISCO. `readdirSync` recursivo sobre
 *    `src/app/api`, no una lista escrita a mano. Una lista a mano envejece en
 *    silencio: la ruta nueva no aparece, el barrido sigue verde, y el verde
 *    dice «las que miré» cuando se lee como «todas».
 *
 * 2. UN LLAMADOR SIN SESIÓN RECIBE 401 O 403. NUNCA 500. Los dos extremos son
 *    el mismo defecto visto de cerca: un `200` es la puerta abierta, y un `500`
 *    significa que el handler pasó el guardia y se rompió después, o que
 *    revienta ANTES de decidir quién llama. En los dos casos el orden de las
 *    líneas está mal, y en los dos casos un anónimo llegó más lejos que la
 *    decisión de identidad.
 *
 * 3. EL ESPÍA DE FETCH QUEDA EN CERO. Sin sesión, ningún handler sale a la red.
 *    Una llamada saliente que un anónimo puede disparar es gasto — Places y
 *    PageSpeed cobran por request — y es superficie: el `key=` de PageSpeed
 *    viaja en la query string de esa llamada.
 *
 * POR QUÉ EL ARNÉS ESTÁ MONTADO ASÍ, Y NO DE LA MANERA CÓMODA
 *
 * `@/lib/supabase/server` está MOCKEADO, y ése es el diseño central. Si «sin
 * sesión» dependiera de una llamada de red a Supabase, el espía del punto 3
 * registraría esa llamada y no sabríamos si es una fuga o el propio chequeo de
 * sesión. Mockeado, cada URL que quede en el registro es una fuga real.
 *
 * Y el mock CONTESTA en vez de tirar. Un mock que tira parece más estricto y es
 * lo contrario: `apiError` (`src/lib/api/error.ts:8`) convierte cualquier throw
 * en un `400`, así que un handler que se cae en la primera consulta nunca llega
 * a la línea donde estaba la fuga. MEDIDO, cambiando `from()` por uno que tira:
 * `POST /api/reports/generate` pasa de `200` con TRES llamadas salientes a `400`
 * con UNA — las dos de PageSpeed desaparecen, porque
 * `src/lib/reports/orchestrator.ts:213` consulta `pagespeed_cache` antes de
 * llamar al proveedor y ahí se cae. Un mock más severo mide menos fuga. Por eso
 * `from()` devuelve una cadena encadenable que resuelve
 * `{ data: null, error: null }`: el handler sigue caminando hasta donde de
 * verdad llega.
 *
 * `@/lib/supabase/admin` NO está mockeado, a propósito. Es el cliente
 * `service_role`, sin RLS, y hoy no se alcanza sin firma ni sin sesión. Si un
 * día se alcanza, o tira —y sale `500`, punto 2— o sale a la red —y queda en el
 * espía, punto 3. Mockearlo sería taparlo.
 *
 * `next/headers` está mockeado porque `cookies()` fuera de un request scope
 * TIRA, y ese throw sería del arnés y no del código: sin el mock,
 * `src/app/api/auth/google/callback/route.ts:54` da `500` por cómo lo llamamos.
 * Un falso positivo gasta la misma confianza que un falso verde.
 *
 * LAS TRES VARIABLES DE ENTORNO QUE ESTE ARCHIVO FIJA, Y POR QUÉ
 *
 * Esto es lo que separa una medición de un cero vacuo:
 *
 *   - `INTERNAL_API_SECRET` se BORRA. MEDIDO con la variable puesta: SIETE de
 *     los ocho handlers abiertos pasan a `401`, y el status de siete rutas queda
 *     dependiendo del entorno de quien corre los tests en vez del código. La
 *     variable no está en `.env.example`, así que el estado por defecto del repo
 *     es ABIERTO, y eso es lo que hay que medir. (El octavo,
 *     `POST /api/reports/generate`, sigue en `200` con la variable puesta: no
 *     tiene guardia de ninguna clase, ni siquiera el secreto compartido.)
 *
 *   - `GOOGLE_PLACES_API_KEY` y `GOOGLE_PAGESPEED_API_KEY` se PONEN, con
 *     valores falsos. `vitest.config.ts` no carga ningún `.env`, así que sin
 *     esto los guardias de clave de `src/lib/integrations/google/places.ts:63`
 *     y `src/lib/integrations/google/pagespeed.ts:57` cortan antes del `fetch`
 *     y el espía mide cero. Ese cero sería ausencia de configuración, no un
 *     guardia — exactamente la clase de verde que este proyecto no se puede
 *     permitir. Con las claves puestas, la fuga aparece.
 *
 *   - `VULKAN_AGENCY_ORG_ID` se pone con un uuid válido. Sin ella,
 *     `src/lib/integrations/google/agencyGuard.ts:54-55` contesta
 *     `agency-unresolved` ANTES de mirar la sesión, y las dos rutas de OAuth
 *     darían `404` sin haber llegado nunca a preguntar quién llama. Medir eso
 *     sería medir la falta de una variable, no una decisión de identidad.
 *
 *   - `GROWTH_OS_WEBHOOK_SECRET` se pone para que el `401` del webhook venga de
 *     una firma que no verifica y no de `no-secret`
 *     (`src/lib/integrations/leadEngine/signature.ts:60`). Los dos son `401`;
 *     sólo uno prueba que la firma se compara.
 *
 * QUÉ TIENE QUE ESTAR ROTO PARA QUE ESTO DÉ ROJO
 *
 *   - que un handler conteste algo que no sea `401`/`403` sin sesión y no esté
 *     en `EXENCIONES` con su motivo escrito;
 *   - que un handler conteste `500`, o tire sin atrapar, sin sesión;
 *   - que quede UNA URL en el espía;
 *   - que el barrido deje de encontrar rutas, o que encuentre una ruta cuyo
 *     handler no se pueda invocar;
 *   - que una exención pierda del archivo el mecanismo que la justifica.
 *
 * QUÉ NO DICE
 *
 * No dice que las rutas que contestan `401` estén bien por dentro. Dice que
 * niegan antes de trabajar. Y no mide el camino CON sesión: que un usuario con
 * sesión no alcance los datos de otro es otra propiedad, y se mide en otra
 * unidad.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * El estado que los mocks necesitan poder ver y el test necesita poder cambiar.
 *
 * Va en `vi.hoisted` porque `vi.mock` se iza por encima de los `const` de este
 * archivo y una fábrica que cierre sobre una variable normal la lee como
 * `undefined`.
 */
const arnes = vi.hoisted(() => ({
  /** El tarro de cookies que ve `next/headers` en la llamada en curso. */
  cookies: new Map<string, string>(),
  /** Toda llamada saliente registrada, en orden. */
  salientes: [] as string[],
}));

/**
 * La identidad, mockeada — la pieza sobre la que se apoya todo lo demás.
 *
 * `getUser()` devuelve `null` sin tocar la red, y las consultas contestan la
 * fila vacía en vez de tirar. Ver el encabezado: un mock que tira mide ceros
 * que no son guardias.
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => clienteSinSesion(),
}));

vi.mock("next/headers", () => {
  const tarro = {
    get: (nombre: string) =>
      arnes.cookies.has(nombre) ? { name: nombre, value: arnes.cookies.get(nombre)! } : undefined,
    getAll: () => [...arnes.cookies].map(([name, value]) => ({ name, value })),
    has: (nombre: string) => arnes.cookies.has(nombre),
    set: () => {},
    delete: () => {},
  };
  return {
    cookies: async () => tarro,
    headers: async () => new Headers(),
  };
});

/** Una consulta de Supabase que se puede encadenar y que resuelve vacía. */
function consultaVacia(): unknown {
  const manejador: ProxyHandler<() => void> = {
    get(_objetivo, propiedad) {
      if (propiedad === "then") {
        return (ok: (v: unknown) => unknown, mal?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null, count: null, status: 200 }).then(ok, mal);
      }
      if (propiedad === "catch" || propiedad === "finally") {
        return () => consultaVacia();
      }
      return () => consultaVacia();
    },
    apply() {
      return consultaVacia();
    },
  };
  return new Proxy(function encadenable() {}, manejador);
}

/** El cliente que devuelve el mock: sin usuario, y sin tirar. */
function clienteSinSesion() {
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    from: () => consultaVacia(),
    rpc: () => consultaVacia(),
    storage: { from: () => consultaVacia() },
  };
}

const RAIZ = process.cwd();
const DIRECTORIO_API = path.join(RAIZ, "src", "app", "api");

/** Los verbos que Next reconoce como handler exportado de un `route.ts`. */
const VERBOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** El único origen del que se construyen los `Request`. */
const ORIGEN = "https://growth-os.test";

/** El `state` del OAuth: 64 caracteres, el largo que escribe la ruta de arranque. */
const ESTADO_OAUTH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

/**
 * CÓMO SE LLAMA A CADA RUTA.
 *
 * Una entrada por ruta del disco, y el test falla si el disco tiene una ruta
 * que no está acá o si acá hay una ruta que el disco ya no tiene. Esto NO es el
 * inventario —el inventario lo da `readdirSync`— es la forma del pedido: qué
 * cuerpo, qué query y qué cookies hacen falta para que el pedido LLEGUE a la
 * decisión de identidad.
 *
 * Y eso es lo que hace la diferencia entre medir y no medir. Diez de estos
 * handlers corren `zod` ANTES de mirar la sesión, así que un cuerpo vacío da
 * `400` y un barrido que sólo mandara `{}` informaría dieciséis `400` y ningún
 * hallazgo: el `400` de un esquema y el `401` de un guardia se parecen en que
 * los dos son «no», y no se parecen en nada más.
 */
const FORMA_DE_LLAMADA: Record<
  string,
  { cuerpo?: unknown; query?: Record<string, string>; cookies?: Record<string, string> }
> = {
  // `scopeId` es obligatorio (route.ts:9); sin él, `zod` contesta antes del guardia.
  "/api/agents/run-all": { cuerpo: { scope: "business", scopeId: "biz-morby" } },
  // `agentId` y `scopeId` obligatorios (route.ts:8-10).
  "/api/agents/run": { cuerpo: { agentId: "gbp-optimizer", scope: "business", scopeId: "biz-morby" } },
  // El `state` de la query y el de la cookie coinciden a propósito: sin eso, la
  // comparación de `route.ts:65` corta y el pedido nunca llega al guardia de
  // identidad de `:69`. Lo que se quiere medir es el guardia, no el CSRF.
  "/api/auth/google/callback": {
    query: { code: "4/codigo-de-prueba", state: ESTADO_OAUTH },
    cookies: { vulkan_google_oauth_state: ESTADO_OAUTH },
  },
  "/api/auth/google/start": {},
  // Un uuid válido, no `{}`: `schema.parse` corre en :63, antes del `getUser` de :68.
  "/api/content/approve": { cuerpo: { assetId: "11111111-1111-4111-8111-111111111111" } },
  "/api/content/generate": { cuerpo: { topic: "ansiktsbehandling i Stockholm" } },
  "/api/content": {
    cuerpo: {
      businessId: "22222222-2222-4222-8222-222222222222",
      kind: "gbp_post",
      body: "un cuerpo cualquiera",
      locale: "sv",
    },
  },
  // Un `businessId` que NO existe, y es deliberado: este handler no tiene
  // `try/catch` (route.ts:5-25), así que si `getBusinessSnapshot` tirara con un
  // id desconocido saldría un `500` crudo. Es el único lugar del inventario
  // donde un anónimo puede alcanzar un `500` por query string, y mandarle el
  // default sembrado sería no mirarlo.
  "/api/integrations/gbp/profile": { query: { businessId: "no-existe-este-negocio" } },
  "/api/integrations/images/generate": {
    cuerpo: {
      businessId: "biz-morby",
      platform: "gbp_post",
      aspectRatio: "1:1",
      visualStyle: "editorial",
      campaignGoal: "reservas",
      audience: "vecinos de Södermalm",
      language: "sv",
    },
  },
  "/api/integrations/places/search": { cuerpo: { query: "salon de belleza Stockholm" } },
  "/api/organizations/active": { cuerpo: { organizationId: "33333333-3333-4333-8333-333333333333" } },
  "/api/publishing/publish": { cuerpo: { assetId: "44444444-4444-4444-8444-444444444444" } },
  "/api/publishing/rehearse": { cuerpo: { assetId: "55555555-5555-4555-8555-555555555555" } },
  // El cuerpo es opcional (los dos campos son `.optional()`, route.ts:52-62) y
  // `businessId` cae al primer negocio sembrado. Se manda `{}` explícito porque
  // `route.ts:77` mira `req.body`: sin cuerpo, ni siquiera parsea.
  "/api/reports/generate": { cuerpo: {} },
  "/api/seo/audit": { cuerpo: {} },
  // Sin header `x-vulkan-signature`: es el pedido de un desconocido, que es el
  // caso que la firma existe para rechazar.
  "/api/webhooks/lead-won": { cuerpo: { event: "lead.won" } },
};

/**
 * LAS RUTAS QUE NO CONTESTAN 401/403, CON EL MOTIVO ESCRITO.
 *
 * Una entrada acá es una decisión, no un trámite, y por eso pide cuatro cosas:
 * por qué su respuesta no es un `401`, qué mecanismo reemplaza a la sesión, las
 * HUELLAS de ese mecanismo en el archivo, y el status que SÍ se espera.
 *
 * Las huellas son la parte que impide que esto sea una lista de permisos. Si
 * mañana alguien borra la comparación de firma del webhook, la ruta sigue
 * exenta por su motivo escrito y este archivo seguiría verde — salvo por las
 * huellas, que ya no están en el archivo y hacen fallar la exención. Una
 * exención tiene que caducar cuando caduca su razón.
 */
const EXENCIONES: Array<{
  ruta: string;
  publicaAProposito: boolean;
  porque: string;
  mecanismo: string;
  huellas: string[];
  statusEsperado: number[];
}> = [
  {
    ruta: "/api/webhooks/lead-won",
    publicaAProposito: true,
    porque:
      "Es un webhook de un tercero: el Lead Engine no tiene sesión de navegador. Igual contesta " +
      "401, así que cumple la propiedad 2 — está acá porque su identidad no es una sesión y eso " +
      "hay que declararlo, no porque haga falta perdonarle el status.",
    mecanismo:
      "HMAC-SHA256 del cuerpo CRUDO con GROWTH_OS_WEBHOOK_SECRET, header x-vulkan-signature, " +
      "comparado en tiempo constante (src/lib/integrations/leadEngine/signature.ts:54-78). Falla " +
      "cerrado: sin secreto de este lado devuelve no-secret y la ruta contesta 401 igual.",
    huellas: ["verifySignature(", "x-vulkan-signature"],
    statusEsperado: [401],
  },
  {
    ruta: "/api/auth/google/callback",
    publicaAProposito: true,
    porque:
      "Es la vuelta de un consentimiento en el NAVEGADOR de un operador. Un 401 crudo no es " +
      "accionable para quien lo recibe: lo que corresponde es mandarlo al login. El 307 es la " +
      "negación, escrita en la forma que el medio entiende.",
    mecanismo:
      "Doble. (a) state sorteado contra cookie httpOnly comparada en tiempo constante " +
      "(route.ts:65 y :109-112), borrada siempre en :59 para que valga una sola vez; (b) ADEMÁS " +
      "membresía de agencia en :69, porque la cookie prueba que este navegador arrancó el flujo, " +
      "no que la sesión siga siendo la misma.",
    huellas: ["estadoCoincide(esperado", "esOperadorDeLaAgencia()"],
    statusEsperado: [307],
  },
  {
    ruta: "/api/auth/google/start",
    publicaAProposito: false,
    porque:
      "No es pública: exige membresía de la organización de la agencia, y es la PRIMERA línea del " +
      "handler (route.ts:36), antes de cualquier trabajo. Está exenta del status porque su " +
      "negación es un 307 al login, por el mismo argumento de navegador que el callback — y para " +
      "quien tiene sesión y no es de la agencia contesta 404 deliberado (route.ts:38-45): quien " +
      "no es de la agencia no se entera de que la ruta existe.",
    mecanismo:
      "esOperadorDeLaAgencia() en la primera línea -> getUser + consulta de org_members como el " +
      "usuario (src/lib/integrations/google/agencyGuard.ts:51-72).",
    huellas: ["esOperadorDeLaAgencia()"],
    statusEsperado: [307],
  },
];

/**
 * Handlers que este arnés no puede invocar, con el motivo.
 *
 * Vacía a propósito. Un handler que no se puede llamar se REPORTA — el test
 * falla si esta lista crece — porque «no lo pude llamar» y «lo llamé y estuvo
 * bien» son cosas distintas, y excluirlo en silencio las hace indistinguibles.
 */
const NO_INVOCABLES: Array<{ ruta: string; verbo: string; porque: string }> = [];

/** Todo `route.ts` bajo `src/app/api`, leído del disco. */
function rutasEnDisco(directorio: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    const completo = path.join(directorio, entrada);
    if (statSync(completo).isDirectory()) salida.push(...rutasEnDisco(completo));
    else if (entrada === "route.ts" || entrada === "route.tsx") salida.push(completo);
  }
  return salida;
}

/** `/Users/.../src/app/api/agents/run/route.ts` -> `/api/agents/run`. */
function rutaUrl(archivo: string): string {
  const rel = path.relative(path.join(RAIZ, "src", "app"), archivo).replace(/\\/g, "/");
  return "/" + rel.replace(/\/route\.tsx?$/, "");
}

interface Medicion {
  ruta: string;
  archivo: string;
  verbo: string;
  /** El status que devolvió la respuesta, o null si el handler tiró. */
  status: number | null;
  /** El mensaje del throw sin atrapar. En Next, esto es un 500. */
  tiro: string | null;
  /** Las URLs que el handler intentó llamar, en orden. */
  fetchSalientes: string[];
}

const archivos = rutasEnDisco(DIRECTORIO_API).sort();
const mediciones: Medicion[] = [];
/** Rutas cuyo módulo no exporta ningún verbo reconocible. */
const sinHandlers: string[] = [];
let handlersDescubiertos = 0;

const fetchOriginal = globalThis.fetch;

beforeAll(async () => {
  // Ver el encabezado: estas cuatro líneas son la diferencia entre una medición
  // y un cero vacuo.
  delete process.env.INTERNAL_API_SECRET;
  process.env.GOOGLE_PLACES_API_KEY = "clave-falsa-de-places-para-el-espia";
  process.env.GOOGLE_PAGESPEED_API_KEY = "clave-falsa-de-pagespeed-para-el-espia";
  process.env.VULKAN_AGENCY_ORG_ID = "99999999-9999-4999-8999-999999999999";
  process.env.GROWTH_OS_WEBHOOK_SECRET = "secreto-falso-para-que-la-firma-se-compare";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto-inexistente.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-falsa";

  // El espía. REGISTRA y RECHAZA: registrar sin rechazar deja salir la llamada,
  // y una suite que llama de verdad a PageSpeed gasta plata cada vez que corre.
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof entrada === "string"
        ? entrada
        : entrada instanceof URL
          ? entrada.toString()
          : (entrada as Request).url;
    const metodo = init?.method ?? (entrada as Request)?.method ?? "GET";
    arnes.salientes.push(`${metodo} ${url}`);
    return Promise.reject(
      new Error(`[espia] llamada saliente sin sesion, rechazada: ${metodo} ${url}`)
    );
  }) as typeof fetch;

  for (const archivo of archivos) {
    const ruta = rutaUrl(archivo);
    const forma = FORMA_DE_LLAMADA[ruta] ?? {};
    const modulo: Record<string, unknown> = await import(pathToFileURL(archivo).href);
    const verbos = VERBOS.filter((v) => typeof modulo[v] === "function");

    if (verbos.length === 0) {
      sinHandlers.push(ruta);
      continue;
    }

    for (const verbo of verbos) {
      handlersDescubiertos++;
      if (NO_INVOCABLES.some((n) => n.ruta === ruta && n.verbo === verbo)) continue;

      arnes.cookies.clear();
      for (const [nombre, valor] of Object.entries(forma.cookies ?? {})) {
        arnes.cookies.set(nombre, valor);
      }
      arnes.salientes.length = 0;

      const url = new URL(ORIGEN + ruta);
      for (const [clave, valor] of Object.entries(forma.query ?? {})) {
        url.searchParams.set(clave, valor);
      }

      const llevaCuerpo = verbo !== "GET" && verbo !== "HEAD" && forma.cuerpo !== undefined;
      const pedido = new Request(url.toString(), {
        method: verbo,
        headers: llevaCuerpo ? { "content-type": "application/json" } : {},
        body: llevaCuerpo ? JSON.stringify(forma.cuerpo) : undefined,
      });

      const handler = modulo[verbo] as (req: Request, ctx: { params: Promise<object> }) => unknown;
      let status: number | null = null;
      let tiro: string | null = null;
      try {
        // El segundo argumento va siempre: ninguna ruta de este inventario tiene
        // segmento dinámico —lo afirma un test de abajo— y pasarlo igual hace que
        // el día que aparezca uno, el handler reciba la forma que Next le da.
        const respuesta = await handler(pedido, { params: Promise.resolve({}) });
        status = (respuesta as Response)?.status ?? null;
        if (status === null) {
          tiro = `el handler no devolvió una Response (devolvió ${typeof respuesta})`;
        }
      } catch (error) {
        // Un throw sin atrapar dentro de un route handler es un 500 en Next. Se
        // registra como tal y no como «no se pudo llamar»: el handler se llamó y
        // reventó, que es justo el defecto que la propiedad 2 busca.
        tiro = error instanceof Error ? error.message : String(error);
      }

      mediciones.push({
        ruta,
        archivo: path.relative(RAIZ, archivo).replace(/\\/g, "/"),
        verbo,
        status,
        tiro,
        fetchSalientes: [...arnes.salientes],
      });
    }
  }
}, 120_000);

afterAll(() => {
  globalThis.fetch = fetchOriginal;
});

/** Lo medido, en una línea legible para el mensaje de una falla. */
function linea(m: Medicion): string {
  const estado = m.tiro ? `TIRÓ (${m.tiro})` : String(m.status);
  return `${m.verbo} ${m.ruta} -> ${estado}  [${m.archivo}]`;
}

describe("la precondición global se mide llamando, no leyendo", () => {
  describe("anti-vacuidad: el barrido tiene que haber mirado algo", () => {
    it("encuentra rutas en el disco", () => {
      expect(
        archivos.length,
        "El recorrido de src/app/api no encontró ningún route.ts. O el directorio se mudó, o " +
          "readdirSync dejó de ver los archivos. Sin esto, cada afirmación de abajo pasa sobre " +
          "una lista vacía e informa éxito sin haber llamado a nada."
      ).toBeGreaterThan(0);
    });

    it("la tabla de formas de llamada cubre exactamente el inventario del disco", () => {
      const enDisco = archivos.map(rutaUrl).sort();
      const enTabla = Object.keys(FORMA_DE_LLAMADA).sort();

      expect(
        enDisco.filter((r) => !enTabla.includes(r)),
        "Estas rutas existen en el disco y no tienen forma de llamada escrita. El disco gana: " +
          "hay que agregarlas a FORMA_DE_LLAMADA con el cuerpo que su firma pida, o el barrido " +
          "las llama con un pedido que muere en el esquema antes de llegar al guardia."
      ).toEqual([]);

      expect(
        enTabla.filter((r) => !enDisco.includes(r)),
        "Estas rutas están en FORMA_DE_LLAMADA y ya no están en el disco. Una forma de llamada " +
          "para una ruta que no existe no mide nada y esconde la siguiente."
      ).toEqual([]);
    });

    it("cada ruta exporta al menos un handler reconocible", () => {
      expect(
        sinHandlers,
        "Estos route.ts no exportan ningún verbo de los que Next reconoce. Un archivo no es un " +
          "handler: si esto no es un error, el archivo no debería estar bajo app/api."
      ).toEqual([]);
    });

    it("llama a todos los handlers que descubrió, con igualdad exacta", () => {
      expect(handlersDescubiertos).toBeGreaterThan(0);
      // La igualdad es el corazón del anti-vacuidad: si un handler se salta —una
      // excepción del arnés, una entrada silenciosa en NO_INVOCABLES— los dos
      // números se separan y esto falla, en vez de que el barrido informe verde
      // sobre los que sí pudo llamar.
      expect(
        mediciones.length,
        `Se descubrieron ${handlersDescubiertos} handlers y se llamaron ${mediciones.length}. ` +
          "Un handler descubierto y no llamado no está medido."
      ).toBe(handlersDescubiertos);
    });

    it("no hay handlers declarados no invocables", () => {
      expect(
        NO_INVOCABLES,
        "Un handler que este arnés no puede llamar es un hallazgo, no una excepción de trámite: " +
          "el barrido no sabe nada sobre él y el verde de este archivo no lo cubre."
      ).toEqual([]);
    });

    it("ninguna ruta tiene segmento dinámico sin params declarados", () => {
      // Si aparece una ruta con [id], el `{ params: Promise.resolve({}) }` de
      // arriba le entrega params vacíos y el handler se cae por el arnés, no por
      // el código. Que se note acá y no como un 500 fantasma.
      const dinamicas = archivos.map(rutaUrl).filter((r) => r.includes("["));
      expect(
        dinamicas,
        "Estas rutas tienen segmento dinámico y el arnés les pasa params vacíos. Hay que darles " +
          "los params que su firma pida antes de creerle a su status."
      ).toEqual([]);
    });
  });

  describe("propiedad 2: sin sesión, 401 o 403", () => {
    it("ningún handler contesta 500 ni tira sin atrapar", () => {
      const quinientos = mediciones
        .filter((m) => m.tiro !== null || m.status === 500)
        .map((m) => linea(m));

      expect(
        quinientos,
        "Un 500 sin sesión significa una de dos cosas, y las dos son el defecto: el handler pasó " +
          "el guardia y se rompió después, o revienta ANTES de decidir quién llama. No se arregla " +
          "ensanchando lo aceptado a {401,403,500}."
      ).toEqual([]);
    });

    it("todo handler no exento contesta 401 o 403", () => {
      const exentas = new Set(EXENCIONES.map((e) => e.ruta));
      const abiertos = mediciones
        .filter((m) => !exentas.has(m.ruta))
        .filter((m) => m.status !== 401 && m.status !== 403)
        .map((m) => linea(m));

      expect(
        abiertos,
        "Estos handlers atendieron a un llamador SIN SESIÓN con algo que no es una negación. Un " +
          "200 es la puerta abierta; un 400 de esquema es peor que un 401 porque se lee como una " +
          "negación y no lo es (el pedido murió en zod, el guardia nunca corrió). O contestan " +
          "401/403, o van a EXENCIONES con motivo, mecanismo, huellas y status esperado."
      ).toEqual([]);
    });

    it("cada exención contesta exactamente el status que declaró", () => {
      const desviadas = EXENCIONES.flatMap((e) =>
        mediciones
          .filter((m) => m.ruta === e.ruta && !e.statusEsperado.includes(m.status ?? -1))
          .map((m) => `${linea(m)} — declaraba ${e.statusEsperado.join("/")}`)
      );

      expect(
        desviadas,
        "Una exención sin status declarado sería un permiso para contestar cualquier cosa. Si el " +
          "status cambió, o el código cambió o la exención está vencida."
      ).toEqual([]);
    });

    it("cada exención sigue teniendo en el archivo el mecanismo que la justifica", () => {
      const perdidas: string[] = [];
      for (const e of EXENCIONES) {
        const archivo = archivos.find((a) => rutaUrl(a) === e.ruta);
        if (!archivo) {
          perdidas.push(`${e.ruta}: exenta y la ruta ya no existe en el disco`);
          continue;
        }
        const fuente = readFileSync(archivo, "utf8");
        for (const huella of e.huellas) {
          if (!fuente.includes(huella)) {
            perdidas.push(`${e.ruta}: perdió la huella \`${huella}\` de su mecanismo`);
          }
        }
      }

      expect(
        perdidas,
        "El mecanismo que reemplaza a la sesión desapareció del archivo, y la exención lo estaba " +
          "dando por hecho. Esto es lo que impide que EXENCIONES sea una lista de permisos: la " +
          "razón caduca con su mecanismo."
      ).toEqual([]);
    });

    it("no guarda exenciones para rutas que ya no existen", () => {
      const enDisco = new Set(archivos.map(rutaUrl));
      expect(
        EXENCIONES.filter((e) => !enDisco.has(e.ruta)).map((e) => e.ruta),
        "exenta a propósito pero ya no está en el disco"
      ).toEqual([]);
    });
  });

  describe("propiedad 3: el espía de fetch en cero", () => {
    it("ningún handler sale a la red sin sesión", () => {
      const fugas = mediciones
        .filter((m) => m.fetchSalientes.length > 0)
        .map((m) => `${m.verbo} ${m.ruta} [${m.archivo}] -> ${m.fetchSalientes.join(" | ")}`);

      expect(
        fugas,
        "Un llamador SIN SESIÓN disparó estas llamadas salientes. Eso es gasto que un anónimo " +
          "puede provocar —Places y PageSpeed cobran por request— y superficie: la clave de " +
          "PageSpeed viaja en la query string de su propia URL. El espía las rechazó, así que la " +
          "suite no gastó nada; en producción no hay espía."
      ).toEqual([]);
    });

    it("el espía registra Y rechaza", async () => {
      // Sin esto, el cero de arriba podría venir de un espía que nunca se
      // instaló: un cero medido por un instrumento apagado se lee igual que un
      // cero medido por un guardia. Se comprueba llamando.
      const antes = arnes.salientes.length;

      // Las dos mitades son necesarias y ninguna alcanza sola. Si sólo
      // registrara, la llamada SALDRÍA: la suite pagaría PageSpeed de verdad en
      // cada corrida y el hallazgo quedaría anotado después de haberse cobrado.
      // Si sólo rechazara, no habría nada que afirmar.
      await expect(globalThis.fetch("https://ejemplo-de-control.test/espia")).rejects.toThrow(
        "[espia]"
      );
      expect(arnes.salientes.length, "el espía no registró la llamada de control").toBe(antes + 1);
      expect(arnes.salientes[arnes.salientes.length - 1]).toContain("ejemplo-de-control.test");

      arnes.salientes.length = antes;
    });
  });

  describe("la medición, escrita", () => {
    it("deja el status y las salidas de cada handler en la salida de la corrida", () => {
      // No es una afirmación sobre el código: es el registro de lo que contestó
      // cada handler en ESTA corrida, para que los números de un informe se
      // puedan pegar a una línea de salida en vez de recordarse.
      const filas = mediciones.map((m) => `  ${linea(m)}  fetch=${m.fetchSalientes.length}`);
      console.log(
        `\n[precondición] ${mediciones.length} handlers llamados sin sesión:\n${filas.join("\n")}\n`
      );
      expect(filas.length).toBe(mediciones.length);
    });
  });
});
