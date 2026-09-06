import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accesoDeLasIA, textoSinJavaScript, tiposDeSchema } from "@/lib/aeo/lectura";
import { hallazgos, type LecturaDelSitio } from "@/lib/aeo/hallazgos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Tres peticiones a un sitio ajeno, que puede ser lento. */
export const maxDuration = 30;

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
 * UN FALLO DE RED NO ES UN HALLAZGO
 *
 * Si el `robots.txt` no se pudo traer, eso NO es «permite a todos»: es que no se
 * sabe. Se informa con su motivo, como `integration_probe`, en vez de rellenarlo
 * con un optimismo que después alguien lee como un hecho.
 */

const schema = z.object({ businessId: z.string().uuid() });

/** Un sitio ajeno no tiene por qué contestar rápido, ni nosotros que esperarlo. */
const TIMEOUT_MS = 8_000;

async function traer(
  url: string
): Promise<{ ok: true; texto: string } | { ok: false; motivo: string }> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: corte.signal,
      redirect: "follow",
      headers: { "user-agent": "VulkanGrowthOS/1.0 (auditoria AEO)" },
      cache: "no-store",
    });
    // Un 404 en `robots.txt` o en `llms.txt` es una respuesta y no un fallo:
    // significa que el archivo no está, que es exactamente lo que se pregunta.
    if (!res.ok) return { ok: false, motivo: `http ${res.status}` };
    return { ok: true, texto: await res.text() };
  } catch (e) {
    return { ok: false, motivo: (e as Error).name === "AbortError" ? "timeout" : "sin-respuesta" };
  } finally {
    clearTimeout(reloj);
  }
}

export async function POST(req: Request) {
  // Sale a internet: 10 por minuto alcanza para auditar clientes y no para usar
  // la plataforma como rastreador.
  const limitado = rateLimit(req, { limit: 10, windowMs: 60_000, key: "aeo-audit" });
  if (limitado) return limitado;

  try {
    const { businessId } = schema.parse(await req.json().catch(() => ({})));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

    const { data: negocio, error } = await supabase
      .from("businesses")
      .select("id, website")
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

    const [robots, portada, llms] = await Promise.all([
      traer(new URL("/robots.txt", base).toString()),
      traer(base.toString()),
      traer(new URL("/llms.txt", base).toString()),
    ]);

    // La portada es la única imprescindible: sin ella no hay ni schema ni texto
    // que medir, y devolver ceros sería inventar dos hallazgos.
    if (!portada.ok) {
      return NextResponse.json(
        { ok: false, motivo: "sitio-inalcanzable", detalle: portada.motivo },
        { status: 502 }
      );
    }

    // Un `robots.txt` que no se pudo traer se trata como AUSENTE, que es lo que
    // el estándar dice: sin robots, se permite. Y se informa que no se leyó, para
    // que nadie confunda «permite» con «no se pudo mirar».
    const textoRobots = robots.ok ? robots.texto : "";

    const lectura: LecturaDelSitio = {
      acceso: accesoDeLasIA(textoRobots),
      caracteresSinJs: textoSinJavaScript(portada.texto),
      schema: tiposDeSchema(portada.texto),
      tieneLlmsTxt: llms.ok,
    };

    return NextResponse.json(
      {
        ok: true,
        url: base.toString(),
        robotsLeido: robots.ok,
        motivoRobots: robots.ok ? null : robots.motivo,
        lectura,
        hallazgos: hallazgos(lectura),
      },
      { status: 200 }
    );
  } catch (error) {
    return apiError(error);
  }
}
