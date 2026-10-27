-- Revierte la 0036.
--
-- QUÉ SE REABRE
--
-- Que un admin activo escriba membresías owner de su organización. Sin las tres
-- restrictivas vuelve lo medido el 2026-10-23: la admin de A se sube a owner
-- (`UPDATE` de su fila), suma owners nuevos, y degrada, archiva o desarchiva al
-- owner que la sumó. `members_owner_write` (0013) sigue siendo la única que
-- decide quién escribe `org_members`, y mira sólo si quien llama es admin.
--
-- QUÉ NO TOCA
--
-- Los datos. La 0036 no agrega ninguna restricción sobre las filas: todo lo que
-- se escribió con ella puesta es una fila válida para la 0013. Si con la 0036
-- puesta un owner dio owners, esos owners siguen siéndolo después del .down,
-- como cualquier otra membresía.
--
-- Ni `members_owner_write`, ni las restrictivas `org_members_role_*` de la 0031,
-- ni `handle_new_user()` ni `create_client_organization()`: la 0036 no los
-- cambia, así que no hay nada que devolver.
--
-- EL ORDEN: las policies antes que su función. `DROP FUNCTION` sin CASCADE falla
-- nombrando la dependencia si alguna otra policy la usa, que es lo que tiene que
-- pasar.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "org_members_owner_insert" ON public.org_members;
DROP POLICY IF EXISTS "org_members_owner_update" ON public.org_members;
DROP POLICY IF EXISTS "org_members_owner_delete" ON public.org_members;

DROP FUNCTION IF EXISTS public.current_user_owner_org_ids();

DELETE FROM public.schema_migrations WHERE version = '0036_owner_grants_owner';

COMMIT;
