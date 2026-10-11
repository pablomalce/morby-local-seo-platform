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
 * porque la clave tiene TIPO literal, no porque se parezca a un literal: así se
 * ven el `as const`, la constante local y la importada. El mundo es cerrado: una
 * lectura del entorno cuya clave el compilador no puede enumerar, un
 * `process.env` que se escapa a algo que no lo tipa como entorno, una llamada de
 * Supabase con un nombre armado en ejecución, o un `import()` de destino no
 * literal, son fallas por sí mismas — por ahí pasaría la próxima. Lo mismo un
 * `process` o un `globalThis` que pierden el tipo (`as any`, `Reflect.get`) y una
 * carga que resuelve webpack sin `import()` (`require.context`,
 * `import.meta.webpackContext`, `__non_webpack_require__`): medidos en la
 * tercera revisión del #118.
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
 * reporte y la publicación). Dice que no hay otra puerta.
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
    }`,
  "agencyToken.ts": `
    import { admin } from "./admin";
    export async function estado(org: string) {
      return admin().from("integration_tokens").select("expires_at").eq("organization_id", org);
    }`,
  // La puerta, con la reexportación de la segunda revisión del #118 puesta: el
  // detector tiene que verla en lo que la puerta exporta y en quién la usa.
  "servicioCompartido.ts": `
    import { agencyAccessToken } from "./tokenStore";
    export async function servir(mapeos: string[]) { return mapeos.length > 0 ? agencyAccessToken() : null; }
    export { agencyAccessToken } from "./tokenStore";`,
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
  "controlOtrasVariables.ts": `
    type Clave = "OTRA_VARIABLE" | "Y_OTRA";
    export const leer = (k: Clave) => process.env[k] ?? process.env.MAS_OTRA;`,
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
  "conexionPorClaveConst.ts",
  "conexionPorElemento.ts",
  "conexionPorImportDinamico.ts",
  "conexionPorPatronComputado.ts",
  "conexionPorReflect.ts",
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

  it("el entorno con clave desconocida: armada, escapada, guardada como otra cosa, o el resto", () => {
    expect(archivosDe(virtual.envOpaco)).toEqual(
      en([
        "claveArmada.ts",
        "entornoEscapado.ts",
        "entornoGuardado.ts",
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
    expect(archivosDe(virtual.supabaseOpaco)).toEqual(en(["rpcArmada.ts"]));
    expect(virtual.esquemas).toEqual(["vault"]);
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
        "app/reports/template.tsx",
        "cargadorDelAlmacen.ts",
        "instrumentation.ts",
        "reexporta.ts",
        "reexportaTodo.ts",
        "usaElSecreto.ts",
        "usaPorEstrella.ts",
        "usaPorNamespace.ts",
      ])
    );
    // La exención no se hereda: instrumentation.ts llega POR la de conexión.
    expect(virtual.fugas).toContain([`${V}/instrumentation.ts`, `${V}/conexion.ts`, `${V}/agency.ts`].join(" -> "));
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
    expect(virtual.conexionUsa).toEqual({
      [`${V}/conexion.ts`]: [`${V}/agency.ts#resolveAgencyOrgId`],
      [`${V}/conexionConToken.ts`]: conToken,
      ...Object.fromEntries(CONEXION_SIN_IDENTIFICADOR.map((m) => [`${V}/${m}`, conToken])),
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
      "datosLegitimos.ts",
      "datosPorImportDinamico.ts",
      "conexion.ts",
    ])) {
      expect(marcados.has(control), `${control} no es una fuga y el detector lo marcó`).toBe(false);
    }
    for (const control of ["controlProceso.ts", "controlRequireLiteral.js"]) {
      expect(analisisVirtual.lecturas.get(`${V}/${control}`)!.sinResolver, control).toEqual([]);
      expect(analisisVirtual.lecturas.get(`${V}/${control}`)!.envOpaco, control).toEqual([]);
    }
    expect(analisisVirtual.lecturas.get(`${V}/controlSoloTipos.ts`)!.importa).toEqual([]);
    expect([...analisisVirtual.lecturas.get(`${V}/controlOtrasVariables.ts`)!.leeEnv].sort()).toEqual([
      "MAS_OTRA",
      "OTRA_VARIABLE",
      "Y_OTRA",
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
        "Una lectura del entorno con una clave de tipo `string`, o un process.env " +
          "que se va a algo que no lo tipa como entorno, puede ser la variable de la " +
          "agencia y la pared no tiene cómo saberlo. Tipá la clave con una unión de literales."
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
});
