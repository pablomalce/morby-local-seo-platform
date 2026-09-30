-- 0027_profile_immutability.sql — una versión publicada no se edita.
--
-- QUÉ AGREGA
--
-- Una columna (`superseded_at`), cuatro funciones y ocho triggers. Ninguna tabla.
-- La `0026` dejó escrito qué faltaba —«no pone el guard de inmutabilidad; hasta
-- que H1.2 lo instale, `published` es un estado que nadie protege de un
-- UPDATE»— y esto es ese guard.
--
-- POR QUÉ NO ALCANZA CON CONGELAR LA FILA DE LA FICHA
--
-- El contenido de una versión NO está en `company_profiles`. Está en las siete
-- hijas: la oferta, los mercados, los segmentos, los competidores curados, el
-- ICP, los objetivos y la evidencia. En la fila-versión sólo vive `summary`.
-- Un guard que protegiera únicamente el UPDATE de la fila-versión dejaría
-- exactamente el agujero que la puerta nombra: el `version_id` citado por un
-- reporte seguiría resolviendo, pero a un ICP que alguien reescribió después.
-- Por eso hay OCHO triggers y no uno: uno en la ficha y uno en cada hija.
--
-- CÓMO FALLA
--
-- Rojo en los bloques 95 a 103 y 110 a 113 de `supabase/qa/defects_test.sql`
-- (los 104 a 109 y 114 a 117 son de la `0028`). Los tres que
-- son la puerta:
--
--   * el 96 hace UPDATE del contenido de una versión `published` —y de una
--     `superseded`— en las ocho tablas del subárbol y exige el SQLSTATE 45001 o
--     45002 EXACTO en cada una. Un rechazo por policy (42501) no cuenta: un
--     rechazo por el motivo equivocado no es la garantía que dice medir;
--   * el 97 es su CONTROL POSITIVO, y sin él el 96 pasaría con la ficha
--     inservible: sobre una versión `draft` las mismas ocho escrituras tienen
--     que ENTRAR. Cerrar de más también es un defecto;
--   * el 99 publica la versión 3 —pasar la 2 a `superseded` y la 3 a
--     `published` en una transacción— y exige que la transición entre y que
--     cualquier otro cambio junto con ella no entre.
--
-- MEDIDO CONTRA LA RÉPLICA EL 2026-09-30, ROMPIÉNDOLO A PROPÓSITO NUEVE VECES
--
-- R7: cada aserción declara qué defecto impide y se verifica rompiendo el
-- código. Nueve mutaciones sobre este archivo, una por vez, con las 103
-- aserciones corriendo detrás de cada una y la migración re-aplicada para
-- restaurar. Ninguna sobrevivió:
--
--   1. las siete hijas sin guard . . . . . . . . . rojo 96, 102
--   2. la fila-versión sin guard  . . . . . . . . . rojo 95, 96, 98, 99, 100, 103
--   3. la transición acepta cambios de regalo  . . rojo 99
--   4. el guard lee `profile_id` en las siete . . . rojo 96, 102, 103
--   5. la excepción de H1.4 sin comparar la fila  . rojo 96, 102
--   6. el borrador también congelado . . . . . . . la corrida MUERE en el fixture
--   7. una forma desconocida se lee como permiso . rojo 103
--   8. el cascade confundido con un borrado . . . . rojo 101
--   9. borrador congelado sólo para UPDATE/DELETE  rojo 97, 101, 102
--
-- La 6 hay que contarla como lo que es: no pone un bloque en rojo, MATA la
-- corrida al escribir el fixture, porque una base que congela el borrador no
-- deja escribir la ficha ni para probarla. Es una detección —una suite que
-- muere no está verde— pero no prueba que el bloque 97 tenga dientes, así que
-- se escribió la 9, que deja entrar los INSERT del fixture y rechaza sólo
-- UPDATE y DELETE: ésa la ve el 97. Una mutación que mata la corrida antes de
-- llegar a la aserción que dice medirla no la midió.
--
-- Y con todo restaurado, las 103 vuelven a verde.
--
-- SEGUNDA RONDA, DESPUÉS DE LA REVISIÓN ADVERSARIAL (2026-09-30), contra las 117
-- aserciones y con la `0027` y la `0028` re-aplicadas para restaurar. Las nueve
-- de arriba siguen cayendo, y las cinco nuevas de este archivo también:
--
--   sin el chequeo de la versión de origen  . . . . rojo 112
--   sin la excepción del SET NULL del catálogo  . . rojo 113
--   la excepción sin mirar si el servicio sigue . . rojo 113
--   sin el CHECK «una superada estuvo publicada» .  rojo 99
--   la transición con lista de columnas a mano  . . rojo 103
--
-- La última es la que la revisión encontró viva: el bloque 103 escribía la
-- columna nueva sin pasar por la transición, y moría en el `RAISE` final sea
-- cual fuera la comparación.
--
-- TERCERA RONDA, después de la segunda revisión, otras dos que cayeron:
--
--   la comprobación de destino mira el origen . . . rojo 112
--   sin el CHECK de la ventana invertida  . . . . . rojo 99
--
-- La primera sobrevivía a la suite de la segunda ronda: el 112 sólo sacaba hijas
-- de una versión congelada, nunca las metía.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LAS DECISIONES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. LA INMUTABILIDAD PROTEGE EL CONTENIDO, NO LA EXISTENCIA — CON UN LÍMITE.
--    Un cliente se puede borrar: `company_profiles` cuelga de `businesses` con
--    `ON DELETE CASCADE` desde la `0026`, y esa decisión no se revisa acá. Pero
--    un DELETE DIRECTO de una versión publicada sí se rechaza, porque borrar la
--    fila que un reporte cita es la forma más corta de que la cita deje de
--    resolver. Los dos casos se distinguen mirando si el `businesses` padre
--    todavía está: en un cascade ya no está, y el guard deja pasar. Medido: ver
--    el bloque 101, que borra la empresa con la versión publicada puesta y
--    exige que el borrado ENTRE.
--
-- 2. `draft` ES LIBRE, `published` TIENE UNA SOLA TRANSICIÓN, `superseded` NO
--    TIENE NINGUNA. Sobre un borrador se escribe sin restricción: es para lo
--    que existe. Sobre una publicada el único UPDATE sancionado es pasarla a
--    `superseded` con su fecha, y nada más en la misma sentencia. Una
--    `superseded` es un registro histórico: no admite ni ese.
--
-- 3. LA COMPARACIÓN ES `to_jsonb(NEW) - 'status' - 'superseded_at'`, NO UNA
--    LISTA DE COLUMNAS. Enumerar las columnas a mano es un guard que nace
--    correcto y se rompe con la migración siguiente: la columna que alguien
--    agregue mañana quedaría editable sobre una versión publicada, y nada lo
--    diría. Con el jsonb, una columna nueva nace CONGELADA. Es la dirección
--    segura del error, y el bloque 103 la mide agregando una columna de
--    mentira dentro de una transacción que después se deshace. Con una
--    excepción que conviene saber: una columna GENERATED STORED que alguien
--    agregue a `company_profiles` vendría NULL en `NEW` durante un BEFORE
--    UPDATE y haría que la comparación difiera siempre, o sea que la transición
--    published -> superseded empezaría a rechazarse. Rompe cerrado, no abierto
--    —y es exactamente lo que le pasó a la excepción del punto 9, medido—.
--
-- 4. `superseded_at` ES UNA COLUMNA NUEVA, Y NO ES CONTENIDO. «Cuándo dejó de
--    estar vigente» es un dato SOBRE la versión, no una decisión estratégica de
--    la versión, y sin él la transición del punto 2 no se puede fechar. El CHECK
--    es una equivalencia y no una implicación —`(status='superseded') =
--    (superseded_at IS NOT NULL)`—, así que ni una `draft` ni una `published`
--    pueden llevar fecha de superada. Precedente de forma:
--    `company_profiles_published_is_complete` de la `0026`.
--
-- 5. EL GUARD DE LAS HIJAS ES `SECURITY DEFINER`, Y ES LA DECISIÓN MENOS OBVIA
--    DE ESTE ARCHIVO. La función tiene que contestar «¿la versión padre está
--    congelada?», y distingue «no hay fila» (el padre se está borrando: cascade,
--    punto 1) de «hay fila y no es borrador» (rechazar). Si la corriera el
--    invocador, una fila que RLS le esconde se leería como «no hay fila», o sea
--    como permiso. Un guard cuya respuesta depende de lo que el llamador puede
--    ver no es un guard. Va con `search_path` fijado, que es la otra mitad de
--    un `SECURITY DEFINER` que no es un agujero.
--
-- 6. `FOR SHARE` SOBRE EL PADRE, Y POR UNA CARRERA CONCRETA. La FK ya toma un
--    `FOR KEY SHARE` al insertar una hija, y ese lock NO bloquea un UPDATE de
--    `status`: dos transacciones simultáneas —una que agrega un objetivo viendo
--    `draft`, otra que publica— podrían confirmar las dos y dejar un objetivo
--    dentro de una versión publicada. `FOR SHARE` sí conflictúa con el UPDATE,
--    así que una de las dos espera: si gana la escritura, la publicación
--    incluye el objetivo; si gana la publicación, la escritura re-lee la fila
--    ya publicada y se rechaza. Las dos salidas son correctas; la de sin lock
--    no lo era.
--
-- 7. SQLSTATE PROPIOS, TRES Y DISTINTOS. 45001 = el contenido de una versión no
--    borrador no cambia. 45002 = las hijas de una versión no borrador no
--    cambian. 45003 = transición de estado inválida. La clase 45 no la usa
--    PostgreSQL. Tres códigos y no uno porque las aserciones piden el código
--    exacto: con un solo código, un rechazo del guard equivocado pasaría por
--    el correcto, y eso es precisamente lo que R14 dice que no se puede hacer.
--
-- 8. `ENABLE ALWAYS`. Un trigger normal no dispara con
--    `session_replication_role = 'replica'`. Poner `ALWAYS` cuesta una línea y
--    cierra esa puerta. NO ESTÁ MEDIDO, y el motivo es honesto: cambiar
--    `session_replication_role` pide superusuario, y en la réplica —igual que
--    en hosted— `postgres` no lo es. Lo que sí puede el dueño de la tabla es
--    `ALTER TABLE ... DISABLE TRIGGER`, y eso vale para todos los guards de
--    este repositorio: contra el dueño del esquema no hay guard en el esquema.
--
-- 9. LA MEDICIÓN DE H1.4 NO ES CONTENIDO. `profile_evidence.last_checked_at` y
--    `last_status` son donde el job de H1.4 escribe el resultado del HEAD, y
--    H1.4 mide las afirmaciones PUBLICADAS: si el guard congelara esas dos
--    columnas, la puerta siguiente no podría correr nunca sobre lo que dice
--    medir. Se dejan cambiar, y sólo ellas: el UPDATE pasa únicamente si todo
--    el resto de la fila —`url`, `kind`, `verified_at`, `verified_by`— quedó
--    idéntico. Misma forma que `superseded_at` en el punto 4: una observación
--    sobre la afirmación no es la afirmación.
--
-- 10. EL GUARD RESUELVE LA VERSIÓN POR TABLA, Y FALLA CERRADO SI NO SABE. Seis
--    hijas llevan `profile_id`; `profile_evidence` NO —cuelga de
--    `profile_objectives`, decisión 11 de la `0026`—. La primera versión de
--    este archivo leía `profile_id` en las siete: sobre `profile_evidence` eso
--    da NULL, NULL se habría leído como «no hay padre», «no hay padre» es el
--    caso del cascade, y el cascade deja pasar. O sea: el guard habría
--    permitido reescribir TODA la evidencia de una versión publicada, y en
--    verde. Por eso la resolución es explícita por tabla y una forma que la
--    función no sabe resolver levanta 45002 en vez de devolver 'gone'. Una
--    hija nueva sin `profile_id` rompe las escrituras a la cara, que es la
--    dirección correcta del error.
--
-- 11. NADIE EJECUTA ESTAS FUNCIONES A MANO: `REVOKE ... FROM PUBLIC, anon,
--    authenticated, service_role`, que es la forma de la `0021`. La primera
--    versión revocaba sólo `FROM PUBLIC`, como la `0015`, y MEDIDO en la réplica
--    eso no alcanza: los default privileges de Supabase dan EXECUTE por nombre a
--    los tres roles, así que `anon` podía llamar
--    `company_profile_freeze_state` por RPC. Es `SECURITY DEFINER`: saltea RLS,
--    contesta el estado de la ficha de CUALQUIER organización dado su id, y de
--    paso le toma un `FOR SHARE`. Un oráculo entre tenants y un lock ajeno, a un
--    POST de distancia. Los triggers siguen disparando sin ese privilegio
--    —PostgreSQL no pide EXECUTE sobre la función de un trigger al dispararlo, y
--    lo que ellas llaman adentro corre como su dueño—, y está medido: el bloque
--    100 (`service_role` reescribiendo una publicada) sigue muriendo con 45001,
--    y el 111 pone el control positivo con sesión. El 110 mide el privilegio.
--
-- LO QUE ENCONTRÓ LA REVISIÓN ADVERSARIAL DEL 2026-09-30, Y CÓMO QUEDÓ
--
-- Cinco lentes independientes y un escéptico por lente, cada hallazgo
-- reproducido en la réplica antes de aceptarlo. De este archivo salieron
-- cuatro, y cambiaron el código:
--
-- 12. EL `SET NULL` DEL CATÁLOGO PASA. La primera versión de este guard hacía
--    IMBORRABLE cualquier servicio de `business_services` que una oferta
--    publicada o superada citara: la FK `profile_offers_service_fkey` de la
--    `0026` es `ON DELETE SET NULL (service_id)`, ese SET NULL es un UPDATE
--    sobre `profile_offers`, y el guard lo rechazaba con 45002. O sea, congelaba
--    el catálogo — exactamente lo que el «QUÉ NO HACE» de abajo decía que no
--    hacía, y lo que el comentario de esa FK en la `0026` dice que no puede
--    pasar («que alguien borre un servicio del catálogo no puede bloquear el
--    borrado por una decisión estratégica vieja»). Ahora pasa ESE UPDATE y sólo
--    ése: en `profile_offers`, `service_id` de algo a NULL, nada más cambió, y el
--    servicio YA NO EXISTE. La última condición es la que distingue el SET NULL
--    de la FK —el servicio se está borrando— de alguien que desengancha a mano
--    la oferta de una versión publicada, que sigue muriendo con 45002. Es la
--    misma técnica que distingue el cascade del borrado directo (decisión 1).
--    Lo miden los bloques 113 (el borrado del servicio entra y la oferta queda
--    con NULL) y su contracara (el desenganche a mano no).
--
-- 13. UNA SUPERADA ESTUVO PUBLICADA, Y LO DICE UN CHECK. La transición
--    `draft -> superseded` se rechaza con 45003, pero eso es un trigger de
--    UPDATE: un INSERT directo con `status = 'superseded'` y sin
--    `published_at`/`published_by` entraba, y la `0028` lo aceptaba como versión
--    congelada citable. `company_profiles_superseded_was_published` exige fecha
--    y persona de publicación también para `superseded`. La transición
--    `published -> superseded` las conserva —el jsonb del punto 3 prohíbe
--    tocarlas—, así que ninguna superada legítima pierde nada.
--
-- 14. EL CHEQUEO DE ORIGEN TIENE BLOQUE. Mover una hija de una versión
--    congelada a un borrador le SACA contenido a la congelada, y el guard lo
--    rechaza mirando la versión de origen (la segunda mitad de
--    `profile_child_immutable`). Ningún bloque lo ejercitaba: las veintidós
--    plantillas del 96 reescriben texto, no cambian `profile_id`. Borrar esa
--    mitad del guard dejaba todo verde. El bloque 112 lo mide ahora, en las
--    dos columnas por las que una hija cambia de versión (`profile_id` y, en la
--    evidencia, `objective_id`), con su control positivo entre dos borradores.
--
-- 15. RE-APLICAR DESPUÉS DEL .down. El `.down` borra `superseded_at` y deja las
--    filas en `superseded`, así que volver a aplicar esto moría en el CHECK de
--    la decisión 4 sobre cualquier base que alguna vez superó una versión.
--    Ahora, antes del CHECK, las superadas sin fecha la recuperan: el
--    `published_at` de la versión que las sucedió. Es la fecha real en el flujo
--    del producto —publicar la 3 es pasar la 2 a `superseded` y la 3 a
--    `published` en una transacción (decisión 16 de la `0026`)—, y sólo si no
--    hay sucesora publicada cae a `now()`, que NO es la real. La primera versión
--    de este arreglo ponía `now()` siempre, y la segunda ronda de la revisión
--    adversarial midió qué costaba: la ventana de la superada se estiraba hasta
--    la re-aplicación y se solapaba con la de su sucesora, y la decisión 8 de la
--    `0028` —que la versión citada estuviera vigente— dejaba citar las dos. Y el
--    archivo entero va en una transacción, como la `0026`: sin ella, un fallo a
--    la mitad dejaba la columna puesta y sin guard.
--
-- 16. UNA VERSIÓN NO SE SUPERA ANTES DE PUBLICARSE, Y LO DICE UN CHECK:
--    `superseded_at >= published_at`. Desde la `0028` esas dos fechas deciden
--    qué reporte puede citar qué versión, y una ventana invertida dejaba una
--    versión incitable y rompía las citas que ya la tenían. Lo midió la segunda
--    ronda. Lo que el CHECK NO impide, y queda dicho: un `superseded_at`
--    retroactivo —anterior a un reporte que ya la cita— deja esa cita fuera de su
--    ventana. Desde la segunda ronda eso ya no rompe nada: el trigger de la
--    `0028` no vuelve a comprobar una cita que no cambió. Pero la decisión 8 de
--    la `0028` se garantiza al CITAR, no para siempre. Las dos fechas las
--    escribe quien publica, y hoy ningún código publica.
--
-- QUÉ NO HACE
--
-- * No congela `business_services`. `profile_offers.service_id` apunta al
--   catálogo operativo, y si alguien renombra un servicio, la línea de oferta
--   de una versión publicada resuelve a otro nombre; si lo borra, la oferta
--   queda sin servicio (decisión 12 — la primera versión de este archivo decía
--   esto mismo y lo contradecía). Congelar el catálogo porque una versión vieja
--   lo cita haría inusable el producto. El límite es real y queda dicho: una
--   versión congela SUS filas, no aquello a lo que apunta. Lo mismo con `competitors.profile_competitor_id`, que es el puntero
--   del scrape hacia la lista curada: cambiarlo no cambia la lista.
-- * No hace que el reporte cite el `version_id`. Eso es la otra mitad de H1.2 y
--   vive en `src/lib/reports/`, no en el esquema.
-- * No aplica nada a hosted, igual que la `0026`. Nada en este repositorio
--   aplica migraciones a `tpqiltnskfeycnybczgz`.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La fecha de la superada
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.company_profiles
    ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

-- Decisión 15. Sólo encuentra filas después del `.down`; en una aplicación
-- normal la tabla no tiene superadas sin fecha y esto no toca nada. Corre ANTES
-- de crear los triggers de la sección 3, así que el guard no lo ve.
UPDATE public.company_profiles p
   SET superseded_at = coalesce(
           (SELECT min(n.published_at)
              FROM public.company_profiles n
             WHERE n.organization_id = p.organization_id
               AND n.business_id = p.business_id
               AND n.version > p.version
               AND n.published_at IS NOT NULL),
           now())
 WHERE p.status = 'superseded'
   AND p.superseded_at IS NULL;

COMMENT ON COLUMN public.company_profiles.superseded_at IS
    'Cuándo esta versión dejó de estar vigente. Dato SOBRE la versión, no contenido de la versión: es la única columna que el guard de inmutabilidad deja cambiar, y sólo junto con status -> superseded. Ver decisión 4 de la 0027.';

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'company_profiles_superseded_is_dated'
          AND conrelid = 'public.company_profiles'::regclass
    ) THEN
        ALTER TABLE public.company_profiles
            ADD CONSTRAINT company_profiles_superseded_is_dated
            CHECK ((status = 'superseded') = (superseded_at IS NOT NULL));
    END IF;
END $$;

-- Decisión 13: `published_is_complete` de la `0026` lo exige para `published`;
-- esto, para lo que alguna vez lo fue.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'company_profiles_superseded_was_published'
          AND conrelid = 'public.company_profiles'::regclass
    ) THEN
        ALTER TABLE public.company_profiles
            ADD CONSTRAINT company_profiles_superseded_was_published
            CHECK (status <> 'superseded'
                   OR (published_at IS NOT NULL AND published_by IS NOT NULL));
    END IF;
END $$;

-- Decisión 16.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'company_profiles_superseded_after_published'
          AND conrelid = 'public.company_profiles'::regclass
    ) THEN
        ALTER TABLE public.company_profiles
            ADD CONSTRAINT company_profiles_superseded_after_published
            CHECK (superseded_at IS NULL OR published_at IS NULL
                   OR superseded_at >= published_at);
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ¿Está congelada la versión padre?
-- ─────────────────────────────────────────────────────────────────────────────
-- Contesta tres cosas distintas y por eso devuelve text y no boolean:
--   'gone'   — no hay fila: el padre se está borrando y este DELETE es el
--              cascade. Dejar pasar (decisión 1).
--   'draft'  — hay fila y es borrador. Dejar pasar.
--   'frozen' — hay fila y no es borrador. Rechazar.
CREATE OR REPLACE FUNCTION public.company_profile_freeze_state(
    p_organization_id uuid,
    p_profile_id      uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status text;
BEGIN
    -- FOR SHARE: la decisión 6. Sin el lock, publicar y escribir una hija a la
    -- vez puede dejar una hija dentro de una versión publicada.
    SELECT status INTO v_status
    FROM public.company_profiles
    WHERE organization_id = p_organization_id
      AND id = p_profile_id
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN 'gone';
    END IF;
    IF v_status = 'draft' THEN
        RETURN 'draft';
    END IF;
    RETURN 'frozen';
END
$$;

REVOKE ALL ON FUNCTION public.company_profile_freeze_state(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.company_profile_freeze_state(uuid, uuid) IS
    'Estado de congelamiento de una versión de la ficha, para los guards de las hijas: gone (el padre se borra, es el cascade) / draft (libre) / frozen (rechazar). SECURITY DEFINER a propósito: ver decisión 5 de la 0027.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El guard de la fila-versión
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.company_profiles_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_business_exists boolean;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'draft' THEN
            RETURN OLD;
        END IF;
        -- Decisión 1: el cascade desde `businesses` pasa, el DELETE directo no.
        SELECT EXISTS (
            SELECT 1 FROM public.businesses
            WHERE organization_id = OLD.organization_id AND id = OLD.business_id
        ) INTO v_business_exists;
        IF NOT v_business_exists THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION
            'la version % de la ficha esta en estado % y no se puede borrar: un reporte puede citarla',
            OLD.version, OLD.status
            USING ERRCODE = '45001';
    END IF;

    -- UPDATE de acá para abajo.
    IF OLD.status = 'draft' THEN
        -- Una versión que nunca se publicó no puede quedar «superada»:
        -- `superseded` significa que estuvo vigente y dejó de estarlo.
        IF NEW.status = 'superseded' THEN
            RAISE EXCEPTION
                'la version % es un borrador: no puede pasar a superseded sin haber estado publicada',
                OLD.version
                USING ERRCODE = '45003';
        END IF;
        RETURN NEW;
    END IF;

    -- Nada cambió: un UPDATE que no toca nada no es una edición.
    IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'published'
       AND NEW.status = 'superseded'
       AND NEW.superseded_at IS NOT NULL
       -- Decisión 3: todo lo demás, columnas futuras incluidas, idéntico.
       AND (to_jsonb(NEW) - 'status' - 'superseded_at')
           IS NOT DISTINCT FROM (to_jsonb(OLD) - 'status' - 'superseded_at')
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'la version % de la ficha esta % y su contenido no se edita (unica transicion permitida: published -> superseded, sola)',
        OLD.version, OLD.status
        USING ERRCODE = '45001';
END
$$;

REVOKE ALL ON FUNCTION public.company_profiles_immutable()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_company_profiles_immutable ON public.company_profiles;
CREATE TRIGGER trg_company_profiles_immutable
    BEFORE UPDATE OR DELETE ON public.company_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.company_profiles_immutable();
ALTER TABLE public.company_profiles
    ENABLE ALWAYS TRIGGER trg_company_profiles_immutable;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El guard de las siete hijas
-- ─────────────────────────────────────────────────────────────────────────────
-- Uno solo para las siete: acá el paso SÍ es idéntico —lo único que el guard
-- necesita de la fila es de qué versión es—, así que una copia por tabla serían
-- siete cosas que se separan. Al revés que en la §3 de la `0026`, donde las
-- columnas eran distintas en cada una y un bucle habría escondido las
-- diferencias.
--
-- De qué versión es una fila: resuelto por tabla y fallando cerrado.
CREATE OR REPLACE FUNCTION public.profile_child_freeze_state(
    p_table text,
    p_row   jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org       uuid;
    v_profile   uuid;
    v_objective uuid;
BEGIN
    v_org := (p_row->>'organization_id')::uuid;

    IF p_table = 'profile_evidence' THEN
        -- Decisión 10: la evidencia NO cuelga de la ficha, cuelga del objetivo.
        v_objective := (p_row->>'objective_id')::uuid;
        SELECT profile_id INTO v_profile
        FROM public.profile_objectives
        WHERE organization_id = v_org AND id = v_objective;
        -- El objetivo ya no está: la cadena de cascades lo borró primero.
        IF NOT FOUND THEN
            RETURN 'gone';
        END IF;
    ELSE
        v_profile := (p_row->>'profile_id')::uuid;
        -- Decisión 10, la mitad que importa: una tabla que no tenga de dónde
        -- sacar la versión NO pasa en silencio.
        IF v_profile IS NULL THEN
            RAISE EXCEPTION
                'el guard de inmutabilidad no sabe de que version es una fila de %', p_table
                USING ERRCODE = '45002';
        END IF;
    END IF;

    RETURN public.company_profile_freeze_state(v_org, v_profile);
END
$$;

REVOKE ALL ON FUNCTION public.profile_child_freeze_state(text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profile_child_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new   jsonb;
    v_old   jsonb;
    v_state text;
BEGIN
    IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
    IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;

    -- La versión donde la fila QUEDA; en un DELETE, la que se va.
    v_state := public.profile_child_freeze_state(TG_TABLE_NAME, COALESCE(v_new, v_old));

    -- Decisión 9: el job de H1.4 escribe su medición encima de una versión
    -- publicada, y tiene que poder, porque H1.4 mide las afirmaciones
    -- PUBLICADAS. Sólo esas dos columnas, y sólo si nada más cambió.
    IF v_state = 'frozen'
       AND TG_OP = 'UPDATE'
       AND TG_TABLE_NAME = 'profile_evidence'
       -- `source_host` sale de la comparación, y NO por gusto: es una columna
       -- GENERATED STORED, y en un BEFORE UPDATE todavía no está calculada, así
       -- que en `NEW` viene NULL mientras en `OLD` tiene el host. Sin esta
       -- línea, la comparación difiere SIEMPRE y la excepción no se aplica
       -- nunca: medido en la réplica, el bloque 102 daba 45002 donde esperaba
       -- que la medición del job entrara. Es la misma trampa que el trigger de
       -- la `0015` ya había pagado y dejado escrita. `url` sigue comparándose,
       -- que es lo que importa: si la URL cambia, `source_host` es su
       -- consecuencia.
       AND (v_new - 'last_checked_at' - 'last_status' - 'source_host')
           IS NOT DISTINCT FROM (v_old - 'last_checked_at' - 'last_status' - 'source_host')
    THEN
        RETURN NEW;
    END IF;

    -- Decisión 12: el `ON DELETE SET NULL (service_id)` de la `0026`, y sólo él.
    -- Lo que lo distingue de un desenganche a mano es que el servicio ya no
    -- está: la acción de la FK corre después de borrarlo.
    IF v_state = 'frozen'
       AND TG_OP = 'UPDATE'
       AND TG_TABLE_NAME = 'profile_offers'
       AND (v_old->>'service_id') IS NOT NULL
       AND (v_new->>'service_id') IS NULL
       AND (v_new - 'service_id') IS NOT DISTINCT FROM (v_old - 'service_id')
       AND NOT EXISTS (
           SELECT 1 FROM public.business_services
            WHERE organization_id = (v_old->>'organization_id')::uuid
              AND id = (v_old->>'service_id')::uuid)
    THEN
        RETURN NEW;
    END IF;

    IF v_state = 'frozen' THEN
        RAISE EXCEPTION
            '% de una version publicada o superada: el contenido de la version no se edita',
            TG_TABLE_NAME
            USING ERRCODE = '45002';
    END IF;

    -- Y la versión de DONDE VIENE, que es un agujero distinto: mover una línea
    -- de oferta de una versión publicada a un borrador le SACA contenido a la
    -- publicada, y el destino de ese UPDATE es un borrador, así que la
    -- comprobación de arriba lo deja pasar.
    IF TG_OP = 'UPDATE' THEN
        v_state := public.profile_child_freeze_state(TG_TABLE_NAME, v_old);
        IF v_state = 'frozen' THEN
            RAISE EXCEPTION
                '% de una version publicada o superada: el contenido de la version no se edita',
                TG_TABLE_NAME
                USING ERRCODE = '45002';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.profile_child_immutable()
    FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'profile_offers',
        'profile_markets',
        'profile_segments',
        'profile_competitors',
        'profile_icp',
        'profile_objectives',
        'profile_evidence'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_immutable ON public.%I', t, t);
        EXECUTE format(
            'CREATE TRIGGER trg_%s_immutable
                 BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                 FOR EACH ROW EXECUTE FUNCTION public.profile_child_immutable()', t, t);
        EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER trg_%s_immutable', t, t);
    END LOOP;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('0027_profile_immutability')
ON CONFLICT (version) DO NOTHING;

COMMIT;
