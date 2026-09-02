-- Forty-four isolation checks against the Growth OS schema — executable.
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

INSERT INTO business_services (id, business_id, organization_id, slug, name)
SELECT '55555555-5555-4555-8555-555555555555',
       '44444444-4444-4444-8444-444444444444', org_bob, 'bob-service', 'Bob Service'
  FROM t;

-- Bob's own location, for check 8. organization_id is passed explicitly since
-- 0012: the BEFORE INSERT trigger that used to fill it from the parent is gone,
-- and a fixture that omitted the column would now be refused by NOT NULL —
-- which would make every check downstream pass for the wrong reason.
INSERT INTO business_locations (id, business_id, organization_id, label, is_primary)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '44444444-4444-4444-8444-444444444444', org_bob, 'Bob Main', true
  FROM t;

-- Becoming a given user, as the application role.
CREATE OR REPLACE FUNCTION pg_temp.be(p_user uuid) RETURNS void
LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claim.sub', p_user::text, true);
$$;

-- Con qué SQLSTATE murió, o NULL si pasó.
--
-- `accepted()` alcanza cuando lo único que puede frenar una sentencia es lo que
-- el bloque mide. No alcanza cuando puede frenarla OTRA cosa: los bloques 50 y
-- 51 llaman a una función con argumentos de relleno, y una violación de CHECK
-- (23514) se ve igual que un permiso denegado (42501) desde afuera.
--
-- Medido el 2026-08-30, y por eso existe: con `accepted()` los dos bloques
-- pasaban en verde mientras `anon`, `authenticated` y `growthos_app` PODÍAN
-- ejecutar la función. Frenaba el CHECK del slug, no el privilegio. Un bloque que
-- pasa por el motivo equivocado es peor que uno que falla.
CREATE OR REPLACE FUNCTION pg_temp.sqlstate_of(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END
$$;

-- Con qué MENSAJE murió, que es lo que el SQLSTATE no alcanza a decir cuando dos
-- denegaciones distintas comparten código.
--
-- `sqlstate_of()` fue el arreglo de que `accepted()` midiera «falló» sin decir
-- por qué. Esto es el mismo arreglo un paso más allá, y existe por una medición:
-- las funciones de la 0021 son `SECURITY INVOKER` y tocan el esquema `vault`, así
-- que un rol al que le sobre el EXECUTE igual muere con
--
--     42501 | permission denied for schema vault
--
-- que es indistinguible, por SQLSTATE, de
--
--     42501 | permission denied for function integration_token_secret
--
-- Medido el 2026-09-01: con `authenticated` sacado del REVOKE de la 0021, los
-- bloques 54, 56 y 57 seguían VERDES. Pasaban porque el Vault los frenaba, no
-- porque el privilegio que dicen medir estuviera puesto.
--
-- El mensaje viene en inglés porque así corren la réplica, el CI y hosted. Si
-- algún día el servidor hablara otro idioma, estos bloques se pondrían en rojo
-- —no en verde—, que es la dirección barata del error.
CREATE OR REPLACE FUNCTION pg_temp.denied_on_function(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'la llamada pasó';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' | ' || SQLERRM;
END
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
           INSERT INTO content_assets (id, business_id, organization_id, service_id, kind, body)
           SELECT '88888888-8888-4888-8888-888888888888',
                  '33333333-3333-4333-8333-333333333333', org_alice,
                  '55555555-5555-4555-8555-555555555555',
                  'page', 'body'
             FROM t
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

INSERT INTO business_locations (id, business_id, organization_id, label, is_primary)
SELECT '99999999-9999-4999-8999-999999999991',
       '33333333-3333-4333-8333-333333333333', org_alice, 'One', true
  FROM t;

INSERT INTO defect_report
SELECT 4, 'business_locations: several locations can be primary at once',
       pg_temp.accepted($sql$
           INSERT INTO business_locations (id, business_id, organization_id, label, is_primary)
           SELECT '99999999-9999-4999-8999-999999999992',
                  '33333333-3333-4333-8333-333333333333', org_alice, 'Two', true
             FROM t
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
           INSERT INTO competitors (id, business_id, organization_id, location_id, name)
           SELECT 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                  '33333333-3333-4333-8333-333333333333', org_alice,
                  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Crossed'
             FROM t
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
-- 13. El tenant lo pone la aplicación, no un trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA. Este bloque estuvo dado vuelta hasta la 0012, y el motivo de que
-- lo estuviera vale conservarlo: mientras la aplicación no mandaba
-- `organization_id`, borrar los diez triggers no fallaba en el despliegue —
-- empezaba a escribir filas sin tenant, en silencio. Un fallo silencioso es
-- peor que uno ruidoso, así que el bloque hacía ruido por la AUSENCIA.
--
-- Ese requisito se invirtió, y no por decreto: el PR #23 hizo que los seis
-- sitios de INSERT manden la columna, `tenantOnInsert.test.ts` los obliga a
-- seguir mandándola, y el commit estuvo sirviendo en producción antes de que
-- la 0012 borrara nada.
--
-- Ahora el defecto es que sigan ahí. Un trigger que llena el tenant vuelve a
-- convertir la garantía en *"algo va a llegar primero"*, que es exactamente lo
-- que ninguna migración puede validar.
--
-- Se mira la función además de los triggers. Un trigger huérfano no puede
-- existir sin ella, pero la función sí puede sobrevivir sin triggers, y
-- mientras exista alcanza un `CREATE TRIGGER` de una línea para deshacer todo
-- esto sin que la suite lo note.

INSERT INTO defect_report
SELECT 13, 'the tenant is filled by a trigger instead of by the application',
       count(*) <> 0,
       CASE WHEN count(*) = 0
            THEN 'no fill trigger and no fill function remain: the application sends the tenant'
            ELSE 'still present: ' || string_agg(que, ', ' ORDER BY que)
            END
  FROM (
    SELECT 'trigger on ' || c.relname AS que
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE '%fill_org%'
    UNION ALL
    SELECT 'function ' || p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fill_organization_id_from_business'
  ) sobrantes;

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
-- 15. Archivar a un miembro no le corta el acceso
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que dar de baja a alguien sea una anotación sin efecto. Desde la
-- 0013 la baja de un miembro archiva en vez de borrar, y lo que traduce una
-- membresía en acceso es `current_user_org_ids()`. Si esa función no filtra por
-- estado, la columna `state` existe, la UI puede mostrar "archivado", y la
-- persona sigue leyendo todo.
--
-- Es el bloque que el canónico NO puede escribir. Su resolutor lee un GUC y
-- nunca toca org_members, así que allá archivar no puede cortar nada y el
-- bloque 16 lo dice en su propio encabezado. Acá el resolutor es SQL de verdad,
-- así que acá se mide el efecto.
--
-- Se siembra un tenant propio en vez de reusar a alice y bob: para el bloque 15
-- esos dos ya arrastran las membresías cruzadas del 5 y del 7, y medir sobre un
-- estado acumulado es medir otra cosa de la que uno cree.

RESET ROLE;

-- La organización y la membresía las crea handle_new_user() al insertarse el
-- usuario, igual que para alice y bob más arriba. Sembrarlas a mano sería
-- sembrar una forma que la aplicación nunca produce.
INSERT INTO auth.users (id, email) VALUES
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'carol@example.test'),
    -- dave existe sólo para el bloque 16: hace falta alguien a quien carol
    -- pueda INTENTAR dar de alta y que todavía no tenga fila en su
    -- organización. Con carol misma, la unicidad de (organization_id, user_id)
    -- rechaza el INSERT antes que la policy, y `accepted()` —que atrapa WHEN
    -- OTHERS— lo anota como rechazado. Medido: el bloque quedaba verde con la
    -- policy rota. handle_new_user() le da su propia organización, que no es la
    -- de carol y no molesta.
    ('dddddddd-dddd-4ddd-8ddd-ddddddddddde', 'dave@example.test'),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddf', 'erin@example.test'),
    ('dddddddd-dddd-4ddd-8ddd-ddddddddddda', 'frank@example.test');

INSERT INTO businesses (id, organization_id, name)
SELECT 'ffffffff-ffff-4fff-8fff-ffffffffffff', organization_id, 'Carol Co'
  FROM org_members
 WHERE user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('dddddddd-dddd-4ddd-8ddd-dddddddddddd');

-- Anti-vacuidad, y no es ceremonia: si carol no viera su negocio ESTANDO
-- activa, el chequeo de abajo daría verde por un motivo que no tiene nada que
-- ver con archivar — un fixture mal sembrado se lee igual que un acceso
-- cortado.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM businesses
     WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    IF n <> 1 THEN
        RAISE EXCEPTION
            'Vacuous check 15: carol activa ve % negocios propios; debe ver 1. '
            'Sin esto, el chequeo pasaría en verde con el fixture roto.', n;
    END IF;
END
$$;

-- Anti-vacuidad de la OTRA mitad, y no es de más: `members_owner_write` no
-- funcionaba —recursaba— y nadie lo había notado porque nada la ejercitaba. Si
-- carol ACTIVA tampoco pudiera dar de alta a nadie, los bloques 16 y 19 darían
-- verde por una policy rota en vez de por una policy que discrimina.
DO $$
BEGIN
    INSERT INTO org_members (organization_id, user_id, role)
    SELECT organization_id, 'dddddddd-dddd-4ddd-8ddd-ddddddddddde'::uuid, 'editor'
      FROM org_members
     WHERE user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
        'Vacuous checks 16/19: carol ACTIVA, dueña de su organización, no pudo '
        'dar de alta a nadie (%). Con la escritura rota, los dos bloques que '
        'siguen pasan sin discriminar nada.', SQLERRM;
END
$$;

RESET ROLE;
UPDATE org_members SET state = 'archived'
 WHERE user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('dddddddd-dddd-4ddd-8ddd-dddddddddddd');

INSERT INTO defect_report
SELECT 15, 'an archived member still reads the tenant they were removed from',
       count(*) > 0,
       CASE WHEN count(*) > 0
            THEN 'carol was archived and still reads ' || count(*) ||
                 ' business(es) of the organization she was removed from'
            ELSE 'an archived membership resolves to no tenant: carol reads 0'
            END
  FROM businesses
 WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. Un owner archivado sigue administrando miembros
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que archivar a quien manda no le saque el poder de mandar. La
-- policy `members_owner_write` decide quién puede tocar org_members, y hasta la
-- 0013 su subconsulta preguntaba por el rol sin mirar el estado. Un owner
-- archivado conservaba el alta y la baja de cualquiera — incluida la suya, así
-- que podía desarchivarse.
--
-- Este hueco no lo encontró un test: apareció leyendo la policy al escribir la
-- migración. El bloque existe para que la próxima vez lo encuentre un test.
--
-- Se prueba con un INSERT y no con un UPDATE a propósito. `members_owner_write`
-- no declara WITH CHECK, así que PostgreSQL usa su USING también para el
-- INSERT, y un INSERT rechazado por policy LANZA. Un UPDATE tapado por la misma
-- policy no lanza: actualiza cero filas, y `accepted()` lo anotaría como
-- aceptado. Es la trampa que el bloque 6 de Lead Engine ya pagó una vez.
--
-- Y se da de alta a ERIN y no a carol, por una segunda trampa que costó una
-- mutación: con carol, la unicidad de (organization_id, user_id) rechaza el
-- INSERT antes de que la policy opine, `accepted()` atrapa WHEN OTHERS y lo
-- anota como rechazado. El bloque quedaba verde con la policy rota. Cada bloque
-- da de alta a alguien distinto por ese motivo.

INSERT INTO defect_report
SELECT 16, 'an archived owner can still add members to the organization',
       pg_temp.accepted(format($sql$
           INSERT INTO org_members (organization_id, user_id, role)
           VALUES (%L, 'dddddddd-dddd-4ddd-8ddd-dddddddddddf'::uuid, 'admin')
       $sql$, (SELECT organization_id FROM org_members
                WHERE user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'))),
       'carol, archived, adding erin to the organization she was removed from';

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. Una membresía se puede borrar en vez de archivar
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la baja destruya el registro de que esa persona tuvo acceso.
-- La 0013 le saca DELETE sobre org_members a `anon` y a `authenticated`; lo
-- conserva `service_role`, que es quien corre el borrado de cuenta propia.
--
-- Medido contra hosted antes de escribir la migración, y contradice lo que §5.4
-- del prompt maestro suponía: `authenticated` SÍ tenía DELETE acá, porque la
-- 0010 lo otorga sobre ALL TABLES. El borrado duro ya era posible.
--
-- `app_role.sql` repite el mismo REVOKE sobre growthos_app por un motivo
-- concreto: su GRANT es sobre ALL TABLES y se lo devolvería, y entonces este
-- bloque estaría midiendo un rol con un privilegio que producción no tiene.

INSERT INTO defect_report
SELECT 17, 'a membership can be deleted outright instead of archived',
       pg_temp.accepted($sql$
           DELETE FROM org_members
            WHERE user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
       $sql$),
       'the application role deleting a membership row';

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. `state` acepta un valor fuera del vocabulario
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que `state` sea texto libre. El resolutor filtra por el literal
-- 'active', así que 'activo', 'ACTIVE' o 'inactive' no son sinónimos: son
-- valores que cortan el acceso sin que nadie lo haya pedido, o que lo dejan
-- abierto creyendo lo contrario.
--
-- Corre como dueño y no como la aplicación, y es deliberado: sin FORCE el dueño
-- está exento de RLS, así que lo único que puede rechazar la escritura es el
-- CHECK. Es exactamente lo que se quiere medir.

RESET ROLE;

INSERT INTO defect_report
SELECT 18, 'org_members.state accepts a value outside (active, archived)',
       pg_temp.accepted($sql$
           UPDATE org_members SET state = 'inactivo'
            WHERE user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
       $sql$),
       'a state the tenant resolver does not know how to read';

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. Un miembro que no es owner ni admin administra miembros igual
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: el complemento del 16. Aquél mide que el ESTADO cuente; éste, que
-- el ROL siga contando. La 0013 movió los dos chequeos dentro de
-- `current_user_admin_org_ids()`, así que ahora los sostiene una función y no
-- una policy — y nada medía el rol.
--
-- Lo dijo una mutación: sacarle `role IN ('owner','admin')` a esa función dejaba
-- los dieciocho bloques en verde, porque carol es owner y su caso no cambia.
-- Un editor que pueda darse a sí mismo el rol de owner es una escalada de
-- privilegios, no un detalle de forma.
--
-- dave es editor ACTIVO de la organización de carol: la única razón para
-- rechazarlo es el rol.
--
-- El `SET LOCAL ROLE` de abajo no es ceremonia. El bloque 18 termina con
-- `RESET ROLE` para medir el CHECK sin RLS de por medio, y sin esta línea este
-- bloque correría como el dueño — que sin FORCE está exento de toda policy. Se
-- midió: así, el INSERT de dave se aceptaba y el bloque reportaba un defecto que
-- no existe. Es la misma advertencia que el encabezado del archivo hace sobre
-- correr las aserciones como dueño, cobrada de nuevo.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('dddddddd-dddd-4ddd-8ddd-ddddddddddde');

INSERT INTO defect_report
SELECT 19, 'a plain member can administer the memberships of their organization',
       pg_temp.accepted(format($sql$
           INSERT INTO org_members (organization_id, user_id, role)
           VALUES (%L, 'dddddddd-dddd-4ddd-8ddd-ddddddddddda'::uuid, 'owner')
       $sql$, (SELECT organization_id FROM org_members
                WHERE user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'))),
       'dave, an active editor, adding frank as owner of the organization';

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de la 0014 — un token de bob, con su secreto en el Vault
-- ─────────────────────────────────────────────────────────────────────────────
-- Como dueño: `service_role` es quien escribe tokens en producción y es el único
-- con USAGE sobre `vault`. Que el fixture use la ruta real —crear el secreto en
-- el Vault y guardar SÓLO su id— es lo que hace que el bloque 22 mida algo: si
-- el fixture guardara el token en una columna, estaría midiendo su propio
-- descuido y no el esquema.
RESET ROLE;

CREATE TEMP TABLE tok AS
SELECT vault.create_secret(
           'ya29.SECRETO-DE-PRUEBA-NO-REAL',
           'integration_token/prueba',
           'fixture de defects_test.sql'
       ) AS secret_id;

GRANT SELECT ON tok TO growthos_app;

INSERT INTO integration_tokens (organization_id, provider, secret_id, expires_at)
SELECT t.org_bob, 'google', tok.secret_id, now() + interval '30 days'
  FROM t, tok;

-- Y una usuaria nueva para el bloque 20, que no es de ninguna organización salvo
-- la suya.
--
-- NO se usa alice, y la primera versión de este bloque sí la usaba: la corrida
-- reportó el defecto 20 como vivo, y tenía razón — el bloque 5 le da a alice una
-- membresía en la organización de bob, así que a esta altura del archivo alice
-- VE las cosas de bob con todo derecho. El bloque no medía aislamiento: medía
-- una membresía que el propio archivo le había dado quince bloques antes.
--
-- Tampoco se reusa erin, que ya existe. Su membresía depende del RESULTADO del
-- bloque 16 —es a quien carol archivada intenta dar de alta—, así que un día que
-- ese bloque regrese, este otro cambiaría de fixture sin que nadie lo toque.
-- Grace no la nombra ningún otro bloque.
--
-- Entra por auth.users como todos los demás: handle_new_user() le da su
-- organización y su membresía de owner, que es el camino real de alta.
INSERT INTO auth.users (id, email) VALUES
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'grace@example.test');

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. Un tenant llega al token de otro
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el eje de organización valga también para la tabla más cara del
-- esquema. Un lead filtrado es un lead; un token filtrado es la cuenta de Google
-- de otro cliente, con los permisos que haya otorgado.
--
-- alice no tiene nada que ver con bob. Que la fila sea invisible cuenta igual que
-- que sea rechazada, como en todo este archivo — lo que no puede pasar es que la
-- alcance.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 20, 'a tenant can reach another tenant''s integration token',
       count(*) > 0,
       'grace sees ' || count(*) || ' of bob''s tokens; must see 0'
  FROM integration_tokens;

-- ─────────────────────────────────────────────────────────────────────────────
-- 21. Vencido y revocado se leen igual
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el esquema distinga dos situaciones que piden acciones
-- opuestas. Un token vencido se refresca solo, sin molestar al cliente; uno
-- revocado no se refresca nunca y necesita que el cliente vuelva a conectar.
--
-- Es el mismo defecto que #46 arregló una capa más arriba, donde una API caída
-- se leía como una integración sin conectar. Acá el precio de confundirlos es un
-- reintento infinito contra un token que ninguna cantidad de refrescos revive.
--
-- Y el cuarto caso es el que se escribe mal solo: revocado Y vencido a la vez.
-- Tiene que decir 'revoked'. Un CASE con las ramas al revés lo llamaría
-- 'expired' y mandaría a refrescar algo que ya no existe — y los otros tres
-- casos seguirían dando bien, que es por qué está escrito aparte.

RESET ROLE;

INSERT INTO defect_report
SELECT 21, 'expired and revoked are not told apart',
       -- Dos condiciones, y hacen falta las dos. Que los tres estados sean
       -- distintos no dice nada sobre cuál gana cuando se dan juntos, y que la
       -- revocación domine no sirve si 'expired' y 'revoked' son la misma
       -- palabra.
       cardinality(ARRAY(SELECT DISTINCT unnest(estados))) <> 3
       OR ambos <> 'revoked',
       'active/expired/revoked dan ' || array_to_string(estados, '/') ||
       '; revocado y vencido a la vez da ' || ambos
  FROM (
    SELECT ARRAY[
             public.integration_token_state(now() + interval '1 day', NULL),
             public.integration_token_state(now() - interval '1 day', NULL),
             public.integration_token_state(now() + interval '1 day', now())
           ] AS estados,
           public.integration_token_state(now() - interval '1 day', now()) AS ambos
  ) q;

-- ─────────────────────────────────────────────────────────────────────────────
-- 22. El secreto del cliente se puede leer fuera del Vault
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo único que hace que esta tabla sea segura de tener. El token no
-- está en `public` en ninguna forma, y la ruta al Vault no está abierta para la
-- llave que viaja en el navegador.
--
-- Las dos mitades, porque cada una sola miente:
--
--   * una columna en claro sería un desastre aunque el Vault estuviera cerrado;
--   * y el Vault abierto a `authenticated` haría inútil que la columna no exista.
--
-- La primera no se pregunta por el NOMBRE de una columna —que se elude
-- llamándola de otra manera— sino volcando la fila entera a texto y buscando el
-- secreto adentro. Da igual cómo se llame la columna o de qué tipo sea.

RESET ROLE;

INSERT INTO defect_report
SELECT 22, 'the client''s token is readable outside the vault',
       en_claro > 0 OR alcance > 0,
       CASE
         WHEN en_claro > 0 THEN 'hay ' || en_claro || ' filas con el secreto en claro '
                                'o columnas de texto de más en public.integration_tokens'
         WHEN alcance > 0  THEN 'anon/authenticated alcanzan el esquema vault en ' ||
                                alcance || ' lugar(es)'
         ELSE 'el secreto sólo existe cifrado en vault, y anon/authenticated no llegan'
       END
  FROM (
    SELECT
      -- Dos cosas, y la segunda apareció por una mutación que sobrevivió a la
      -- primera. Buscar el secreto en la fila sólo encuentra un secreto que YA
      -- se filtró: agregar una columna `secret_plano text` y no escribir nada en
      -- ella pasaba en verde, y esa columna es precisamente la invitación.
      --
      -- Así que además se cuentan las columnas capaces de guardar texto. `provider`
      -- es la única que debe haber; cualquier otra obliga a mirar por qué está.
      -- Es el mismo denominador a mano que los bloques 1 y 5 tienen con el total
      -- de tablas.
      (SELECT count(*) FROM public.integration_tokens x
        WHERE x::text LIKE '%ya29.SECRETO-DE-PRUEBA-NO-REAL%')
      + (SELECT count(*) FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = 'integration_tokens'
            AND c.data_type IN ('text', 'character varying', 'bytea')
            AND c.column_name <> 'provider') AS en_claro,
      (SELECT count(*)
         FROM information_schema.role_table_grants
        WHERE table_schema = 'vault' AND grantee IN ('anon', 'authenticated'))
      + (SELECT count(*) FROM pg_namespace n
          WHERE n.nspname = 'vault'
            AND (has_schema_privilege('anon', n.oid, 'USAGE')
              OR has_schema_privilege('authenticated', n.oid, 'USAGE'))) AS alcance
  ) q;

-- ─────────────────────────────────────────────────────────────────────────────
-- 23. El rol del navegador puede escribir un token
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que guardar un token siga siendo cosa del servidor. La 0014 le da a
-- `authenticated` SÓLO SELECT — escribir uno es consecuencia de un intercambio
-- OAuth, que ocurre con `service_role` y del lado de allá. Una sesión de
-- navegador que pueda INSERTAR acá puede apuntar una organización a un secreto
-- que ella eligió.
--
-- Existe porque una mutación sobrevivió: sacarle a `growthos_app` el REVOKE de
-- escritura no rompía nada, ya que el bloque 20 sólo LEE. Un privilegio de más
-- no se nota leyendo.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 23, 'the browser-side role can write an integration token',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_tokens (organization_id, provider, secret_id, expires_at)
           VALUES (%L, 'google', %L, now() + interval '30 days')
       $sql$, (SELECT organization_id FROM org_members
                WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
              (SELECT secret_id FROM tok))),
       'grace, from a browser session, storing a token for her OWN organization';

-- ─────────────────────────────────────────────────────────────────────────────
-- 24. Una policy permisiva nueva ensancha el acceso a los tokens
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo único que la policy RESTRICTIVE compra, y que ninguna otra cosa
-- compra.
--
-- Las permisivas se combinan con OR: agregar una más laxa ENSANCHA el acceso, y
-- así es como esto se rompe en la vida real — alguien agrega una policy para un
-- caso nuevo y se lleva puesto el aislamiento sin darse cuenta. Las restrictivas
-- se combinan con AND y no se pueden anular agregando policies.
--
-- El bloque lo mide en vez de afirmarlo: agrega la policy más laxa que existe
-- —`USING (true)`— y vuelve a preguntar. Con la restrictiva puesta, grace sigue
-- sin ver nada de bob. Sin ella, ve todo.
--
-- Existe porque una mutación sobrevivió: borrar la policy restrictiva dejaba los
-- veintitrés bloques en verde, porque la permisiva sola también aísla. Aísla
-- HOY, que es otra cosa.
--
-- Cuenta los tokens DE BOB y no todo lo que grace alcanza, y eso se corrigió el
-- 2026-08-29 auditando la 0017, donde el bloque equivalente tenía el mismo
-- acople. Con la escritura devuelta a `growthos_app`, el bloque 23 consigue
-- guardar un token para la organización DE GRACE, y este bloque lo contaba como
-- si fuera de bob: reportaba 'grace ve 1 tokens de bob' sobre un token suyo. No
-- era un verde falso —sólo ocurre cuando el 23 ya está en rojo— pero su
-- evidencia mentía exactamente cuando alguien la iba a leer.

RESET ROLE;
CREATE POLICY "tokens_mutacion_permisiva" ON public.integration_tokens
    FOR SELECT USING (true);

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 24, 'a new permissive policy widens access to another tenant''s tokens',
       count(*) > 0,
       'con una policy USING (true) agregada, grace ve ' || count(*) ||
       ' tokens de bob; debe seguir viendo 0'
  FROM integration_tokens
 WHERE organization_id = (SELECT org_bob FROM t);

RESET ROLE;
DROP POLICY "tokens_mutacion_permisiva" ON public.integration_tokens;

-- ─────────────────────────────────────────────────────────────────────────────
-- 25. Una organización puede tener dos tokens vivos del mismo proveedor
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que revocar sirva de algo.
--
-- Parece una regla de prolijidad y no lo es. Si una organización puede tener dos
-- tokens de Google vivos a la vez, revocar uno deja el otro andando y el código
-- —que busca "el token de esta organización"— puede tomar cualquiera de los dos.
-- La revocación pasa a ser una anotación en una fila que nadie garantiza que sea
-- la que se usa.
--
-- Lo sostiene un índice único PARCIAL, `WHERE revoked_at IS NULL`: uno vivo, y
-- los revocados se acumulan para poder auditar quién tuvo acceso y hasta cuándo.
--
-- Existe porque una mutación sobrevivió: cambiar ese índice por uno común dejaba
-- los veinticuatro bloques en verde.

RESET ROLE;

INSERT INTO defect_report
SELECT 25, 'one organization can hold two live tokens for the same provider',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_tokens (organization_id, provider, secret_id, expires_at)
           VALUES (%L, 'google', %L, now() + interval '60 days')
       $sql$, (SELECT org_bob FROM t), (SELECT secret_id FROM tok))),
       'un segundo token de google, vivo, para la organización de bob';

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de la 0015 — un borrador de bob
-- ─────────────────────────────────────────────────────────────────────────────
RESET ROLE;

INSERT INTO content_assets (id, organization_id, business_id, locale, kind, title, body, status)
SELECT '77777777-7777-4777-8777-777777777777', org_bob,
       '44444444-4444-4444-8444-444444444444', 'en', 'post',
       'Bob post', 'cuerpo original', 'draft'
  FROM t;

-- ─────────────────────────────────────────────────────────────────────────────
-- 26. Un asset sin aprobar se puede publicar
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la puerta de F3, primera mitad — *un asset no aprobado NO PUEDE
-- publicarse aunque se llame la ruta directamente*.
--
-- El vocabulario de `status` existía desde la 0001 y no obligaba a nada: el CHECK
-- decía que 'published' se escribe así, no que se pueda llegar ahí. Un
-- `UPDATE ... SET status = 'published'` sobre un borrador pasaba.
--
-- Y se prueba por SQL directo, no por la aplicación, porque "aunque se llame la
-- ruta directamente" es literalmente el texto de la puerta: una regla que vive en
-- el código se saltea llamando a PostgREST.

INSERT INTO defect_report
SELECT 26, 'an unapproved asset can be published',
       pg_temp.accepted($sql$
           UPDATE content_assets SET status = 'published'
            WHERE id = '77777777-7777-4777-8777-777777777777'
       $sql$),
       'un borrador pasando directo a published, sin aprobación de nadie';

-- ─────────────────────────────────────────────────────────────────────────────
-- 27. Un cambio post-aprobación sigue publicable
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la segunda mitad de la puerta — *un cambio post-aprobación lo
-- devuelve a borrador*.
--
-- Es el defecto más caro de los dos: aprobar y después reescribir el cuerpo
-- publica algo que nadie leyó, con el sello de alguien que aprobó otra cosa. La
-- aprobación queda apuntando a un texto que ya no existe.
--
-- El bloque no mide el rechazo sino el ESTADO en el que queda la fila: el trigger
-- la devuelve a 'draft', y eso es lo que la espina pide. Que además sea imposible
-- publicarla es el bloque 28.

RESET ROLE;

-- Se aprueba de verdad: el hash de lo aprobado tiene que ser el del payload de
-- ese momento, o el CHECK rechaza la aprobación misma.
UPDATE content_assets
   SET status = 'approved',
       approved_by = '22222222-2222-4222-8222-222222222222',
       approved_at = now(),
       approved_hash = payload_hash
 WHERE id = '77777777-7777-4777-8777-777777777777';

-- Anti-vacuidad: si la aprobación no quedó, lo de abajo mide otra cosa.
DO $$
DECLARE st text;
BEGIN
    SELECT status INTO st FROM content_assets
     WHERE id = '77777777-7777-4777-8777-777777777777';
    IF st <> 'approved' THEN
        RAISE EXCEPTION
            'Vacuous check 27: el asset quedó en %, no en approved. '
            'Sin la aprobación puesta, el cambio de abajo no prueba nada.', st;
    END IF;
END
$$;

UPDATE content_assets SET body = 'cuerpo reescrito DESPUÉS de aprobar'
 WHERE id = '77777777-7777-4777-8777-777777777777';

INSERT INTO defect_report
SELECT 27, 'a post-approval edit keeps the asset publishable',
       status <> 'draft' OR approved_hash IS NOT NULL,
       'tras reescribir el cuerpo el asset quedó en ' || status ||
       ' con approved_hash ' || coalesce(approved_hash, 'NULL') ||
       '; debe quedar en draft y sin sello'
  FROM content_assets
 WHERE id = '77777777-7777-4777-8777-777777777777';

-- ─────────────────────────────────────────────────────────────────────────────
-- 28. La negativa del 26 y el 27 la sostiene un trigger, no el esquema
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que los dos bloques de arriba sigan significando algo el día que
-- alguien tire el trigger.
--
-- Es la misma pregunta que el bloque 9 le hace al bloque 5, y por el mismo
-- motivo: una negativa que depende de un trigger se cae en un `DROP TRIGGER` de
-- una línea, y la suite queda verde hasta que alguien lo note.
--
-- Acá el reparto es deliberado: el CHECK es la garantía y el trigger es la
-- comodidad. Sin trigger, un cambio post-aprobación se RECHAZA en vez de
-- degradarse — más estricto, no menos. Este bloque lo tira y comprueba que
-- publicar sigue siendo imposible.

RESET ROLE;
DROP TRIGGER trg_content_assets_reset_approval ON public.content_assets;

INSERT INTO content_assets (id, organization_id, business_id, locale, kind, title, body, status)
SELECT '88888888-8888-4888-8888-888888888888', org_bob,
       '44444444-4444-4444-8444-444444444444', 'en', 'post',
       'Otro post', 'otro cuerpo', 'draft'
  FROM t;

INSERT INTO defect_report
SELECT 28, 'without the trigger, an unapproved asset becomes publishable again',
       pg_temp.accepted($sql$
           UPDATE content_assets SET status = 'published'
            WHERE id = '88888888-8888-4888-8888-888888888888'
       $sql$),
       'con el trigger tirado, un borrador pasando a published: lo tiene que '
       'seguir impidiendo el CHECK, que es la garantía';

-- ─────────────────────────────────────────────────────────────────────────────
-- 29. Sin el trigger, un cambio post-aprobación queda publicable
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la mitad del CHECK que compara el hash aprobado con el actual, que
-- es la que impide publicar contenido que cambió después de aprobarse.
--
-- Corre en la misma ventana sin trigger que el 28, y por eso está acá y no más
-- arriba: con el trigger puesto, editar degrada la fila a borrador y el CHECK
-- nunca llega a opinar. Sacado el trigger, la única defensa que queda es la
-- comparación de hashes — y esta es la única forma de ejercitarla.
--
-- Existe porque una mutación sobrevivió: cambiar `approved_hash = payload_hash`
-- por `true` dejaba los veintiocho bloques en verde.

INSERT INTO content_assets (id, organization_id, business_id, locale, kind, title, body, status)
SELECT '99999999-9999-4999-8999-999999999999', org_bob,
       '44444444-4444-4444-8444-444444444444', 'en', 'post',
       'Tercer post', 'cuerpo aprobado', 'draft'
  FROM t;

UPDATE content_assets
   SET status = 'approved',
       approved_by = '22222222-2222-4222-8222-222222222222',
       approved_at = now(),
       approved_hash = payload_hash
 WHERE id = '99999999-9999-4999-8999-999999999999';

INSERT INTO defect_report
SELECT 29, 'without the trigger, an edited-after-approval asset stays publishable',
       pg_temp.accepted($sql$
           UPDATE content_assets SET body = 'cuerpo cambiado sin que nadie lo apruebe'
            WHERE id = '99999999-9999-4999-8999-999999999999'
       $sql$),
       'sin trigger, reescribir el cuerpo de un asset aprobado: lo tiene que '
       'rechazar el CHECK, comparando el hash aprobado con el actual';

CREATE TRIGGER trg_content_assets_reset_approval
    BEFORE UPDATE ON public.content_assets
    FOR EACH ROW
    EXECUTE FUNCTION public.content_assets_reset_approval();

-- ─────────────────────────────────────────────────────────────────────────────
-- 30. Un borrador puede arrastrar el sello de una aprobación vieja
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la otra mitad del CHECK, la rama ELSE. Un estado que no implica
-- aprobación no puede conservar `approved_hash`, `approved_by` ni `approved_at`.
--
-- Si pudiera, el camino para saltear la revisión sería trivial: bajar a
-- 'draft' con el sello puesto y volver a subir. La aprobación se convierte en
-- algo que se consigue una vez y vale para siempre.
--
-- Existe porque una mutación sobrevivió: reemplazar esa rama por `true` dejaba
-- los veintinueve bloques en verde.

RESET ROLE;

INSERT INTO defect_report
SELECT 30, 'a draft can carry the seal of an old approval',
       pg_temp.accepted($sql$
           UPDATE content_assets
              SET status = 'draft',
                  approved_hash = payload_hash,
                  approved_by = '22222222-2222-4222-8222-222222222222',
                  approved_at = now()
            WHERE id = '99999999-9999-4999-8999-999999999999'
       $sql$),
       'un borrador conservando approved_hash, approved_by y approved_at';

-- ─────────────────────────────────────────────────────────────────────────────
-- 31. Se puede aprobar sin que quede quién aprobó
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la aprobación tenga dueño. La puerta de F4 pide *registro de
-- quién aprobó qué y cuándo*, y sin esto la 0015 dejaría aprobar con el hash
-- puesto y la firma vacía — una aprobación que nadie hizo.
--
-- Existe porque una mutación sobrevivió: sacarle al CHECK las dos condiciones de
-- `approved_by` y `approved_at` no rompía ningún bloque, porque todos los demás
-- aprueban bien.

INSERT INTO content_assets (id, organization_id, business_id, locale, kind, title, body, status)
SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', org_bob,
       '44444444-4444-4444-8444-444444444444', 'en', 'post',
       'Cuarto post', 'cuerpo cuatro', 'draft'
  FROM t;

INSERT INTO defect_report
SELECT 31, 'an asset can be approved with nobody recorded as the approver',
       pg_temp.accepted($sql$
           UPDATE content_assets
              SET status = 'approved', approved_hash = payload_hash
            WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
       $sql$),
       'aprobando con el hash puesto y approved_by/approved_at vacíos';

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de la 0016 — un asset de bob aprobado de verdad
-- ─────────────────────────────────────────────────────────────────────────────
RESET ROLE;

INSERT INTO content_assets (id, organization_id, business_id, locale, kind, title, body, status)
SELECT 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', org_bob,
       '44444444-4444-4444-8444-444444444444', 'en', 'post',
       'Post publicable', 'cuerpo aprobado y publicable', 'draft'
  FROM t;

UPDATE content_assets
   SET status = 'approved',
       approved_by = '22222222-2222-4222-8222-222222222222',
       approved_at = now(),
       approved_hash = payload_hash
 WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

INSERT INTO publications (organization_id, asset_id, approved_hash, destination,
                          external_id, status, published_at, attempts)
SELECT org_bob, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
       (SELECT approved_hash FROM content_assets
         WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
       'google_business_profile', 'gbp-post-0001', 'published', now(), 1
  FROM t;

-- ─────────────────────────────────────────────────────────────────────────────
-- 32. Un reintento duplica el post en la cuenta del cliente
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la parte de la puerta de F4 que dice *un reintento que demuestre que
-- no duplica*.
--
-- Es una promesa que el código no puede sostener solo. Dos procesos que consultan
-- "¿ya lo publiqué?" y después insertan pasan LOS DOS por el `if`, y el cliente
-- termina con el mismo post dos veces en su ficha. La única forma de que la
-- promesa sea cierta es que la base rechace el segundo.

INSERT INTO defect_report
SELECT 32, 'a retry duplicates the post in the client''s account',
       pg_temp.accepted($sql$
           INSERT INTO publications (organization_id, asset_id, approved_hash,
                                     destination, status, attempts)
           SELECT organization_id, id, approved_hash, 'google_business_profile', 'pending', 2
             FROM content_assets WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
       $sql$),
       'un segundo intento de publicar el mismo asset en el mismo destino';

-- ─────────────────────────────────────────────────────────────────────────────
-- 33. Dos publicaciones pueden reclamar el mismo post de la red
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el id que devolvió la red identifique UNA publicación.
--
-- El bloque 32 cuida el lado de acá —un asset, un destino—; éste cuida el lado de
-- allá. Sin él, dos filas distintas pueden decir que son el post `gbp-post-0001`,
-- y borrar una dejaría la otra apuntando a algo que ya no existe. Un reintento
-- que crea una fila NUEVA con el id viejo es exactamente esa forma.

INSERT INTO content_assets (id, organization_id, business_id, locale, kind, title, body, status)
SELECT 'dddddddd-2222-4ddd-8ddd-dddddddddddd', org_bob,
       '44444444-4444-4444-8444-444444444444', 'en', 'post',
       'Otro publicable', 'otro cuerpo aprobado', 'draft'
  FROM t;

UPDATE content_assets
   SET status = 'approved',
       approved_by = '22222222-2222-4222-8222-222222222222',
       approved_at = now(),
       approved_hash = payload_hash
 WHERE id = 'dddddddd-2222-4ddd-8ddd-dddddddddddd';

INSERT INTO defect_report
SELECT 33, 'two publications can claim the same post on the network',
       pg_temp.accepted($sql$
           INSERT INTO publications (organization_id, asset_id, approved_hash,
                                     destination, external_id, status, published_at)
           SELECT organization_id, id, approved_hash, 'google_business_profile',
                  'gbp-post-0001', 'published', now()
             FROM content_assets WHERE id = 'dddddddd-2222-4ddd-8ddd-dddddddddddd'
       $sql$),
       'otro asset reclamando el id gbp-post-0001, que ya es de una publicación';

-- ─────────────────────────────────────────────────────────────────────────────
-- 34. Se puede publicar un asset que nadie aprobó
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la garantía de la 0015 llegue hasta el ledger.
--
-- La 0015 impide que el ASSET llegue a 'published'. Esto es otra tabla: sin la FK
-- compuesta contra `(id, approved_hash)`, se podría anotar la publicación de un
-- borrador y el registro diría que salió algo que nunca se aprobó — que es
-- justamente el registro que la puerta de F4 pide que exista.

INSERT INTO content_assets (id, organization_id, business_id, locale, kind, title, body, status)
SELECT 'eeeeeeee-3333-4eee-8eee-eeeeeeeeeeee', org_bob,
       '44444444-4444-4444-8444-444444444444', 'en', 'post',
       'Borrador', 'sin aprobar', 'draft'
  FROM t;

INSERT INTO defect_report
SELECT 34, 'an asset nobody approved can be published',
       pg_temp.accepted($sql$
           INSERT INTO publications (organization_id, asset_id, approved_hash,
                                     destination, status)
           SELECT organization_id, id, 'un-hash-inventado', 'google_business_profile', 'pending'
             FROM content_assets WHERE id = 'eeeeeeee-3333-4eee-8eee-eeeeeeeeeeee'
       $sql$),
       'publicando un borrador, con un hash que ninguna aprobación produjo';

-- ─────────────────────────────────────────────────────────────────────────────
-- 35. Una publicación puede decir 'published' sin haber salido
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que 'published' signifique algo. Sin el id que devolvió la red y sin
-- fecha, la fila dice que el post salió y no hay forma de ir a buscarlo, ni de
-- borrarlo, ni de saber cuándo fue.
--
-- Es el mismo defecto de clase que #46 arregló en el reporte: un estado que
-- tranquiliza sin respaldarse en nada.

INSERT INTO defect_report
SELECT 35, 'a publication can claim ''published'' without having gone out',
       pg_temp.accepted($sql$
           INSERT INTO publications (organization_id, asset_id, approved_hash,
                                     destination, status)
           SELECT organization_id, id, approved_hash, 'google_business_profile', 'published'
             FROM content_assets WHERE id = 'dddddddd-2222-4ddd-8ddd-dddddddddddd'
       $sql$),
       'una publicación en published, sin external_id ni published_at';

-- ─────────────────────────────────────────────────────────────────────────────
-- 36. Un tenant llega al registro de publicaciones de otro
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el eje de organización valga también en el ledger. Dice qué
-- publica cada cliente, cuándo y con qué id en la red — o sea su calendario de
-- contenido y sus posts, que es de las cosas más sensibles que guarda el sistema.
--
-- Existe porque una mutación sobrevivió: sacarle el `ENABLE ROW LEVEL SECURITY` a
-- `publications` dejaba los treinta y cinco bloques en verde. El bloque 6, que
-- mide FORCE, sólo mira tablas que YA tienen RLS activo, así que una tabla sin
-- RLS del todo se le escapa por definición — su ausencia se lee igual que la
-- corrección, que es la trampa del bloque 12 en otra forma.
--
-- grace no es de ninguna organización salvo la suya, como en el bloque 20.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 36, 'a tenant can reach another tenant''s publication ledger',
       count(*) > 0,
       'grace ve ' || count(*) || ' publicaciones de bob; debe ver 0'
  FROM publications;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de la 0017 — el mapeo vivo de bob
-- ─────────────────────────────────────────────────────────────────────────────
-- Dos superficies, porque los bloques de abajo necesitan las dos formas: la de
-- GA4, que es un identificador opaco, y la de Search Console, que es una URL y
-- es la que se escribe mal.
RESET ROLE;

INSERT INTO integration_properties (organization_id, provider, property_ref)
SELECT org_bob, 'ga4', 'properties/123456789' FROM t;
INSERT INTO integration_properties (organization_id, provider, property_ref)
SELECT org_bob, 'search_console', 'https://bob.example/' FROM t;

-- ─────────────────────────────────────────────────────────────────────────────
-- 37. Un tenant llega al mapeo de propiedades de otro
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: el eje de organización sobre la tabla que, con un token de agencia,
-- ES la frontera entre clientes. La 0017 existe porque hay UN SOLO token OAuth
-- —el de la cuenta de Vulkan, con permiso delegado sobre las propiedades de
-- todos los clientes— así que lo único que decide de quién son los números de un
-- reporte es qué property se consultó.
--
-- Leer el mapeo ajeno no es curiosidad: es saber qué property ID pedirle a la
-- API que ya te contesta por todos.
--
-- grace no es de ninguna organización salvo la suya, igual que en los bloques 20
-- y 36, y por el mismo motivo: alice tiene desde el bloque 5 una membresía en la
-- organización de bob, así que un bloque escrito con alice mediría esa membresía
-- y no el aislamiento.
--
-- Y cuenta las filas DE BOB, no todas las que grace alcanza. La diferencia la
-- destapó una mutación: con la escritura devuelta a `growthos_app`, el bloque 38
-- consigue insertar un mapeo para la organización DE GRACE, y un bloque que
-- cuente todo lo visible se enciende contando esa fila mientras dice "grace ve N
-- mapeos de bob". Sería el defecto del bloque 20 otra vez —medir un fixture que
-- el propio archivo sembró— y con un agravante: se encendería sólo cuando OTRO
-- bloque ya está en rojo, o sea justo cuando su evidencia se lee y miente.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 37, 'a tenant can reach another tenant''s property mapping',
       count(*) > 0,
       'grace ve ' || count(*) || ' mapeos de bob; debe ver 0'
  FROM integration_properties
 WHERE organization_id = (SELECT org_bob FROM t);

-- ─────────────────────────────────────────────────────────────────────────────
-- 38. El rol del navegador puede escribir un mapeo
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la escalada que ninguna policy puede ver, y es la razón por la que
-- este bloque importa MÁS que su equivalente sobre tokens y no menos.
--
-- Una sesión de navegador capaz de INSERTAR acá apunta SU organización a la
-- property de OTRO cliente. La fila resultante es suya: `organization_id` es el
-- de ella, la policy la aprueba sin objeciones, la RESTRICTIVE también. Nada en
-- la base está mal. Y a partir de ahí el token de agencia —que llega a las dos
-- propiedades— le sirve los datos ajenos en su propio reporte.
--
-- El aislamiento se cumple sobre la FILA y la fuga ocurre en el CONTENIDO, así
-- que el único lugar donde esto se cierra es el privilegio. La 0017 le da a
-- `authenticated` sólo SELECT, y `supabase/qa/app_role.sql` le quita a
-- `growthos_app` lo que su GRANT sobre ALL TABLES le devolvería.
--
-- grace intenta mapear para su PROPIA organización, que es el caso legítimo en
-- apariencia. Tiene que ser rechazado igual.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 38, 'the browser-side role can write a property mapping',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_properties (organization_id, provider, property_ref)
           VALUES (%L, 'ga4', 'properties/999888777')
       $sql$, (SELECT organization_id FROM org_members
                WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'))),
       'grace, desde una sesión de navegador, mapeando para su PROPIA organización';

-- ─────────────────────────────────────────────────────────────────────────────
-- 39. Una policy permisiva nueva ensancha el acceso al mapeo
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo único que compra la policy RESTRICTIVE, que es sobrevivir a la
-- PRÓXIMA policy. Las permisivas se combinan con OR, así que agregar una más
-- laxa ensancha el acceso — y así es como esto se rompe de verdad: alguien
-- agrega una policy para un caso nuevo y se lleva puesto el aislamiento.
--
-- Igual que el bloque 24 sobre tokens, y está escrito aparte por el mismo
-- motivo: la permisiva sola también aísla HOY, así que sin este bloque borrar la
-- RESTRICTIVA deja todo en verde.

RESET ROLE;
CREATE POLICY "properties_mutacion_permisiva" ON public.integration_properties
    FOR SELECT USING (true);

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 39, 'a new permissive policy widens access to another tenant''s property mapping',
       count(*) > 0,
       'con una policy USING (true) agregada, grace ve ' || count(*) ||
       ' mapeos de bob; debe seguir viendo 0'
  FROM integration_properties
 WHERE organization_id = (SELECT org_bob FROM t);

RESET ROLE;
DROP POLICY "properties_mutacion_permisiva" ON public.integration_properties;

-- ─────────────────────────────────────────────────────────────────────────────
-- 40. Dos organizaciones pueden apuntar a la misma property
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la fuga entera, en su forma más directa. Es el bloque por el que
-- existe la 0017.
--
-- Con un token por cliente, mapear mal no llega a ningún lado: el token no tiene
-- permiso sobre lo ajeno. Con un token de agencia lo tiene sobre TODO, así que
-- dos organizaciones apuntadas a la misma property es un cliente viendo los
-- números de otro, entregados por la base sin una sola violación de RLS.
--
-- Y tiene que ser una RESTRICCIÓN, no un `if`. "Comprobar que nadie más tenga
-- esta property" es un SELECT seguido de un INSERT, y dos onboardings
-- concurrentes pasan los dos por el `if` — el mismo argumento que la 0016 hace
-- sobre la idempotencia de publicar, con un precio peor: allá el cliente ve un
-- post repetido, acá ve las métricas de otro.
--
-- Se intenta como `postgres`, o sea sin RLS de por medio y con todos los
-- privilegios. Si esto lo frenara una policy en vez del índice, el bloque
-- pasaría por el motivo equivocado: `service_role` mapea legítimamente durante
-- el onboarding y no está sujeto a la policy de miembro.

RESET ROLE;

INSERT INTO defect_report
SELECT 40, 'two organizations can hold the same live property',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_properties (organization_id, provider, property_ref)
           VALUES (%L, 'ga4', 'properties/123456789')
       $sql$, (SELECT org_alice FROM t))),
       'la organización de alice reclamando la property de GA4 que ya es de bob';

-- ─────────────────────────────────────────────────────────────────────────────
-- 41. Una organización puede tener dos mapeos vivos del mismo proveedor
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que "el mapeo de esta organización" identifique algo.
--
-- Parece prolijidad y no lo es. Con dos properties de GA4 vivas para el mismo
-- cliente, el código que busca su mapeo recibe dos filas y toma la que la base
-- devuelva primero: la mitad de los reportes salen con los números del sitio
-- equivocado DEL MISMO cliente. No es una fuga entre tenants, y por eso el
-- bloque 40 no lo cubre — pero es un reporte que dice cosas falsas.
--
-- Mismo argumento que el bloque 25 hace sobre dos tokens vivos.

RESET ROLE;

INSERT INTO defect_report
SELECT 41, 'one organization can hold two live mappings for the same provider',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_properties (organization_id, provider, property_ref)
           VALUES (%L, 'ga4', 'properties/555444333')
       $sql$, (SELECT org_bob FROM t))),
       'un segundo mapeo de GA4, vivo, para la organización de bob';

-- ─────────────────────────────────────────────────────────────────────────────
-- 42. Una referencia con una forma que ninguna API produce entra igual
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la unicidad del bloque 40 signifique algo. Una unicidad sobre
-- texto libre se saltea escribiendo lo mismo de otra manera: `123456` y
-- `properties/123456` son la misma property para Google y dos filas distintas
-- para PostgreSQL. La fuga entra por la ortografía, y ningún índice se entera.
--
-- Los dos casos son los dos que se escriben mal:
--
--   * GA4 sin el prefijo `properties/`, que es como lo muestra la interfaz de
--     Google Analytics y como lo copia una persona;
--   * Search Console sin la barra final. La API devuelve las propiedades de
--     prefijo de URL SIEMPRE con la barra, así que `https://ejemplo.com` es un
--     valor que ninguna respuesta produce y que un humano escribe todo el tiempo.

RESET ROLE;

INSERT INTO defect_report
SELECT 42, 'a property reference in a form no API produces is accepted',
       ga4_pelado OR sc_sin_barra,
       CASE
         WHEN ga4_pelado AND sc_sin_barra THEN 'entran las dos: GA4 sin prefijo y Search Console sin barra final'
         WHEN ga4_pelado  THEN 'entra un GA4 sin el prefijo properties/'
         WHEN sc_sin_barra THEN 'entra una URL de Search Console sin la barra final'
         ELSE 'las dos formas no canónicas se rechazan'
       END
  FROM (
    SELECT
      pg_temp.accepted(format($sql$
          INSERT INTO integration_properties (organization_id, provider, property_ref)
          VALUES (%L, 'ga4', '123456789')
      $sql$, (SELECT org_alice FROM t))) AS ga4_pelado,
      pg_temp.accepted(format($sql$
          INSERT INTO integration_properties (organization_id, provider, property_ref)
          VALUES (%L, 'search_console', 'https://alice.example')
      $sql$, (SELECT org_alice FROM t))) AS sc_sin_barra
  ) q;

-- ─────────────────────────────────────────────────────────────────────────────
-- 43. La unicidad se saltea con la tecla de mayúsculas
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: el bloque 40, otra vez, contra la variante que sí pasa el CHECK de
-- forma del bloque 42.
--
-- Los hosts no distinguen mayúsculas: `https://BOB.example/` y
-- `https://bob.example/` son el mismo sitio para Google y dos textos distintos
-- para PostgreSQL. Una unicidad sobre la columna pelada los deja convivir, y las
-- dos organizaciones quedan apuntadas al mismo lugar sin que nada avise.
--
-- Por eso el índice es sobre `lower(property_ref)`. El esquema queda por eso más
-- estricto de lo que Google exige —la RUTA de una URL sí distingue mayúsculas,
-- así que dos rutas que sólo difieren en eso se rechazan aunque técnicamente
-- podrían ser dos sitios— y es la dirección correcta del error: rechazar un
-- mapeo es una molestia de onboarding, compartirlo es una fuga entre clientes.
--
-- El esquema de la URL va en minúsculas a propósito: `HTTPS://` lo rechazaría el
-- CHECK de forma, y el bloque pasaría por el bloque de al lado en vez de por el
-- índice.

RESET ROLE;

INSERT INTO defect_report
SELECT 43, 'the uniqueness is bypassed by changing the case of the reference',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_properties (organization_id, provider, property_ref)
           VALUES (%L, 'search_console', 'https://BOB.example/')
       $sql$, (SELECT org_alice FROM t))),
       'la organización de alice reclamando el sitio de bob con otras mayúsculas';

-- ─────────────────────────────────────────────────────────────────────────────
-- 44. Un proveedor nuevo entra sin ninguna comprobación de forma
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: el `ELSE false` del CHECK de forma, que es la única línea de la
-- 0017 que protege contra una migración FUTURA.
--
-- El CASE del CHECK tiene una rama por proveedor. El día que alguien agregue un
-- cuarto al vocabulario y se olvide de agregarle su rama, con `ELSE true` esa
-- superficie entraría sin ninguna comprobación de forma y nada lo diría —
-- volvería el bloque 42 a ser mentira para el proveedor nuevo. Con `ELSE false`
-- no entra nada hasta que alguien escriba la rama.
--
-- Un CHECK que devuelve NULL PASA, además, así que el `ELSE` no es opcional:
-- sacarlo entero es equivalente a ponerlo en true.
--
-- Se mide tirando el CHECK del vocabulario y volviendo a preguntar, como hace el
-- bloque 28 con el trigger de aprobación: con el vocabulario puesto, un proveedor
-- nuevo lo frena ÉL, y el `ELSE` no se llega a evaluar nunca. La pregunta que
-- este bloque hace es qué queda cuando el vocabulario se ensancha, que es
-- exactamente lo que pasa el día que alguien agregue el cuarto proveedor.

RESET ROLE;
ALTER TABLE public.integration_properties
    DROP CONSTRAINT integration_properties_provider_check;

CREATE TEMP TABLE step44 AS SELECT pg_temp.accepted(format($sql$
    INSERT INTO integration_properties (organization_id, provider, property_ref)
    VALUES (%L, 'bing_webmaster', 'cualquier cosa sin forma')
$sql$, (SELECT org_alice FROM t))) AS entro;

-- La fila de sonda se borra ANTES de reponer el vocabulario, y el orden no es
-- prolijidad. Lo dijo una mutación: con `ELSE true` la fila entra, y entonces el
-- `ADD CONSTRAINT` de abajo no puede validarse con ella adentro. El archivo moría
-- acá con `check constraint ... is violated by some row`, o sea informando un
-- error de psql en el lugar exacto donde acababa de medir el defecto — y sin
-- llegar nunca al reporte, así que el número 44 no aparecía por ningún lado.
--
-- Es la forma que toma acá la regla que `pg_temp.accepted` existe para cumplir:
-- un bloque que no sobrevive a que su defecto esté VIVO no mide nada, aborta.
DELETE FROM public.integration_properties WHERE provider = 'bing_webmaster';

ALTER TABLE public.integration_properties
    ADD CONSTRAINT integration_properties_provider_check
    CHECK (provider IN ('ga4', 'search_console', 'google_business_profile'));

INSERT INTO defect_report
SELECT 44, 'a provider with no shape branch is accepted with no shape check at all',
       (SELECT entro FROM step44),
       'un proveedor sin rama en el CASE, con una referencia de forma arbitraria';

-- ─────────────────────────────────────────────────────────────────────────────
-- 45. El rol `authenticated` de Supabase puede escribir un mapeo
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo mismo que el bloque 38, sobre el rol que la MIGRACIÓN nombra.
--
-- El 38 mide `growthos_app`, y el privilegio que lo frena no está en la 0017:
-- está en `supabase/qa/app_role.sql`, que es un archivo de QA. Medido el
-- 2026-08-29: cambiar la 0017 a `GRANT SELECT, INSERT, UPDATE, DELETE ON
-- public.integration_properties TO authenticated` deja la suite ENTERA EN VERDE,
-- porque ningún bloque le pregunta nada a `authenticated`.
--
-- O sea que la línea de la 0017 que sostiene todo el argumento —una sesión de
-- navegador no puede apuntar su organización a la property de otro cliente— se
-- podía borrar en una migración y llegar a producción sin que nada lo dijera.
-- Es la forma exacta de «la suite medía la réplica, no el producto».
--
-- CÓMO ESTÁ CONSTRUIDO, Y POR QUÉ NO ALCANZA CON COPIAR EL 38
--
-- La organización se resuelve ANTES de cambiar de rol, y se comprueba que no sea
-- NULL. Si se resolviera adentro del INSERT como `authenticated`, una lectura
-- vacía daría `VALUES (NULL, ...)`, el NOT NULL rechazaría la fila, y el bloque
-- pasaría en verde midiendo el NOT NULL en vez del privilegio: verde por el
-- motivo equivocado, que es peor que rojo.
--
-- Y grace mapea para su PROPIA organización, igual que en el 38: es el caso que
-- parece legítimo. Tiene que ser rechazado igual, y por el privilegio, porque la
-- fila es suya y ninguna policy tiene nada que objetarle.

RESET ROLE;

CREATE TEMP TABLE org45 AS
SELECT organization_id FROM public.org_members
 WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

DO $$
BEGIN
    IF (SELECT count(*) FROM org45) <> 1 OR (SELECT organization_id FROM org45) IS NULL THEN
        RAISE EXCEPTION 'el fixture de grace no resolvió una organización: el bloque 45 mediría el NOT NULL';
    END IF;
END
$$;

-- El INSERT se arma acá, todavía como `postgres`, y el resultado viaja por un
-- GUC de transacción. Es para NO tocarle los privilegios a `authenticated`: el
-- bloque 38 puede escribir en `defect_report` porque el encabezado le da
-- `GRANT ALL` a `growthos_app`, y darle lo mismo a `authenticated` sería
-- ensancharle los permisos al rol que este bloque mide, en el mismo archivo que
-- lo mide. Un GUC local no le otorga nada.
SELECT set_config('qa.sql45', format($sql$
    INSERT INTO integration_properties (organization_id, provider, property_ref)
    VALUES (%L, 'ga4', 'properties/777666555')
$sql$, (SELECT organization_id FROM org45)), true);

SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b45', pg_temp.accepted(current_setting('qa.sql45'))::text, true);
RESET ROLE;

INSERT INTO defect_report
SELECT 45, 'the authenticated role itself can write a property mapping',
       current_setting('qa.b45')::boolean,
       'grace, como `authenticated` y no como el rol de la réplica, mapeando para su PROPIA organización';

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de la 0018 — un contacto de bob y un evento de ingesta
-- ─────────────────────────────────────────────────────────────────────────────
RESET ROLE;

INSERT INTO contacts (organization_id, business_id, display_name, email, phone, country, source)
SELECT org_bob, '44444444-4444-4444-8444-444444444444',
       'Bob Contacto', 'bob@bob.example', '+46700000000', 'SE', 'apify:google-maps'
  FROM t;

INSERT INTO ingest_events (source_system, idempotency_key, event, organization_id)
SELECT 'vulkan-lead-engine', 'vulkan-lead-engine:lead:00000000-0000-4000-8000-00000000b0b0',
       'lead.won', org_bob
  FROM t;

-- ─────────────────────────────────────────────────────────────────────────────
-- 46. Un tenant llega a los contactos de otro
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la tabla de la 0018 que guarda DATOS DE PERSONAS — nombre, correo,
-- teléfono— y, sobre todo, `source`: de dónde salió cada contacto. Ése es el
-- campo que hay que poder contestar cuando alguien ejerce un derecho de GDPR, y
-- es el que convierte una fuga acá en algo peor que una fuga de métricas.
--
-- grace, y no alice, por lo mismo que en los bloques 20, 36 y 37: alice tiene
-- desde el bloque 5 una membresía en la organización de bob, así que un bloque
-- escrito con alice mediría esa membresía y no el aislamiento.
--
-- Y cuenta los contactos DE BOB, no todos los que grace alcanza, por lo mismo
-- que el 37: un bloque que cuente todo lo visible se enciende contando una fila
-- propia de grace si otro bloque le devolvió la escritura — o sea que mentiría
-- justo cuando alguien va a leer su evidencia.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 46, 'a tenant can reach another tenant''s contacts',
       count(*) > 0,
       'grace ve ' || count(*) || ' contactos de bob; debe ver 0'
  FROM contacts
 WHERE organization_id = (SELECT org_bob FROM t);

-- ─────────────────────────────────────────────────────────────────────────────
-- 47. Una policy permisiva nueva ensancha el acceso a los contactos
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo único que compra la policy RESTRICTIVE, que es sobrevivir a la
-- PRÓXIMA policy. Las permisivas se combinan con OR, así que agregar una más
-- laxa ensancha el acceso — y así es como esto se rompe de verdad: alguien
-- agrega una policy para un caso nuevo y se lleva puesto el aislamiento.
--
-- Va aparte del 46 por el mismo motivo que el 39 va aparte del 37: la permisiva
-- sola también aísla HOY, así que sin este bloque borrar la RESTRICTIVA de la
-- 0018 deja todo en verde.

RESET ROLE;
CREATE POLICY "contacts_mutacion_permisiva" ON public.contacts
    FOR SELECT USING (true);

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 47, 'a new permissive policy widens access to another tenant''s contacts',
       count(*) > 0,
       'con una policy USING (true) agregada, grace ve ' || count(*) ||
       ' contactos de bob; debe seguir viendo 0'
  FROM contacts
 WHERE organization_id = (SELECT org_bob FROM t);

RESET ROLE;
DROP POLICY "contacts_mutacion_permisiva" ON public.contacts;

-- ─────────────────────────────────────────────────────────────────────────────
-- 48. El rol del navegador puede escribir en el registro de ingesta
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que una sesión de navegador no pueda hacer desaparecer el cliente
-- de otro, en silencio y sin violar ninguna restricción.
--
-- `ingest_events` no tiene RLS: es una tabla de la plataforma, como
-- `schema_migrations`. Todo su aislamiento es el privilegio, y `app_role.sql` se
-- lo tiene que revocar porque su `GRANT ... ON ALL TABLES` se lo devuelve.
--
-- La escalada es ésta, y no se parece a un ataque: alguien inserta la clave
-- `vulkan-lead-engine:lead:<uuid ajeno>` ANTES de que llegue esa entrega. Cuando
-- llega, la unicidad hace exactamente lo que existe para hacer —rechazar el
-- segundo— sólo que el segundo es el verdadero. El cliente nunca se crea, y del
-- lado del productor la entrega figura entregada. Un cliente perdido sin un solo
-- error en ningún log.
--
-- grace inserta una clave que no colisiona con nada, que es el caso que parece
-- inocuo. Tiene que ser rechazado igual, y por el privilegio.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

INSERT INTO defect_report
SELECT 48, 'the browser-side role can write the ingest ledger',
       pg_temp.accepted(format($sql$
           INSERT INTO ingest_events (source_system, idempotency_key, event, organization_id)
           VALUES ('vulkan-lead-engine', 'vulkan-lead-engine:lead:deadbeef', 'lead.won', %L)
       $sql$, (SELECT organization_id FROM org_members
                WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'))),
       'grace, desde una sesión de navegador, reclamando una clave de idempotencia';

-- ─────────────────────────────────────────────────────────────────────────────
-- 49. El rol `authenticated` puede LEER el registro de ingesta
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la otra dirección, sobre el rol que la migración nombra.
--
-- Es la lección del bloque 45 aplicada a la tabla nueva. El 48 mide
-- `growthos_app`, cuyo privilegio lo pone `app_role.sql` —un archivo de QA—; la
-- `0018` le declara a `authenticated` NADA, y eso no lo mediría nadie.
--
-- Y mide LEER, no escribir, porque acá leer ya es la fuga: `ingest_events` no
-- tiene RLS, así que un SELECT devuelve la lista de qué clientes entraron y
-- cuándo, para toda la plataforma, sin filtrar por nadie. Es el único caso de
-- este archivo donde el defecto es un SELECT que funciona.
--
-- El resultado viaja por un GUC de transacción: `authenticated` no puede
-- escribir en `defect_report` y darle ese permiso sería ensancharle los
-- privilegios al rol que este bloque mide, en el mismo archivo que lo mide. Es
-- la misma construcción del bloque 45.

RESET ROLE;
SELECT set_config('qa.sql49', 'SELECT count(*) FROM public.ingest_events', true);

SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b49', pg_temp.accepted(current_setting('qa.sql49'))::text, true);
RESET ROLE;

INSERT INTO defect_report
SELECT 49, 'the authenticated role can read the ingest ledger',
       current_setting('qa.b49')::boolean,
       'grace, como `authenticated`, leyendo qué clientes entraron y cuándo en toda la plataforma';

-- ─────────────────────────────────────────────────────────────────────────────
-- 50. El rol del navegador puede ejecutar la ingesta
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que una función `SECURITY DEFINER` no sea una manera de saltear la
-- RLS con más pasos.
--
-- `ingest_lead_won` corre como su dueño y escribe en cinco tablas sin que
-- ninguna policy la mire — tiene que ser así, porque crea la organización cuyo
-- eje de tenant recién existe al terminar. Eso la vuelve exactamente el objeto
-- que NO puede quedar al alcance de una sesión de navegador: quien la ejecuta
-- crea organizaciones, negocios y contactos a voluntad, y ninguna RLS tiene nada
-- que objetar porque la función no está sujeta a ellas.
--
-- Se mide con una llamada que tiene que fallar por PRIVILEGIO. Los argumentos
-- son deliberadamente basura: si el privilegio no la frena, la llamada llegaría
-- a ejecutarse, y lo que este bloque afirma es que ni siquiera llega.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

-- Y se afirma sobre el SQLSTATE, no sobre «falló». Con `accepted()` este bloque
-- pasaba en verde mientras la función era ejecutable por todos: la frenaba el
-- CHECK del slug con 23514, no el privilegio. El defecto es cualquier cosa que
-- NO sea 42501 — incluido que la llamada funcione.
CREATE TEMP TABLE step50 AS SELECT pg_temp.sqlstate_of($sql$
    SELECT public.ingest_lead_won(
        'x', 'x', NULL, 'x', 'x', 'en', 'x', 'x', '', 'other',
        '{}'::jsonb, '{}'::jsonb)
$sql$) AS estado;

INSERT INTO defect_report
SELECT 50, 'the browser-side role can execute the lead ingest',
       (SELECT estado IS DISTINCT FROM '42501' FROM step50),
       'grace, desde una sesión de navegador, llamando a la función que crea organizaciones: SQLSTATE=' ||
       coalesce((SELECT estado FROM step50), 'ninguno, la llamada pasó') ||
       ' (se espera 42501, insufficient_privilege)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 51. El rol `authenticated` puede ejecutar la ingesta
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo mismo, sobre el rol que la migración nombra.
--
-- Es la lección del bloque 45 por tercera vez, y acá pesa más que en ninguna: en
-- PostgreSQL una función nace con `EXECUTE` para `PUBLIC`, así que **el
-- privilegio por defecto es el peligroso**. La 0019 escribe
-- `REVOKE ALL ON FUNCTION ... FROM PUBLIC` justamente por eso, y si esa línea
-- desaparece nada más lo diría: el bloque 50 mide `growthos_app`, cuyo alcance lo
-- decide `app_role.sql`, un archivo de QA.
--
-- El resultado viaja por un GUC de transacción, como en el 45 y el 49:
-- `authenticated` no puede escribir en `defect_report`, y darle ese permiso sería
-- ensancharle los privilegios al rol que este bloque mide.

RESET ROLE;
SELECT set_config('qa.sql51', $sql$
    SELECT public.ingest_lead_won(
        'x', 'x', NULL, 'x', 'x', 'en', 'x', 'x', '', 'other',
        '{}'::jsonb, '{}'::jsonb)
$sql$, true);

SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b51', coalesce(pg_temp.sqlstate_of(current_setting('qa.sql51')), 'paso'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 51, 'the authenticated role can execute the lead ingest',
       current_setting('qa.b51') IS DISTINCT FROM '42501',
       'grace, como `authenticated`, llamando a una función SECURITY DEFINER: SQLSTATE=' ||
       current_setting('qa.b51') || ' (se espera 42501, insufficient_privilege)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 52. Una corrida completada puede no tener costo
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que «registro de coste» sea una restricción y no una costumbre.
--
-- R5 pide un único módulo de egreso de IA CON registro de coste. La parte que se
-- pierde sola es la segunda: un módulo que anota el costo cuando el que lo
-- escribe se acuerda anota una intención, y el primer camino agregado con prisa
-- la pierde sin que nada lo diga.
--
-- El modo de fallo no es ruidoso, y por eso hace falta un bloque. La fila entra,
-- el reporte de gasto suma un poco menos, y nadie se entera hasta que la factura
-- del proveedor no coincide con la contabilidad propia. **Un total que se queda
-- corto no llama la atención de nadie.**
--
-- Se intenta como `postgres`, sin RLS de por medio: lo que se mide es la
-- RESTRICCIÓN, no una policy. Si esto lo frenara el aislamiento en vez del CHECK,
-- el bloque pasaría por el motivo equivocado.

RESET ROLE;

INSERT INTO defect_report
SELECT 52, 'a completed agent run can carry no cost',
       pg_temp.accepted(format($sql$
           INSERT INTO agent_runs (organization_id, business_id, agent_id, scope, scope_id,
                                   status, finished_at)
           VALUES (%L, '44444444-4444-4444-8444-444444444444', 'content', 'business',
                   '44444444-4444-4444-8444-444444444444', 'completed', now())
       $sql$, (SELECT org_bob FROM t))),
       'una corrida en `completed` sin tokens_used ni cost_usd';

-- ─────────────────────────────────────────────────────────────────────────────
-- 53. El costo de una corrida puede ser negativo
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la misma suma, por el otro lado.
--
-- El modo de fallo que esto impide no es alguien escribiendo `-5` a mano: es una
-- resta mal puesta en el módulo de egreso —contar los tokens de salida menos los
-- de entrada, por ejemplo— que hace que la suma del mes dé menos de lo gastado.
-- Va aparte del 52 porque una fila con costo negativo SÍ pasa el 52: tiene su
-- costo, sólo que apunta para el lado equivocado.

RESET ROLE;

INSERT INTO defect_report
SELECT 53, 'an agent run can carry a negative cost',
       pg_temp.accepted(format($sql$
           INSERT INTO agent_runs (organization_id, business_id, agent_id, scope, scope_id,
                                   status, tokens_used, cost_usd, finished_at)
           VALUES (%L, '44444444-4444-4444-8444-444444444444', 'content', 'business',
                   '44444444-4444-4444-8444-444444444444', 'completed', 100, -1.5, now())
       $sql$, (SELECT org_bob FROM t))),
       'una corrida con cost_usd = -1.5, que resta de la suma del mes';

-- ─────────────────────────────────────────────────────────────────────────────
-- 54. El rol del navegador puede guardar un token
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la custodia de la 0014 tenga una llave y no una manija.
--
-- `store_integration_token` es `SECURITY INVOKER` a propósito, así que quien la
-- ejecute sin USAGE sobre `vault` va a fallar apenas lo toque. Eso es lo que hace
-- tentador saltear este bloque, y es exactamente por qué existe: la función
-- REVOCA el token vivo ANTES de llegar al Vault, y el error que devuelve después
-- no deshace ese UPDATE. O sea que una sesión de navegador capaz de ejecutarla
-- deja a la plataforma entera sin token con una llamada, y lee un error que
-- parece decir que no pasó nada.
--
-- Es la misma forma del bloque 50 con el argumento invertido: allá el peligro es
-- que la función CORRA, acá es lo que alcanza a hacer antes de no correr.
--
-- La organización es un uuid que no existe: si el privilegio no frena la llamada,
-- lo que se mide es el privilegio y no el daño.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

CREATE TEMP TABLE step54 AS SELECT pg_temp.denied_on_function($sql$
    SELECT public.store_integration_token(
        'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'google', 'x', now())
$sql$) AS error;

-- Se afirma sobre el MENSAJE y no sólo sobre el SQLSTATE. Sin el EXECUTE, esta
-- llamada muere igual: primero en el UPDATE, con `permission denied for table
-- integration_tokens`. O sea que con `sqlstate_of()` este bloque pasaba en verde
-- midiendo el privilegio de TABLA, que es otra línea de otro archivo — y que
-- podría cambiar sin que nadie tocara este bloque.
INSERT INTO defect_report
SELECT 54, 'the browser-side role can store an integration token',
       (SELECT error NOT LIKE '42501 | permission denied for function store_integration_token%'
          FROM step54),
       'grace, desde una sesión de navegador, llamando a la función que revoca el token vivo: ' ||
       (SELECT error FROM step54) ||
       ' (se espera 42501 sobre la FUNCIÓN, no sobre la tabla ni sobre el Vault)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 55. El rol del navegador puede refrescar el token
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo mismo, sobre la función que REESCRIBE el secreto.
--
-- Va aparte del 54 y no como una segunda afirmación del mismo bloque porque los
-- privilegios se otorgan de a una función: el día que alguien agregue un
-- `GRANT EXECUTE` de más va a ser sobre una sola, y un bloque que mide tres cosas
-- en una fila no dice cuál.
--
-- Y lo que ésta alcanza a hacer sin llegar al Vault es distinto:
-- `vault.update_secret` va ANTES del UPDATE de `expires_at`, así que un fallo de
-- privilegio ahí deja la fila intacta. Lo que este bloque impide es lo otro: que
-- alguien con USAGE sobre `vault` —hoy nadie del navegador, mañana quién sabe—
-- reemplace el token de la plataforma por uno suyo.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

CREATE TEMP TABLE step55 AS SELECT pg_temp.denied_on_function($sql$
    SELECT public.refresh_integration_token(
        'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'google', 'x', now())
$sql$) AS error;

-- Y acá el mensaje importa todavía más que en el 54, porque medido el 2026-09-01
-- con el EXECUTE puesto esta llamada NO FALLA: la RLS le esconde la fila, el
-- SELECT no encuentra nada, la función devuelve `false` y no hay excepción
-- ninguna. Un bloque que sólo mirara «falló o no» leería ese `false` como una
-- llamada que pasó —correcto— pero uno que mirara sólo el SQLSTATE de un error
-- que nunca ocurrió leería NULL, que es lo mismo que «pasó» y por accidente.
INSERT INTO defect_report
SELECT 55, 'the browser-side role can refresh the integration token',
       (SELECT error NOT LIKE '42501 | permission denied for function refresh_integration_token%'
          FROM step55),
       'grace, desde una sesión de navegador, reemplazando el secreto de la plataforma: ' ||
       (SELECT error FROM step55) ||
       ' (se espera 42501 sobre la FUNCIÓN)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 56. El rol del navegador puede leer el token en claro
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: el único objeto de `public` que devuelve un token descifrado.
--
-- Todo el diseño de la 0014 se apoya en que el secreto no esté en ninguna columna
-- de `public`, y esta función es la excepción que ese diseño necesita para que la
-- aplicación pueda llamar a Google. Una excepción con el privilegio mal puesto es
-- la columna en claro otra vez, con más pasos.
--
-- Y el token es de AGENCIA: no es el de un cliente, es el que llega a las
-- properties de todos.

SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

CREATE TEMP TABLE step56 AS SELECT pg_temp.denied_on_function($sql$
    SELECT public.integration_token_secret(
        'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'google')
$sql$) AS error;

INSERT INTO defect_report
SELECT 56, 'the browser-side role can read the decrypted token',
       (SELECT error NOT LIKE '42501 | permission denied for function integration_token_secret%'
          FROM step56),
       'grace, desde una sesión de navegador, pidiendo el token de agencia en claro: ' ||
       (SELECT error FROM step56) ||
       ' (se espera 42501 sobre la FUNCIÓN, no sobre el esquema vault)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 57. El rol `authenticated` puede leer el token en claro
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo mismo que el 56, sobre el rol que la MIGRACIÓN nombra.
--
-- Es la lección del bloque 45 por cuarta vez: el 56 mide `growthos_app`, cuyo
-- alcance lo decide `app_role.sql`, un archivo de QA. Si el
-- `REVOKE ... FROM PUBLIC, anon, authenticated, service_role` de la 0021
-- desapareciera, el 56 seguiría verde y la llave del Vault quedaría al alcance de
-- cualquier sesión de navegador.
--
-- El resultado viaja por un GUC de transacción, como en el 45, el 49 y el 51:
-- `authenticated` no puede escribir en `defect_report`, y darle ese permiso sería
-- ensancharle los privilegios al rol que este bloque mide.

RESET ROLE;
SELECT set_config('qa.sql57', $sql$
    SELECT public.integration_token_secret(
        'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'google')
$sql$, true);

SELECT pg_temp.be('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b57', pg_temp.denied_on_function(current_setting('qa.sql57')), true);
RESET ROLE;

-- Éste es el bloque donde la diferencia entre SQLSTATE y mensaje se midió: con
-- `authenticated` sacado del REVOKE de la 0021, la llamada pasa el control de la
-- función y muere en `permission denied for schema vault`, que también es 42501.
-- El bloque quedaba verde con la línea que existe para protegerlo borrada.
INSERT INTO defect_report
SELECT 57, 'the authenticated role can read the decrypted token',
       current_setting('qa.b57')
           NOT LIKE '42501 | permission denied for function integration_token_secret%',
       'grace, como `authenticated`, pidiendo el token de agencia en claro: ' ||
       current_setting('qa.b57') ||
       ' (se espera 42501 sobre la FUNCIÓN, no sobre el esquema vault)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 58. Reconectar deja dos tokens vivos, o no se puede reconectar
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el índice único PARCIAL de la 0014 y el orden de
-- `store_integration_token` digan lo mismo.
--
-- El índice deja UNA viva por organización y proveedor y conserva las revocadas.
-- La función revoca la viva ANTES de insertar la nueva, y ese orden no es
-- intercambiable: al revés, el INSERT choca con el índice y **reconectar es
-- imposible** — justo el día que hace falta, porque se reconecta cuando el token
-- anterior dejó de servir. El modo de fallo del otro lado, dos vivas a la vez, lo
-- ataja el índice; el de éste no lo ataja nadie.
--
-- Los dos se miden con la misma afirmación: después de dos conexiones tiene que
-- haber DOS filas y UNA viva. Un 23505 deja la cuenta en uno y una, y una
-- inversión que el índice no viera la dejaría en dos y dos.
--
-- Corre como el dueño y no como `growthos_app`, que es quien corre el resto del
-- archivo: los bloques 54 a 56 acaban de afirmar que el rol de la aplicación NO
-- puede llamar a estas funciones, así que medir su comportamiento desde ahí sería
-- medir el privilegio dos veces y el comportamiento ninguna.

-- La cuenta se mide como DIFERENCIA y no como total: los bloques 20 y 25 ya
-- dejaron filas de token para esta organización, así que un total absoluto mide
-- lo que hicieron ellos además de lo que hace éste. Medido acá: daba 3 donde el
-- bloque esperaba 2, y lo que estaba mal era la expectativa.
RESET ROLE;

CREATE TEMP TABLE antes58 AS
SELECT count(*) AS filas FROM integration_tokens
 WHERE organization_id = (SELECT org_bob FROM t) AND provider = 'google';

CREATE TEMP TABLE step58 AS
SELECT pg_temp.sqlstate_of(format($sql$
    SELECT public.store_integration_token(%L::uuid, 'google',
        '{"refresh_token":"uno"}', now() + interval '1 hour');
    SELECT public.store_integration_token(%L::uuid, 'google',
        '{"refresh_token":"dos"}', now() + interval '1 hour');
$sql$, (SELECT org_bob FROM t), (SELECT org_bob FROM t))) AS estado;

INSERT INTO defect_report
SELECT 58, 'a second connection leaves two live tokens, or cannot be made',
       (SELECT estado IS NOT NULL FROM step58)
       OR (SELECT count(*) - (SELECT filas FROM antes58) <> 2
                  OR count(*) FILTER (WHERE revoked_at IS NULL) <> 1
             FROM integration_tokens
            WHERE organization_id = (SELECT org_bob FROM t) AND provider = 'google'),
       'dos conexiones seguidas de la misma organización: SQLSTATE=' ||
       coalesce((SELECT estado FROM step58), 'ninguno') || ', filas=' ||
       (SELECT (count(*) - (SELECT filas FROM antes58))::text || ' nuevas / ' ||
               count(*) FILTER (WHERE revoked_at IS NULL)::text || ' vivas'
          FROM integration_tokens
         WHERE organization_id = (SELECT org_bob FROM t) AND provider = 'google') ||
       ' (se esperan 2 nuevas / 1 viva)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 59. Refrescar acuña una fila nueva
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que `revoked_at` siga significando «alguien dio de baja este
-- acceso».
--
-- Un access token de Google dura una hora. Si refrescar creara fila —o revocara
-- la anterior— el historial de revocaciones de la 0014, que existe para poder
-- contestar quién tuvo acceso y hasta cuándo, se llenaría de una fila por hora y
-- dejaría de poder contestarlo. Es el mismo error que confundir vencido con
-- revocado, una capa más abajo.
--
-- Se mide sobre la fila viva del bloque anterior: la cuenta no se mueve, y el
-- secreto sí. Las dos mitades hacen falta — una función que no hiciera nada
-- también dejaría la cuenta quieta.

RESET ROLE;

CREATE TEMP TABLE step59 AS
SELECT (SELECT count(*) FROM integration_tokens
         WHERE organization_id = (SELECT org_bob FROM t) AND provider = 'google') AS antes,
       public.refresh_integration_token((SELECT org_bob FROM t), 'google',
           '{"refresh_token":"tres"}', now() + interval '2 hours') AS refresco;

INSERT INTO defect_report
SELECT 59, 'refreshing a token mints a new row instead of replacing the secret',
       (SELECT NOT refresco FROM step59)
       OR (SELECT count(*) <> (SELECT antes FROM step59) FROM integration_tokens
            WHERE organization_id = (SELECT org_bob FROM t) AND provider = 'google')
       OR (SELECT public.integration_token_secret((SELECT org_bob FROM t), 'google')
             IS DISTINCT FROM '{"refresh_token":"tres"}'),
       'un refresco sobre la conexión viva: devolvió ' ||
       (SELECT refresco::text FROM step59) || ', filas ' ||
       (SELECT antes::text FROM step59) || ' antes y ' ||
       (SELECT count(*)::text FROM integration_tokens
         WHERE organization_id = (SELECT org_bob FROM t) AND provider = 'google') ||
       ' después (se espera true, la misma cuenta, y el secreto nuevo)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 60. Se puede guardar una conexión con el secreto en blanco
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que una fila que dice «hay un token» tenga un token.
--
-- La foránea RESTRICT de la 0014 cuida el caso en que el secreto NO EXISTA. Que
-- exista y esté vacío no lo cuida nadie: el Vault cifra la cadena vacía sin
-- protestar, la fila queda perfecta, `integration_token_state()` dice `active` y
-- la pantalla dice «conectado». El fallo aparece recién contra Google, como un
-- 401, y ahí se lee como un token vencido o revocado — o sea que manda a
-- reconectar en vez de decir que lo que se guardó nunca fue un token.
--
-- Es la respuesta correcta por el motivo equivocado, la misma familia que
-- `absent` contra `malformed` en `agency.ts`.

RESET ROLE;

INSERT INTO defect_report
SELECT 60, 'a connection can be stored with a blank secret',
       pg_temp.accepted(format($sql$
           SELECT public.store_integration_token(%L::uuid, 'google', '   ',
                                                 now() + interval '1 hour')
       $sql$, (SELECT org_alice FROM t))),
       'una conexión guardada con un secreto en blanco, que la pantalla muestra como conectada';

-- ─────────────────────────────────────────────────────────────────────────────
-- 61. Refrescar una conexión que no existe se informa como éxito
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que «no había nada que refrescar» llegue a la aplicación como una
-- respuesta y no como un éxito.
--
-- Es el caso de la revocación: alguien da de baja el acceso en la cuenta de
-- Google, la fila queda revocada, y el próximo refresco no encuentra ninguna
-- viva. Un `true` ahí le dice a la aplicación que el token está al día — así que
-- sigue llamando a Google con uno muerto, cobra 401, y muestra `error` cuando lo
-- que corresponde es mandar a reconectar. El estado que la 0014 se tomó el
-- trabajo de distinguir se pierde en el valor de retorno.
--
-- Va aparte del 59, que mide el camino feliz: una función que devolviera `true`
-- siempre pasaría aquél y sólo cae acá.

RESET ROLE;

CREATE TEMP TABLE step61 AS
SELECT public.refresh_integration_token(
    'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 'google',
    '{"refresh_token":"x"}', now() + interval '1 hour') AS resultado;

INSERT INTO defect_report
SELECT 61, 'refreshing a connection that does not exist is reported as success',
       (SELECT resultado IS DISTINCT FROM false FROM step61),
       'un refresco sobre una organización sin token vivo devolvió ' ||
       (SELECT coalesce(resultado::text, 'NULL') FROM step61) || ' (se espera false)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 62. Un tenant puede leer la sonda de otro
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que `integration_probe` no filtre a qué property apunta otro
-- cliente.
--
-- La tabla guarda `property_ref`, que en el modelo de agencia es LO ÚNICO que
-- separa los datos de un cliente de los de otro. Una fila visible de más no es un
-- detalle de presentación: le dice a alguien cuál es la property de otro, que es
-- la mitad del trabajo de apuntar la suya ahí.

RESET ROLE;
SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

INSERT INTO defect_report
SELECT 62, 'a tenant can read another tenant''s integration probe',
       EXISTS (SELECT 1 FROM integration_probe p WHERE p.organization_id = (SELECT org_bob FROM t)),
       'alice, como miembro de su organización, viendo la sonda de bob';

-- ─────────────────────────────────────────────────────────────────────────────
-- 63. El rol del navegador puede escribir una sonda
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el resultado de una consulta lo escriba quien la HIZO.
--
-- Una sesión que pueda escribir acá declara «ok» sobre una integración rota, o
-- «http 403» sobre una que anda. Las dos direcciones duelen: la primera esconde
-- un problema y la segunda manda a alguien a arreglar lo que no está roto — y las
-- dos son peores que no tener la tabla, porque esto existe justamente para que
-- alguien le crea.

RESET ROLE;
SET LOCAL ROLE growthos_app;
SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');

CREATE TEMP TABLE step63 AS SELECT pg_temp.sqlstate_of(format($sql$
    INSERT INTO integration_probe (organization_id, provider, outcome)
    VALUES (%L, 'ga4', 'ok')
$sql$, (SELECT org_alice FROM t))) AS estado;

INSERT INTO defect_report
SELECT 63, 'the browser-side role can write an integration probe',
       (SELECT estado IS DISTINCT FROM '42501' FROM step63),
       'grace escribiendo el resultado de una consulta que no hizo: SQLSTATE=' ||
       coalesce((SELECT estado FROM step63), 'ninguno, la escritura pasó') ||
       ' (se espera 42501, insufficient_privilege)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 64. El rol `authenticated` puede escribir una sonda
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: lo mismo que el 63, sobre el rol que la MIGRACIÓN nombra.
--
-- La lección del bloque 45 otra vez: el 63 mide `growthos_app`, cuyo alcance lo
-- decide `app_role.sql`. Si el `GRANT SELECT` de la 0022 se convirtiera en un
-- `GRANT ALL`, el 63 seguiría verde.

RESET ROLE;
SELECT set_config('qa.sql64', format($sql$
    INSERT INTO integration_probe (organization_id, provider, outcome)
    VALUES (%L, 'ga4', 'ok')
$sql$, (SELECT org_alice FROM t)), true);

SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b64', coalesce(pg_temp.sqlstate_of(current_setting('qa.sql64')), 'paso'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 64, 'the authenticated role can write an integration probe',
       current_setting('qa.b64') IS DISTINCT FROM '42501',
       'alice, como `authenticated`, escribiendo una sonda: SQLSTATE=' ||
       current_setting('qa.b64') || ' (se espera 42501, insufficient_privilege)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 65. Una sonda puede llevar un código HTTP sin haber habido respuesta
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el código no describa una respuesta que nunca existió.
--
-- `timeout` y `network` son «no hubo respuesta». Una fila que diga `network` con
-- un 500 al lado inventa que Google contestó algo, y quien la lea va a buscar el
-- problema del lado de Google en vez del de la red.

RESET ROLE;

INSERT INTO defect_report
SELECT 65, 'a probe can carry an HTTP code with no response behind it',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_probe (organization_id, provider, outcome, http_status)
           VALUES (%L, 'ga4', 'network', 500)
       $sql$, (SELECT org_bob FROM t))),
       'una sonda `network` con código 500, que describe una respuesta que no hubo';

-- ─────────────────────────────────────────────────────────────────────────────
-- 66. Una sonda `http` puede no decir con qué código
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la otra mitad, y es la que motivó la tabla entera.
--
-- Un `http` sin número es exactamente el estado del que veníamos: «falló» sin
-- decir si fue permiso, identificador o token. Guardar eso sería construir la
-- tabla y perder lo único que la justifica.

RESET ROLE;

INSERT INTO defect_report
SELECT 66, 'an http probe can omit the status code',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_probe (organization_id, provider, outcome)
           VALUES (%L, 'search_console', 'http')
       $sql$, (SELECT org_bob FROM t))),
       'una sonda `http` sin código, que es «falló» sin decir por qué';

-- ─────────────────────────────────────────────────────────────────────────────
-- Report
-- ─────────────────────────────────────────────────────────────────────────────
-- Anti-vacuity: sixty-six checks were written, so sixty-six rows must be present.
-- Fewer means a check silently failed to record and the report is lying by omission.

DO $$
DECLARE
    checks    int;
    n_present int;
    detail    text;
BEGIN
    SELECT count(*) INTO checks FROM defect_report;
    IF checks <> 66 THEN
        RAISE EXCEPTION 'Vacuous run: % of 66 checks recorded a result.', checks;
    END IF;

    SELECT count(*) INTO n_present FROM defect_report d WHERE d.present;

    SELECT string_agg(format('  %s. %s' || chr(10) || '     %s',
                             d.num, d.name, d.evidence), chr(10) ORDER BY d.num)
      INTO detail
      FROM defect_report d WHERE d.present;

    IF n_present > 0 THEN
        RAISE EXCEPTION E'% of 66 isolation defects are live in this schema:\n%',
            n_present, detail;
    END IF;

    RAISE NOTICE 'All 66 checks green: the schema prevents every one of them.';
END
$$;

ROLLBACK;
