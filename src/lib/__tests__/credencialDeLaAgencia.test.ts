/**
 * QUÉ IMPIDE ESTE ARCHIVO — LA PARED DEL TOKEN DE LA AGENCIA
 *
 * Que un módulo de DATOS llegue a la credencial de la agencia por un costado.
 *
 * El token de Google es uno, el de la organización que nombra
 * `VULKAN_AGENCY_ORG_ID`, y sirve a todos los clientes. La regla que decide a
 * quién se le presta vive en UN lugar, `servicioCompartido.ts`: sólo a una
 * organización con mapeo vivo, sólo sobre sus properties. Esa regla no vale nada
 * si al lado existe otro camino a la credencial — y el defecto que la Espina
 * nombra, «el fallback silencioso al token de la agencia», es justamente ese otro
 * camino: un `?? process.env.VULKAN_AGENCY_ORG_ID`, un `agencyAccessToken()`
 * llamado directo, un `integration_token_secret` pedido con `service_role` para
 * «la organización que tenga token». Cada uno es una línea, y ninguno rompe un
 * test que mire el camino feliz.
 *
 * LA CREDENCIAL SON DOS COSAS, Y LA PARED MIRA LAS DOS
 *
 *   1. LA VARIABLE. Quién lee `VULKAN_AGENCY_ORG_ID`: exactamente `agency.ts`. Y
 *      las tres properties de la agencia que `.env.example` todavía declara
 *      (`GA4_PROPERTY_ID`, `GOOGLE_SEARCH_CONSOLE_SITE_URL`,
 *      `GOOGLE_BUSINESS_LOCATION_ID`), nadie: son el valor por defecto de
 *      cualquier fallback.
 *   2. LA CUSTODIA. Quién nombra las RPC de la `0021`
 *      (`integration_token_secret`, `refresh_integration_token`,
 *      `store_integration_token`), la tabla `integration_tokens` y la vista del
 *      Vault: exactamente `tokenStore.ts` y `agencyToken.ts`, cada uno lo suyo.
 *      Medido el 2026-10-11 en la revisión del #118: un `secretoDeQuienTengaToken()`
 *      escrito en `orchestrator.ts` —«usá el token que haya», el fallback en su
 *      forma más pura— leía el secreto con `service_role` sin nombrar la variable
 *      ni importar nada de la agencia, y la suite entera seguía en verde.
 *
 * QUIÉN ESTÁ SUJETO: TODOS LOS MÓDULOS, NO UNA LISTA DE CONVENCIONES
 *
 * La versión anterior descubría las «entradas» con `route|page|layout`, que es
 * una lista escrita a mano de las convenciones de Next. Medido en la misma
 * revisión: un `template.tsx` que llamaba `agencyAccessToken()` pasaba la pared,
 * y el mismo código como `page.tsx` no. Next ejecuta en el servidor `template`,
 * `default`, `not-found`, `sitemap`, `opengraph-image`, `instrumentation.ts`, y
 * la lista no se termina nunca. Ahora no hay lista: CADA módulo de producción
 * —también los `.js`, que `allowJs: true` deja compilar— que llegue a la
 * credencial sin pasar por la puerta es una fuga, salvo que esté exento abajo
 * con su razón. Un módulo de datos que importe una exención no hereda la
 * exención: llega a la credencial sin la puerta, y es una fuga él.
 *
 * Y CÓMO SE MIDE: CON EL COMPILADOR, NO CON LA FORMA DEL TEXTO (R14)
 *
 * El análisis es de `tsc` entero, con el verificador de tipos
 * (`credencialDeLaAgencia.analisis.ts`). Una lectura del entorno se reconoce
 * porque su clave está ESCRITA —un literal, o una constante que vale uno, local,
 * importada o `as const`—, no porque su TIPO sea literal: un tipo se afirma, y
 * la cuarta revisión del #118 leyó la variable de la agencia con
 * `process.env[nombre as PlatformEnvVar]` y pidió el secreto con
 * `rpc(... as "current_user_org_ids")`, con tsc y la pared en verde. El mundo es
 * cerrado: una lectura del entorno cuya clave no está escrita, un `process.env`
 * que se escapa a algo que no lo tipa como entorno, un método de la base con un
 * nombre que no está escrito —o sacado del cliente, o escondido con una
 * aserción—, o un `import()` de destino no literal, son fallas por sí mismas —
 * por ahí pasaría la próxima. Lo mismo un `process` o un `globalThis` que
 * pierden el tipo (`as any`, `Reflect.get`) y una carga que resuelve webpack sin
 * `import()` (`require.context`, `import.meta.webpackContext`,
 * `__non_webpack_require__`): medidos en la tercera revisión del #118.
 *
 * Y NO SÓLO POR ARCHIVO: POR SÍMBOLO (R14)
 *
 * Medido el 2026-10-11 en la segunda revisión del #118, con la suite entera en
 * verde: una línea `export { agencyAccessToken } from "./tokenStore"` en la
 * puerta le daba el token a cualquier módulo de datos nuevo «por la puerta», y
 * una server action nueva en `property-actions.ts` —exento entero— lo pedía
 * para cualquier property. Las dos pasaban porque la pared eximía ARCHIVOS. Ahora
 * mide símbolos, con el verificador y a través de cualquier reexportación:
 *
 *   - `agencyAccessToken` y `resolveAccessToken` los usa SÓLO la puerta;
 *   - la puerta exporta como valor su regla, `servirConLaAgencia`, y nada más;
 *   - cada exención de conexión declara qué piezas de la credencial usa, y usa
 *     exactamente ésas. También si las nombra por TEXTO (`almacen["x"]`, una
 *     clave `as const`, un `import()`) o si el namespace se va a otra función:
 *     la tercera revisión del #118 pidió el token así desde `property-actions.ts`.
 *
 * Y LOS TRES QUE RECIBEN EL TOKEN
 *
 * La puerta no entrega el token, pero se lo pasa a `searchConsole.ts`, `ga4.ts`
 * y `googleBusinessProfile.ts`, que lo ponen en la cabecera. Medido el
 * 2026-10-16 en la quinta revisión del #118, con tsc, esta pared y la suite
 * entera en verde: `fetchSearchConsoleTotals` guardaba `deps.accessToken` en un
 * `export const ultimoToken`, y una ruta nueva lo gastaba sobre cualquier sitio.
 * Ahora son RECEPTORES: sus exports de valor los usa la puerta y lo que está
 * declarado abajo (la ventana de Search Console, que GA4 comparte), llegar a uno
 * sin la puerta es una fuga, no importan nada de valor fuera de los tres, y no
 * tocan `process`, el entorno, el objeto global ni un global del repositorio.
 * Y la lista no es de fe: la puerta importa como valor los tres, la custodia y
 * el cliente de sesión, y nada más. Un módulo nuevo al que le pase el token
 * tiene que importarlo, y entonces es un receptor declarado o un rojo.
 *
 * Salvo el cliente de sesión, que importa cualquiera. Medido el 2026-10-21 en
 * la revisión del #123, con tsc, eslint y esta pared en verde: la puerta le
 * pasaba el token al `createSupabaseServerClient` que importa —colgado de la
 * función (`(createSupabaseServerClient as unknown as { ultima?: string
 * }).ultima = token`), en un export nuevo de `server.ts`, o como argumento que
 * termina en una cookie—, y una server action nueva lo leía. Ahora lo que la
 * puerta, cada receptor y cada tenedor (abajo) usan de los demás módulos del
 * árbol es exacto y está en `USAN_DEL_ARBOL`, por SÍMBOLO y con su FORMA:
 * llamado con cuántos argumentos, o usado como valor. Y escribir en algo que
 * no se sabe privado —todo salvo una variable propia y un objeto que nació acá
 * en un literal: un import, un export propio, un valor del lenguaje o de Node,
 * un parámetro, un local, lo heredado— cuenta como tocar lo global.
 *
 * Y LA CADENA DE PROTOTIPOS
 *
 * Medido el 2026-10-21 en la segunda vuelta de la misma revisión, con tsc,
 * eslint, esta pared y la suite entera en verde: hasta ahí, escribir en lo
 * compartido se reconocía por la RAÍZ con nombre, y `({}).constructor.prototype
 * .__t = token` —en la puerta, en `tokenStore.ts` o en `searchConsole.ts`—, o
 * `Object.getPrototypeOf(vivos).__t = …`, dejaban el token en `Object.prototype`
 * o `Array.prototype`. Una ruta nueva sin ningún import lo leía con `({}).__t`.
 * Ahora, en los que tienen el token, escribir en lo que no nació acá en un
 * literal es tocar lo global, y llegar a la cadena de prototipos también,
 * escriba o no: `constructor`, `prototype`, `__proto__`, `getPrototypeOf`, los
 * accesores heredados (`__defineGetter__`…) y cualquier clave que no está
 * escrita. Y de `Object` y `Reflect` se declara cada miembro, no el global.
 *
 * Y LOS QUE TIENEN EL TOKEN SIN SER LA PUERTA NI UN RECEPTOR
 *
 * Medido el 2026-10-21 en la misma revisión: `tokenStore.ts`, que PRODUCE el
 * token y tiene en claro el access y el refresh token, dejaba el access token en
 * un global tipado (`globalThis.__cacheDeGoogle = token`, sin aserción) y una
 * ruta nueva lo devolvía, con la pared en verde: lo de afuera y lo global se
 * medían sólo en la puerta y los receptores. Ahora `tokenStore.ts`, `oauth.ts`
 * (parsea el secreto y refresca con el refresh token) y el callback del OAuth
 * (trae el token de Google) son TENEDORES: quién usa sus exports es exacto, lo
 * que usan de afuera y del árbol también, y lo que tocan de lo global —leen el
 * entorno, y nada más— está escrito sitio por sitio en `TENEDORES`.
 *
 * Eso medía sólo lo de ADENTRO del árbol. Medido el 2026-10-16 en la revisión
 * del #123, con tsc, eslint y esta pared en verde: un receptor —o la puerta—
 * le dejaba el token a `node:diagnostics_channel`, a `next/cache`, a `node:fs`,
 * a la cookie de `next/headers`, o al `BroadcastChannel` global sin importar
 * nada, y una ruta nueva sin ningún import del árbol lo recibía. Ahora lo que la
 * puerta y cada receptor usan de AFUERA —lo que importan, y los globales del
 * lenguaje y de Node que nombran— es exacto y está en `DE_AFUERA`, con su razón;
 * y la puerta tampoco toca lo global.
 *
 * LA PRIMERA MITAD DE ESTE ARCHIVO PRUEBA EL DETECTOR
 *
 * Un detector ciego da el mismo verde que un árbol limpio. Antes de mirar `src`,
 * el mismo análisis corre sobre fuentes escritas en memoria que reproducen cada
 * forma de saltarse la pared que se conoce —las cinco de la revisión del #118
 * entre ellas—, con controles negativos al lado, y tiene que encontrar
 * exactamente esas.
 *
 * QUÉ NO DICE
 *
 * No dice que la regla de `servicioCompartido.ts` sea correcta: eso lo miden
 * `servicioCompartido.test.ts` y los dos tests de varias organizaciones (el
 * reporte y la publicación). Dice que no hay otra puerta. Y tampoco dice qué
 * hace quien pasa por la puerta con lo que recibe: por eso la puerta no entrega
 * el token, sólo consultas atadas a sus mapeos (ver su encabezado). Lo que el
 * analizador no ve está escrito al final de su encabezado.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type Analisis,
  analizar,
  camino,
  esTest,
  fuentesEn,
  hostEnMemoria,
  juzgar,
  opcionesDelProyecto,
  type Politica,
  type Receptor,
  type Veredicto,
} from "./credencialDeLaAgencia.analisis";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** La variable. Escrita acá y no importada: un test que compara contra la constante que prueba no mide nada. */
const VARIABLE = "VULKAN_AGENCY_ORG_ID";

/**
 * Las properties de la AGENCIA, en el entorno. `.env.example` todavía las
 * declara y NADA las lee: el mapeo de cada cliente vive en
 * `integration_properties`. Son el valor por defecto que un fallback usaría.
 */
const PROPERTIES_DE_LA_AGENCIA = ["GA4_PROPERTY_ID", "GOOGLE_SEARCH_CONSOLE_SITE_URL", "GOOGLE_BUSINESS_LOCATION_ID"];

const LECTOR = "src/lib/integrations/google/agency.ts";
const PUERTA = "src/lib/integrations/google/servicioCompartido.ts";
const TOKEN_STORE = "src/lib/integrations/google/tokenStore.ts";
const AGENCY_TOKEN = "src/lib/integrations/google/agencyToken.ts";
const AGENCY_GUARD = "src/lib/integrations/google/agencyGuard.ts";
const PROPERTY_ACTIONS = "src/lib/integrations/property-actions.ts";
const PANTALLA_CLIENTE = "src/app/app/integrations/client.tsx";

/** Los que PRODUCEN el token de la agencia. Escritos acá, como la variable. */
const PRODUCTORES_DEL_TOKEN = [`${TOKEN_STORE}#agencyAccessToken`, `${TOKEN_STORE}#resolveAccessToken`];

/**
 * Los módulos de CONEXIÓN: los que operan la credencial de la agencia, no leen
 * datos de un cliente con ella. Pueden llegar a la credencial sin pasar por la
 * puerta, porque su pregunta ES «¿quién es la agencia?» o «¿está conectada?».
 *
 * Agregar una entrada acá es una decisión, no un trámite: dice que ese módulo
 * no sirve datos de nadie con el token. Un módulo de datos no entra acá; entra
 * por `servicioCompartido.ts`. Y una exención no se hereda: quien importe uno de
 * éstos para leer datos es una fuga.
 */
const CONEXION: Array<{ modulo: string; usa: string[]; porque: string }> = [
  {
    modulo: "src/app/api/auth/google/start/route.ts",
    usa: [`${AGENCY_GUARD}#esOperadorDeLaAgencia`],
    porque: "arranca el OAuth de la agencia, y sólo deja entrar a su operador (agencyGuard)",
  },
  {
    modulo: "src/app/api/auth/google/callback/route.ts",
    usa: [`${AGENCY_GUARD}#esOperadorDeLaAgencia`, `${TOKEN_STORE}#saveAgencyToken`],
    porque: "guarda el token bajo la organización de la agencia (saveAgencyToken)",
  },
  {
    modulo: "src/app/app/integrations/page.tsx",
    usa: [
      `${PANTALLA_CLIENTE}#OperadaPorLaAgencia`,
      `${PANTALLA_CLIENTE}#OrganizationIntegrations`,
      `${PANTALLA_CLIENTE}#PlatformNotice`,
      `${LECTOR}#resolveAgencyOrgId`,
      `${AGENCY_TOKEN}#agencyTokenState`,
    ],
    porque: "la pantalla de conexión: muestra el estado del token de la agencia, no datos de un cliente",
  },
  {
    modulo: PANTALLA_CLIENTE,
    usa: [`${PROPERTY_ACTIONS}#mapProperty`, `${PROPERTY_ACTIONS}#unmapProperty`],
    porque: "la mitad de cliente de la misma pantalla: llama a la server action del mapeo, no lee datos",
  },
  {
    modulo: PROPERTY_ACTIONS,
    usa: [`${AGENCY_GUARD}#operadorDeLaAgencia`],
    porque: "server action del mapeo: sólo un operador de la agencia apunta una property a un cliente",
  },
  {
    modulo: AGENCY_GUARD,
    usa: [`${LECTOR}#resolveAgencyOrgId`],
    porque: "el guardián de «sólo el operador de la agencia»: pregunta quién es la agencia para AUTORIZAR, no para elegir datos",
  },
];

const SEARCH_CONSOLE = "src/lib/integrations/google/searchConsole.ts";
const GA4 = "src/lib/integrations/google/ga4.ts";
const BUSINESS_PROFILE = "src/lib/publishing/googleBusinessProfile.ts";

/**
 * Los que RECIBEN el token de la puerta y lo ponen en la cabecera, y quién usa
 * cada export de valor suyo en producción. Exacto, por símbolo.
 *
 * Un usuario nuevo de un receptor es una decisión, como una exención de
 * conexión: el que lo use puede leer lo que el receptor deje en sus exports, y
 * ése es el token. Un módulo de datos no entra acá; pide la consulta a
 * `servicioCompartido.ts`.
 */
const RECEPTORES: Array<Receptor & { porque: string }> = [
  {
    modulo: SEARCH_CONSOLE,
    usadoPor: { [PUERTA]: ["fetchSearchConsoleTotals"], [GA4]: ["VENTANA_DIAS", "ventana"] },
    porque:
      "la puerta consulta con el token; GA4 —otro receptor, que ya tiene el token— usa la MISMA ventana para que las dos mitades del reporte se puedan comparar",
  },
  {
    modulo: GA4,
    usadoPor: { [PUERTA]: ["fetchGa4Totals"] },
    porque: "la puerta consulta con el token",
  },
  {
    modulo: BUSINESS_PROFILE,
    usadoPor: { [PUERTA]: ["publicadorDeBusinessProfile"] },
    porque: "la puerta arma el publicador de la ficha mapeada con el token",
  },
];

/**
 * Lo que la puerta, cada receptor y cada tenedor usan de AFUERA del árbol,
 * exacto: lo que importan como valor (un paquete, un módulo de Node) y los
 * globales del lenguaje y de Node que nombran. Todos tienen el token en la mano.
 *
 * Uno nuevo es una decisión: `next/cache`, `node:fs`, `node:diagnostics_channel`
 * o un `BroadcastChannel` guardan el token donde lo lea otra ruta, y una cookie
 * lo manda al navegador. Si es inocuo —un `Math`—, va acá con su razón.
 */
const OAUTH = "src/lib/integrations/google/oauth.ts";
const CALLBACK = "src/app/api/auth/google/callback/route.ts";
const START = "src/app/api/auth/google/start/route.ts";
const SESION = "src/lib/supabase/server.ts";

/**
 * Los que tienen el token en claro sin ser la puerta ni un receptor, quién usa
 * cada export de valor suyo en producción, y dónde tocan lo global —sin la
 * línea, con repetidos—. Exacto, como los receptores.
 *
 * Lo global de los tres es LEER el entorno: la organización de la agencia y las
 * credenciales del OAuth, por el `env = process.env` que dejan inyectar los
 * tests. Un sitio nuevo —escribir el token en `env`, en `globalThis`, en un
 * import— es un rojo.
 */
const TENEDORES: Array<Receptor & { tocaLoGlobal: string[]; porque: string }> = [
  {
    modulo: TOKEN_STORE,
    usadoPor: { [PUERTA]: ["agencyAccessToken"], [CALLBACK]: ["saveAgencyToken"] },
    tocaLoGlobal: [
      // `saveAgencyToken` y `agencyAccessToken`: el entorno por defecto, y la
      // organización de la agencia que se lee de él.
      ...Array<string>(2).fill("el entorno: env: NodeJS.ProcessEnv = process.env"),
      ...Array<string>(2).fill("process: process.env"),
      ...Array<string>(2).fill("el entorno: resolveAgencyOrgId(env)"),
      // `agencyAccessToken`: las credenciales del OAuth, para refrescar.
      "el entorno: resolveOAuthConfig(env)",
    ],
    porque:
      "PRODUCE el token: lee el secreto de la custodia, lo refresca con el refresh token y le da el access token a la puerta; el callback guarda el que trae de Google",
  },
  {
    modulo: OAUTH,
    usadoPor: {
      [TOKEN_STORE]: ["parseStoredToken", "refreshAccessToken", "resolveOAuthConfig", "serializeToken"],
      [START]: ["buildConsentUrl", "resolveOAuthConfig"],
      [CALLBACK]: ["exchangeCode", "readCallback", "resolveOAuthConfig"],
    },
    tocaLoGlobal: [
      "el entorno: env: NodeJS.ProcessEnv = process.env",
      "process: process.env",
      "el entorno: env.GOOGLE_CLIENT_ID",
      "el entorno: env.GOOGLE_CLIENT_SECRET",
      "el entorno: env.GOOGLE_REDIRECT_URI",
    ],
    porque:
      "parsea y serializa el secreto, y canjea el código o el refresh token contra Google: tiene los dos en claro. El arranque del OAuth arma la URL de consentimiento",
  },
  {
    modulo: CALLBACK,
    usadoPor: {},
    tocaLoGlobal: ["el entorno: process.env.NODE_ENV", "process: process.env"],
    porque:
      "canjea el código por el token de la agencia y lo guarda; lo llama Next, nadie lo importa. `NODE_ENV` decide si el motivo de una vuelta fallida va al log",
  },
];

const DE_AFUERA: Record<string, { importa: string[]; globales: string[]; porque: string }> = {
  [PUERTA]: {
    importa: [],
    globales: ["Object.freeze", "console", "fetch"],
    porque:
      "`fetch` es el transporte que les pasa a los receptores; `Object.freeze` congela los mapeos (de `Object` y `Reflect` se declara cada miembro: desde ellos se llega a cualquier objeto); `console.warn` avisa el mapeo rechazado, sin el token",
  },
  [SEARCH_CONSOLE]: {
    importa: [],
    globales: ["Array", "Date", "JSON", "Number", "encodeURIComponent"],
    porque: "arma la ventana (`Date`), la URL (`encodeURIComponent`) y el cuerpo (`JSON`), y valida la respuesta (`Array`, `Number`)",
  },
  [GA4]: {
    importa: [],
    globales: ["Array", "JSON", "Number", "encodeURIComponent"],
    porque: "arma la URL y el cuerpo, y valida la respuesta; la ventana la toma de Search Console",
  },
  [BUSINESS_PROFILE]: {
    importa: [],
    globales: ["JSON", "encodeURIComponent"],
    porque: "arma la URL de la ficha y el cuerpo del post",
  },
  [TOKEN_STORE]: {
    importa: [],
    globales: ["Date", "fetch", "process"],
    porque: "`fetch` es el transporte del refresco; `Date`, el momento; `process.env`, el entorno por defecto (ver TENEDORES)",
  },
  [OAUTH]: {
    importa: [],
    globales: ["Date", "Error", "JSON", "Number", "URL", "URLSearchParams", "process"],
    porque:
      "arma la URL de consentimiento y el cuerpo del canje (`URL`, `URLSearchParams`), parsea el secreto y la respuesta (`JSON`, `Number`, `Error`), calcula el vencimiento (`Date`) y lee las credenciales del entorno",
  },
  [CALLBACK]: {
    importa: ["next/headers", "next/server", "node:crypto"],
    globales: ["Buffer", "Date", "URL", "console", "fetch", "process"],
    porque:
      "la cookie del `state` (`next/headers`), la redirección (`next/server`) y su comparación en tiempo constante (`node:crypto`, `Buffer`); `fetch` es el transporte del canje; `console.warn` anota el motivo fuera de producción, sin el token",
  },
};

/**
 * Lo que la puerta, cada receptor y cada tenedor usan de los DEMÁS módulos del
 * árbol —salvo de un receptor, cuyos exports los usa sólo la puerta y lo
 * declarado—, exacto, con repetidos, y con su forma: `ruta#nombre(n)` es una
 * llamada con n argumentos, y `ruta#nombre` a secas, un VALOR (se guarda, se
 * pasa, se le escribe una propiedad).
 *
 * Un uso nuevo es una decisión, como un import de afuera: el módulo usado lo
 * puede usar cualquiera, y lo que se le pase o se le cuelgue lo lee él.
 */
const USAN_DEL_ARBOL: Record<string, { usa: string[]; porque: string }> = {
  [PUERTA]: {
    usa: [`${SESION}#createSupabaseServerClient(0)`, `${TOKEN_STORE}#agencyAccessToken(0)`],
    porque: "el cliente de SESIÓN lee los mapeos con la RLS de quien llama, sin argumentos; el token lo pide sin argumentos",
  },
  [SEARCH_CONSOLE]: { usa: [], porque: "no usa nada del árbol fuera de los receptores" },
  [GA4]: { usa: [], porque: "la ventana es de Search Console, otro receptor" },
  [BUSINESS_PROFILE]: { usa: [], porque: "no usa nada del árbol" },
  [TOKEN_STORE]: {
    usa: [
      ...Array<string>(2).fill("src/lib/integrations/google/agency.ts#resolveAgencyOrgId(1)"),
      "src/lib/integrations/google/agencyToken.ts#agencyTokenState",
      `${OAUTH}#parseStoredToken(1)`,
      `${OAUTH}#refreshAccessToken(4)`,
      `${OAUTH}#resolveOAuthConfig(1)`,
      ...Array<string>(2).fill(`${OAUTH}#serializeToken(1)`),
      ...Array<string>(2).fill("src/lib/supabase/admin.ts#createSupabaseAdminClient(0)"),
    ],
    porque:
      "la organización de la agencia y las credenciales del OAuth, del entorno; el cliente de `service_role` para la custodia; y `agencyTokenState` como el `readState` que se le inyecta a `resolveAccessToken` (un valor: ver «QUÉ NO VE»)",
  },
  [OAUTH]: { usa: [], porque: "no importa nada" },
  [CALLBACK]: {
    usa: [
      "src/lib/integrations/google/agencyGuard.ts#esOperadorDeLaAgencia(0)",
      `${OAUTH}#exchangeCode(4)`,
      `${OAUTH}#readCallback(1)`,
      `${OAUTH}#resolveOAuthConfig(0)`,
      ...Array<string>(2).fill("src/lib/integrations/google/oauthCookie.ts#ESTADO_COOKIE"),
      `${TOKEN_STORE}#saveAgencyToken(2)`,
    ],
    porque:
      "el guardián del operador, el canje y su lectura, y el guardado; el nombre de la cookie del `state` es un texto (`get` y `delete`)",
  },
};

const POLITICA: Politica = {
  variable: VARIABLE,
  lector: LECTOR,
  nadieLee: PROPERTIES_DE_LA_AGENCIA,
  puerta: PUERTA,
  exportaLaPuerta: ["servirConLaAgencia"],
  productoresDelToken: PRODUCTORES_DEL_TOKEN,
  custodia: {
    integration_token_secret: [TOKEN_STORE],
    refresh_integration_token: [TOKEN_STORE],
    store_integration_token: [TOKEN_STORE],
    integration_tokens: [AGENCY_TOKEN],
    decrypted_secrets: [],
  },
  conexion: CONEXION.map(({ modulo, usa }) => ({ modulo, usa })),
  receptores: RECEPTORES.map(({ modulo, usadoPor }) => ({ modulo, usadoPor })),
  tenedores: TENEDORES.map(({ modulo, usadoPor }) => ({ modulo, usadoPor })),
};

// ---------------------------------------------------------------------------
// 1. El detector, contra cada forma conocida de saltarse la pared
// ---------------------------------------------------------------------------

/**
 * Un árbol escrito en memoria, bajo `src/pared-virtual/`, que no existe en el
 * disco. Tiene lo mismo que el de verdad —la variable, la custodia, la puerta,
 * una ruta de datos legítima y una de conexión— y al lado, un módulo por cada
 * manera de saltarse la pared. Los que se llaman `control*` son lo que NO
 * tiene que verse: un detector que marca todo también «encuentra» las fugas.
 */
const V = "src/pared-virtual";
const VIRTUALES: Record<string, string> = {
  "agency.ts": `
    export const AGENCY_ORG_ID_ENV = "VULKAN_AGENCY_ORG_ID";
    export function resolveAgencyOrgId(env: NodeJS.ProcessEnv = process.env): string | null {
      return env[AGENCY_ORG_ID_ENV] ?? null;
    }`,
  "admin.ts": `
    import { createClient } from "@supabase/supabase-js";
    export function admin() { return createClient("http://localhost", "no-es-una-llave"); }`,
  // El PRODUCTOR, que es un tenedor (EV-TOKENSTORE-EGRESS de la revisión del
  // #123): deja el token en un global tipado, sin aserción, y lo cuelga de la
  // función que importa de otro tenedor. Y EV-PROTOTIPO de la segunda vuelta
  // de la misma revisión: en `Object.prototype`, por un literal.
  "tokenStore.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import * as base from "./admin";
    import { refrescar } from "./oauth";
    export async function agencyAccessToken() {
      const org = resolveAgencyOrgId();
      const { data } = await base.admin().rpc("integration_token_secret", { p_organization_id: org });
      const token = refrescar(String(data));
      globalThis.cacheDelProductor = token;
      (refrescar as unknown as { ultimo?: string }).ultimo = token;
      ({}).constructor.prototype.__t = token;
      return token;
    }
    // Otra pieza, inocua: le da a una aserción un nombre que existe y no es el token.
    export const proveedor = () => "google";`,
  // Otro tenedor, como oauth.ts: tiene el refresh token en claro, y lo deja en
  // el disco. Y una ruta nueva que lee lo que el productor le colgó. El
  // cliente de la custodia llega por un namespace: `base.admin()` es una
  // llamada, como `admin()`.
  "oauth.ts": `
    import { writeFileSync } from "node:fs";
    export function refrescar(secreto: string) {
      writeFileSync("/tmp/refresco", secreto);
      return secreto + "-nuevo";
    }`,
  "app/api/oauth/route.ts": `
    import { refrescar } from "../../../oauth";
    export async function GET() { return (refrescar as unknown as { ultimo?: string }).ultimo ?? null; }`,
  // El cliente de sesión: lo importa cualquiera, y la puerta también (F1 de la
  // revisión del #123). La ruta que lo lee no importa nada de la credencial.
  "sesion.ts": `
    let visto: string | null = null;
    export async function crearCliente(pista?: string) { return { pista: pista ?? null }; }
    export const recordar = (t: string) => { visto = t; };
    export const ultimaSesion = () => visto;`,
  "app/api/sesion/route.ts": `
    import { ultimaSesion } from "../../../sesion";
    export async function GET() { return ultimaSesion(); }`,
  "agencyToken.ts": `
    import { admin } from "./admin";
    export async function estado(org: string) {
      return admin().from("integration_tokens").select("expires_at").eq("organization_id", org);
    }`,
  // La puerta, con la reexportación de la segunda revisión del #118 puesta: el
  // detector tiene que verla en lo que la puerta exporta y en quién la usa. Le
  // pasa el token a cada receptor de abajo, como la de verdad a los tres suyos.
  // Y G01 de la revisión del #123: ella misma lo deja en `next/cache`, que lee
  // cualquier ruta con la misma clave, y en un global del repositorio. Y F1 de
  // la misma revisión, al final: lo que le pasa al cliente de sesión. Y
  // EV-PROTOTIPO de la segunda vuelta: el prototipo de lo que recibe.
  "servicioCompartido.ts": `
    import { unstable_cache } from "next/cache";
    import { agencyAccessToken } from "./tokenStore";
    import { crearCliente, recordar } from "./sesion";
    import { consultar } from "./receptor";
    import { consultarHermano } from "./receptorHermano";
    import { consultarGuardando } from "./receptorGuarda";
    import { consultarColgando } from "./receptorEnLaFuncion";
    import { consultarDepositando } from "./receptorDeposita";
    import { consultarAlEntorno } from "./receptorAlEntorno";
    import { consultarAlGlobal } from "./receptorAlGlobal";
    import { consultarAlDesnudo } from "./receptorGlobalDeclarado";
    import { consultarAlCanal } from "./receptorAlCanal";
    import { consultarCacheando } from "./receptorALaCache";
    import { consultarAlDisco } from "./receptorAlDisco";
    import { consultarPorElCanalGlobal } from "./receptorAlCanalGlobal";
    import { consultarEscribiendo } from "./receptorEscribeLoAjeno";
    import { consultarAlPrototipo } from "./receptorAlPrototipo";
    import { consultarHeredando } from "./receptorEscribeLoHeredado";
    const conTrampa = [consultarGuardando, consultarColgando, consultarDepositando, consultarAlEntorno, consultarAlGlobal, consultarAlDesnudo, consultarEscribiendo, consultarAlPrototipo, consultarHeredando];
    const deAfuera = [consultarAlCanal, consultarCacheando, consultarAlDisco, consultarPorElCanalGlobal];
    export async function servir(mapeos: string[]) {
      if (mapeos.length === 0) return null;
      const accessToken = String(await agencyAccessToken());
      await unstable_cache(async () => accessToken, ["virtual"])();
      ultimoDeLaPuerta = accessToken;
      for (const r of [...conTrampa, ...deAfuera]) await r({ accessToken });
      await consultarHermano({ accessToken, ahora: new Date() });
      await crearCliente();
      await crearCliente(accessToken);
      recordar(accessToken);
      (crearCliente as unknown as { ultima?: string }).ultima = accessToken;
      Object.getPrototypeOf(mapeos).__t = accessToken;
      return consultar({ accessToken, ref: mapeos[0], fetcher: fetch });
    }
    export { agencyAccessToken } from "./tokenStore";`,
  // --- Los RECEPTORES: la puerta les pasa el token (quinta revisión del #118).
  // Los dos primeros son como searchConsole.ts y ga4.ts: usan el lenguaje
  // (`JSON`, `encodeURIComponent`, `Date`) y el hermano comparte la ventana. Los
  // demás guardan el token donde lo lea otro.
  // El control de lo que se escribe: un objeto local, por asignación y por
  // `Object.assign`, no lo ve nadie más.
  "receptor.ts": `
    export const VENTANA = 28;
    export const ventana = (ahora: Date) => new Date(ahora.getTime() - VENTANA * 86_400_000).toISOString();
    export async function consultar(deps: { accessToken: string; ref: string; fetcher: typeof fetch }) {
      const pedido: { url?: string; intentos?: number } = {};
      pedido.url = "https://ejemplo.test/" + encodeURIComponent(deps.ref);
      Object.assign(pedido, { intentos: 1 });
      const r = await deps.fetcher(pedido.url, { headers: { authorization: "Bearer " + deps.accessToken } });
      return JSON.stringify({ ok: r.ok });
    }`,
  "receptorHermano.ts": `
    import { ventana } from "./receptor";
    export async function consultarHermano(deps: { accessToken: string; ahora: Date }) {
      return JSON.stringify({ desde: ventana(deps.ahora), con: deps.accessToken.length > 0 });
    }`,
  // A1 de la quinta revisión: el token en un export mutable, y una ruta nueva
  // que lo gasta. Con tsc y la pared en verde.
  "receptorGuarda.ts": `
    export const ultimoToken: { valor: string | null } = { valor: null };
    export async function consultarGuardando(deps: { accessToken: string }) { ultimoToken.valor = deps.accessToken; }`,
  "app/api/seo/search-console/route.ts": `
    import { ultimoToken } from "../../../../receptorGuarda";
    export async function GET() { return ultimoToken.valor; }`,
  // Sin ningún export mutable: el token colgado de la función que la puerta
  // usa. Una regla sobre la FORMA del export no lo ve; una sobre quién lo usa, sí.
  "receptorEnLaFuncion.ts": `
    export async function consultarColgando(deps: { accessToken: string }) {
      (consultarColgando as unknown as { t?: string }).t = deps.accessToken;
    }`,
  "usaLaFuncion.ts": `
    import { consultarColgando } from "./receptorEnLaFuncion";
    export const token = () => (consultarColgando as unknown as { t?: string }).t;`,
  // El token sale del receptor por un import: el depósito no es una credencial,
  // y quien lo lee no llega a ninguna.
  "receptorDeposita.ts": `
    import { guardar } from "./deposito";
    export async function consultarDepositando(deps: { accessToken: string }) { guardar(deps.accessToken); }`,
  "deposito.ts": `
    let guardado: string | null = null;
    export const guardar = (t: string) => { guardado = t; };
    export const leer = () => guardado;`,
  "usaElDeposito.ts": `
    import { leer } from "./deposito";
    export const token = () => leer();`,
  // Lo que comparte todo el proceso: el entorno, el objeto global, y un global
  // declarado por el repositorio, en el mismo archivo o en otro.
  "receptorAlEntorno.ts": `
    export function consultarAlEntorno(deps: { accessToken: string }) {
      process.env.CACHE_DE_GOOGLE = deps.accessToken;
    }`,
  "receptorAlGlobal.ts": `
    declare global { var cacheDeGoogle: string | undefined }
    export function consultarAlGlobal(deps: { accessToken: string }) {
      globalThis.cacheDeGoogle = deps.accessToken;
    }`,
  // Una variable, una función, una clase, un enum y un namespace: cada clase
  // de valor global que el repositorio puede declarar (F2 de la revisión del
  // #123: sin la función, la clase o el namespace, la suite seguía en verde).
  "globales.ts": `
    declare global {
      var tokenAjeno: string | undefined;
      var ultimoDeLaPuerta: string | undefined;
      var cacheDelProductor: string | undefined;
      function guardarTokenGlobal(t: string): void;
      class CajaGlobal { static token: string }
      enum NivelGlobal { Bajo }
      namespace cacheGlobal { let token: string }
    }
    export {};`,
  "receptorGlobalDeclarado.ts": `
    declare global { var tokenPropio: string | undefined }
    export function consultarAlDesnudo(deps: { accessToken: string }) {
      tokenPropio = deps.accessToken;
      tokenAjeno = deps.accessToken;
      guardarTokenGlobal(deps.accessToken);
      CajaGlobal.token = deps.accessToken;
      (NivelGlobal as unknown as { t?: string }).t = deps.accessToken;
      cacheGlobal.token = deps.accessToken;
    }`,
  // Lo de AFUERA del árbol (revisión del #123): un módulo de Node, un paquete y
  // un global del runtime, que guardan estado de todo el proceso. EV-1: la ruta
  // que recibe el token no importa nada del árbol, así que no es una fuga.
  "receptorAlCanal.ts": `
    import { channel } from "node:diagnostics_channel";
    export function consultarAlCanal(deps: { accessToken: string }) { channel("gsc").publish(deps.accessToken); }`,
  "app/api/canal/route.ts": `
    import { subscribe } from "node:diagnostics_channel";
    let visto: unknown = null;
    subscribe("gsc", (m) => { visto = m; });
    export async function GET() { return visto; }`,
  "receptorALaCache.ts": `
    import { unstable_cache } from "next/cache";
    export async function consultarCacheando(deps: { accessToken: string }) { return unstable_cache(async () => deps.accessToken, ["gsc"])(); }`,
  // Por `require()` y por `import()` literales, en un .js.
  "receptorAlDisco.js": `
    const { writeFileSync } = require("node:fs");
    export async function consultarAlDisco(deps) {
      writeFileSync("/tmp/gsc", deps.accessToken);
      await (await import("node:fs/promises")).writeFile("/tmp/gsc-2", deps.accessToken);
    }`,
  // Sin importar nada: el BroadcastChannel que declaran el lenguaje y Node.
  "receptorAlCanalGlobal.ts": `
    export function consultarPorElCanalGlobal(deps: { accessToken: string }) { new BroadcastChannel("gsc").postMessage(deps.accessToken); }`,
  // Escribir en lo que ven otros módulos (revisión del #123): un valor del
  // lenguaje, un export propio, por cada forma de escribir —asignación,
  // `Object.assign`, `Reflect.set`, destructuring, `for…of`, `++`, `delete`, un
  // `Object.assign` cuyo destino viene en un spread, `+=` y `for…in`—.
  "receptorEscribeLoAjeno.ts": `
    export const registro: { t?: string } = {};
    export function consultarEscribiendo(deps: { accessToken: string }) {
      (fetch as unknown as { t?: string }).t = deps.accessToken;
      Object.assign(registro, { t: deps.accessToken });
      Reflect.set(JSON, "t", deps.accessToken);
      [(Date as unknown as { t?: string }).t] = [deps.accessToken];
      for ((Math as unknown as { t?: string }).t of [deps.accessToken]);
      (Number as unknown as { n: number }).n++;
      delete (consultarEscribiendo as unknown as { t?: string }).t;
      Object.assign(...([registro, { t: deps.accessToken }] as const));
      ({ a: (Boolean as unknown as { t?: string }).t, ...(Error as unknown as { r: object }).r } = { a: deps.accessToken });
      [(String as unknown as { t?: string }).t = "", ...(RegExp as unknown as { r: string[] }).r] = [deps.accessToken];
      (Array as unknown as { t: string }).t += deps.accessToken;
      for ((Symbol as unknown as { t?: string }).t in { [deps.accessToken]: 1 });
    }`,
  // EV-PROTOTIPO de la segunda vuelta de la revisión del #123: de cualquier
  // valor se llega a lo que comparte todo el proceso por la cadena de
  // prototipos, y ahí se deja el token sin escribir nada (un `push` sobre
  // `Array.prototype` lo lee `[][0]` en cualquier módulo). Cada nombre que
  // lleva ahí, en cada forma: un acceso, una clave escrita, un destructuring
  // (declarado y asignado), los accesores heredados, y una clave que no se lee.
  // Y el control del `for…of`: la clave de un arreglo literal se lee.
  "receptorAlPrototipo.ts": `
    type Registro = Record<string, Record<string, string[]>>;
    export function consultarAlPrototipo(deps: { accessToken: string }) {
      const vivos: any = [];
      vivos.__proto__.push(deps.accessToken);
      (Reflect.getPrototypeOf(vivos) as string[]).push(deps.accessToken);
      vivos["constructor"].prototype.push(deps.accessToken);
      const { constructor: { prototype: lista } } = vivos;
      let Lista: unknown;
      ({ constructor: Lista } = vivos);
      lista.push(deps.accessToken, Lista);
      vivos.__defineGetter__("t", () => deps.accessToken);
      vivos.__defineSetter__("t", () => undefined);
      vivos.__lookupGetter__("t");
      vivos.__lookupSetter__("t");
      const k = ["constr", "uctor"].join("");
      (vivos as Registro)[k][["proto", "type"].join("")].push(deps.accessToken);
      const { [k]: Constructor } = vivos as Registro;
      for (const campo of ["length", "at"] as const) void vivos[campo];
      for (const campo of ["length", ["constr", "uctor"].join("")]) void (vivos as Registro)[campo];
      for ({ constructor: Lista } of [vivos]);
      ({ a: { constructor: Lista } } = { a: vivos });
      [{ constructor: Lista }] = [vivos];
      [...{ constructor: Lista }] = [vivos];
      for (const campo of ["length", ...["at"]]) void (vivos as Registro)[campo];
      (Reflect["getPrototypeOf"](vivos) as string[]).push(deps.accessToken);
      ((Object as ObjectConstructor).getPrototypeOf(vivos) as string[]).push(deps.accessToken);
      const { getPrototypeOf: delObjeto } = Object;
      void (Reflect as unknown as Registro)[k];
      for ({ constructor: Lista } in { a: 1 });
      return [Constructor, delObjeto];
    }`,
  // Lo que se ESCRIBE sin nombrar nada compartido (EV-PROTOTIPO): un método
  // heredado de un literal es el mismo en todo el proceso, y un local, un
  // parámetro, una llamada o un `let` pueden valer algo que ya existía. Sólo un
  // objeto que nació acá, en una constante con un literal, es privado: los
  // controles del final. Y no la constante de OTRO módulo, aunque sea un
  // literal: el `ultimoToken` de otro receptor, por un namespace guardado en un
  // local (el import va al final para no correr las líneas de arriba).
  "receptorEscribeLoHeredado.ts": `
    export function consultarHeredando(deps: { accessToken: string; leerEstado: () => string }) {
      (({}).toString as unknown as { t?: string }).t = deps.accessToken;
      (deps.leerEstado().trim as unknown as { t?: string }).t = deps.accessToken;
      const mapa = [].map;
      (mapa as unknown as { t?: string }).t = deps.accessToken;
      (deps.leerEstado as unknown as { t?: string }).t = deps.accessToken;
      let caja = {} as { t?: string };
      caja = deps.leerEstado as unknown as { t?: string };
      caja.t = deps.accessToken;
      Object.assign([].map, { t: deps.accessToken });
      delete (mapa as unknown as { t?: string }).t;
      const propio: { t?: string; n: number } = { n: 0 };
      propio.t = deps.accessToken;
      propio.n++;
      Object.assign(propio, { t: deps.accessToken });
      let veces = 0;
      veces += 1;
      const lista: string[] = [];
      lista[0] = deps.accessToken;
      (mapa as unknown as string[])[0] = deps.accessToken;
      const { n, ...resto } = propio;
      let otro: object = {};
      ({ ...otro } = propio);
      const g = guarda;
      g.ultimoToken.valor = deps.accessToken;
      void Object["keys"](propio);
      return { propio, veces, lista, n, resto, otro };
    }
    import * as guarda from "./receptorGuarda";`,
  // Y quien lo lee no importa nada: no es una fuga, ni usa un receptor.
  "app/api/prototipo/route.ts": `
    export async function GET() { return ([] as unknown as string[])[0] ?? (Object.prototype as { __t?: string }).__t ?? null; }`,
  "datosLegitimos.ts": `
    import { servir } from "./servicioCompartido";
    export const reporte = () => servir(["properties/1"]);`,
  // Lo mismo con un import() esperado: usa la regla de la puerta y nada más. Si
  // el namespace se contara entero, usaría también el agencyAccessToken que la
  // puerta virtual reexporta, y sería un falso positivo.
  "datosPorImportDinamico.ts": `
    export const reporte = async () => (await import("./servicioCompartido")).servir(["properties/2"]);`,
  // La anotación que SIGUE siendo el namespace: se rastrea igual de preciso.
  "datosPorImportAnotado.ts": `
    export const reporte = async () => {
      const puerta: typeof import("./servicioCompartido") = await import("./servicioCompartido");
      return puerta.servir(["properties/3"]);
    };`,
  "conexion.ts": `
    import { resolveAgencyOrgId } from "./agency";
    export const conectar = () => resolveAgencyOrgId();`,
  "yaNoLlega.ts": `export const nada = 1;`,

  // --- Por símbolo: lo que el grafo de archivos deja pasar (segunda revisión del #118).
  "atajoPorLaPuerta.ts": `
    import { agencyAccessToken } from "./servicioCompartido";
    export const clics = () => agencyAccessToken();`,
  "usaAbreviado.ts": `
    import { agencyAccessToken } from "./servicioCompartido";
    export const deps = { agencyAccessToken };`,
  "reexportaTodo.ts": `export * from "./tokenStore";`,
  "usaPorEstrella.ts": `
    import { agencyAccessToken } from "./reexportaTodo";
    export const clics = () => agencyAccessToken();`,
  "usaPorNamespace.ts": `
    import * as almacen from "./tokenStore";
    export const clics = () => almacen.agencyAccessToken();`,
  // Exento como conexión por resolveAgencyOrgId, y con una export nueva que
  // pide el token: es property-actions.ts con su server action de más.
  "conexionConToken.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import { agencyAccessToken } from "./tokenStore";
    export const operador = () => resolveAgencyOrgId();
    export async function clicsDeUnaProperty(propertyRef: string) { return { propertyRef, token: await agencyAccessToken() }; }`,
  // La misma server action de más, sin nombrar el símbolo con un identificador
  // (tercera revisión del #118): la clave es un texto, o el namespace se va a
  // otra función. Con `usa` cosechado sólo de identificadores, las seis pasaban.
  "conexionPorElemento.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import * as almacen from "./tokenStore";
    export const operador = () => resolveAgencyOrgId();
    export const clics = () => almacen["agencyAccessToken"]();`,
  "conexionPorImportDinamico.ts": `
    import { resolveAgencyOrgId } from "./agency";
    export const operador = () => resolveAgencyOrgId();
    export const clics = async () => (await import("./tokenStore"))["agencyAccessToken"]();`,
  "conexionPorClaveConst.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import * as almacen from "./tokenStore";
    const k = "agencyAccessToken" as const;
    export const operador = () => resolveAgencyOrgId();
    export const clics = () => almacen[k]();`,
  "conexionPorReflect.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import * as almacen from "./tokenStore";
    export const operador = () => resolveAgencyOrgId();
    export const clics = () => (Reflect.get(almacen, "agencyAccessToken") as () => Promise<unknown>)();`,
  "conexionPorClaveArmada.js": `
    import { resolveAgencyOrgId } from "./agency";
    import * as almacen from "./tokenStore";
    export const operador = () => resolveAgencyOrgId();
    export const clics = () => almacen[["agency", "AccessToken"].join("")]();`,
  // El namespace llega por lo que devuelve otra función: no hay identificador
  // suyo en este archivo, sólo un acceso por elemento sobre su tipo.
  "cargadorDelAlmacen.ts": `export const cargar = () => import("./tokenStore");`,
  "conexionPorCargador.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import { cargar } from "./cargadorDelAlmacen";
    export const operador = () => resolveAgencyOrgId();
    export const clics = async () => (await cargar())["agencyAccessToken"]();`,
  "conexionPorPatronComputado.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import * as almacen from "./tokenStore";
    export const operador = () => resolveAgencyOrgId();
    export const clics = () => { const { ["agencyAccessToken"]: token } = almacen; return token(); };`,
  // La variable anotada con un tipo que ya no es el namespace (EV-2 de la
  // revisión del #123): sin aserción, la variable deja de ser el namespace y su
  // `.agencyAccessToken` no tiene símbolo. Con un `import()` y con un
  // `import * as`.
  "conexionPorAnotacion.ts": `
    import { resolveAgencyOrgId } from "./agency";
    export const operador = () => resolveAgencyOrgId();
    export const clics = async () => {
      const almacen: Record<string, (...a: never[]) => unknown> = await import("./tokenStore");
      return almacen.agencyAccessToken();
    };`,
  "conexionPorAny.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import * as almacen from "./tokenStore";
    export const operador = () => resolveAgencyOrgId();
    export const clics = () => { const a: any = almacen; return a.agencyAccessToken(); };`,
  // Lo mismo sobre un receptor, desde un módulo de conexión, que no es fuga.
  "conexionAlReceptor.ts": `
    import { resolveAgencyOrgId } from "./agency";
    export const operador = () => resolveAgencyOrgId();
    export const ultimo = async () => {
      const r: Record<string, unknown> = await import("./receptorGuarda");
      return r.ultimoToken;
    };`,
  // La clave dice ser otra pieza que existe (cuarta revisión del #118): con la
  // clave leída de su TIPO, esto usaba `proveedor` y no el token.
  "conexionPorClaveAsertada.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import * as almacen from "./tokenStore";
    export const operador = () => resolveAgencyOrgId();
    export const clics = () => (almacen[("agency" + "AccessToken") as "proveedor"] as unknown as () => Promise<unknown>)();`,

  // --- La variable, por las tres formas de la revisión del #118 y una más.
  "asConst.ts": `
    const AGENCIA_ENV = "VULKAN_AGENCY_ORG_ID" as const;
    export function organizacionParaGoogle(org: string | null) { return org ?? process.env[AGENCIA_ENV]; }`,
  "constLocal.ts": `
    export function organizacionParaGoogleLocal(org: string | null) {
      const VARIABLE = "VULKAN_AGENCY_ORG_ID";
      return org ?? process.env[VARIABLE];
    }`,
  "agenciaPorDefecto.js": `
    export function organizacionDeLaAgencia() { return process.env.VULKAN_AGENCY_ORG_ID; }`,
  "reexporta.ts": `export { organizacionDeLaAgencia } from "./agenciaPorDefecto";`,
  "constanteImportada.ts": `
    import { AGENCY_ORG_ID_ENV } from "./agency";
    export const agencia = () => process.env[AGENCY_ORG_ID_ENV];`,
  "desestructurada.ts": `
    export function agencia() { const { VULKAN_AGENCY_ORG_ID: id } = process.env; return id; }`,
  // La constante de un `for…of` sobre un arreglo literal vale uno de sus
  // elementos (segunda vuelta de la revisión del #123): la clave se lee, y es
  // la de la agencia. Con un elemento que no está escrito, no se sabe (abajo).
  "porBucle.ts": `
    export const agencia = () => { for (const k of ["VULKAN_AGENCY_ORG_ID"] as const) return process.env[k]; return undefined; };`,

  // --- El entorno, con una clave que no se puede saber.
  "claveArmada.ts": `
    export const agencia = () => process.env[["VULKAN", "AGENCY", "ORG", "ID"].join("_")];`,
  "entornoEscapado.ts": `
    export const agencia = () => Object.entries(process.env).find(([k]) => k.endsWith("AGENCY_ORG_ID"))?.[1];`,
  "entornoGuardado.ts": `
    const e: Record<string, string | undefined> = process.env;
    export const agencia = () => e["VULKAN_AGENCY_ORG_ID"];`,
  "restoDelEntorno.ts": `
    const { ...todo } = process.env;
    export const agencia = () => todo.VULKAN_AGENCY_ORG_ID;`,
  "porBucleArmado.ts": `
    export const agencia = () => { for (const k of ["OTRA_VARIABLE", "VULKAN_AGENCY" + "_ORG_ID"]) return process.env[k]; return undefined; };`,
  // Un `for…in` sobre un arreglo literal recorre sus índices, no sus textos.
  "porBucleIn.ts": `
    export const agencia = () => { for (const k in ["VULKAN_AGENCY_ORG_ID"]) return process.env[k]; return undefined; };`,

  // --- El entorno, con una clave que sólo el TIPO enumera (cuarta revisión del
  // #118). La pared se creía el tipo de la clave, y un tipo se afirma: con tsc y
  // la pared en verde, P1, P5 y sus variantes leían la variable de la agencia.
  // Y no hace falta una aserción: un parámetro, un arreglo covariante o un `any`
  // ponen en una clave «de tipo literal» un texto armado en ejecución.
  "asercionALiteral.ts": `
    export function clave() {
      const clave = ("VULKAN_AGENCY" + "_ORG_ID") as "OPENAI_API_KEY";
      return process.env[clave];
    }`,
  "asercionAUnion.ts": `
    type VariableDePlataforma = "OPENAI_API_KEY" | "SENTRY_DSN";
    export const leer = (nombre: string) => process.env[nombre as VariableDePlataforma];`,
  "asercionAngular.ts": `
    export const agencia = () => process.env[<"OPENAI_API_KEY">("VULKAN_AGENCY" + "_ORG_ID")];`,
  "asercionJsdoc.js": `
    export const leer = (nombre) => process.env[/** @type {"OPENAI_API_KEY"} */ (nombre)];`,
  // La aserción no está en la lectura: está en quien llama.
  "claveDeParametro.ts": `
    function leer(k: "OPENAI_API_KEY") { return process.env[k]; }
    export const agencia = () => leer(("VULKAN_AGENCY" + "_ORG_ID") as "OPENAI_API_KEY");`,
  // Sin ninguna aserción: el control de antes, que se creía el tipo de `k`.
  "claveDeTipo.ts": `
    type Clave = "OTRA_VARIABLE" | "Y_OTRA";
    export const leer = (k: Clave) => process.env[k];`,
  "claveCovariante.ts": `
    const literales: "OPENAI_API_KEY"[] = ["OPENAI_API_KEY"];
    const textos: string[] = literales;
    textos.push("VULKAN_AGENCY" + "_ORG_ID");
    export const agencia = () => process.env[literales[1]];`,
  "claveDeJson.ts": `
    const k: "OPENAI_API_KEY" = JSON.parse('"VULKAN_AGENCY' + '_ORG_ID"');
    export const agencia = () => process.env[k];`,
  // Un `let` vale lo último que alguien le asignó, y una condición vale
  // cualquiera de sus dos ramas: con una armada, no se sabe.
  "claveLet.ts": `
    let clave = "OPENAI_API_KEY";
    export const cambiar = (v: string) => { clave = v; };
    export const agencia = () => process.env[clave];`,
  "claveCondicionalArmada.ts": `
    export const agencia = (c: boolean) => process.env[c ? "OTRA_VARIABLE" : "VULKAN_AGENCY" + "_ORG_ID"];`,
  // Una constante ambiental dice qué vale algo que pone otro en ejecución.
  "claveAmbiental.ts": `
    declare const CLAVE = "OPENAI_API_KEY";
    export const agencia = () => process.env[CLAVE];`,
  // Y `process` con una clave asertada: el resultado ya no es un entorno.
  "procesoClaveAsertada.ts": `
    export const agencia = () => (process[("e" + "nv") as "title"] as unknown as Record<string, string>)["VULKAN_AGENCY_ORG_ID"];`,

  // --- El entorno, sacándole el tipo a `process` (tercera revisión del #118). El
  // rastreo empezaba en lo tipado como entorno, y `process` es un `Process`: un
  // `as any` o un `Reflect.get` le borraban el tipo antes de llegar a `.env`.
  "procesoComoAny.ts": `
    export const agencia = () => (process as any).env.VULKAN_AGENCY_ORG_ID;`,
  "procesoReflect.ts": `
    export const agencia = () => Reflect.get(process, "env").VULKAN_AGENCY_ORG_ID;`,
  "procesoGlobalThisAny.ts": `
    export const agencia = () => (globalThis as any).process.env.VULKAN_AGENCY_ORG_ID;`,
  "procesoDescriptor.ts": `
    export const agencia = () => Object.getOwnPropertyDescriptor(process, "env")?.value?.VULKAN_AGENCY_ORG_ID;`,
  "procesoImportado.ts": `
    import proceso from "node:process";
    export const agencia = () => (proceso as any).env.VULKAN_AGENCY_ORG_ID;`,
  "procesoGuardado.js": `
    const p = /** @type {any} */ (process);
    export const agencia = () => p["env"]["VULKAN_AGENCY_ORG_ID"];`,
  // Con el tipo intacto, por el objeto global: es una lectura, y se ve como tal.
  "procesoPorElGlobal.ts": `
    export const agencia = () => globalThis.process.env.VULKAN_AGENCY_ORG_ID;`,

  // --- La custodia, sin pasar por la variable.
  "secretoDirecto.ts": `
    import { admin } from "./admin";
    export async function secretoDeQuienTengaToken() {
      const { data: filas } = await admin().from("integration_tokens").select("organization_id").is("revoked_at", null).limit(1);
      const org = filas?.[0]?.organization_id;
      if (!org) return null;
      const { data } = await admin().rpc("integration_token_secret", { p_organization_id: org, p_provider: "google" });
      return typeof data === "string" ? data : null;
    }`,
  "usaElSecreto.ts": `
    import { secretoDeQuienTengaToken } from "./secretoDirecto";
    export const reporte = () => secretoDeQuienTengaToken();`,
  "rpcArmada.ts": `
    import { admin } from "./admin";
    const nombre: string = ["integration", "token", "secret"].join("_");
    export const secreto = () => admin().rpc(nombre, {});`,
  // La base con una aserción (cuarta revisión del #118): P2 pedía el secreto con
  // `service_role` y la pared lo leía como `current_user_org_ids`.
  "asercionEnLaCustodia.ts": `
    import { admin } from "./admin";
    export const secreto = () => admin().rpc(("integration_token" + "_secret") as "current_user_org_ids", {} as never);`,
  // La aserción en el método, o en el cliente: la firma deja de ser de @supabase.
  "calleeAsertado.ts": `
    import { admin } from "./admin";
    export const secreto = () => (admin().rpc as unknown as (nombre: string) => unknown)("integration_token" + "_secret");`,
  "receptorAsertado.ts": `
    import { admin } from "./admin";
    type Llamador = { rpc(nombre: string): unknown };
    export const secreto = () => (admin() as unknown as Llamador).rpc("integration_token" + "_secret");`,
  "clienteComoIndice.ts": `
    import { admin } from "./admin";
    const c = admin() as unknown as Record<string, (nombre: string) => unknown>;
    export const secreto = () => c["rpc"]("integration_token" + "_secret");`,
  // Sin aserción: el método sacado del cliente, y llamado después.
  "rpcEnlazada.ts": `
    import { admin } from "./admin";
    const llamar = admin().rpc.bind(admin());
    export const secreto = () => llamar("integration_token" + "_secret");`,
  "rpcDesestructurada.ts": `
    import { admin } from "./admin";
    export const secreto = () => { const { rpc } = admin(); return rpc.call(admin(), "integration_token" + "_secret"); };`,
  "rpcPorAsignacion.ts": `
    import { admin } from "./admin";
    let r: unknown;
    ({ rpc: r } = admin());
    export const secreto = () => (r as (nombre: string) => unknown)("integration_token" + "_secret");`,
  // En un .js, la aserción es un JSDoc sobre un paréntesis.
  "clienteJsdoc.js": `
    import { admin } from "./admin";
    const c = /** @type {Record<string, Function>} */ (/** @type {unknown} */ (admin()));
    export const secreto = () => c["rpc"]("integration_token" + "_secret");`,
  "rpcPorElemento.ts": `
    import { admin } from "./admin";
    export const secreto = () => admin()[["r", "p", "c"].join("") as "rpc"]("integration_token" + "_secret");`,
  // El cliente entra a `unknown` sin aserción y sale por una firma de índice
  // (EV-3 de la revisión del #123): la aserción no pierde ningún método
  // declarado, y el `.rpc` de un índice no era de la base.
  "clientePorIndice.ts": `
    import { admin } from "./admin";
    type Indice = { [m: string]: (...a: unknown[]) => unknown };
    export const secreto = (org: string) => { const c: unknown = admin(); return (c as Indice).rpc("integration_token" + "_secret", { p_organization_id: org }); };`,
  "clientePorRegistro.ts": `
    import { admin } from "./admin";
    export const secreto = () => {
      const c: unknown = admin();
      const r = (c as Record<string, unknown>).rpc as (nombre: string) => unknown;
      return r("integration_token" + "_secret");
    };`,
  // Por el mismo índice, con el nombre del método armado.
  "clientePorIndiceArmado.ts": `
    import { admin } from "./admin";
    type Indice = { [m: string]: (...a: unknown[]) => unknown };
    export const secreto = () => {
      const c: unknown = admin();
      return (c as Indice)[["r", "p", "c"].join("")]("integration_token" + "_secret");
    };`,
  // Cada clase de índice de texto que acepta TypeScript, y una unión que lo
  // trae en uno solo de sus miembros (F2 de la revisión del #123: sin estos,
  // contar sólo `string`, o mirar la unión entera, dejaba la suite en verde).
  "clientePorIndicePlantilla.ts": `
    import { admin } from "./admin";
    type Indice = { [m: \`r\${string}\`]: (...a: unknown[]) => unknown };
    export const secreto = () => { const c: unknown = admin(); return (c as Indice).rpc("integration_token" + "_secret"); };`,
  "clientePorIndiceMinusculas.ts": `
    import { admin } from "./admin";
    type Indice = { [m: Lowercase<string>]: (...a: unknown[]) => unknown };
    export const secreto = () => { const c: unknown = admin(); return (c as Indice).rpc("integration_token" + "_secret"); };`,
  "clientePorUnion.js": `
    import { admin } from "./admin";
    /** @typedef {{ [m: string]: (...a: unknown[]) => unknown }} Indice */
    /** @typedef {{ otra: number }} Otra */
    export const secreto = () => {
      /** @type {unknown} */
      const c = admin();
      const u = /** @type {Indice | Otra} */ (c);
      return u.rpc("integration_token" + "_secret");
    };`,
  "urlCruda.ts": `
    export const secreto = (url: string) => fetch(url + "/rest/v1/rpc/integration_token_secret", { method: "POST" });`,
  "esquemaDelVault.ts": `
    import { admin } from "./admin";
    export const secretos = () => admin().schema("vault").from("secrets").select("*");`,

  // --- El grafo: lo que no se puede seguir, y lo que no está en la lista de convenciones.
  "importDinamico.ts": `
    const destino = "./" + "tokenStore";
    export const token = async () => (await import(destino)).agencyAccessToken();`,
  // Webpack se saca el query y carga tokenStore.ts; tsc no lo resuelve.
  "importConQuery.js": `
    import { agencyAccessToken } from "./tokenStore.ts?fallback";
    export const clics = () => agencyAccessToken();`,
  "importInexistente.ts": `
    import { algo } from "./noExiste";
    export const valor = () => algo;`,
  // Cargas que resuelve webpack sin `import()` ni `require("literal")` (tercera
  // revisión del #118: `require.context` empaquetaba tokenStore.ts en una ruta
  // con la pared, tsc, eslint y next build en verde).
  "datosRequireContext.js": `
    const ctx = require.context("./", false, /tokenStore\\.ts$/);
    export const clics = () => ctx(ctx.keys()[0]).agencyAccessToken();`,
  "datosWebpackContext.js": `
    const ctx = import.meta.webpackContext("./", { recursive: false, regExp: /tokenStore\\.ts$/ });
    export const clics = () => ctx(ctx.keys()[0]).agencyAccessToken();`,
  "datosModuleRequire.js": `
    export const clics = () => module.require("./tokenStore").agencyAccessToken();`,
  "datosNonWebpackRequire.js": `
    export const clics = () => __non_webpack_require__("./tokenStore").agencyAccessToken();`,
  "datosWebpackRequire.js": `
    export const clics = (id) => __webpack_require__(id).agencyAccessToken();`,
  "datosRequireAlias.js": `
    const cargar = require;
    export const clics = () => cargar("./tokenStore").agencyAccessToken();`,
  // Next lo sirve como ruta: el segmento no empieza con «_». No es un test.
  "app/api/clics__tests__/route.ts": `
    import { agencyAccessToken } from "../../../tokenStore";
    export async function GET() { return agencyAccessToken(); }`,
  "app/reports/template.tsx": `
    import { agencyAccessToken } from "../../tokenStore";
    export default async function Template({ children }: { children: unknown }) {
      const token = await agencyAccessToken();
      return { conectado: token ? "si" : "no", children };
    }`,
  "instrumentation.ts": `
    import { conectar } from "./conexion";
    export const register = () => conectar();`,

  // --- Controles: nada de esto es una lectura, un camino ni una fuga.
  "controlMensaje.ts": `
    // Un comentario que dice process.env.VULKAN_AGENCY_ORG_ID no lee nada.
    export const aviso = () => { throw new Error("falta VULKAN_AGENCY_ORG_ID: es la organización de la agencia"); };`,
  "controlSoloTipos.ts": `
    import type { agencyAccessToken } from "./tokenStore";
    export type T = typeof agencyAccessToken;`,
  // Otras variables, con la clave escrita de las formas que se leen: un
  // literal, una constante (también de otra constante), una condición entre
  // ellas y un template sin sustituciones.
  "constantes.ts": `export const DE_UN_MODULO = "Y_DE_UN_MODULO";`,
  "controlOtrasVariables.ts": `
    import * as constantes from "./constantes";
    const A = "OTRA_VARIABLE";
    const B = A;
    const C = Math.random() > 0.5 ? "Y_OTRA" : B;
    export const leer = () => process.env[C] ?? process.env["MAS_OTRA"] ?? process.env[\`Y_UNA_MAS\`];
    export const delModulo = () => process.env[constantes.DE_UN_MODULO];`,
  // La base usada como se usa, y lo que se llama igual sin ser la base.
  "controlLaBase.ts": `
    import { admin } from "./admin";
    const TABLA = "businesses" as const;
    export const negocios = () => admin().from(TABLA).select("id");
    export const funcion = (c: boolean) => admin().rpc(c ? "current_user_org_ids" : "otra_funcion");
    export const opcional = () => admin()?.from("reports");
    export const noNula = () => admin().from!("reports");
    export const tipo = () => typeof admin().schema;`,
  "controlNoEsLaBase.ts": `
    export const semanas = (xs: number[]) => Array.from(new Set(xs));
    export const bytes = (s: string) => Buffer.from(s, "utf8");
    export const tipos = (lectura: { schema: string[] }) => lectura.schema.length;
    const pasos: Array<() => number> = [() => 1];
    export const paso = (i: number) => pasos[i]();
    const acciones: Record<string, () => number> = { uno: () => 1 };
    export const accion = () => acciones.uno();
    export const campo = (fila: Record<string, unknown>, k: string) => fila[k];`,
  "controlPasaElEntorno.ts": `
    function leer(env: NodeJS.ProcessEnv) { return env.OTRA_VARIABLE; }
    export const valor = () => leer(process.env);`,
  // `process`, el objeto global y `require` usados como se usan: nada se escapa.
  "controlProceso.ts": `
    export const donde = () => process.cwd() + process.platform + String(typeof process) + String(process.env.OTRA_VARIABLE);
    export const red = () => globalThis.fetch;
    export const enElNavegador = () => typeof window !== "undefined" && typeof globalThis.window !== "undefined";
    export const aqui = () => import.meta.url;`,
  "controlRequireLiteral.js": `
    const { randomUUID } = require("node:crypto");
    export const id = () => randomUUID();
    export const exportado = () => typeof module !== "undefined" && module.exports;`,
  // Lo que resuelve el bundler y no es código del repo: un módulo de Node, el
  // marcador de Next y una hoja de estilos.
  "controlEstilos.ts": `
    import "server-only";
    import "./estilos.css";
    import { randomUUID } from "node:crypto";
    export const id = () => randomUUID();`,
  // Un directorio __tests__ de verdad: carpeta privada para Next, y test.
  "app/api/x/__tests__/ayuda.ts": `
    import { agencyAccessToken } from "../../../../tokenStore";
    export const ayuda = () => agencyAccessToken();`,
};

/** Las exenciones de conexión que piden el token sin nombrarlo con un identificador. */
const CONEXION_SIN_IDENTIFICADOR = [
  "conexionPorAnotacion.ts",
  "conexionPorAny.ts",
  "conexionPorCargador.ts",
  "conexionPorClaveArmada.js",
  "conexionPorClaveAsertada.ts",
  "conexionPorClaveConst.ts",
  "conexionPorElemento.ts",
  "conexionPorImportDinamico.ts",
  "conexionPorPatronComputado.ts",
  "conexionPorReflect.ts",
];

/**
 * De ésas, las que no dicen QUÉ pieza piden —la clave no está escrita, o el
 * namespace se va a otra función—: usan todo lo que el almacén exporta.
 */
const USAN_TODO_EL_ALMACEN = [
  "conexionPorAnotacion.ts",
  "conexionPorAny.ts",
  "conexionPorClaveArmada.js",
  "conexionPorClaveAsertada.ts",
  "conexionPorReflect.ts",
];

/** Los receptores virtuales que guardan el token donde lo lea otro, con la función que les pasa la puerta. */
const RECEPTORES_CON_TRAMPA: ReadonlyArray<readonly [string, string]> = [
  ["receptorGuarda.ts", "consultarGuardando"],
  ["receptorEnLaFuncion.ts", "consultarColgando"],
  ["receptorDeposita.ts", "consultarDepositando"],
  ["receptorAlEntorno.ts", "consultarAlEntorno"],
  ["receptorAlGlobal.ts", "consultarAlGlobal"],
  ["receptorGlobalDeclarado.ts", "consultarAlDesnudo"],
  ["receptorAlCanal.ts", "consultarAlCanal"],
  ["receptorALaCache.ts", "consultarCacheando"],
  ["receptorAlDisco.js", "consultarAlDisco"],
  ["receptorAlCanalGlobal.ts", "consultarPorElCanalGlobal"],
  ["receptorEscribeLoAjeno.ts", "consultarEscribiendo"],
  ["receptorAlPrototipo.ts", "consultarAlPrototipo"],
  ["receptorEscribeLoHeredado.ts", "consultarHeredando"],
];

const POLITICA_VIRTUAL: Politica = {
  variable: VARIABLE,
  lector: `${V}/agency.ts`,
  nadieLee: [],
  puerta: `${V}/servicioCompartido.ts`,
  custodia: {
    integration_token_secret: [`${V}/tokenStore.ts`],
    refresh_integration_token: [],
    store_integration_token: [],
    integration_tokens: [`${V}/agencyToken.ts`],
    decrypted_secrets: [],
  },
  exportaLaPuerta: ["servir"],
  productoresDelToken: [`${V}/tokenStore.ts#agencyAccessToken`],
  conexion: [
    { modulo: `${V}/conexion.ts`, usa: [`${V}/agency.ts#resolveAgencyOrgId`] },
    { modulo: `${V}/conexionConToken.ts`, usa: [`${V}/agency.ts#resolveAgencyOrgId`] },
    ...CONEXION_SIN_IDENTIFICADOR.map((m) => ({ modulo: `${V}/${m}`, usa: [`${V}/agency.ts#resolveAgencyOrgId`] })),
    { modulo: `${V}/conexionAlReceptor.ts`, usa: [`${V}/agency.ts#resolveAgencyOrgId`] },
    { modulo: `${V}/yaNoLlega.ts`, usa: [] },
  ],
  // `usadoPor` es lo que la política DECLARA; lo que se mide está en el test.
  receptores: [
    { modulo: `${V}/receptor.ts`, usadoPor: { [`${V}/servicioCompartido.ts`]: ["consultar"], [`${V}/receptorHermano.ts`]: ["ventana"] } },
    { modulo: `${V}/receptorHermano.ts`, usadoPor: { [`${V}/servicioCompartido.ts`]: ["consultarHermano"] } },
    ...RECEPTORES_CON_TRAMPA.map(([m, f]) => ({ modulo: `${V}/${m}`, usadoPor: { [`${V}/servicioCompartido.ts`]: [f] } })),
  ],
  tenedores: [
    { modulo: `${V}/tokenStore.ts`, usadoPor: { [`${V}/servicioCompartido.ts`]: ["agencyAccessToken"] } },
    { modulo: `${V}/oauth.ts`, usadoPor: { [`${V}/tokenStore.ts`]: ["refrescar"] } },
  ],
};

let virtual: Veredicto;
let analisisVirtual: Analisis;

/** Lo que dice un sitio de la cadena de prototipos, y uno con una clave que no se lee (ver `REFLEXIVOS`). */
const CADENA = ": la cadena de prototipos, que comparte todo el proceso: ";
const NO_ESCRITA = "una clave que no está escrita, que puede ser constructor, prototype o __proto__: ";

describe("el detector ve cada forma conocida de saltarse la pared, y nada más", () => {
  beforeAll(() => {
    const opciones = opcionesDelProyecto(ROOT);
    const archivos = new Map(
      Object.entries(VIRTUALES).map(([nombre, texto]) => [path.join(ROOT, V, nombre), texto])
    );
    analisisVirtual = analizar(ROOT, [...archivos.keys()], opciones, hostEnMemoria(opciones, archivos));
    virtual = juzgar(analisisVirtual, POLITICA_VIRTUAL);
  }, 180_000);

  const en = (nombres: string[]) => nombres.map((n) => `${V}/${n}`).sort();
  const archivosDe = (sitios: string[]) => [...new Set(sitios.map((s) => s.split(":")[0]))].sort();

  it("analizó todas las fuentes, también los .js, y sólo el __tests__ de verdad es test", () => {
    expect(virtual.produccion).toEqual(en(Object.keys(VIRTUALES).filter((n) => n !== "app/api/x/__tests__/ayuda.ts")));
  });

  it("un test es un segmento __tests__ exacto o un .test/.spec, no una subcadena", () => {
    expect(esTest("src/app/api/clics__tests__/route.ts")).toBe(false);
    expect(esTest("src/app/api/__tests__x/route.ts")).toBe(false);
    expect(esTest("src/app/api/x/__tests__/route.ts")).toBe(true);
    expect(esTest("src/lib/__tests__/a.ts")).toBe(true);
    expect(esTest("src/lib/a.test.ts")).toBe(true);
    expect(esTest("src/lib/a.spec.tsx")).toBe(true);
    expect(esTest("src/test/server-only.stub.ts")).toBe(true);
  });

  it("la variable: el `as const`, la constante local, el .js, la importada, el destructuring y por el objeto global", () => {
    expect(virtual.lectoresDe(VARIABLE)).toEqual(
      en([
        "agency.ts",
        "asConst.ts",
        "constLocal.ts",
        "agenciaPorDefecto.js",
        "constanteImportada.ts",
        "desestructurada.ts",
        "porBucle.ts",
        "procesoPorElGlobal.ts",
      ])
    );
  });

  it("el entorno con clave desconocida: armada, escapada, guardada como otra cosa, el resto, o sólo enumerada por su tipo", () => {
    expect(archivosDe(virtual.envOpaco)).toEqual(
      en([
        "asercionALiteral.ts",
        "asercionAUnion.ts",
        "asercionAngular.ts",
        "asercionJsdoc.js",
        "claveAmbiental.ts",
        "claveArmada.ts",
        "claveCondicionalArmada.ts",
        "claveCovariante.ts",
        "claveDeJson.ts",
        "claveDeParametro.ts",
        "claveDeTipo.ts",
        "claveLet.ts",
        "entornoEscapado.ts",
        "entornoGuardado.ts",
        "porBucleArmado.ts",
        "porBucleIn.ts",
        "procesoClaveAsertada.ts",
        "procesoComoAny.ts",
        "procesoDescriptor.ts",
        "procesoGlobalThisAny.ts",
        "procesoGuardado.js",
        "procesoImportado.ts",
        "procesoReflect.ts",
        "restoDelEntorno.ts",
      ])
    );
  });

  it("una clave que sólo el TIPO enumera no se sabe: la aserción, el parámetro y `process`, cada uno en su sitio", () => {
    // Cuarta revisión del #118: P1, P5 y la aserción en quien llama leían la
    // variable de la agencia con tsc y la pared en verde. Por SITIO: la
    // lectura que se marca es la del entorno, no la aserción de más arriba.
    const sitios = virtual.envOpaco.join("\n");
    expect(sitios).toContain(`${V}/asercionALiteral.ts:4 clave que no está escrita: clave`);
    expect(sitios).toContain(`${V}/asercionAUnion.ts:3 clave que no está escrita: nombre as VariableDePlataforma`);
    expect(sitios).toContain(`${V}/claveDeParametro.ts:2 clave que no está escrita: k`);
    expect(sitios).toContain(`${V}/claveCovariante.ts:5 clave que no está escrita: literales[1]`);
    expect(sitios).toContain(`${V}/procesoClaveAsertada.ts:2 process se lee con una clave que no está escrita`);
  });

  it("`process` y el objeto global sin su tipo son entorno de clave desconocida, y cada sitio se nombra", () => {
    // Por SITIO, no sólo por archivo: el `as any`, el `Reflect.get`, el
    // descriptor y el global, cada uno con su línea.
    const sitios = virtual.envOpaco.join("\n");
    expect(sitios).toContain(`${V}/procesoComoAny.ts:2 process se escapa`);
    expect(sitios).toContain(`${V}/procesoReflect.ts:2 process se escapa`);
    expect(sitios).toContain(`${V}/procesoDescriptor.ts:2 process se escapa`);
    expect(sitios).toContain(`${V}/procesoGlobalThisAny.ts:2 el objeto global se escapa`);
    expect(sitios).toContain(`${V}/procesoImportado.ts:3 process se escapa`);
    expect(sitios).toContain(`${V}/procesoGuardado.js:2 process se escapa`);
  });

  it("la custodia: el secreto pedido directo con service_role, y por una URL de PostgREST", () => {
    expect(virtual.custodios.integration_token_secret).toEqual(
      en(["secretoDirecto.ts", "tokenStore.ts", "urlCruda.ts"])
    );
    expect(virtual.custodios.integration_tokens).toEqual(en(["agencyToken.ts", "secretoDirecto.ts"]));
    expect(virtual.esquemas).toEqual(["vault"]);
  });

  it("un método de la base con un nombre que no se lee: armado, asertado, o sacado del cliente", () => {
    expect(archivosDe(virtual.supabaseOpaco)).toEqual(
      en([
        "asercionEnLaCustodia.ts",
        "calleeAsertado.ts",
        "clienteComoIndice.ts",
        "clienteJsdoc.js",
        "clientePorIndice.ts",
        "clientePorIndiceArmado.ts",
        "clientePorIndiceMinusculas.ts",
        "clientePorIndicePlantilla.ts",
        "clientePorRegistro.ts",
        "clientePorUnion.js",
        "receptorAsertado.ts",
        "rpcArmada.ts",
        "rpcDesestructurada.ts",
        "rpcEnlazada.ts",
        "rpcPorAsignacion.ts",
        "rpcPorElemento.ts",
      ])
    );
    // Por SITIO: P2 de la cuarta revisión del #118, y cada forma con su motivo.
    const sitios = virtual.supabaseOpaco.join("\n");
    expect(sitios).toContain(`${V}/asercionEnLaCustodia.ts:3 .rpc(("integration_token" + "_secret") as "current_user_org_ids")`);
    expect(sitios).toContain(`${V}/calleeAsertado.ts:3 .rpc("integration_token" + "_secret")`);
    expect(sitios).toContain(`${V}/receptorAsertado.ts:4 .rpc("integration_token" + "_secret")`);
    expect(sitios).toContain(`${V}/receptorAsertado.ts:4 una aserción le saca el tipo a .rpc, .from, .schema`);
    expect(sitios).toContain(`${V}/clienteComoIndice.ts:3 una aserción le saca el tipo a .rpc, .from, .schema`);
    expect(sitios).toContain(`${V}/rpcEnlazada.ts:3 .rpc sin llamarlo`);
    expect(sitios).toContain(`${V}/rpcDesestructurada.ts:3 destructuring de un método de la base`);
    expect(sitios).toContain(`${V}/rpcPorAsignacion.ts:4 destructuring de un método de la base`);
    expect(sitios).toContain(`${V}/clienteJsdoc.js:3 una aserción le saca el tipo a .rpc, .from, .schema`);
    expect(sitios).toContain(`${V}/rpcPorElemento.ts:3 un método que puede ser de la base, con un nombre que no se lee`);
    // EV-3 de la revisión del #123: el cliente que pasó por `unknown` y sale por
    // un índice. La llamada, la aserción a un índice que se puede llamar, y el
    // `.rpc` leído de un registro de valores `unknown`.
    expect(sitios).toContain(`${V}/clientePorIndice.ts:4 .rpc("integration_token" + "_secret")`);
    expect(sitios).toContain(`${V}/clientePorIndice.ts:4 una aserción de algo sin tipo a un índice que se puede llamar: c as Indice`);
    expect(sitios).toContain(`${V}/clientePorRegistro.ts:5 .rpc sin llamarlo`);
    expect(sitios).toContain(`${V}/clientePorIndiceArmado.ts:6 un método que puede ser de la base, con un nombre que no se lee`);
    // F2 de la revisión del #123: el índice de un template literal, el de un
    // `Lowercase<string>`, y una unión que trae el índice en uno de sus miembros.
    for (const f of ["clientePorIndicePlantilla.ts", "clientePorIndiceMinusculas.ts"]) {
      expect(sitios).toContain(`${V}/${f}:4 .rpc("integration_token" + "_secret")`);
      expect(sitios).toContain(`${V}/${f}:4 una aserción de algo sin tipo a un índice que se puede llamar: c as Indice`);
    }
    expect(sitios).toContain(`${V}/clientePorUnion.js:8 una aserción de algo sin tipo a un índice que se puede llamar: (c)`);
    expect(sitios).toContain(`${V}/clientePorUnion.js:9 .rpc("integration_token" + "_secret")`);
  });

  it("el grafo: un import() que no se puede seguir, uno con query, uno que no resuelve, y las cargas de webpack", () => {
    expect(archivosDe(virtual.sinResolver)).toEqual(
      en([
        "datosModuleRequire.js",
        "datosNonWebpackRequire.js",
        "datosRequireAlias.js",
        "datosRequireContext.js",
        "datosWebpackContext.js",
        "datosWebpackRequire.js",
        "importConQuery.js",
        "importDinamico.ts",
        "importInexistente.ts",
      ])
    );
    const sitios = virtual.sinResolver.join("\n");
    expect(sitios).toContain('"./tokenStore.ts?fallback": lleva ? o #');
    expect(sitios).toContain(`${V}/datosRequireContext.js:2 require que no es require("literal")`);
    expect(sitios).toContain(`${V}/datosWebpackContext.js:2 import.meta.webpackContext`);
  });

  it("las fugas: template.tsx, instrumentation.ts, el .js reexportado, la ruta clics__tests__, y quien importa una fuga", () => {
    // Los que leen la variable o nombran la custodia ya están arriba, en su
    // propia regla; acá están los que LLEGAN a uno de ellos sin la puerta.
    const origenes = virtual.fugas.map((f) => f.split(" -> ")[0]).sort();
    expect(origenes).toEqual(
      en([
        "app/api/clics__tests__/route.ts",
        "app/api/seo/search-console/route.ts",
        "app/reports/template.tsx",
        "cargadorDelAlmacen.ts",
        "instrumentation.ts",
        "reexporta.ts",
        "reexportaTodo.ts",
        "usaElSecreto.ts",
        "usaLaFuncion.ts",
        "usaPorEstrella.ts",
        "usaPorNamespace.ts",
      ])
    );
    // La exención no se hereda: instrumentation.ts llega POR la de conexión.
    expect(virtual.fugas).toContain([`${V}/instrumentation.ts`, `${V}/conexion.ts`, `${V}/agency.ts`].join(" -> "));
    // Un receptor es una credencial más para el grafo: A1 de la quinta revisión.
    expect(virtual.fugas).toContain([`${V}/app/api/seo/search-console/route.ts`, `${V}/receptorGuarda.ts`].join(" -> "));
  });

  describe("los receptores del token (quinta revisión del #118)", () => {
    const puerta = `${V}/servicioCompartido.ts`;

    it("por símbolo: quién usa cada export de un receptor, sea un objeto mutable o la función que la puerta llama", () => {
      expect(virtual.usosDeLosReceptores).toEqual({
        [`${V}/receptor.ts`]: { [puerta]: ["consultar"], [`${V}/receptorHermano.ts`]: ["ventana"] },
        [`${V}/receptorHermano.ts`]: { [puerta]: ["consultarHermano"] },
        // A1: la ruta nueva usa el export donde el receptor dejó el token.
        [`${V}/receptorGuarda.ts`]: {
          [puerta]: ["consultarGuardando"],
          [`${V}/app/api/seo/search-console/route.ts`]: ["ultimoToken"],
          // EV-2: el namespace en una variable anotada, desde una exención.
          [`${V}/conexionAlReceptor.ts`]: ["consultarGuardando", "ultimoToken"],
          // Otro receptor, que le escribe (ver receptorEscribeLoHeredado.ts).
          [`${V}/receptorEscribeLoHeredado.ts`]: ["ultimoToken"],
        },
        // Ningún export mutable: el token colgado de la función. Se ve igual.
        [`${V}/receptorEnLaFuncion.ts`]: { [puerta]: ["consultarColgando"], [`${V}/usaLaFuncion.ts`]: ["consultarColgando"] },
        [`${V}/receptorDeposita.ts`]: { [puerta]: ["consultarDepositando"] },
        [`${V}/receptorAlEntorno.ts`]: { [puerta]: ["consultarAlEntorno"] },
        [`${V}/receptorAlGlobal.ts`]: { [puerta]: ["consultarAlGlobal"] },
        [`${V}/receptorGlobalDeclarado.ts`]: { [puerta]: ["consultarAlDesnudo"] },
        [`${V}/receptorAlCanal.ts`]: { [puerta]: ["consultarAlCanal"] },
        [`${V}/receptorALaCache.ts`]: { [puerta]: ["consultarCacheando"] },
        [`${V}/receptorAlDisco.js`]: { [puerta]: ["consultarAlDisco"] },
        [`${V}/receptorAlCanalGlobal.ts`]: { [puerta]: ["consultarPorElCanalGlobal"] },
        [`${V}/receptorEscribeLoAjeno.ts`]: { [puerta]: ["consultarEscribiendo"] },
        [`${V}/receptorAlPrototipo.ts`]: { [puerta]: ["consultarAlPrototipo"] },
        [`${V}/receptorEscribeLoHeredado.ts`]: { [puerta]: ["consultarHeredando"] },
      });
    });

    it("un receptor que importa algo de valor fuera de los receptores: el token sale por ahí", () => {
      // usaElDeposito.ts no llega a ninguna credencial ni usa ningún receptor:
      // lo único que lo delata es adónde importa el receptor.
      expect(virtual.fugas.some((f) => f.startsWith(`${V}/usaElDeposito.ts`))).toBe(false);
      expect(virtual.receptoresImportan).toEqual({
        [`${V}/receptor.ts`]: [],
        // El hermano importa la ventana de OTRO receptor: eso no sale de ellos.
        [`${V}/receptorHermano.ts`]: [],
        [`${V}/receptorGuarda.ts`]: [],
        [`${V}/receptorEnLaFuncion.ts`]: [],
        [`${V}/receptorDeposita.ts`]: [`${V}/deposito.ts`],
        [`${V}/receptorAlEntorno.ts`]: [],
        [`${V}/receptorAlGlobal.ts`]: [],
        [`${V}/receptorGlobalDeclarado.ts`]: [],
        // Lo de afuera del árbol no está acá: va abajo.
        [`${V}/receptorAlCanal.ts`]: [],
        [`${V}/receptorALaCache.ts`]: [],
        [`${V}/receptorAlDisco.js`]: [],
        [`${V}/receptorAlCanalGlobal.ts`]: [],
        [`${V}/receptorEscribeLoAjeno.ts`]: [],
        [`${V}/receptorAlPrototipo.ts`]: [],
        [`${V}/receptorEscribeLoHeredado.ts`]: [],
      });
    });

    it("lo que la puerta, cada receptor y cada tenedor usan de AFUERA del árbol: un paquete, un módulo de Node, un global del runtime", () => {
      // EV-1 y F1 de la revisión del #123: la ruta de `app/api/canal` recibe el
      // token sin importar nada del árbol, así que no es una fuga ni usa un
      // receptor. Lo único que lo delata es lo que el receptor usa de afuera.
      expect(virtual.fugas.some((f) => f.startsWith(`${V}/app/api/canal/route.ts`))).toBe(false);
      // EV-PROTOTIPO: la ruta que lee `Object.prototype` y `[][0]` tampoco. Lo
      // único que lo delata es lo que el receptor escribe (abajo).
      expect(virtual.fugas.some((f) => f.startsWith(`${V}/app/api/prototipo/route.ts`))).toBe(false);
      expect(analisisVirtual.lecturas.get(`${V}/app/api/prototipo/route.ts`)!.importa).toEqual([]);
      const nada = { importa: [], globales: [] };
      // `Object` y `Reflect`, por miembro (segunda vuelta de la revisión del
      // #123): son la API reflexiva del lenguaje, y desde ellos se llega al
      // prototipo de cualquier cosa.
      expect(virtual.deAfuera).toEqual({
        // G01: la puerta misma, con `next/cache`.
        [puerta]: { importa: ["next/cache"], globales: ["Date", "Object.getPrototypeOf", "String", "fetch"] },
        // Los controles: lo que usan del lenguaje, nada importado.
        [`${V}/receptor.ts`]: { importa: [], globales: ["Date", "JSON", "Object.assign", "encodeURIComponent"] },
        [`${V}/receptorHermano.ts`]: { importa: [], globales: ["JSON"] },
        [`${V}/receptorGuarda.ts`]: nada,
        [`${V}/receptorEnLaFuncion.ts`]: nada,
        [`${V}/receptorDeposita.ts`]: nada,
        [`${V}/receptorAlEntorno.ts`]: { importa: [], globales: ["process"] },
        [`${V}/receptorAlGlobal.ts`]: nada,
        [`${V}/receptorGlobalDeclarado.ts`]: nada,
        [`${V}/receptorAlCanal.ts`]: { importa: ["node:diagnostics_channel"], globales: [] },
        [`${V}/receptorALaCache.ts`]: { importa: ["next/cache"], globales: [] },
        // Por `require()` y por `import()` literales.
        [`${V}/receptorAlDisco.js`]: { importa: ["node:fs", "node:fs/promises"], globales: ["require"] },
        [`${V}/receptorAlCanalGlobal.ts`]: { importa: [], globales: ["BroadcastChannel"] },
        [`${V}/receptorEscribeLoAjeno.ts`]: {
          importa: [],
          globales: [
            "Array",
            "Boolean",
            "Date",
            "Error",
            "JSON",
            "Math",
            "Number",
            "Object.assign",
            "Reflect.set",
            "RegExp",
            "String",
            "Symbol",
            "fetch",
          ],
        },
        // Por un acceso, una clave escrita o una aserción, el miembro; sacado
        // por destructuring o por una clave que no se lee, el global entero.
        [`${V}/receptorAlPrototipo.ts`]: {
          importa: [],
          globales: ["Object", "Object.getPrototypeOf", "Reflect", "Reflect.getPrototypeOf"],
        },
        // Y por una clave escrita, el miembro también.
        [`${V}/receptorEscribeLoHeredado.ts`]: { importa: [], globales: ["Object.assign", "Object.keys"] },
        // Los tenedores (EV-TOKENSTORE-EGRESS de la revisión del #123): el
        // productor, y el que deja el refresh token en el disco.
        [`${V}/tokenStore.ts`]: { importa: [], globales: ["String"] },
        [`${V}/oauth.ts`]: { importa: ["node:fs"], globales: [] },
      });
    });

    it("la puerta, un receptor o un tenedor que tocan el entorno, el objeto global, un global del repositorio, la cadena de prototipos, o escriben en lo que no se sabe privado, cada sitio con su línea", () => {
      expect(virtual.conElTokenTocanLoGlobal.sort()).toEqual(
        [
          `${V}/receptorAlEntorno.ts:3 el entorno: process.env.CACHE_DE_GOOGLE`,
          `${V}/receptorAlEntorno.ts:3 process: process.env`,
          `${V}/receptorAlGlobal.ts:4 el objeto global: globalThis.cacheDeGoogle`,
          `${V}/receptorGlobalDeclarado.ts:4 tokenPropio, un valor global que declara ${V}/receptorGlobalDeclarado.ts`,
          `${V}/receptorGlobalDeclarado.ts:5 tokenAjeno, un valor global que declara ${V}/globales.ts`,
          // F2 de la revisión del #123: cada clase de valor global, con su línea.
          `${V}/receptorGlobalDeclarado.ts:6 guardarTokenGlobal, un valor global que declara ${V}/globales.ts`,
          `${V}/receptorGlobalDeclarado.ts:7 CajaGlobal, un valor global que declara ${V}/globales.ts`,
          `${V}/receptorGlobalDeclarado.ts:8 NivelGlobal, un valor global que declara ${V}/globales.ts`,
          `${V}/receptorGlobalDeclarado.ts:9 cacheGlobal, un valor global que declara ${V}/globales.ts`,
          // La puerta tiene el token igual que ellos.
          `${V}/servicioCompartido.ts:26 ultimoDeLaPuerta, un valor global que declara ${V}/globales.ts`,
          // Lo que se ESCRIBE en algo que ven otros módulos (revisión del #123).
          // G3 de F1: colgado de la función del cliente de sesión que importa la puerta.
          `${V}/servicioCompartido.ts:32 escribe en crearCliente, que es un import: (crearCliente as unknown as { ultima?: string }).ultima = accessToken`,
          // A1 y A5 de la quinta revisión del #118, ahora también por lo que escriben.
          `${V}/receptorGuarda.ts:3 escribe en ultimoToken, que este módulo exporta: ultimoToken.valor = deps.accessToken`,
          `${V}/receptorEnLaFuncion.ts:3 escribe en consultarColgando, que este módulo exporta: (consultarColgando as unknown as { t?: string }).t = deps.accessToken`,
          // Cada forma de escribir, cada una con su línea.
          `${V}/receptorEscribeLoAjeno.ts:4 escribe en fetch, que declara otro archivo: (fetch as unknown as { t?: string }).t = deps.accessToken`,
          `${V}/receptorEscribeLoAjeno.ts:5 le escribe propiedades a registro, que este módulo exporta: Object.assign(registro, { t: deps.accessToken })`,
          `${V}/receptorEscribeLoAjeno.ts:6 le escribe propiedades a JSON, que declara otro archivo: Reflect.set(JSON, "t", deps.accessToken)`,
          `${V}/receptorEscribeLoAjeno.ts:7 escribe en Date, que declara otro archivo: [(Date as unknown as { t?: string }).t] = [deps.accessToken]`,
          `${V}/receptorEscribeLoAjeno.ts:8 escribe en Math, que declara otro archivo: (Math as unknown as { t?: string }).t`,
          `${V}/receptorEscribeLoAjeno.ts:9 escribe en Number, que declara otro archivo: (Number as unknown as { n: number }).n++`,
          `${V}/receptorEscribeLoAjeno.ts:10 escribe en consultarEscribiendo, que este módulo exporta: delete (consultarEscribiendo as unknown as { t?: string }).t`,
          // Con el destino en un spread no se sabe a quién: el mundo es cerrado.
          `${V}/receptorEscribeLoAjeno.ts:11 le escribe propiedades a lo que trae un spread, que no se lee: Object.assign(...([registro, { t: deps.accessToken }] as const))`,
          // Cada destino de un destructuring: una propiedad y un resto de un
          // objeto, un elemento con su valor por defecto (que es también una
          // asignación) y un resto de un arreglo. Y una asignación compuesta.
          `${V}/receptorEscribeLoAjeno.ts:12 escribe en Boolean, que declara otro archivo: { a: (Boolean as unknown as { t?: string }).t, ...(Error as unknown as { r: obje`,
          `${V}/receptorEscribeLoAjeno.ts:12 escribe en Error, que declara otro archivo: { a: (Boolean as unknown as { t?: string }).t, ...(Error as unknown as { r: obje`,
          `${V}/receptorEscribeLoAjeno.ts:13 escribe en String, que declara otro archivo: [(String as unknown as { t?: string }).t = "", ...(RegExp as unknown as { r: str`,
          `${V}/receptorEscribeLoAjeno.ts:13 escribe en String, que declara otro archivo: (String as unknown as { t?: string }).t = ""`,
          `${V}/receptorEscribeLoAjeno.ts:13 escribe en RegExp, que declara otro archivo: [(String as unknown as { t?: string }).t = "", ...(RegExp as unknown as { r: str`,
          `${V}/receptorEscribeLoAjeno.ts:14 escribe en Array, que declara otro archivo: (Array as unknown as { t: string }).t += deps.accessToken`,
          `${V}/receptorEscribeLoAjeno.ts:15 escribe en Symbol, que declara otro archivo: (Symbol as unknown as { t?: string }).t`,
          // EV-TOKENSTORE-EGRESS: el productor, que también tiene el token.
          `${V}/tokenStore.ts:9 el objeto global: globalThis.cacheDelProductor`,
          `${V}/tokenStore.ts:10 escribe en refrescar, que es un import: (refrescar as unknown as { ultimo?: string }).ultimo = token`,
          // EV-PROTOTIPO de la segunda vuelta: la cadena de prototipos, desde
          // cualquier valor, en la puerta, en el productor y en un receptor.
          // Cada nombre que lleva ahí es un sitio, y la escritura otro.
          ...[
            `${V}/servicioCompartido.ts:33 getPrototypeOf${CADENA}Object.getPrototypeOf`,
            `${V}/tokenStore.ts:11 constructor${CADENA}({}).constructor`,
            `${V}/tokenStore.ts:11 prototype${CADENA}({}).constructor.prototype`,
            `${V}/receptorAlPrototipo.ts:5 __proto__${CADENA}vivos.__proto__`,
            `${V}/receptorAlPrototipo.ts:6 getPrototypeOf${CADENA}Reflect.getPrototypeOf`,
            // Por una clave escrita, y por un destructuring declarado y asignado.
            `${V}/receptorAlPrototipo.ts:7 constructor${CADENA}vivos["constructor"]`,
            `${V}/receptorAlPrototipo.ts:7 prototype${CADENA}vivos["constructor"].prototype`,
            `${V}/receptorAlPrototipo.ts:8 constructor${CADENA}{ constructor: { prototype: lista } }`,
            `${V}/receptorAlPrototipo.ts:8 prototype${CADENA}{ prototype: lista }`,
            `${V}/receptorAlPrototipo.ts:10 constructor${CADENA}{ constructor: Lista }`,
            // Los accesores heredados de `Object.prototype`.
            `${V}/receptorAlPrototipo.ts:12 __defineGetter__${CADENA}vivos.__defineGetter__`,
            `${V}/receptorAlPrototipo.ts:13 __defineSetter__${CADENA}vivos.__defineSetter__`,
            `${V}/receptorAlPrototipo.ts:14 __lookupGetter__${CADENA}vivos.__lookupGetter__`,
            `${V}/receptorAlPrototipo.ts:15 __lookupSetter__${CADENA}vivos.__lookupSetter__`,
            // Una clave que no se lee puede ser cualquiera de esos nombres: en
            // un acceso, en un destructuring, y en un `for…of` con un elemento
            // armado (el de la línea 19, todo escrito, no se marca).
            `${V}/receptorAlPrototipo.ts:17 ${NO_ESCRITA}(vivos as Registro)[k]`,
            `${V}/receptorAlPrototipo.ts:17 ${NO_ESCRITA}(vivos as Registro)[k][["proto", "type"].join("")]`,
            `${V}/receptorAlPrototipo.ts:18 ${NO_ESCRITA}{ [k]: Constructor }`,
            `${V}/receptorAlPrototipo.ts:20 ${NO_ESCRITA}(vivos as Registro)[campo]`,
            // El destructuring asignado en cada lugar donde un literal es un
            // patrón: el de un `for…of` y el de un `for…in` (línea 30), en una
            // propiedad, en un elemento y en el resto de un arreglo.
            `${V}/receptorAlPrototipo.ts:21 constructor${CADENA}{ constructor: Lista }`,
            `${V}/receptorAlPrototipo.ts:22 constructor${CADENA}{ constructor: Lista }`,
            `${V}/receptorAlPrototipo.ts:23 constructor${CADENA}{ constructor: Lista }`,
            `${V}/receptorAlPrototipo.ts:24 constructor${CADENA}{ constructor: Lista }`,
            `${V}/receptorAlPrototipo.ts:30 constructor${CADENA}{ constructor: Lista }`,
            // Un spread en el arreglo del `for…of`: no se sabe qué trae.
            `${V}/receptorAlPrototipo.ts:25 ${NO_ESCRITA}(vivos as Registro)[campo]`,
            // `getPrototypeOf` por una clave escrita, a través de una aserción,
            // y sacado por destructuring; y `Reflect` leído por una clave que no se lee.
            `${V}/receptorAlPrototipo.ts:26 getPrototypeOf${CADENA}Reflect["getPrototypeOf"]`,
            `${V}/receptorAlPrototipo.ts:27 getPrototypeOf${CADENA}(Object as ObjectConstructor).getPrototypeOf`,
            `${V}/receptorAlPrototipo.ts:28 getPrototypeOf${CADENA}{ getPrototypeOf: delObjeto }`,
            `${V}/receptorAlPrototipo.ts:29 ${NO_ESCRITA}(Reflect as unknown as Registro)[k]`,
          ],
          // Y lo que se ESCRIBE en algo que no se sabe privado: la raíz es un
          // literal, una llamada, un local, un parámetro o un `let`. Los
          // controles —una constante con un literal, un `let` reasignado— no.
          `${V}/servicioCompartido.ts:33 escribe en Object.getPrototypeOf(mapeos), que no se sabe privado: Object.getPrototypeOf(mapeos).__t = accessToken`,
          `${V}/tokenStore.ts:11 escribe en ({}).constructor.prototype, que no se sabe privado: ({}).constructor.prototype.__t = token`,
          `${V}/receptorEscribeLoHeredado.ts:3 escribe en ({}).toString, que no se sabe privado: (({}).toString as unknown as { t?: string }).t = deps.accessToken`,
          `${V}/receptorEscribeLoHeredado.ts:4 escribe en deps.leerEstado().trim, que no se sabe privado: (deps.leerEstado().trim as unknown as { t?: string }).t = deps.accessToken`,
          `${V}/receptorEscribeLoHeredado.ts:6 escribe en mapa, que no se sabe privado: (mapa as unknown as { t?: string }).t = deps.accessToken`,
          `${V}/receptorEscribeLoHeredado.ts:7 escribe en deps.leerEstado, que no se sabe privado: (deps.leerEstado as unknown as { t?: string }).t = deps.accessToken`,
          `${V}/receptorEscribeLoHeredado.ts:10 escribe en caja, que no se sabe privado: caja.t = deps.accessToken`,
          `${V}/receptorEscribeLoHeredado.ts:11 le escribe propiedades a [].map, que no se sabe privado: Object.assign([].map, { t: deps.accessToken })`,
          `${V}/receptorEscribeLoHeredado.ts:12 escribe en mapa, que no se sabe privado: delete (mapa as unknown as { t?: string }).t`,
          // Por una clave, y no sólo por un nombre. Y los controles de abajo: el
          // resto de un destructuring copia lo propio, no lo heredado.
          `${V}/receptorEscribeLoHeredado.ts:21 escribe en mapa, que no se sabe privado: (mapa as unknown as string[])[0] = deps.accessToken`,
          `${V}/receptorEscribeLoHeredado.ts:26 escribe en g.ultimoToken, que no se sabe privado: g.ultimoToken.valor = deps.accessToken`,
        ].sort()
      );
      // El control: lo que declaran el lenguaje y Node no es un global ajeno, y
      // escribir en un objeto local (receptor.ts) no es escribir en lo compartido.
      for (const limpio of ["receptor.ts", "receptorHermano.ts"]) {
        expect(analisisVirtual.lecturas.get(`${V}/${limpio}`)!.tocaLoGlobal, limpio).toEqual([]);
      }
    });
  });

  describe("los tenedores del token, y lo que la puerta usa del árbol (revisión del #123)", () => {
    const puerta = `${V}/servicioCompartido.ts`;
    const tokenStore = `${V}/tokenStore.ts`;
    const oauth = `${V}/oauth.ts`;

    it("lo que usan de los demás módulos del árbol, por símbolo y con su forma: G1, G2 y G3 en la puerta, y el productor", () => {
      // F1: la puerta importa el cliente de sesión, que importa cualquiera. Las
      // rutas que leen lo que le dejó no importan nada de la credencial.
      for (const ruta of ["app/api/sesion/route.ts", "app/api/oauth/route.ts"]) {
        expect(virtual.fugas.some((f) => f.startsWith(`${V}/${ruta}`)), ruta).toBe(false);
      }
      expect(virtual.usanDelArbol).toEqual({
        [puerta]: [
          // G3: colgado de la función importada, que es un VALOR.
          `${V}/sesion.ts#crearCliente`,
          // Lo legítimo, y G2: el mismo símbolo con el token como argumento.
          `${V}/sesion.ts#crearCliente(0)`,
          `${V}/sesion.ts#crearCliente(1)`,
          // G1: un export nuevo del cliente de sesión.
          `${V}/sesion.ts#recordar(1)`,
          // La reexportación de la segunda revisión del #118 es un valor.
          `${tokenStore}#agencyAccessToken`,
          `${tokenStore}#agencyAccessToken(0)`,
        ],
        // Lo de otro receptor no cuenta: sus exports los usa la puerta y lo declarado.
        [`${V}/receptor.ts`]: [],
        [`${V}/receptorHermano.ts`]: [],
        [`${V}/receptorGuarda.ts`]: [],
        [`${V}/receptorEnLaFuncion.ts`]: [],
        // El depósito, con el token como argumento: lo mismo que mide receptoresImportan, por símbolo.
        [`${V}/receptorDeposita.ts`]: [`${V}/deposito.ts#guardar(1)`],
        [`${V}/receptorAlEntorno.ts`]: [],
        [`${V}/receptorAlGlobal.ts`]: [],
        [`${V}/receptorGlobalDeclarado.ts`]: [],
        [`${V}/receptorAlCanal.ts`]: [],
        [`${V}/receptorALaCache.ts`]: [],
        [`${V}/receptorAlDisco.js`]: [],
        [`${V}/receptorAlCanalGlobal.ts`]: [],
        [`${V}/receptorEscribeLoAjeno.ts`]: [],
        [`${V}/receptorAlPrototipo.ts`]: [],
        [`${V}/receptorEscribeLoHeredado.ts`]: [],
        // El productor: también lo que usa de otro tenedor, y lo que le cuelga.
        [tokenStore]: [
          `${V}/admin.ts#admin(0)`,
          `${V}/agency.ts#resolveAgencyOrgId(0)`,
          `${oauth}#refrescar`,
          `${oauth}#refrescar(1)`,
        ],
        [oauth]: [],
      });
    });

    it("quién usa cada export de un tenedor, por símbolo: la ruta nueva que lee lo que el productor colgó", () => {
      expect(virtual.usosDeLosTenedores[oauth]).toEqual({
        [tokenStore]: ["refrescar"],
        [`${V}/app/api/oauth/route.ts`]: ["refrescar"],
      });
      // El productor: la puerta, y cada forma conocida de saltársela.
      const usaElToken = (m: string) => [m, ["agencyAccessToken"]];
      const usaTodo = (m: string) => [m, ["agencyAccessToken", "proveedor"]];
      expect(virtual.usosDeLosTenedores[tokenStore]).toEqual(
        Object.fromEntries([
          ...[
            "app/api/clics__tests__/route.ts",
            "app/reports/template.tsx",
            "atajoPorLaPuerta.ts",
            "conexionConToken.ts",
            "conexionPorCargador.ts",
            "conexionPorClaveConst.ts",
            "conexionPorElemento.ts",
            "conexionPorImportDinamico.ts",
            "conexionPorPatronComputado.ts",
            "servicioCompartido.ts",
            "usaAbreviado.ts",
            "usaPorEstrella.ts",
            "usaPorNamespace.ts",
          ].map((m) => usaElToken(`${V}/${m}`)),
          ...["cargadorDelAlmacen.ts", ...USAN_TODO_EL_ALMACEN].map((m) => usaTodo(`${V}/${m}`)),
        ])
      );
    });

    it("lo que un tenedor toca de lo global, sin la línea: el global tipado del productor, y lo que le cuelga a otro tenedor", () => {
      expect({ [tokenStore]: virtual.tocanLoGlobal[tokenStore], [oauth]: virtual.tocanLoGlobal[oauth] }).toEqual({
        [tokenStore]: [
          `constructor${CADENA}({}).constructor`,
          "el objeto global: globalThis.cacheDelProductor",
          "escribe en ({}).constructor.prototype, que no se sabe privado: ({}).constructor.prototype.__t = token",
          "escribe en refrescar, que es un import: (refrescar as unknown as { ultimo?: string }).ultimo = token",
          `prototype${CADENA}({}).constructor.prototype`,
        ],
        [oauth]: [],
      });
    });
  });

  it("por símbolo: quién usa el token, aunque llegue por la puerta o por una exención", () => {
    // El grafo de archivos da por legítimos a atajoPorLaPuerta y usaAbreviado
    // (llegan sólo por la puerta) y no mira adentro de conexionConToken (exento):
    // los tres son las fugas de la segunda revisión del #118.
    expect(virtual.usosDelToken).toEqual({
      [`${V}/tokenStore.ts#agencyAccessToken`]: en([
        "app/api/clics__tests__/route.ts",
        "app/reports/template.tsx",
        "atajoPorLaPuerta.ts",
        "cargadorDelAlmacen.ts",
        "conexionConToken.ts",
        ...CONEXION_SIN_IDENTIFICADOR,
        "servicioCompartido.ts",
        "usaAbreviado.ts",
        "usaPorEstrella.ts",
        "usaPorNamespace.ts",
      ]),
    });
    expect(virtual.exportaLaPuerta).toEqual(["agencyAccessToken", "servir"]);
    expect(analisisVirtual.lecturas.get(`${V}/reexportaTodo.ts`)!.exporta).toContain("agencyAccessToken");
    const conToken = [`${V}/agency.ts#resolveAgencyOrgId`, `${V}/tokenStore.ts#agencyAccessToken`];
    const conTodo = [...conToken, `${V}/tokenStore.ts#proveedor`];
    expect(virtual.conexionUsa).toEqual({
      [`${V}/conexion.ts`]: [`${V}/agency.ts#resolveAgencyOrgId`],
      [`${V}/conexionConToken.ts`]: conToken,
      ...Object.fromEntries(
        CONEXION_SIN_IDENTIFICADOR.map((m) => [`${V}/${m}`, USAN_TODO_EL_ALMACEN.includes(m) ? conTodo : conToken])
      ),
      // EV-2: lo que usa del receptor está en la superficie, igual que el token.
      [`${V}/conexionAlReceptor.ts`]: [
        `${V}/agency.ts#resolveAgencyOrgId`,
        `${V}/receptorGuarda.ts#consultarGuardando`,
        `${V}/receptorGuarda.ts#ultimoToken`,
      ],
      [`${V}/yaNoLlega.ts`]: [],
    });
  });

  it("lo legítimo pasa: la ruta de datos por la puerta, la de conexión, y los controles", () => {
    expect(virtual.porLaPuerta).toEqual(
      en(["atajoPorLaPuerta.ts", "datosLegitimos.ts", "datosPorImportAnotado.ts", "datosPorImportDinamico.ts", "usaAbreviado.ts"])
    );
    // Con un import() esperado, y con la variable anotada con el tipo del
    // namespace (el control de EV-2): la regla de la puerta, y nada más.
    for (const control of ["datosPorImportDinamico.ts", "datosPorImportAnotado.ts"]) {
      expect([...analisisVirtual.lecturas.get(`${V}/${control}`)!.usa], control).toEqual([`${V}/servicioCompartido.ts#servir`]);
    }
    expect(analisisVirtual.lecturas.get(`${V}/controlEstilos.ts`)!.sinResolver).toEqual([]);
    expect(analisisVirtual.lecturas.get(`${V}/controlSoloTipos.ts`)!.usa.size).toBe(0);
    const marcados = new Set([
      ...virtual.lectoresDe(VARIABLE),
      ...archivosDe(virtual.envOpaco),
      ...Object.values(virtual.custodios).flat(),
      ...virtual.fugas.map((f) => f.split(" -> ")[0]),
    ]);
    for (const control of en([
      "controlMensaje.ts",
      "controlSoloTipos.ts",
      "controlOtrasVariables.ts",
      "controlPasaElEntorno.ts",
      "controlProceso.ts",
      "controlRequireLiteral.js",
      "controlLaBase.ts",
      "controlNoEsLaBase.ts",
      "datosLegitimos.ts",
      "datosPorImportAnotado.ts",
      "datosPorImportDinamico.ts",
      "conexion.ts",
      "app/api/canal/route.ts",
      "app/api/prototipo/route.ts",
    ])) {
      expect(marcados.has(control), `${control} no es una fuga y el detector lo marcó`).toBe(false);
    }
    // La base usada como se usa —un literal, una constante `as const`, una
    // condición entre literales, `?.`, `typeof`— y lo que se llama `from` o
    // `schema` sin ser la base: nada de eso es opaco, y los nombres se leen.
    for (const control of ["controlLaBase.ts", "controlNoEsLaBase.ts"]) {
      expect(analisisVirtual.lecturas.get(`${V}/${control}`)!.supabaseOpaco, control).toEqual([]);
    }
    for (const control of ["controlProceso.ts", "controlRequireLiteral.js"]) {
      expect(analisisVirtual.lecturas.get(`${V}/${control}`)!.sinResolver, control).toEqual([]);
      expect(analisisVirtual.lecturas.get(`${V}/${control}`)!.envOpaco, control).toEqual([]);
    }
    expect(analisisVirtual.lecturas.get(`${V}/controlSoloTipos.ts`)!.importa).toEqual([]);
    expect([...analisisVirtual.lecturas.get(`${V}/controlOtrasVariables.ts`)!.leeEnv].sort()).toEqual([
      "MAS_OTRA",
      "OTRA_VARIABLE",
      "Y_DE_UN_MODULO",
      "Y_OTRA",
      "Y_UNA_MAS",
    ]);
  });

  it("una exención que ya no llega a la credencial está vencida", () => {
    expect(virtual.vencidas).toEqual([`${V}/yaNoLlega.ts`]);
  });

  it("el recorrido del disco levanta todo lo que Next compila, no sólo .ts y .tsx", () => {
    // El árbol de memoria de arriba le pasa sus archivos al compilador a mano;
    // el de `src` sale de `fuentesEn`. Medido en la revisión del #118: el
    // recorrido anterior filtraba `/\.tsx?$/` y un `.js` en `src` no existía
    // para la pared. Hoy no hay ninguno, así que esto lo mide sobre un
    // directorio propio.
    const dir = mkdtempSync(path.join(tmpdir(), "pared-"));
    try {
      mkdirSync(path.join(dir, "app"));
      for (const f of ["a.ts", "b.tsx", "c.js", "d.jsx", "e.mjs", "f.cjs", "g.d.ts", "h.json", "app/i.mts"]) {
        writeFileSync(path.join(dir, f), "export {};\n");
      }
      expect(
        fuentesEn(dir)
          .map((f) => path.relative(dir, f))
          .sort()
      ).toEqual(["a.ts", "app/i.mts", "b.tsx", "c.js", "d.jsx", "e.mjs", "f.cjs"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. El árbol de verdad
// ---------------------------------------------------------------------------

let real: Veredicto;
let analisisReal: Analisis;

describe("el árbol de src, leído del disco", () => {
  beforeAll(() => {
    const raices = fuentesEn(SRC).filter((f) => !esTest(path.relative(ROOT, f).replace(/\\/g, "/")));
    analisisReal = analizar(ROOT, raices, opcionesDelProyecto(ROOT));
    real = juzgar(analisisReal, POLITICA);
  }, 180_000);

  describe("el inventario no está vacío, y no es una lista", () => {
    it("todo módulo de producción está, no sólo las convenciones de Next", () => {
      // Anti-vacuidad: si el recorrido no encuentra nada, la pared de abajo
      // pasa sobre una lista vacía e informa éxito sin haber mirado.
      expect(real.produccion.filter((r) => r.endsWith("/route.ts")).length).toBeGreaterThan(15);
      expect(real.produccion.filter((r) => r.endsWith("/page.tsx")).length).toBeGreaterThan(15);
      expect(real.produccion).toContain("src/middleware.ts");
      expect(real.produccion).toContain("src/app/app/integrations/client.tsx");
      expect(real.produccion.length).toBeGreaterThan(100);
    });

    it("distingue un import de tipos de uno que ejecuta, y resuelve los `@/`", () => {
      // `hydrate.ts` importa de `tokenStore.ts` SÓLO tipos. Si el grafo los
      // contara, la pared vería caminos que no ejecutan nada.
      expect(analisisReal.lecturas.get("src/lib/integrations/google/hydrate.ts")!.importa).not.toContain(TOKEN_STORE);
      expect(analisisReal.lecturas.get(PUERTA)!.importa).toContain(TOKEN_STORE);
      expect(analisisReal.lecturas.get("src/lib/reports/orchestrator.ts")!.importa).toContain(PUERTA);
    });
  });

  describe("la variable", () => {
    it(`sólo ${LECTOR} lee ${VARIABLE}`, () => {
      // Que `agency.ts` aparezca es también la anti-vacuidad del detector: lee la
      // variable por una constante (`env[AGENCY_ORG_ID_ENV]`).
      expect(
        real.lectoresDe(VARIABLE),
        `Leer ${VARIABLE} fuera de agency.ts es la forma más corta del fallback: ` +
          `«si el cliente no tiene, usá lo de la agencia». Pedí la organización por ` +
          `resolveAgencyOrgId() desde un módulo de conexión, o el token por ` +
          `servirConLaAgencia() desde uno de datos.`
      ).toEqual([LECTOR]);
    });

    for (const variable of PROPERTIES_DE_LA_AGENCIA) {
      it(`${variable}: cero lectores`, () => {
        expect(
          real.lectoresDe(variable),
          `${variable} es una property de la AGENCIA. Leerla como valor por defecto ` +
            `para una organización sin mapeo sirve los datos de la agencia en el ` +
            `reporte —o la ficha— de otro. El mapeo vive en integration_properties.`
        ).toEqual([]);
      });
    }

    it("toda lectura del entorno tiene claves que el compilador puede enumerar", () => {
      expect(
        real.envOpaco,
        "Una lectura del entorno cuya clave no está ESCRITA, o un process.env que se va " +
          "a algo que no lo tipa como entorno, puede ser la variable de la agencia y la " +
          "pared no tiene cómo saberlo. Un tipo no alcanza: se afirma. Escribí la clave " +
          "(un literal, o una constante que vale uno), como LECTURAS en platformStatus.ts."
      ).toEqual([]);
    });
  });

  describe("la custodia", () => {
    it("cada pieza la nombra sólo su dueño", () => {
      expect(
        real.custodios,
        "La custodia del token se toca desde tokenStore.ts (el secreto) y agencyToken.ts " +
          "(el estado), y desde ningún otro lado: un módulo de datos que la nombra pide " +
          "el secreto de la agencia sin pasar por la regla."
      ).toEqual({
        integration_token_secret: [TOKEN_STORE],
        refresh_integration_token: [TOKEN_STORE],
        store_integration_token: [TOKEN_STORE],
        integration_tokens: [AGENCY_TOKEN],
        decrypted_secrets: [],
      });
    });

    it("ninguna llamada de Supabase nombra lo que pide en ejecución, ni cambia de esquema", () => {
      expect(real.supabaseOpaco).toEqual([]);
      expect(real.esquemas).toEqual([]);
    });
  });

  describe("ningún módulo de datos llega a la credencial salvo por la regla del servicio compartido", () => {
    it("la puerta existe y llega a la variable y a la custodia", () => {
      expect(analisisReal.lecturas.has(PUERTA), `${PUERTA} no existe`).toBe(true);
      expect(camino(analisisReal.lecturas, PUERTA, new Set([LECTOR]), null)).not.toBeNull();
      expect(camino(analisisReal.lecturas, PUERTA, new Set([TOKEN_STORE]), null)).not.toBeNull();
    });

    it("hay rutas de datos que llegan, y llegan por la puerta", () => {
      // Anti-vacuidad: si ninguna llegara ni siquiera CON la puerta, el
      // resultado de abajo sería verde por no haber camino que cortar.
      expect(real.porLaPuerta).toEqual(
        expect.arrayContaining(["src/app/api/publishing/publish/route.ts", "src/app/api/reports/generate/route.ts"])
      );
    });

    it("todo import se resuelve, y antes de ejecutar: ninguno en ejecución, con query, ni a algo que no existe", () => {
      expect(
        real.sinResolver,
        "Un especificador que tsc no resuelve no es un camino que la pared pueda seguir, y el bundler " +
          "puede resolverlo igual (con un ?query, por ejemplo). Si es legítimo, va a RESUELVE_EL_BUNDLER con su razón."
      ).toEqual([]);
    });

    it("sólo la puerta usa a los que producen el token", () => {
      // Por SÍMBOLO y a través de cualquier reexportación: la segunda revisión
      // del #118 reexportó `agencyAccessToken` desde la puerta y un módulo de
      // datos nuevo lo usaba «por la puerta» con la suite en verde.
      expect(
        real.usosDelToken,
        "agencyAccessToken() lo llama servirConLaAgencia() y nadie más: el token se presta sólo por su regla."
      ).toEqual({ [`${TOKEN_STORE}#agencyAccessToken`]: [PUERTA], [`${TOKEN_STORE}#resolveAccessToken`]: [] });
    });

    it("la puerta exporta su regla y nada más", () => {
      expect(real.exportaLaPuerta).toEqual(["servirConLaAgencia"]);
    });

    it("cada exención de conexión usa exactamente las piezas de la credencial que declara", () => {
      // Exentar un ARCHIVO entero dejaba entrar cualquier export nuevo de ese
      // archivo: una server action de más en property-actions.ts pedía el token
      // para cualquier property con la suite en verde.
      expect(
        real.conexionUsa,
        "Un módulo de conexión empezó a usar otra pieza de la credencial (o dejó de usar una). " +
          "Si es una pieza nueva, es una decisión: va a CONEXION con su razón. Si es el token, no va: es un módulo de datos."
      ).toEqual(Object.fromEntries(CONEXION.map((c) => [c.modulo, [...c.usa].sort()])));
    });

    it("sin la puerta en el medio, ningún módulo de datos llega a la credencial", () => {
      expect(
        real.fugas,
        "Estos módulos llegan a la credencial de la agencia por un costado. El token " +
          "se presta SÓLO por servirConLaAgencia(), que exige un mapeo vivo de la " +
          "organización del recurso. Si es un módulo de conexión, va a CONEXION con su razón."
      ).toEqual([]);
    });

    it("las exenciones de conexión existen y siguen llegando", () => {
      // Una exención que ya no llega a la credencial no exime nada y le hace
      // lugar a la próxima sin que se note en el diff.
      expect(real.vencidas, "exenta como conexión pero ya no existe o no llega a la credencial").toEqual([]);
    });
  });

  describe("los que reciben el token de la puerta", () => {
    it("la puerta importa como valor la custodia, el cliente de sesión y los receptores, y nada más", () => {
      // La lista de RECEPTORES se declara, no se mide: si la puerta le pasara el
      // token a un módulo nuevo, la pared no lo sabría. Para pasárselo a uno que
      // no importa tiene que importarlo, y eso se mide acá. A los que ya importa
      // —el cliente de sesión, que importa cualquiera— no se lo pasa por esta
      // lista: lo mide «lo que la puerta, cada receptor y cada tenedor usan de
      // los demás módulos del árbol», por símbolo y con su forma, y «…tocan…»,
      // que ve lo que se le escribe a lo importado. Medido el 2026-10-21 en la
      // revisión del #123: sin esas dos, esta lista sola dejaba pasar el token
      // colgado de `createSupabaseServerClient`.
      expect(
        [...new Set(analisisReal.lecturas.get(PUERTA)!.importa)].sort(),
        "La puerta importa un módulo nuevo. Si le pasa el token, es un receptor: va a RECEPTORES con su razón."
      ).toEqual([...RECEPTORES.map((r) => r.modulo), "src/lib/supabase/server.ts", TOKEN_STORE].sort());
    });

    it("cada export de un receptor lo usa la puerta, o quien está declarado, y nadie más", () => {
      // Por SÍMBOLO (R14). La quinta revisión del #118 guardó el token en un
      // export de searchConsole.ts y una ruta nueva lo gastó, con tsc y esta
      // pared en verde. Que la puerta esté es también la anti-vacuidad: si un
      // receptor cambiara de nombre, el mapa de abajo dejaría de coincidir.
      expect(
        real.usosDeLosReceptores,
        "Un módulo nuevo usa un export de un receptor del token. Lo que el receptor deje en " +
          "sus exports es el token de la agencia: un módulo de datos pide la consulta a " +
          "servirConLaAgencia(). Si es legítimo, va a RECEPTORES con su razón."
      ).toEqual(Object.fromEntries(RECEPTORES.map((r) => [r.modulo, r.usadoPor])));
    });

    it("un receptor no importa nada de valor fuera de los receptores", () => {
      expect(
        real.receptoresImportan,
        "Un receptor importa algo que no es otro receptor: el token puede salir por ahí a " +
          "un módulo que no recibe nada de la puerta."
      ).toEqual(Object.fromEntries(RECEPTORES.map((r) => [r.modulo, []])));
    });

    it("lo que la puerta, cada receptor y cada tenedor usan de afuera del árbol es exactamente lo declarado", () => {
      // EV-1 y F1 de la revisión del #123: `channel(...).publish(token)` de
      // `node:diagnostics_channel` en searchConsole.ts, y una ruta nueva que lo
      // recibía sin importar nada del árbol, pasaban tsc, eslint y esta pared.
      // Que los globales del lenguaje estén es también la anti-vacuidad: si el
      // detector no cosechara nada, el mapa de abajo no coincidiría.
      expect(
        real.deAfuera,
        "La puerta, un receptor o un tenedor usan algo nuevo de afuera del árbol: un paquete, un módulo de Node o un " +
          "global del runtime. Tienen el token en la mano, y un next/cache, un node:fs, un canal o una cookie " +
          "lo guardan donde lo lea otra ruta. Si es inocuo, va a DE_AFUERA con su razón."
      ).toEqual(Object.fromEntries(Object.entries(DE_AFUERA).map(([m, { importa, globales }]) => [m, { importa, globales }])));
    });

    it("ni la puerta ni un receptor tocan process, el entorno, el objeto global, un global del repositorio, la cadena de prototipos ni lo que no se sabe privado", () => {
      // Anti-vacuidad: en el árbol de verdad el detector ve lo que tiene que
      // ver. agency.ts lee el entorno (`env: NodeJS.ProcessEnv = process.env`).
      expect(analisisReal.lecturas.get(LECTOR)!.tocaLoGlobal.join("\n")).toContain(`${LECTOR}:`);
      // Y fuera de los que tienen el token, el árbol escribe en objetos que no
      // nacieron en un literal y lee por claves que no están escritas: lo que
      // la segunda vuelta de la revisión del #123 cuenta como tocar lo global
      // (EV-PROTOTIPO). Si no viera ninguno, la regla estaría ciega.
      const todos = [...analisisReal.lecturas.values()].flatMap((l) => l.tocaLoGlobal).join("\n");
      expect(todos).toContain(", que no se sabe privado: ");
      expect(todos).toContain(NO_ESCRITA);
      // Los tenedores leen el entorno, y lo suyo está declarado abajo.
      const deUnTenedor = (sitio: string) => TENEDORES.some((t) => sitio.startsWith(`${t.modulo}:`));
      expect(
        real.conElTokenTocanLoGlobal.filter((sitio) => !deUnTenedor(sitio)),
        "Lo que la puerta o un receptor escriben ahí lo lee cualquier módulo del proceso, y tienen el token. " +
          "Eso incluye la cadena de prototipos (`constructor`, `prototype`, `__proto__`, `getPrototypeOf`, " +
          "o una clave que no está escrita) y escribir en un objeto que no nació acá en un literal."
      ).toEqual([]);
    });

    it("lo que la puerta, cada receptor y cada tenedor usan de los demás módulos del árbol, y cómo, es exactamente lo declarado", () => {
      // F1 de la revisión del #123: la puerta le pasaba el token al cliente de
      // sesión —colgado de la función, en un export nuevo, como argumento— y una
      // server action nueva lo leía, con tsc, eslint y esta pared en verde. Que
      // el cliente de sesión esté, llamado sin argumentos, es también la
      // anti-vacuidad: si no se cosechara nada, el mapa no coincidiría.
      expect(
        real.usanDelArbol,
        "La puerta, un receptor o un tenedor usan algo nuevo de otro módulo del árbol, o lo usan de otra forma " +
          "(con otros argumentos, o como valor). Tienen el token en la mano, y lo que le pasen o le cuelguen a ese " +
          "módulo lo lee quien lo importe. Si es inocuo, va a USAN_DEL_ARBOL con su razón."
      ).toEqual(Object.fromEntries(Object.entries(USAN_DEL_ARBOL).map(([m, { usa }]) => [m, [...usa].sort()])));
    });
  });

  describe("los que tienen el token sin ser la puerta ni un receptor", () => {
    it("cada export de un tenedor lo usa quien está declarado, y nadie más", () => {
      // EV-TOKENSTORE-EGRESS de la revisión del #123: el productor y los suyos
      // tienen el access y el refresh token en claro. Lo que dejen en sus
      // exports lo lee quien los use.
      expect(
        real.usosDeLosTenedores,
        "Un módulo nuevo usa un export de un tenedor del token (tokenStore.ts, oauth.ts, el callback). Lo que el " +
          "tenedor deje ahí es el token de la agencia. Si es legítimo, va a TENEDORES con su razón."
      ).toEqual(Object.fromEntries(TENEDORES.map((t) => [t.modulo, t.usadoPor])));
    });

    it("lo que cada tenedor toca de lo global es exactamente lo declarado: leer el entorno", () => {
      // EV-TOKENSTORE-EGRESS: `globalThis.__cacheDeGoogle = token` en
      // tokenStore.ts, sin aserción, pasaba la suite entera. Por sitio, sin la
      // línea y con repetidos: uno nuevo, aunque diga lo mismo que otro, es un
      // rojo.
      expect(
        Object.fromEntries(TENEDORES.map((t) => [t.modulo, real.tocanLoGlobal[t.modulo]])),
        "Un tenedor del token toca algo nuevo de lo que comparte todo el proceso. Tiene el token en claro: lo " +
          "que escriba ahí lo lee cualquier módulo. Si es una lectura nueva del entorno, va a TENEDORES con su razón."
      ).toEqual(Object.fromEntries(TENEDORES.map((t) => [t.modulo, [...t.tocaLoGlobal].sort()])));
    });
  });
});
