-- 0015_expand_content_approval.sql — la aprobación deja de ser una palabra.
--
-- QUÉ CIERRA
--
-- La puerta de F3, textual de la espina: *un test que demuestre que un asset no
-- aprobado NO PUEDE publicarse aunque se llame la ruta directamente, y otro que
-- un cambio post-aprobación lo devuelve a borrador.*
--
-- `content_assets.status` ya tenía el vocabulario entero —draft, pending_review,
-- approved, rejected, scheduled, published, archived— y NADA lo hacía cumplir.
-- Un `UPDATE ... SET status = 'published'` sobre un borrador pasaba sin más. El
-- CHECK sólo miraba que la palabra estuviera en la lista, que es otra cosa: dice
-- que 'published' se escribe así, no que se pueda llegar ahí.
--
-- "Aunque se llame la ruta directamente" es la parte que decide el diseño. Si la
-- regla vive en el código de la aplicación, llamar a PostgREST la saltea. Tiene
-- que estar en la base.
--
-- POR QUÉ UN CHECK Y NO SÓLO UN TRIGGER
--
-- El bloque 9 de la suite existe por esto: una negativa que sostiene un trigger
-- se cae el día que alguien lo tira, y la suite queda verde hasta entonces. Así
-- que la garantía es estructural y el trigger sólo agrega comodidad:
--
--   * el CHECK dice que una fila publicable con el payload cambiado NO EXISTE.
--     No se puede desactivar sin un ALTER TABLE explícito, y si alguien lo tira
--     el bloque 28 lo dice;
--   * el trigger devuelve la fila a 'draft' cuando el payload cambia, que es la
--     ergonomía que la espina pide —"lo devuelve a borrador"— y no la garantía.
--
-- Sin el trigger, un cambio post-aprobación es RECHAZADO en vez de degradado. Es
-- más estricto, no menos, y por eso la puerta sigue cumplida si el trigger
-- desaparece.
--
-- EL HASH ES UNA COLUMNA GENERADA, NO ALGO QUE ALGUIEN RECUERDE ESCRIBIR
--
-- `payload_hash` la calcula PostgreSQL en cada escritura. Un hash que la
-- aplicación tiene que acordarse de recalcular es un hash que un día no se
-- recalcula, y entonces aprueba contenido que ya no es el que se aprobó.
--
-- Lo que entra en el hash es lo que el cliente leería publicado: título, cuerpo,
-- idioma, tipo y keyword. NO entran `status`, `updated_at` ni el eje: cambiar de
-- estado no puede invalidar la aprobación, o aprobar sería imposible.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El hash de lo que se aprueba, y el de lo que se aprobó
-- ─────────────────────────────────────────────────────────────────────────────
-- `coalesce` en las dos nullables: `md5(NULL)` es NULL y arrastraría el hash
-- entero a NULL, con lo cual la comparación de abajo nunca sería falsa y el
-- CHECK dejaría pasar todo. Un separador que no aparece en el texto evita que
-- mover una palabra de `title` a `body` dé el mismo hash.
-- El hash vive en una función y no en línea, porque hace falta en DOS lugares y
-- una segunda copia se desincronizaría el día que alguien agregue un campo al
-- payload: la columna generada de acá abajo, y el trigger, que no puede leer la
-- columna generada. Ver el comentario del trigger — costó un bug.
--
-- IMMUTABLE, que es lo que `GENERATED ALWAYS AS` exige y además es cierto: mismo
-- texto, mismo hash, para siempre.
CREATE OR REPLACE FUNCTION public.content_payload_hash(
    p_title text, p_body text, p_locale text, p_kind text, p_keyword text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT md5(
        coalesce(p_title, '') || E'\x1f' ||
        p_body                || E'\x1f' ||
        p_locale              || E'\x1f' ||
        p_kind                || E'\x1f' ||
        coalesce(p_keyword, '')
    );
$$;

REVOKE ALL ON FUNCTION public.content_payload_hash(text, text, text, text, text) FROM PUBLIC;

ALTER TABLE public.content_assets
    ADD COLUMN IF NOT EXISTS payload_hash text
    GENERATED ALWAYS AS (
        public.content_payload_hash(title, body, locale, kind, target_keyword)
    ) STORED;

COMMENT ON COLUMN public.content_assets.payload_hash IS
    'Hash de lo que se publicaría. Generado: la base lo mantiene, nadie tiene que acordarse.';

-- El hash del payload TAL COMO ESTABA cuando se aprobó. NULL mientras no haya
-- aprobación.
ALTER TABLE public.content_assets
    ADD COLUMN IF NOT EXISTS approved_hash text;

ALTER TABLE public.content_assets
    ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.content_assets
    ADD COLUMN IF NOT EXISTS approved_at timestamptz;

COMMENT ON COLUMN public.content_assets.approved_by IS
    'Quién aprobó. ON DELETE SET NULL: que una persona se vaya no puede borrar el asset ni desaprobarlo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La garantía, que es un CHECK
-- ─────────────────────────────────────────────────────────────────────────────
-- Dos reglas, y hacen falta las dos.
--
-- La primera: para estar en un estado que implica aprobación —approved,
-- scheduled, published— hace falta que la aprobación exista Y que sea DE ESTE
-- payload. Sin la segunda mitad, aprobar y después reescribir el cuerpo publica
-- algo que nadie leyó.
--
-- La segunda: los estados que NO implican aprobación no pueden arrastrar una
-- aprobación vieja. Si no, volver a borrador y avanzar de nuevo saltearía la
-- revisión con el sello anterior puesto.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.content_assets'::regclass
                      AND conname = 'content_assets_approval_check') THEN
        ALTER TABLE public.content_assets ADD CONSTRAINT content_assets_approval_check
        CHECK (
            CASE
                WHEN status IN ('approved', 'scheduled', 'published') THEN
                    approved_by   IS NOT NULL
                AND approved_at   IS NOT NULL
                AND approved_hash IS NOT NULL
                AND approved_hash = payload_hash
                ELSE
                    approved_hash IS NULL
                AND approved_by   IS NULL
                AND approved_at   IS NULL
            END
        );
    END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La comodidad, que es un trigger, y que no es la garantía
-- ─────────────────────────────────────────────────────────────────────────────
-- Sin esto, editar el cuerpo de un asset aprobado da un error de restricción y
-- quien edita tiene que saber que además debe bajar el estado a mano. Con esto,
-- baja solo — que es lo que la espina describe.
--
-- La diferencia con los triggers que la 0012 sacó: aquéllos RELLENABAN un dato
-- que la aplicación tenía a mano, y su ausencia se leía como que todo estaba
-- bien. Éste no completa nada; degrada, y si desaparece la base se vuelve MÁS
-- estricta, no menos. El bloque 28 mide exactamente eso.
CREATE OR REPLACE FUNCTION public.content_assets_reset_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Sólo si el payload cambió Y la fila venía aprobada. Un cambio de estado
    -- solo, o una edición sobre un borrador, no tocan nada.
    --
    -- SE RECALCULA EL HASH, no se lee `NEW.payload_hash`. En un BEFORE UPDATE una
    -- columna generada TODAVÍA NO ESTÁ CALCULADA: `NEW.payload_hash` es NULL, y
    -- `NULL IS DISTINCT FROM <algo>` es cierto, así que la condición se cumplía
    -- SIEMPRE y el trigger degradaba a borrador cualquier escritura sobre una
    -- fila aprobada — incluido pasarla a 'scheduled'.
    --
    -- Los bloques 26, 27 y 28 pasaban en verde con eso puesto. Lo encontró el 30,
    -- que era el único que hacía un UPDATE sin tocar el payload.
    IF public.content_payload_hash(NEW.title, NEW.body, NEW.locale, NEW.kind, NEW.target_keyword)
       IS DISTINCT FROM OLD.payload_hash
       AND OLD.approved_hash IS NOT NULL THEN
        NEW.status        := 'draft';
        NEW.approved_hash := NULL;
        NEW.approved_by   := NULL;
        NEW.approved_at   := NULL;
    END IF;
    RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.content_assets_reset_approval() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_content_assets_reset_approval ON public.content_assets;
CREATE TRIGGER trg_content_assets_reset_approval
    BEFORE UPDATE ON public.content_assets
    FOR EACH ROW
    EXECUTE FUNCTION public.content_assets_reset_approval();

INSERT INTO public.schema_migrations (version) VALUES ('0015_expand_content_approval')
ON CONFLICT (version) DO NOTHING;
