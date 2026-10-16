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
  "tokenStore.ts": `
    import { resolveAgencyOrgId } from "./agency";
    import { admin } from "./admin";
    export async function agencyAccessToken() {
      const org = resolveAgencyOrgId();
      const { data } = await admin().rpc("integration_token_secret", { p_organization_id: org });
      return data;
    }
    // Otra pieza, inocua: le da a una aserción un nombre que existe y no es el token.
    export const proveedor = () => "google";`,
  "agencyToken.ts": `
    import { admin } from "./admin";
    export async function estado(org: string) {
      return admin().from("integration_tokens").select("expires_at").eq("organization_id", org);
    }`,
  // La puerta, con la reexportación de la segunda revisión del #118 puesta: el
  // detector tiene que verla en lo que la puerta exporta y en quién la usa. Y le
  // pasa el token a cada receptor de abajo, como la de verdad a los tres suyos.
  "servicioCompartido.ts": `
    import { agencyAccessToken } from "./tokenStore";
    import { consultar } from "./receptor";
    import { consultarHermano } from "./receptorHermano";
    import { consultarGuardando } from "./receptorGuarda";
    import { consultarColgando } from "./receptorEnLaFuncion";
    import { consultarDepositando } from "./receptorDeposita";
    import { consultarAlEntorno } from "./receptorAlEntorno";
    import { consultarAlGlobal } from "./receptorAlGlobal";
    import { consultarAlDesnudo } from "./receptorGlobalDeclarado";
    const conTrampa = [consultarGuardando, consultarColgando, consultarDepositando, consultarAlEntorno, consultarAlGlobal, consultarAlDesnudo];
    export async function servir(mapeos: string[]) {
      if (mapeos.length === 0) return null;
      const accessToken = String(await agencyAccessToken());
      for (const r of conTrampa) await r({ accessToken });
      await consultarHermano({ accessToken, ahora: new Date() });
      return consultar({ accessToken, ref: mapeos[0], fetcher: fetch });
    }
    export { agencyAccessToken } from "./tokenStore";`,
  // --- Los RECEPTORES: la puerta les pasa el token (quinta revisión del #118).
  // Los dos primeros son como searchConsole.ts y ga4.ts: usan el lenguaje
  // (`JSON`, `encodeURIComponent`, `Date`) y el hermano comparte la ventana. Los
  // demás guardan el token donde lo lea otro.
  "receptor.ts": `
    export const VENTANA = 28;
    export const ventana = (ahora: Date) => new Date(ahora.getTime() - VENTANA * 86_400_000).toISOString();
    export async function consultar(deps: { accessToken: string; ref: string; fetcher: typeof fetch }) {
      const r = await deps.fetcher("https://ejemplo.test/" + encodeURIComponent(deps.ref), { headers: { authorization: "Bearer " + deps.accessToken } });
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
  "globales.ts": `
    declare global { var tokenAjeno: string | undefined }
    export {};`,
  "receptorGlobalDeclarado.ts": `
    declare global { var tokenPropio: string | undefined }
    export function consultarAlDesnudo(deps: { accessToken: string }) {
      tokenPropio = deps.accessToken;
      tokenAjeno = deps.accessToken;
    }`,
  "datosLegitimos.ts": `
    import { servir } from "./servicioCompartido";
    export const reporte = () => servir(["properties/1"]);`,
  // Lo mismo con un import() esperado: usa la regla de la puerta y nada más. Si
  // el namespace se contara entero, usaría también el agencyAccessToken que la
  // puerta virtual reexporta, y sería un falso positivo.
  "datosPorImportDinamico.ts": `
    export const reporte = async () => (await import("./servicioCompartido")).servir(["properties/2"]);`,
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
    export const paso = (i: number) => pasos[i]();`,
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
const USAN_TODO_EL_ALMACEN = ["conexionPorClaveArmada.js", "conexionPorClaveAsertada.ts", "conexionPorReflect.ts"];

/** Los receptores virtuales que guardan el token donde lo lea otro, con la función que les pasa la puerta. */
const RECEPTORES_CON_TRAMPA: ReadonlyArray<readonly [string, string]> = [
  ["receptorGuarda.ts", "consultarGuardando"],
  ["receptorEnLaFuncion.ts", "consultarColgando"],
  ["receptorDeposita.ts", "consultarDepositando"],
  ["receptorAlEntorno.ts", "consultarAlEntorno"],
  ["receptorAlGlobal.ts", "consultarAlGlobal"],
  ["receptorGlobalDeclarado.ts", "consultarAlDesnudo"],
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
    { modulo: `${V}/yaNoLlega.ts`, usa: [] },
  ],
  // `usadoPor` es lo que la política DECLARA; lo que se mide está en el test.
  receptores: [
    { modulo: `${V}/receptor.ts`, usadoPor: { [`${V}/servicioCompartido.ts`]: ["consultar"], [`${V}/receptorHermano.ts`]: ["ventana"] } },
    { modulo: `${V}/receptorHermano.ts`, usadoPor: { [`${V}/servicioCompartido.ts`]: ["consultarHermano"] } },
    ...RECEPTORES_CON_TRAMPA.map(([m, f]) => ({ modulo: `${V}/${m}`, usadoPor: { [`${V}/servicioCompartido.ts`]: [f] } })),
  ],
};

let virtual: Veredicto;
let analisisVirtual: Analisis;

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
        },
        // Ningún export mutable: el token colgado de la función. Se ve igual.
        [`${V}/receptorEnLaFuncion.ts`]: { [puerta]: ["consultarColgando"], [`${V}/usaLaFuncion.ts`]: ["consultarColgando"] },
        [`${V}/receptorDeposita.ts`]: { [puerta]: ["consultarDepositando"] },
        [`${V}/receptorAlEntorno.ts`]: { [puerta]: ["consultarAlEntorno"] },
        [`${V}/receptorAlGlobal.ts`]: { [puerta]: ["consultarAlGlobal"] },
        [`${V}/receptorGlobalDeclarado.ts`]: { [puerta]: ["consultarAlDesnudo"] },
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
      });
    });

    it("un receptor que toca el entorno, el objeto global o un global del repositorio, cada sitio con su línea", () => {
      expect(virtual.receptoresTocanLoGlobal.sort()).toEqual(
        [
          `${V}/receptorAlEntorno.ts:3 el entorno: process.env.CACHE_DE_GOOGLE`,
          `${V}/receptorAlEntorno.ts:3 process: process.env`,
          `${V}/receptorAlGlobal.ts:4 el objeto global: globalThis.cacheDeGoogle`,
          `${V}/receptorGlobalDeclarado.ts:4 tokenPropio, un valor global que declara ${V}/receptorGlobalDeclarado.ts`,
          `${V}/receptorGlobalDeclarado.ts:5 tokenAjeno, un valor global que declara ${V}/globales.ts`,
        ].sort()
      );
      // El control: lo que declaran el lenguaje y Node no es un global ajeno.
      for (const limpio of ["receptor.ts", "receptorHermano.ts"]) {
        expect(analisisVirtual.lecturas.get(`${V}/${limpio}`)!.tocaLoGlobal, limpio).toEqual([]);
      }
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
      [`${V}/yaNoLlega.ts`]: [],
    });
  });

  it("lo legítimo pasa: la ruta de datos por la puerta, la de conexión, y los controles", () => {
    expect(virtual.porLaPuerta).toEqual(
      en(["atajoPorLaPuerta.ts", "datosLegitimos.ts", "datosPorImportDinamico.ts", "usaAbreviado.ts"])
    );
    expect([...analisisVirtual.lecturas.get(`${V}/datosPorImportDinamico.ts`)!.usa]).toEqual([
      `${V}/servicioCompartido.ts#servir`,
    ]);
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
      "datosPorImportDinamico.ts",
      "conexion.ts",
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
      // token a un módulo nuevo, la pared no lo sabría. Para pasárselo tiene que
      // importarlo, y eso sí se mide.
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

    it("un receptor no toca process, el entorno, el objeto global ni un global del repositorio", () => {
      // Anti-vacuidad: en el árbol de verdad el detector ve lo que tiene que
      // ver. agency.ts lee el entorno (`env: NodeJS.ProcessEnv = process.env`).
      expect(analisisReal.lecturas.get(LECTOR)!.tocaLoGlobal.join("\n")).toContain(`${LECTOR}:`);
      expect(
        real.receptoresTocanLoGlobal,
        "Lo que un receptor escribe ahí lo lee cualquier módulo del proceso, y el receptor tiene el token."
      ).toEqual([]);
    });
  });
});
