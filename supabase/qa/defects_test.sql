-- Five live isolation defects in the Growth OS schema — executable.
--
--   ./supabase/qa/replica.sh
--   docker exec -i growthos-replica psql -U postgres -d growthos \
--       -v ON_ERROR_STOP=1 -f /tmp/defects_test.sql
--
-- Every one of these was found by reading the DDL. Reading is how you find a
-- defect; running is how you prove it. Until this file existed, all five were
-- assertions.
--
-- The file is written to FAIL against the schema as it stands today, and to
-- pass once the schema stops permitting each thing. It reports every defect it
-- finds in one run instead of aborting on the first, because five defects found
-- one session at a time is five sessions.
--
-- Each block says WHAT IT PREVENTS. If the schema stops preventing it, the
-- block goes green and the report shrinks.
--
-- Runs as postgres and drops to growthos_app for every assertion. That matters
-- more here than usual: defect 5 is precisely that the owner is exempt from
-- every policy, so asserting isolation as the owner would assert nothing.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE defect_report (
    num      int  PRIMARY KEY,
    name     text NOT NULL,
    present  boolean NOT NULL,
    evidence text NOT NULL
) ON COMMIT DROP;

-- The assertions run as growthos_app, so the report they write into has to be
-- writable by it. Owned by postgres and readable only by postgres would mean
-- every INSERT below fails for the wrong reason.
GRANT ALL ON defect_report TO growthos_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixtures — two tenants that must never see each other
-- ─────────────────────────────────────────────────────────────────────────────
-- Users are inserted into auth.users, which fires handle_new_user() and gives
-- each one an organization and an owner membership. That trigger is the real
-- signup path, so the fixtures exercise it rather than working around it.

INSERT INTO auth.users (id, email) VALUES
    ('11111111-1111-4111-8111-111111111111', 'alice@example.test'),
    ('22222222-2222-4222-8222-222222222222', 'bob@example.test');

CREATE TEMP TABLE t AS
SELECT
    (SELECT organization_id FROM org_members
      WHERE user_id = '11111111-1111-4111-8111-111111111111') AS org_alice,
    (SELECT organization_id FROM org_members
      WHERE user_id = '22222222-2222-4222-8222-222222222222') AS org_bob;

GRANT SELECT ON t TO growthos_app;

INSERT INTO businesses (id, organization_id, name)
SELECT '33333333-3333-4333-8333-333333333333', org_alice, 'Alice Co' FROM t;
INSERT INTO businesses (id, organization_id, name)
SELECT '44444444-4444-4444-8444-444444444444', org_bob, 'Bob Co' FROM t;

INSERT INTO business_services (id, business_id, slug, name) VALUES
    ('55555555-5555-4555-8555-555555555555',
     '44444444-4444-4444-8444-444444444444', 'bob-service', 'Bob Service');

-- Becoming alice, as the application role.
CREATE OR REPLACE FUNCTION pg_temp.be(p_user uuid) RETURNS void
LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claim.sub', p_user::text, true);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The log has a branch with no tenant
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: a row written by one organization being readable by every
-- other one. The policy reads `organization_id IS NULL OR ...`, so a NULL
-- tenant satisfies it for everybody. This is a leak, and it violates R1.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

INSERT INTO activity_logs (id, organization_id, scope, scope_id, action)
VALUES ('66666666-6666-4666-8666-666666666666', NULL, 'business',
        '33333333-3333-4333-8333-333333333333', 'alice.secret.action');

SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');

INSERT INTO defect_report
SELECT 1, 'activity_logs: tenant-less rows are readable by every organization',
       count(*) > 0,
       'bob reads ' || count(*) || ' of alice''s tenant-less log rows'
FROM activity_logs WHERE id = '66666666-6666-4666-8666-666666666666';

-- Same shape, same policy, different table.
SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');
INSERT INTO agent_runs (id, business_id, agent_id, scope, scope_id)
VALUES ('77777777-7777-4777-8777-777777777777', NULL, 'seo-agent', 'business',
        '33333333-3333-4333-8333-333333333333');

SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');

INSERT INTO defect_report
SELECT 2, 'agent_runs: business-less rows are readable by every organization',
       count(*) > 0,
       'bob reads ' || count(*) || ' of alice''s business-less runs'
FROM agent_runs WHERE id = '77777777-7777-4777-8777-777777777777';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A resource can be linked to another tenant's resource
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: a content asset of one tenant pointing at a service of
-- another. The policy filters by business_id and never looks at service_id, and
-- no constraint ties the two to the same tenant.

SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

DO $$
DECLARE
    ok boolean := false;
BEGIN
    BEGIN
        INSERT INTO content_assets (id, business_id, service_id, kind, body)
        VALUES ('88888888-8888-4888-8888-888888888888',
                '33333333-3333-4333-8333-333333333333',   -- alice's business
                '55555555-5555-4555-8555-555555555555',   -- BOB's service
                'page', 'body');
        ok := true;
    EXCEPTION WHEN OTHERS THEN
        ok := false;
    END;

    INSERT INTO defect_report VALUES (
        3, 'content_assets: service_id may point at another tenant''s service',
        ok,
        CASE WHEN ok
             THEN 'alice linked her asset to bob''s service and the write was accepted'
             ELSE 'the write was rejected' END);
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. N primary locations at once
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: more than one location per business claiming to be the
-- primary one. is_primary defaults to true and nothing restricts it, so the
-- code ends up picking whichever row the query returns first — which is not a
-- decision, it is an accident.

INSERT INTO business_locations (id, business_id, label) VALUES
    ('99999999-9999-4999-8999-999999999991',
     '33333333-3333-4333-8333-333333333333', 'One'),
    ('99999999-9999-4999-8999-999999999992',
     '33333333-3333-4333-8333-333333333333', 'Two');

INSERT INTO defect_report
SELECT 4, 'business_locations: several locations can be primary at once',
       count(*) > 1,
       count(*) || ' locations of one business have is_primary = true'
FROM business_locations
WHERE business_id = '33333333-3333-4333-8333-333333333333' AND is_primary;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Children migrate tenant in silence
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: moving a business between organizations taking every child
-- row with it, without a single write to those rows. The children store only
-- business_id, so their tenant is whatever the parent says it is today.
--
-- The realistic actor is someone who belongs to both organizations — a
-- consultant, an agency operator. Alice is given a membership in bob's
-- organization, which is an ordinary thing to do and is all it takes.

RESET ROLE;
INSERT INTO org_members (organization_id, user_id, role)
SELECT org_bob, '11111111-1111-4111-8111-111111111111', 'admin' FROM t;

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

UPDATE businesses SET organization_id = (SELECT org_bob FROM t)
WHERE id = '33333333-3333-4333-8333-333333333333';

-- Bob was never in alice's organization and touched none of these rows.
SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');

INSERT INTO defect_report
SELECT 5, 'child rows follow the parent across tenants with no write of their own',
       count(*) > 0,
       'bob now reads ' || count(*) || ' locations authored inside alice''s tenant'
FROM business_locations
WHERE business_id = '33333333-3333-4333-8333-333333333333';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ENABLE without FORCE
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: the table owner reading and writing every tenant's rows.
-- ENABLE ROW LEVEL SECURITY exempts the owner; only FORCE removes the
-- exemption. Anything that connects as the owner — a migration, a job, a
-- console session — is outside isolation entirely.

RESET ROLE;

INSERT INTO defect_report
SELECT 6, 'row level security is enabled but not forced, so the owner is exempt',
       count(*) FILTER (WHERE NOT c.relforcerowsecurity) > 0,
       count(*) FILTER (WHERE c.relforcerowsecurity) || ' of ' || count(*) ||
       ' tables have FORCE'
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;

-- ─────────────────────────────────────────────────────────────────────────────
-- Report
-- ─────────────────────────────────────────────────────────────────────────────
-- Anti-vacuity: six checks were written, so six rows must be present. Fewer
-- means a check silently failed to record and the report is lying by omission.

DO $$
DECLARE
    checks    int;
    n_present int;
    detail    text;
BEGIN
    SELECT count(*) INTO checks FROM defect_report;
    IF checks <> 6 THEN
        RAISE EXCEPTION 'Vacuous run: % of 6 checks recorded a result.', checks;
    END IF;

    SELECT count(*) INTO n_present FROM defect_report d WHERE d.present;

    SELECT string_agg(format('  %s. %s' || chr(10) || '     %s',
                             num, name, evidence), chr(10) ORDER BY num)
      INTO detail
      FROM defect_report d WHERE d.present;

    IF n_present > 0 THEN
        RAISE EXCEPTION E'% of 6 isolation defects are live in this schema:\n%',
            n_present, detail;
    END IF;

    RAISE NOTICE 'All 6 checks green: the schema prevents every one of them.';
END
$$;

ROLLBACK;
