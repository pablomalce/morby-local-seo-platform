-- 0013_org_member_archive.down.sql — la vuelta atrás de la 0013.
--
-- QUÉ DESHACE, y en qué orden. El inverso exacto de las cuatro piezas de la
-- migración, recorridas al revés, porque hay dependencias entre ellas: la policy
-- nombra a `current_user_admin_org_ids()`, así que la función no se puede tirar
-- antes de que la policy deje de nombrarla; y las dos funciones leen `state`,
-- así que la columna no se puede tirar antes que ellas.
--
-- UNA ADVERTENCIA QUE NO ES UN DEFECTO DE ESTE ARCHIVO
--
-- Volver atrás restaura `members_owner_write` tal como la escribió la 0001, y esa
-- policy ESTÁ ROTA: su subconsulta lee org_members desde una policy sobre
-- org_members y recursa —`infinite recursion detected in policy for relation
-- "org_members"`—. La 0013 lo documenta y lo arregla.
--
-- Se restaura igual, rota y todo, porque eso es lo que significa volver atrás: el
-- esquema queda como estaba, no como uno querría que hubiera estado. Un .down que
-- "aprovecha" para dejar algo mejor que el original hace que la huella no
-- coincida y, peor, deja una base que no es ninguna de las dos versiones. Si
-- hace falta volver atrás de verdad, el bug de recursión vuelve con el resto, y
-- hoy no lo ejercita nadie: todo lo que escribe org_members corre exento de RLS.
--
-- LO QUE ESTE .down NO PUEDE DEVOLVER
--
-- Los datos. Al tirar la columna `state` se pierde qué membresías estaban
-- archivadas, y volver a aplicar la 0013 las trae todas de vuelta como 'active'
-- —el DEFAULT—, o sea con acceso restituido. `schema_fingerprint.sql` compara
-- objetos del esquema y no puede ver eso. Antes de usar este .down sobre una base
-- con membresías archivadas: guardar `(organization_id, user_id, state)`.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El DELETE que la 0013 revocó
-- ─────────────────────────────────────────────────────────────────────────────
-- SÓLO a `authenticated`, aunque la 0013 revoque "FROM anon, authenticated".
--
-- El .down no es el REVOKE de la migración con la palabra cambiada, y acá se ve
-- por qué: `anon` NUNCA tuvo DELETE. La 0010 se lo da a `authenticated` en su
-- línea 56 y se lo saca a `anon` en la 62, sobre ALL TABLES. O sea que el REVOKE
-- de la 0013 es un no-op para `anon`, y devolvérselo le otorgaría un privilegio
-- que esa base no tenía antes de la migración.
--
-- Y no se dedujo leyendo: la primera versión de este archivo decía
-- `TO anon, authenticated` y `rollback.sh` la rechazó con la diferencia exacta
-- —`conteo grants: 255` antes, `256` después, `grant org_members anon DELETE` de
-- más—. Es literalmente para lo que existe el script.
GRANT DELETE ON public.org_members TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La policy de escritura, como la dejó la 0001
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "members_owner_write" ON public.org_members;
CREATE POLICY "members_owner_write" ON public.org_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.organization_id = org_members.organization_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin')
    )
  );

-- Ahora que nadie la nombra. `DROP FUNCTION` se lleva sus grants con ella.
DROP FUNCTION IF EXISTS public.current_user_admin_org_ids();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El resolutor, sin el filtro de estado
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE y no DROP: de esta función cuelga toda la RLS del esquema, y
-- tirarla obligaría a recrear cada policy que la nombra. El cuerpo vuelve a ser
-- textualmente el de la 0001 — importa que sea textual, porque PostgreSQL guarda
-- el cuerpo de una función tal cual y la huella lo compara así.
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS setof uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select organization_id
  from public.org_members
  where user_id = auth.uid();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna y su CHECK
-- ─────────────────────────────────────────────────────────────────────────────
-- La restricción primero: tirar la columna se la llevaría puesta igual, pero
-- decirlo explícito deja el archivo legible como el inverso de la migración.
ALTER TABLE public.org_members DROP CONSTRAINT IF EXISTS org_members_state_check;
ALTER TABLE public.org_members DROP COLUMN IF EXISTS state;

-- ─────────────────────────────────────────────────────────────────────────────
-- El registro
-- ─────────────────────────────────────────────────────────────────────────────
-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás. Es la mentira silenciosa por la que existe el
-- job de deriva.
DELETE FROM public.schema_migrations WHERE version = '0013_org_member_archive';
