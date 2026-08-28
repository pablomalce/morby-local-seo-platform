-- 0016_expand_publication_ledger.sql — publicar deja registro, y un reintento no
-- duplica.
--
-- QUÉ CIERRA, Y QUÉ NO
--
-- La puerta de F4 pide tres cosas: *una publicación real en una ficha de prueba,
-- con registro de quién aprobó qué y cuándo, y un reintento que demuestre que no
-- duplica.*
--
-- Esta migración cierra la segunda y la tercera. La primera necesita el OAuth de
-- Google, que es de Pablo, y **no se simula**: una publicación contra un doble no
-- cumple esa puerta, la imita. Lo que sí se puede hacer es que el día que las
-- credenciales existan, el transporte no tenga margen para duplicar ni para
-- publicar algo que nadie aprobó.
--
-- LA IDEMPOTENCIA ES UNA RESTRICCIÓN, NO UN `if`
--
-- "Un reintento no puede duplicar un post en la cuenta de un cliente" es una
-- promesa que el código no puede sostener solo: dos procesos concurrentes que
-- consultan y después insertan pasan los dos por el `if`. La única forma de que
-- sea cierta es que la base rechace el segundo.
--
-- Dos unicidades, y cada una tapa un agujero distinto:
--
--   * `(asset_id, destination)` — el mismo contenido no se publica dos veces en
--     el mismo lugar. Es la idempotencia que pide la espina;
--   * `(destination, external_id)` — el id que devolvió la red pertenece a UNA
--     publicación. Sin esto, dos filas pueden reclamar el mismo post y borrar una
--     dejaría la otra apuntando a algo que ya no está.
--
-- Y NO SE PUBLICA LO QUE NADIE APROBÓ
--
-- La 0015 impide que un asset llegue a 'published' sin aprobación. Eso protege la
-- fila del asset, no esta tabla: sin la FK compuesta de abajo, se podría crear una
-- publicación de un borrador y el ledger diría que salió algo que nunca se
-- aprobó.
--
-- La FK va contra `(id, approved_hash)` de content_assets — no contra `id` solo —
-- así que una publicación queda amarrada AL TEXTO aprobado y no al asset en
-- abstracto. Si el asset vuelve a borrador, su `approved_hash` pasa a NULL y la
-- FK ya no encuentra a quién apuntar: la publicación no puede crearse. Es la
-- misma idea del hash de la 0015, una tabla más allá.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El destino de la FK compuesta
-- ─────────────────────────────────────────────────────────────────────────────
-- Una FK necesita un índice único del otro lado. `approved_hash` es nullable a
-- propósito —un borrador no tiene sello— y eso está bien: una fila con NULL no
-- puede ser referenciada, que es exactamente lo que se busca.
CREATE UNIQUE INDEX IF NOT EXISTS content_assets_id_approved_hash_key
    ON public.content_assets (id, approved_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El ledger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    asset_id        uuid NOT NULL,
    -- El texto que se publicó, que es el que se aprobó. Ver el encabezado.
    approved_hash   text NOT NULL,

    destination     text NOT NULL,

    -- Lo que devolvió la red. NULL mientras el intento no haya terminado bien:
    -- una publicación sin id externo es una que no se puede ir a buscar ni
    -- borrar, y por eso no puede estar en 'published'.
    external_id     text,

    status          text NOT NULL DEFAULT 'pending',
    attempts        int  NOT NULL DEFAULT 0,
    published_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT publications_asset_fkey
        FOREIGN KEY (asset_id, approved_hash)
        REFERENCES public.content_assets (id, approved_hash) ON DELETE CASCADE,

    CONSTRAINT publications_destination_check
        CHECK (destination IN ('google_business_profile')),

    CONSTRAINT publications_status_check
        CHECK (status IN ('pending', 'published', 'failed')),

    -- Publicada quiere decir: hay un id de la red y una fecha. Sin esto,
    -- 'published' es una palabra que alguien escribió.
    CONSTRAINT publications_published_is_complete
        CHECK (
            CASE WHEN status = 'published'
                 THEN external_id IS NOT NULL AND published_at IS NOT NULL
                 ELSE true
            END
        )
);

COMMENT ON TABLE public.publications IS
    'Una fila por asset y destino. La unicidad es la idempotencia: un reintento no crea una segunda.';

-- La idempotencia que pide la espina.
CREATE UNIQUE INDEX IF NOT EXISTS publications_asset_destination_key
    ON public.publications (asset_id, destination);

-- El id de la red pertenece a una sola publicación. Parcial porque `external_id`
-- es NULL mientras el intento no terminó, y varios NULL no compiten.
CREATE UNIQUE INDEX IF NOT EXISTS publications_destination_external_key
    ON public.publications (destination, external_id)
    WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS publications_org_idx
    ON public.publications (organization_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS, igual que la 0014: una permisiva y una RESTRICTIVE
-- ─────────────────────────────────────────────────────────────────────────────
-- La restrictiva no es redundante: la permisiva se puede ensanchar agregando
-- otra permisiva, y la restrictiva no.
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "publications_rw_member" ON public.publications;
CREATE POLICY "publications_rw_member" ON public.publications
    FOR ALL
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "publications_tenant_axis" ON public.publications;
CREATE POLICY "publications_tenant_axis" ON public.publications
    AS RESTRICTIVE
    FOR ALL
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Los privilegios, declarados
-- ─────────────────────────────────────────────────────────────────────────────
-- Una tabla nueva en `public` nace con los siete privilegios para los tres roles
-- por los default privileges de Supabase. Publicar lo hace el servidor.
REVOKE ALL ON public.publications FROM anon, authenticated, service_role;
GRANT SELECT ON public.publications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publications TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0016_expand_publication_ledger')
ON CONFLICT (version) DO NOTHING;
