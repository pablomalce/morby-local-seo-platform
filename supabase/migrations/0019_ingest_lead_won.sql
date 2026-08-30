-- 0019_ingest_lead_won.sql — la ingesta entera en UNA transacción, para que la
-- idempotencia sea la restricción y no el orden en que el código tuvo suerte.
--
-- POR QUÉ ESTO ES UNA FUNCIÓN Y NO CÓDIGO DE LA APLICACIÓN
--
-- La 0018 dejó escrito el orden que la restricción obliga: adoptar o crear la
-- Organization, el Business y las Locations, y reclamar la clave de idempotencia
-- AL FINAL. Una segunda entrega hace todo el trabajo otra vez, pierde en ese
-- último INSERT con `23505`, y **su transacción entera vuelve atrás y se lleva la
-- organización especulativa**.
--
-- Eso último es la mitad que el código de la aplicación no puede sostener.
-- `supabase-js` manda una sentencia por viaje: cinco escrituras son cinco
-- transacciones, y una caída en el medio deja un cliente a medio crear que el
-- siguiente reintento no limpia — porque su clave todavía no está reclamada, así
-- que el reintento se ve a sí mismo como el primero.
--
-- Una función es UNA sentencia desde afuera, o sea una transacción. No es una
-- preferencia por SQL: es lo único que hace cierta la promesa que la 0018
-- escribió.
--
-- QUÉ HACE ESTA FUNCIÓN Y QUÉ NO
--
-- NO valida la firma HMAC, NO parsea el cuerpo y NO canonicaliza slugs. Eso vive
-- en TypeScript, donde se puede probar por mutación con el arnés del repositorio.
-- Acá entran escalares ya validados y ya canónicos.
--
-- La costura está puesta ahí a propósito: la parte que decide si un pedido es
-- legítimo se prueba con tests, y la parte que tiene que ser atómica se ejecuta
-- en una transacción. Mezclarlas haría que una de las dos se probara mal.
--
-- POR QUÉ `SECURITY DEFINER`, Y POR QUÉ ESO NO ABRE NADA
--
-- Escribe en cinco tablas cuyo eje de tenant es la organización que ESTA MISMA
-- llamada está creando, así que no hay sesión cuya RLS podría aprobarla: el
-- llamador es el servidor, no un usuario. `service_role` es el único que puede
-- ejecutarla, y el `REVOKE ALL ... FROM PUBLIC` de abajo es lo que impide que
-- `authenticated` la alcance — porque una función `SECURITY DEFINER` alcanzable
-- desde el navegador es una manera de saltear la RLS con más pasos.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.ingest_lead_won(
    p_source_system    text,
    p_idempotency_key  text,
    p_org_id           uuid,      -- NULL = hay que acuñarla
    p_org_name         text,
    p_org_slug         text,
    p_org_locale       text,
    p_business_name    text,
    p_business_slug    text,
    p_business_website text,
    p_business_industry text,
    p_location         jsonb,     -- {label, address_line, city, region, country, postal_code}
    p_contact          jsonb      -- {display_name, email, phone, website, source}
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_org        uuid;
    v_business   uuid;
    v_constraint text;
    v_slug       text;
BEGIN
    -- El bloque entero es una subtransacción por tener EXCEPTION. Eso es lo que
    -- se quiere: cuando el INSERT final choca, TODO lo de arriba vuelve atrás.
    -- Sin el handler, el error subiría y la transacción del llamador abortaría
    -- igual — pero no habría cómo contestar «esto ya estaba» en vez de un 500,
    -- y un productor que recibe 500 reintenta para siempre.

    -- ── 1. La organización ────────────────────────────────────────────────
    -- ADOPTAR el id cuando viene, nunca acuñar uno nuevo: es el mismo `org_id`
    -- que usa Vulkan OS, y por eso F5 no tiene que reconciliar identidades
    -- comparando nombres de negocios. Acuñar acá rompería esa igualdad en
    -- silencio y el síntoma aparecería una fase más adelante.
    IF p_org_id IS NOT NULL THEN
        SELECT id INTO v_org FROM organizations WHERE id = p_org_id;
        IF v_org IS NULL THEN
            INSERT INTO organizations (id, name, slug, default_locale)
            VALUES (p_org_id, p_org_name, p_org_slug, p_org_locale)
            RETURNING id INTO v_org;
        END IF;
    ELSE
        -- `organizations.slug` es único GLOBAL en este esquema, sin alcance por
        -- tenant. El productor manda una SUGERENCIA y resolver la colisión es de
        -- este lado, que es el único que ve qué está tomado. Se desambigua con
        -- un sufijo corto y estable en vez de fallar: rechazar la entrega
        -- convertiría el nombre de otro cliente en un cliente perdido.
        v_slug := p_org_slug;
        IF EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) THEN
            v_slug := left(p_org_slug, 54) || '-' || left(md5(p_idempotency_key), 6);
        END IF;
        INSERT INTO organizations (name, slug, default_locale)
        VALUES (p_org_name, v_slug, p_org_locale)
        RETURNING id INTO v_org;
    END IF;

    -- ── 2. El negocio ─────────────────────────────────────────────────────
    -- Por slug dentro de la organización, que es la unicidad que la 0018 puso.
    -- Si ya existe no se toca: una entrega repetida no debe pisar lo que un
    -- operador editó a mano después.
    SELECT id INTO v_business
      FROM businesses
     WHERE organization_id = v_org AND lower(slug) = lower(p_business_slug);

    IF v_business IS NULL THEN
        INSERT INTO businesses (organization_id, name, slug, website, industry, primary_locale)
        VALUES (v_org, p_business_name, p_business_slug, p_business_website,
                p_business_industry, p_org_locale)
        RETURNING id INTO v_business;
    END IF;

    -- ── 3. La location ────────────────────────────────────────────────────
    -- `is_primary` con la unicidad parcial que ya existe
    -- (`business_locations_one_primary_per_business`), así que se inserta sólo
    -- si el negocio todavía no tiene una principal.
    IF NOT EXISTS (
        SELECT 1 FROM business_locations
         WHERE business_id = v_business AND is_primary
    ) THEN
        INSERT INTO business_locations (
            organization_id, business_id, label, address_line, city, region,
            country, postal_code, is_primary
        )
        VALUES (
            v_org, v_business,
            coalesce(p_location->>'label', 'Main'),
            coalesce(p_location->>'address_line', ''),
            coalesce(p_location->>'city', ''),
            coalesce(p_location->>'region', ''),
            coalesce(p_location->>'country', ''),
            coalesce(p_location->>'postal_code', ''),
            true
        );
    END IF;

    -- ── 4. El contacto ────────────────────────────────────────────────────
    -- La unicidad de la 0018 es `(organization_id, lower(email)) WHERE email <> ''`,
    -- así que un correo vacío NO colisiona con otro vacío — «no se sabe» dos
    -- veces no es la misma persona. Por eso el ON CONFLICT sólo puede dispararse
    -- cuando hay correo, y ahí actualizar es lo correcto: es la misma persona con
    -- datos más frescos.
    INSERT INTO contacts (
        organization_id, business_id, display_name, email, phone, website, city,
        country, source
    )
    VALUES (
        v_org, v_business,
        coalesce(p_contact->>'display_name', ''),
        coalesce(p_contact->>'email', ''),
        coalesce(p_contact->>'phone', ''),
        coalesce(p_contact->>'website', ''),
        coalesce(p_location->>'city', ''),
        coalesce(p_location->>'country', ''),
        coalesce(p_contact->>'source', '')
    )
    ON CONFLICT (organization_id, lower(email)) WHERE email <> ''
    DO UPDATE SET
        display_name = excluded.display_name,
        phone        = excluded.phone,
        website      = excluded.website,
        source       = excluded.source,
        updated_at   = now();

    -- ── 5. Y AL FINAL la clave ────────────────────────────────────────────
    -- Todo lo de arriba ya ocurrió. Si esta clave ya estaba, este INSERT levanta
    -- `23505` sobre `ingest_events_source_key`, el handler de abajo lo atrapa, y
    -- la subtransacción entera vuelve atrás: la organización, el negocio, la
    -- location y el contacto que acabamos de escribir desaparecen con ella.
    --
    -- Ése es todo el diseño. Al revés —reclamar primero— haría falta un
    -- `organization_id` nullable, y el bloque 12 de la suite lo rechaza.
    INSERT INTO ingest_events (source_system, idempotency_key, event, organization_id)
    VALUES (p_source_system, p_idempotency_key, 'lead.won', v_org);

    RETURN jsonb_build_object('organization_id', v_org, 'business_id', v_business, 'duplicate', false);

EXCEPTION WHEN unique_violation THEN
    -- QUÉ unicidad, y no «alguna». Las dos significan cosas distintas y
    -- contestarlas igual sería el defecto que este proyecto persigue en todas
    -- sus formas: la respuesta correcta por el motivo equivocado.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;

    IF v_constraint = 'ingest_events_source_key' THEN
        -- Entrega repetida. No es un error: es la promesa cumpliéndose.
        RETURN jsonb_build_object('organization_id', NULL, 'business_id', NULL, 'duplicate', true);
    END IF;

    -- Cualquier otra colisión es un problema de verdad y sube. Tragarla acá
    -- convertiría, por ejemplo, dos organizaciones peleando el mismo slug en un
    -- «ya estaba», y el cliente nunca se crearía.
    RAISE;
END
$fn$;

COMMENT ON FUNCTION public.ingest_lead_won(text, text, uuid, text, text, text, text, text, text, text, jsonb, jsonb) IS
    'La ingesta de un lead ganado, entera, en UNA transacción. La clave de idempotencia se reclama AL FINAL: un reintento hace el trabajo y vuelve atrás con él.';

-- Sólo el servidor. Una función SECURITY DEFINER alcanzable desde el navegador es
-- una manera de saltear la RLS con más pasos.
--
-- Y `FROM PUBLIC` NO ALCANZA, que es la trampa de la tabla nueva aplicada a las
-- funciones. Los default privileges que Supabase deja puestos otorgan `EXECUTE`
-- a `anon`, `authenticated` y `service_role` POR NOMBRE, y un REVOKE a PUBLIC no
-- toca una concesión nominal. Medido acá el 2026-08-30: con sólo el
-- `FROM PUBLIC`, los tres roles seguían pudiendo ejecutarla.
--
-- Se revoca a los tres y después se otorga al único que la necesita.
REVOKE ALL ON FUNCTION public.ingest_lead_won(text, text, uuid, text, text, text, text, text, text, text, jsonb, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingest_lead_won(text, text, uuid, text, text, text, text, text, text, text, jsonb, jsonb) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0019_ingest_lead_won')
ON CONFLICT (version) DO NOTHING;
