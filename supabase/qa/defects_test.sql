-- Fourteen isolation checks against the Growth OS schema — executable.
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
-- Checks 7 to 9 arrived with 0004_composite_tenant_key.sql. The first six ask
-- whether the schema permits a defect. These three ask something narrower and
-- easier to get wrong: whether the refusal comes from the STRUCTURE. Check 5
-- was green the day a trigger refused to reparent a business, and it would have
-- stayed green forever while the children still stored no tenant of their own.
--
-- Each check asks whether the schema still PERMITS the thing. Permitting it is
-- the defect, so every check is written to answer no once the schema refuses.
-- Refusal and invisibility both count as refusal: it does not matter whether a
-- tenant-less row is rejected at write time or hidden at read time, as long as
-- no other tenant can reach it.
--
-- Check 11 is the odd one out: it asks about the application ROLE rather than
-- about the schema. It belongs here anyway, because it is the same question the
-- other ten ask — can something reach this data that should not — and because
-- the CI job that runs this file is the only place that would ever notice.
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

-- Bob's own location, for check 8. organization_id is deliberately left out:
-- filling it from the parent is what 0004's BEFORE INSERT trigger is for, and a
-- fixture that supplied it by hand would never exercise that path.
INSERT INTO business_locations (id, business_id, label, is_primary) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '44444444-4444-4444-8444-444444444444', 'Bob Main', true);

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
-- 7. A child row can claim a tenant its parent does not have
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: organization_id on a child drifting away from the parent's.
-- The column is only worth having if it cannot lie: a policy that trusts it
-- while nothing keeps it in step with businesses is a policy reading a field
-- any writer can set to anything.
--
-- Alice is a member of bob's organization by now — check 5 gave her that
-- membership, and it is what makes this check test what it says. Without it the
-- row would be refused by the policy's WITH CHECK, the check would go green,
-- and the composite foreign key would never be consulted at all.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

INSERT INTO defect_report
SELECT 7, 'a child row may carry an organization_id its parent does not have',
       pg_temp.accepted(format($sql$
           INSERT INTO business_locations (id, business_id, organization_id, label)
           VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                   '33333333-3333-4333-8333-333333333333', %L, 'Forged')
       $sql$, (SELECT org_bob FROM t))),
       'alice tagging a location of her own business with bob''s tenant';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. A grandchild can point across businesses
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: location_id and service_id reaching a row that belongs to a
-- different business — the same hole 0003 closed for content_assets.service_id,
-- one level down and on four other foreign keys.
--
-- The competitor row itself is entirely alice's, so the policy has nothing to
-- object to. Only the composite foreign key can refuse this one, which is the
-- point of writing it this way.

INSERT INTO defect_report
SELECT 8, 'a grandchild may reference a location belonging to another business',
       pg_temp.accepted($sql$
           INSERT INTO competitors (id, business_id, location_id, name)
           VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                   '33333333-3333-4333-8333-333333333333',
                   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Crossed')
       $sql$),
       'alice pointing her competitor at a location of bob''s business';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. The refusal in check 5 is a trigger, not the schema
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: check 5 passing for a reason that can be dropped in one
-- statement. 0003 closed it with a BEFORE UPDATE trigger on businesses, which
-- refuses the move while leaving the children storing no tenant at all.
--
-- This check and check 5 only mean something together: 5 says the move is
-- refused, 9 says no trigger is doing the refusing. Either one alone is
-- satisfied by a schema that has the hole.

RESET ROLE;

INSERT INTO defect_report
SELECT 9, 'reparenting is blocked by a trigger rather than by the schema',
       count(*) > 0,
       CASE WHEN count(*) > 0
            THEN 'businesses carries ' || count(*) ||
                 ' trigger(s) on organization_id: ' || string_agg(tg.tgname, ', ')
            ELSE 'no trigger on businesses.organization_id; the refusal is structural'
            END
FROM pg_trigger tg
WHERE tg.tgrelid = 'public.businesses'::regclass
  AND NOT tg.tgisinternal
  AND tg.tgname <> 'trg_businesses_updated_at';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Una policy de escritura que se aplica a TODOS y no comprueba nada
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: a table that anyone holding the anon key can write. The key
-- is in the browser bundle by design, so a write policy that applies to PUBLIC
-- with `WITH CHECK (true)` is a write policy with no author.
--
-- pagespeed_cache had exactly that, and it was not theoretical: through
-- PostgREST, with no session, the upsert returned 201 and the row read back byte
-- for byte. hydrateWithPageSpeed() then serves that row for 24 hours without
-- revalidating, which puts invented web vitals into a customer's report.
--
-- Deliberately about the SHAPE and not about a role. The suite has to run
-- against the local replica and against Supabase, and asking "can anon write?"
-- needs a live anon role. Asking "does any write policy apply to PUBLIC and
-- check nothing?" is the same question at the catalog level, and it also catches
-- the next table that ships this way instead of only the one that did.
--
-- SELECT is out of scope on purpose: a policy that lets everyone READ may be a
-- deliberate decision, and pagespeed_cache is one -- it holds PageSpeed scores
-- of public websites keyed by URL, with nothing tenant-scoped to leak.

RESET ROLE;

DO $$
DECLARE
    examinadas int;
BEGIN
    SELECT count(*) INTO examinadas
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND p.polcmd IN ('a', 'w', '*');

    IF examinadas = 0 THEN
        RAISE EXCEPTION
            'Vacuous check 10: no write policies found at all in public.';
    END IF;
END
$$;

INSERT INTO defect_report
SELECT 10, 'a write policy applies to PUBLIC and checks nothing',
       count(*) > 0,
       CASE WHEN count(*) > 0
            THEN 'unconditional write for everyone on: ' ||
                 string_agg(c.relname || '.' || p.polname, ', ')
            ELSE 'no write policy applies to PUBLIC with WITH CHECK (true)'
            END
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND p.polcmd IN ('a', 'w', '*')
  AND p.polroles = '{0}'::oid[]
  AND pg_get_expr(p.polwithcheck, p.polrelid) = 'true';

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. El rol de aplicación puede abrir una conexión propia
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: a login account with a weak password sitting on a database
-- that holds customer data. supabase/qa/app_role.sql used to create
-- growthos_app with LOGIN and the password 'growthos'. In a throwaway container
-- that costs nothing; applied to a real database it is an account anyone who
-- has read the repository can connect as, and it holds SELECT, INSERT, UPDATE
-- and DELETE on all fifteen tables.
--
-- Nothing needs the login: every assertion here and every step of the CI job
-- reaches the role through SET ROLE from a connection that already exists. So
-- the check is not a style preference — it asserts that the one capability
-- nobody uses is also the one nobody has.
--
-- The vacuity guard below is defence in depth and nothing more: measured, a run
-- against a database without the role aborts thirty lines earlier, at the GRANT
-- on defect_report. It stays because the day that GRANT moves, this check would
-- otherwise start passing by absence.
--
-- The password is checked as well as the LOGIN, and not for tidiness: measured
-- on tpqiltnskfeycnybczgz, growthos_app was already NOLOGIN by hand and still
-- stored the password from the old file. A stored password on a NOLOGIN role is
-- one ALTER away from being an account again, and that ALTER leaves no trace of
-- where the credential came from.
--
-- rolcanlogin comes from pg_roles, which is world-readable. The password lives
-- in pg_authid, which is superuser-only in stock PostgreSQL: readable as the
-- owner in the local replica, in CI, and — measured, not assumed — on Supabase
-- too. Where it is not readable the check falls back to LOGIN alone and says so
-- in its evidence, rather than reporting an absence it never looked for.

RESET ROLE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'growthos_app') THEN
        RAISE EXCEPTION
            'Vacuous check 11: growthos_app does not exist in this database.';
    END IF;
END
$$;

DO $$
DECLARE
    puede_login boolean;
    ve_authid   boolean;
    con_clave   boolean := false;
BEGIN
    SELECT rolcanlogin INTO puede_login FROM pg_roles WHERE rolname = 'growthos_app';

    ve_authid := has_table_privilege(current_user, 'pg_authid', 'SELECT');
    IF ve_authid THEN
        EXECUTE $q$SELECT rolpassword IS NOT NULL FROM pg_authid
                    WHERE rolname = 'growthos_app'$q$ INTO con_clave;
    END IF;

    INSERT INTO defect_report VALUES (
        11,
        'the application role can open a connection of its own',
        puede_login OR con_clave,
        CASE
            WHEN puede_login AND con_clave THEN
                'growthos_app has LOGIN and a stored password'
            WHEN puede_login THEN
                'growthos_app has LOGIN'
            WHEN con_clave THEN
                'growthos_app is NOLOGIN but still stores a password'
            WHEN ve_authid THEN
                'growthos_app is NOLOGIN with no password; SET ROLE is the only way in'
            ELSE
                'growthos_app is NOLOGIN; pg_authid unreadable, password not checked'
        END);
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. El tenant sigue pudiendo faltar en las tablas que 0003 y 0004 tocaron
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: a row with no tenant at all. Checks 1 to 4 are about a
-- tenant-less row being VISIBLE to everybody; this one is about it existing in
-- the first place.
--
-- 0003 and 0004 were the expand halves and left the columns nullable on
-- purpose: the NOT NULL arrived as a NOT VALID check, which constrains new rows
-- and says nothing about the ones already there. 0006 is the contract half that
-- validates them and puts the constraint on the column, where the catalogue can
-- state it instead of a check having to imply it.
--
-- Written against the CATALOGUE and not by attempting an INSERT, because the
-- fill trigger would supply organization_id and the INSERT would succeed either
-- way — proving the trigger works, which is check 13, and not that the column
-- refuses NULL, which is this one.

RESET ROLE;

INSERT INTO defect_report
SELECT 12, 'a tenant column can still hold NULL after the contract migration',
       count(*) > 0,
       CASE WHEN count(*) > 0
            THEN 'still nullable: ' || string_agg(t || '.' || c, ', ' ORDER BY t, c)
            ELSE 'organization_id and business_id are NOT NULL everywhere they exist'
            END
  FROM (
    SELECT c.relname AS t, a.attname AS c
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND a.attnum > 0 AND NOT a.attisdropped AND NOT a.attnotnull
       AND a.attname IN ('organization_id', 'business_id')
  ) nulables;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Los diez triggers que llenan el tenant siguen en pie
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA, y es lo contrario de lo habitual: acá el defecto sería que los
-- triggers NO estén.
--
-- fill_organization_id_from_business() llena organization_id en diez tablas
-- hijas, y la aplicación depende de eso: medido, supabaseTenantStore.ts:236
-- inserta en business_locations con business_id y sin organization_id, y la
-- misma forma se repite en business_services, competitors, content_assets,
-- reports y reviews. Seis sitios de INSERT vivos.
--
-- Borrarlos antes de que la aplicación mande la columna no falla en el
-- despliegue: empieza a escribir filas sin tenant, que es exactamente el
-- defecto que 0003 vino a cerrar. Un fallo silencioso es peor que uno ruidoso,
-- así que este bloque hace ruido.
--
-- El día que la aplicación mande organization_id explícitamente, este bloque
-- hay que darlo vuelta a mano — y eso es deliberado: que borrar los triggers
-- exija tocar la suite es la forma de que nadie los borre de paso.

INSERT INTO defect_report
SELECT 13, 'the ten triggers that fill the tenant are gone before the app sends it',
       count(*) <> 10,
       CASE WHEN count(*) = 10
            THEN 'the ten fill triggers are in place'
            ELSE 'expected 10 fill triggers, found ' || count(*) ||
                 CASE WHEN count(*) = 0 THEN ' — child rows can now be written with no tenant'
                      ELSE ': ' || COALESCE(string_agg(c.relname, ', ' ORDER BY c.relname), '')
                 END
            END
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE '%fill_org%';

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. La llave pública puede escribir en alguna tabla
-- ──────────────────────────────────────────────────────────────────────────────
-- WHAT IT PREVENTS: the key that ships in the browser bundle holding write
-- privileges on a table of data. Today the policies already stop it — the 0010
-- comment records that measurement, and it is why that migration is defence in
-- depth rather than a fix. This block is about the second layer staying up.
--
-- The reason it exists is narrower and more concrete than "anon should not
-- write". Supabase has default privileges that hand every NEW table in `public`
-- the full seven privileges to all three roles. So this does not stay closed on
-- its own: it reopens on the next CREATE TABLE, silently, for a table nobody
-- has written yet. It already happened twice with `schema_migrations` — once
-- here and once in Lead Engine.
--
-- A migration closes it once. This is what makes the next one visible.
--
-- Emptying a table is in the list on purpose even though `anon` no longer holds
-- that privilege: it is the one that does not go through RLS at all, so if it
-- ever comes back it is not a second layer failing, it is the only layer.

RESET ROLE;

INSERT INTO defect_report
SELECT 14, 'the public key can write to a table',
       count(*) > 0,
       CASE WHEN count(*) > 0
            THEN 'anon holds ' || string_agg(DISTINCT privilege_type, ', ') ||
                 ' on ' || count(DISTINCT table_name) || ' table(s): ' ||
                 (SELECT string_agg(DISTINCT t.table_name, ', ')
                    FROM information_schema.role_table_grants t
                   WHERE t.table_schema = 'public' AND t.grantee = 'anon'
                     AND t.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'))
            ELSE 'anon holds no write privilege anywhere in public'
            END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee = 'anon'
   AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');

-- ─────────────────────────────────────────────────────────────────────────────
-- Report
-- ─────────────────────────────────────────────────────────────────────────────
-- Anti-vacuity: fourteen checks were written, so fourteen rows must be present. Fewer
-- means a check silently failed to record and the report is lying by omission.

DO $$
DECLARE
    checks    int;
    n_present int;
    detail    text;
BEGIN
    SELECT count(*) INTO checks FROM defect_report;
    IF checks <> 14 THEN
        RAISE EXCEPTION 'Vacuous run: % of 14 checks recorded a result.', checks;
    END IF;

    SELECT count(*) INTO n_present FROM defect_report d WHERE d.present;

    SELECT string_agg(format('  %s. %s' || chr(10) || '     %s',
                             d.num, d.name, d.evidence), chr(10) ORDER BY d.num)
      INTO detail
      FROM defect_report d WHERE d.present;

    IF n_present > 0 THEN
        RAISE EXCEPTION E'% of 14 isolation defects are live in this schema:\n%',
            n_present, detail;
    END IF;

    RAISE NOTICE 'All 14 checks green: the schema prevents every one of them.';
END
$$;

ROLLBACK;
