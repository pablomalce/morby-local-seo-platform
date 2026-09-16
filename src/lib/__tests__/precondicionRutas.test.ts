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
import { createRequire } from "node:module";
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
  /**
   * Lo mismo, pero SIN vaciarse nunca entre handlers.
   *
   * Existe por una salida que el registro por handler no puede ver: un
   * refutador midió que una llamada diferida —un `setTimeout`, o un `void
   * async` sin `await`— se dispara DESPUÉS de que el handler contestó, o sea
   * después de la foto, y el barrido quedaba verde con la fuga saliendo de
   * verdad. Atribuirla a un handler exacto ya no siempre se puede; que exista
   * sí, y una fuga sin dueño sigue siendo una fuga.
   */
  todasLasSalientes: [] as string[],
  /**
   * Cuántas veces el handler en curso PREGUNTÓ quién llama.
   *
   * Es el control positivo, y existe porque un refutador midió lo siguiente en
   * el repositorio vecino: le borró el guardia de identidad a 58 handlers y 40
   * siguieron contestando 401/403. La negación venía de otra parte —de la RLS,
   * de un esquema, de una fila que no existe— y la propiedad titular del
   * archivo se satisfacía sin que el handler decidiera nada.
   *
   * Y en este repositorio midió el caso límite: en la ruta que publica EN VIVO
   * en la ficha de un cliente reemplazó `auth.getUser()` por confiar en un
   * header `x-user-id`, dejando intacto el `if (!user) 401`. El barrido quedó
   * VERDE: una autenticación falsa que cualquiera puede mandar pasaba por
   * negación legítima.
   *
   * Un status no distingue «negó porque decidió» de «negó de casualidad». Un
   * contador sí, porque cuenta en la unidad en la que la garantía falla: la
   * pregunta.
   */
  consultasIdentidad: 0,
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
      getUser: async () => {
        arnes.consultasIdentidad++;
        return { data: { user: null }, error: null };
      },
      getSession: async () => {
        arnes.consultasIdentidad++;
        return { data: { session: null }, error: null };
      },
      // El callback de magic link lo llama con el `code` de PKCE. Contesta un
      // error en vez de tirar por el mismo motivo que el resto del cliente: un
      // mock que tira mide ceros que no son guardias.
      exchangeCodeForSession: async () => ({
        data: { session: null, user: null },
        error: { message: "codigo invalido en el arnes" },
      }),
    },
    from: () => consultaVacia(),
    rpc: () => consultaVacia(),
    storage: { from: () => consultaVacia() },
  };
}

const RAIZ = process.cwd();

/**
 * TODO el árbol de rutas, no sólo `api`.
 *
 * QUÉ AGUJERO CIERRA, MEDIDO
 *
 * Este barrido apuntaba a `src/app/api`, y un agente escéptico lo refutó con un
 * comando: `find src/app -name 'route.ts' -not -path 'src/app/api/*'` devuelve
 * `src/app/auth/callback/route.ts`, un handler REAL que canjea un code de PKCE
 * por una sesión y que el barrido nunca ejercitaba. Plantó además una ruta
 * abierta fuera de `api` y la suite entera siguió verde.
 *
 * Un route handler de Next no es «un archivo de la carpeta api»: es cualquier
 * `route.<ext>` en cualquier parte del árbol de la aplicación. La unidad en la
 * que esta garantía puede fallar es la ruta que Next SERVIRÍA, así que el
 * alcance es el árbol entero.
 */
const DIRECTORIO_RUTAS = path.join(RAIZ, "src", "app");

/**
 * Las extensiones que Next acepta para un route handler.
 *
 * `pageExtensions` por defecto es `["tsx", "ts", "jsx", "js"]`
 * (node_modules/next/dist/server/config-shared.js), así que aceptar sólo
 * `route.ts` es más angosto que el framework: el refutador plantó un
 * `route.tsx` con un `GET` abierto y sin guardia, y el barrido no lo vio.
 *
 * La expresión ancla los dos extremos, y por eso `route.test.ts` y
 * `route.spec.ts` quedan afuera sin necesitar una lista de exclusiones: su
 * nombre base no es `route.<ext>`. Y hay un test más abajo que falla si
 * aparece en el disco un `route.<algo>` con una extensión que esta expresión
 * NO acepta — porque el defecto que se paga no es tener la lista corta, es no
 * enterarse.
 */
const ARCHIVO_DE_RUTA = /^route\.(tsx|ts|jsx|js)$/;

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
  // Sin `code`, que es el caso del que entra a mano a la URL. El caso CON code
  // —el mecanismo ejercitado del otro lado— tiene su propio test más abajo.
  "/auth/callback": {},
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
/**
 * QUÉ ES UNA HUELLA, DESPUÉS DE QUE TRES ATAQUES LA ATRAVESARAN
 *
 * Una huella es la prueba de que el mecanismo que una exención invoca SIGUE
 * SIENDO CÓDIGO QUE CORRE. Empezó siendo `fuente.includes(texto)` sobre el
 * `route.ts`, y un refutador la rompió tres veces distintas:
 *
 *  1. La palabra sobrevive en un COMENTARIO. Borró el mecanismo y dejó su
 *     nombre en la prosa que lo explicaba: verde. Es el mismo defecto que este
 *     proyecto ya pagó una vez —un comentario hizo sobrevivir la mutación de su
 *     propio arreglo— y por eso hay que tapar comentarios antes de buscar.
 *  2. La palabra sobrevive en la DECLARACIÓN de la función muerta. Borró el
 *     sitio de llamada del CSRF del `state` y la firma `estadoCoincide(esperado`
 *     siguió satisfaciendo la huella: verde, con el CSRF ya sin ejecutar.
 *  3. La palabra vive en OTRO ARCHIVO que el mecanismo. Vació
 *     `signature.ts` a `return { ok: true }` y la exención de `lead-won` siguió
 *     verde, porque sus huellas se buscaban en `route.ts`.
 *
 * De ahí las tres reglas: cada huella dice EN QUÉ ARCHIVO se busca, se busca
 * sobre el código con los comentarios tapados, y se busca en posición de
 * LLAMADA —los import y las declaraciones del propio símbolo se descartan—.
 * Lo que esto todavía no puede ver: que la función llamada haga lo que su
 * nombre promete. Eso no se lee, se ejercita, y para eso están los tests del
 * bloque «los mecanismos ejercitados de los dos lados».
 */
interface Huella {
  /** Relativo a la raíz del repositorio: el archivo donde vive el mecanismo. */
  archivo: string;
  /** El texto que tiene que aparecer en posición de llamada. */
  texto: string;
}

/** Tapa comentarios de bloque y de línea. Ver el comentario de `Huella`. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * El código de un archivo sin sus `import` ni las declaraciones del símbolo
 * buscado, para que la huella sólo pueda satisfacerse desde una LLAMADA.
 *
 * `simbolo` sale del propio texto de la huella: `auth.getUser(` -> `getUser`.
 */
function codigoQueLlama(fuente: string, texto: string): string {
  const simbolo = (texto.match(/([A-Za-z_$][\w$]*)\s*\(/) ?? [])[1];
  let codigo = sinComentarios(fuente).replace(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?/gm, " ");
  if (simbolo) {
    codigo = codigo.replace(
      new RegExp(
        `(?:export\\s+)?(?:async\\s+)?function\\s+${simbolo}\\s*\\(|(?:const|let|var)\\s+${simbolo}\\s*=`,
        "g"
      ),
      " "
    );
  }
  return codigo;
}

const EXENCIONES: Array<{
  ruta: string;
  publicaAProposito: boolean;
  porque: string;
  mecanismo: string;
  huellas: Huella[];
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
    huellas: [
      { archivo: "src/app/api/webhooks/lead-won/route.ts", texto: "verifySignature(" },
      { archivo: "src/app/api/webhooks/lead-won/route.ts", texto: "x-vulkan-signature" },
      // El mecanismo NO vive en el route.ts, y ahí estaba el agujero: vaciar
      // este archivo a `return { ok: true }` dejaba la exención verde.
      { archivo: "src/lib/integrations/leadEngine/signature.ts", texto: "createHmac(" },
      { archivo: "src/lib/integrations/leadEngine/signature.ts", texto: "timingSafeEqual(" },
    ],
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
    huellas: [
      { archivo: "src/app/api/auth/google/callback/route.ts", texto: "estadoCoincide(esperado" },
      { archivo: "src/app/api/auth/google/callback/route.ts", texto: "esOperadorDeLaAgencia()" },
      { archivo: "src/lib/integrations/google/agencyGuard.ts", texto: "auth.getUser(" },
    ],
    statusEsperado: [307],
  },
  {
    ruta: "/auth/callback",
    publicaAProposito: true,
    porque:
      "Es el aterrizaje del magic link: lo abre un NAVEGADOR que todavía no tiene sesión, así " +
      "que exigirle una sería exigirle lo que viene a conseguir. Su negación es un 307 a " +
      "/login?error=missing_code, que es la forma que el medio entiende. Entró al barrido el " +
      "2026-09-10, cuando el alcance dejó de ser `src/app/api` y pasó a ser el árbol: hasta ese " +
      "día era un handler real que nadie ejercitaba.",
    mecanismo:
      "El `code` de PKCE, canjeado por Supabase en exchangeCodeForSession (route.ts:16). Quien " +
      "no trae code no pasa; quien trae uno inválido tampoco, y el error vuelve en la query del " +
      "login. La validación es del proveedor, no de esta ruta, y eso es exactamente lo que " +
      "reemplaza a la sesión acá.",
    huellas: [
      { archivo: "src/app/auth/callback/route.ts", texto: "auth.exchangeCodeForSession(code)" },
    ],
    statusEsperado: [307],
  },
  {
    ruta: "/api/seo/audit",
    publicaAProposito: false,
    porque:
      "Ruta interna, servidor a servidor: su identidad no es una sesión de navegador sino un " +
      "secreto compartido en el header x-internal-secret. Contesta 401, así que cumple la " +
      "propiedad 2; está acá porque niega SIN preguntar quién llama —0 consultas de identidad— " +
      "y el control positivo lo exige declarado. Hasta el 2026-09-10 estaba en ABIERTAS_HOY: el " +
      "guardia era opt-in y sin la variable dejaba pasar a cualquiera.",
    mecanismo:
      "requireInternalSecret(req) en src/app/api/seo/audit/route.ts:5, que falla CERRADO: sin " +
      "INTERNAL_API_SECRET configurado contesta 401 a todos (src/lib/api/internal-guard.ts). " +
      "Nadie en la aplicación la llama hoy — medido: ningún fetch, ningún cron, nadie manda el " +
      "header.",
    huellas: [
      { archivo: "src/app/api/seo/audit/route.ts", texto: "requireInternalSecret(req)" },
      { archivo: "src/lib/api/internal-guard.ts", texto: "if (!secret)" },
    ],
    statusEsperado: [401],
  },
  {
    ruta: "/api/agents/run-all",
    publicaAProposito: false,
    porque:
      "Ruta interna, servidor a servidor: su identidad no es una sesión de navegador sino un " +
      "secreto compartido en el header x-internal-secret. Contesta 401, así que cumple la " +
      "propiedad 2; está acá porque niega SIN preguntar quién llama —0 consultas de identidad— " +
      "y el control positivo lo exige declarado. Hasta el 2026-09-10 estaba en ABIERTAS_HOY: el " +
      "guardia era opt-in y sin la variable dejaba pasar a cualquiera.",
    mecanismo:
      "requireInternalSecret(req) en src/app/api/agents/run-all/route.ts:13, que falla CERRADO: sin " +
      "INTERNAL_API_SECRET configurado contesta 401 a todos (src/lib/api/internal-guard.ts). " +
      "Nadie en la aplicación la llama hoy — medido: ningún fetch, ningún cron, nadie manda el " +
      "header.",
    huellas: [
      { archivo: "src/app/api/agents/run-all/route.ts", texto: "requireInternalSecret(req)" },
      { archivo: "src/lib/api/internal-guard.ts", texto: "if (!secret)" },
    ],
    statusEsperado: [401],
  },
  {
    ruta: "/api/agents/run",
    publicaAProposito: false,
    porque:
      "Ruta interna, servidor a servidor: su identidad no es una sesión de navegador sino un " +
      "secreto compartido en el header x-internal-secret. Contesta 401, así que cumple la " +
      "propiedad 2; está acá porque niega SIN preguntar quién llama —0 consultas de identidad— " +
      "y el control positivo lo exige declarado. Hasta el 2026-09-10 estaba en ABIERTAS_HOY: el " +
      "guardia era opt-in y sin la variable dejaba pasar a cualquiera.",
    mecanismo:
      "requireInternalSecret(req) en src/app/api/agents/run/route.ts:15, que falla CERRADO: sin " +
      "INTERNAL_API_SECRET configurado contesta 401 a todos (src/lib/api/internal-guard.ts). " +
      "Nadie en la aplicación la llama hoy — medido: ningún fetch, ningún cron, nadie manda el " +
      "header.",
    huellas: [
      { archivo: "src/app/api/agents/run/route.ts", texto: "requireInternalSecret(req)" },
      { archivo: "src/lib/api/internal-guard.ts", texto: "if (!secret)" },
    ],
    statusEsperado: [401],
  },
  {
    ruta: "/api/content/generate",
    publicaAProposito: false,
    porque:
      "Ruta interna, servidor a servidor: su identidad no es una sesión de navegador sino un " +
      "secreto compartido en el header x-internal-secret. Contesta 401, así que cumple la " +
      "propiedad 2; está acá porque niega SIN preguntar quién llama —0 consultas de identidad— " +
      "y el control positivo lo exige declarado. Hasta el 2026-09-10 estaba en ABIERTAS_HOY: el " +
      "guardia era opt-in y sin la variable dejaba pasar a cualquiera.",
    mecanismo:
      "requireInternalSecret(req) en src/app/api/content/generate/route.ts:15, que falla CERRADO: sin " +
      "INTERNAL_API_SECRET configurado contesta 401 a todos (src/lib/api/internal-guard.ts). " +
      "Nadie en la aplicación la llama hoy — medido: ningún fetch, ningún cron, nadie manda el " +
      "header.",
    huellas: [
      { archivo: "src/app/api/content/generate/route.ts", texto: "requireInternalSecret(req)" },
      { archivo: "src/lib/api/internal-guard.ts", texto: "if (!secret)" },
    ],
    statusEsperado: [401],
  },
  {
    ruta: "/api/integrations/gbp/profile",
    publicaAProposito: false,
    porque:
      "Ruta interna, servidor a servidor: su identidad no es una sesión de navegador sino un " +
      "secreto compartido en el header x-internal-secret. Contesta 401, así que cumple la " +
      "propiedad 2; está acá porque niega SIN preguntar quién llama —0 consultas de identidad— " +
      "y el control positivo lo exige declarado. Hasta el 2026-09-10 estaba en ABIERTAS_HOY: el " +
      "guardia era opt-in y sin la variable dejaba pasar a cualquiera.",
    mecanismo:
      "requireInternalSecret(req) en src/app/api/integrations/gbp/profile/route.ts:6, que falla CERRADO: sin " +
      "INTERNAL_API_SECRET configurado contesta 401 a todos (src/lib/api/internal-guard.ts). " +
      "Nadie en la aplicación la llama hoy — medido: ningún fetch, ningún cron, nadie manda el " +
      "header.",
    huellas: [
      { archivo: "src/app/api/integrations/gbp/profile/route.ts", texto: "requireInternalSecret(req)" },
      { archivo: "src/lib/api/internal-guard.ts", texto: "if (!secret)" },
    ],
    statusEsperado: [401],
  },
  {
    ruta: "/api/integrations/images/generate",
    publicaAProposito: false,
    porque:
      "Ruta interna, servidor a servidor: su identidad no es una sesión de navegador sino un " +
      "secreto compartido en el header x-internal-secret. Contesta 401, así que cumple la " +
      "propiedad 2; está acá porque niega SIN preguntar quién llama —0 consultas de identidad— " +
      "y el control positivo lo exige declarado. Hasta el 2026-09-10 estaba en ABIERTAS_HOY: el " +
      "guardia era opt-in y sin la variable dejaba pasar a cualquiera.",
    mecanismo:
      "requireInternalSecret(req) en src/app/api/integrations/images/generate/route.ts:34, que falla CERRADO: sin " +
      "INTERNAL_API_SECRET configurado contesta 401 a todos (src/lib/api/internal-guard.ts). " +
      "Nadie en la aplicación la llama hoy — medido: ningún fetch, ningún cron, nadie manda el " +
      "header.",
    huellas: [
      { archivo: "src/app/api/integrations/images/generate/route.ts", texto: "requireInternalSecret(req)" },
      { archivo: "src/lib/api/internal-guard.ts", texto: "if (!secret)" },
    ],
    statusEsperado: [401],
  },
  {
    ruta: "/api/integrations/places/search",
    publicaAProposito: false,
    porque:
      "Ruta interna, servidor a servidor: su identidad no es una sesión de navegador sino un " +
      "secreto compartido en el header x-internal-secret. Contesta 401, así que cumple la " +
      "propiedad 2; está acá porque niega SIN preguntar quién llama —0 consultas de identidad— " +
      "y el control positivo lo exige declarado. Hasta el 2026-09-10 estaba en ABIERTAS_HOY: el " +
      "guardia era opt-in y sin la variable dejaba pasar a cualquiera.",
    mecanismo:
      "requireInternalSecret(req) en src/app/api/integrations/places/search/route.ts:13, que falla CERRADO: sin " +
      "INTERNAL_API_SECRET configurado contesta 401 a todos (src/lib/api/internal-guard.ts). " +
      "Nadie en la aplicación la llama hoy — medido: ningún fetch, ningún cron, nadie manda el " +
      "header.",
    huellas: [
      { archivo: "src/app/api/integrations/places/search/route.ts", texto: "requireInternalSecret(req)" },
      { archivo: "src/lib/api/internal-guard.ts", texto: "if (!secret)" },
    ],
    statusEsperado: [401],
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
    huellas: [
      { archivo: "src/app/api/auth/google/start/route.ts", texto: "esOperadorDeLaAgencia()" },
      { archivo: "src/lib/integrations/google/agencyGuard.ts", texto: "auth.getUser(" },
    ],
    statusEsperado: [307],
  },
];

/**
 * Lo que hoy está abierto, escrito con nombre y apellido, y con trinquete.
 *
 * QUÉ AGUJERO CIERRA ESTA LISTA, Y POR QUÉ EXISTE EN VEZ DE UN TEST ROJO
 *
 * Medido por mutación el 2026-09-10, y es la razón por la que esta lista se
 * escribió. La primera versión de este archivo dejaba las dos aserciones de
 * abajo en rojo, con los ocho handlers y la fuga dentro del mensaje de falla.
 * Se borró entonces, a propósito, la comprobación de sesión de
 * `POST /api/publishing/publish` —la ruta que escribe EN VIVO en la ficha de
 * Google Business Profile de un cliente— y el resumen de la corrida fue
 * `Tests 2 failed | 12 passed (14)` antes, con la mutación aplicada y después de
 * restaurarla. Idéntico las tres veces. Un gate de CI mira el código de salida,
 * y el código de salida era 1 en los tres estados: la detección vivía sólo en el
 * CONTENIDO de una lista dentro de un mensaje que alguien tenía que leer.
 *
 * Un archivo permanentemente rojo no es una reja: es un cartel. Con el
 * trinquete, el rojo vuelve a significar algo — que ALGO CAMBIÓ desde la
 * medición— y la mutación de arriba pasa de invisible a roja.
 *
 * POR QUÉ NO ES UNA ABSOLUCIÓN
 *
 * Es el mismo criterio que `HANDLERS_CON_SERVICE_ROLE` en el Lead Engine, y por
 * el mismo motivo: la igualdad es EXACTA en las dos direcciones. Un handler que
 * se abre y no está acá pone el test rojo. Y un handler que se CIERRA y sigue
 * acá TAMBIÉN lo pone rojo, así que arreglar una ruta obliga a venir hasta esta
 * lista y borrar su línea. La lista no puede envejecer hacia arriba ni hacia
 * abajo sin que alguien la edite a propósito, y este comentario es lo que va a
 * leer cuando lo haga.
 *
 * BAJARLA ES EL TRABAJO, Y YA BAJÓ DE OCHO A UNA. El 2026-09-10 eran ocho.
 * Siete se cerraron con una sola línea: `requireInternalSecret`
 * (src/lib/api/internal-guard.ts) contestaba `null` —o sea «pasá»— cuando
 * `INTERNAL_API_SECRET` no estaba en el entorno, y esa variable no figuraba en
 * `.env.example`; ahora falla cerrado, y las siete viven en `EXENCIONES` como
 * lo que son: rutas cuya identidad no es una sesión sino un secreto compartido,
 * igual que el webhook de lead-won. Este trinquete exigió el borrado de las
 * siete entradas cuando cambió el guardia — que es exactamente para lo que
 * existe la igualdad en las dos direcciones.
 *
 * La que queda, `/api/reports/generate`, no tiene guardia de ninguna clase y
 * es la que además gasta. La llama `src/app/reports/page.tsx`, una página de
 * cliente fuera de `/app` y por lo tanto fuera del middleware: cerrarla es una
 * decisión de producto, no una línea.
 */
const ABIERTAS_HOY: Array<{
  ruta: string;
  verbo: string;
  statusMedido: number;
  porque: string;
  queLaCierra: string;
  /**
   * La huella del mecanismo que el motivo invoca, o `null` cuando el motivo es
   * que NO HAY mecanismo.
   *
   * Un refutador midió por qué hace falta: borró entero el import y la llamada
   * de `requireInternalSecret` de /api/seo/audit y el barrido quedó verde
   * 16/16, con esta lista todavía diciendo «requireInternalSecret es un no-op
   * sin la variable». La prosa pasó a mentir y nada la contradecía. Una entrada
   * cuyo motivo nombra un mecanismo tiene que caducar con él, igual que una
   * exención.
   *
   * `null` no es un descuido: /api/reports/generate está abierta porque no
   * llama a nadie, y a la ausencia no se le puede tomar la huella. A esa se le
   * comprueba lo medido —cero consultas de identidad— en su propio test.
   */
  huella: Huella | null;
}> = [
  {
    ruta: "/api/reports/generate",
    verbo: "POST",
    statusMedido: 200,
    porque:
      "No hay NINGUNA línea de identidad en el handler (route.ts:70-89): sólo rateLimit y zod. " +
      "El getUser() de src/lib/reports/orchestrator.ts:70-73 no decide permiso, decide FUENTE de " +
      "datos, y sin sesión cae a la rama sembrada. Su propio comentario admite que es pública y " +
      "que dispara llamadas facturables.",
    queLaCierra:
      "Un guardia propio antes del trabajo. Es la única de las ocho que sigue en 200 incluso con " +
      "INTERNAL_API_SECRET puesta, y la única que además sale a la red: va primera.",
    huella: null,
  },
];

/**
 * La única fuga de red medida sin sesión, con trinquete por destino.
 *
 * Se compara por PREFIJO de la URL —host y path, sin la query— porque la clave
 * de PageSpeed viaja en la query string y no tiene por qué entrar en un archivo
 * de tests. El prefijo alcanza para lo que la lista tiene que impedir: que
 * aparezca un destino nuevo, o que aparezca un segundo handler que salga a la
 * red sin sesión.
 */
const FUGAS_HOY: Array<{ ruta: string; verbo: string; destinos: string[] }> = [
  {
    ruta: "/api/reports/generate",
    verbo: "POST",
    destinos: [
      "POST https://places.googleapis.com/v1/places:searchText",
      "GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
      "GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
    ],
  },
];

/** La clave con la que un handler medido se busca en las listas de arriba. */
function clave(m: Medicion): string {
  return `${m.verbo} ${m.ruta}`;
}

/**
 * El host que usa el test que comprueba el espía a sí mismo.
 *
 * Tiene que estar excluido de la bitácora global, y descubrirlo fue el propio
 * `afterAll` haciendo su trabajo: la primera versión de la red falló nombrando
 * `ejemplo-de-control.test`, o sea la llamada que el test de control dispara a
 * propósito. Sin la exclusión, la red se disparaba por su propio control, y la
 * aserción de dentro de la corrida pasaba sólo porque el control corría después
 * — un orden de tests decidiendo un resultado, que es otra forma de no medir.
 */
const HOST_DE_CONTROL = "ejemplo-de-control.test";

/** La bitácora global sin las llamadas que el test de control hace a propósito. */
function fugasReales(): string[] {
  return arnes.todasLasSalientes.filter((s) => !s.includes(HOST_DE_CONTROL));
}

/** Host y path de una salida registrada, sin la query. */
function destinoDe(salida: string): string {
  const [verbo, url] = salida.split(" ");
  return `${verbo} ${(url ?? "").split("?")[0]}`;
}

/**
 * Handlers que este arnés no puede invocar, con el motivo.
 *
 * Vacía a propósito. Un handler que no se puede llamar se REPORTA — el test
 * falla si esta lista crece — porque «no lo pude llamar» y «lo llamé y estuvo
 * bien» son cosas distintas, y excluirlo en silencio las hace indistinguibles.
 */
const NO_INVOCABLES: Array<{ ruta: string; verbo: string; porque: string }> = [];

/** Todo `route.<ext>` bajo `src/app`, leído del disco. */
function rutasEnDisco(directorio: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    const completo = path.join(directorio, entrada);
    if (statSync(completo).isDirectory()) salida.push(...rutasEnDisco(completo));
    else if (ARCHIVO_DE_RUTA.test(entrada)) salida.push(completo);
  }
  return salida;
}

/**
 * Todo archivo que se LLAME `route.algo`, aceptado o no.
 *
 * Sirve para una sola cosa, y es la que faltaba: que el día que alguien escriba
 * `route.mjs` —o cualquier extensión que `ARCHIVO_DE_RUTA` no contemple— el
 * barrido FALLE en vez de ignorarlo en silencio. El agujero no era la lista
 * corta; era que una lista corta se lee igual que un barrido completo.
 */
function nombradosRuta(directorio: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    const completo = path.join(directorio, entrada);
    if (statSync(completo).isDirectory()) salida.push(...nombradosRuta(completo));
    else if (/^route\.[^.]+$/.test(entrada)) salida.push(completo);
  }
  return salida;
}

/** `/Users/.../src/app/api/agents/run/route.ts` -> `/api/agents/run`. */
function rutaUrl(archivo: string): string {
  const rel = path.relative(path.join(RAIZ, "src", "app"), archivo).replace(/\\/g, "/");
  return "/" + rel.replace(/\/route\.(tsx|ts|jsx|js)$/, "");
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
  /** Cuántas veces preguntó quién llama antes de contestar. */
  consultasIdentidad: number;
}

const archivos = rutasEnDisco(DIRECTORIO_RUTAS).sort();
const mediciones: Medicion[] = [];
/** Rutas cuyo módulo no exporta ningún verbo reconocible. */
const sinHandlers: string[] = [];
let handlersDescubiertos = 0;

const fetchOriginal = globalThis.fetch;
const requerir = createRequire(import.meta.url);
const nativosOriginales: Array<{
  nativo: Record<string, unknown>;
  metodo: string;
  original: unknown;
}> = [];

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
    arnes.todasLasSalientes.push(`${metodo} ${url}`);
    return Promise.reject(
      new Error(`[espia] llamada saliente sin sesion, rechazada: ${metodo} ${url}`)
    );
  }) as typeof fetch;

  // Y los transportes que NO pasan por `fetch`.
  //
  // El espía instrumentaba sólo `globalThis.fetch`, y un refutador lo midió con
  // un servidor local: una petición hecha con `node:https`.request salió de
  // verdad y el registro quedó en cero, o sea que el barrido informaba «cero
  // llamadas» sobre una llamada que había salido. Hoy `grep` sobre `src` no
  // encuentra ningún uso de estos módulos ni de axios —hay un trinquete más
  // abajo que falla si aparece uno—, así que esto no cambia ninguna medición:
  // cubre el día en que alguien agregue un cliente que no use fetch, que es
  // justo el día en que nadie se acordaría de venir a extender el espía.
  for (const modulo of ["node:http", "node:https"]) {
    const nativo = requerir(modulo) as Record<string, unknown>;
    for (const metodo of ["request", "get"]) {
      const original = nativo[metodo];
      nativosOriginales.push({ nativo, metodo, original });
      nativo[metodo] = (...args: unknown[]) => {
        const primero = args[0];
        const donde =
          typeof primero === "string"
            ? primero
            : primero instanceof URL
              ? primero.toString()
              : JSON.stringify(primero);
        const registro = `${modulo}.${metodo} ${donde}`;
        arnes.salientes.push(registro);
        arnes.todasLasSalientes.push(registro);
        throw new Error(`[espia] llamada saliente sin sesion, rechazada: ${registro}`);
      };
    }
  }

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
      arnes.consultasIdentidad = 0;

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

      // Cerrar la ventana. El handler ya contestó, pero una llamada diferida
      // por `setTimeout(..., 0)` o por un `void async` sin `await` todavía no
      // salió: sin este drenaje la foto se saca antes de la fuga y el barrido
      // informa cero. Medido por un refutador, verde, con la llamada
      // disparándose de verdad.
      await new Promise((listo) => setTimeout(listo, 0));
      await new Promise((listo) => setImmediate(listo));

      mediciones.push({
        ruta,
        archivo: path.relative(RAIZ, archivo).replace(/\\/g, "/"),
        verbo,
        status,
        tiro,
        fetchSalientes: [...arnes.salientes],
        consultasIdentidad: arnes.consultasIdentidad,
      });
    }
  }
}, 120_000);

/**
 * La última palabra sobre las fugas, y la única que no tiene ventana.
 *
 * `afterAll` corre cuando ya no queda test, así que una salida diferida con
 * CUALQUIER retardo dentro de la corrida ya pasó por el espía cuando esto se
 * ejecuta. No dice de qué handler fue —eso lo dice la cuenta por handler— dice
 * que salió algo, que es la garantía que promete la propiedad 3.
 */
afterAll(() => {
  globalThis.fetch = fetchOriginal;
  for (const { nativo, metodo, original } of nativosOriginales) nativo[metodo] = original;

  const declaradas = FUGAS_HOY.flatMap((f) => f.destinos).sort().join(" | ");
  const todas = fugasReales().map(destinoDe).sort().join(" | ");
  if (todas !== declaradas) {
    throw new Error(
      `[precondición] al terminar el archivo las salidas registradas sin sesión eran ` +
        `«${todas}» y FUGAS_HOY declara «${declaradas}». El espía las rechazó, así que la ` +
        `suite no gastó; en producción no hay espía.`
    );
  }
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

    it("no hay en el disco un route.algo con una extensión que el barrido no acepte", () => {
      const aceptados = new Set(archivos);
      const ignorados = nombradosRuta(DIRECTORIO_RUTAS)
        .filter((a) => !aceptados.has(a))
        .map((a) => path.relative(RAIZ, a));

      expect(
        ignorados,
        "Estos archivos se llaman `route.algo` y el barrido NO los está llamando, porque su " +
          "extensión no está en ARCHIVO_DE_RUTA. Si Next los sirve, son rutas sin medir —el " +
          "refutador plantó un route.tsx abierto y la suite entera quedó verde—. Si no los " +
          "sirve, hay que decir acá por qué. Lo que no puede pasar es que la diferencia entre " +
          "«no existe» y «no lo miramos» sea invisible."
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

    it("todo handler no exento contesta 401 o 403, salvo los ya medidos como abiertos", () => {
      const exentas = new Set(EXENCIONES.map((e) => e.ruta));
      const yaAbiertos = new Set(ABIERTAS_HOY.map((a) => `${a.verbo} ${a.ruta}`));
      const abiertos = mediciones
        .filter((m) => !exentas.has(m.ruta))
        .filter((m) => m.status !== 401 && m.status !== 403)
        .filter((m) => !yaAbiertos.has(clave(m)))
        .map((m) => linea(m));

      expect(
        abiertos,
        "Estos handlers atendieron a un llamador SIN SESIÓN con algo que no es una negación, y no " +
          "estaban en la medición del 2026-09-10. Un 200 es la puerta abierta; un 400 de esquema " +
          "es peor que un 401 porque se lee como una negación y no lo es (el pedido murió en zod, " +
          "el guardia nunca corrió). Un 404 tampoco: puede venir de la RLS y no del handler. O " +
          "contestan 401/403, o van a EXENCIONES con motivo, mecanismo, huellas y status " +
          "esperado. Agregarlos a ABIERTAS_HOY es la salida de último recurso y hay que " +
          "justificarla ahí."
      ).toEqual([]);
    });

    it("la lista de abiertas de hoy sigue siendo exactamente lo que está abierto", () => {
      const porClave = new Map(mediciones.map((m) => [clave(m), m]));
      const vencidas: string[] = [];

      for (const a of ABIERTAS_HOY) {
        const m = porClave.get(`${a.verbo} ${a.ruta}`);
        if (!m) {
          vencidas.push(`${a.verbo} ${a.ruta}: listada como abierta y el barrido ya no la llama`);
          continue;
        }
        if (m.status === 401 || m.status === 403) {
          vencidas.push(
            `${a.verbo} ${a.ruta}: YA ESTÁ CERRADA (contesta ${m.status}). Borrá su entrada de ` +
              `ABIERTAS_HOY: dejarla ahí vuelve a permitir que se abra sin que nada falle.`
          );
          continue;
        }
        if (m.status !== a.statusMedido) {
          vencidas.push(
            `${a.verbo} ${a.ruta}: contesta ${m.status} y su entrada dice ${a.statusMedido}. ` +
              `Cambió algo en el camino; releé el motivo antes de actualizar el número.`
          );
        }
      }

      expect(
        vencidas,
        "El trinquete es exacto en las DOS direcciones, y por eso esta lista no es una " +
          "absolución: un handler que se abre y no está en ella pone rojo el test de arriba, y un " +
          "handler que se CIERRA y sigue en ella pone rojo éste. Arreglar una ruta obliga a venir " +
          "hasta acá y borrar su línea."
      ).toEqual([]);
    });

    it("el que niega, negó porque preguntó quién llama", () => {
      const exentas = new Set(EXENCIONES.map((e) => e.ruta));
      const negaronSinPreguntar = mediciones
        .filter((m) => !exentas.has(m.ruta))
        .filter((m) => m.status === 401 || m.status === 403)
        .filter((m) => m.consultasIdentidad === 0)
        .map((m) => `${linea(m)} — 0 consultas de identidad`);

      expect(
        negaronSinPreguntar,
        "Estos handlers contestaron 401 o 403 SIN preguntar nunca quién llama. El status pasa la " +
          "propiedad 2 y no significa nada: la negación viene de otra parte —un esquema, la RLS, " +
          "una fila que no existe— o de un dato que el propio llamador manda. Es el control " +
          "positivo: sin él, medido por un refutador, una autenticación falsa basada en un " +
          "header `x-user-id` pasaba por guardia legítimo, y 40 de 58 handlers del repositorio " +
          "vecino seguían dando 401 con el guardia borrado."
      ).toEqual([]);
    });

    it("las rutas exentas también dicen si preguntaron, y ninguna miente", () => {
      // Una exención declara que ALGO reemplaza a la sesión, no que no haya
      // identidad: el callback de Google además pide membresía de agencia, o sea
      // que sí pregunta. Esto pone ese hecho en el registro, para que el día que
      // una exención deje de preguntar alguien tenga que venir a decir por qué.
      const registro = EXENCIONES.map((e) => {
        const m = mediciones.find((x) => x.ruta === e.ruta);
        return `${e.ruta}: ${m ? m.consultasIdentidad : "no medida"} consultas`;
      }).sort();

      expect(
        registro,
        "Las dos que preguntan una vez son las de Google, y preguntan porque su mecanismo no es " +
          "sólo la cookie: además exigen membresía de la agencia. Las dos que preguntan cero son " +
          "las que no pueden —un webhook de un tercero y el aterrizaje de un magic link— y ahí " +
          "el cero es la exención misma, no un descuido. Si un número se mueve, el mecanismo de " +
          "esa exención cambió y hay que releerla antes de actualizar la lista."
      ).toEqual([
        "/api/agents/run-all: 0 consultas",
        "/api/agents/run: 0 consultas",
        "/api/auth/google/callback: 1 consultas",
        "/api/auth/google/start: 1 consultas",
        "/api/content/generate: 0 consultas",
        "/api/integrations/gbp/profile: 0 consultas",
        "/api/integrations/images/generate: 0 consultas",
        "/api/integrations/places/search: 0 consultas",
        "/api/seo/audit: 0 consultas",
        "/api/webhooks/lead-won: 0 consultas",
        "/auth/callback: 0 consultas",
      ]);
    });

    it("cada entrada abierta conserva el mecanismo que su motivo nombra", () => {
      const perdidas: string[] = [];
      for (const a of ABIERTAS_HOY) {
        if (!a.huella) continue;
        let fuente: string;
        try {
          fuente = readFileSync(path.join(RAIZ, a.huella.archivo), "utf8");
        } catch {
          perdidas.push(`${a.verbo} ${a.ruta}: su huella apunta a un archivo que ya no existe`);
          continue;
        }
        if (!codigoQueLlama(fuente, a.huella.texto).includes(a.huella.texto)) {
          perdidas.push(
            `${a.verbo} ${a.ruta}: su motivo dice que el mecanismo es \`${a.huella.texto}\` y ` +
              `eso ya no está en ${a.huella.archivo}. La entrada quedó describiendo algo que no ` +
              `existe: o el motivo cambió, o la ruta ahora está abierta por otra razón.`
          );
        }
      }

      expect(perdidas, "una entrada abierta caduca con el mecanismo que dice tener").toEqual([]);
    });

    it("la que está abierta pregunta una vez, y esa pregunta no es un guardia", () => {
      /**
       * PREGUNTAR NO ES GATEAR, Y ACÁ SE VE LA DIFERENCIA MEDIDA.
       *
       * Esta entrada es la única con `huella: null`, porque su motivo es que NO
       * hay mecanismo. Escribí este test esperando cero consultas de identidad y
       * midió UNA: `src/lib/reports/orchestrator.ts:70-71` llama a `getUser()`.
       *
       * El número contradijo mi suposición y la corrección va acá porque es el
       * hallazgo: ese `getUser()` no decide PERMISO, decide FUENTE DE DATOS —el
       * `if (user)` de :73 elige entre los datos del usuario y una rama
       * sembrada—. La ruta pregunta quién llama, escucha «nadie», y sigue
       * adelante igual, generando el reporte y gastando en Places y PageSpeed.
       *
       * Y eso marca el límite del control positivo de arriba, que hay que decir
       * en vez de esconder: el contador atrapa «negó sin preguntar», que es el
       * caso que un refutador explotó con un header `x-user-id`. NO atrapa
       * «preguntó y no le importó la respuesta». Para eso está el status: acá es
       * 200, y por eso esta ruta es la primera de la lista de trabajo.
       */
      const m = mediciones.find((x) => x.ruta === "/api/reports/generate" && x.verbo === "POST");

      expect(m, "la ruta del reporte ya no está en el barrido").toBeDefined();
      expect(
        m!.consultasIdentidad,
        "POST /api/reports/generate preguntaba UNA vez quién llama, en el orquestador, para " +
          "elegir la fuente de datos y no para negar. Si este número se movió, esa pregunta " +
          "cambió de lugar o de propósito, y hay que releer la entrada antes de tocar el número."
      ).toBe(1);
      expect(
        m!.status,
        "y el 200 es lo que dice que la pregunta no era un guardia: preguntó, le dijeron nadie, " +
          "y contestó igual."
      ).toBe(200);
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

    it("cada exención sigue teniendo el mecanismo que la justifica, en el archivo donde vive", () => {
      const perdidas: string[] = [];
      for (const e of EXENCIONES) {
        const archivo = archivos.find((a) => rutaUrl(a) === e.ruta);
        if (!archivo) {
          perdidas.push(`${e.ruta}: exenta y la ruta ya no existe en el disco`);
          continue;
        }
        for (const huella of e.huellas) {
          let fuente: string;
          try {
            fuente = readFileSync(path.join(RAIZ, huella.archivo), "utf8");
          } catch {
            perdidas.push(
              `${e.ruta}: su huella apunta a ${huella.archivo} y ese archivo ya no existe`
            );
            continue;
          }
          if (!codigoQueLlama(fuente, huella.texto).includes(huella.texto)) {
            perdidas.push(
              `${e.ruta}: perdió la huella \`${huella.texto}\` en ${huella.archivo} ` +
                `(no aparece en posición de llamada, con los comentarios tapados)`
            );
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

  describe("los mecanismos que reemplazan a la sesión, ejercitados de los dos lados", () => {
    it("el callback de magic link no deja pasar un code inválido", async () => {
      const archivo = archivos.find((a) => rutaUrl(a) === "/auth/callback");
      expect(archivo, "la ruta del callback ya no está en el disco").toBeDefined();
      const modulo: Record<string, unknown> = await import(pathToFileURL(archivo!).href);
      const handler = modulo.GET as (req: Request) => Promise<Response>;

      const respuesta = await handler(
        new Request(`${ORIGEN}/auth/callback?code=un-code-que-no-existe&next=/app`)
      );

      // El status solo no alcanza para distinguir: un 307 al destino y un 307 al
      // login son el mismo número. Lo que separa negar de dejar pasar es ADÓNDE
      // manda, y eso es lo que se afirma — es el mismo defecto que un refutador
      // midió en /api/auth/google/start, donde el 307 de éxito y el de negación
      // eran indistinguibles para el barrido.
      const destino = respuesta.headers.get("location") ?? "";
      expect(respuesta.status, "un code inválido tiene que terminar en una redirección").toBe(307);
      expect(
        destino.includes("/login"),
        `Un code inválido mandó el navegador a ${destino}. Si eso no es el login, el canje falló ` +
          `y la ruta siguió adelante igual, que es la única forma en que esta exención se vuelve ` +
          `una puerta: el 307 seguiría siendo 307 y el barrido no se enteraría.`
      ).toBe(true);
      expect(
        destino.includes("/app"),
        `Un code inválido no puede terminar en el destino post-login (${destino}).`
      ).toBe(false);
    });
  });

  describe("propiedad 3: el espía de fetch en cero", () => {
    it("ningún handler sale a la red sin sesión, salvo la fuga ya medida", () => {
      const conocidas = new Map(FUGAS_HOY.map((f) => [`${f.verbo} ${f.ruta}`, f.destinos]));
      const fugas: string[] = [];

      for (const m of mediciones) {
        if (m.fetchSalientes.length === 0) continue;
        const esperados = conocidas.get(clave(m));
        const medidos = m.fetchSalientes.map(destinoDe);
        if (!esperados) {
          fugas.push(`${clave(m)} [${m.archivo}] -> ${medidos.join(" | ")}`);
          continue;
        }
        // Como MULTICONJUNTO, no por índice. Un refutador puso este test rojo
        // metiendo sesenta `await Promise.resolve()` delante de la MISMA
        // llamada: mismos destinos, misma cantidad, sólo otro orden de
        // planificación. Comparar por índice medía el planificador de
        // promesas, no la fuga.
        const ordenados = [...medidos].sort().join(" | ");
        const declarados = [...esperados].sort().join(" | ");
        if (ordenados !== declarados) {
          fugas.push(
            `${clave(m)} [${m.archivo}] -> salió a ${medidos.join(" | ")} y su entrada en ` +
              `FUGAS_HOY declara ${esperados.join(" | ")}`
          );
        }
      }

      expect(
        fugas,
        "Un llamador SIN SESIÓN disparó llamadas salientes que no estaban en la medición del " +
          "2026-09-10. Eso es gasto que un anónimo puede provocar —Places y PageSpeed cobran por " +
          "request— y superficie: la clave de PageSpeed viaja en la query string de su propia " +
          "URL. El espía las rechaza, así que la suite no gasta nada; en producción no hay espía."
      ).toEqual([]);
    });

    it("no salió nada a la red fuera de la foto de ningún handler", async () => {
      // La espera, y por qué tiene un número escrito.
      //
      // MEDIDO en el repositorio vecino, con la misma aserción escrita
      // sincrónica: el ataque de un refutador —un `void async` que duerme
      // 400ms antes de su fetch— quedaba VERDE, porque el test corría antes de
      // que la fuga saliera, y el error del espía se imprimía DESPUÉS del
      // «passed». Un segundo cubre esa clase de diferido; lo que quede más allá
      // lo agarra la red del `afterAll`, que corre cuando ya no queda test.
      await new Promise((listo) => setTimeout(listo, 1000));

      const declaradas = FUGAS_HOY.flatMap((f) => f.destinos).sort();
      const todas = fugasReales().map(destinoDe).sort();

      expect(
        todas,
        "El total de salidas registradas en TODO el archivo no coincide con lo declarado en " +
          "FUGAS_HOY. Esta cuenta existe aparte de la de cada handler porque una llamada " +
          "diferida —un setTimeout, un `void async` sin await— sale DESPUÉS de que el handler " +
          "contestó, y el registro por handler no la ve. Una fuga sin dueño sigue siendo una fuga."
      ).toEqual(declaradas);
    });

    it("no hay en el repositorio un transporte HTTP que el espía no vigile", () => {
      const NO_VIGILADOS = ["axios", "node-fetch", "got", "superagent", "undici", "request"];
      const paquete = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declarados = Object.keys({ ...paquete.dependencies, ...paquete.devDependencies });

      expect(
        declarados.filter((d) => NO_VIGILADOS.includes(d)),
        "Este paquete entró como dependencia y NO pasa por ninguno de los dos puntos que el " +
          "espía instrumenta (globalThis.fetch, y request/get de node:http y node:https). " +
          "Medido por un refutador contra un servidor local: axios —con su propio httpsAgent— y " +
          "node-fetch SALIERON y el espía registró cero. O se instrumenta acá, o el cero de la " +
          "propiedad 3 deja de significar algo."
      ).toEqual([]);
    });

    it("la fuga listada sigue existiendo, o hay que borrarla de la lista", () => {
      const medidas = new Map(
        mediciones.filter((m) => m.fetchSalientes.length > 0).map((m) => [clave(m), m])
      );

      const vencidas = FUGAS_HOY.filter((f) => !medidas.has(`${f.verbo} ${f.ruta}`)).map(
        (f) =>
          `${f.verbo} ${f.ruta}: listada como fuga y ya no sale a la red sin sesión. Borrá su ` +
          `entrada de FUGAS_HOY para que el trinquete no vuelva a permitir la que se acaba de cerrar.`
      );

      expect(vencidas, "una fuga arreglada tiene que salir de la lista").toEqual([]);
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
      await expect(globalThis.fetch(`https://${HOST_DE_CONTROL}/espia`)).rejects.toThrow(
        "[espia]"
      );
      expect(arnes.salientes.length, "el espía no registró la llamada de control").toBe(antes + 1);
      expect(arnes.salientes[arnes.salientes.length - 1]).toContain(HOST_DE_CONTROL);

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
