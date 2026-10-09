-- Revierte la 0033.
--
-- QUÉ SE REABRE
--
-- Que la firma de un sello la elija quien escribe. Sin el trigger vuelve lo
-- medido el 2026-10-09: quien aprueba en X sella por PostgREST a nombre de
-- cualquier usuario —el client de X, otro manager— y con la hora que quiera, y
-- re-firma o atrasa un sello vigente de otro. `/api/content/approve` sigue
-- mandando `approved_by: user.id`, así que lo que escribe la ruta sigue siendo
-- correcto; la hora vuelve a ser la del servidor de Next y no la de la base.
--
-- QUÉ NO TOCA
--
-- Los datos. Toda firma que se escribió con la 0033 puesta es una fila válida
-- para el CHECK de la 0015 sin el trigger: un uid y una hora. No hay nada que
-- deshacer en las filas.
--
-- Ni el USAGE sobre el esquema `auth` que `supabase/qa/auth_stub.sql` le da a
-- las sesiones: es de la réplica, no de una migración —en hosted lo pone
-- Supabase—, y sacarlo volvería a la réplica más estricta que producción.
--
-- EL ORDEN: el trigger antes que su función. `DROP FUNCTION` sin CASCADE falla
-- nombrando la dependencia si alguien colgó otro trigger de la misma función,
-- que es lo que tiene que pasar.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_content_assets_seal_signer ON public.content_assets;
DROP FUNCTION IF EXISTS public.content_assets_seal_signer();

DELETE FROM public.schema_migrations WHERE version = '0033_seal_is_signed_by_sealer';

COMMIT;
