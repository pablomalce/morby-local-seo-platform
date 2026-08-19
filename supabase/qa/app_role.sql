-- The role the assertions run as.
--
-- The application must never connect as the owner. A superuser bypasses RLS
-- unconditionally, and the table owner is exempt anywhere FORCE is missing.
-- Asserting isolation as either of them would be asserting nothing — which is
-- exactly what defect 6 is about.
--
-- Used by both supabase/qa/replica.sh and the schema job in CI.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'growthos_app') THEN
        CREATE ROLE growthos_app LOGIN PASSWORD 'growthos' NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public, auth TO growthos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO growthos_app;
GRANT SELECT ON auth.users TO growthos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO growthos_app;
