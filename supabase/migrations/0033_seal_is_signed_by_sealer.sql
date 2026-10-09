-- 0033_seal_is_signed_by_sealer.sql — el sello lo firma quien sella, a la hora
-- de la base.
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
--   * `approved_at` lo pone la base: `now()`, venga lo que venga.
--
-- Salvo que quien escribe sea el servidor: `postgres` o `service_role`. Ver
-- «QUIÉN ES EL SERVIDOR» abajo.
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
--   * soltar el sello (`approved_hash` en NULL): no hay firma que atar, y el
--     CHECK de la 0015 exige que `approved_by` y `approved_at` queden vacíos;
--   * editar el cuerpo de una fila sellada: el trigger de la 0015 corre ANTES
--     que éste —los BEFORE del mismo evento disparan por orden de nombre, y
--     `trg_content_assets_reset_approval` < `trg_content_assets_seal_signer`— y
--     deja la fila sin sello, así que éste ya no ve nada que firmar. Es la
--     ergonomía de la 0015 (bloque 212).
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
-- CÓMO FALLA (lo que la suite mide, bloques 220 a 226 de defects_test.sql)
--
--   220  firmar a nombre de otro: el ataque medido, naciendo sellado, como otro
--        que aprueba, sin firma, un editor como un manager, un rol nuevo;
--   221  la contraprueba: la escritura exacta de la ruta, y la hora de la base;
--   222  re-firmar como otro, o cambiarle la hora, a un sello vigente;
--   223  agendar lo que selló otro conserva su firma y su hora;
--   224  el servidor —`service_role` sin uid, `postgres` con uno— declara la firma;
--   225  un client, un viewer o un editor sigue sin sellar, firmando como él;
--   226  por catálogo: la forma del firmante, toda tabla con `approved_by` que una
--        sesión escribe lleva uno, y ninguna DEFINER de `public` nombra la tabla.
--
-- MEDIDO ROMPIÉNDOLO (2026-10-09, réplica `growthos-replica-sello`, sobre `main`
-- 959e746). Verde: 167 de 167. Sin esta migración —`main` con el stub
-- arreglado— la suite da rojo 220, 221, 222 y 226. Cada fila de abajo es esta
-- migración con UNA cosa rota, aplicada después de su .down, la suite entera
-- corrida otra vez, y los bloques que se pusieron rojos. Ninguna sobrevivió.
--
--   S01 sin el trigger . . . . . . . . . . . . . . . . rojo 220, 221, 222, 226
--   S02 reescribir la firma en vez de rechazarla . . . . . . . . . rojo 220, 222
--   S03 sin fijar la hora  . . . . . . . . . . . . . . . . . . . . rojo 221, 222
--   S04 «sin cambios» mira sólo el hash (re-firmar pasa)  . . . . . . . rojo 222
--   S05 sin la rama «sin cambios»: agendar re-firma  . . . . . . . . . rojo 223
--   S06 sólo BEFORE UPDATE, sin INSERT . . . . . . . . . . . rojo 220, 221, 226
--   S07 `authenticated` entre los exentos  . . . . . . . . . rojo 220, 221, 222
--   S08 `service_role` fuera de los exentos  . . . . . . . . . . . . . rojo 224
--   S09 la función SECURITY DEFINER  . . . . . . . . . . rojo 220, 221, 222, 226
--   S10 la exención por «no hay uid» en vez de por rol
--                       la corrida muere: 45005 en la fixture del bloque 27
--   S11 sin `ENABLE ALWAYS`  . . . . . . . . . . . . . . . . . . . . . rojo 226
--   S12 la exención como lista de alcanzados (`<> 'authenticated'`) . rojo 220
--   y en la réplica, el stub sin el USAGE de `auth` para las sesiones
--                                                  rojo 211, 220, 221, 222, 225

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
    'El sello de content_assets lo firma quien sella (approved_by = auth.uid(), si no 45005) a la hora de la base (approved_at = now()). Exentos: postgres y service_role. Ver la 0033.';

DROP TRIGGER IF EXISTS trg_content_assets_seal_signer ON public.content_assets;
CREATE TRIGGER trg_content_assets_seal_signer
    BEFORE INSERT OR UPDATE ON public.content_assets
    FOR EACH ROW
    EXECUTE FUNCTION public.content_assets_seal_signer();

ALTER TABLE public.content_assets ENABLE ALWAYS TRIGGER trg_content_assets_seal_signer;

INSERT INTO public.schema_migrations (version) VALUES ('0033_seal_is_signed_by_sealer')
ON CONFLICT (version) DO NOTHING;

COMMIT;
