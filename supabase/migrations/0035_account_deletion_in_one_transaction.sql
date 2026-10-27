-- 0035_account_deletion_in_one_transaction.sql — la baja de cuenta decide y
-- borra en UNA transacción, con la pregunta hecha en el momento de borrar.
--
-- QUÉ CIERRA
--
-- Los cuatro defectos que el PR #117 (`faade08`) dejó declarados en
-- `deleteMyAccount` (src/lib/auth/account-actions.ts). Los cuatro vienen de lo
-- mismo: la función clasificaba («¿de cuáles soy la única owner activa?») con
-- unos pedidos de PostgREST y borraba con otros, y entre pedido y pedido la
-- base no le prometía nada.
--
--   1. CARRERA. Medida en la réplica el 2026-10-11 con la secuencia de #117
--      intercalada (bloque 402 de `defects_test.sql`): alicia y beto son owners
--      activas de X y se dan de baja a la vez. Cada una lee a la otra como
--      owner, las dos clasifican X como compartida, las dos salen, y X queda
--      SIN NINGÚN MIEMBRO, con todo lo que tiene. Y al revés: si alguien se suma
--      como owner a una propia entre la lectura y el DELETE, la propia se borra
--      igual, con la membresía nueva adentro.
--   2. TRUNCADO. «No hay otro owner» se deducía de que una lectura volviera SIN
--      filas, y PostgREST corta una lectura en `max_rows` (1000 por defecto en
--      Supabase) sin dar error. Medido en la réplica con el corte simulado como
--      LIMIT (bloque 403): con 1001 compartidas, la 1001 se leía propia y se
--      borraba con los negocios de la otra owner.
--   3. ESTADO DESCONOCIDO. Una membresía owner con un `state` que no fuera
--      'active' se leía «no owner», y la organización quedaba sin owner. Hoy no
--      puede pasar: `state` es NOT NULL con CHECK (`active`, `archived`) desde
--      la 0013 (bloque 18 y 404). Esta función igual se niega si lo ve: el día
--      que una migración agregue un estado, la baja falla con nombre en vez de
--      clasificar mal en silencio.
--   4. SELLO SIN SALIDA. Un sello (`content_assets.approved_by`) de la persona
--      en una organización que no se borra traba la baja (el SET NULL de la
--      0015 choca con su CHECK, bloque 401), y la pantalla le dice «pedile a
--      esa organización que lo re-firme o lo vuelva a borrador». Si esa
--      organización no tiene NINGUNA otra persona activa que apruebe —su única
--      owner está archivada, o es la propia persona—, nadie puede re-firmarlo
--      (0031, D4), y la cuenta no se podía borrar nunca. Ver «EL SELLO QUE NADIE
--      PUEDE TOMAR».
--
-- QUIÉN LA LLAMA: SÓLO `service_role`
--
-- La otra opción era «cada persona para sí misma» (`auth.uid()`, EXECUTE a
-- `authenticated`), como `create_client_organization` en la 0024. Se descartó:
--
--   * Es irreversible, y §12.2 pide que lo irreversible pase por una
--     aprobación de servidor. Con EXECUTE a `authenticated`, cualquier script
--     con la llave pública y una sesión —una extensión, un XSS— borra las
--     organizaciones de la persona con un `rpc()` desde el navegador, sin pasar
--     por la confirmación de la pantalla ni por `deleteMyAccount`.
--   * Y deja la cuenta A MEDIAS por diseño: la función no borra el login (eso
--     es de GoTrue), así que llamada sola deja a la persona sin organizaciones
--     y con acceso. Hoy `authenticated` no puede borrar una organización de
--     ninguna manera (no hay policy de DELETE); esto le abriría una.
--
-- La identidad la verifica `deleteMyAccount` con `getUser()` (GoTrue valida el
-- JWT) y la pasa en `p_user_id`. EXECUTE sólo a `service_role`, revocado a
-- PUBLIC, `anon` y `authenticated` (los default privileges de Supabase se lo
-- dan a los tres); el bloque 405 lo mide por catálogo y llamándola con cada rol.
--
-- POR QUÉ `SECURITY DEFINER`, SI `service_role` YA PUEDE TODO
--
-- La regla de la 0024: SECURITY DEFINER sobre un rol que ya tenía lo necesario
-- no agrega una capacidad, agrega un préstamo. Hoy es así: `service_role` tiene
-- BYPASSRLS y DELETE sobre `org_members` y `organizations`. Se elige igual,
-- porque es lo que deja cerrar la puerta: la 0013 le dejó a `service_role` el
-- DELETE sobre `org_members` SÓLO para la baja de cuenta. Con la baja adentro
-- de una función del dueño, una migración CONTRACT posterior —cuando el código
-- desplegado ya no borre membresías por PostgREST— le puede revocar ese DELETE,
-- y esta función queda como la única puerta para borrar una membresía. Esta
-- migración es expand-only y no lo revoca: el código de `faade08` todavía lo usa.
--
-- `postgres` tiene BYPASSRLS en la imagen de Supabase y en hosted (la misma
-- razón por la que `current_user_org_ids()` anda con FORCE ROW LEVEL SECURITY).
-- `search_path` vacío: todo va calificado con `public.`.
--
-- EL PROTOCOLO
--
-- La garantía es que la clasificación se haga DESPUÉS de tener los locks que
-- impiden que cambie, y que la pregunta «¿hay otro owner activo?» la conteste
-- el mismo DELETE que borra. Cuatro piezas, y cada una tiene su bloque rojo:
--
--   a. FOR UPDATE sobre las ORGANIZACIONES candidatas (donde es owner activa),
--      en orden de id. Un INSERT en `org_members` toma FOR KEY SHARE sobre su
--      organización por la FK, y eso choca con FOR UPDATE: mientras la baja
--      corre, nadie se suma a una candidata. Y dos bajas sobre la misma
--      organización se encolan; en orden de id no se cruzan (sin deadlock).
--   b. FOR UPDATE sobre TODAS las membresías de la persona y TODAS las de las
--      candidatas, en orden de id, y en la MISMA sentencia se anotan los ids de
--      las suyas. Un UPDATE de rol no toca la FK, así que (a) no lo frena: un
--      admin al que suben a owner a mitad de la baja se encola acá, y la baja
--      lee su rol nuevo. (Hasta la 0036 el admin se subía solo, por la policy
--      `members_owner_write`; desde la 0036 lo sube un owner activo o el
--      servidor. El orden es el mismo.)
--   c. La clasificación se hace DESPUÉS de los locks y sólo sobre las membresías
--      anotadas en (b), que nadie más puede tocar hasta el COMMIT (y que el lock
--      devuelve como quedaron: READ COMMITTED, por eso la función se niega a
--      correr en otro nivel). Si la persona es owner activa de una organización
--      que no está entre las bloqueadas —la subieron mientras esperaba—, se
--      niega con 40001: se reintenta.
--   d. El DELETE de las propias lleva el NOT EXISTS de otro owner activo en su
--      WHERE. Se borra lo que en ESE momento es sólo suyo, no lo que lo era
--      cuando se leyó.
--
-- Y la salida de las demás borra por id SÓLO las membresías anotadas en (b). Una
-- que apareció después (otra pestaña que crea una organización) no se borra a
-- ciegas: la postcondición la ve y la baja se niega con 40001, para que el
-- reintento la clasifique. Borrarla «por las dudas» dejaría esa organización
-- nueva sin owner. Hasta la revisión del 2026-10-26 los ids se releían con otra
-- sentencia DESPUÉS de clasificar, y una membresía confirmada en ese instante
-- entraba a la salida sin haberse clasificado. No hay un punto de espera entre
-- esas dos lecturas, así que ese intervalo no se puede reproducir con dos
-- sesiones: se cerró por construcción (una sola sentencia), y lo que aparezca
-- después lo mide el bloque 407.
--
-- EL SELLO QUE NADIE PUEDE TOMAR
--
-- Los sellos de la persona fuera de sus propias (los de adentro se van con la
-- cascada):
--
--   * en una organización donde OTRA persona activa aprueba (owner, admin o
--     manager, 0031): la baja se niega con 45008 y no borra nada. Esa persona
--     puede re-firmar (y volver a borrador lo que nunca se publicó), y es la
--     frase que ve la persona (`sello-en-otra-organizacion`). Es la regla de
--     #117, ahora verdadera: sólo se dice cuando hay a quién pedírselo;
--   * en una organización donde NO hay nadie así: el sello se SUELTA —el asset
--     vuelve a borrador, sin firma— en la misma transacción, y la función lo
--     devuelve en `released_seals`. Un sello necesita firmante (CHECK de la
--     0015) y el único firmante se va; nadie puede volver a firmar. Un editor sí
--     podría volverlo a borrador (la policy de la 0031 deja soltar un sello a
--     quien escribe), que es justo lo que hace la baja: el estado final es el
--     mismo, y la regla «donde nadie más aprueba» es la que decidió Pablo el
--     2026-10-26. Dejarlo trabado es dejar a la persona sin su derecho al
--     olvido para siempre;
--   * salvo que ese sello YA CITE UNA PUBLICACIÓN (cualquier fila de
--     `publications`, pendiente, publicada o fallida): la FK del ledger (0016)
--     ata la fila al hash aprobado, y la 0033 ya dice que nadie suelta un sello
--     que una publicación cita. Ahí la baja se niega con 45010 y no borra nada;
--     la salida es soporte (`service_role`), que decide qué pasa con ese
--     registro. Medido en la revisión del 2026-10-26: soltarlo moría con 23503
--     en `publications_asset_fkey`, y la pantalla lo nombraba como una firma.
--
-- El comentario de `approved_by` en la 0015 dice que irse «no puede desaprobar»
-- el asset. Esa intención nunca se pudo cumplir —el mismo CHECK la contradice,
-- medido en el bloque 401—, y acá se decide qué pasa cuando choca con la baja:
-- gana la baja, sólo donde nadie más puede decidir. Es una decisión de producto
-- y queda dicha en el PR para que Pablo la confirme.
--
-- FALLA CERRADA
--
-- Cualquier cosa fuera de lo previsto aborta la transacción entera, y PostgREST
-- la deshace: nada borrado a medias. Los códigos son el contrato con
-- `deleteMyAccount`:
--
--   22023  falta `p_user_id`.
--   45008  sello en una organización donde otra persona aprueba.
--   45010  sello citado por una publicación, donde nadie más aprueba.
--   45009  algo que la función no sabe leer: una membresía bloqueada con un
--          `state` o un `role` fuera del vocabulario que conoce, o un nivel de
--          aislamiento que no es READ COMMITTED.
--   40001  la membresía cambió mientras corría (owner nueva fuera de lo
--          bloqueado, membresía o sello aparecido): reintentar.
--   55P03  esperó un lock más de 5 s (`lock_timeout` de la función).
--   23503  una firma (ficha publicada, evidencia verificada, tarjeta aprobada)
--          traba la salida de una organización ajena. Las FK de la 0026 son
--          DEFERRABLE INITIALLY DEFERRED; `SET CONSTRAINTS ALL IMMEDIATE` las
--          hace morir ACÁ adentro y no en el COMMIT, así que la función nunca
--          devuelve un resultado que después no se confirma.
--
-- QUÉ DEVUELVE, Y POR QUÉ UN SOLO VALOR
--
-- Un `jsonb` con tres arreglos: `deleted_organizations` (las propias, ya
-- borradas con todo), `left_organizations` (de las que salió) y
-- `released_seals` (los assets que volvieron a borrador). Un escalar y no un
-- SETOF a propósito: `max_rows` de PostgREST corta FILAS, y una función que
-- devuelve una fila no tiene qué cortar (bloque 403, por catálogo). El
-- defecto 2 no se mueve de lugar.
--
-- LO QUE NO CIERRA, Y QUEDA DICHO
--
--   * El login lo borra GoTrue (`auth.admin.deleteUser`) en su propia
--     transacción, DESPUÉS de esta. Entre las dos, una membresía o un sello
--     nuevos de la persona los encuentra la cascada de `auth.users` (o su
--     CHECK). Es una ventana de un pedido HTTP, no de cuatro.
--   * Que un admin se pudiera subir a owner (`members_owner_write`, FOR ALL
--     para owner y admin, 0013) quedaba abierto acá: era otro frente, y lo
--     cerró la 0036 (#128). Esta función lo ordena (b); impedirlo es de la
--     0036.
--   * Una FIRMA (no un sello) en una organización sin nadie que decida sigue
--     trabando la baja sin salida: esas filas son registros firmados e
--     inmutables (0026, 0027, 0029) y soltarlas no es un UPDATE. Decisión
--     pendiente. Lo mismo un sello ya citado por una publicación (45010): la
--     baja lo dice con nombre, y la salida es soporte.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.delete_account_organizations(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
    v_candidatas uuid[];
    v_bloqueadas uuid[] := '{}';
    v_org        uuid;
    v_raras      text;
    v_owner      uuid[];
    v_mias       uuid[];
    v_propias    uuid[];
    v_salidas    uuid[];
    v_soltados   uuid[];
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'delete_account_organizations: falta la persona'
            USING ERRCODE = '22023';
    END IF;

    -- (c) depende de que cada sentencia lea con una instantánea nueva. En
    -- REPEATABLE READ o SERIALIZABLE la clasificación leería el pasado.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'delete_account_organizations necesita READ COMMITTED, corre en %',
            current_setting('transaction_isolation')
            USING ERRCODE = '45009';
    END IF;

    -- (a) Las candidatas, bloqueadas en orden de id.
    SELECT coalesce(array_agg(DISTINCT m.organization_id), '{}')
      INTO v_candidatas
      FROM public.org_members m
     WHERE m.user_id = p_user_id AND m.role = 'owner' AND m.state = 'active';

    FOR v_org IN
        SELECT o.id FROM public.organizations o
         WHERE o.id = ANY (v_candidatas)
         ORDER BY o.id
           FOR UPDATE
    LOOP
        v_bloqueadas := v_bloqueadas || v_org;
    END LOOP;

    -- (b) Sus membresías y las de las candidatas, en orden de id. Las suyas se
    -- anotan en la MISMA sentencia que las bloquea: todo lo que sigue clasifica
    -- y borra sólo esas. Releerlas después con otra instantánea dejaba entrar una
    -- membresía confirmada entre una lectura y la otra, y la salida la borraba
    -- sin haberla clasificado (revisión del 2026-10-26).
    SELECT coalesce(array_agg(b.id) FILTER (WHERE b.user_id = p_user_id), '{}')
      INTO v_mias
      FROM (SELECT m.id, m.user_id
              FROM public.org_members m
             WHERE m.user_id = p_user_id OR m.organization_id = ANY (v_bloqueadas)
             ORDER BY m.id
               FOR UPDATE) b;

    -- Lo que la función no sabe leer, no lo clasifica. Hoy los CHECK de la 0013
    -- y la 0031 lo hacen imposible; el bloque 404 mira que sigan siendo éstos.
    SELECT string_agg(DISTINCT format('%s/%s', m.role, m.state), ', ')
      INTO v_raras
      FROM public.org_members m
     WHERE (m.id = ANY (v_mias) OR m.organization_id = ANY (v_bloqueadas))
       AND (m.state IS NULL OR m.state NOT IN ('active', 'archived')
            OR m.role IS NULL
            OR m.role NOT IN ('owner', 'admin', 'manager', 'editor', 'viewer', 'client'));
    IF v_raras IS NOT NULL THEN
        RAISE EXCEPTION 'delete_account_organizations no sabe leer estas membresias: %', v_raras
            USING ERRCODE = '45009';
    END IF;

    -- (c) La clasificación, sobre las membresías bloqueadas: nadie más puede
    -- cambiarlas hasta el COMMIT, y la lectura las ve como quedaron.
    SELECT coalesce(array_agg(m.organization_id), '{}')
      INTO v_owner
      FROM public.org_members m
     WHERE m.id = ANY (v_mias) AND m.role = 'owner' AND m.state = 'active';
    IF NOT (v_owner <@ v_bloqueadas) THEN
        RAISE EXCEPTION 'la persona paso a ser owner de una organizacion mientras se daba de baja'
            USING ERRCODE = '40001';
    END IF;

    -- (d) Las propias: lo que AHORA no tiene otro owner activo.
    WITH borradas AS (
        DELETE FROM public.organizations o
         WHERE o.id = ANY (v_owner)
           AND NOT EXISTS (SELECT 1 FROM public.org_members m
                            WHERE m.organization_id = o.id
                              AND m.role = 'owner' AND m.state = 'active'
                              AND m.user_id <> p_user_id)
        RETURNING o.id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_propias FROM borradas;

    -- Sellos fuera de las propias (los de adentro se fueron con la cascada).
    IF EXISTS (SELECT 1
                 FROM public.content_assets c
                WHERE c.approved_by = p_user_id
                  AND EXISTS (SELECT 1 FROM public.org_members m
                               WHERE m.organization_id = c.organization_id
                                 AND m.user_id <> p_user_id
                                 AND m.state = 'active'
                                 AND m.role IN ('owner', 'admin', 'manager'))) THEN
        RAISE EXCEPTION 'sello de la persona en una organizacion donde otra persona aprueba'
            USING ERRCODE = '45008';
    END IF;

    -- Un sello que ya cita una publicación no se suelta: la FK del ledger (0016)
    -- ata la fila de `publications` al hash aprobado, y soltarlo moría con 23503,
    -- que la pantalla leía como una firma (revisión del 2026-10-26). Nadie de la
    -- organización puede soltarlo tampoco. Se niega con nombre propio.
    IF EXISTS (SELECT 1
                 FROM public.content_assets c
                 JOIN public.publications p
                   ON p.asset_id = c.id AND p.approved_hash = c.approved_hash
                WHERE c.approved_by = p_user_id) THEN
        RAISE EXCEPTION 'sello de la persona citado por una publicacion, donde nadie mas aprueba'
            USING ERRCODE = '45010';
    END IF;

    WITH soltados AS (
        UPDATE public.content_assets
           SET status = 'draft', approved_hash = NULL, approved_by = NULL, approved_at = NULL
         WHERE approved_by = p_user_id
        RETURNING id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_soltados FROM soltados;

    -- La salida de las demás: sólo las membresías bloqueadas. Las de las propias
    -- ya no están (cascada).
    WITH salidas AS (
        DELETE FROM public.org_members m
         WHERE m.id = ANY (v_mias)
        RETURNING m.organization_id)
    SELECT coalesce(array_agg(organization_id ORDER BY organization_id), '{}')
      INTO v_salidas FROM salidas;

    -- Las firmas diferidas de la 0026 mueren acá, no en el COMMIT.
    SET CONSTRAINTS ALL IMMEDIATE;

    -- Postcondición: no le queda nada que la cascada de `auth.users` vaya a
    -- encontrar después. Si apareció algo, se reintenta y se clasifica.
    IF EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = p_user_id) THEN
        RAISE EXCEPTION 'aparecio una membresia de la persona mientras se daba de baja'
            USING ERRCODE = '40001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.content_assets c WHERE c.approved_by = p_user_id) THEN
        RAISE EXCEPTION 'aparecio un sello de la persona mientras se daba de baja'
            USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
        'deleted_organizations', to_jsonb(v_propias),
        'left_organizations',    to_jsonb(v_salidas),
        'released_seals',        to_jsonb(v_soltados));
END
$fn$;

COMMENT ON FUNCTION public.delete_account_organizations(uuid) IS
    'Baja de cuenta, la parte de la base: borra las organizaciones donde la persona es la unica owner activa, la saca de las demas y suelta los sellos que nadie mas puede tomar, en una transaccion. Solo service_role.';

REVOKE ALL ON FUNCTION public.delete_account_organizations(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_account_organizations(uuid) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0035_account_deletion_in_one_transaction')
ON CONFLICT (version) DO NOTHING;
