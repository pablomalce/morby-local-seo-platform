-- 0015_expand_content_approval.down.sql — la vuelta atrás de la 0015.
--
-- El inverso, al revés: primero el trigger —que nombra a la función—, después la
-- función, después el CHECK, y al final las columnas.
--
-- LO QUE ESTE .down SE LLEVA, Y HAY QUE SABERLO ANTES
--
-- El registro de quién aprobó qué y cuándo. `approved_by` y `approved_at` son
-- columnas, no una tabla de auditoría aparte, así que al tirarlas se pierde. Es
-- una decisión de la 0015 y este archivo la hereda: mientras la cadena de
-- aprobación viva en la misma fila que el contenido, volver atrás la borra.
--
-- Si eso importa el día que haya que usar esto, la salida NO es dudar del
-- `.down` sino guardar antes:
--
--     CREATE TABLE aprobaciones_respaldo AS
--     SELECT id, status, approved_by, approved_at, approved_hash
--       FROM public.content_assets
--      WHERE approved_hash IS NOT NULL;
--
-- Y hay un efecto que no se ve en la huella: al desaparecer el CHECK, las filas
-- en 'approved', 'scheduled' o 'published' se quedan en esos estados **sin nada
-- que las respalde**. El esquema vuelve a ser el de antes, que es lo que se
-- pide, y ese esquema es exactamente el que permitía publicar sin aprobar.
-- Volver atrás de esta migración reabre el defecto que cierra: es su naturaleza,
-- no un descuido.

\set ON_ERROR_STOP on

DROP TRIGGER IF EXISTS trg_content_assets_reset_approval ON public.content_assets;
DROP FUNCTION IF EXISTS public.content_assets_reset_approval();

ALTER TABLE public.content_assets
    DROP CONSTRAINT IF EXISTS content_assets_approval_check;

ALTER TABLE public.content_assets DROP COLUMN IF EXISTS approved_at;
ALTER TABLE public.content_assets DROP COLUMN IF EXISTS approved_by;
ALTER TABLE public.content_assets DROP COLUMN IF EXISTS approved_hash;
ALTER TABLE public.content_assets DROP COLUMN IF EXISTS payload_hash;

-- Después de la columna, que es quien la usa en su expresión generada.
DROP FUNCTION IF EXISTS public.content_payload_hash(text, text, text, text, text);

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0015_expand_content_approval';
