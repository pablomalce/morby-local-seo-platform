import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { chequearEvidencia, type Afirmacion, type Fuente } from "@/lib/profile/evidenceCheck";
import { dependenciasDeProduccion } from "@/lib/profile/nodeTransport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * 1. Rate limit y zod, que no tocan nada.
 * 2. Sesión. Sin ella, 401 ANTES de cualquier lectura y de cualquier salida a
 *    la red: este handler sale a URLs que cargó un usuario, y un anónimo que
 *    pudiera dispararlo tendría un proxy con la IP de la plataforma.
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
 * 7. La escritura, con `service_role`, porque `authenticated` sólo lee la ficha
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
 * El último status HTTP que se vio, o NULL si la fuente se midió y no hubo
 * respuesta HTTP (DNS, timeout, TLS). Una fuente que ni salió a la red —origen
 * propio, URL ambigua, verificada a mano— no se escribe: esas dos columnas son
 * una medición, y lo que no se midió no se anota como medido.
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
 */

const schema = z.object({ businessId: z.string().uuid() });

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

export async function POST(req: Request) {
  // Sale a la red una vez por fuente: 5 por minuto alcanza para chequear una
  // ficha y no para usar la plataforma de rastreador.
  const limitado = rateLimit(req, { limit: 5, windowMs: 60_000, key: "profile-evidence-check" });
  if (limitado) return limitado;

  try {
    const { businessId } = schema.parse(await req.json().catch(() => ({})));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

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
      const status = f.status !== null && f.status >= 100 && f.status <= 599 ? f.status : null;
      porStatus.set(status, [...(porStatus.get(status) ?? []), f.id]);
    }
    let guardado: { ok: boolean; filas: number; esperadas: number } = { ok: true, filas: 0, esperadas: 0 };
    if (porStatus.size > 0) {
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

    return NextResponse.json(
      {
        ok: true,
        verde: resultado.verde,
        linea: resultado.linea,
        n: resultado.n,
        m: resultado.m,
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
          motivo: f.motivo,
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
