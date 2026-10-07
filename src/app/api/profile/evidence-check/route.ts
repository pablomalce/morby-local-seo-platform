import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import {
  chequearEvidencia,
  statusMedido,
  type Afirmacion,
  type Fuente,
  type MotivoNoResuelve,
} from "@/lib/profile/evidenceCheck";
import { dependenciasDeProduccion } from "@/lib/profile/nodeTransport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { quienLlama } from "@/lib/api/sesion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** El techo de Vercel Hobby. `evidenceCheck.ts` dimensiona la corrida para entrar. */
export const maxDuration = 60;

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que la puerta H1.4 se conteste leyendo una ficha en vez de salir a mirar sus
 * fuentes. Es la corrida a mano del chequeo: recorre TODAS las afirmaciones de
 * la versión PUBLICADA de una empresa, sale a la red por cada fuente `http`,
 * escribe lo que vio en `last_checked_at`/`last_status`, y contesta la línea
 * «N afirmaciones, M sin evidencia resoluble» con las tres cubetas y la
 * contraprueba. La lógica vive en `src/lib/profile/evidenceCheck.ts`; esto es
 * quién puede pedirla, de dónde salen los datos y dónde se escribe.
 *
 * EL ORDEN, Y POR QUÉ ES ESTE
 *
 * 1. Sesión. Sin ella, 401 ANTES de todo lo demás: antes del rate limit, antes
 *    de leer el cuerpo, antes de cualquier lectura y de cualquier salida a la
 *    red. Este handler sale a URLs que cargó un usuario, y un anónimo que
 *    pudiera dispararlo tendría un proxy con la IP de la plataforma.
 *    Hasta el 2026-10-07 el paso 1 era «rate limit y zod, que no tocan nada»,
 *    y MEDIDO EN PRODUCCIÓN ese día: un anónimo con cuerpo `{}` recibía
 *    `400 Request could not be processed.` y con cuerpo bien formado `401`.
 *    No tocaban nada, pero contestaban: a quien no tiene sesión la ruta le
 *    describía su esquema en vez de negarle la puerta. Es el orden de
 *    `/api/reports/generate` (#103), y el barrido lo mide con un cuerpo
 *    inválido además del bien formado.
 *    «Antes de todo» incluye el `catch` del trabajo: la pregunta es
 *    `quienLlama()` (`src/lib/api/sesion.ts`), fuera de ese try, porque en
 *    modo demo —sin las envs de Supabase— construir el cliente TIRA, y ese
 *    throw caía en el `apiError(error, 500)` de abajo: un anónimo recibía 500.
 * 2. Rate limit y zod.
 * 3. El negocio, leído COMO EL USUARIO: la RLS le esconde el de otra
 *    organización y recibe 404, igual que quien pide un id inventado.
 * 4. La membresía ACTIVA en la organización dueña del negocio, comprobada en
 *    código. No es una copia ociosa de la RLS, como sería en `rehearse`: esta
 *    ruta escribe con `service_role` (paso 7), que saltea la RLS, y §12.3 del
 *    director exige que toda ruta privilegiada verifique la organización en
 *    código y en pruebas, por handler. El test que la mide hace que la RLS
 *    «falle» —el negocio ajeno se ve— y exige 404 sin escritura.
 * 5. La versión publicada, las afirmaciones con `count: "exact"` —el `count(*)`
 *    de PostgreSQL es N, no el largo de lo que vino— y la evidencia, todo con
 *    el cliente de sesión.
 * 6. El dominio propio con `url_host()`, la MISMA función que genera
 *    `profile_evidence.source_host` (decisión 10 de la `0026`): dos parsers se
 *    separan. Si `website` no trae esquema —`ejemplo.com`, que el alta acepta—
 *    `url_host` devuelve `''`, y se le pregunta de nuevo a la misma función con
 *    `https://` delante, que es lo que ya hace `/api/aeo/audit`. Si igual queda
 *    vacío, el chequeo se NIEGA (`dominio-propio-desconocido`): ver la 0026.
 * 7. La corrida, que sale a la red: hasta ~42 s.
 * 8. OTRA VEZ los pasos 4 y 5, justo antes de escribir. La autorización y la
 *    versión se leyeron antes de la red; si mientras tanto se publicó otra
 *    versión o archivaron a quien disparó la corrida, la escritura con
 *    `service_role` no sale (`guardado.motivo`), y la `0027` no la frenaría:
 *    deja escribir la medición en cualquier versión congelada, también en una
 *    superada. Queda la ventana de milisegundos entre esta lectura y el UPDATE,
 *    que PostgREST no deja cerrar con un filtro por la versión de la madre.
 * 9. La escritura, con `service_role`, porque `authenticated` sólo lee la ficha
 *    (decisión 6 de la `0026`). Sólo `last_checked_at` y `last_status`, que es
 *    lo único que la decisión 9 de la `0027` deja cambiar en una versión
 *    publicada; sólo filas que el paso 5 leyó con la sesión; y siempre con la
 *    organización del negocio en el filtro.
 *
 * AUSENCIA, CERO Y FALLO
 *
 * Una lectura que falla es 502 con un motivo, no una ficha vacía: N = 0 por un
 * error de red sería el cero inventado. Un `count` que no vino es un fallo, no
 * un cero. Sin versión publicada, N = 0 y el veredicto es rojo con `n-cero`.
 * Y al navegador no le llega nunca el mensaje de Postgres —la lección del
 * #104—: el código se registra del lado del servidor y la respuesta lleva un
 * motivo con nombre.
 *
 * QUÉ ESCRIBE `last_status`
 *
 * El status de la respuesta que DECIDIÓ la fuente (`statusMedido` en
 * `evidenceCheck.ts`): el 2xx de una resuelta, el 404 de una caída. NULL si se
 * midió y ninguna respuesta la decidió —DNS, timeout, TLS, o un 301 cuyo
 * destino se rechazó—: con «2xx o 3xx es resuelta», guardar ese 301 haría que
 * una auditoría con SQL cuente como resuelta una fuente que redirige al propio
 * sitio. Una fuente que ni salió a la red —origen propio, URL ambigua,
 * verificada a mano— no se escribe: esas dos columnas son una medición, y lo
 * que no se midió no se anota como medido.
 *
 * QUÉ MOTIVO VE EL NAVEGADOR
 *
 * Los motivos que describen la red DE LA PLATAFORMA —`dns`, `ip-no-publica`,
 * `timeout`, `sin-respuesta`, `tls`— llegan al navegador como uno solo, `red`.
 * Separar «no existe» de «existe y resuelve a una dirección interna» le dice a
 * quien carga URLs qué nombres son internos vistos desde la IP de Vercel: el
 * examen de IP rechazaba bien y el motivo devolvía lo que el examen quería no
 * dar. El detalle queda en el log del servidor, contado por motivo y sin URLs.
 * Los motivos que salen de la URL misma —puerto, esquema, IP literal, origen
 * propio— y los `http-<status>` de un origen público no dicen nada de adentro,
 * y siguen tal cual.
 *
 * LA «PERSONA» DE UNA FUENTE HTTP, Y POR QUÉ NO SE GUARDA
 *
 * La puerta dice que una fuente resuelve si responde «y tiene fecha y persona
 * que la verificó». Para una `manual` son `verified_at`/`verified_by`. Para una
 * `http`, la fecha es `last_checked_at`, que escribe esta ruta; la persona es
 * quien disparó la corrida, y va en la respuesta (`ejecutadoPor`) pero NO en la
 * fila: la `0027` sólo deja escribir esas dos columnas sobre una versión
 * publicada, y guardarla pide una migración que agregue la columna y extienda
 * la excepción de su decisión 9. Queda como decisión, no como olvido.
 *
 * VERIFICADO POR MUTACIÓN (R7), con `./scripts/mutar.sh` el 2026-10-06, todas
 * contra `__tests__/route.test.ts`. Ninguna sobrevivió:
 *
 *   R1  sin el 401 antes de todo  . . . . . . . . «sin sesión» y el barrido
 *   R2  sin la membresía en código  . . . . . . . «si la RLS dejara ver…»
 *   R3  una membresía archivada alcanza . . . . . «ARCHIVADA no alcanza»
 *   R4  la escritura toca otra columna  . . . . . «escribe SÓLO…»
 *   R5  la escritura sin la organización  . . . . «escribe SÓLO…»
 *   R6  N del largo de las filas, no del count  . «página de afirmaciones cortada»
 *   R7  sin el chequeo de página cortada  . . . . «página de evidencia cortada»
 *   R8  se escribe lo que no se midió . . . . . . «lo que no se midió no se escribe»
 *   R9  el texto de Postgres llega al navegador . los errores de lectura: 5 tests
 *   R10 sin `https://` delante de `ejemplo.com` . «website sin esquema»
 *   R11 un count ausente se lee como cero . . . . «un count que no vino»
 *   R12 la ficha sin `.eq("business_id")` . . . . «la ficha es la de ESTE negocio»: 2 tests
 *   R13 `hostFuente` recalculado con Node . . . . «url_host lee el PROPIO dominio…»
 *   R14 last_status = el último status visto  . . «un 404 se guarda como 404…»
 *   R15 last_status sólo de las resueltas . . . . «un 404 se guarda como 404…»
 *   R16 sin el rate limit . . . . . . . . . . . . «la sexta desde la misma IP es 429»
 *   R17 la recomprobación sin la versión  . . . . «se publicó otra versión»
 *   R18 la recomprobación sin la membresía  . . . «archivaron a quien la pidió»
 *   R19 el motivo de red tal cual al navegador  . «el mismo motivo, `red`»
 *   R20 menos filas escritas cuenta como guardado «menos filas escritas»
 *   R21 una recomprobación ilegible escribe igual «una recomprobación que no se pudo leer»
 *   R22 la respuesta sin N y M por tipo . . . . . «y la respuesta trae N y M por tipo»
 *   P1  una consulta DNS antes de la sesión . . . el barrido (`precondicionRutas.test.ts`),
 *       que desde esta ronda instrumenta `node:dns`, y «sin sesión» de acá
 *   P2  zod antes de la sesión (2026-10-07) . . . «sin sesión, un cuerpo que zod rechaza»
 *       y el barrido con las variantes `cuerpo-vacio`, `no-json` y `no-objeto`
 *   P3  el rate limit antes de la sesión  . . . . «sin sesión, el rate limit no corre»
 *       y el barrido, con el limitador siempre agotado
 *   P4  leer el cuerpo antes de la sesión . . . . «sin sesión, un cuerpo que zod rechaza»
 *       (`bodyUsed`) y el barrido (`cuerpoTocado`)
 *   P5  un 500 sin proveedor de identidad . . . . «sin proveedor de identidad» y el barrido
 *       con la variante `sin-proveedor`
 *
 * R12 a R22 y P1 salieron de refutar la segunda versión: R12, R13, R16 y R20
 * eran garantías que el código cumplía sin que nada lo midiera; R14/R15, R17
 * a R19, R21 y R22 son los arreglos de esa ronda.
 */

const schema = z.object({ businessId: z.string().uuid() });

/** Ver «QUÉ MOTIVO VE EL NAVEGADOR» en el encabezado. */
const MOTIVOS_DE_RED: ReadonlySet<MotivoNoResuelve> = new Set([
  "dns",
  "ip-no-publica",
  "timeout",
  "sin-respuesta",
  "tls",
]);

function motivoParaElNavegador(motivo: MotivoNoResuelve | null): string | null {
  return motivo !== null && MOTIVOS_DE_RED.has(motivo) ? "red" : motivo;
}

/** Cuántos ids entran en un `in()` sin que la URL de PostgREST se vuelva un problema. */
const TANDA = 50;

function enTandas<T>(items: T[], tamano: number): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) salida.push(items.slice(i, i + tamano));
  return salida;
}

/** Un fallo de lectura, con nombre y sin el detalle de Postgres. */
function fallo(motivo: string, error?: { code?: string } | null) {
  if (error) {
    console.error(`[evidence-check] ${motivo}:`, error.code ?? "sin-codigo");
  }
  return NextResponse.json({ ok: false, motivo }, { status: 502 });
}

type ClienteSesion = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * `url_host(website)`, o `''` si no hay forma de host. `null` = la consulta
 * falló, que NO es lo mismo que un dominio desconocido.
 */
async function hostPropioDe(supabase: ClienteSesion, website: string | null): Promise<string | null> {
  const sitio = (website ?? "").trim();
  if (!sitio) return "";
  const primero = await supabase.rpc("url_host", { p_url: sitio });
  if (primero.error) return null;
  const host = typeof primero.data === "string" ? primero.data : "";
  if (host || sitio.includes("://")) return host;
  const segundo = await supabase.rpc("url_host", { p_url: `https://${sitio}` });
  if (segundo.error) return null;
  return typeof segundo.data === "string" ? segundo.data : "";
}

/**
 * ¿Sigue publicada la versión medida, y sigue activa la membresía de quien la
 * pidió? Con el cliente de SESIÓN, como la primera vez. Un error de lectura
 * tampoco escribe: no saber no es «sigue».
 */
async function sigueVigente(
  supabase: ClienteSesion,
  organizacion: string,
  usuario: string,
  fichaId: string
): Promise<"vigente" | "version-superada" | "membresia-vencida" | "recomprobacion-ilegible"> {
  const { data: membresia, error: errorMembresia } = await supabase
    .from("org_members")
    .select("organization_id")
    .eq("organization_id", organizacion)
    .eq("user_id", usuario)
    .eq("state", "active")
    .maybeSingle();
  if (errorMembresia) {
    console.error("[evidence-check] recomprobacion-ilegible:", errorMembresia.code ?? "sin-codigo");
    return "recomprobacion-ilegible";
  }
  if (!membresia) return "membresia-vencida";
  const { data: vigente, error: errorFicha } = await supabase
    .from("company_profiles")
    .select("id")
    .eq("organization_id", organizacion)
    .eq("id", fichaId)
    .eq("status", "published")
    .maybeSingle();
  if (errorFicha) {
    console.error("[evidence-check] recomprobacion-ilegible:", errorFicha.code ?? "sin-codigo");
    return "recomprobacion-ilegible";
  }
  return vigente ? "vigente" : "version-superada";
}

export async function POST(req: Request) {
  // Paso 1 del encabezado: la sesión, antes del rate limit y antes de leer el
  // cuerpo, y FUERA del try del trabajo: sin proveedor de identidad también es
  // 401 (`quienLlama`), no el 500 de este catch.
  const sesion = await quienLlama();
  if (!sesion) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const { supabase, user } = sesion;

  try {
    // Sale a la red una vez por fuente: 5 por minuto alcanza para chequear una
    // ficha y no para usar la plataforma de rastreador.
    const limitado = rateLimit(req, { limit: 5, windowMs: 60_000, key: "profile-evidence-check" });
    if (limitado) return limitado;

    const { businessId } = schema.parse(await req.json().catch(() => ({})));

    const { data: negocio, error: errorNegocio } = await supabase
      .from("businesses")
      .select("id, organization_id, website")
      .eq("id", businessId)
      .maybeSingle();
    if (errorNegocio) return fallo("negocio-ilegible", errorNegocio);
    if (!negocio) return NextResponse.json({ error: "not found" }, { status: 404 });
    const organizacion = negocio.organization_id as string;

    // Paso 4 del encabezado: la organización, en código, porque más abajo se
    // escribe con una llave que no mira la RLS.
    const { data: membresia, error: errorMembresia } = await supabase
      .from("org_members")
      .select("organization_id")
      .eq("organization_id", organizacion)
      .eq("user_id", user.id)
      .eq("state", "active")
      .maybeSingle();
    if (errorMembresia) return fallo("membresia-ilegible", errorMembresia);
    if (!membresia) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data: ficha, error: errorFicha } = await supabase
      .from("company_profiles")
      .select("id, version")
      .eq("organization_id", organizacion)
      .eq("business_id", negocio.id)
      .eq("status", "published")
      .maybeSingle();
    if (errorFicha) return fallo("ficha-ilegible", errorFicha);

    let n = 0;
    let afirmaciones: Afirmacion[] = [];
    const fuentes: Fuente[] = [];

    if (ficha) {
      const {
        data: objetivos,
        error: errorObjetivos,
        count,
      } = await supabase
        .from("profile_objectives")
        .select("id, kind", { count: "exact" })
        .eq("organization_id", organizacion)
        .eq("profile_id", ficha.id);
      // Un `count` que no vino no es cero: es que no se sabe.
      if (errorObjetivos || count === null || count === undefined) {
        return fallo("afirmaciones-ilegibles", errorObjetivos);
      }
      n = count;
      afirmaciones = ((objetivos ?? []) as Array<{ id: string; kind: string }>).map((o) => ({
        id: o.id,
        tipo: o.kind,
      }));

      for (const ids of enTandas(
        afirmaciones.map((a) => a.id),
        TANDA
      )) {
        const {
          data: filas,
          error: errorEvidencia,
          count: cuantas,
        } = await supabase
          .from("profile_evidence")
          .select("id, objective_id, kind, url, source_host, verified_at, verified_by", { count: "exact" })
          .eq("organization_id", organizacion)
          .in("objective_id", ids);
        if (errorEvidencia || cuantas === null || cuantas === undefined) {
          return fallo("evidencia-ilegible", errorEvidencia);
        }
        const leidas = (filas ?? []) as Array<{
          id: string;
          objective_id: string;
          kind: string;
          url: string;
          source_host: string | null;
          verified_at: string | null;
          verified_by: string | null;
        }>;
        // Menos filas que el `count` es una página cortada, y una fuente que no
        // se leyó convertiría una afirmación en «sin evidencia» por un límite de
        // PostgREST.
        if (leidas.length !== cuantas) return fallo("lectura-incompleta");
        for (const f of leidas) {
          fuentes.push({
            id: f.id,
            objetivoId: f.objective_id,
            tipo: f.kind,
            url: f.url,
            hostFuente: f.source_host,
            verificadaEn: f.verified_at,
            verificadaPor: f.verified_by,
          });
        }
      }
    }

    const hostPropio = await hostPropioDe(supabase, negocio.website as string | null);
    if (hostPropio === null) return fallo("dominio-propio-ilegible");

    const ejecutadoEn = new Date().toISOString();
    const resultado = await chequearEvidencia(
      { n, afirmaciones, fuentes, hostPropio },
      dependenciasDeProduccion()
    );
    if (!resultado.ok) return fallo(resultado.motivo);

    // La escritura: sólo lo MEDIDO, agrupado por status para no hacer un UPDATE
    // por fila.
    const porStatus = new Map<number | null, string[]>();
    for (const f of resultado.fuentes) {
      if (!f.medida) continue;
      const medido = statusMedido(f);
      const status = medido !== null && medido >= 100 && medido <= 599 ? medido : null;
      porStatus.set(status, [...(porStatus.get(status) ?? []), f.id]);
    }
    let guardado: { ok: boolean; filas: number; esperadas: number; motivo?: string } = {
      ok: true,
      filas: 0,
      esperadas: 0,
    };
    // Paso 8 del encabezado: lo que se comprobó antes de la red, otra vez.
    const vigencia = porStatus.size > 0 && ficha ? await sigueVigente(supabase, organizacion, user.id, ficha.id) : null;
    if (vigencia !== null && vigencia !== "vigente") {
      const esperadas = [...porStatus.values()].reduce((total, ids) => total + ids.length, 0);
      guardado = { ok: false, filas: 0, esperadas, motivo: vigencia };
    } else if (porStatus.size > 0) {
      const admin = createSupabaseAdminClient();
      for (const [status, ids] of porStatus) {
        for (const tanda of enTandas(ids, TANDA)) {
          guardado.esperadas += tanda.length;
          const { error: errorEscritura, count: escritas } = await admin
            .from("profile_evidence")
            .update({ last_checked_at: ejecutadoEn, last_status: status }, { count: "exact" })
            .eq("organization_id", organizacion)
            .in("id", tanda);
          if (errorEscritura) {
            console.error("[evidence-check] escritura rechazada:", errorEscritura.code ?? "sin-codigo");
            guardado = { ...guardado, ok: false };
            continue;
          }
          guardado.filas += escritas ?? 0;
        }
      }
      // Menos filas escritas que las pedidas también es no haber guardado.
      if (guardado.filas !== guardado.esperadas) guardado = { ...guardado, ok: false };
    }

    console.log(`[evidence-check] negocio=${negocio.id} version=${ficha?.version ?? "-"} ${resultado.linea}`);
    const deRed = new Map<string, number>();
    for (const f of resultado.fuentes) {
      if (f.motivo !== null && MOTIVOS_DE_RED.has(f.motivo)) deRed.set(f.motivo, (deRed.get(f.motivo) ?? 0) + 1);
    }
    if (deRed.size > 0) {
      console.log(
        `[evidence-check] negocio=${negocio.id} motivos de red: ${[...deRed].map(([m, c]) => `${m}=${c}`).join(" ")}`
      );
    }

    return NextResponse.json(
      {
        ok: true,
        verde: resultado.verde,
        linea: resultado.linea,
        n: resultado.n,
        m: resultado.m,
        porTipo: resultado.porTipo,
        cubetas: resultado.cubetas,
        porcentajeAMano: resultado.porcentajeAMano,
        afirmacionesSinEvidencia: resultado.afirmacionesSinEvidencia,
        motivosRojo: resultado.motivosRojo,
        contraprueba: resultado.contraprueba,
        fuentes: resultado.fuentes.map((f) => ({
          id: f.id,
          objetivoId: f.objetivoId,
          url: f.url,
          cubeta: f.cubeta,
          motivo: motivoParaElNavegador(f.motivo),
          status: f.status,
          degradada: f.degradada,
          saltos: f.saltos,
        })),
        afirmaciones: resultado.afirmaciones,
        version: ficha?.version ?? null,
        guardado,
        ejecutadoPor: user.id,
        ejecutadoEn,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(error, 400);
    return apiError(error, 500);
  }
}
