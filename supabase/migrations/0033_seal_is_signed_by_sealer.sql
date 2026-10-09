-- 0033_seal_is_signed_by_sealer.sql — el sello lo firma quien sella, a la hora
-- de la base, y no se muda.
--
-- QUÉ CIERRA
--
-- Medido el 2026-10-09 en un stack local con la 0031: el manager de X —que
-- aprueba, D4— hizo
--
--     PATCH /rest/v1/content_assets?id=eq.<asset>
--     { approved_by: <uid del CLIENT de X>, approved_at: '2026-10-09T12:00:00Z', ... }
--
-- y recibió HTTP 200: el sello quedó firmado a nombre del client, con una hora
-- elegida por quien escribía. Reproducido el mismo día en la réplica
-- (`growthos-replica-sello`, `main` 959e746) como `authenticated` con el uid del
-- manager: `UPDATE 1`, `approved_by` = el client, `approved_at` = 12:00:00
-- cuando `now()` daba 18:33.
--
-- La 0015 exige que un sello TENGA firma (`approved_by` y `approved_at` no nulos
-- en approved, scheduled y published) y la 0031 decide QUIÉN puede sellar. Nada
-- ataba la firma a quien sella ni la hora al reloj de la base. Es el registro que
-- piden F3 y F4 —«quién aprobó qué y cuándo»—, y lo escribía quien quisiera
-- entre los que aprueban: un manager podía aprobar a nombre del cliente («lo
-- aprobó él») o de otro manager, y fechar la aprobación antes de una edición o
-- de una publicación.
--
-- Y una segunda cosa, que encontró la revisión de esta migración el mismo día y
-- es anterior a ella —medida igual sobre `main` sin la 0033—: un asset SELLADO
-- se mudaba de organización o de negocio con la firma vieja puesta. Un editor de
-- X que es owner de su propia organización (toda usuaria lo es, por
-- `handle_new_user()`) se llevaba a la suya el asset de X sellado por el owner de
-- X y ya publicado, y la publicación de X quedaba apuntando a otro tenant. Ver
-- «UN SELLO NO SE MUDA».
--
-- QUIÉN ESCRIBE SELLOS HOY, MEDIDO SOBRE `src/` EL 2026-10-09
--
-- Uno solo: `/api/content/approve`, y escribe CON LA SESIÓN —`quienLlama()`, el
-- cliente de servidor con RLS—, no con `service_role`. Manda
-- `approved_by: user.id` y `approved_at: new Date().toISOString()`, el reloj del
-- servidor de Next. El encabezado de la 0031 dice que aprobar corre con
-- `service_role` «para el ledger»; para esta ruta no es así (lo es para
-- publicar, que LEE el sello y no escribe `content_assets`). Nada en `src/`
-- escribe un sello con `service_role`. Así que la ruta real ES una sesión, y la
-- regla de abajo la alcanza: el bloque 221 corre su sentencia exacta.
--
-- LA REGLA
--
-- Un trigger BEFORE INSERT OR UPDATE, `content_assets_seal_signer()`, que mira
-- toda escritura que deja la fila SELLADA (`approved_hash` no nulo) y que PONE o
-- CAMBIA alguna de las tres columnas del sello —un INSERT sellado, o un UPDATE
-- donde `approved_hash`, `approved_by` o `approved_at` difieren de la fila
-- vieja—. Para esa escritura:
--
--   * `approved_by` tiene que ser `auth.uid()`, o muere con SQLSTATE 45005;
--   * `approved_at` lo pone la base: `now()`, venga lo que venga —incluido que no
--     venga—.
--
-- Salvo que quien escribe sea el servidor: `postgres` o `service_role`. Ver
-- «QUIÉN ES EL SERVIDOR» abajo.
--
-- Y antes de eso, para TODOS, el servidor incluido: un UPDATE que deja sellada
-- una fila que ya estaba sellada no le cambia `organization_id` ni
-- `business_id`, o muere con SQLSTATE 45006.
--
-- «Sellada» es `approved_hash` no nulo, nunca el `status`: el CHECK de la 0015
-- acepta un sello en `approved`, `scheduled` y `published`, y la policy de la
-- 0031 mira el hash por el mismo motivo. Un firmante que decidiera por
-- `status = 'approved'` dejaría firmar como otro a quien sella directo como
-- `scheduled` (mutación S13).
--
-- LA DECISIÓN: RECHAZAR EL QUIÉN, FIJAR EL CUÁNDO
--
-- Las dos columnas se tratan distinto a propósito, porque la pregunta «¿lo
-- puede mandar bien quien escribe?» tiene respuestas distintas.
--
--   * QUIÉN: quien escribe sabe su uid exacto, así que no existe una escritura
--     honesta con otro. Uno distinto es un defecto o una falsificación, y las dos
--     merecen un error y no una corrección callada: reescribirlo le contestaría
--     200 a quien intentó firmar como otro, y la ruta no se enteraría nunca de
--     que estaba mandando al usuario equivocado. Y es la lección de la 0012: un
--     dato que la aplicación tiene lo manda la aplicación, y un trigger que lo
--     rellena esconde el día en que deja de mandarlo. Con el rechazo, la ruta
--     sigue mandando `approved_by: user.id`, y si este trigger desaparece lo
--     escrito sigue siendo correcto —y el 220 y el 222 se ponen rojos—.
--   * CUÁNDO: nadie de afuera puede nombrar el `now()` de la transacción.
--     PostgREST recibe un literal, y el reloj de la ruta es el del servidor de
--     Next, no el de la base. Exigir igualdad rechazaría toda aprobación honesta;
--     tolerar una ventana sería elegir cuánto atraso se acepta. La hora del sello
--     es un hecho de la base —cuándo cambió la fila—, así que la escribe la base.
--     La ruta sigue mandando su `approved_at` y se le pisa: si este trigger
--     faltara, el CHECK de la 0015 lo exigiría igual.
--
-- Por eso el 45005 y no un 23514 o un 42501: es un código propio, de la clase 45
-- que PostgreSQL no usa —como el 45001 a 45004 de la 0027 y la 0028—, para que
-- una aserción pueda pedir ESTE rechazo y no otro. Una firma falsa que muriera
-- por la RLS (42501) se vería igual que un editor que no aprueba.
--
-- QUÉ CUENTA COMO «PONER O CAMBIAR», Y QUÉ DEJA PASAR
--
--   * sellar un borrador —la ruta—: firmado por el uid, a la hora de la base;
--   * nacer sellado (INSERT): lo mismo. Lo puede sólo quien aprueba (0031);
--   * pasar una fila sellada a `scheduled` o `published` SIN tocar las tres
--     columnas: la firma no cambia, y queda la de quien selló. Por eso la regla
--     mira las columnas y no «cualquier UPDATE de una fila sellada»: si no, un
--     manager que agenda lo que aprobó otro tendría que firmarlo como suyo, y el
--     registro diría que lo aprobó él (bloque 223);
--   * atrasar la hora: cambiar sólo `approved_at` de un sello. Si el sello es
--     tuyo, se vuelve a poner `now()`; si es de otro, 45005 (bloque 222);
--   * atrasarla SIN tocarla: re-firmar a tu nombre un sello de otro sin mandar
--     `approved_at`. La firma cambió, así que la hora es `now()`, no la del
--     firmante anterior; fijarla sólo cuando la columna cambia dejaba a quien
--     re-firma firmando a una hora en que nunca aprobó (bloque 221, S14);
--   * mudar una fila sellada de organización o de negocio: 45006, para todos
--     (bloque 227, ver «UN SELLO NO SE MUDA»);
--   * soltar el sello (`approved_hash` en NULL): no hay firma que atar, y el
--     CHECK de la 0015 exige que `approved_by` y `approved_at` queden vacíos;
--   * editar el cuerpo de una fila sellada: el trigger de la 0015 corre ANTES
--     que éste —los BEFORE del mismo evento disparan por orden de nombre, y
--     `trg_content_assets_reset_approval` < `trg_content_assets_seal_signer`— y
--     deja la fila sin sello, así que éste ya no ve nada que firmar. Es la
--     ergonomía de la 0015 (bloque 212).
--
-- UN SELLO NO SE MUDA
--
-- Medido el 2026-10-09 en la réplica, con la fixture de H4.1 y la 0033 de la
-- primera ronda puesta. eva es editor en X y no tiene otra membresía en X; su
-- organización propia la hace owner, o sea que aprueba ahí. Como
-- `authenticated`, con su uid: crea un negocio en su organización y
--
--     UPDATE content_assets SET organization_id = <la de eva>, business_id = <ése>
--      WHERE id = <el asset de X sellado por omar, con publicación>
--
-- da 1 fila. El asset queda en la organización de eva, `approved`, firmado por
-- omar —que no es miembro ahí— a la hora de omar; la publicación sigue en X
-- apuntando a un asset de otro tenant; omar deja de verlo y eva no lo puede
-- devolver. Un editor que no puede ni agendar ese asset dentro de X. Lo mismo
-- marta (manager en X y en Y) con el sellado sin publicación: a Y, o a otro
-- negocio de X, y queda la firma de omar.
--
-- Por qué pasaba: la rama «sin cambios» de abajo devolvía la fila cuando las
-- tres columnas del sello no cambiaban, sin mirar dónde vive; el hash de la 0015
-- cubre el TEXTO y no el lugar; y la `content_assets_approver_update` de la 0031
-- es `USING (true)` y mira sólo la organización NUEVA.
--
-- LA DECISIÓN: RECHAZAR LA MUDANZA, NO RE-FIRMARLA. La otra salida era tratar
-- un cambio de organización o de negocio como un sello nuevo —exigir la firma de
-- quien escribe y la hora de la base—. No alcanza, y está medido (mutación S20):
-- eva firma como ella, el 45005 la deja pasar, la policy de la 0031 mira la
-- organización de DESTINO —donde eva aprueba— y el asset publicado de X sale de
-- X igual, firmado por eva. Un sello es la aprobación de un texto EN un negocio:
-- es la ficha de ese negocio donde se publica, y es el tenant cuyo ledger lo
-- cita. Moverlo no es re-aprobarlo en otro lado.
--
-- PARA TODOS, EL SERVIDOR INCLUIDO, al revés que la firma. El servidor declara
-- QUIÉN firmó porque tiene con qué saberlo; mudar un sello no tiene una versión
-- honesta para nadie: la firma vieja quedaría hablando de otro lugar, y la
-- publicación de X citaría un asset de Y. Hoy nada en `src/` cambia
-- `organization_id` ni `business_id` de un asset —ni con sesión ni con
-- `service_role`—, así que la regla no frena ningún camino que exista. Contra el
-- dueño del esquema, que puede `DISABLE TRIGGER`, vale lo de siempre.
--
-- SÓLO MIENTRAS SIGA SELLADA. Si la misma escritura suelta el sello —editar el
-- cuerpo, que la 0015 baja a borrador, o ponerlo en borrador a mano—, la regla
-- no corre: lo que se mueve es un borrador, y eso lo decide la 0031 como decide
-- editarlo o borrarlo. Lo publicado no se escapa por ahí: la FK de la 0016
-- (`publications_asset_fkey`, sobre `(id, approved_hash)`) no deja soltar un
-- sello que una publicación cita, y el bloque 227 lo mide (23503).
--
-- Un 45006 y no el 45005: es otro rechazo —no hay firma falsa, hay un lugar
-- cambiado— y una aserción tiene que poder pedir uno y no el otro.
--
-- QUIÉN ES EL SERVIDOR
--
-- `current_user IN ('postgres', 'service_role')`. Una lista de los EXENTOS, no
-- de los alcanzados, por el motivo de las tres funciones de la 0031: un rol que
-- se agregue mañana —o `anon`— queda bajo la regla, que es la dirección barata
-- del error. `anon` no tiene uid, así que no firma nada. El 220 lo mide con un
-- rol que no existe (`futuro_0033`, miembro de `authenticated`), creado y
-- deshecho dentro de la medición.
--
-- Por ROL y no por «no hay uid», que es como la pregunta se formuló primero:
-- `anon` tampoco tiene uid y no es el servidor; y `postgres` puede correr con un
-- `request.jwt.claim.sub` puesto sin dejar de ser el dueño del esquema. La suite
-- lo hace: los bloques dejan el uid puesto en la transacción, y las fixtures de
-- la 0015 a la 0031 sellan como `postgres` después, firmando por otro. Medido:
-- con la exención por «no hay uid», la corrida muere en la fixture del bloque 27
-- (45005: firma bob, el uid puesto es el de grace). El 224 lo afirma aparte.
--
-- Lo que eso implica, dicho: una función SECURITY DEFINER de `postgres` corre
-- como `postgres`, así que es código del servidor y declara la firma ella misma.
-- Hoy ninguna función de `public` escribe `content_assets` (el bloque 226 lo
-- mira por catálogo). Y el servidor firma lo que diga: `service_role` es de
-- confianza por diseño, y hoy no escribe sellos.
--
-- SECURITY INVOKER, Y POR QUÉ ESO TOCÓ LA RÉPLICA
--
-- El trigger tiene que ver el rol de QUIEN ESCRIBE; como SECURITY DEFINER vería
-- siempre a `postgres` y eximiría a todos (mutación S09). Así que resuelve
-- `auth.uid()` por nombre con el rol de quien escribe, y eso pide USAGE sobre el
-- esquema `auth` —una policy no lo pide: guarda la función por OID—. En hosted
-- anda: la imagen de Supabase da ese USAGE a `anon`, `authenticated` y
-- `service_role` (medido sobre la imagen de la réplica el 2026-10-09). El stub
-- de la réplica no lo daba, y la réplica le rechazaba con 42501 toda aprobación
-- por sesión; lo arregla `supabase/qa/auth_stub.sql` en este mismo cambio, con
-- la suite en 160/160 antes de agregar esta migración.
--
-- Y POR QUÉ `auth.uid()` Y NO EL GUC. La tentación, ante el 42501 de arriba, es
-- leer `current_setting('request.jwt.claim.sub')` directo. Ese GUC lo ponía
-- PostgREST antes de la v10; la v16 del stack local pone sólo
-- `request.jwt.claims`, el JSON entero, y `auth.uid()` de GoTrue lee los dos
-- (medido sobre las imágenes, ver `auth_stub.sql`). Leyendo el GUC, toda
-- aprobación de verdad vería NULL y moriría con 45005. La réplica no lo veía
-- —su stub leía sólo el GUC viejo, y la suite entera daba 167 de 167 con esa
-- mutación—; desde la segunda ronda el stub es el de GoTrue y los bloques 220 a
-- 227 entran por el JSON, como PostgREST (mutación S15).
--
-- `ENABLE ALWAYS`, como los guards de la 0027: un trigger normal no dispara con
-- `session_replication_role = 'replica'`. No está medido por el motivo de allá
-- —cambiar ese parámetro pide superusuario—, y contra el dueño del esquema, que
-- puede `DISABLE TRIGGER`, no hay guard en el esquema.
--
-- LAS OTRAS DOS TABLAS QUE DICEN QUIÉN APROBÓ
--
--   * `publications` (0016) NO tiene `approved_by` ni `approved_at`: cita el
--     sello por `approved_hash`, y quién aprobó lo publicado es la firma del
--     asset. Además `authenticated` sólo tiene SELECT ahí: ninguna sesión
--     escribe el ledger.
--   * `board_cards` (0029) SÍ tiene `approved_by`/`approved_at`, y el mismo
--     agujero en potencia, pero hoy `authenticated` sólo tiene SELECT: la firma
--     de una tarjeta la escribe el servidor. El día que una sesión pueda
--     escribirla, el bloque 226 se pone rojo —mira, por catálogo, que toda tabla
--     de `public` con `approved_by` que una sesión puede escribir lleve un
--     firmante— y la tarjeta necesita el suyo (no tiene `approved_hash`, así que
--     no es este mismo trigger).
--
-- LO QUE NO CIERRA, Y QUEDA DICHO
--
-- Una columna de firma es UN firmante, no un historial. Quien aprueba en X puede
-- volver a firmar un sello vigente —mismo texto, mismo hash— con SU nombre y la
-- hora de la base: es verdad (aprobó ese texto en ese momento), pero reemplaza al
-- firmante anterior. Incluye un asset PUBLICADO: medido en la réplica el
-- 2026-10-09, el manager de X re-firma el asset publicado que selló el owner y
-- la fila queda con el manager y una hora posterior a `published_at`. Cerrarlo
-- es congelar la firma mientras una publicación cite el sello, o llevar
-- `approved_by`/`approved_at` al ledger; cualquiera de las dos cambia lo que la
-- ruta le contesta a un segundo clic sobre lo ya aprobado (hoy 200), y es su
-- propio frente.
--
-- La regla de la mudanza mira `organization_id` y `business_id`, no
-- `service_id`. El servicio es una etiqueta del texto dentro del mismo negocio
-- —la FK `content_assets_service_same_business_fkey` lo ata al negocio—: no
-- cambia dónde se publica ni quién lo ve, y el hash de la 0015 tampoco lo cubre.
-- Si un día decide algo de la publicación, entra a la lista.
--
-- Y un BORRADOR se sigue moviendo de negocio, y de organización si quien escribe
-- es miembro que escribe en las dos: es la 0031 —eje de rol en la vieja y en la
-- nueva—, y equivale a copiarlo y borrarlo, que esa persona ya puede. El bloque
-- 227 lo fija como contraprueba (caso h).
--
-- CÓMO FALLA (lo que la suite mide, bloques 220 a 227 de defects_test.sql)
--
-- Los 220 a 227 ponen la identidad como PostgREST v16, en `request.jwt.claims`;
-- los 200 a 216, por el GUC viejo. `auth.uid()` lee los dos (ver arriba).
--
--   220  firmar a nombre de otro: el ataque medido, naciendo sellado, como otro
--        que aprueba, sin firma, un editor como un manager, un rol nuevo, y
--        sellando directo como `scheduled` o `published`;
--   221  la contraprueba: la escritura exacta de la ruta, y la hora de la base,
--        también sin mandarla y al re-firmar a nombre propio;
--   222  re-firmar como otro, o cambiarle la hora, a un sello vigente;
--   223  agendar lo que selló otro conserva su firma y su hora;
--   224  el servidor —`service_role` sin uid, `postgres` con uno— declara la firma;
--   225  un client, un viewer o un editor sigue sin sellar, firmando como él;
--   226  por catálogo: la forma del firmante, toda tabla con `approved_by` que una
--        sesión escribe lleva uno, y ninguna DEFINER de `public` nombra la tabla;
--   227  un sello no se muda: el ataque medido de eva, firmando como ella, marta
--        a Y y a otro negocio de X, `service_role` y `postgres`; soltando el
--        sello lo publicado tampoco sale (FK de la 0016), y un borrador sí se
--        mueve.
--
-- MEDIDO ROMPIÉNDOLO (2026-10-09, réplica `growthos-replica-sello`, sobre `main`
-- 959e746). Verde: 168 de 168. Sin esta migración —`main` con el stub
-- arreglado— la suite da rojo 220, 221, 222, 226 y 227. Cada fila de abajo es
-- esta migración con UNA cosa rota, aplicada después de su .down, la suite
-- entera corrida otra vez, y los bloques que se pusieron rojos. Ninguna
-- sobrevivió.
--
-- LA PRIMERA RONDA DECÍA LO MISMO, con S01 a S12, y la revisión encontró tres
-- mutaciones que sobrevivían con la suite en 167 de 167 —S13, S14 y S15— y el
-- agujero de la mudanza. Las tres tenían la misma forma: un caso que la suite no
-- ejecutaba (sellar como `scheduled`, re-firmar sin mandar la hora, entrar por
-- el JSON de PostgREST). Desde la segunda ronda las veintiuna corren contra la
-- suite nueva, las doce viejas incluidas.
--
--   S01 sin el trigger . . . . . . . . . . . . . rojo 220, 221, 222, 226, 227
--   S02 reescribir la firma en vez de rechazarla . . . . . . . . . rojo 220, 222
--   S03 sin fijar la hora  . . . . . . . . . . . . . . . . . . . . rojo 221, 222
--   S04 «sin cambios» mira sólo el hash (re-firmar pasa)  . . . . rojo 221, 222
--   S05 sin la rama «sin cambios»: agendar re-firma  . . . . . . . . . rojo 223
--   S06 sólo BEFORE UPDATE, sin INSERT . . . . . . . . . . . rojo 220, 221, 226
--   S07 `authenticated` entre los exentos  . . . . . . . . . rojo 220, 221, 222
--   S08 `service_role` fuera de los exentos  . . . . . . . . . . . . . rojo 224
--   S09 la función SECURITY DEFINER  . . . . . . . . . . rojo 220, 221, 222, 226
--   S10 la exención por «no hay uid» en vez de por rol
--                       la corrida muere: 45005 en la fixture del bloque 27
--   S11 sin `ENABLE ALWAYS`  . . . . . . . . . . . . . . . . . . . . . rojo 226
--   S12 la exención como lista de alcanzados (`<> 'authenticated'`) . rojo 220
--   S13 «sellada» por `status = 'approved'` y no por el hash . . . . . rojo 220
--   S14 la hora sólo si `approved_at` cambia . . . . . . . . . . . . . rojo 221
--   S15 el GUC viejo `request.jwt.claim.sub` en vez de `auth.uid()`
--                                                  rojo 220, 221, 222, 225
--   S16 sin la regla de la mudanza . . . . . . . . . . . . . . . . . . rojo 227
--   S17 la mudanza mira sólo `organization_id` . . . . . . . . . . . . rojo 227
--   S18 la mudanza después de la rama «sin cambios» (el agujero) . . . rojo 227
--   S19 la mudanza exime al servidor . . . . . . . . . . . . . . . . . rojo 227
--   S20 la mudanza como re-firma (otra rama de «sin cambios») . . . . rojo 227
--   S21 la mudanza antes de «sin sello»: soltar y mudar da 45006 . . . rojo 227
--
-- Y en la réplica, rompiendo el stub en vez de la migración:
--
--   el stub sin el USAGE de `auth` para las sesiones
--                                                  rojo 211, 220, 221, 222, 225
--   el stub con la `auth.uid()` del init (sólo el GUC viejo)
--                                        rojo 220, 221, 222, 223, 225, 227

\set ON_ERROR_STOP on

BEGIN;

-- El CREATE TRIGGER toma un lock sobre `content_assets`. Si algo lo tiene
-- tomado, mejor fallar a los cinco segundos que dejar detrás a cada aprobación.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.content_assets_seal_signer()
RETURNS trigger
LANGUAGE plpgsql
-- INVOKER a propósito: `current_user` tiene que ser quien escribe. Ver el
-- encabezado.
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Sin sello después de la escritura no hay firma que atar: el CHECK de la
    -- 0015 exige que `approved_by` y `approved_at` queden vacíos.
    IF NEW.approved_hash IS NULL THEN
        RETURN NEW;
    END IF;

    -- Un sello no se muda: ni de organización ni de negocio, lo escriba quien lo
    -- escriba —el servidor incluido—. ANTES de la rama «sin cambios», que es por
    -- donde se mudaba con la firma vieja puesta. Ver «UN SELLO NO SE MUDA».
    IF TG_OP = 'UPDATE'
       AND OLD.approved_hash IS NOT NULL
       AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id
            OR NEW.business_id IS DISTINCT FROM OLD.business_id) THEN
        RAISE EXCEPTION
            'un sello no se muda: el asset % esta sellado en la organizacion % y el negocio %',
            OLD.id, OLD.organization_id, OLD.business_id
            USING ERRCODE = '45006',
                  HINT = 'para moverlo, primero hay que soltar el sello (volver a borrador) y despues aprobarlo donde quede.';
    END IF;

    -- El sello no cambió: ni el texto sellado, ni quién, ni cuándo. Agendar o
    -- publicar lo que selló otro conserva su firma.
    IF TG_OP = 'UPDATE'
       AND NEW.approved_hash IS NOT DISTINCT FROM OLD.approved_hash
       AND NEW.approved_by   IS NOT DISTINCT FROM OLD.approved_by
       AND NEW.approved_at   IS NOT DISTINCT FROM OLD.approved_at THEN
        RETURN NEW;
    END IF;

    -- El servidor declara la firma él mismo. Lista de EXENTOS: cualquier otro
    -- rol, `anon` y los que vengan, queda bajo la regla.
    IF current_user IN ('postgres', 'service_role') THEN
        RETURN NEW;
    END IF;

    IF NEW.approved_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION
            'el sello lo firma quien sella: approved_by es %, y quien escribe es %',
            coalesce(NEW.approved_by::text, 'NULL'), coalesce(auth.uid()::text, 'nadie')
            USING ERRCODE = '45005',
                  HINT = 'approved_by tiene que ser el usuario de la sesion; approved_at lo pone la base.';
    END IF;

    NEW.approved_at := now();
    RETURN NEW;
END
$$;

-- Un trigger no necesita EXECUTE para dispararse. Por nombre además de PUBLIC:
-- los default privileges de Supabase lo dan por nombre a los tres roles.
REVOKE ALL ON FUNCTION public.content_assets_seal_signer()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.content_assets_seal_signer() IS
    'El sello de content_assets lo firma quien sella (approved_by = auth.uid(), si no 45005) a la hora de la base (approved_at = now()). Exentos: postgres y service_role. Y un sello no se muda de organizacion ni de negocio, para nadie (45006). Ver la 0033.';

DROP TRIGGER IF EXISTS trg_content_assets_seal_signer ON public.content_assets;
CREATE TRIGGER trg_content_assets_seal_signer
    BEFORE INSERT OR UPDATE ON public.content_assets
    FOR EACH ROW
    EXECUTE FUNCTION public.content_assets_seal_signer();

ALTER TABLE public.content_assets ENABLE ALWAYS TRIGGER trg_content_assets_seal_signer;

INSERT INTO public.schema_migrations (version) VALUES ('0033_seal_is_signed_by_sealer')
ON CONFLICT (version) DO NOTHING;

COMMIT;
