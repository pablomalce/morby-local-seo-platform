-- Six isolation defects in the Growth OS schema — executable.
--
--   ./supabase/qa/replica.sh
--   docker exec growthos-replica psql -U postgres -d growthos \
--       -v ON_ERROR_STOP=1 -f /tmp/defects_test.sql
--
-- Every one of these was found by reading the DDL. Reading is how you find a
-- defect; running is how you prove it, and running again is how you know it
-- stayed fixed. Before 0003_expand_tenant_isolation.sql all six were present;
-- this file is what says so, and what would say so again.
--
-- Each check asks whether the schema still PERMITS the thing. Permitting it is
-- the defect, so every check is written to answer no once the schema refuses.
-- Refusal and invisibility both count as refusal: it does not matter whether a
-- tenant-less row is rejected at write time or hidden at read time, as long as
-- no other tenant can reach it.
--
-- Runs as postgres and drops to growthos_app for every assertion. That matters
-- more here than usual: defect 6 is precisely that the owner is exempt from
-- every policy, so asserting isolation as the owner would assert nothing.
--
-- Idempotent: everything happens inside a transaction that ends in ROLLBACK.

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

-- Becoming a given user, as the application role.
CREATE OR REPLACE FUNCTION pg_temp.be(p_user uuid) RETURNS void
LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claim.sub', p_user::text, true);
$$;

-- Did this statement go through? Used wherever the fix may take the form of a
-- refusal, so that "rejected" is recorded as a result instead of aborting the
-- run. A test that cannot survive the fix is a test that gets deleted the day
-- the fix lands.
CREATE OR REPLACE FUNCTION pg_temp.accepted(p_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN true;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END
$$;

SET LOCAL ROLE growthos_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The log has a branch with no tenant
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: a row written by one organization being readable by every
-- other one. The policy read `organization_id IS NULL OR ...`, so a NULL tenant
-- satisfied it for everybody. This is a leak, and it violates R1.

SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

CREATE TEMP TABLE step1 AS SELECT pg_temp.accepted($sql$
    INSERT INTO activity_logs (id, organization_id, scope, scope_id, action)
    VALUES ('66666666-6666-4666-8666-666666666666', NULL, 'business',
            '33333333-3333-4333-8333-333333333333', 'alice.secret.action')
$sql$) AS written;

SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');

INSERT INTO defect_report
SELECT 1, 'activity_logs: tenant-less rows are readable by every organization',
       (SELECT written FROM step1) AND count(*) > 0,
       CASE WHEN (SELECT written FROM step1)
            THEN 'the tenant-less write was accepted; bob reads ' || count(*) || ' of them'
            ELSE 'the tenant-less write was refused' END
FROM activity_logs WHERE id = '66666666-6666-4666-8666-666666666666';

-- Same shape, same policy, different table.
SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

CREATE TEMP TABLE step2 AS SELECT pg_temp.accepted($sql$
    INSERT INTO agent_runs (id, business_id, agent_id, scope, scope_id)
    VALUES ('77777777-7777-4777-8777-777777777777', NULL, 'seo-agent', 'business',
            '33333333-3333-4333-8333-333333333333')
$sql$) AS written;

SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');

INSERT INTO defect_report
SELECT 2, 'agent_runs: business-less rows are readable by every organization',
       (SELECT written FROM step2) AND count(*) > 0,
       CASE WHEN (SELECT written FROM step2)
            THEN 'the business-less write was accepted; bob reads ' || count(*) || ' of them'
            ELSE 'the business-less write was refused' END
FROM agent_runs WHERE id = '77777777-7777-4777-8777-777777777777';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A resource can be linked to another tenant's resource
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: a content asset of one tenant pointing at a service of
-- another. The policy filters by business_id and never looks at service_id, so
-- only a composite foreign key can make this impossible rather than merely
-- discouraged.

SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

INSERT INTO defect_report
SELECT 3, 'content_assets: service_id may point at another tenant''s service',
       pg_temp.accepted($sql$
           INSERT INTO content_assets (id, business_id, service_id, kind, body)
           VALUES ('88888888-8888-4888-8888-888888888888',
                   '33333333-3333-4333-8333-333333333333',
                   '55555555-5555-4555-8555-555555555555',
                   'page', 'body')
       $sql$),
       'alice pointing her asset at bob''s service';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. N primary locations at once
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: more than one location per business claiming to be the
-- primary one, which leaves the code picking whichever row the query returns
-- first — an accident, not a decision.
--
-- is_primary is set EXPLICITLY on both rows. Relying on the column default
-- would make this check pass the moment the default flips to false, while the
-- schema still happily accepted two explicit primaries.

INSERT INTO business_locations (id, business_id, label, is_primary) VALUES
    ('99999999-9999-4999-8999-999999999991',
     '33333333-3333-4333-8333-333333333333', 'One', true);

INSERT INTO defect_report
SELECT 4, 'business_locations: several locations can be primary at once',
       pg_temp.accepted($sql$
           INSERT INTO business_locations (id, business_id, label, is_primary)
           VALUES ('99999999-9999-4999-8999-999999999992',
                   '33333333-3333-4333-8333-333333333333', 'Two', true)
       $sql$),
       'a second explicit primary for the same business';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Children migrate tenant in silence
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

CREATE TEMP TABLE step5 AS SELECT pg_temp.accepted($sql$
    UPDATE businesses SET organization_id = (SELECT org_bob FROM t)
     WHERE id = '33333333-3333-4333-8333-333333333333'
$sql$) AS moved;

-- Bob was never in alice's organization and touched none of these rows.
SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');

INSERT INTO defect_report
SELECT 5, 'child rows follow the parent across tenants with no write of their own',
       (SELECT moved FROM step5) AND count(*) > 0,
       CASE WHEN (SELECT moved FROM step5)
            THEN 'bob now reads ' || count(*) || ' locations authored inside alice''s tenant'
            ELSE 'the business was refused permission to change organization' END
FROM business_locations
WHERE business_id = '33333333-3333-4333-8333-333333333333';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ENABLE without FORCE
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: the table owner reading and writing every tenant's rows.
-- ENABLE ROW LEVEL SECURITY exempts the owner; only FORCE removes the
-- exemption. Anything that connects as the owner — a migration, a job, a
-- console session — is otherwise outside isolation entirely.

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
                             d.num, d.name, d.evidence), chr(10) ORDER BY d.num)
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
