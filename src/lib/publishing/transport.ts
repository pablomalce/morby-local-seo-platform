/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que publicar en la cuenta de un cliente sea un camino que nadie recorrió antes
 * de recorrerlo por primera vez de verdad.
 *
 * La `0016` dejó el ledger con sus garantías puestas —la idempotencia por
 * unicidad, la FK compuesta contra el texto aprobado, `published` que exige id de
 * la red y fecha— y al 2026-09-03 **nada en `src/` lo tocaba**. Una tabla con
 * cuatro restricciones que ningún código escribe es una promesa sin probar: el
 * día que aparezca la cuota de Google Business Profile, el primer intento sería
 * también el primer estreno del camino, contra la ficha de un cliente real.
 *
 * EL `dry-run` NO ES UN SIMULACRO
 *
 * Es la diferencia entre este módulo y un doble. Un simulacro contestaría que
 * todo saldría bien; esto **le pregunta a la base**, con la escritura real, si la
 * publicación es admisible — y por eso encuentra lo que un simulacro no puede: un
 * asset que volvió a borrador, una publicación que ya existe, un hash que dejó de
 * coincidir. Lo único que no hace es hablar con la red.
 *
 * POR QUÉ EL ENSAYO SÍ ESCRIBE, Y POR QUÉ ESO NO ENSUCIA EL LEDGER
 *
 * Se pensó en no escribir: comprobar con un SELECT que el asset esté aprobado y
 * que no haya ya una publicación. Se descartó, y el motivo es la regla de este
 * proyecto: ese SELECT sería una COPIA de lo que la FK y la unicidad ya
 * garantizan, y una copia diverge. Cuando alguien cambie la `0015` o la `0016`,
 * la copia seguiría contestando lo de antes.
 *
 * Escribir de verdad no ensucia nada porque `pending` es literalmente cierto: la
 * publicación está reservada y no salió. Nada dice `published` que no se publicó
 * —el CHECK de la `0016` ni siquiera lo permitiría sin id de red y fecha— y
 * `attempts` en 0 dice que nunca se intentó contra la red. Un ensayo y un intento
 * en vivo que se cortó antes de llamar dejan la misma fila, y está bien: las dos
 * significan lo mismo.
 *
 * Y la reserva del ensayo es la MISMA fila que después usa el envío en vivo, por
 * la unicidad `(asset_id, destination)`. O sea que el ensayo no es un camino
 * paralelo: es el mismo camino, cortado antes del último paso.
 *
 * EN VIVO SIN TRANSPORTE FALLA, NO CALLA
 *
 * Hoy no existe ningún publicador: la API de Business Profile no tiene cuota. Un
 * `en-vivo` sin publicador podría no hacer nada y devolver que todo bien, y ése
 * es el peor defecto posible acá — el ledger diría que se publicó lo que nadie
 * mandó. Falla con `sin-transporte`. **Un cero inventado se suma; un fallo se
 * ve.**
 *
 * POR QUÉ NO SE COPIÓ EL PATRÓN DEL LEAD ENGINE, QUE LA ESPINA MANDABA COPIAR
 *
 * La espina dice, en F3, que *"el patrón ya existe y funciona en el Lead
 * Engine"*. Se fue a mirar: lo que existe es `lib/email/transport.ts`, y no es un
 * `dry-run` sino DOS transportes, elegidos por variable de entorno —
 * `ConsoleTransport` cuando falta `RESEND_API_KEY`. Como default de desarrollo
 * está bien y es deliberado.
 *
 * Copiarlo acá habría traído un defecto que allá no es tan caro: la elección la
 * hace el ENTORNO y el resultado dice `ok: true`. O sea que un despliegue sin
 * credencial cree que publicó. En una ficha de cliente eso significa un ledger
 * lleno de publicaciones que nadie mandó, y nadie iría a mirar porque nada estaría
 * roto.
 *
 * Por eso acá el modo es un ARGUMENTO de quien llama, no una variable de entorno,
 * y la falta de publicador es un fallo y no un camino alternativo.
 *
 * LO QUE ESTE MÓDULO NO CRUZA
 *
 * La puerta de F4 pide *una publicación real en una ficha de prueba*. Esto no la
 * cruza y no puede: un doble no cruza una puerta. Deja el camino recorrido hasta
 * el borde.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * A dónde se publica.
 *
 * Un solo valor, igual que el CHECK `publications_destination_check` de la
 * `0016`. Está escrito acá y no importado de ningún lado porque el día que se
 * agregue un destino tienen que ponerse rojas las DOS puntas: la migración y
 * esto.
 */
export type Destino = "google_business_profile";

/** Lo que hay que saber para publicar una vez. */
export interface EntradaPublicacion {
  organizationId: string;
  assetId: string;
  /**
   * El sello del texto aprobado, tal como lo tiene `content_assets`. Viaja
   * explícito y no se lee acá: la FK compuesta de la `0016` lo verifica contra la
   * fila del asset, así que un hash viejo hace que la reserva sea RECHAZADA en
   * vez de publicar un texto que ya nadie aprobó.
   */
  approvedHash: string;
  destino: Destino;
}

/** Qué se le pidió al transporte. */
export type Modo = "dry-run" | "en-vivo";

/** Lo que contesta la red cuando se publica de verdad. */
export type ResultadoRed =
  | { ok: true; externalId: string }
  | { ok: false; motivo: string };

/**
 * Quien sabe hablar con un destino.
 *
 * Se inyecta, igual que `llamar` en `runAi`: este módulo garantiza el ledger, no
 * el protocolo de cada red. Meter acá la forma de la API de Google haría que
 * agregar un destino fuera tocar el lugar donde vive la garantía.
 */
export interface Publicador {
  publicar(entrada: EntradaPublicacion): Promise<ResultadoRed>;
}

export type ResultadoTransporte =
  /** El ensayo llegó hasta el borde: la base aceptó la reserva y no se publicó. */
  | { ok: true; estado: "ensayado"; publicationId: string }
  /** Salió, y el ledger tiene el id de la red. */
  | { ok: true; estado: "publicado"; publicationId: string; externalId: string }
  /** Ya estaba publicada: un reintento no duplica. La unicidad lo decidió. */
  | { ok: true; estado: "ya-publicado"; publicationId: string; externalId: string }
  /**
   * La base rechazó la reserva. Casi siempre significa que el asset no está
   * aprobado, o que su texto cambió después de aprobarse y el `approved_hash`
   * quedó en NULL.
   */
  | { ok: false; motivo: "no-aprobado" }
  /** Se pidió `en-vivo` y no hay quién publique. Ver el encabezado. */
  | { ok: false; motivo: "sin-transporte" }
  /** La red contestó que no. La fila queda en `failed`, con el intento contado. */
  | { ok: false; motivo: "red-rechazo"; publicationId: string; detalle: string }
  /** No se pudo leer ni escribir el ledger. No se publicó nada. */
  | { ok: false; motivo: "ledger-ilegible"; detalle: string };

/** `foreign_key_violation`: la FK compuesta contra `(id, approved_hash)`. */
const FK_VIOLADA = "23503";
/** `unique_violation`: alguien ya reservó este asset para este destino. */
const UNICIDAD_VIOLADA = "23505";

/**
 * Una fila del ledger, en lo que este módulo mira de ella.
 */
interface FilaPublicacion {
  id: string;
  status: string;
  external_id: string | null;
  attempts: number;
}

/**
 * Reserva la fila, o recupera la que ya estaba.
 *
 * El insert va PRIMERO y sin consultar antes a propósito. Consultar y después
 * insertar deja la ventana clásica: dos procesos preguntan, los dos ven que no
 * hay nada, los dos insertan. Que el segundo choque contra la unicidad no es un
 * error a evitar sino la garantía funcionando, y por eso `23505` se trata como
 * un camino normal.
 */
async function reservar(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  entrada: EntradaPublicacion
): Promise<
  | { ok: true; fila: FilaPublicacion }
  | { ok: false; motivo: "no-aprobado" }
  | { ok: false; motivo: "ledger-ilegible"; detalle: string }
> {
  const { data, error } = await admin
    .from("publications")
    .insert({
      organization_id: entrada.organizationId,
      asset_id: entrada.assetId,
      approved_hash: entrada.approvedHash,
      destination: entrada.destino,
      status: "pending",
    })
    .select("id, status, external_id, attempts")
    .maybeSingle();

  if (!error && data) return { ok: true, fila: data as FilaPublicacion };

  const codigo = (error as { code?: string } | null)?.code;

  if (codigo === FK_VIOLADA) return { ok: false, motivo: "no-aprobado" };

  if (codigo === UNICIDAD_VIOLADA) {
    const yaEsta = await admin
      .from("publications")
      .select("id, status, external_id, attempts")
      .eq("asset_id", entrada.assetId)
      .eq("destination", entrada.destino)
      .maybeSingle();

    if (yaEsta.error || !yaEsta.data) {
      return {
        ok: false,
        motivo: "ledger-ilegible",
        detalle:
          yaEsta.error?.message ??
          "la unicidad rechazó la reserva y después no apareció la fila que la rechazó",
      };
    }
    return { ok: true, fila: yaEsta.data as FilaPublicacion };
  }

  return {
    ok: false,
    motivo: "ledger-ilegible",
    detalle: error?.message ?? "el insert no devolvió fila y tampoco error",
  };
}

/**
 * Recorre el camino de publicar una vez.
 *
 * En `dry-run` el publicador NO SE LLAMA. No es que se llame y se descarte lo
 * que devuelva: no se lo toca, y el test lo comprueba con un publicador que
 * revienta si alguien lo invoca. Un ensayo que llamara a la red publicaría de
 * verdad la primera vez que el doble fuera reemplazado por el cliente real.
 */
export async function publicar(
  entrada: EntradaPublicacion,
  modo: Modo,
  publicador?: Publicador
): Promise<ResultadoTransporte> {
  const admin = createSupabaseAdminClient();

  const reserva = await reservar(admin, entrada);
  if (!reserva.ok) return reserva;

  const fila = reserva.fila;

  // Antes que nada: si ya salió, no se vuelve a mandar. Es la idempotencia que
  // pide la espina, y se contesta igual en ensayo que en vivo — preguntar «¿ya
  // está?» no depende de si se iba a publicar.
  if (fila.status === "published") {
    if (!fila.external_id) {
      // El CHECK `publications_published_is_complete` lo impide. Si aparece, el
      // ledger está roto de una manera que este módulo no debe tapar publicando
      // encima.
      return {
        ok: false,
        motivo: "ledger-ilegible",
        detalle: "una fila publicada sin id de la red",
      };
    }
    return {
      ok: true,
      estado: "ya-publicado",
      publicationId: fila.id,
      externalId: fila.external_id,
    };
  }

  if (modo === "dry-run") {
    return { ok: true, estado: "ensayado", publicationId: fila.id };
  }

  if (!publicador) return { ok: false, motivo: "sin-transporte" };

  const intentos = fila.attempts + 1;
  const respuesta = await publicador.publicar(entrada);

  if (!respuesta.ok) {
    await admin
      .from("publications")
      .update({ status: "failed", attempts: intentos })
      .eq("id", fila.id);
    return {
      ok: false,
      motivo: "red-rechazo",
      publicationId: fila.id,
      detalle: respuesta.motivo,
    };
  }

  const cierre = await admin
    .from("publications")
    .update({
      status: "published",
      external_id: respuesta.externalId,
      published_at: new Date().toISOString(),
      attempts: intentos,
    })
    .eq("id", fila.id);

  if ((cierre as { error?: { message?: string } | null }).error) {
    // La red YA publicó. No poder anotarlo es grave y no se puede deshacer, así
    // que lo que no se hace es devolver éxito: quien reintente va a chocar contra
    // la unicidad `(destination, external_id)` si intenta anotar el mismo post en
    // otra fila, y va a ver esta fila `pending` en el ledger.
    return {
      ok: false,
      motivo: "ledger-ilegible",
      detalle: `se publicó ${respuesta.externalId} y no se pudo anotar: ${
        (cierre as { error?: { message?: string } | null }).error?.message ?? "sin motivo"
      }`,
    };
  }

  return {
    ok: true,
    estado: "publicado",
    publicationId: fila.id,
    externalId: respuesta.externalId,
  };
}
