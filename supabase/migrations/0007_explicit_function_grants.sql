-- 0007_explicit_function_grants.sql — los GRANT que hosted tiene y el repo no.
--
-- QUÉ CIERRA
--
-- Supabase otorga EXECUTE sobre las funciones de `public` a sus tres roles.
-- Ninguna migración de este repositorio lo hace, así que la réplica local sólo
-- las tenía alcanzables vía PUBLIC — el mismo acceso efectivo, distinto
-- catálogo. Medido con supabase/qa/schema_fingerprint.sql contra las dos bases:
--
--   local    execute current_user_org_ids  =X/postgres postgres=X/postgres
--   hosted   execute current_user_org_ids  =X/postgres postgres=X/postgres
--                                          anon=X/postgres authenticated=X/postgres
--                                          service_role=X/postgres
--
-- y lo mismo en las otras tres. Era la única deriva entre el repositorio y
-- `tpqiltnskfeycnybczgz` además de la 0006, que a la fecha de este archivo
-- sigue sin aplicarse allá.
--
-- POR QUÉ IMPORTA SI EL ACCESO EFECTIVO ES EL MISMO
--
-- Porque el día que a alguna de estas funciones haya que revocarle el EXECUTE a
-- `anon`, hacerlo no va a cambiar nada mientras PUBLIC lo tenga, y la
-- comprobación de que se cerró va a pasar en verde sin haber cerrado nada. Eso
-- no es hipotético: pasó en Lead Engine, donde tres bloques de su suite de
-- aislamiento eran infalsificables por exactamente este motivo, y lo encontró
-- una mutación y no una lectura.
--
-- Reproducir el catálogo real es lo que mantiene esa clase de comprobación
-- falsable.
--
-- Sobre hosted esto es un no-op: los grants ya están. Sobre la réplica local y
-- sobre cualquier base nueva, iguala.

\set ON_ERROR_STOP on

GRANT EXECUTE ON FUNCTION public.current_user_org_ids()               TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fill_organization_id_from_business() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user()                    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at()                     TO anon, authenticated, service_role;
