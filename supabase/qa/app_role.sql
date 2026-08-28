-- The role the assertions run as.
--
-- The application must never connect as the owner. A superuser bypasses RLS
-- unconditionally, and the table owner is exempt anywhere FORCE is missing.
-- Asserting isolation as either of them would be asserting nothing — which is
-- exactly what defect 6 is about.
--
-- NOLOGIN and no password, on purpose. Everything that uses this role reaches
-- it through SET ROLE from a connection that already exists — supabase/qa/
-- defects_test.sql and the schema job in CI both do. Nothing here needs a
-- connection of its own, so granting one would only add an account with a
-- password to every database this file is ever applied to. Check 11 of
-- defects_test.sql is what keeps that true.
--
-- To poke around as the application role, connect as the owner and drop into
-- it:  psql -U postgres -d growthos  then  SET ROLE growthos_app;
--
-- Used by both supabase/qa/replica.sh and the schema job in CI.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'growthos_app') THEN
        CREATE ROLE growthos_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

-- Corrective, not decorative. An earlier version of this file created the role
-- with LOGIN and the password 'growthos', so on any database where that one ran
-- the CREATE above is skipped and the account stays reachable over the network.
-- This is the line that closes it. Attributes that need superuser — SUPERUSER,
-- BYPASSRLS — are deliberately left to the CREATE: naming them here would abort
-- the file on Supabase, where the owner is not a superuser.
ALTER ROLE growthos_app NOLOGIN PASSWORD NULL;

-- Que quien aplica esto pueda entrar en el rol. Un superusuario hace SET ROLE a
-- cualquiera sin pedir permiso, y por eso esta línea no hacía falta mientras la
-- réplica corría sobre `postgres:17`, donde el dueño ERA superusuario. Sobre la
-- imagen de Supabase —y en hosted— `postgres` no lo es, y la primera corrida
-- murió en la línea 110 de defects_test.sql con
-- `permission denied to set role "growthos_app"`.
--
-- Desde PostgreSQL 16 la pertenencia a un rol y el derecho a ENTRAR en él son
-- dos cosas distintas, así que `WITH SET TRUE` no es adorno: sin eso la
-- pertenencia sola no habilita el SET ROLE.
--
-- Es una diferencia que el superusuario escondía, no una que aparezca ahora.
--
-- Y el rol se NOMBRA, no se escribe `CURRENT_USER`. La primera versión de esta
-- línea decía `TO CURRENT_USER` y **voltea el servidor**:
--
--     GRANT probe_role TO CURRENT_USER WITH SET TRUE;
--     server closed the connection unexpectedly
--     FATAL:  the database system is in recovery mode
--
-- Reproducido el 2026-08-28 en dos líneas sobre un contenedor limpio de
-- supabase/postgres:17.4.1.075, sin nada de este esquema puesto. Con el nombre
-- escrito, `GRANT ... TO postgres WITH SET TRUE`, funciona y el SET ROLE
-- después anda. `postgres` es el dueño acá y en hosted, así que nombrarlo no
-- pierde generalidad.
GRANT growthos_app TO postgres WITH SET TRUE;

GRANT USAGE ON SCHEMA public, auth TO growthos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO growthos_app;

-- Y lo que la aplicación NO tiene, este rol tampoco. Desde la 0013 ni `anon` ni
-- `authenticated` pueden borrar una membresía: la baja archiva. El GRANT de
-- arriba es sobre ALL TABLES y se la devolvería, y entonces la suite estaría
-- midiendo un rol que no existe en producción — el chequeo 17 pasaría en verde
-- por tener un privilegio de más, que es la peor manera de pasar.
--
-- Este REVOKE hay que aplicarlo también a hosted a mano, y no lo dice la huella:
-- `schema_fingerprint.sql` filtra los grants de tabla a
-- ('anon','authenticated','service_role'), así que un privilegio de growthos_app
-- que sobre en la base es invisible para el job de deriva. Medido el
-- 2026-08-21: hosted tenía el DELETE y la comparación daba verde igual.
REVOKE DELETE ON public.org_members FROM growthos_app;
GRANT SELECT ON auth.users TO growthos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO growthos_app;
