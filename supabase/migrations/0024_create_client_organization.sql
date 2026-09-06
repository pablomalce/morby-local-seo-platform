-- 0024_create_client_organization.sql — dar de alta un cliente deja de ser imposible.
--
-- QUÉ CIERRA
--
-- Que una agencia no pueda crear la organización de un cliente desde la
-- aplicación. Medido sobre `pg_policies` el 2026-09-06:
--
--   organizations   SELECT si sos miembro, UPDATE si sos owner/admin. NINGUNA de INSERT
--   org_members     escribir exige ser ya admin/owner DE ESA organización
--
-- O sea el huevo y la gallina: no se puede crear la organización porque no hay
-- política de INSERT, y no se puede crear la membresía porque para eso habría que
-- ser ya admin de una organización que todavía no existe. Con RLS puesta y sin
-- política permisiva, `authenticated` simplemente no puede.
--
-- Lo único que inserta en `organizations` hoy es el trigger de la `0001`, y no
-- sirve para esto: cuelga de `auth.users`, corre UNA vez al registrarse alguien, y
-- crea su organización PERSONAL. No hay manera de invocarlo para un cliente.
--
-- Y eso contradice el propósito del producto, que es de agencia: un cliente es su
-- propia organización, porque `integration_properties` es UNIQUE por
-- `(organization_id, provider)` y una property pertenece a una sola organización.
-- Sin esta función, la plataforma sólo puede atender a la organización con la que
-- nació.
--
-- POR QUÉ `SECURITY DEFINER` ACÁ SÍ AGREGA UNA CAPACIDAD
--
-- La regla de este proyecto dice: antes de prestar privilegios, medí los que ya
-- hay — `SECURITY DEFINER` sobre un rol que ya tenía todo lo necesario no agrega
-- una capacidad, agrega un préstamo. Acá se midió, y `authenticated` NO puede
-- insertar en `organizations` de ninguna manera. Es una capacidad nueva.
--
-- POR QUÉ UNA FUNCIÓN Y NO DOS INSERTS DESDE LA APLICACIÓN
--
-- Porque tienen que ser UNA transacción. Una organización creada sin su membresía
-- no tiene dueño y **nadie puede volver a alcanzarla**: no aparece en
-- `current_user_org_ids()`, así que ni su creador la ve. Sería basura permanente
-- que sólo `service_role` podría limpiar.
--
-- Y porque la regla vive en la base: una ruta de la aplicación se saltea llamando
-- a PostgREST, y esta función no.
--
-- LA GUARDA QUE HACE QUE ESTO NO SEA UN AGUJERO
--
-- La membresía se crea SIEMPRE para `auth.uid()`. La función no recibe un usuario
-- y no lo acepta: quien llama no puede crear una organización a nombre de otro ni
-- meterse en una ajena. Es la única línea que separa «dar de alta un cliente» de
-- «fabricarse membresías».

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.create_client_organization(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_user uuid := auth.uid();
    v_base text;
    v_slug text;
    v_n    int := 0;
    v_org  uuid;
BEGIN
    -- Sin sesion no hay a quien hacer dueno. Falla en vez de crear una
    -- organizacion huerfana, que es lo que esta funcion existe para impedir.
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'create_client_organization requiere una sesion'
            USING ERRCODE = '28000';
    END IF;

    IF coalesce(btrim(p_name), '') = '' THEN
        RAISE EXCEPTION 'el nombre de la organizacion no puede estar vacio'
            USING ERRCODE = '22023';
    END IF;

    -- El mismo slug que arma el trigger de alta de usuario, y por el mismo
    -- motivo: `slug` es UNIQUE y un choque abortaria la transaccion entera.
    v_base := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
    v_base := regexp_replace(v_base, '(^-|-$)', '', 'g');
    IF v_base = '' THEN
        -- Un nombre de puros simbolos deja el slug vacio, y '' chocaria con el
        -- siguiente nombre de puros simbolos.
        v_base := 'organizacion';
    END IF;

    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) LOOP
        v_n := v_n + 1;
        v_slug := v_base || '-' || v_n::text;
    END LOOP;

    INSERT INTO public.organizations (name, slug)
    VALUES (btrim(p_name), v_slug)
    RETURNING id INTO v_org;

    -- SIEMPRE `v_user`. Ver el encabezado: es la linea que impide fabricar
    -- membresias ajenas.
    INSERT INTO public.org_members (organization_id, user_id, role, state)
    VALUES (v_org, v_user, 'owner', 'active');

    RETURN v_org;
END
$fn$;

COMMENT ON FUNCTION public.create_client_organization(text) IS
    'Crea una organizacion y la membresia owner de quien llama, en una transaccion. La membresia es siempre de auth.uid().';

-- En Supabase una funcion nueva NACE ejecutable por todos. Se revoca y se concede
-- a mano, igual que la 0021.
REVOKE ALL ON FUNCTION public.create_client_organization(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_client_organization(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_client_organization(text) TO authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('0024_create_client_organization')
ON CONFLICT (version) DO NOTHING;
