import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { quienLlama } from "@/lib/api/sesion";
import {
  accesoDeLasIA,
  AGENTES_IA,
  erroresDeSchema,
  textoSinJavaScript,
  tiposDeSchema,
} from "@/lib/aeo/lectura";
import { statusPorAgente } from "@/lib/aeo/peticion";
import { esLegiblePorIA, hallazgos, type LecturaDelSitio } from "@/lib/aeo/hallazgos";
import { dependenciasDeProduccion } from "@/lib/aeo/chromium";
import { medirRenderizado } from "@/lib/aeo/renderizado";
import {
  crearRedExaminada,
  MOTIVOS_DE_BLOQUEO,
  PLAZO_POR_PEDIDO_DE_LA_RUTA_MS,
  traerExaminado,
  type RedExaminada,
} from "@/lib/aeo/red";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * La portada (8 s, redirecciones incluidas), y después, en paralelo, el
 * `robots.txt` y el `llms.txt` del origen al que llevó la portada (8 s), las
 * cinco por agente (8 s) y el render en Chromium (`renderizado.ts`: 40 s de
 * tope total, más 5 s para cerrar el navegador). Peor caso, unos 53 s: la
 * cuenta la suma `renderizado.test.ts` (RT-2).
 *
 * 59 y no 60, A PROPÓSITO: el builder de Vercel junta en UNA función las rutas
 * con la misma configuración. MEDIDO con `vercel inspect` sobre la preview de
 * este PR (RV-3): con 60, esta ruta compartía función con `geo/grid`,
 * `profile/evidence-check` y `reports/generate` —las tres con 60—, y las tres
 * pasaron de 2,0 MB a 72,8 MB y a compartir instancia con un Chromium. Un
 * valor que ninguna otra ruta tiene la deja sola; `funcionPropia.test.ts` lo
 * sostiene.
 */
export const maxDuration = 59;

/**
 * QUÉ IMPIDE ESTA RUTA
 *
 * Que no sepamos si el sitio de un cliente deja entrar a las inteligencias
 * artificiales.
 *
 * Es la primera de las cinco pasadas que el alta va a disparar, y la más barata:
 * tres peticiones HTTP. Va primero porque las dos cosas que mide son BINARIAS y
 * son la mitad del resultado — bloquear a los rastreadores, y necesitar
 * JavaScript para tener contenido.
 *
 * EL SITIO SALE DEL NEGOCIO, NO DEL PEDIDO
 *
 * Si la URL la mandara quien llama, esto sería un buscador de sitios ajenos con
 * la IP de la plataforma. Se lee de `businesses` COMO EL USUARIO, así que la RLS
 * contesta la membresía y sólo se puede auditar el sitio de un cliente propio.
 *
 * Y QUE VENGA DEL NEGOCIO NO LO HACE SEGURO: lo escribe cualquier miembro de
 * la organización. Por eso TODO pedido de esta ruta —el `robots.txt`, la
 * portada, el `llms.txt`, uno por agente y el render— examina la dirección de
 * cada salto antes de conectarse, y sigue las redirecciones a mano, volviendo
 * a examinar el destino (`red.ts`). Un sitio cargado como `http://10.0.0.7/`,
 * o uno público que redirige a la metadata, se contesta `destino-rechazado`
 * sin un solo pedido a esa dirección.
 *
 * UN FALLO DE RED NO ES UN HALLAZGO
 *
 * Si el `robots.txt` no se pudo traer, eso NO es «permite a todos»: es que no se
 * sabe. Se informa con su motivo, como `integration_probe`, en vez de rellenarlo
 * con un optimismo que después alguien lee como un hecho. RFC 9309 separa los
 * dos casos y acá se separan igual: un 4xx es «no hay robots» y deja entrar a
 * todos; un 5xx, un timeout o una red que no contesta dejan el acceso SIN
 * MEDIR, y así sale —`no-medido`, nunca verde—. Lo mismo un agente cuyo pedido
 * no volvió.
 */

const schema = z.object({ businessId: z.string().uuid() });

/** Un sitio ajeno no tiene por qué contestar rápido, ni nosotros que esperarlo. */
const TIMEOUT_MS = PLAZO_POR_PEDIDO_DE_LA_RUTA_MS;

/** Lo que se lee de un sitio ajeno, como mucho: lo mismo que el render. */
const MAX_BYTES = 5 * 1024 * 1024;

const AGENTE = "VulkanGrowthOS/1.0 (auditoria AEO)";

type Traido =
  | { ok: true; texto: string; /** La URL del último salto. */ url: string }
  | { ok: false; motivo: string; bloqueado: boolean; /** El status, si hubo respuesta. */ status: number | null };

async function traer(red: RedExaminada, url: string): Promise<Traido> {
  const t = await traerExaminado(red, url, { userAgent: AGENTE, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
  if (!t.ok) return { ok: false, motivo: t.motivo, bloqueado: MOTIVOS_DE_BLOQUEO.has(t.motivo), status: null };
  // Un 404 en `robots.txt` o en `llms.txt` es una respuesta y no un fallo:
  // significa que el archivo no está, que es exactamente lo que se pregunta.
  if (t.status < 200 || t.status >= 300) {
    return { ok: false, motivo: `http ${t.status}`, bloqueado: false, status: t.status };
  }
  return { ok: true, texto: t.cuerpo.toString("utf8"), url: t.url };
}

/**
 * Qué dice el robots, según RFC 9309: 2xx se lee; 4xx es «no está» y deja
 * entrar a todos; todo lo demás —5xx, timeout, red, una redirección que no se
 * pudo seguir— no dice nada, y el acceso por robots queda sin medir.
 */
function estadoDelRobots(robots: Traido): "leido" | "ausente" | "no-medido" {
  if (robots.ok) return "leido";
  return robots.status !== null && robots.status >= 400 && robots.status < 500 ? "ausente" : "no-medido";
}

export async function POST(req: Request) {
  // La sesión primero, antes del rate limit, del cuerpo y de zod, y FUERA del
  // try del trabajo: sin ella —o sin proveedor de identidad, `quienLlama`— 401
  // y nada más. Lo mide `precondicionRutas.test.ts` con cada variante de pedido.
  const sesion = await quienLlama();
  if (!sesion) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const { supabase } = sesion;

  try {
    // Sale a internet: 10 por minuto alcanza para auditar clientes y no para usar
    // la plataforma como rastreador.
    const limitado = rateLimit(req, { limit: 10, windowMs: 60_000, key: "aeo-audit" });
    if (limitado) return limitado;

    const { businessId } = schema.parse(await req.json().catch(() => ({})));

    const { data: negocio, error } = await supabase
      .from("businesses")
      .select("id, organization_id, website")
      .eq("id", businessId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: "business unreadable" }, { status: 502 });
    if (!negocio) return NextResponse.json({ error: "not found" }, { status: 404 });

    const sitio = (negocio.website as string | null)?.trim();
    if (!sitio) {
      // No es un hallazgo del sitio: es que no hay sitio que mirar. Devolver
      // hallazgos acá diría que el sitio está mal cuando no hay ninguno.
      return NextResponse.json({ ok: false, motivo: "sin-sitio" }, { status: 409 });
    }

    let base: URL;
    try {
      base = new URL(sitio.startsWith("http") ? sitio : `https://${sitio}`);
    } catch {
      return NextResponse.json({ ok: false, motivo: "sitio-ilegible" }, { status: 409 });
    }

    // Las dependencias de red se arman una vez: el mismo resolvedor y el
    // mismo transporte para los pedidos de la ruta y para el render.
    const deps = dependenciasDeProduccion();
    const red = crearRedExaminada(deps);

    const portada = await traer(red, base.toString());

    // La portada es la única imprescindible: sin ella no hay ni schema ni texto
    // que medir, y devolver ceros sería inventar dos hallazgos.
    if (!portada.ok) {
      // Un destino que el examen rechaza no es un sitio caído: es una
      // dirección que esta ruta no pide —red interna, puerto raro, esquema
      // que no es web—, y se dice distinto porque se arregla distinto.
      if (portada.bloqueado) {
        return NextResponse.json(
          { ok: false, motivo: "destino-rechazado", detalle: portada.motivo },
          { status: 422 }
        );
      }
      return NextResponse.json(
        { ok: false, motivo: "sitio-inalcanzable", detalle: portada.motivo },
        { status: 502 }
      );
    }

    // La página que se audita es la del ÚLTIMO salto de la portada, y el
    // `robots.txt` que la gobierna es el de SU origen, preguntado por SU ruta.
    // Leerlo en "/" del sitio cargado dejaba en verde a toda página que no
    // fuera la raíz: la de control de la puerta H2-GO-1 —bloqueada en el
    // robots para GPTBot y ClaudeBot— salía con todos los agentes adentro,
    // porque "/" no cae bajo `Disallow: /aeo-control` y además el despliegue
    // redirige `/aeo-control/` a `/aeo-control`.
    const final = new URL(portada.url);
    const rutaFinal = `${final.pathname}${final.search}`;

    // La petición REAL con cada user-agent. No reemplaza la lectura del
    // robots: la complementa con lo que el servidor hace de verdad, que es lo
    // que la puerta H2-GO-1 exige y lo único que un CDN no puede fingir.
    //
    // Y en paralelo, el DOM RENDERIZADO: la otra mitad del punto «contenido
    // sin JavaScript». Va después de la portada a propósito —si el sitio no
    // contesta no se arranca un navegador— y nunca rechaza: un render que
    // falla vuelve como `{ estado: "fallo", codigo }`, y el hallazgo lo dice
    // como «no medido», no como un cero.
    const [robots, llms, statusAgentes, caracteresRenderizados] = await Promise.all([
      traer(red, new URL("/robots.txt", final).toString()),
      traer(red, new URL("/llms.txt", final).toString()),
      statusPorAgente(base.toString(), red),
      medirRenderizado(base.toString(), deps),
    ]);

    // Un `robots.txt` que NO ESTÁ (4xx) se lee como vacío, que es lo que el
    // estándar dice: sin robots, se permite. Uno que no se pudo traer deja el
    // acceso en `null` por agente —«no se sabe»—, y el hallazgo lo dice como
    // no medido. Antes los dos se leían «permite a todos» (P3).
    const estadoRobots = estadoDelRobots(robots);
    const acceso =
      estadoRobots === "no-medido"
        ? (Object.fromEntries(AGENTES_IA.map((a) => [a, null])) as LecturaDelSitio["acceso"])
        : accesoDeLasIA(robots.ok ? robots.texto : "", rutaFinal);

    const lectura: LecturaDelSitio = {
      acceso,
      ...(estadoRobots === "no-medido" && !robots.ok ? { robotsNoMedido: robots.motivo } : {}),
      statusPorAgente: statusAgentes,
      caracteresSinJs: textoSinJavaScript(portada.texto),
      caracteresRenderizados,
      schema: tiposDeSchema(portada.texto),
      erroresDeSchema: erroresDeSchema(portada.texto),
      tieneLlmsTxt: llms.ok,
    };

    // `caracteresRenderizados` NO se guarda: la 0025 no tiene columna para
    // él, y ni `acceso` ni `schema_encontrado` son su lugar —meterlo en un
    // jsonb ajeno sería escribir en la base un dato con otro nombre—. Viaja en
    // la respuesta; guardarlo pide una migración que este cambio no escribe.
    //
    // Una fila por corrida: la historia es el producto (encabezado de la 0025).
    // Hasta hoy la tabla existía y nadie la escribía — la forma «módulo sin
    // llamadores» del #95, en versión tabla. Si la escritura falla, la
    // auditoría igual se devuelve: guardarla es valioso, perderla no puede
    // costar la respuesta.
    const { error: errorGuardado } = await supabase.from("aeo_audits").insert({
      organization_id: negocio.organization_id,
      business_id: negocio.id,
      url: base.toString(),
      robots_leido: robots.ok,
      acceso: { robots: lectura.acceso, http: statusAgentes },
      caracteres_sin_js: lectura.caracteresSinJs,
      schema_encontrado: { tipos: lectura.schema, errores: lectura.erroresDeSchema },
      llms_txt: llms.ok,
    });

    const lista = hallazgos(lectura);
    return NextResponse.json(
      {
        ok: true,
        url: base.toString(),
        urlFinal: final.toString(),
        robotsLeido: robots.ok,
        estadoRobots,
        motivoRobots: robots.ok ? null : robots.motivo,
        guardada: !errorGuardado,
        lectura,
        hallazgos: lista,
        // `true` sólo sin bloqueantes Y con todo medido; `null` es «no se
        // sabe». La pantalla dice «sin hallazgos» sólo con `true`.
        legible: esLegiblePorIA(lista),
      },
      { status: 200 }
    );
  } catch (error) {
    return apiError(error);
  }
}
