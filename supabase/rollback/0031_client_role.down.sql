-- Revierte la 0031.
--
-- QUÉ SE PIERDE
--
-- Que el rol signifique algo en la base. Sin el eje, vuelve lo que se midió en
-- hosted el 2026-10-07: cualquier miembro activo de una organización —un
-- `viewer` incluido— escribe y borra todo lo de ella por PostgREST, y nada
-- separa lo interno de lo que ve el cliente. Las rutas siguen pidiendo rol
-- (`src/lib/org/rol.ts`), pero PostgREST no pasa por ellas.
--
-- Y POR ESO SE NIEGA A CORRER MIENTRAS EXISTA UNA MEMBRESÍA `client`. Por dos
-- motivos, y el segundo es el que importa:
--
--   * el CHECK de la 0001 no admite el rol, así que restaurarlo fallaría igual,
--     sólo que con un mensaje que no dice qué hacer;
--   * sin el eje, una membresía `client` ACTIVA quedaría escribiendo y leyendo
--     lo interno como cualquier miembro. Revertir esto con clientes adentro es
--     darles a los clientes todo lo que la 0031 les sacó.
--
-- El camino, con clientes: archivarlos primero —una membresía archivada no ve
-- nada desde la 0013— y recién ahí cambiarles el rol a uno que el CHECK viejo
-- acepte. En ese orden, y en una sola sentencia para que no haya un instante con
-- un `viewer` activo que antes era un cliente:
--
--     UPDATE public.org_members SET state = 'archived', role = 'viewer'
--      WHERE role = 'client';
--
-- Es una decisión de producto y no la toma este archivo: por eso se niega en vez
-- de hacerlo él.
--
-- EL ORDEN IMPORTA
--
-- Las policies antes que las funciones que nombran: una policy depende de las
-- funciones de su expresión, y `DROP FUNCTION` sin CASCADE falla nombrándola, que
-- es lo que tiene que pasar si alguien agregó otra policy que las use. El CHECK
-- al final, con el mismo nombre y la lista de la 0001 en el mismo orden: así la
-- huella vuelve byte por byte.
--
-- Las policies se buscan por NOMBRE en todo `public`, no por la consulta de la
-- 0031: si una tabla perdió `organization_id` o la RLS después, su eje igual se
-- va.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- El lock antes de contar, para que nadie dé de alta un cliente entre que se
-- miró y que se revirtió.
LOCK TABLE public.org_members IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    clientes int;
BEGIN
    SELECT count(*) INTO clientes FROM public.org_members WHERE role = 'client';
    IF clientes > 0 THEN
        RAISE EXCEPTION
            'La vuelta atrás de la 0031 se niega: hay % membresía(s) con rol client. Sin el eje, '
            'quedarían escribiendo y leyendo lo interno. Archivarlas primero (ver el encabezado de '
            'este archivo) y correrlo de nuevo.', clientes
            USING ERRCODE = 'P0001';
    END IF;
END
$$;

DO $$
DECLARE
    p record;
BEGIN
    FOR p IN
        SELECT pol.polname, c.relname
          FROM pg_policy pol
          JOIN pg_class c ON c.oid = pol.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
         WHERE pol.polname IN (c.relname || '_role_insert', c.relname || '_role_update',
                               c.relname || '_role_delete', c.relname || '_role_read')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', p.polname, p.relname);
    END LOOP;
END
$$;

DROP POLICY IF EXISTS "content_assets_approver_insert" ON public.content_assets;
DROP POLICY IF EXISTS "content_assets_approver_update" ON public.content_assets;
DROP POLICY IF EXISTS "content_assets_approver_delete" ON public.content_assets;

DROP FUNCTION IF EXISTS public.is_internal_surface(text);
DROP FUNCTION IF EXISTS public.current_user_approver_org_ids();
DROP FUNCTION IF EXISTS public.current_user_staff_org_ids();
DROP FUNCTION IF EXISTS public.current_user_writer_org_ids();

ALTER TABLE public.org_members DROP CONSTRAINT IF EXISTS org_members_role_check;
ALTER TABLE public.org_members ADD CONSTRAINT org_members_role_check
    CHECK (role IN ('owner', 'admin', 'manager', 'editor', 'viewer'));

DELETE FROM public.schema_migrations WHERE version = '0031_client_role';

COMMIT;
