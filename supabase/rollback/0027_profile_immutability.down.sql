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
-- Volver a aplicar la `0027` después de esto funciona, con dos condiciones que
-- conviene saber. Las fechas perdidas se recuperan del `published_at` de la
-- versión sucesora, que es la fecha real en el flujo del producto; sin sucesora
-- publicada, la fecha es la de re-aplicación (decisión 15). Y si MIENTRAS la
-- `0027` estuvo revertida alguien escribió una fila `superseded` sin fecha ni
-- persona de publicación —la `0026` sola lo acepta—, la re-aplicación se niega
-- en el CHECK de la decisión 13, entera y sin dejar nada a medias. Es lo
-- correcto: `published_by` no se puede inventar. Hay que corregir esa fila a
-- mano. La primera versión de este encabezado decía «funciona» sin condiciones;
-- la segunda ronda de la revisión adversarial midió la segunda.
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
