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

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.company_profiles WHERE status = 'superseded')
       AND coalesce(current_setting('vulkan.perder_fechas_de_superacion', true), '') <> 'si' THEN
        RAISE EXCEPTION 'hay versiones superadas: este .down borra su superseded_at y la 0027 no la vuelve a inventar. Exportar id y superseded_at primero; para seguir igual: SET vulkan.perder_fechas_de_superacion = ''si'';';
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
