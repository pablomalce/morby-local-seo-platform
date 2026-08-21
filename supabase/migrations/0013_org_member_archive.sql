-- 0013_org_member_archive.sql — la baja de un miembro archiva, no borra.
--
-- QUÉ CIERRA
--
-- §5.4 del prompt maestro, la última decisión de producto que quedaba abierta.
-- Decidida el 2026-08-21: **archiva, como todas las demás tablas**. El canónico
-- la tomó primero (PR #33 de Vulkan OS, §11.2c de ESQUEMA_CANONICO.md); esto es
-- el mismo cambio en el despliegue que tiene usuarios.
--
-- Por qué archivar y no borrar, en orden de peso: `org_members` no guarda datos
-- personales sino una arista `(organization_id, user_id, role)` —el nombre y el
-- correo viven en el proveedor de identidad—, así que borrar la fila no cumple
-- un pedido de borrado y sí destruye lo único que permite auditar qué hizo esa
-- persona mientras tuvo acceso.
--
-- UNA CORRECCIÓN, MEDIDA CONTRA HOSTED
--
-- §5.4 daba por sentado que ningún rol de aplicación tiene DELETE. Es cierto del
-- DDL canónico y **falso acá**: medido sobre tpqiltnskfeycnybczgz, `authenticated`
-- y `growthos_app` tienen DELETE sobre org_members, porque la 0010 lo otorga
-- sobre ALL TABLES. Con la policy `members_owner_write` siendo FOR ALL, el
-- borrado duro ya era posible hoy. Esta migración lo cierra.
--
-- Lo único que borra membresías en el código es el borrado de cuenta propia
-- (`deleteMyAccount` en src/lib/auth/account-actions.ts), y corre con
-- `service_role`, que conserva el privilegio. Verificado por la vía real: es la
-- única llamada a `.delete()` sobre esta tabla en todo `src/`.
--
-- LAS TRES PIEZAS, Y NINGUNA ALCANZA SOLA
--
-- 1. La columna. Sin ella no hay dónde anotar la baja.
-- 2. El resolutor. `current_user_org_ids()` es lo que traduce una membresía en
--    acceso; sin `state = 'active'` la columna sería una anotación que nadie
--    lee y archivar no cortaría nada.
-- 3. La policy de escritura. `members_owner_write` decide quién puede tocar
--    org_members, y su subconsulta no miraba el estado: sin este cambio, un
--    owner archivado seguía pudiendo dar de alta y de baja a cualquiera.
--
-- La tercera no estaba en el plan y apareció leyendo la policy. Es la que
-- convierte "archivé al owner" en algo más que un adorno.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna
-- ─────────────────────────────────────────────────────────────────────────────
-- NOT NULL con DEFAULT: las membresías que ya existan quedan 'active', que es
-- lo que eran.
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'active';

-- ADD CONSTRAINT no tiene IF NOT EXISTS, así que se pregunta por el catálogo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.org_members'::regclass
                    AND conname = 'org_members_state_check') THEN
    ALTER TABLE public.org_members ADD CONSTRAINT org_members_state_check
      CHECK (state IN ('active', 'archived'));
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El resolutor
-- ─────────────────────────────────────────────────────────────────────────────
-- Esta función es de la que cuelga TODA la RLS del esquema: cada policy filtra
-- por `organization_id in (select current_user_org_ids())`. Agregarle el filtro
-- de estado es lo que hace que archivar corte el acceso, y no hace falta tocar
-- una sola policy.
--
-- Sigue siendo SECURITY DEFINER por el motivo de siempre: la consulta a
-- org_members no puede quedar sujeta a la RLS de org_members, o recursa.
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS setof uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
    FROM public.org_members
   WHERE user_id = auth.uid()
     AND state = 'active';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La policy de escritura de owners y admins
-- ─────────────────────────────────────────────────────────────────────────────
-- Dos cosas, y la segunda no estaba en el plan.
--
-- La que se venía a arreglar: la policy preguntaba si quien llama es owner o
-- admin de esa organización, sin mirar si esa membresía sigue vigente. Un owner
-- archivado conservaba el poder de administrar miembros, incluido el de
-- desarchivarse a sí mismo.
--
-- LA QUE APARECIÓ AL MEDIRLA: la policy **nunca funcionó**. Su subconsulta lee
-- org_members desde una policy sobre org_members, y eso recursa:
--
--     ERROR:  infinite recursion detected in policy for relation "org_members"
--
-- No lo había visto nadie porque nunca se ejercitó. Todo lo que escribe esa
-- tabla hoy lo hace exento de RLS: el fixture de la suite corre como dueño y
-- `handle_new_user()` es SECURITY DEFINER. La aplicación no administra miembros
-- todavía, así que el día que agregue esa pantalla se habría encontrado con un
-- error que no nombra su causa.
--
-- La lección estaba escrita diez líneas más arriba en la 0001, en el comentario
-- de `current_user_org_ids()`: la consulta a org_members no puede quedar sujeta
-- a la RLS de org_members. Vale para el resolutor y vale igual para esto, así
-- que se resuelve del mismo modo — una función SECURITY DEFINER, que corre como
-- su dueño y no vuelve a evaluar la policy.
CREATE OR REPLACE FUNCTION public.current_user_admin_org_ids()
RETURNS setof uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
    FROM public.org_members
   WHERE user_id = auth.uid()
     AND role IN ('owner', 'admin')
     AND state = 'active';
$$;

-- Se otorga explícitamente, como hace la 0007 con las demás: `CREATE FUNCTION`
-- le da EXECUTE a PUBLIC, y depender de eso es depender de un default.
REVOKE ALL ON FUNCTION public.current_user_admin_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_admin_org_ids()
  TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "members_owner_write" ON public.org_members;
CREATE POLICY "members_owner_write" ON public.org_members
  FOR ALL USING (
    organization_id IN (SELECT public.current_user_admin_org_ids())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Sin borrado duro
-- ─────────────────────────────────────────────────────────────────────────────
-- Misma forma que el REVOKE de schema_migrations en la 0010: va DESPUÉS del
-- `GRANT ... ON ALL TABLES` de aquella, que es quien lo había otorgado.
--
-- `service_role` lo conserva: el borrado de cuenta propia lo necesita, y es una
-- operación deliberada de retención, no el ciclo de vida normal de un miembro.
REVOKE DELETE ON public.org_members FROM anon, authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('0013_org_member_archive')
ON CONFLICT (version) DO NOTHING;
