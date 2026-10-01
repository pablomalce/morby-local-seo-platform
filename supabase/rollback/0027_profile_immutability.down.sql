-- Revierte la 0027.
--
-- QUÉ SE PIERDE
--
-- La garantía, entera: desde que esto corre, una versión publicada de la ficha
-- vuelve a ser un estado que nadie protege de un UPDATE, que es exactamente lo
-- que la `0026` decía de sí misma. Un reporte que citó una versión deja de poder
-- confiar en que la cita resuelve al texto de cuando se citó.
--
-- Y un dato: `superseded_at`, la fecha en que cada versión dejó de estar
-- vigente. Las filas quedan con `status = 'superseded'` y sin fecha. Es el único
-- dato que la `0027` agregó; todo lo demás son funciones y triggers, que no
-- guardan nada.
--
-- Y POR ESO SE NIEGA A CORRER si hay versiones superadas, salvo que quien lo
-- corre lo pida con todas las letras:
--
--     SET vulkan.perder_fechas_de_superacion = 'si';
--
-- La `0027` no reconstruye esas fechas al volver a aplicarse —se niega y nombra
-- las filas (su decisión 15)—, porque tres rondas de la revisión adversarial
-- mostraron que ninguna regla lo hace sin adivinar, y desde la `0028` una fecha
-- adivinada decide qué reporte puede citar qué versión. Así que el camino es:
--
--   1. exportar `id, superseded_at` de las superadas;
--   2. correr esto con el SET de arriba;
--   3. para volver: `ALTER TABLE public.company_profiles ADD COLUMN
--      superseded_at timestamptz`, poner las fechas del export, y re-aplicar la
--      `0027`, que encuentra la columna con fechas y sigue.
--
-- El paso 3 empieza por la columna porque sin ella no hay dónde poner las
-- fechas: este archivo la borra, y la `0027` al negarse deshace la suya.
--
-- Y dos cosas del paso 3 que el export no resuelve, medidas por la sexta ronda:
-- una versión que alguien SUPERE mientras la `0027` está revertida no tiene
-- fecha en ningún lado —ni en la base ni en el export—, así que la fecha la
-- decide una persona, y conviene anotar en algún lado que es decidida y no
-- medida; y si además la escribió sin `published_at`/`published_by` —la `0026`
-- sola lo acepta—, la re-aplicación muere en el CHECK de la decisión 13 hasta
-- que alguien complete esos dos datos. `published_by` tampoco se inventa.
--
-- El permiso vale para UNA corrida: este archivo lo consume al terminar. Y se
-- niega si el permiso viene de un lugar donde el `RESET` no llega —`PGOPTIONS`,
-- `ALTER ROLE ... SET`, `ALTER DATABASE ... SET`—, porque ése sobrevive al
-- `RESET` y valdría para todas las corridas que vengan. Es la comprobación que
-- el #107 le puso al `.down` de la `0026`, que lo midió el 2026-10-01: con
-- `PGOPTIONS="-c vulkan.perder_la_ficha=si"`, después del `RESET` el valor sigue
-- siendo `si`. Este archivo tenía el mismo hueco.
--
-- Si la `0028` está aplicada, se revierte PRIMERO: su trigger de la cita confía
-- en que una versión no borrador está congelada, y sin la `0027` esa confianza
-- queda sin sostén aunque el trigger siga ahí.
--
-- EL ORDEN IMPORTA
--
-- Los triggers antes que las funciones que ejecutan: `DROP FUNCTION` sin CASCADE
-- falla si un trigger todavía la usa, y ése es el punto — un CASCADE en un .down
-- es la clase de instrucción que un día se lleva algo que nadie nombró. La
-- constraint antes que la columna que mira, por la misma razón.

-- LAS NEGATIVAS, Y POR QUÉ ESTE ARCHIVO SE PROTEGE SOLO. La sexta ronda de la
-- revisión adversarial midió que la primera versión fallaba ABIERTA con un
-- `psql -f` a secas: sin transacción y sin `ON_ERROR_STOP`, psql imprimía la
-- negativa y seguía con los DROP, que se confirmaban uno por uno. Por eso, como
-- el .down de la `0026`: `ON_ERROR_STOP` propio y una transacción que envuelve
-- todo. Y el lock va antes de las comprobaciones, para que nadie publique ni
-- supere una versión entre que se miró y que se borró.
\set ON_ERROR_STOP on

BEGIN;

LOCK TABLE public.company_profiles IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    v_permiso  text := coalesce(current_setting('vulkan.perder_fechas_de_superacion', true), '');
    v_de_fondo text;
BEGIN
    -- La `0028` primero: su trigger de la cita lee `superseded_at`, y sin esta
    -- columna cada reporte con cita muere con 42703. La guarda de la `0028` lo
    -- impide al aplicarla; esto lo impide al revertir esta.
    IF EXISTS (SELECT 1 FROM public.schema_migrations
                WHERE version = '0028_report_cites_profile_version')
       OR EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgname = 'trg_reports_cite_frozen_version'
                     AND tgrelid = 'public.reports'::regclass) THEN
        RAISE EXCEPTION 'la 0028 esta aplicada: revertirla primero (su trigger lee superseded_at)';
    END IF;

    -- Las fechas. Sólo si la columna todavía existe: una segunda corrida de
    -- este archivo no tiene nada que perder y no tiene por qué negarse.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'company_profiles'
                  AND column_name = 'superseded_at')
       AND EXISTS (SELECT 1 FROM public.company_profiles WHERE status = 'superseded') THEN
        IF v_permiso <> 'si' THEN
            RAISE EXCEPTION 'hay versiones superadas: este .down borra su superseded_at y la 0027 no la vuelve a inventar. Exportar id y superseded_at primero; para seguir igual: SET vulkan.perder_fechas_de_superacion = ''si'';';
        END IF;

        -- De dónde viene el permiso, igual que en el `.down` de la `0026`.
        -- `RESET` lleva el valor al que tendría la sesión sin ningún SET: si ése
        -- ya es 'si', el permiso vino de PGOPTIONS o de un ALTER ROLE/DATABASE
        -- SET, el RESET del final no lo consume y valdría para siempre. Se lee y
        -- se devuelve el valor como estaba.
        RESET vulkan.perder_fechas_de_superacion;
        v_de_fondo := coalesce(current_setting('vulkan.perder_fechas_de_superacion', true), '');
        PERFORM set_config('vulkan.perder_fechas_de_superacion', v_permiso, false);
        IF v_de_fondo = 'si' THEN
            RAISE EXCEPTION 'el permiso vulkan.perder_fechas_de_superacion viene de PGOPTIONS o de un ALTER ROLE/DATABASE SET: sobrevive al RESET y valdria para todas las corridas. Sacarlo de ahi y darlo con SET en esta sesion.';
        END IF;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_company_profiles_immutable ON public.company_profiles;
DROP TRIGGER IF EXISTS trg_profile_offers_immutable ON public.profile_offers;
DROP TRIGGER IF EXISTS trg_profile_markets_immutable ON public.profile_markets;
DROP TRIGGER IF EXISTS trg_profile_segments_immutable ON public.profile_segments;
DROP TRIGGER IF EXISTS trg_profile_competitors_immutable ON public.profile_competitors;
DROP TRIGGER IF EXISTS trg_profile_icp_immutable ON public.profile_icp;
DROP TRIGGER IF EXISTS trg_profile_objectives_immutable ON public.profile_objectives;
DROP TRIGGER IF EXISTS trg_profile_evidence_immutable ON public.profile_evidence;

DROP FUNCTION IF EXISTS public.profile_child_immutable();
DROP FUNCTION IF EXISTS public.profile_child_freeze_state(text, jsonb);
DROP FUNCTION IF EXISTS public.company_profiles_immutable();
DROP FUNCTION IF EXISTS public.company_profile_freeze_state(uuid, uuid);

ALTER TABLE public.company_profiles
    DROP CONSTRAINT IF EXISTS company_profiles_superseded_after_published;
ALTER TABLE public.company_profiles
    DROP CONSTRAINT IF EXISTS company_profiles_superseded_was_published;
ALTER TABLE public.company_profiles
    DROP CONSTRAINT IF EXISTS company_profiles_superseded_is_dated;
ALTER TABLE public.company_profiles
    DROP COLUMN IF EXISTS superseded_at;

DELETE FROM public.schema_migrations WHERE version = '0027_profile_immutability';

-- El permiso se consume: vale para UNA corrida. Sin esto, el `SET` de sesión
-- seguía vivo, y una segunda corrida en la misma sesión —o en una conexión
-- reutilizada— borraba fechas restauradas sin que nadie lo pidiera otra vez.
-- Lo encontró la sexta ronda. Dentro de la transacción: si algo de arriba
-- falla, el permiso queda para reintentar.
RESET vulkan.perder_fechas_de_superacion;

COMMIT;
