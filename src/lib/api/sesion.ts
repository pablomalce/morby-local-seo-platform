import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pregunta «¿quién llama?» conteste otra cosa que «alguien» o «nadie».
 *
 * Una ruta con sesión hace dos cosas con esa pregunta: la hace PRIMERO —antes
 * del rate limit, antes de leer el cuerpo, antes de zod— y, si la respuesta es
 * «nadie», contesta 401 y nada más. La segunda mitad tenía un agujero que el
 * orden solo no cierra. MEDIDO el 2026-10-07 en modo demo (sin
 * `NEXT_PUBLIC_SUPABASE_URL` ni `NEXT_PUBLIC_SUPABASE_ANON_KEY`, un estado que el
 * middleware soporta): `createSupabaseServerClient()` tira, y en las ocho rutas
 * que acababan de poner la sesión primero ese throw caía en el `catch` del
 * trabajo de la ruta. Un anónimo recibía `400 Request could not be processed.`
 * de seis y `500` de dos (evidence-check y rehearse, cuyo catch separa zod del
 * resto). Sólo `/api/reports/generate`, que llevaba la pregunta en su propio
 * try, contestaba `401`. Y el barrido, con la variante `sin-proveedor`, encontró
 * además las dos rutas de OAuth de Google tirando `500` por el mismo camino
 * (`esOperadorDeLaAgencia`, sin try).
 *
 * Por eso la pregunta vive acá, en un solo lugar, con su propio try: si el
 * proveedor de identidad no se puede construir, o tira al preguntar, eso es
 * «nadie», no un error del pedido. Falla CERRADO, como `requireInternalSecret`
 * sin su secreto: sin proveedor no hay nadie autenticado.
 *
 * QUÉ NO HACE
 *
 * No contesta la respuesta HTTP: cada ruta escribe su propio 401 (o su 307, en
 * las de navegador), porque la forma de la negación es de la ruta. Y no lee el
 * pedido: no recibe el `Request`, así que no puede tocar el cuerpo antes de que
 * la ruta sepa quién llama. El barrido (`precondicionRutas.test.ts`) mide las
 * dos cosas llamando a cada handler sin sesión y sin proveedor.
 */

/** El cliente de servidor, con RLS, el mismo que devuelve `createSupabaseServerClient`. */
export type ClienteDeServidor = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Quien llama, con el cliente que ya lo sabe. */
export interface Sesion {
  supabase: ClienteDeServidor;
  user: User;
}

/**
 * Quién llama, o `null` si nadie: sin sesión, o sin proveedor de identidad.
 *
 * El `catch` sin variable es a propósito. Lo que falló no es un dato del
 * pedido —el pedido todavía no se leyó— y no hay nada que contarle a quien
 * llama más allá del 401.
 */
export async function quienLlama(): Promise<Sesion | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? { supabase, user } : null;
  } catch {
    return null;
  }
}
