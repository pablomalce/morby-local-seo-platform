-- A hundred and fifty-seven isolation checks against the Growth OS schema — executable.
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
-- Runs as postgres and drops to growthos_app for most assertions. That matters
-- more here than usual: defect 6 is precisely that the owner is exempt from
-- every policy, so asserting isolation as the owner would assert nothing.
--
-- «MOST», Y LA PALABRA IMPORTA, porque suponer «todas» escondió un agujero entero
-- hasta el 2026-09-27. `growthos_app` NO es miembro de `authenticated` —medido con
-- `pg_has_role`, da `f`— así que NINGUNA policy escrita `TO authenticated` le
-- aplica. En una tabla con RLS ENABLE y FORCE eso no lo deja fuera del
-- aislamiento: lo deja fuera de TODO, porque cero policies aplicables deniegan
-- cualquier fila. Medido sobre la ficha de la `0026`: `growthos_app` tiene INSERT
-- (`has_table_privilege` da `t`, se lo da el `GRANT ... ON ALL TABLES` de
-- `app_role.sql`) y su INSERT igual muere con
-- `42501 | new row violates row-level security policy`, y su SELECT devuelve cero
-- filas.
--
-- Consecuencia: un bloque que corre como `growthos_app` sobre una tabla cuyas
-- policies son `TO authenticated` mide la AUSENCIA de policy aplicable, no la
-- policy. Las 16 policies de la `0026` estuvieron sin ejecutarse por ninguna
-- aserción hasta que se escribieron los bloques 88 y 89. Los bloques que evalúan
-- una policy de verdad son los que hacen `SET LOCAL ROLE authenticated` —45, 49,
-- 51, 57, 64, 88, 89 y 93—, y cuando se agrega una tabla con policies
-- `TO authenticated` hace falta al menos uno de esos, más su control positivo.
--
-- Y hace falta algo más, que costó una segunda tanda de mutaciones descubrir:
-- cuando una tabla lleva una permisiva Y una restrictiva, la conducta no las
-- distingue —se tapan— y hay que afirmar cada capa por CATÁLOGO. Eso es el
-- bloque 94. Una aserción que necesita dos mutaciones simultáneas para ponerse
-- roja no es una aserción de ninguna de las dos cosas que mira.
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

-- Lo mismo que `sqlstate_of()`, pero SIN DEJAR HUELLA: si la sentencia pasa, su
-- efecto se deshace antes de volver. NULL quiere decir «fue aceptada», igual que
-- allá.
--
-- Existe por el bucle de los bloques 79 y 80. Un control POSITIVO tiene que
-- ejecutar el INSERT legítimo de verdad —si no, no prueba que el esquema no
-- bloquee de más— y diez INSERT legítimos que QUEDAN cambian lo que miden los
-- bloques de después: el ICP legítimo de una versión agota el único del bloque
-- 82, que entonces pasaría por agotamiento en vez de por el índice. Medido al
-- escribirlo: con `sqlstate_of()` el bloque 82 moría con 23505 en su primer
-- INSERT, que no es una aserción sino la corrida cayéndose.
--
-- Cómo deshace: la sentencia corre dentro de un bloque plpgsql —o sea una
-- subtransacción— y al final se levanta una excepción PROPIA, con un SQLSTATE
-- inventado, que la revierte. El handler de adentro atrapa SÓLO ese código, así
-- que cualquier otro error sigue viaje al handler de afuera y se informa como
-- rechazo. Un `WHEN OTHERS` adentro convertiría un rechazo real en un «pasó».
CREATE OR REPLACE FUNCTION pg_temp.sqlstate_sin_huella(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION 'qa: deshacer el control positivo' USING ERRCODE = 'QA000';
    EXCEPTION WHEN SQLSTATE 'QA000' THEN
        RETURN NULL;
    END;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END
$$;

-- El resultado de una consulta escalar, como texto, o el error con el que murió.
--
-- Existe para los bloques 88 y 89, que corren como `authenticated`: ese rol no
-- puede escribir en `defect_report` —y darle ese permiso sería ensancharle los
-- privilegios al rol que los bloques miden, lo que el bloque 45 ya explicó—, así
-- que el resultado tiene que viajar por un GUC de transacción. Un `SELECT ... INTO`
-- suelto no sirve: la consulta se arma como `postgres` y se EJECUTA como
-- `authenticated`, o sea que hace falta EXECUTE.
--
-- Y devuelve el error en vez de tragárselo: si `authenticated` no puede ni
-- ejecutar la consulta, eso tiene que aparecer en la evidencia como el mensaje que
-- es, no como un cero que se lee igual que «no ve nada».
CREATE OR REPLACE FUNCTION pg_temp.escalar(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    r text;
BEGIN
    EXECUTE p_sql INTO r;
    RETURN coalesce(r, '');
EXCEPTION WHEN OTHERS THEN
    RETURN 'ERROR ' || SQLSTATE || ' | ' || SQLERRM;
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
-- deliberate decision. pagespeed_cache used to be cited here as one, and it was
-- the wrong example: its key is the URL of a client, so reading it is reading
-- the client list -- measured in production on 2026-10-06. 0030 closed it, and
-- blocks 136 to 141 measure that, including the read this check never looks at.

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
-- 67. PageSpeed no puede anotar por qué falló
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la fuente que la 0022 dejó afuera.
--
-- El CHECK de `provider` copió el vocabulario de la 0017 —las superficies que se
-- MAPEAN por cliente— y PageSpeed no se mapea: sale del `website` del negocio.
-- El efecto medido es que en los dos primeros reportes reales salió `error` las
-- dos veces sin manera de saber si fue permiso, cuota o tiempo. La 0023 lo
-- admite; este bloque es lo que impide que vuelva a caerse de la lista.

RESET ROLE;

INSERT INTO defect_report
SELECT 67, 'pagespeed cannot record why it failed',
       NOT pg_temp.accepted(format($sql$
           INSERT INTO integration_probe (organization_id, provider, outcome, http_status)
           VALUES (%L, 'pagespeed', 'http', 429)
       $sql$, (SELECT org_bob FROM t))),
       'la tabla rechaza la sonda de PageSpeed, que vuelve a dejar su `error` sin motivo';

-- ─────────────────────────────────────────────────────────────────────────────
-- 68. Un proveedor inventado entra igual
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la otra mitad de ampliar una lista.
--
-- El CHECK vale por lo que RECHAZA. Ampliarlo sin medir eso deja el camino
-- abierto a que un typo en el código —`page_speed`, `pagespeeed`— escriba una
-- fila que ninguna pantalla lee y que nadie relaciona con la fuente que calla.

RESET ROLE;

INSERT INTO defect_report
SELECT 68, 'an invented provider is accepted anyway',
       pg_temp.accepted(format($sql$
           INSERT INTO integration_probe (organization_id, provider, outcome)
           VALUES (%L, 'page_speed', 'ok')
       $sql$, (SELECT org_bob FROM t))),
       'una sonda con un proveedor que no existe, que se escribe y nadie lee';

-- ─────────────────────────────────────────────────────────────────────────────
-- 69 a 72. Dar de alta un cliente: quién puede, y quién no
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDAN: que `create_client_organization` sea una capacidad y no un agujero.
--
-- La función es `SECURITY DEFINER`, o sea que corre con los privilegios de quien
-- la creó y saltea la RLS por definición. Eso es exactamente lo que hace falta
-- —`authenticated` no puede insertar en `organizations` de ninguna manera— y es
-- también lo que la vuelve peligrosa si la puede ejecutar cualquiera.
--
-- SE PREGUNTA POR EL PRIVILEGIO, NO SE INTENTA LA LLAMADA
--
-- Un `accepted()` mediría que algo falló, no POR QUÉ, y acá `42501` es el mismo
-- código para «no podés sobre la función», «sobre la tabla» y «sobre el esquema».
-- `has_function_privilege` contesta la pregunta exacta, y no se puede confundir
-- con otra denegación.

RESET ROLE;

INSERT INTO defect_report
SELECT 69, 'anon can create an organization',
       has_function_privilege('anon', 'public.create_client_organization(text)', 'EXECUTE'),
       'cualquiera sin sesión podría fabricar organizaciones';

-- `growthos_app` NO se mide acá, y conviene decir por qué: `app_role.sql` hace
-- `GRANT EXECUTE ON ALL FUNCTIONS` a ese rol por diseño, así que un bloque que
-- exigiera lo contrario se pondría rojo después de cada corrida del quinto paso.
-- Sería una pared peleándose con el procedimiento. Y no hace falta: lo que impide
-- que ese rol cree una organización huérfana no es el privilegio sino
-- `auth.uid()`, que es el bloque 72.
--
-- Lo que sí se mide es que la función SIGA siendo `SECURITY DEFINER`. Si alguien
-- la recrea sin eso, corre con los privilegios de quien llama —`authenticated`,
-- que no puede insertar en `organizations`— y dar de alta un cliente vuelve a
-- fallar, en silencio y sólo en producción.
INSERT INTO defect_report
SELECT 70, 'create_client_organization stopped being SECURITY DEFINER',
       NOT (SELECT p.prosecdef FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'create_client_organization'),
       'sin SECURITY DEFINER la función no puede insertar, y el alta de clientes muere en silencio';

INSERT INTO defect_report
SELECT 71, 'the agency cannot create a client at all',
       NOT has_function_privilege('authenticated', 'public.create_client_organization(text)', 'EXECUTE'),
       'sin este privilegio la plataforma vuelve a servir a una sola organización';

-- Y la guarda que importa: sin sesión no hay `auth.uid()`, así que no hay a quién
-- hacer dueño. Crear igual dejaría una organización huérfana que NADIE puede
-- alcanzar —no aparece en `current_user_org_ids()`, ni para su creador— y que
-- sólo `service_role` podría limpiar.
--
-- NO se cambia de rol acá, y no es un olvido: lo que se mide es la ausencia de
-- `auth.uid()`, no un privilegio. Esta corrida no lleva JWT, así que `auth.uid()`
-- es NULL cualquiera sea el rol — y cambiarlo además rompería el INSERT de abajo,
-- porque `defect_report` no es de `authenticated`.

-- SE LIMPIA LA SESIÓN HEREDADA, Y ESTO COSTÓ UNA VUELTA.
--
-- El ayudante de la línea 93 impersona usuarios con
-- `set_config('request.jwt.claim.sub', …, true)`, y ese ajuste sobrevive al
-- bloque que lo puso: `auth.uid()` seguía devolviendo el usuario de OTRA prueba.
-- Sin esta línea, este bloque medía «con sesión ajena se crea», que es cierto y
-- no es lo que dice medir.
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO defect_report
SELECT 72, 'an organization is created with no session',
       pg_temp.accepted($sql$
           SELECT public.create_client_organization('Sin sesion')
       $sql$),
       'una organización sin dueño, invisible para todos y permanente';

-- QUÉ RECHAZA DE VERDAD, QUE NO ES LO QUE PARECE.
--
-- Se mutó la función sacándole la guarda `IF v_user IS NULL` y este bloque siguió
-- verde. El mutante SOBREVIVIÓ, y la lección vale más que el bloque: lo que
-- impide la organización huérfana NO es el `IF`, es `org_members.user_id` —su
-- `NOT NULL` y su FK contra `auth.users`—. La función es atómica, así que el
-- rechazo del INSERT de la membresía se lleva puesta también la organización.
--
-- O sea que el `IF` es ERGONOMÍA: convierte un error de restricción en un mensaje
-- legible. La garantía es estructural, igual que el CHECK de la `0015` frente a
-- su trigger. Se deja escrito para que nadie lo lea al revés y crea que sacando
-- el `IF` se abre un agujero — no se abre, se empeora el mensaje.

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 73 a 76. Las auditorías de legibilidad por IA
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDAN: que la tabla que guarda la historia no se pueda leer ni escribir
-- desde la organización de al lado, y que la sesión de navegador no pueda
-- DECLARAR que un sitio está bien.
--
-- La última es la que importa y no es obvia: escribir una auditoría es
-- consecuencia de peticiones que hizo el servidor. Una sesión que pudiera
-- insertar podría afirmar «los rastreadores entran» sin haber mirado nada, y esa
-- fila se vería igual que una medida de verdad.

RESET ROLE;

INSERT INTO defect_report
SELECT 73, 'a session can write an AI-readability audit',
       has_table_privilege('authenticated', 'public.aeo_audits', 'INSERT'),
       'una sesión podría declarar que un sitio está bien sin haberlo mirado';

INSERT INTO defect_report
SELECT 74, 'anon can read the audits',
       has_table_privilege('anon', 'public.aeo_audits', 'SELECT'),
       'las auditorías de los clientes, legibles sin sesión';

INSERT INTO defect_report
SELECT 75, 'the audits table has no RLS',
       NOT (SELECT c.relrowsecurity AND c.relforcerowsecurity
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'aeo_audits'),
       'sin RLS forzada, un miembro ve las auditorías de otra organización';

-- Y la historia: si alguien agregara un índice único por organización —copiando
-- la 0022 sin leer por qué NO se copia— cada corrida pisaría a la anterior y
-- «qué cambió» dejaría de poder contestarse.
INSERT INTO defect_report
SELECT 76, 'the audits keep only one row per organization',
       EXISTS (SELECT 1 FROM pg_index i
               JOIN pg_class c ON c.oid = i.indrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = 'aeo_audits' AND i.indisunique
                 AND i.indrelid::regclass::text <> 'aeo_audits_pkey'
                 AND (SELECT count(*) FROM unnest(i.indkey) k WHERE k <> 0) > 0
                 AND i.indexrelid::regclass::text LIKE '%organization%'),
       'con un único por organización, cada corrida pisa a la anterior y se pierde la historia';

-- ─────────────────────────────────────────────────────────────────────────────
-- 77 a 93. La ficha común de empresa — la puerta de H1.1
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDAN: que la capa estratégica compartida no repita el defecto que Lead
-- Engine tiene medido — una fila de `lead_tags` de la organización B colgada de
-- un lead de la organización A fue ACEPTADA, porque la FK era simple.
--
-- Los dos bloques que SON la puerta de H1.1 son el 79 (el INSERT cruzado en las
-- DIEZ relaciones, con su SQLSTATE exacto) y el 81 (la consulta al catálogo, que
-- mira CUÁLES columnas referencia cada FK y no cuántas). El 80 es el control
-- POSITIVO de los dos: sin él, un esquema que rechazara TODO pasaría la puerta,
-- que es el mismo agujero que §8 del canónico nombra cuando dice que el último
-- bloque prueba que no bloquea de más.
--
-- Y el 88 y el 89 son la mitad que la primera versión de esta tanda NO tenía: la
-- puerta habla de RLS ENABLE y FORCE, y ENABLE + FORCE sin una policy que se
-- EJECUTE es una tabla cerrada, no una tabla aislada. Los dos corren como
-- `authenticated`, que es el rol al que las 16 policies apuntan.
--
-- FIXTURES PROPIAS, Y NO POR COMODIDAD. Estos bloques crean sus dos negocios en
-- vez de reusar los de la línea 71, porque el bloque 5 INTENTA mover el negocio
-- de alice a la organización de bob y su éxito depende de que ese negocio tenga
-- hijos — el comentario de la §7 de la `0004` lo dice: «A business with no
-- children at all can now change organization». Colgar la ficha de un negocio
-- cuyo tenant otro bloque puede haber cambiado haría que estos bloques pasaran o
-- fallaran por el motivo de otro.
--
-- LOS BLOQUES DE ESTRUCTURA CORREN COMO `postgres`, Y ES DELIBERADO, al revés que
-- el bloque 7. Lo que miden el 79, el 80 y el 81 es la ESTRUCTURA, no una policy:
--
--   * `postgres` tiene `rolbypassrls = t` en esta imagen (medido), así que la RLS
--     no puede ser lo que rechaza. Un `23503` acá sólo puede venir de la FK
--     compuesta;
--   * cualquier otro rol disponible en esta corrida rechazaría los INSERT ANTES
--     de llegar a la FK, y entonces el bloque pasaría en verde sin haber
--     consultado ninguna. Medido el 2026-09-27: como `growthos_app` el INSERT
--     muere con `42501 | new row violates row-level security policy for table
--     "company_profiles"`, y un SELECT sobre la ficha devuelve CERO filas.
--
-- Y ACÁ SE CORRIGE UNA PREMISA FALSA QUE ESTE ENCABEZADO AFIRMABA. Decía que un
-- INSERT como `growthos_app` moriría con 42501 «porque la decisión 6 de la `0026`
-- le dio a `authenticated` sólo SELECT sobre la ficha». Eso confunde dos roles y
-- es falso de los dos lados: `growthos_app` SÍ tiene INSERT, UPDATE y DELETE sobre
-- las ocho tablas —se los da el `GRANT ... ON ALL TABLES IN SCHEMA public` de
-- `supabase/qa/app_role.sql`, medido: `has_table_privilege('growthos_app',
-- 'public.company_profiles', 'INSERT')` es `t`— y lo que lo frena no es un
-- privilegio sino la RLS. `growthos_app` NO es miembro de `authenticated`
-- (`pg_has_role` da `f`), así que NINGUNA de las 16 policies de la `0026` le
-- aplica, y con ENABLE + FORCE y cero policies aplicables todo queda denegado.
--
-- ESA MEDICIÓN ES EL MOTIVO DE QUE EXISTAN EL 88 Y EL 89. Si las 87 aserciones
-- corren como `growthos_app` y las 16 policies son `TO authenticated`, entonces
-- ninguna de las 16 se ejecutaba NUNCA: se podían borrar todas, o escribirlas con
-- `USING (true)`, y la suite seguía entera en verde. El 88 y el 89 son los dos
-- primeros bloques que EVALÚAN una policy de la ficha.
--
-- Y por eso los bloques de estructura exigen el SQLSTATE EXACTO en vez de usar
-- `accepted()`: «falló» no alcanza cuando dos cosas distintas pueden hacerlo
-- fallar, que es la lección que `sqlstate_of()` dejó escrita arriba.

RESET ROLE;

-- Los dos negocios y las dos fichas. `version` 1 y `draft` en las dos: son de
-- empresas distintas, así que el único parcial de un solo borrador no compite.
INSERT INTO businesses (id, organization_id, name)
SELECT 'd0260000-0026-4026-8026-0000000000a1', org_alice, 'Ficha Alice Co' FROM t;
INSERT INTO businesses (id, organization_id, name)
SELECT 'd0260000-0026-4026-8026-0000000000b1', org_bob, 'Ficha Bob Co' FROM t;

-- Un servicio de cada organización, para el puntero de la oferta de la decisión
-- 14. El de bob es el que hace cruzado el caso 10 del bucle.
INSERT INTO business_services (id, organization_id, business_id, slug, name)
SELECT 'd0260000-0026-4026-8026-0000000000a0', org_alice,
       'd0260000-0026-4026-8026-0000000000a1', 'alice-servicio', 'Servicio de Alice' FROM t;
INSERT INTO business_services (id, organization_id, business_id, slug, name)
SELECT 'd0260000-0026-4026-8026-0000000000b0', org_bob,
       'd0260000-0026-4026-8026-0000000000b1', 'bob-servicio', 'Servicio de Bob' FROM t;

INSERT INTO company_profiles (id, organization_id, business_id, version, status)
SELECT 'd0260000-0026-4026-8026-0000000000a2', org_alice,
       'd0260000-0026-4026-8026-0000000000a1', 1, 'draft' FROM t;
INSERT INTO company_profiles (id, organization_id, business_id, version, status)
SELECT 'd0260000-0026-4026-8026-0000000000b2', org_bob,
       'd0260000-0026-4026-8026-0000000000b1', 1, 'draft' FROM t;

-- Una segunda versión de la MISMA empresa, para el bloque 87. `superseded` y no
-- `draft`: el parcial de un solo borrador abierto es justo lo que el bloque 83
-- mide, y usarlo acá lo pondría en verde por agotamiento.
--
-- `superseded_at` llegó con la `0027`: el CHECK
-- `company_profiles_superseded_is_dated` es una equivalencia, así que una
-- superada sin fecha ya no entra. Esta línea cambió por eso y por nada más; lo
-- que el fixture existe para sostener —que `superseded` no compite con
-- `published` en el índice parcial— no se toca.
--
-- Y desde la decisión 13 de la `0027` lleva también fecha y persona de
-- publicación: una superada ESTUVO publicada, y un CHECK lo exige.
INSERT INTO company_profiles (id, organization_id, business_id, version, status,
                              published_at, published_by, superseded_at)
SELECT 'd0260000-0026-4026-8026-0000000000a9', org_alice,
       'd0260000-0026-4026-8026-0000000000a1', 2, 'superseded',
       now() - interval '20 days', '11111111-1111-4111-8111-111111111111', now() FROM t;

-- Y una SEGUNDA empresa de alice con su propio borrador, que existe para el
-- bloque 87 y llegó con la `0027`. Antes, el 87 metía el ICP en la versión 2
-- —`superseded`— y desde la `0027` eso lo rechaza el guard de inmutabilidad con
-- 45002 ANTES de que la FK compuesta opine: un rechazo por el motivo
-- equivocado, que es exactamente lo que ese bloque detecta. La otra fila-versión
-- que el 87 necesita tiene que ser ESCRIBIBLE, o sea un borrador, y un borrador
-- más de la MISMA empresa no puede existir (el único parcial del bloque 83). De
-- otra empresa de la misma organización, sí.
INSERT INTO businesses (id, organization_id, name)
SELECT 'd0260000-0026-4026-8026-0000000000a7', org_alice, 'Ficha Alice Dos' FROM t;
INSERT INTO company_profiles (id, organization_id, business_id, version, status)
SELECT 'd0260000-0026-4026-8026-0000000000a8', org_alice,
       'd0260000-0026-4026-8026-0000000000a7', 1, 'draft' FROM t;

-- Un segmento, un objetivo y un competidor curado de CADA organización. Son los
-- destinos legítimos y los cruzados del bucle de los bloques 79 y 80: sin una
-- fila de la otra organización, «cruzado» no se puede construir.
INSERT INTO profile_segments (id, organization_id, profile_id, name)
SELECT 'd0260000-0026-4026-8026-0000000000a3', org_alice,
       'd0260000-0026-4026-8026-0000000000a2', 'Clinicas chicas' FROM t;
INSERT INTO profile_segments (id, organization_id, profile_id, name)
SELECT 'd0260000-0026-4026-8026-0000000000b3', org_bob,
       'd0260000-0026-4026-8026-0000000000b2', 'Talleres de bob' FROM t;

INSERT INTO profile_objectives (id, organization_id, profile_id, statement, kind)
SELECT 'd0260000-0026-4026-8026-0000000000ba', org_alice,
       'd0260000-0026-4026-8026-0000000000a2', 'Somos la clinica mas elegida', 'claim' FROM t;
INSERT INTO profile_objectives (id, organization_id, profile_id, statement, kind)
SELECT 'd0260000-0026-4026-8026-0000000000bb', org_bob,
       'd0260000-0026-4026-8026-0000000000b2', 'Duplicar la facturacion', 'goal' FROM t;

INSERT INTO profile_competitors (id, organization_id, profile_id, name)
SELECT 'd0260000-0026-4026-8026-0000000000bc', org_alice,
       'd0260000-0026-4026-8026-0000000000a2', 'Rival curado de alice' FROM t;
INSERT INTO profile_competitors (id, organization_id, profile_id, name)
SELECT 'd0260000-0026-4026-8026-0000000000bd', org_bob,
       'd0260000-0026-4026-8026-0000000000b2', 'Rival curado de bob' FROM t;

-- ── 77 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la línea literal de la puerta. Sin esa única, las siete hijas no
-- tienen adónde apuntar con un par y la FK compuesta no es representable.
--
-- Se compara el texto de `pg_get_constraintdef()` incluyendo el ORDEN de las
-- columnas, y no un conjunto. `UNIQUE (id, organization_id)` sería igual de
-- único y NO sería lo mismo: §2 del canónico pide el tenant como primera
-- columna para que no exista camino de búsqueda que no lo lleve encima, y un
-- índice que arranca por `id` no lo lleva.
INSERT INTO defect_report
SELECT 77, 'la ficha no tiene UNIQUE (organization_id, id)',
       NOT EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.company_profiles'::regclass
              AND contype = 'u'
              AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, id)'),
       'sin esa única, ninguna hija puede colgar del par y el eje compuesto no existe';

-- VERIFICADO POR MUTACIÓN, con dos mutaciones que dan resultados distintos y las
-- dos valen: BORRAR la única de la `0026` no pone este bloque en rojo, hace que
-- la MIGRACIÓN no se pueda aplicar —`there is no unique constraint matching given
-- keys for referenced table "company_profiles"`—, así que la línea de la puerta
-- no es un adorno: sin ella el esquema no se construye. INVERTIR el orden a
-- `UNIQUE (id, organization_id)` sí lo pone en rojo, y SOLO a él: las seis FK
-- siguen funcionando y el 79 sigue verde. O sea que el orden no es un defecto de
-- aislamiento, es el camino de búsqueda de §2 del canónico, y este bloque es lo
-- único que lo mira.

-- ── 78 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que las ocho tablas tengan RLS ENABLE **y** FORCE.
--
-- POR QUÉ NO ALCANZA EL BLOQUE 6, y es medido: su denominador es
-- `WHERE ... relrowsecurity`, así que una tabla que NUNCA habilitó RLS no entra
-- —`ingest_events` tiene `relrowsecurity = f` y es invisible para el bloque 6—.
-- O sea que el bloque 6 cubre la tabla MAL configurada y no la tabla SIN
-- configurar. La lista escrita a mano es la única forma de notar una AUSENCIA, y
-- por eso acá hay una: un nombre que no exista como tabla también cae.
--
-- Y NO ALCANZA ÉL SOLO, que es la lección de esta tanda: ENABLE + FORCE con cero
-- policies aplicables al rol que consulta es una tabla que no deja pasar a nadie,
-- lo cual satisface este bloque y no satisface el aislamiento. La otra mitad la
-- miden el 88 y el 89.
INSERT INTO defect_report
SELECT 78, 'alguna tabla de la ficha no tiene RLS ENABLE y FORCE',
       count(*) FILTER (WHERE NOT coalesce(c.relrowsecurity AND c.relforcerowsecurity, false)) > 0,
       CASE WHEN count(*) FILTER (WHERE NOT coalesce(c.relrowsecurity AND c.relforcerowsecurity, false)) > 0
            THEN 'sin ENABLE+FORCE: ' || string_agg(v.t, ', ' ORDER BY v.t)
                 FILTER (WHERE NOT coalesce(c.relrowsecurity AND c.relforcerowsecurity, false))
            ELSE 'las 8 tablas de la ficha tienen ENABLE y FORCE'
            END
  FROM (VALUES ('company_profiles'), ('profile_offers'), ('profile_markets'),
               ('profile_segments'), ('profile_competitors'), ('profile_icp'),
               ('profile_objectives'), ('profile_evidence')) v(t)
  LEFT JOIN pg_class c
         ON c.relname = v.t AND c.relkind = 'r'
        AND c.relnamespace = 'public'::regnamespace;

-- ── 79 y 80 ──────────────────────────────────────────────────────────────────
-- EL INSERT CRUZADO, EN LAS DIEZ RELACIONES. La puerta de H1.1, palabra por
-- palabra: «toda tabla hija … referencia el par».
--
-- POR QUÉ UN BUCLE, Y POR QUÉ ESTO ERA UN DEFECTO. La primera versión de estos
-- dos bloques probaba el cruce en UNA relación —`profile_offers`— y la puerta
-- habla de siete hijas más los punteros. Nueve de las diez FK podían volverse
-- simples sin que ninguna aserción lo dijera: el escéptico midió a mano que el
-- esquema rechaza las diez, y «medido a mano» es exactamente lo que esta suite
-- existe para reemplazar. Es también por donde se colaba la mutación del bloque
-- 81, porque las dos mitades de la puerta se cubrían una sola relación.
--
-- LAS DIEZ, y de dónde sale cada una:
--
--   1-6   las seis hijas que cuelgan de la ficha por `(organization_id, profile_id)`;
--   7     `profile_evidence`, que cuelga del OBJETIVO y no de la ficha (decisión 11);
--   8     el puntero de `competitors` a la lista curada (decisión 12);
--   9     la FK de TRES columnas del ICP contra el segmento (decisión 8) — acá en
--         su versión CRUZADA por tenant; el bloque 87 la prueba cruzada por
--         VERSIÓN, que es el otro modo de fallo de la misma llave;
--   10    el puntero de la oferta al servicio canónico (decisión 14).
--
-- CADA CASO CON SU CONTROL POSITIVO, y los dos con la misma sentencia salvo el
-- dato cruzado. El positivo se ejecuta DE VERDAD y se deshace: ver el comentario
-- de `pg_temp.sqlstate_sin_huella()`. Diez INSERT legítimos que quedaran
-- cambiarían lo que miden los bloques 82 a 87.
--
-- Y SE EXIGE `23503` EXACTO, no «fue rechazado». Un rechazo por una policy
-- (42501), por un CHECK (23514) o por una única (23505) no es la garantía que
-- este bloque dice medir.
CREATE TEMP TABLE h1_casos (
    n         int  PRIMARY KEY,
    relacion  text NOT NULL,
    cruzado   text NOT NULL,
    legitimo  text NOT NULL
) ON COMMIT DROP;

INSERT INTO h1_casos
SELECT 1, 'profile_offers -> company_profiles',
       format($sql$INSERT INTO profile_offers (id, organization_id, profile_id, name)
                   VALUES ('d0260000-0026-4026-8026-000000000101', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Oferta cruzada')$sql$, org_bob),
       format($sql$INSERT INTO profile_offers (id, organization_id, profile_id, name)
                   VALUES ('d0260000-0026-4026-8026-000000000102', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Oferta propia')$sql$, org_alice)
  FROM t
UNION ALL
SELECT 2, 'profile_markets -> company_profiles',
       format($sql$INSERT INTO profile_markets (id, organization_id, profile_id, country)
                   VALUES ('d0260000-0026-4026-8026-000000000103', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'SE')$sql$, org_bob),
       format($sql$INSERT INTO profile_markets (id, organization_id, profile_id, country)
                   VALUES ('d0260000-0026-4026-8026-000000000104', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'SE')$sql$, org_alice)
  FROM t
UNION ALL
SELECT 3, 'profile_segments -> company_profiles',
       format($sql$INSERT INTO profile_segments (id, organization_id, profile_id, name)
                   VALUES ('d0260000-0026-4026-8026-000000000105', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Segmento cruzado')$sql$, org_bob),
       format($sql$INSERT INTO profile_segments (id, organization_id, profile_id, name)
                   VALUES ('d0260000-0026-4026-8026-000000000106', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Segmento propio')$sql$, org_alice)
  FROM t
UNION ALL
SELECT 4, 'profile_competitors -> company_profiles',
       format($sql$INSERT INTO profile_competitors (id, organization_id, profile_id, name)
                   VALUES ('d0260000-0026-4026-8026-000000000107', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Rival cruzado')$sql$, org_bob),
       format($sql$INSERT INTO profile_competitors (id, organization_id, profile_id, name)
                   VALUES ('d0260000-0026-4026-8026-000000000108', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Rival propio')$sql$, org_alice)
  FROM t
UNION ALL
SELECT 5, 'profile_icp -> company_profiles',
       format($sql$INSERT INTO profile_icp (id, organization_id, profile_id, definition)
                   VALUES ('d0260000-0026-4026-8026-000000000109', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'ICP cruzado')$sql$, org_bob),
       format($sql$INSERT INTO profile_icp (id, organization_id, profile_id, definition)
                   VALUES ('d0260000-0026-4026-8026-00000000010a', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'ICP propio')$sql$, org_alice)
  FROM t
UNION ALL
SELECT 6, 'profile_objectives -> company_profiles',
       format($sql$INSERT INTO profile_objectives (id, organization_id, profile_id, statement, kind)
                   VALUES ('d0260000-0026-4026-8026-00000000010b', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Afirmacion cruzada', 'claim')$sql$, org_bob),
       format($sql$INSERT INTO profile_objectives (id, organization_id, profile_id, statement, kind)
                   VALUES ('d0260000-0026-4026-8026-00000000010c', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Afirmacion propia', 'claim')$sql$, org_alice)
  FROM t
UNION ALL
-- La séptima cuelga del OBJETIVO (decisión 11), así que el par cruzado es
-- (organización de bob, objetivo de alice).
SELECT 7, 'profile_evidence -> profile_objectives',
       format($sql$INSERT INTO profile_evidence (id, organization_id, objective_id, kind, url)
                   VALUES ('d0260000-0026-4026-8026-00000000010d', %L,
                           'd0260000-0026-4026-8026-0000000000ba', 'http',
                           'https://fuente.example/cruzada')$sql$, org_bob),
       format($sql$INSERT INTO profile_evidence (id, organization_id, objective_id, kind, url)
                   VALUES ('d0260000-0026-4026-8026-00000000010e', %L,
                           'd0260000-0026-4026-8026-0000000000ba', 'http',
                           'https://fuente.example/propia')$sql$, org_alice)
  FROM t
UNION ALL
-- El puntero de la tabla MUTABLE a la INMUTABLE. El negocio y la organización
-- son los de bob en los dos: lo único cruzado es el rival curado.
SELECT 8, 'competitors -> profile_competitors',
       format($sql$INSERT INTO competitors (id, organization_id, business_id, name, profile_competitor_id)
                   VALUES ('d0260000-0026-4026-8026-00000000010f', %L,
                           'd0260000-0026-4026-8026-0000000000b1', 'Scrape cruzado',
                           'd0260000-0026-4026-8026-0000000000bc')$sql$, org_bob),
       format($sql$INSERT INTO competitors (id, organization_id, business_id, name, profile_competitor_id)
                   VALUES ('d0260000-0026-4026-8026-000000000110', %L,
                           'd0260000-0026-4026-8026-0000000000b1', 'Scrape propio',
                           'd0260000-0026-4026-8026-0000000000bd')$sql$, org_bob)
  FROM t
UNION ALL
-- La de TRES columnas, cruzada por TENANT: el ICP de alice apuntando al segmento
-- de bob. El bloque 87 la cruza por VERSIÓN dentro del mismo tenant.
SELECT 9, 'profile_icp -> profile_segments (3 columnas)',
       format($sql$INSERT INTO profile_icp (id, organization_id, profile_id, definition, primary_segment_id)
                   VALUES ('d0260000-0026-4026-8026-000000000111', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'ICP con segmento de bob',
                           'd0260000-0026-4026-8026-0000000000b3')$sql$, org_alice),
       format($sql$INSERT INTO profile_icp (id, organization_id, profile_id, definition, primary_segment_id)
                   VALUES ('d0260000-0026-4026-8026-000000000112', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'ICP con segmento propio',
                           'd0260000-0026-4026-8026-0000000000a3')$sql$, org_alice)
  FROM t
UNION ALL
-- El puntero de la decisión 14. Sin él este caso no se puede ni escribir, que es
-- la forma en que se nota que faltaba: una oferta sin `service_id` no puede
-- apuntar mal porque no puede apuntar.
SELECT 10, 'profile_offers -> business_services',
       format($sql$INSERT INTO profile_offers (id, organization_id, profile_id, name, service_id)
                   VALUES ('d0260000-0026-4026-8026-000000000113', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Oferta al servicio de bob',
                           'd0260000-0026-4026-8026-0000000000b0')$sql$, org_alice),
       format($sql$INSERT INTO profile_offers (id, organization_id, profile_id, name, service_id)
                   VALUES ('d0260000-0026-4026-8026-000000000114', %L,
                           'd0260000-0026-4026-8026-0000000000a2', 'Oferta al servicio propio',
                           'd0260000-0026-4026-8026-0000000000a0')$sql$, org_alice)
  FROM t;

CREATE TEMP TABLE h1_resultados ON COMMIT DROP AS
SELECT n, relacion,
       pg_temp.sqlstate_sin_huella(cruzado)  AS estado_cruzado,
       pg_temp.sqlstate_sin_huella(legitimo) AS estado_legitimo
  FROM h1_casos;

-- ANTI-VACUIDAD DEL BUCLE. El denominador es un número escrito: diez casos, diez
-- resultados. Sin esto, un `UNION ALL` que se rompiera al editarlo dejaría el
-- bucle midiendo tres relaciones y los dos bloques informando cero con la misma
-- cara. Y se afirma que las diez relaciones DECLARADAS son las diez medidas, no
-- sólo cuántas son.
DO $$
DECLARE
    n_casos int;
    faltan  text;
BEGIN
    SELECT count(*) INTO n_casos FROM h1_resultados;
    IF n_casos <> 10 THEN
        RAISE EXCEPTION
            'Corrida vacua de los bloques 79 y 80: se midieron % casos cruzados y se declararon 10.',
            n_casos;
    END IF;

    SELECT string_agg(d, ', ') INTO faltan
      FROM unnest(ARRAY[
            'profile_offers -> company_profiles',
            'profile_markets -> company_profiles',
            'profile_segments -> company_profiles',
            'profile_competitors -> company_profiles',
            'profile_icp -> company_profiles',
            'profile_objectives -> company_profiles',
            'profile_evidence -> profile_objectives',
            'competitors -> profile_competitors',
            'profile_icp -> profile_segments (3 columnas)',
            'profile_offers -> business_services']) d
     WHERE d NOT IN (SELECT relacion FROM h1_resultados);

    IF faltan IS NOT NULL THEN
        RAISE EXCEPTION
            'Corrida vacua de los bloques 79 y 80: las relaciones medidas no son las declaradas. Faltan: %.',
            faltan;
    END IF;

    RAISE NOTICE 'Bloques 79 y 80: 10 relaciones cruzadas, cada una con su control positivo.';
END
$$;

INSERT INTO defect_report
SELECT 79, 'un hijo de la organización B se cuelga de la ficha de la organización A',
       count(*) FILTER (WHERE estado_cruzado IS DISTINCT FROM '23503') > 0,
       count(*) FILTER (WHERE estado_cruzado IS DISTINCT FROM '23503') || ' de ' ||
       count(*) || ' relaciones NO rechazan el cruce con 23503' ||
       coalesce(': ' || string_agg(relacion || ' = ' || coalesce(estado_cruzado, 'ACEPTADO'),
                                   ', ' ORDER BY n)
                        FILTER (WHERE estado_cruzado IS DISTINCT FROM '23503'), '')
  FROM h1_resultados;

-- ── 80 ───────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DE LAS DIEZ. Mismas sentencias, dato correcto: tienen que
-- pasar. Sin este bloque, una migración que rechazara todos los hijos —una FK
-- contra una tabla vacía, un CHECK imposible, un REVOKE de más— pondría el 79 en
-- verde.
INSERT INTO defect_report
SELECT 80, 'el esquema también rechaza al hijo legítimo de la propia organización',
       count(*) FILTER (WHERE estado_legitimo IS NOT NULL) > 0,
       count(*) FILTER (WHERE estado_legitimo IS NOT NULL) || ' de ' || count(*) ||
       ' relaciones rechazan también la fila legítima' ||
       coalesce(': ' || string_agg(relacion || ' = ' || estado_legitimo, ', ' ORDER BY n)
                        FILTER (WHERE estado_legitimo IS NOT NULL), '')
  FROM h1_resultados;

-- VERIFICADO POR MUTACIÓN, y es la mutación que justifica que este bloque exista.
-- Se le agregó a `profile_offers` una FK de más —`(organization_id, id) ->
-- company_profiles (organization_id, id)`— que hace que TODO hijo muera con
-- `23503`, porque el id de la oferta no es el id de ninguna ficha. Medido con las
-- dos sentencias de los bloques 79 y 80 sobre ese esquema:
--
--   esquema mutado:  cruzado = 23503    legítimo = 23503
--   esquema sano:    cruzado = 23503    legítimo = ACEPTADO
--
-- El 79 da VERDE en las dos columnas de la izquierda. Este bloque es lo único que
-- distingue «rechaza al hijo de otro tenant» de «rechaza a todos los hijos».

-- ── 81 ───────────────────────────────────────────────────────────────────────
-- LA CONSULTA AL CATÁLOGO. La segunda mitad de la puerta.
--
-- QUÉ PREGUNTA, Y POR QUÉ CAMBIÓ. La primera versión medía
-- `array_length(co.confkey, 1) < 2`, o sea CUÁNTAS columnas referencia la FK. La
-- puerta dice otra cosa: «referencia el par (organization_id, id)». Con la aridad
-- sola, una FK de DOS columnas que no lleve `organization_id` pasa como
-- cumplidora — y ésa es justo la mutación que se colaba, porque el bucle de los
-- bloques 79 y 80 probaba una sola relación. Ahora el hallazgo es «la FK no
-- referencia el eje del tenant»: `organization_id` tiene que estar entre las
-- columnas REFERENCIADAS, resueltas con `unnest(co.confkey)` contra
-- `pg_attribute` de `co.confrelid`.
--
-- SE PIDEN LAS DOS COSAS, el eje Y la aridad, y no una sola: una FK que
-- referenciara SÓLO `(organization_id)` llevaría el eje y no pincharía ninguna
-- fila —cualquier hijo de la organización valdría—. El eje sin el par no es la
-- puerta.
--
-- El subárbol se CALCULA por cierre transitivo desde `company_profiles` sobre
-- `pg_constraint`, no se escribe a mano (R14): enumera lo que hay, no lo que
-- alguien declaró. Por eso `competitors` entra solo — gana un puntero a
-- `profile_competitors` en la `0026` — y con él entran sus dos FK viejas, que
-- tienen que aguantar la misma regla.
--
-- QUÉ FK SE EXAMINAN, y la exclusión no es una lista de nombres: sólo las que
-- apuntan a un padre que LLEVA TENANT, definido como «el padre tiene una columna
-- `organization_id`». Con eso `organizations` queda afuera sola —su llave es
-- `(id)` y no hay par posible, es la raíz del eje— y también `auth.users` y
-- `vault.secrets`, que están fuera del eje. Ninguna de las tres tiene esa
-- columna, así que la exclusión la decide el catálogo.
--
-- LA ÚNICA EXCEPCIÓN VA POR NOMBRE, CON SU MOTIVO, Y ES UNA SOLA.
-- `competitors_location_same_business_fkey` referencia
-- `business_locations (business_id, id)`: dos columnas, y ninguna es
-- `organization_id`. Con el predicado viejo pasaba por aridad; con el nuevo
-- aparece, y APARECER ES LO CORRECTO — hay que mirarla y decidir, no ajustar la
-- consulta hasta que dé cero.
--
-- Decidido: NO es un defecto del esquema, y por eso se excluye nombrándola. La §6
-- de la `0004` la escribió así a propósito —«Scoped to (business_id, ...) rather
-- than (organization_id, ...) on purpose. A location belongs to a business, not
-- merely to a tenant, and the tighter of two correct keys is the one to pick»— y
-- el par que referencia es ESTRICTAMENTE MÁS AJUSTADO que el del tenant, no más
-- laxo. Medido en la réplica: `business_locations` lleva
-- `business_locations_tenant_fkey FOREIGN KEY (organization_id, business_id)
-- REFERENCES businesses(organization_id, id)`, y `competitors` lleva la suya
-- igual, así que `business_id` determina `organization_id` por las dos puntas. Un
-- competidor no puede apuntar a una ubicación de otro tenant sin apuntar primero
-- a un negocio de otro tenant, que es lo que `competitors_tenant_fkey` impide.
--
-- Y va por NOMBRE y no por un patrón —«las que referencian (business_id, id)»—
-- porque un patrón excluye también a la FK futura que sí sea un defecto. La
-- exclusión se afirma: si la constraint nombrada deja de existir, o deja de estar
-- en el conjunto examinado, o pasa a llevar `organization_id`, la corrida ABORTA
-- pidiendo que se borre esta excepción. Una excepción que ya no excluye nada es
-- una excepción que mañana esconde algo.
--
-- POR QUÉ NO SE APLICA A TODO `public`: medido, hay 15 FK de una sola columna
-- referenciada, y una de ellas es `aeo_audits_business_id_fkey` -> `businesses`,
-- SIMPLE, que la `0025` introdujo. O sea que «FK a businesses con una sola
-- columna referenciada -> cero filas» devuelve UNA fila hoy, ANTES de que H1.1
-- empiece. Es el mismo defecto de familia que H1.1 cierra, vivo en el repo, y va
-- en su propio frente (R10). Acotar la consulta hasta que dé cero y llamar a eso
-- una medición sería lo que esta suite existe para impedir; acotarla al subárbol
-- de la ficha y DECIR que `aeo_audits` queda afuera es otra cosa.
CREATE TEMP TABLE h1_subarbol ON COMMIT DROP AS
WITH RECURSIVE arbol(oid) AS (
    SELECT 'public.company_profiles'::regclass::oid
  UNION
    SELECT co.conrelid
      FROM pg_constraint co
      JOIN arbol a ON a.oid = co.confrelid
     WHERE co.contype = 'f' AND co.conrelid <> co.confrelid
)
SELECT oid, oid::regclass::text AS tabla FROM arbol;

CREATE TEMP TABLE h1_fks ON COMMIT DROP AS
SELECT s.tabla,
       co.conname,
       co.confrelid::regclass::text AS padre,
       array_length(co.confkey, 1)  AS aridad,
       -- Las columnas REFERENCIADAS, en orden, que es lo que la puerta nombra.
       (SELECT string_agg(a.attname, ', ' ORDER BY x.ord)
          FROM unnest(co.confkey) WITH ORDINALITY AS x(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = co.confrelid AND a.attnum = x.attnum) AS referenciadas,
       EXISTS (SELECT 1
                 FROM unnest(co.confkey) AS x(attnum)
                 JOIN pg_attribute a
                   ON a.attrelid = co.confrelid AND a.attnum = x.attnum
                WHERE a.attname = 'organization_id') AS lleva_tenant
  FROM pg_constraint co
  JOIN h1_subarbol s ON s.oid = co.conrelid
 WHERE co.contype = 'f'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = co.confrelid
                  AND a.attname = 'organization_id'
                  AND a.attnum > 0 AND NOT a.attisdropped);

-- La única excepción, con su motivo escrito arriba. Está en una tabla y no en un
-- `AND conname <> ...` dentro de la consulta para que se pueda AFIRMAR.
CREATE TEMP TABLE h1_excepciones (conname text PRIMARY KEY, motivo text NOT NULL)
ON COMMIT DROP;

INSERT INTO h1_excepciones VALUES (
    'competitors_location_same_business_fkey',
    'referencia business_locations (business_id, id), que es ESTRICTAMENTE más ajustado que el par del tenant: business_id determina organization_id por las FK compuestas de las dos puntas (0004 §6)');

-- ANTI-VACUIDAD, y es la mitad del valor del bloque: cero sobre cero pasa sin
-- mirar nada. Se afirman las TRES cosas que pueden hacer que la consulta mida de
-- menos — cuántas tablas tiene el subárbol, cuántas FK se examinaron, y que la
-- excepción siga excluyendo exactamente lo que dice — y los denominadores son
-- números escritos, porque un número escrito es lo que obliga a mirar el día que
-- el subárbol crezca. Un `>= 1` dejaría pasar una consulta que examina 3 de 15 y
-- sigue diciendo cero.
DO $$
DECLARE
    n_tablas int;
    n_fks    int;
    faltan   text;
    sobran   text;
    inutil   text;
    declaradas text[] := ARRAY[
        'company_profiles', 'profile_offers', 'profile_markets',
        'profile_segments', 'profile_competitors', 'profile_icp',
        'profile_objectives', 'profile_evidence',
        -- La novena, y no es de la ficha: la tabla MUTABLE de scrape que la
        -- `0026` hace apuntar a la lista curada. Entra por el cierre, no por
        -- decisión de este archivo.
        'competitors',
        -- La décima, desde la `0028`: el reporte CITA una versión de la ficha
        -- con `reports_profile_version_fkey`, así que el cierre la trae con sus
        -- dos FK —la compuesta a `businesses` y la de la cita—, las dos con el
        -- tenant. La primera corrida con la `0028` puesta se cayó acá con
        -- «Sobran: reports», que es exactamente para lo que este bloque cuenta
        -- en vez de confiar.
        'reports'
    ];
BEGIN
    SELECT count(*) INTO n_tablas FROM h1_subarbol;
    SELECT count(*) INTO n_fks    FROM h1_fks;

    SELECT string_agg(d, ', ') INTO faltan
      FROM unnest(declaradas) d
     WHERE d NOT IN (SELECT replace(tabla, 'public.', '') FROM h1_subarbol);

    SELECT string_agg(replace(tabla, 'public.', ''), ', ') INTO sobran
      FROM h1_subarbol
     WHERE replace(tabla, 'public.', '') <> ALL (declaradas);

    IF faltan IS NOT NULL OR sobran IS NOT NULL THEN
        RAISE EXCEPTION
            'Corrida vacua del bloque 81: el subárbol medido no es el declarado. Faltan: %. Sobran: %.',
            coalesce(faltan, 'ninguna'), coalesce(sobran, 'ninguna');
    END IF;

    IF n_tablas <> 10 THEN
        RAISE EXCEPTION 'Corrida vacua del bloque 81: el subárbol tiene % tablas y se declararon 10.', n_tablas;
    END IF;

    IF n_fks <> 17 THEN
        RAISE EXCEPTION
            'Corrida vacua del bloque 81: se examinaron % FK con padre con tenant y se declararon 17. Una tabla nueva en el subárbol cambia este número, y cambiarlo es mirar qué entró.',
            n_fks;
    END IF;

    -- La excepción tiene que seguir siendo necesaria. Si la constraint nombrada
    -- ya no está en el conjunto examinado, o ya lleva el tenant, la excepción
    -- dejó de excluir algo y mañana esconde otra cosa con el mismo nombre.
    SELECT string_agg(e.conname, ', ') INTO inutil
      FROM h1_excepciones e
     WHERE NOT EXISTS (SELECT 1 FROM h1_fks f
                        WHERE f.conname = e.conname AND NOT f.lleva_tenant);

    IF inutil IS NOT NULL THEN
        RAISE EXCEPTION
            'Corrida vacua del bloque 81: la excepción % ya no excluye ninguna FK sin tenant. Borrala en vez de dejarla puesta.',
            inutil;
    END IF;

    RAISE NOTICE 'Bloque 81: 10 tablas en el subárbol, 17 FK con padre con tenant examinadas, 1 excepción nombrada y viva.';
END
$$;

-- VERIFICADO POR MUTACIÓN, las tres direcciones:
--
--   * quitarle a `competitors` su FK a `profile_competitors` →
--     «el subárbol medido no es el declarado. Faltan: competitors»;
--   * agregarle a `profile_offers` una FK de más →
--     «se examinaron 16 FK con padre con tenant y se declararon 15»;
--   * darle a `profile_offers` una FK de DOS columnas que NO lleve el tenant
--     —`(profile_id, id) -> company_profiles (profile_id, id)`, con la única
--     creada a mano— → este bloque la INFORMA. Con el predicado viejo, el de la
--     aridad, esa misma mutación SOBREVIVÍA en verde: es la mutación que esta
--     corrección existe para atrapar.
--
-- Las dos primeras abortan la corrida ANTES de la tabla de hallazgos, que es la
-- dirección cara del error y la correcta: una consulta que mide de menos no tiene
-- que poder informar cero.

INSERT INTO defect_report
SELECT 81, 'alguna FK del subárbol de la ficha no referencia el par del tenant',
       count(*) FILTER (WHERE incumple) > 0,
       count(*) FILTER (WHERE incumple) || ' de ' || count(*) ||
       ' FK examinadas no referencian el par (organization_id, …)' ||
       coalesce(': ' || string_agg(tabla || '.' || conname || ' -> ' || padre ||
                                   ' (' || referenciadas || ')', ', '
                                   ORDER BY tabla, conname)
                        FILTER (WHERE incumple), '') ||
       ', con ' || (SELECT count(*) FROM h1_excepciones) || ' excepción nombrada: ' ||
       (SELECT string_agg(conname, ', ' ORDER BY conname) FROM h1_excepciones)
  FROM (
    SELECT f.*,
           (NOT f.lleva_tenant OR f.aridad < 2)
           AND f.conname NOT IN (SELECT conname FROM h1_excepciones) AS incumple
      FROM h1_fks f
  ) z;

-- ── 82 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que «un solo ICP» sea un índice y no una convención. Es el
-- mecanismo que H1.3 necesita; con dos filas, cuál es EL ICP lo decide el orden
-- de una query, y los dos productos pueden leer distintas.
INSERT INTO profile_icp (id, organization_id, profile_id, definition, primary_segment_id)
SELECT 'd0260000-0026-4026-8026-0000000000a4', org_alice,
       'd0260000-0026-4026-8026-0000000000a2', 'Clinicas de 2 a 10 empleados',
       'd0260000-0026-4026-8026-0000000000a3' FROM t;

CREATE TEMP TABLE h1_icp_doble ON COMMIT DROP AS
SELECT pg_temp.sqlstate_of(format($sql$
    INSERT INTO profile_icp (id, organization_id, profile_id, definition)
    VALUES ('d0260000-0026-4026-8026-0000000000a5', %L,
            'd0260000-0026-4026-8026-0000000000a2', 'Otro ICP de la misma version')
$sql$, (SELECT org_alice FROM t))) AS estado;

INSERT INTO defect_report
SELECT 82, 'una versión de la ficha admite dos ICP',
       estado IS DISTINCT FROM '23505',
       CASE WHEN estado IS NULL THEN 'ACEPTADO: hay dos ICP en la misma versión'
            WHEN estado = '23505' THEN 'rechazado por el índice único, 23505'
            ELSE 'rechazado con ' || estado || ', que no es el único por versión' END
  FROM h1_icp_doble;

-- ── 83 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que «cambiar la ficha» —el verbo de H1.2 y de H1.3— no sea
-- ambiguo. Con dos borradores abiertos de la misma empresa, cuál se publica lo
-- decide el orden de una query.
CREATE TEMP TABLE h1_dos_borradores ON COMMIT DROP AS
SELECT pg_temp.sqlstate_of(format($sql$
    INSERT INTO company_profiles (id, organization_id, business_id, version, status)
    VALUES ('d0260000-0026-4026-8026-0000000000ae', %L,
            'd0260000-0026-4026-8026-0000000000a1', 4, 'draft')
$sql$, (SELECT org_alice FROM t))) AS estado;

INSERT INTO defect_report
SELECT 83, 'una empresa puede tener dos borradores de ficha abiertos',
       estado IS DISTINCT FROM '23505',
       CASE WHEN estado IS NULL THEN 'ACEPTADO: dos borradores abiertos, y "la ficha" deja de ser una fila'
            WHEN estado = '23505' THEN 'rechazado por el único parcial, 23505'
            ELSE 'rechazado con ' || estado || ', que no es el único parcial de borradores' END
  FROM h1_dos_borradores;

-- ── 84 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que 'published' no sea una palabra que alguien escribió. Es la
-- mitad de H1.2 que se puede poner hoy sin el guard de inmutabilidad: una
-- versión publicada sin fecha ni persona no se puede auditar, y el reporte que
-- la cite estaría citando algo que nadie publicó.
CREATE TEMP TABLE h1_publicada_incompleta ON COMMIT DROP AS
SELECT pg_temp.sqlstate_of(format($sql$
    INSERT INTO company_profiles (id, organization_id, business_id, version, status)
    VALUES ('d0260000-0026-4026-8026-0000000000ad', %L,
            'd0260000-0026-4026-8026-0000000000a1', 3, 'published')
$sql$, (SELECT org_alice FROM t))) AS estado;

INSERT INTO defect_report
SELECT 84, 'una versión puede decir "published" sin fecha ni persona',
       estado IS DISTINCT FROM '23514',
       CASE WHEN estado IS NULL THEN 'ACEPTADO: "publicada" es una palabra, no un hecho auditable'
            WHEN estado = '23514' THEN 'rechazado por el CHECK de completitud, 23514'
            ELSE 'rechazado con ' || estado || ', que no es el CHECK de completitud' END
  FROM h1_publicada_incompleta;

-- ── 85 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la llave que viaja en el bundle del navegador no LEA la ficha.
-- El bloque 14 sólo mira privilegios de ESCRITURA de `anon`, así que un SELECT
-- suyo sobre una tabla nueva no lo despierta — el mismo motivo por el que la
-- `0025` necesitó su bloque 74. Y los default privileges de Supabase le dan los
-- siete privilegios a cada tabla nueva de `public`, así que esto no queda
-- cerrado solo.
INSERT INTO defect_report
SELECT 85, 'anon puede leer la ficha',
       count(*) > 0,
       CASE WHEN count(*) > 0
            THEN 'anon tiene SELECT sobre ' || string_agg(t, ', ' ORDER BY t)
            ELSE 'anon no puede leer ninguna de las 8 tablas de la ficha'
            END
  FROM (VALUES ('company_profiles'), ('profile_offers'), ('profile_markets'),
               ('profile_segments'), ('profile_competitors'), ('profile_icp'),
               ('profile_objectives'), ('profile_evidence')) v(t)
 WHERE has_table_privilege('anon', 'public.' || t, 'SELECT');

-- ── 86 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la regla de H1.4 «la fuente responde desde un origen distinto
-- al dominio propio» se resuelva comparando COLUMNAS y no reparseando cadenas.
-- Si `source_host` deja de ser generada, cada consumidor vuelve a extraer el
-- host con su propio criterio, y el día que dos criterios difieran la puerta da
-- verde sobre una fuente del propio dominio. Es la lección que la `0015` dejó
-- escrita al lado de `content_payload_hash`: un valor que alguien tiene que
-- acordarse de recalcular es un valor que un día no se recalcula.
--
-- LO QUE ESTE BLOQUE NO MIDE, y está escrito al lado de la columna en la `0026`:
-- con `businesses.website` vacío, `url_host('')` da la cadena vacía y la regla
-- «origen distinto al dominio propio» se satisface SOLA para cualquier fuente,
-- incluida una del propio sitio. Que la columna sea generada no arregla eso; lo
-- tiene que arreglar el job de H1.4 negándose a informar M=0 cuando el dominio
-- propio no resuelve. Sin aserción a propósito: una aserción sobre un defecto que
-- esta migración no cierra estaría en rojo.
INSERT INTO defect_report
SELECT 86, 'el origen de la evidencia no lo calcula la base',
       NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = 'public.profile_evidence'::regclass
              AND a.attname = 'source_host'
              AND a.attnum > 0 AND NOT a.attisdropped
              AND a.attgenerated = 's'),
       'sin columna generada, cada consumidor parsea el host a su manera y H1.4 mide otra cosa';

-- ── 87 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el ICP de una versión no pueda apuntar a un segmento de OTRA
-- versión. Es la forma en que «un solo ICP» se degrada en silencio: el índice
-- del bloque 82 sigue verde, hay una sola fila, y el segmento que describe es de
-- una versión distinta de la que el reporte cita.
--
-- Mismo tenant en las dos filas, a propósito: acá no se está midiendo
-- aislamiento entre clientes sino la llave más ajustada de la §6 de la `0004`. El
-- caso 9 del bucle de arriba cruza la MISMA FK por tenant; ésta es la otra mitad.
--
-- QUÉ FILAS USA, Y POR QUÉ CAMBIARON CON LA `0027`. El ICP se escribe en el
-- borrador de la segunda empresa de alice y apunta al segmento de la versión 1
-- de la PRIMERA: dos fila-versión distintas de la misma organización, que es lo
-- que la FK de tres columnas tiene que rechazar. Antes se escribía sobre la
-- versión 2 —`superseded`— y desde la `0027` el guard de inmutabilidad la
-- rechaza con 45002 antes que la FK. No es que el defecto volviera: es que el
-- rechazo llegaba por otro motivo, y este bloque exige el 23503 EXACTO
-- justamente para no aceptar eso. Y no puede escribirse en la versión 1 de
-- alice, que ya tiene su ICP desde el bloque 82: sería 23505, otro motivo
-- equivocado.
CREATE TEMP TABLE h1_icp_otra_version ON COMMIT DROP AS
SELECT pg_temp.sqlstate_of(format($sql$
    INSERT INTO profile_icp (id, organization_id, profile_id, definition, primary_segment_id)
    VALUES ('d0260000-0026-4026-8026-0000000000ac', %L,
            'd0260000-0026-4026-8026-0000000000a8', 'ICP de otra fila-version',
            'd0260000-0026-4026-8026-0000000000a3')
$sql$, (SELECT org_alice FROM t))) AS estado;

INSERT INTO defect_report
SELECT 87, 'el ICP de una versión puede apuntar a un segmento de otra versión',
       estado IS DISTINCT FROM '23503',
       CASE WHEN estado IS NULL
            THEN 'ACEPTADO: el ICP de una fila-version describe un segmento de otra'
            WHEN estado = '23503' THEN 'rechazado por la FK compuesta contra el par de la versión, 23503'
            ELSE 'rechazado con ' || estado || ', que no es la FK compuesta' END
  FROM h1_icp_otra_version;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de las policies — una ficha COMPLETA de cada organización
-- ─────────────────────────────────────────────────────────────────────────────
-- Los bloques 88 y 89 preguntan por las OCHO relaciones, así que las ocho tienen
-- que tener filas de las DOS organizaciones. Sin eso, «el miembro lee su ficha»
-- y «no ve la de la otra» se contestan las dos con cero y las dos pasan.
--
-- Va acá y no arriba a propósito: el bucle de los bloques 79 y 80 deshace sus
-- propios INSERT, y el ICP de alice lo pone el bloque 82. Filas de más antes de
-- ese punto pondrían el 82 y el 83 en verde por agotamiento del único.
RESET ROLE;

INSERT INTO profile_offers (id, organization_id, profile_id, name, service_id)
SELECT 'd0260000-0026-4026-8026-0000000000c1', org_alice,
       'd0260000-0026-4026-8026-0000000000a2', 'Limpieza dental',
       'd0260000-0026-4026-8026-0000000000a0' FROM t;
INSERT INTO profile_offers (id, organization_id, profile_id, name, service_id)
SELECT 'd0260000-0026-4026-8026-0000000000c2', org_bob,
       'd0260000-0026-4026-8026-0000000000b2', 'Cambio de aceite',
       'd0260000-0026-4026-8026-0000000000b0' FROM t;

INSERT INTO profile_markets (id, organization_id, profile_id, country, region)
SELECT 'd0260000-0026-4026-8026-0000000000c3', org_alice,
       'd0260000-0026-4026-8026-0000000000a2', 'SE', 'Stockholm' FROM t;
INSERT INTO profile_markets (id, organization_id, profile_id, country, region)
SELECT 'd0260000-0026-4026-8026-0000000000c4', org_bob,
       'd0260000-0026-4026-8026-0000000000b2', 'SE', 'Goteborg' FROM t;

-- El ICP de bob. El de alice lo puso el bloque 82.
INSERT INTO profile_icp (id, organization_id, profile_id, definition, primary_segment_id)
SELECT 'd0260000-0026-4026-8026-0000000000c5', org_bob,
       'd0260000-0026-4026-8026-0000000000b2', 'Talleres de 1 a 5 empleados',
       'd0260000-0026-4026-8026-0000000000b3' FROM t;

INSERT INTO profile_evidence (id, organization_id, objective_id, kind, url)
SELECT 'd0260000-0026-4026-8026-0000000000c6', org_alice,
       'd0260000-0026-4026-8026-0000000000ba', 'http', 'https://fuente.example/alice' FROM t;
INSERT INTO profile_evidence (id, organization_id, objective_id, kind, url)
SELECT 'd0260000-0026-4026-8026-0000000000c7', org_bob,
       'd0260000-0026-4026-8026-0000000000bb', 'http', 'https://fuente.example/bob' FROM t;

-- ANTI-VACUIDAD DE LOS DOS BLOQUES, afirmada como `postgres` —que tiene
-- BYPASSRLS— y por eso ve todo. Los dos denominadores son las ocho relaciones
-- POR organización: si a alguna le faltara una fila, el 88 la informaría como no
-- leída (rojo, correcto) y el 89 diría «cero filas ajenas» sobre una tabla vacía
-- (verde, mentira). Ésta es la línea que impide la segunda.
DO $$
DECLARE
    rel   text;
    org   uuid;
    n     int;
    vacio text := '';
BEGIN
    FOREACH rel IN ARRAY ARRAY['company_profiles', 'profile_offers', 'profile_markets',
                               'profile_segments', 'profile_competitors', 'profile_icp',
                               'profile_objectives', 'profile_evidence']
    LOOP
        FOR org IN SELECT org_alice FROM t UNION ALL SELECT org_bob FROM t
        LOOP
            EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = %L', rel, org)
               INTO n;
            IF n = 0 THEN
                vacio := vacio || rel || '/' || org::text || ' ';
            END IF;
        END LOOP;
    END LOOP;

    IF vacio <> '' THEN
        RAISE EXCEPTION
            'Corrida vacua de los bloques 88 y 89: sin filas en % el "cero filas ajenas" del 89 no informa nada.',
            vacio;
    END IF;

    RAISE NOTICE 'Bloques 88 y 89: las 8 relaciones de la ficha tienen filas de las 2 organizaciones.';
END
$$;

-- ── 88 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que EXISTA UNA POLICY DE LECTURA QUE DEJE PASAR, ejecutándola. Las
-- 16 de la `0026` son `TO authenticated` y las otras aserciones corren como
-- `growthos_app`, que NO es miembro de ese rol (medido con `pg_has_role`): con
-- ENABLE + FORCE y cero policies aplicables ese rol no ve ni escribe nada, así
-- que se podían borrar las 16 y la suite seguía verde. Este bloque es la mitad
-- POSITIVA: un miembro TIENE que leer su ficha y sus siete hijas.
--
-- Y ACÁ VA SU LÍMITE, MEDIDO, porque la primera versión de este comentario
-- afirmaba de más. Un verificador mutó el 2026-09-27 y encontró que este bloque
-- y el 89 juntos NO alcanzan: con la permisiva de lectura degradada a
-- `USING (true)` la suite quedaba verde, porque para un SELECT las dos capas se
-- tapan —la restrictiva vuelve a acotar al tenant y el 89 no lo nota—; y con las
-- ocho RESTRICTIVAS borradas, también. O sea que este bloque mide «existe ALGUNA
-- permisiva que deja pasar» y el 89 mide «la INTERSECCIÓN acota», y ninguna de
-- las dos capas queda medida por separado: hacen falta dos mutaciones
-- simultáneas para ponerlos rojos. Lo que separa las capas es el bloque 94, por
-- catálogo, que es el único lugar donde la restrictiva se puede afirmar sin que
-- la permisiva la tape.
--
-- BOB Y NO ALICE. El bloque 5 le dio a alice una membresía en la organización de
-- bob —es lo que hace que el bloque 7 mida lo que dice— así que alice ve las dos
-- organizaciones y con ella el bloque 89 no mediría nada. Mismo motivo por el que
-- los bloques 20, 36, 37 y 45 usan a grace.
--
-- LA CONSULTA SE ARMA COMO `postgres` Y SE EJECUTA COMO `authenticated`, con el
-- resultado viajando por un GUC de transacción. Es el patrón del bloque 45 y el
-- motivo es el mismo: `defect_report` no es de `authenticated`, y darle ese
-- permiso sería ensancharle los privilegios al rol que estos bloques miden, en el
-- mismo archivo que lo mide.
--
-- DEVUELVE LOS NOMBRES DE LAS RELACIONES QUE NO PUDO LEER, no un número: un cero
-- no dice cuál falló, y el día que una policy se caiga hay que saber cuál.
SELECT set_config('qa.sql88', format($sql$
    SELECT coalesce(string_agg(r, ', ' ORDER BY r), '') FROM (
        SELECT 'company_profiles' AS r
         WHERE (SELECT count(*) FROM public.company_profiles    WHERE organization_id = %1$L) = 0
        UNION ALL SELECT 'profile_offers'
         WHERE (SELECT count(*) FROM public.profile_offers       WHERE organization_id = %1$L) = 0
        UNION ALL SELECT 'profile_markets'
         WHERE (SELECT count(*) FROM public.profile_markets      WHERE organization_id = %1$L) = 0
        UNION ALL SELECT 'profile_segments'
         WHERE (SELECT count(*) FROM public.profile_segments     WHERE organization_id = %1$L) = 0
        UNION ALL SELECT 'profile_competitors'
         WHERE (SELECT count(*) FROM public.profile_competitors  WHERE organization_id = %1$L) = 0
        UNION ALL SELECT 'profile_icp'
         WHERE (SELECT count(*) FROM public.profile_icp          WHERE organization_id = %1$L) = 0
        UNION ALL SELECT 'profile_objectives'
         WHERE (SELECT count(*) FROM public.profile_objectives   WHERE organization_id = %1$L) = 0
        UNION ALL SELECT 'profile_evidence'
         WHERE (SELECT count(*) FROM public.profile_evidence     WHERE organization_id = %1$L) = 0
    ) z
$sql$, (SELECT org_bob FROM t)), true);

SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b88', pg_temp.escalar(current_setting('qa.sql88')), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 88, 'un miembro no puede leer su propia ficha: las policies no se ejecutan',
       current_setting('qa.b88') <> '',
       CASE WHEN current_setting('qa.b88') = ''
            THEN 'bob, como `authenticated`, lee las 8 relaciones de su ficha'
            ELSE 'bob no lee: ' || current_setting('qa.b88') END;

-- ── 89 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la otra mitad, y la que importa. Que el miembro que SÍ lee lo suyo
-- vea CERO filas de la otra organización. Sin el 88 al lado, este bloque lo
-- satisface un `REVOKE` —o una tabla vacía—; sin este, el 88 lo satisface
-- `USING (true)`.
--
-- El denominador está escrito arriba, en el DO de anti-vacuidad: las ocho
-- relaciones tienen filas de alice, afirmado como `postgres`. Cero sobre cero no
-- informa cero acá.
SELECT set_config('qa.sql89', format($sql$
    SELECT coalesce(string_agg(r, ', ' ORDER BY r), '') FROM (
        SELECT 'company_profiles' AS r
         WHERE (SELECT count(*) FROM public.company_profiles    WHERE organization_id = %1$L) > 0
        UNION ALL SELECT 'profile_offers'
         WHERE (SELECT count(*) FROM public.profile_offers       WHERE organization_id = %1$L) > 0
        UNION ALL SELECT 'profile_markets'
         WHERE (SELECT count(*) FROM public.profile_markets      WHERE organization_id = %1$L) > 0
        UNION ALL SELECT 'profile_segments'
         WHERE (SELECT count(*) FROM public.profile_segments     WHERE organization_id = %1$L) > 0
        UNION ALL SELECT 'profile_competitors'
         WHERE (SELECT count(*) FROM public.profile_competitors  WHERE organization_id = %1$L) > 0
        UNION ALL SELECT 'profile_icp'
         WHERE (SELECT count(*) FROM public.profile_icp          WHERE organization_id = %1$L) > 0
        UNION ALL SELECT 'profile_objectives'
         WHERE (SELECT count(*) FROM public.profile_objectives   WHERE organization_id = %1$L) > 0
        UNION ALL SELECT 'profile_evidence'
         WHERE (SELECT count(*) FROM public.profile_evidence     WHERE organization_id = %1$L) > 0
    ) z
$sql$, (SELECT org_alice FROM t)), true);

SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b89', pg_temp.escalar(current_setting('qa.sql89')), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 89, 'un miembro lee la ficha de OTRA organización',
       current_setting('qa.b89') <> '',
       CASE WHEN current_setting('qa.b89') = ''
            THEN 'bob, como `authenticated`, ve 0 filas de las 8 relaciones de alice, que sí tienen filas'
            ELSE 'bob alcanza la ficha de alice en: ' || current_setting('qa.b89') END;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de la publicación — la primera versión publicada de alice
-- ─────────────────────────────────────────────────────────────────────────────
-- Y es el control POSITIVO de los bloques 90 y 92 a la vez: que esta fila entre
-- prueba que publicar SE PUEDE, o sea que el 23505 del 90 y el 23503 del 92 no
-- vienen de que la tabla rechace toda publicación.
--
-- `published_by` es alice, que es miembro de su organización. Sin la decisión 15
-- esta línea andaría con cualquier uuid de `auth.users`.
INSERT INTO company_profiles (id, organization_id, business_id, version, status,
                              published_at, published_by)
SELECT 'd0260000-0026-4026-8026-0000000000d1', org_alice,
       'd0260000-0026-4026-8026-0000000000a1', 5, 'published', now(),
       '11111111-1111-4111-8111-111111111111' FROM t;

-- ── 90 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que «la versión vigente» sea UNA fila. El único parcial de la
-- decisión 2 cubría sólo `draft`, así que N versiones `published` de la misma
-- empresa entraban — y como el ICP es único POR VERSIÓN, dos publicadas son DOS
-- ICP publicados. H1.3 pide que los dos productos lean LA MISMA fila; con dos,
-- cuál es esa fila lo decide el orden de una query.
CREATE TEMP TABLE h1_dos_publicadas ON COMMIT DROP AS
SELECT pg_temp.sqlstate_sin_huella(format($sql$
    INSERT INTO company_profiles (id, organization_id, business_id, version, status,
                                  published_at, published_by)
    VALUES ('d0260000-0026-4026-8026-0000000000d2', %L,
            'd0260000-0026-4026-8026-0000000000a1', 6, 'published', now(), %L)
$sql$, (SELECT org_alice FROM t), '11111111-1111-4111-8111-111111111111')) AS estado;

INSERT INTO defect_report
SELECT 90, 'una empresa puede tener dos versiones publicadas a la vez',
       estado IS DISTINCT FROM '23505',
       CASE WHEN estado IS NULL
            THEN 'ACEPTADO: dos publicadas, o sea dos ICP publicados, y H1.3 pide una sola fila'
            WHEN estado = '23505' THEN 'rechazado por el único parcial de publicadas, 23505'
            ELSE 'rechazado con ' || estado || ', que no es el único parcial de publicadas' END
  FROM h1_dos_publicadas;

-- ── 91 ───────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DEL 90: `superseded` y `published` TIENEN que convivir.
-- Sin este bloque, un único NO parcial sobre `(organization_id, business_id)`
-- —que impediría tener historia— pondría el 90 en verde. Publicar la versión 3 es
-- pasar la 2 a `superseded` y la 3 a `published` en la misma transacción: si
-- `superseded` compitiera, eso sería imposible.
CREATE TEMP TABLE h1_superseded_conviven ON COMMIT DROP AS
SELECT pg_temp.sqlstate_sin_huella(format($sql$
    INSERT INTO company_profiles (id, organization_id, business_id, version, status,
                                  published_at, published_by, superseded_at)
    VALUES ('d0260000-0026-4026-8026-0000000000d3', %L,
            'd0260000-0026-4026-8026-0000000000a1', 7, 'superseded',
            now() - interval '20 days', '11111111-1111-4111-8111-111111111111', now())
$sql$, (SELECT org_alice FROM t))) AS estado;

INSERT INTO defect_report
SELECT 91, 'una versión superada no puede convivir con la publicada',
       estado IS NOT NULL,
       CASE WHEN estado IS NULL
            THEN 'la superada entró al lado de la publicada: el 90 rechaza la segunda PUBLICADA, no la historia'
            ELSE 'la superada murió con ' || estado ||
                 ': el 90 estaría en verde por impedir tener historia' END
  FROM h1_superseded_conviven;

-- ── 92 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que «publicada por» sea auditable. Medido antes de la decisión 15:
-- con `published_by uuid REFERENCES auth.users(id)`, bob publicaba una versión de
-- la organización de ALICE sin un solo error. Un registro citable que nombra a
-- una persona ajena al cliente no es una firma: es un uuid al lado de una fila.
--
-- El control positivo es el fixture de arriba: la versión 5 de alice, publicada
-- por alice —miembro de su organización—, ENTRÓ. Así que este 23503 no viene de
-- que la tabla rechace toda publicación.
--
-- GRACE Y NO ALICE, y no es intercambiable. Alice es miembro de la organización de
-- BOB desde el bloque 5, así que el par (organización de bob, alice) EXISTE en
-- `org_members` y la FK lo aceptaría: el bloque pasaría en verde midiendo nada, o
-- peor, quedaría rojo por el motivo equivocado. Grace no es de ninguna
-- organización salvo la suya, igual que en los bloques 20, 36, 37 y 45.
--
-- Y se publica sobre el negocio de BOB, no el de alice, porque el negocio de alice
-- ya tiene su versión 5 publicada: el único parcial de la decisión 16 se dispararía
-- primero y este bloque informaría 23505 en vez del 23503 que dice medir.
--
-- EL `SET CONSTRAINTS` ES LO QUE HACE EL COMMIT, y desde la decisión 18 de la
-- `0026` hace falta: la FK es `DEFERRABLE INITIALLY DEFERRED`, así que el INSERT
-- solo PASA y la negativa llega al COMMIT. Este archivo termina en ROLLBACK y
-- nunca llega a uno, así que sin esta línea el bloque informaría «aceptado» sobre
-- un esquema que rechaza. `SET CONSTRAINTS ... IMMEDIATE` dispara en ese momento
-- las comprobaciones pendientes, que es exactamente lo que el COMMIT hace. Y
-- `sqlstate_sin_huella` lo deshace con todo lo demás: el modo vuelve a diferido
-- cuando la subtransacción se revierte.
CREATE TEMP TABLE h1_publica_ajeno ON COMMIT DROP AS
SELECT pg_temp.sqlstate_sin_huella(format($sql$
    INSERT INTO company_profiles (id, organization_id, business_id, version, status,
                                  published_at, published_by)
    VALUES ('d0260000-0026-4026-8026-0000000000d4', %L,
            'd0260000-0026-4026-8026-0000000000b1', 8, 'published', now(), %L);
    SET CONSTRAINTS ALL IMMEDIATE
$sql$, (SELECT org_bob FROM t), 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')) AS estado;

INSERT INTO defect_report
SELECT 92, 'una versión puede decir que la publicó alguien que no es miembro de esa organización',
       estado IS DISTINCT FROM '23503',
       CASE WHEN estado IS NULL
            THEN 'ACEPTADO: la ficha de bob dice que la publicó grace, que no es miembro de su organización'
            WHEN estado = '23503' THEN 'rechazado por la FK compuesta contra el par de org_members, 23503'
            ELSE 'rechazado con ' || estado || ', que no es la FK contra org_members' END
  FROM h1_publica_ajeno;

-- ── 93 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: el UPDATE, que la puerta de H1.1 no nombra y que es la otra forma de
-- cruzar tenants. La FK compuesta impide el par INCONSISTENTE —cambiar sólo
-- `organization_id` en una hija muere con 23503, medido— y NO impide que alguien
-- mande un par consistente de OTRO tenant: con `(organization_id, profile_id)` de
-- la ficha de bob, la hija de alice se muda entera con un solo UPDATE. Medido como
-- `postgres`: ACEPTADO.
--
-- Así que acá se corre con el rol de la APLICACIÓN, que es la unidad en la que
-- esto puede fallar de verdad (R14): `postgres` tiene BYPASSRLS y la decisión 5 de
-- la `0026` ya declara ese precio.
--
-- EL HALLAZGO NO ES «HUBO ERROR», ES «LA FILA SE MOVIÓ», y la diferencia no es
-- estilística: un UPDATE sobre una fila que la policy no deja VER no falla, afecta
-- CERO filas y devuelve éxito. Un bloque que midiera el SQLSTATE informaría «pasó»
-- —rojo— sobre un no-op, o «rechazado» —verde— sobre un movimiento hecho por otro
-- camino. Así que lo que se afirma se lee del catálogo, como `postgres`: el par
-- (organization_id, profile_id) de la fila DESPUÉS del intento.
--
-- EL ACTOR ES ALICE, que es miembro de las DOS organizaciones desde el bloque 5.
-- Es el actor realista del bloque 5 —«a consultant, an agency operator»— y el
-- único que puede ver la fila vieja y escribir la nueva. Con bob o con grace la
-- policy escondería la fila, el UPDATE sería un no-op silencioso, y el bloque
-- estaría midiendo la invisibilidad en vez del movimiento.
--
-- SE GUARDA TAMBIÉN EL MENSAJE, con el ayudante de las funciones —que es genérico
-- aunque su nombre hable de funciones— porque el SQLSTATE no alcanza a decir QUÉ
-- lo frenó: hoy lo frena el PRIVILEGIO (decisión 6: `authenticated` sólo LEE), y
-- el día que la migración de escritura le otorgue UPDATE lo que tendría que
-- frenarlo es el `WITH CHECK` de la policy restrictiva. Los dos son 42501 y se
-- distinguen sólo por el texto.
--
-- Y SE DICE AHORA LO QUE VA A PASAR ESE DÍA, porque es la mitad útil de este
-- bloque: el `WITH CHECK` pide `organization_id IN current_user_org_ids()`, y alice
-- está en las dos, así que NO la va a frenar. Este bloque se va a poner rojo, y
-- eso será correcto: es el aviso de que la migración que otorgue UPDATE tiene que
-- decidir qué pasa con el operador que pertenece a dos clientes. Ponerlo hoy es
-- lo que hace que esa decisión no se tome por omisión.
--
-- LO QUE ESTE BLOQUE NO CIERRA, y está escrito como decisión 17 de la `0026`: una
-- ficha SIN hijas se muda de organización con un UPDATE del par completo, medido
-- ACEPTADO como `postgres`. Precedente de esa decisión: la §7 de la `0004`, que
-- declaró lo mismo para `businesses`. No hay aserción que lo cubra a propósito:
-- una aserción sobre un defecto que esta migración no cierra estaría en rojo.
SELECT set_config('qa.sql93', format($sql$
    UPDATE profile_offers
       SET organization_id = %L, profile_id = 'd0260000-0026-4026-8026-0000000000b2'
     WHERE id = 'd0260000-0026-4026-8026-0000000000c1'
$sql$, (SELECT org_bob FROM t)), true);

SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b93', pg_temp.denied_on_function(current_setting('qa.sql93')), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 93, 'una hija de la ficha se repunta a la ficha de otra organización con un UPDATE',
       o.organization_id = (SELECT org_bob FROM t)
       OR o.profile_id = 'd0260000-0026-4026-8026-0000000000b2',
       CASE WHEN o.organization_id = (SELECT org_bob FROM t)
                 OR o.profile_id = 'd0260000-0026-4026-8026-0000000000b2'
            THEN 'ACEPTADO: la oferta de alice quedó colgada de la ficha de bob, y el intento devolvió ' ||
                 current_setting('qa.b93')
            ELSE 'la fila sigue en la ficha de alice; el intento devolvió ' ||
                 current_setting('qa.b93')
            END
  FROM profile_offers o
 WHERE o.id = 'd0260000-0026-4026-8026-0000000000c1';

-- ─────────────────────────────────────────────────────────────────────────────
-- 94. Las policies de las ocho tablas de la ficha, por catálogo — CERRADO por la 0026
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ AGUJERO CIERRA, Y ES UNO QUE ESTA MISMA SUITE TENÍA ABIERTO.
--
-- Los bloques 88 y 89 ejecutan las policies, que es lo correcto, y aun así un
-- verificador midió el 2026-09-27 que DOS mutaciones sobrevivían a los 93:
--
--   * borrar las OCHO policies restrictivas (`%I_tenant_axis`) dejaba la suite
--     ENTERA en verde. Ninguna aserción las miraba;
--   * degradar la permisiva de lectura a `USING (true)`, dejando la restrictiva
--     en su lugar, también quedaba verde — porque para un SELECT las dos capas
--     se tapan: la restrictiva vuelve a acotar al tenant y el 89 no lo nota.
--
-- O sea que el 88 mide «existe ALGUNA permisiva» y el 89 mide «la INTERSECCIÓN
-- acota», y ninguna de las dos capas queda medida POR SEPARADO. Para separarlas
-- hay que romper las dos a la vez, y una aserción que necesita dos mutaciones
-- simultáneas para ponerse roja no es una aserción de ninguna de las dos.
--
-- Por eso este bloque mira el CATÁLOGO y no la conducta: es el único lugar donde
-- «la restrictiva existe y acota por el tenant» se puede afirmar sin que la
-- permisiva la tape. Es la misma división de trabajo que el bloque 13 de la
-- suite de Lead Engine: el 11 prueba que cuando la policy está, funciona; el 13
-- pregunta si está.
--
-- Las tres cosas que afirma, y su denominador:
--   1. las ocho tablas tienen su policy RESTRICTIVA `FOR ALL` —la del tenant—,
--      y toda restrictiva nombra `organization_id` en las cláusulas que su
--      comando usa: USING y WITH CHECK la de ALL y la de UPDATE, WITH CHECK la
--      de INSERT, USING la de DELETE y la de SELECT. Una restrictiva con
--      `USING (true)` sería exactamente la mutación que sobrevivía;
--   2. las ocho tienen al menos una PERMISIVA de lectura cuyo USING nombra
--      `organization_id`: la que el 88 satisface por existencia, acotada acá;
--   3. cuarenta policies en total sobre las ocho tablas. El número va escrito
--      para que una policy nueva —o una borrada— obligue a venir hasta acá, y
--      vino: eran dieciséis hasta la 0031, que le suma a cada tabla las tres
--      restrictivas del eje de rol (INSERT, UPDATE, DELETE; ninguna de las ocho
--      es interna, así que ninguna lleva la de lectura). Por comando, porque
--      una restrictiva de INSERT no tiene USING y una de DELETE no tiene WITH
--      CHECK: exigirles las dos cláusulas las daba por flojas sin serlo.
CREATE TEMP TABLE h1_policies AS
WITH tablas AS (
    SELECT c.oid, c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relname IN ('company_profiles', 'profile_offers', 'profile_markets',
                         'profile_segments', 'profile_competitors', 'profile_icp',
                         'profile_objectives', 'profile_evidence')
),
pol AS (
    SELECT t.relname,
           p.polname,
           p.polpermissive,
           p.polcmd,
           coalesce(pg_get_expr(p.polqual, p.polrelid), '')      AS usando,
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS con_check
      FROM tablas t
      JOIN pg_policy p ON p.polrelid = t.oid
)
SELECT (SELECT count(*) FROM tablas)  AS tablas,
       (SELECT count(*) FROM pol)     AS policies,
       -- Restrictivas que NO acotan por el tenant en las cláusulas de su comando.
       coalesce((SELECT string_agg(relname || '.' || polname, ', ' ORDER BY relname, polname)
                   FROM pol
                  WHERE NOT polpermissive
                    AND ((polcmd IN ('*', 'w', 'r', 'd') AND usando NOT LIKE '%organization_id%')
                      OR (polcmd IN ('*', 'w', 'a') AND con_check NOT LIKE '%organization_id%'))), '') AS restrictivas_flojas,
       -- Tablas SIN la restrictiva del tenant, que es la mutación que borró las
       -- ocho. `FOR ALL`, para que las del eje de rol de la 0031 —que son por
       -- comando— no la reemplacen en esta cuenta.
       coalesce((SELECT string_agg(t.relname, ', ' ORDER BY t.relname)
                   FROM tablas t
                  WHERE NOT EXISTS (SELECT 1 FROM pol WHERE pol.relname = t.relname AND NOT pol.polpermissive
                                                        AND pol.polcmd = '*')), '') AS sin_restrictiva,
       -- Tablas sin una permisiva de lectura acotada por el tenant.
       coalesce((SELECT string_agg(t.relname, ', ' ORDER BY t.relname)
                   FROM tablas t
                  WHERE NOT EXISTS (SELECT 1 FROM pol
                                     WHERE pol.relname = t.relname AND pol.polpermissive
                                       AND pol.polcmd IN ('r', '*')
                                       AND pol.usando LIKE '%organization_id%')), '') AS lectura_floja;

INSERT INTO defect_report
SELECT 94, 'las policies de la ficha existen pero no acotan por el tenant, o falta alguna',
       sin_restrictiva <> '' OR restrictivas_flojas <> '' OR lectura_floja <> '' OR policies <> 40 OR tablas <> 8,
       CASE WHEN sin_restrictiva = '' AND restrictivas_flojas = '' AND lectura_floja = '' AND policies = 40 AND tablas = 8
            THEN 'las ' || tablas || ' tablas de la ficha tienen su restrictiva del tenant con organization_id en USING y en WITH CHECK, ' ||
                 'toda restrictiva acota por organization_id en las cláusulas de su comando, ' ||
                 'y una permisiva de lectura acotada por el tenant; ' || policies || ' policies en total'
            ELSE 'sin restrictiva: [' || sin_restrictiva || ']; restrictivas que no acotan: [' || restrictivas_flojas ||
                 ']; lectura sin acotar: [' || lectura_floja || ']; ' || policies || ' policies sobre ' || tablas ||
                 ' tablas (se esperan 40 sobre 8)'
            END
  FROM h1_policies;

-- Anti-vacuidad del 94: sin las ocho tablas, todo lo de arriba es cero sobre
-- cero y el bloque informaría «verde» sin haber mirado una policy.
DO $$
DECLARE t int;
BEGIN
    SELECT tablas INTO t FROM h1_policies;
    IF t <> 8 THEN
        RAISE EXCEPTION 'Vacuous run: el bloque 94 encontró % de las 8 tablas de la ficha.', t;
    END IF;
END
$$;

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de H1.2 — tres versiones IDÉNTICAS en forma y distintas en estado
-- ─────────────────────────────────────────────────────────────────────────────
-- Cuatro empresas más de alice, cada una con UNA versión de siete hijas. Las
-- cuatro se escriben igual y se separan en la última línea: una queda
-- `published`, una `superseded`, una `draft` y la cuarta `published` para que el
-- bloque 101 la dé de baja de verdad. Que las tres primeras sean idénticas salvo
-- el estado es lo que hace comparables los bloques 96 y 97: si el 96 rechaza y
-- el 97 acepta las MISMAS veintidós escrituras, lo único que puede explicarlo es
-- el estado de la versión.
--
-- Y nacen BORRADOR las cuatro, con el contenido escrito antes de publicar. No es
-- una comodidad del fixture: es el único orden posible desde la `0027`, y es el
-- orden real del producto. La versión 5 de alice de más arriba está publicada y
-- vacía, y ya no se le puede agregar una hija — que es exactamente lo que estos
-- bloques miden.
--
-- Empresas de alice y no una de bob: acá no se mide aislamiento entre clientes
-- —eso son los bloques 79 y 88— sino el congelamiento dentro de un cliente. Una
-- empresa por versión porque los dos únicos parciales de la `0026` sólo dejan un
-- borrador y una publicada por empresa.
RESET ROLE;

DO $fx$
DECLARE
    v_org   uuid := (SELECT org_alice FROM t);
    v_alice uuid := '11111111-1111-4111-8111-111111111111';
    v_caso  record;
    v_biz   uuid;
    v_prof  uuid;
    v_obj   uuid;
    b       int;
    id_de   text := 'd0270000-0027-4027-8027-';
BEGIN
    FOR v_caso IN
        SELECT * FROM (VALUES
            (1, 'published',  'Alice Publicada'),
            (2, 'superseded', 'Alice Superada'),
            (3, 'draft',      'Alice Borrador'),
            (4, 'published',  'Alice Publicada Dos')
        ) AS c(idx, estado, nombre)
    LOOP
        b      := v_caso.idx * 10;
        v_biz  := (id_de || lpad(v_caso.idx::text, 12, '0'))::uuid;
        v_prof := (id_de || lpad(b::text, 12, '0'))::uuid;
        v_obj  := (id_de || lpad((b + 6)::text, 12, '0'))::uuid;

        INSERT INTO businesses (id, organization_id, name)
            VALUES (v_biz, v_org, v_caso.nombre);
        INSERT INTO company_profiles (id, organization_id, business_id, version, status)
            VALUES (v_prof, v_org, v_biz, 1, 'draft');

        INSERT INTO profile_offers (id, organization_id, profile_id, name)
            VALUES ((id_de || lpad((b+1)::text, 12, '0'))::uuid, v_org, v_prof, 'Oferta de la version');
        INSERT INTO profile_markets (id, organization_id, profile_id, country, region)
            VALUES ((id_de || lpad((b+2)::text, 12, '0'))::uuid, v_org, v_prof, 'SE', 'Stockholm');
        INSERT INTO profile_segments (id, organization_id, profile_id, name)
            VALUES ((id_de || lpad((b+3)::text, 12, '0'))::uuid, v_org, v_prof, 'Segmento de la version');
        INSERT INTO profile_competitors (id, organization_id, profile_id, name)
            VALUES ((id_de || lpad((b+4)::text, 12, '0'))::uuid, v_org, v_prof, 'Rival curado');
        INSERT INTO profile_icp (id, organization_id, profile_id, definition, primary_segment_id)
            VALUES ((id_de || lpad((b+5)::text, 12, '0'))::uuid, v_org, v_prof, 'ICP de la version',
                    (id_de || lpad((b+3)::text, 12, '0'))::uuid);
        INSERT INTO profile_objectives (id, organization_id, profile_id, statement, kind)
            VALUES (v_obj, v_org, v_prof, 'Afirmacion de la version', 'claim');
        INSERT INTO profile_evidence (id, organization_id, objective_id, kind, url)
            VALUES ((id_de || lpad((b+7)::text, 12, '0'))::uuid, v_org, v_obj, 'http',
                    'https://fuente.example/v' || v_caso.idx);

        -- Fechas en el pasado y escalonadas, a propósito: dentro de una
        -- transacción `now()` no avanza, y la decisión 8 de la `0028` pide que
        -- la versión que un reporte cita estuviera vigente cuando el reporte se
        -- escribió. Publicada hace diez días; la superada, superada hace cinco.
        -- Con las dos en `now()` la vigencia de la superada sería un intervalo
        -- vacío y nadie podría citarla nunca.
        IF v_caso.estado <> 'draft' THEN
            UPDATE company_profiles
               SET status = 'published', published_at = now() - interval '10 days',
                   published_by = v_alice
             WHERE id = v_prof;
        END IF;
        IF v_caso.estado = 'superseded' THEN
            UPDATE company_profiles
               SET status = 'superseded', superseded_at = now() - interval '5 days'
             WHERE id = v_prof;
        END IF;
    END LOOP;
END
$fx$;

-- Qué fila es cuál. Se calcula con la misma aritmética que el fixture: una tabla
-- de ids escrita a mano al lado de un fixture que los calcula son dos listas que
-- se separan.
CREATE TEMP TABLE h12_filas ON COMMIT DROP AS
SELECT c.idx,
       c.estado                                                                    AS estado_version,
       (SELECT org_alice FROM t)                                                   AS org,
       ('d0270000-0027-4027-8027-' || lpad((c.idx*10)::text, 12, '0'))::uuid       AS profile_id,
       ('d0270000-0027-4027-8027-' || lpad((c.idx*10+6)::text, 12, '0'))::uuid     AS objective_id,
       r.relacion,
       ('d0270000-0027-4027-8027-' || lpad((c.idx*10+r.off)::text, 12, '0'))::uuid AS child_id
  FROM (VALUES (1,'published'), (2,'superseded'), (3,'draft'), (4,'published')) AS c(idx, estado)
 CROSS JOIN (VALUES ('company_profiles',0), ('profile_offers',1), ('profile_markets',2),
                    ('profile_segments',3), ('profile_competitors',4), ('profile_icp',5),
                    ('profile_objectives',6), ('profile_evidence',7)) AS r(relacion, off);

-- Las veintidós escrituras. Una sola lista, usada por el bloque que exige que
-- sean rechazadas y por el que exige que sean aceptadas: dos listas paralelas se
-- separan, y el día que se separen el control positivo dejaría de controlar el
-- caso negativo.
--
-- `%1$L` = la organización, `%2$L` = la versión, `%3$L` = la fila hija,
-- `%4$L` = el objetivo (la evidencia cuelga de ahí, no de la ficha).
CREATE TEMP TABLE h12_plantillas (relacion text, operacion text, plantilla text, esperado text) ON COMMIT DROP;
INSERT INTO h12_plantillas VALUES
 ('company_profiles',   'UPDATE', $p$UPDATE company_profiles SET summary = 'reescrito' WHERE id = %2$L$p$, '45001'),

 ('profile_offers',     'INSERT', $p$INSERT INTO profile_offers (organization_id, profile_id, name) VALUES (%1$L, %2$L, 'agregada')$p$, '45002'),
 ('profile_offers',     'UPDATE', $p$UPDATE profile_offers SET name = 'reescrita' WHERE id = %3$L$p$, '45002'),
 ('profile_offers',     'DELETE', $p$DELETE FROM profile_offers WHERE id = %3$L$p$, '45002'),

 ('profile_markets',    'INSERT', $p$INSERT INTO profile_markets (organization_id, profile_id, country) VALUES (%1$L, %2$L, 'NO')$p$, '45002'),
 ('profile_markets',    'UPDATE', $p$UPDATE profile_markets SET region = 'Malmo' WHERE id = %3$L$p$, '45002'),
 ('profile_markets',    'DELETE', $p$DELETE FROM profile_markets WHERE id = %3$L$p$, '45002'),

 ('profile_segments',   'INSERT', $p$INSERT INTO profile_segments (organization_id, profile_id, name) VALUES (%1$L, %2$L, 'agregado')$p$, '45002'),
 ('profile_segments',   'UPDATE', $p$UPDATE profile_segments SET name = 'reescrito' WHERE id = %3$L$p$, '45002'),
 ('profile_segments',   'DELETE', $p$DELETE FROM profile_segments WHERE id = %3$L$p$, '45002'),

 ('profile_competitors','INSERT', $p$INSERT INTO profile_competitors (organization_id, profile_id, name) VALUES (%1$L, %2$L, 'agregado')$p$, '45002'),
 ('profile_competitors','UPDATE', $p$UPDATE profile_competitors SET name = 'reescrito' WHERE id = %3$L$p$, '45002'),
 ('profile_competitors','DELETE', $p$DELETE FROM profile_competitors WHERE id = %3$L$p$, '45002'),

 -- El INSERT del ICP tiene además el único de una fila por versión, que daría
 -- 23505. Da 45002 porque un trigger BEFORE corre ANTES de las restricciones; si
 -- algún día diera 23505, el bloque lo informaría como desvío.
 ('profile_icp',        'INSERT', $p$INSERT INTO profile_icp (organization_id, profile_id, definition) VALUES (%1$L, %2$L, 'otro ICP')$p$, '45002'),
 ('profile_icp',        'UPDATE', $p$UPDATE profile_icp SET definition = 'reescrito' WHERE id = %3$L$p$, '45002'),
 ('profile_icp',        'DELETE', $p$DELETE FROM profile_icp WHERE id = %3$L$p$, '45002'),

 ('profile_objectives', 'INSERT', $p$INSERT INTO profile_objectives (organization_id, profile_id, statement, kind) VALUES (%1$L, %2$L, 'agregada', 'claim')$p$, '45002'),
 ('profile_objectives', 'UPDATE', $p$UPDATE profile_objectives SET statement = 'reescrita' WHERE id = %3$L$p$, '45002'),
 ('profile_objectives', 'DELETE', $p$DELETE FROM profile_objectives WHERE id = %3$L$p$, '45002'),

 ('profile_evidence',   'INSERT', $p$INSERT INTO profile_evidence (organization_id, objective_id, kind, url) VALUES (%1$L, %4$L, 'http', 'https://agregada.example/x')$p$, '45002'),
 ('profile_evidence',   'UPDATE', $p$UPDATE profile_evidence SET url = 'https://reescrita.example/x' WHERE id = %3$L$p$, '45002'),
 ('profile_evidence',   'DELETE', $p$DELETE FROM profile_evidence WHERE id = %3$L$p$, '45002');

-- ── 95 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: la frase literal de la puerta H1.2 —«un UPDATE del contenido de una
-- versión PUBLICADA es rechazado por la base»— sobre la única columna de
-- contenido que vive en la fila-versión. El resto del contenido está en las
-- hijas y lo mide el 96.
--
-- `sqlstate_sin_huella` y no `sqlstate_of`: si el guard no estuviera, el UPDATE
-- pasaría y el `summary` quedaría reescrito para todos los bloques de abajo.
INSERT INTO defect_report
SELECT 95, 'el resumen de una versión publicada se puede reescribir',
       estado IS DISTINCT FROM '45001',
       CASE WHEN estado IS NULL
            THEN 'ACEPTADO: el UPDATE entró y la cita resuelve a un texto que cambió después'
            WHEN estado = '45001' THEN 'rechazado por el guard de la fila-versión, 45001'
            ELSE 'rechazado con ' || estado || ', que no es el guard de inmutabilidad' END
  FROM (SELECT pg_temp.sqlstate_sin_huella(
                   format($s$UPDATE company_profiles SET summary = 'reescrito' WHERE id = %L$s$,
                          'd0270000-0027-4027-8027-000000000010')) AS estado) x;

-- ── 96 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que «no se edita» cubra el CONTENIDO y no la fila-versión. El
-- contenido de una versión son las siete hijas; congelar sólo `company_profiles`
-- dejaría el `version_id` citado resolviendo a un ICP que alguien reescribió
-- después, que es el modo de fallo que la puerta nombra.
--
-- Veintidós escrituras por versión —un UPDATE en la ficha, e INSERT, UPDATE y
-- DELETE en cada una de las siete hijas— por las DOS versiones no borrador.
-- Cuarenta y cuatro casos, y cada uno exige su SQLSTATE EXACTO: 45001 la ficha,
-- 45002 las hijas. Un 42501 de una policy no cuenta —el rechazo tiene que venir
-- del guard—, y tampoco cuenta un 23505 o un 23503, que son el esquema
-- rechazando por su forma y no por el estado de la versión.
CREATE TEMP TABLE h12_congelado ON COMMIT DROP AS
SELECT f.estado_version, p.relacion, p.operacion, p.esperado,
       pg_temp.sqlstate_sin_huella(
           format(p.plantilla, f.org, f.profile_id, f.child_id, f.objective_id)) AS estado
  FROM h12_plantillas p
  JOIN h12_filas f ON f.relacion = p.relacion
 WHERE f.idx IN (1, 2);

INSERT INTO defect_report
SELECT 96, 'el contenido de una versión publicada o superada se puede editar en sus hijas',
       EXISTS (SELECT 1 FROM h12_congelado WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_congelado WHERE estado IS DISTINCT FROM esperado)
            THEN 'las ' || (SELECT count(*) FROM h12_congelado) ||
                 ' escrituras sobre las 8 relaciones de una versión publicada y de una superada murieron con su código exacto'
            ELSE 'desvíos: ' || (SELECT string_agg(estado_version || '/' || relacion || '/' || operacion ||
                                                   ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || esperado || ')', '; ' ORDER BY estado_version, relacion, operacion)
                                   FROM h12_congelado WHERE estado IS DISTINCT FROM esperado) END;

-- Anti-vacuidad del 96: cuarenta y cuatro casos o el bloque no midió lo que dice.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM h12_congelado;
    IF n <> 44 THEN
        RAISE EXCEPTION 'Corrida vacua del bloque 96: % casos en vez de 44.', n;
    END IF;
END
$$;

-- ── 97 ───────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DEL 96, y sin él el 96 pasa con la ficha inservible. Las
-- MISMAS veintidós escrituras sobre una versión `draft` tienen que ENTRAR las
-- veintidós. Un guard que congela también el borrador cierra de más: la ficha no
-- se podría escribir nunca, el 96 seguiría verde, y H1.1 —que dice que la ficha
-- EXISTE— quedaría desmentida por la puerta siguiente.
CREATE TEMP TABLE h12_borrador ON COMMIT DROP AS
SELECT p.relacion, p.operacion,
       pg_temp.sqlstate_sin_huella(
           format(p.plantilla, f.org, f.profile_id, f.child_id, f.objective_id)) AS estado
  FROM h12_plantillas p
  JOIN h12_filas f ON f.relacion = p.relacion
 WHERE f.idx = 3;

-- QUÉ PIDE, EXACTAMENTE, Y POR QUÉ NO ES «LAS 22 ENTRAN». Dos de las veintidós
-- las rechaza el ESQUEMA por su forma, no el guard, y está bien que lo haga:
-- el INSERT del ICP da 23505 porque el borrador ya tiene el suyo —el único de
-- una fila por versión, bloque 82—, y el DELETE del segmento da 23503 porque el
-- ICP lo señala con la FK de tres columnas en RESTRICT, que es el bloque 87.
-- Medido en la réplica al escribir este bloque.
--
-- Así que la afirmación es doble y las dos mitades hacen falta: NINGUNA de las
-- veintidós puede morir con un código del guard (45001/45002/45003), y
-- EXACTAMENTE 20 tienen que entrar. Sin la segunda mitad, un esquema que
-- rechazara las veintidós por otros motivos pasaría este control diciendo «el
-- guard no fue»; sin la primera, un guard que congelara el borrador con un
-- código nuevo pasaría inadvertido. El 20 se edita a mano y con el motivo al
-- lado, como todo número de este repositorio.
INSERT INTO defect_report
SELECT 97, 'el guard congela también el borrador y la ficha no se puede escribir',
       EXISTS (SELECT 1 FROM h12_borrador WHERE estado IN ('45001', '45002', '45003'))
         OR (SELECT count(*) FROM h12_borrador WHERE estado IS NULL) <> 20,
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_borrador WHERE estado IN ('45001', '45002', '45003'))
             AND (SELECT count(*) FROM h12_borrador WHERE estado IS NULL) = 20
            THEN '20 de las ' || (SELECT count(*) FROM h12_borrador) ||
                 ' escrituras entraron sobre el borrador y ninguna murió con un código del guard; ' ||
                 'las otras dos las rechazó la forma del esquema: ' ||
                 (SELECT string_agg(relacion || '/' || operacion || ' ' || estado, ', ' ORDER BY relacion, operacion)
                    FROM h12_borrador WHERE estado IS NOT NULL)
            ELSE 'el guard apareció sobre un borrador en [' ||
                 coalesce((SELECT string_agg(relacion || '/' || operacion || ' ' || estado, '; ' ORDER BY relacion, operacion)
                             FROM h12_borrador WHERE estado IN ('45001', '45002', '45003')), '') ||
                 '], y entraron ' || (SELECT count(*) FROM h12_borrador WHERE estado IS NULL) ||
                 ' de 22 (se esperan 20). Rechazos: ' ||
                 coalesce((SELECT string_agg(relacion || '/' || operacion || ' ' || estado, '; ' ORDER BY relacion, operacion)
                             FROM h12_borrador WHERE estado IS NOT NULL), 'ninguno') END;

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM h12_borrador;
    IF n <> 22 THEN
        RAISE EXCEPTION 'Corrida vacua del bloque 97: % casos en vez de 22.', n;
    END IF;
END
$$;

-- ── 98 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la fila que un reporte cita no se pueda BORRAR. Es la forma más
-- corta de que la cita deje de resolver, y «no se edita» no la cubre.
INSERT INTO defect_report
SELECT 98, 'una versión publicada se puede borrar y la cita deja de resolver',
       estado IS DISTINCT FROM '45001',
       CASE WHEN estado IS NULL
            THEN 'ACEPTADO: el borrado directo de la versión publicada entró'
            WHEN estado = '45001' THEN 'rechazado por el guard, 45001'
            ELSE 'rechazado con ' || estado || ', que no es el guard de inmutabilidad' END
  FROM (SELECT pg_temp.sqlstate_sin_huella(
                   format($s$DELETE FROM company_profiles WHERE id = %L$s$,
                          'd0270000-0027-4027-8027-000000000010')) AS estado) x;

-- ── 99 ───────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la única transición sancionada sea posible y que no venga con
-- nada colgado. Publicar la versión 3 es pasar la 2 a `superseded` y la 3 a
-- `published`; si eso no se pudiera, la inmutabilidad habría comprado el
-- congelamiento al precio de no poder versionar, que es el defecto de al lado.
--
-- Siete casos, y el primero es el control positivo de los otros seis. El
-- sexto es la ventana invertida —superada antes de publicada—, que desde la
-- decisión 16 de la `0027` rechaza un CHECK (23514); lo encontró la segunda
-- ronda de la revisión. El séptimo no es una transición: es la puerta de al
-- lado. `45003` es un trigger de
-- UPDATE, así que un INSERT directo como `superseded` lo esquivaba, sin fecha ni
-- persona de publicación, y la `0028` lo aceptaba como versión citable. Lo
-- encontró la revisión adversarial del 2026-09-30; lo cierra el CHECK de la
-- decisión 13 de la `0027`, con 23514.
CREATE TEMP TABLE h12_transicion ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('publicada -> superada, sola',
     $s$UPDATE company_profiles SET status = 'superseded', superseded_at = now() WHERE id = 'd0270000-0027-4027-8027-000000000010'$s$,
     NULL::text),
    ('publicada -> superada, con el resumen de regalo',
     $s$UPDATE company_profiles SET status = 'superseded', superseded_at = now(), summary = 'de paso' WHERE id = 'd0270000-0027-4027-8027-000000000010'$s$,
     '45001'),
    ('borrador -> superada, sin haber estado publicada',
     $s$UPDATE company_profiles SET status = 'superseded', superseded_at = now() WHERE id = 'd0270000-0027-4027-8027-000000000030'$s$,
     '45003'),
    ('publicada -> borrador, o sea despublicar',
     $s$UPDATE company_profiles SET status = 'draft', published_at = NULL, published_by = NULL WHERE id = 'd0270000-0027-4027-8027-000000000010'$s$,
     '45001'),
    ('superada -> publicada, o sea resucitar',
     $s$UPDATE company_profiles SET status = 'published', superseded_at = NULL WHERE id = 'd0270000-0027-4027-8027-000000000020'$s$,
     '45001'),
    ('superar una versión con fecha anterior a su publicación',
     $s$UPDATE company_profiles SET status = 'superseded', superseded_at = published_at - interval '1 day' WHERE id = 'd0270000-0027-4027-8027-000000000010'$s$,
     '23514'),
    ('insertar directo una superada que nunca se publicó',
     $s$INSERT INTO company_profiles (organization_id, business_id, version, status, superseded_at)
        SELECT organization_id, id, 2, 'superseded', now() FROM businesses
         WHERE id = 'd0270000-0027-4027-8027-000000000003'$s$,
     '23514')
) AS c(caso, sql, esperado);

CREATE TEMP TABLE h12_transicion_r ON COMMIT DROP AS
SELECT caso, esperado, pg_temp.sqlstate_sin_huella(sql) AS estado FROM h12_transicion;

INSERT INTO defect_report
SELECT 99, 'la transición de estado de una versión no está acotada a la que el versionado necesita',
       EXISTS (SELECT 1 FROM h12_transicion_r WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_transicion_r WHERE estado IS DISTINCT FROM esperado)
            THEN 'la única transición sancionada entró y los otros seis casos murieron con su código: ' ||
                 (SELECT count(*) FROM h12_transicion_r) || ' casos'
            ELSE 'desvíos: ' || (SELECT string_agg(caso || ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || coalesce(esperado, 'ACEPTADO') || ')', '; ' ORDER BY caso)
                                   FROM h12_transicion_r WHERE estado IS DISTINCT FROM esperado) END;

-- ── 100 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el guard valga para el rol con el que el producto escribe de
-- verdad. `service_role` tiene BYPASSRLS de fábrica —lo dice el encabezado de
-- `replica.sh`, y es el rol de la service key—, así que las dieciséis policies
-- de la `0026` no lo tocan. Un trigger sí. Es la diferencia entre una garantía
-- que la clave de servicio saltea y una que no.
SET LOCAL ROLE service_role;
SELECT set_config('qa.b100',
       coalesce(pg_temp.sqlstate_sin_huella(
           $s$UPDATE company_profiles SET summary = 'reescrito por la clave de servicio' WHERE id = 'd0270000-0027-4027-8027-000000000010'$s$),
       'ACEPTADO'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 100, 'la clave de servicio, que saltea RLS, también saltea la inmutabilidad',
       current_setting('qa.b100') <> '45001',
       CASE WHEN current_setting('qa.b100') = '45001'
            THEN 'service_role, con BYPASSRLS, murió con 45001: el guard no es una policy'
            WHEN current_setting('qa.b100') = 'ACEPTADO'
            THEN 'ACEPTADO: service_role reescribió el contenido de una versión publicada'
            ELSE 'service_role murió con ' || current_setting('qa.b100') ||
                 ', que no es el guard: un rechazo por privilegio no prueba la inmutabilidad' END;

-- ── 101 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DEL 98, y es la decisión 1 de la `0027` ejecutada: dar de
-- baja a la EMPRESA tiene que seguir funcionando, aunque su versión publicada no
-- se pueda borrar sola. Sin este bloque, el 98 pasaría con un producto en el que
-- no se puede dar de baja a un cliente.
--
-- Corre de verdad y no con `sin_huella`: lo que se mide es que el cascade se
-- LLEVE las hijas, y eso hay que contarlo después. Por eso el fixture tiene una
-- cuarta empresa —la «Publicada Dos»— que existe sólo para esto, y por eso este
-- bloque va al final: ningún bloque de arriba la mira.
-- EN DOS SENTENCIAS, Y NO POR ESTILO. La primera versión de este bloque hacía
-- la baja y los tres conteos en un solo SELECT, y los tres contaban 1: en una
-- sentencia todas las subconsultas ven el MISMO snapshot, tomado antes de
-- ejecutarla, así que el bloque informaba «la baja pasó pero quedaron filas»
-- sobre un cascade que había funcionado. Medido en la réplica. Contar en la
-- misma sentencia que borra es contar el pasado.
CREATE TEMP TABLE h12_baja ON COMMIT DROP AS
SELECT pg_temp.sqlstate_of(
           $s$DELETE FROM businesses WHERE id = 'd0270000-0027-4027-8027-000000000004'$s$) AS estado;

CREATE TEMP TABLE h12_cascade ON COMMIT DROP AS
SELECT (SELECT estado FROM h12_baja) AS estado,
       (SELECT count(*) FROM company_profiles WHERE business_id  = 'd0270000-0027-4027-8027-000000000004') AS quedan_versiones,
       (SELECT count(*) FROM profile_offers   WHERE profile_id   = 'd0270000-0027-4027-8027-000000000040') AS quedan_ofertas,
       (SELECT count(*) FROM profile_evidence WHERE objective_id = 'd0270000-0027-4027-8027-000000000046') AS quedan_fuentes;

INSERT INTO defect_report
SELECT 101, 'el guard de inmutabilidad impide dar de baja a un cliente',
       estado IS NOT NULL OR quedan_versiones <> 0 OR quedan_ofertas <> 0 OR quedan_fuentes <> 0,
       CASE WHEN estado IS NULL AND quedan_versiones = 0 AND quedan_ofertas = 0 AND quedan_fuentes = 0
            THEN 'dar de baja la empresa entró y el cascade se llevó la versión publicada, sus hijas y la evidencia'
            WHEN estado IS NOT NULL THEN 'dar de baja la empresa murió con ' || estado ||
                 ': el guard confundió el cascade con un borrado directo'
            ELSE 'la baja pasó pero quedaron filas: ' || quedan_versiones || ' versiones, ' ||
                 quedan_ofertas || ' ofertas, ' || quedan_fuentes || ' fuentes' END
  FROM h12_cascade;

-- ── 102 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la excepción de la decisión 9 sea exactamente lo que dice. El
-- job de H1.4 escribe `last_status` y `last_checked_at` sobre la evidencia de una
-- versión PUBLICADA —es lo único que H1.4 mide—, así que esas dos columnas
-- tienen que poder cambiar. Y NADA más: si la excepción se leyera como «la
-- evidencia de una publicada es editable», la URL de la fuente sería
-- reescribible y una afirmación publicada podría cambiar de respaldo sin dejar
-- rastro.
--
-- Los tres casos van juntos por eso: el primero solo diría que el job puede
-- correr, los otros dos solos dirían que la evidencia está congelada, y la
-- decisión 9 es la conjunción.
CREATE TEMP TABLE h12_h14 ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('la medición del job: last_status y last_checked_at',
     $s$UPDATE profile_evidence SET last_status = 200, last_checked_at = now() WHERE id = 'd0270000-0027-4027-8027-000000000017'$s$,
     NULL::text),
    ('la medición con la URL de regalo',
     $s$UPDATE profile_evidence SET last_status = 200, url = 'https://otra.example/z' WHERE id = 'd0270000-0027-4027-8027-000000000017'$s$,
     '45002'),
    ('la verificación a mano, que es una afirmación y no una medición',
     $s$UPDATE profile_evidence SET verified_at = now(), verified_by = '11111111-1111-4111-8111-111111111111' WHERE id = 'd0270000-0027-4027-8027-000000000017'$s$,
     '45002')
) AS c(caso, sql, esperado);

CREATE TEMP TABLE h12_h14_r ON COMMIT DROP AS
SELECT caso, esperado, pg_temp.sqlstate_sin_huella(sql) AS estado FROM h12_h14;

INSERT INTO defect_report
SELECT 102, 'la excepción de H1.4 deja editable la evidencia de una versión publicada',
       EXISTS (SELECT 1 FROM h12_h14_r WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_h14_r WHERE estado IS DISTINCT FROM esperado)
            THEN 'el job escribe su medición sobre una publicada, y la URL y la verificación a mano siguen congeladas'
            ELSE 'desvíos: ' || (SELECT string_agg(caso || ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || coalesce(esperado, 'ACEPTADO') || ')', '; ' ORDER BY caso)
                                   FROM h12_h14_r WHERE estado IS DISTINCT FROM esperado) END;

-- ── 103 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: las dos decisiones del guard que no se ven ejecutando el guard.
--
-- La primera es la decisión 3: el guard compara `to_jsonb(NEW)` menos dos
-- claves, no una lista de columnas, así que una columna que alguien agregue
-- mañana nace CONGELADA. Se mide agregando una columna de verdad dentro de una
-- subtransacción que se deshace, y escribiéndola sobre la versión publicada
-- JUNTO CON la transición sancionada (`published -> superseded`), que es la única
-- rama donde esa comparación decide. Con una lista de columnas escrita a mano,
-- ese UPDATE pasaría: la transición es legal y la columna nueva no está en la
-- lista.
--
-- La primera versión de este caso escribía la columna nueva SOLA, sin tocar el
-- estado. Ese UPDATE muere en el `RAISE` incondicional del final del guard, sea
-- cual sea la comparación, así que el caso quedaba verde con la mutación exacta
-- que decía atrapar. Lo midió la revisión adversarial del 2026-09-30.
--
-- La segunda es la decisión 10: `profile_child_freeze_state` resuelve de qué
-- versión es una fila por tabla, y una forma que no sabe resolver levanta 45002
-- en vez de devolver 'gone'. Importa porque 'gone' es el caso del cascade, o sea
-- PERMISO: la primera versión de la `0027` leía `profile_id` en las siete hijas y
-- `profile_evidence` no lo tiene, con lo cual toda la evidencia de una versión
-- publicada era reescribible y en verde. Se llama a la función directamente
-- porque el defecto no es alcanzable desde una tabla que hoy existe: es la tabla
-- de mañana.
--
-- EL `SET CONSTRAINTS` ANTES DEL `ALTER` ES EL PRECIO (d) DE LA DECISIÓN 18 DE LA
-- `0026`. Desde que `published_by` se comprueba al COMMIT, cada versión que este
-- archivo escribió arriba deja en cola su comprobación, y un `ALTER TABLE` sobre
-- una tabla con eventos pendientes muere: medido el 2026-10-01, al traer el #107,
-- este caso dio 55006 —`cannot ALTER TABLE ... because it has pending trigger
-- events`— en vez del 45001. Dispararlas es lo que haría el
-- COMMIT, igual que en el bloque 92. Va ADENTRO de la sentencia que se mide, y
-- no suelto en el archivo: `sqlstate_sin_huella` revierte la subtransacción y
-- con ella el modo, así que cada constraint vuelve a SU modo para los bloques de
-- después. Devolverlo a mano con `SET CONSTRAINTS ALL DEFERRED` taparía una FK
-- que una mutación volviera `INITIALLY IMMEDIATE` —el #107 lo midió—.
CREATE TEMP TABLE h12_forma ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('una columna nueva nace congelada',
     $s$DO $x$ BEGIN
            SET CONSTRAINTS ALL IMMEDIATE;
            ALTER TABLE public.company_profiles ADD COLUMN qa_columna_nueva text;
            UPDATE public.company_profiles
               SET status = 'superseded', superseded_at = now(),
                   qa_columna_nueva = 'escrita'
             WHERE id = 'd0270000-0027-4027-8027-000000000010';
        END $x$$s$,
     '45001'),
    ('una forma que el guard no sabe resolver falla cerrado',
     $s$SELECT public.profile_child_freeze_state('tabla_de_manana', '{"organization_id": "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a01"}'::jsonb)$s$,
     '45002')
) AS c(caso, sql, esperado);

CREATE TEMP TABLE h12_forma_r ON COMMIT DROP AS
SELECT caso, esperado, pg_temp.sqlstate_sin_huella(sql) AS estado FROM h12_forma;

INSERT INTO defect_report
SELECT 103, 'el guard enumera columnas a mano, o se calla ante una forma que no conoce',
       EXISTS (SELECT 1 FROM h12_forma_r WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_forma_r WHERE estado IS DISTINCT FROM esperado)
            THEN 'una columna agregada después queda congelada, y una tabla que el guard no sabe resolver levanta 45002'
            ELSE 'desvíos: ' || (SELECT string_agg(caso || ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || esperado || ')', '; ' ORDER BY caso)
                                   FROM h12_forma_r WHERE estado IS DISTINCT FROM esperado) END;

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture de la cita — la `0028`
-- ─────────────────────────────────────────────────────────────────────────────
-- Los bloques 104 a 109 citan las versiones del fixture de H1.2: la publicada de
-- «Alice Publicada» (…10), la superada de «Alice Superada» (…20) y el borrador
-- de «Alice Borrador» (…30). Van DESPUÉS de los bloques 95 a 103 a propósito: el
-- 106 publica una versión 2 de «Alice Publicada» de verdad, y con eso la …10
-- pasa a superada; los bloques de arriba la miran publicada.
--
-- Un reporte sin cita de la misma empresa, para el control positivo del 107
-- (poner la cita por primera vez sí se puede).
RESET ROLE;

INSERT INTO reports (id, organization_id, business_id, title)
SELECT 'd0280000-0028-4028-8028-000000000000', org_alice,
       'd0270000-0027-4027-8027-000000000001', 'Reporte sin cita' FROM t;

-- ── 104 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que un reporte no pueda citar la ficha de OTRA organización. El
-- reporte es de bob y cita la versión publicada de alice. Exige 23503 EXACTO: la
-- FK compuesta, no el trigger —que sin fila no decide, decisión 6 de la
-- `0028`— ni una policy.
INSERT INTO defect_report
SELECT 104, 'un reporte puede citar la ficha de otra organización',
       estado IS DISTINCT FROM '23503',
       CASE WHEN estado IS NULL
            THEN 'ACEPTADO: el reporte de bob cita la versión publicada de alice'
            WHEN estado = '23503' THEN 'rechazado por la FK compuesta contra la terna (organización, empresa, versión), 23503'
            ELSE 'rechazado con ' || estado || ', que no es la FK compuesta' END
  FROM (SELECT pg_temp.sqlstate_sin_huella(format($s$
            INSERT INTO reports (organization_id, business_id, title, profile_version_id)
            VALUES (%L, 'd0260000-0026-4026-8026-0000000000b1', 'Reporte de bob',
                    'd0270000-0027-4027-8027-000000000010')
        $s$, (SELECT org_bob FROM t))) AS estado) x;

-- ── 105 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que un reporte no cite un BORRADOR. La FK resolvería —la fila
-- existe—, pero a una fila que se puede reescribir después, que es el modo de
-- fallo de H1.2 con otras palabras. Exige 45004, el código de la `0028`.
--
-- DOS CASOS, Y EL SEGUNDO ES EL QUE MIDE LA RAMA. Un borrador sin fecha de
-- publicación lo frenan dos cosas a la vez: la rama «es un borrador» y la regla
-- de vigencia (`published_at` NULL). La segunda ronda de la revisión adversarial
-- mostró que todos los borradores citados en la suite eran de ésos, así que
-- borrar la rama de borrador dejaba todo verde. El esquema permite un borrador
-- CON `published_at` y `published_by` —los CHECK los exigen para `published` y
-- `superseded`, no los prohíben para `draft`—, y para ése la rama de borrador es
-- lo único que frena la cita. El segundo caso le pone fecha de publicación al
-- borrador y lo cita, dentro de una subtransacción que se deshace.
CREATE TEMP TABLE h12_cita_borrador ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('citar un borrador sin fecha de publicación',
     $s$INSERT INTO reports (organization_id, business_id, title, profile_version_id)
        SELECT org_alice, 'd0270000-0027-4027-8027-000000000003', 'Reporte del borrador',
               'd0270000-0027-4027-8027-000000000030' FROM t$s$,
     '45004'),
    ('citar un borrador que tiene fecha y persona de publicación',
     $s$DO $x$ BEGIN
            UPDATE company_profiles
               SET published_at = now() - interval '1 day', published_by = '11111111-1111-4111-8111-111111111111'
             WHERE id = 'd0270000-0027-4027-8027-000000000030';
            INSERT INTO reports (organization_id, business_id, title, profile_version_id)
            SELECT org_alice, 'd0270000-0027-4027-8027-000000000003', 'Reporte del borrador fechado',
                   'd0270000-0027-4027-8027-000000000030' FROM t;
        END $x$$s$,
     '45004')
) AS c(caso, sql, esperado);

CREATE TEMP TABLE h12_cita_borrador_r ON COMMIT DROP AS
SELECT caso, esperado, pg_temp.sqlstate_sin_huella(sql) AS estado FROM h12_cita_borrador;

INSERT INTO defect_report
SELECT 105, 'un reporte puede citar un borrador, que después se reescribe',
       EXISTS (SELECT 1 FROM h12_cita_borrador_r WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_cita_borrador_r WHERE estado IS DISTINCT FROM esperado)
            THEN 'citar un borrador murió con 45004, con y sin fecha de publicación'
            ELSE 'desvíos: ' || (SELECT string_agg(caso || ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || esperado || ')', '; ' ORDER BY caso)
                                   FROM h12_cita_borrador_r WHERE estado IS DISTINCT FROM esperado) END;

-- ── 106 ──────────────────────────────────────────────────────────────────────
-- LA MITAD (b) DE LA PUERTA H1.2, EN SQL: «un reporte generado cita un
-- version_id que resuelve a ESA FILA EXACTA». Lo que se mide acá es la parte de
-- esa frase que depende de la base: que la fila citada no pueda decir otra cosa
-- después de citada.
--
-- QUÉ NO MIDE, Y LA PRIMERA VERSIÓN DECÍA QUE SÍ. La revisión adversarial del
-- 2026-09-30 mostró que la primera versión de este bloque quedaba verde con TODOS
-- los mecanismos de la `0027` y la `0028` borrados: elegía las dos citas a mano y
-- después comprobaba que estuvieran las que había escrito. Decía ser la mitad
-- (c) —«regenerar el MISMO reporte cita un id distinto»—, y eso no lo hace la
-- base: quien elige qué versión citar al regenerar es el orquestador, y lo mide
-- el test 3 de `src/lib/reports/__tests__/orchestrator.profileCitation.test.ts`.
--
-- Lo que la base SÍ hace, y este bloque mide, son tres cosas, cada una con un
-- mecanismo que si falta lo pone rojo:
--   1. la versión 2 no se puede citar mientras es borrador (45004, el trigger de
--      la `0028`): la única forma de que un reporte cite la ficha nueva es
--      publicarla;
--   2. después de publicar la 2, el ICP de la 1 —que el reporte A ya cita— no se
--      puede reescribir (45002, el guard de las hijas de la `0027`);
--   3. las dos citas resuelven, cada una a su fila, y la de A sigue diciendo lo
--      que decía cuando se citó.
--
-- Las fechas van explícitas y escalonadas porque dentro de una transacción
-- `now()` no avanza y la decisión 8 de la `0028` pide que la versión citada
-- estuviera vigente cuando se escribió el reporte: A se escribe «ahora» contra la
-- 1, la 2 se publica un segundo después, y B se escribe dos segundos después.
--
-- Corre de verdad, no con `sin_huella`: el 107 y el 109 usan lo que deja.
INSERT INTO reports (id, organization_id, business_id, title, profile_version_id)
SELECT 'd0280000-0028-4028-8028-00000000000a', org_alice,
       'd0270000-0027-4027-8027-000000000001', 'Reporte A',
       'd0270000-0027-4027-8027-000000000010' FROM t;

-- Cambiar la ficha: la versión 2, con otro ICP, escrita como borrador.
INSERT INTO company_profiles (id, organization_id, business_id, version, status)
SELECT 'd0280000-0028-4028-8028-000000000020', org_alice,
       'd0270000-0027-4027-8027-000000000001', 2, 'draft' FROM t;
INSERT INTO profile_icp (id, organization_id, profile_id, definition)
SELECT 'd0280000-0028-4028-8028-000000000025', org_alice,
       'd0280000-0028-4028-8028-000000000020', 'ICP NUEVO de la version 2' FROM t;

-- 1. Citar la 2 mientras es borrador.
SELECT set_config('qa.b106_borrador', coalesce(pg_temp.sqlstate_sin_huella(format($s$
    INSERT INTO reports (organization_id, business_id, title, profile_version_id)
    VALUES (%L, 'd0270000-0027-4027-8027-000000000001', 'Reporte contra el borrador',
            'd0280000-0028-4028-8028-000000000020')
$s$, (SELECT org_alice FROM t))), 'ACEPTADO'), true);

-- Publicarla: la 1 a superada y la 2 a publicada, un segundo después de A.
UPDATE company_profiles
   SET status = 'superseded', superseded_at = now() + interval '1 second'
 WHERE id = 'd0270000-0027-4027-8027-000000000010';
UPDATE company_profiles
   SET status = 'published', published_at = now() + interval '1 second',
       published_by = '11111111-1111-4111-8111-111111111111'
 WHERE id = 'd0280000-0028-4028-8028-000000000020';

-- 2. Reescribir el ICP de la 1, que A ya cita.
SELECT set_config('qa.b106_reescribir', coalesce(pg_temp.sqlstate_sin_huella(
    $s$UPDATE profile_icp SET definition = 'ICP reescrito despues de citado'
        WHERE profile_id = 'd0270000-0027-4027-8027-000000000010'$s$), 'ACEPTADO'), true);

-- Reporte B: la misma empresa, contra la versión vigente.
INSERT INTO reports (id, organization_id, business_id, title, profile_version_id, created_at)
SELECT 'd0280000-0028-4028-8028-00000000000b', org_alice,
       'd0270000-0027-4027-8027-000000000001', 'Reporte B',
       'd0280000-0028-4028-8028-000000000020', now() + interval '2 seconds' FROM t;

-- 3. Resolver las dos citas.
CREATE TEMP TABLE h12_cita ON COMMIT DROP AS
SELECT r.id AS reporte, r.profile_version_id AS cita, cp.version, cp.status, icp.definition
  FROM reports r
  LEFT JOIN company_profiles cp ON cp.organization_id = r.organization_id AND cp.id = r.profile_version_id
  LEFT JOIN profile_icp icp     ON icp.organization_id = cp.organization_id AND icp.profile_id = cp.id
 WHERE r.id IN ('d0280000-0028-4028-8028-00000000000a', 'd0280000-0028-4028-8028-00000000000b');

INSERT INTO defect_report
SELECT 106, 'la cita no resuelve a lo citado: se puede citar un borrador, o reescribir lo que ya se citó',
       NOT coalesce(current_setting('qa.b106_borrador') = '45004'
            AND current_setting('qa.b106_reescribir') = '45002'
            AND a.cita IS NOT NULL AND b.cita IS NOT NULL AND a.cita <> b.cita
            AND a.version = 1 AND a.status = 'superseded' AND a.definition = 'ICP de la version'
            AND b.version = 2 AND b.status = 'published' AND b.definition = 'ICP NUEVO de la version 2', false),
       'citar la v2 siendo borrador dio ' || current_setting('qa.b106_borrador') || ' (esperado 45004); ' ||
       'reescribir el ICP de la v1 ya citada dio ' || current_setting('qa.b106_reescribir') || ' (esperado 45002); ' ||
       'el reporte A cita v' || coalesce(a.version::text, '?') || ' (' || coalesce(a.status, 'no resuelve') ||
       ', ICP «' || coalesce(a.definition, '—') || '»); el B cita v' || coalesce(b.version::text, '?') ||
       ' (' || coalesce(b.status, 'no resuelve') || ', ICP «' || coalesce(b.definition, '—') || '»)'
  FROM (SELECT * FROM h12_cita WHERE reporte = 'd0280000-0028-4028-8028-00000000000a') a
 CROSS JOIN (SELECT * FROM h12_cita WHERE reporte = 'd0280000-0028-4028-8028-00000000000b') b;

-- Anti-vacuidad del 106: si alguno de los dos reportes no quedó, el CROSS JOIN
-- de arriba no produce fila y el bloque no se registra. Esto lo dice antes y con
-- nombre.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM h12_cita;
    IF n <> 2 THEN
        RAISE EXCEPTION 'Corrida vacua del bloque 106: % de los 2 reportes quedaron.', n;
    END IF;
END
$$;

-- ── 107 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que una cita guardada no se cambie ni se quite (decisión 5 de la
-- `0028`). Cambiar contra qué versión se escribió un reporte ya entregado es
-- reescribir su historia, aunque las dos versiones existan y estén congeladas.
--
-- Con tres controles positivos, porque el guard podría cerrar de más en tres
-- direcciones: un UPDATE de otra columna del reporte tiene que entrar; un UPDATE
-- que MANDA la misma cita que ya tenía —la forma de un PATCH o un upsert de fila
-- entera— también; y poner la cita por primera vez en un reporte que no la tenía,
-- con una versión vigente en su fecha, también.
--
-- El segundo control existe porque el primero solo no medía lo que decía. La
-- primera versión afirmaba que el retitulado probaba que el trigger es `UPDATE OF
-- profile_version_id`; la revisión adversarial mostró que lo dejan pasar DOS
-- mecanismos independientes —la lista de columnas del trigger y el `RETURN NEW`
-- temprano cuando la cita no cambia—, y que sacar cualquiera de los dos dejaba el
-- bloque verde. El reenvío de la misma cita sí dispara el trigger, así que sólo
-- el `RETURN NEW` temprano lo deja pasar: ése es el que ahora lo mide.
-- LOS DOS ÚLTIMOS CASOS, Y POR QUÉ LLEGARON EN LA SEGUNDA RONDA. El primero
-- («cambiar la cita») muere también por la regla de vigencia: el reporte A es de
-- «ahora» y la versión 2 se publicó un segundo después. Así que un guard que
-- dejara RE-APUNTAR una cita (y sólo prohibiera quitarla) quedaba verde. El
-- penúltimo re-apunta a una versión que SÍ estuvo vigente en la fecha nueva del
-- reporte: la vigencia lo deja pasar, y lo único que lo frena es la cita fija.
--
-- El último es el control positivo del arreglo de la segunda ronda: una versión
-- que se superó DESPUÉS de citada, con fecha retroactiva, deja la cita fuera de
-- su ventana, y reenviar esa misma cita en un PATCH de fila entera tiene que
-- seguir entrando. Antes el trigger la re-juzgaba en cada reenvío.
--
-- Fixture: «Alice Superada» gana su versión 2, publicada hace cinco días —la
-- sucesora real de la superada—, con un reporte de hace dos que la cita, y
-- después la versión 2 se supera con fecha retroactiva, hace tres días.
INSERT INTO company_profiles (id, organization_id, business_id, version, status)
SELECT 'd0280000-0028-4028-8028-000000000022', org_alice,
       'd0270000-0027-4027-8027-000000000002', 2, 'draft' FROM t;
UPDATE company_profiles
   SET status = 'published', published_at = now() - interval '5 days', published_by = '11111111-1111-4111-8111-111111111111'
 WHERE id = 'd0280000-0028-4028-8028-000000000022';
INSERT INTO reports (id, organization_id, business_id, title, profile_version_id, created_at)
SELECT 'd0280000-0028-4028-8028-00000000000c', org_alice,
       'd0270000-0027-4027-8027-000000000002', 'Reporte contra la superada',
       'd0270000-0027-4027-8027-000000000020', now() - interval '7 days' FROM t;
INSERT INTO reports (id, organization_id, business_id, title, profile_version_id, created_at)
SELECT 'd0280000-0028-4028-8028-00000000000d', org_alice,
       'd0270000-0027-4027-8027-000000000002', 'Reporte contra la versión 2',
       'd0280000-0028-4028-8028-000000000022', now() - interval '2 days' FROM t;
UPDATE company_profiles
   SET status = 'superseded', superseded_at = now() - interval '3 days'
 WHERE id = 'd0280000-0028-4028-8028-000000000022';

CREATE TEMP TABLE h12_cita_fija ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('cambiar la cita de un reporte guardado',
     $s$UPDATE reports SET profile_version_id = 'd0280000-0028-4028-8028-000000000020' WHERE id = 'd0280000-0028-4028-8028-00000000000a'$s$,
     '45004'),
    ('quitar la cita de un reporte guardado',
     $s$UPDATE reports SET profile_version_id = NULL WHERE id = 'd0280000-0028-4028-8028-00000000000a'$s$,
     '45004'),
    ('cambiar el título de un reporte con cita',
     $s$UPDATE reports SET title = 'Reporte A, retitulado' WHERE id = 'd0280000-0028-4028-8028-00000000000a'$s$,
     NULL::text),
    ('mandar la misma cita junto con otro cambio, como un PATCH de fila entera',
     $s$UPDATE reports SET title = 'Reporte A, otra vez', profile_version_id = 'd0270000-0027-4027-8027-000000000010' WHERE id = 'd0280000-0028-4028-8028-00000000000a'$s$,
     NULL::text),
    ('poner la cita por primera vez en un reporte que no la tenía, con la versión vigente en su fecha',
     $s$UPDATE reports SET profile_version_id = 'd0270000-0027-4027-8027-000000000010' WHERE id = 'd0280000-0028-4028-8028-000000000000'$s$,
     NULL::text),
    ('re-apuntar la cita a otra versión, moviendo la fecha a su vigencia',
     $s$UPDATE reports SET profile_version_id = 'd0280000-0028-4028-8028-000000000022', created_at = now() - interval '4 days' WHERE id = 'd0280000-0028-4028-8028-00000000000c'$s$,
     '45004'),
    ('reenviar la cita de un reporte cuya versión se superó después, con fecha retroactiva',
     $s$UPDATE reports SET title = 'Reporte contra la versión 2, otra vez', profile_version_id = 'd0280000-0028-4028-8028-000000000022' WHERE id = 'd0280000-0028-4028-8028-00000000000d'$s$,
     NULL::text)
) AS c(caso, sql, esperado);

CREATE TEMP TABLE h12_cita_fija_r ON COMMIT DROP AS
SELECT caso, esperado, pg_temp.sqlstate_sin_huella(sql) AS estado FROM h12_cita_fija;

INSERT INTO defect_report
SELECT 107, 'la cita de un reporte guardado se puede cambiar o quitar',
       EXISTS (SELECT 1 FROM h12_cita_fija_r WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_cita_fija_r WHERE estado IS DISTINCT FROM esperado)
            THEN 'cambiar, re-apuntar y quitar la cita murieron con 45004; retitular, reenviar la misma cita (también después de una superación retroactiva) y completar un reporte sin cita entraron'
            ELSE 'desvíos: ' || (SELECT string_agg(caso || ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || coalesce(esperado, 'ACEPTADO') || ')', '; ' ORDER BY caso)
                                   FROM h12_cita_fija_r WHERE estado IS DISTINCT FROM esperado) END;

-- ── 108 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DEL 105 Y DEL 115: una versión SUPERADA se puede citar
-- desde un reporte escrito cuando estaba vigente. Está congelada igual que una
-- publicada, así que la cita resuelve para siempre a lo mismo. Un trigger que
-- exigiera `published` pasaría el 105 y dejaría sin camino a un reporte viejo que
-- se re-guarda. La superada del fixture estuvo vigente de hace diez días a hace
-- cinco; el reporte es de hace siete.
INSERT INTO defect_report
SELECT 108, 'el trigger de la cita rechaza también una versión superada, que está congelada',
       estado IS NOT NULL,
       CASE WHEN estado IS NULL
            THEN 'un reporte citando una versión superada entró'
            ELSE 'citar una versión superada murió con ' || estado || ': el trigger cierra de más' END
  FROM (SELECT pg_temp.sqlstate_sin_huella(format($s$
            INSERT INTO reports (organization_id, business_id, title, profile_version_id, created_at)
            VALUES (%L, 'd0270000-0027-4027-8027-000000000002', 'Reporte de la superada',
                    'd0270000-0027-4027-8027-000000000020', now() - interval '7 days')
        $s$, (SELECT org_alice FROM t))) AS estado) x;

-- ── 109 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DE LA DECISIÓN 3 de la `0028`: dar de baja una empresa
-- cuyos reportes citan su ficha tiene que ENTRAR. La baja borra en una sentencia
-- los reportes (cascade desde `businesses`) y la ficha (otro cascade desde
-- `businesses`), y tiene que entrar.
--
-- LO QUE ESTE BLOQUE NO MIDE, dicho porque la primera versión decía que sí: la
-- elección entre `NO ACTION` y `RESTRICT` en la FK de la cita. Decía «con
-- RESTRICT, este bloque es el que se pondría rojo», y es falso: medido con la FK
-- en RESTRICT, las 117 aserciones quedan verdes (decisión 3 de la `0028`). Y
-- tampoco una FK en CASCADE, que la versión siguiente de este comentario daba
-- por detectada: una versión citada sólo puede desaparecer por esta misma baja
-- —el guard rechaza el borrado directo, no se cita un borrador, y una congelada
-- no vuelve a borrador—, así que la acción de la FK no se observa nunca. Medido
-- por la tercera ronda de la revisión. Lo que SÍ lo pone rojo, medido, es un
-- guard que confunda esta baja con un borrado directo.
--
-- «Alice Publicada» tiene ahora dos versiones y tres reportes, dos de ellos con
-- cita. Corre de verdad y cuenta después, en otra sentencia: la lección del 101.
CREATE TEMP TABLE h12_baja_citada ON COMMIT DROP AS
SELECT pg_temp.sqlstate_of(
           $s$DELETE FROM businesses WHERE id = 'd0270000-0027-4027-8027-000000000001'$s$) AS estado;

INSERT INTO defect_report
SELECT 109, 'un reporte que cita la ficha impide dar de baja a la empresa',
       b.estado IS NOT NULL OR q.reportes <> 0 OR q.versiones <> 0,
       CASE WHEN b.estado IS NULL AND q.reportes = 0 AND q.versiones = 0
            THEN 'la baja entró y se llevó los reportes con cita y las dos versiones que citaban'
            WHEN b.estado IS NOT NULL THEN 'la baja murió con ' || b.estado ||
                 ': algún guard confundió la baja de la empresa con un borrado directo'
            ELSE 'la baja pasó pero quedaron ' || q.reportes || ' reportes y ' || q.versiones || ' versiones' END
  FROM h12_baja_citada b
 CROSS JOIN (SELECT (SELECT count(*) FROM reports          WHERE business_id = 'd0270000-0027-4027-8027-000000000001') AS reportes,
                    (SELECT count(*) FROM company_profiles WHERE business_id = 'd0270000-0027-4027-8027-000000000001') AS versiones) q;

RESET ROLE;


-- ── 110 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que ningún rol pueda llamar A MANO a las seis funciones de la
-- `0027` y la `0028`. Medido antes del arreglo: con el `REVOKE ... FROM PUBLIC`
-- solo —la forma de la `0015`—, `anon` tenía EXECUTE sobre
-- `company_profile_freeze_state`, porque los default privileges de Supabase lo
-- dan POR NOMBRE a los tres roles. Esa función es `SECURITY DEFINER`, saltea RLS
-- y contesta el estado de la ficha de cualquier organización dado su id, tomando
-- un `FOR SHARE` de paso: un oráculo entre tenants a un POST de distancia.
--
-- Dos mitades. Por catálogo, las seis funciones por los cuatro roles:
-- veinticuatro pares, y ninguno puede tener EXECUTE. Y ejecutado, porque el catálogo dice qué
-- privilegio hay, no qué pasa: `anon` llama a la función y tiene que morir con
-- 42501.
CREATE TEMP TABLE h12_privilegios ON COMMIT DROP AS
SELECT f.firma, r.rol,
       to_regprocedure(f.firma) IS NOT NULL AS existe,
       CASE WHEN to_regprocedure(f.firma) IS NULL THEN NULL
            ELSE has_function_privilege(r.rol, to_regprocedure(f.firma), 'EXECUTE') END AS ejecuta
  FROM (VALUES ('public.company_profile_freeze_state(uuid, uuid)'),
               ('public.company_profiles_immutable()'),
               ('public.profile_child_freeze_state(text, jsonb)'),
               ('public.profile_child_immutable()'),
               ('public.reports_cite_frozen_version()'),
               ('public.reports_citation_is_fixed()')) AS f(firma)
 CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('growthos_app')) AS r(rol);

SET LOCAL ROLE anon;
SELECT set_config('qa.b110',
       coalesce(pg_temp.sqlstate_of(
           $s$SELECT public.company_profile_freeze_state('018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a01', 'd0270000-0027-4027-8027-000000000020')$s$),
       'ACEPTADO'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 110, 'un rol de la API puede llamar a mano a las funciones SECURITY DEFINER de la ficha',
       EXISTS (SELECT 1 FROM h12_privilegios WHERE ejecuta IS DISTINCT FROM false)
         OR current_setting('qa.b110') <> '42501',
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_privilegios WHERE ejecuta IS DISTINCT FROM false)
             AND current_setting('qa.b110') = '42501'
            THEN (SELECT count(*) FROM h12_privilegios) || ' pares función/rol sin EXECUTE, y anon llamando a la función murió con 42501'
            ELSE 'con EXECUTE: [' ||
                 coalesce((SELECT string_agg(rol || ' sobre ' || firma, '; ' ORDER BY firma, rol)
                             FROM h12_privilegios WHERE ejecuta), '') ||
                 ']; sin la función: [' ||
                 coalesce((SELECT string_agg(firma, '; ') FROM h12_privilegios WHERE NOT existe), '') ||
                 ']; anon llamándola dio ' || current_setting('qa.b110') END;

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM h12_privilegios WHERE existe;
    IF n <> 24 THEN
        RAISE EXCEPTION 'Corrida vacua del bloque 110: % de los 24 pares función/rol tienen la función.', n;
    END IF;
END
$$;

-- ── 111 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DEL 110, y es la pregunta que el 110 abre: ¿los triggers
-- siguen disparando si nadie tiene EXECUTE sobre sus funciones? PostgreSQL no lo
-- pide al disparar, y lo que ellas llaman adentro corre como su dueño. Pero eso
-- es una afirmación sobre el motor, y acá se mide con los dos roles que escriben
-- de verdad.
--
-- Con sesión (`authenticated`, alice): no puede escribir la ficha —la `0026` le
-- da sólo lectura, medido—, pero SÍ inserta reportes, que es lo que hace el
-- orquestador. Así que: citar una versión superada de su organización ENTRA, y
-- citar un borrador muere con 45004 — o sea que el trigger de la cita disparó
-- para ella, en las dos direcciones.
--
-- Con `service_role`, que es quien escribe la ficha: una hija de un borrador se
-- edita, y una de una superada muere con 45002. El bloque 100 ya lo mide sobre
-- la fila-versión; esto lo mide en una hija, que pasa por las DOS funciones
-- auxiliares.
--
-- El SQL se arma como `postgres` y viaja por un GUC, igual que en los bloques 88
-- y 89: `org_alice` sale de `org_members`, no es un literal. La primera versión
-- de este bloque escribió a mano el UUID de la organización de alice, y los dos
-- INSERT murieron con 42501 —la policy de `reports` rechazando una organización
-- de la que alice no es miembro—: el bloque se puso rojo por un rechazo por el
-- motivo equivocado, que es lo que tiene que hacer, pero el defecto era suyo.
SELECT set_config('qa.sql111a', format($s$
           INSERT INTO reports (organization_id, business_id, title, profile_version_id, created_at)
           VALUES (%L, 'd0270000-0027-4027-8027-000000000002', 'Reporte con sesion',
                   'd0270000-0027-4027-8027-000000000020', now() - interval '7 days')
       $s$, (SELECT org_alice FROM t)), true);
SELECT set_config('qa.sql111b', format($s$
           INSERT INTO reports (organization_id, business_id, title, profile_version_id)
           VALUES (%L, 'd0270000-0027-4027-8027-000000000003', 'Reporte con sesion, borrador',
                   'd0270000-0027-4027-8027-000000000030')
       $s$, (SELECT org_alice FROM t)), true);

SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b111a',
       coalesce(pg_temp.sqlstate_sin_huella(current_setting('qa.sql111a')), 'ACEPTADO'), true);
SELECT set_config('qa.b111b',
       coalesce(pg_temp.sqlstate_sin_huella(current_setting('qa.sql111b')), 'ACEPTADO'), true);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('qa.b111c',
       coalesce(pg_temp.sqlstate_sin_huella(
           $s$UPDATE profile_offers SET name = 'editada por la clave de servicio' WHERE id = 'd0270000-0027-4027-8027-000000000031'$s$),
       'ACEPTADO'), true);
SELECT set_config('qa.b111d',
       coalesce(pg_temp.sqlstate_sin_huella(
           $s$UPDATE profile_offers SET name = 'editada por la clave de servicio' WHERE id = 'd0270000-0027-4027-8027-000000000021'$s$),
       'ACEPTADO'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 111, 'sin EXECUTE, los triggers de la ficha y de la cita dejan de disparar o de dejar pasar',
       NOT (current_setting('qa.b111a') = 'ACEPTADO' AND current_setting('qa.b111b') = '45004'
            AND current_setting('qa.b111c') = 'ACEPTADO' AND current_setting('qa.b111d') = '45002'),
       'con sesión: citar una superada dio ' || current_setting('qa.b111a') ||
       ' (esperado ACEPTADO), citar un borrador dio ' || current_setting('qa.b111b') ||
       ' (esperado 45004); con service_role: editar la hija de un borrador dio ' || current_setting('qa.b111c') ||
       ' (esperado ACEPTADO), la de una superada dio ' || current_setting('qa.b111d') || ' (esperado 45002)';

RESET ROLE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Lo que encontró la revisión adversarial del 2026-09-30
-- ─────────────────────────────────────────────────────────────────────────────
-- Seis bloques, uno por defecto confirmado que ningún bloque de arriba podía
-- ver. Cada escenario lo reprodujo primero un revisor contra el esquema viejo,
-- en la réplica, y lo vio pasar.
RESET ROLE;

-- ── 112 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que una hija no se pueda SACAR de una versión congelada hacia un
-- borrador (decisión 14 de la `0027`). Mover una línea de oferta, un objetivo o
-- una fuente de la versión superada a un borrador le quita contenido a la
-- superada, y el destino del UPDATE es un borrador: la única comprobación que lo
-- frena es la que mira la versión de ORIGEN. Las veintidós plantillas del 96
-- reescriben texto y nunca cambian `profile_id`, así que borrar esa mitad del
-- guard dejaba todo verde.
--
-- El cuarto caso es la dirección contraria —meter una hija de un borrador EN la
-- versión congelada—, que frena la comprobación del DESTINO. La primera versión
-- de este bloque sólo sacaba, y la segunda ronda de la revisión mostró que
-- cambiar el destino por el origen en esa comprobación dejaba todo verde. Los
-- dos últimos casos son el control positivo: entre dos borradores, mover está
-- permitido.
INSERT INTO businesses (id, organization_id, name)
SELECT 'd0280000-0028-4028-8028-000000000100', org_alice, 'Alice Borrador Dos' FROM t;
INSERT INTO company_profiles (id, organization_id, business_id, version, status)
SELECT 'd0280000-0028-4028-8028-000000000110', org_alice,
       'd0280000-0028-4028-8028-000000000100', 1, 'draft' FROM t;
INSERT INTO profile_objectives (id, organization_id, profile_id, statement, kind)
SELECT 'd0280000-0028-4028-8028-000000000116', org_alice,
       'd0280000-0028-4028-8028-000000000110', 'Objetivo del borrador dos', 'claim' FROM t;

CREATE TEMP TABLE h12_mudanza ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('sacar una oferta de la superada hacia un borrador',
     $s$UPDATE profile_offers SET profile_id = 'd0270000-0027-4027-8027-000000000030' WHERE id = 'd0270000-0027-4027-8027-000000000021'$s$,
     '45002'),
    ('sacar un objetivo de la superada hacia un borrador',
     $s$UPDATE profile_objectives SET profile_id = 'd0270000-0027-4027-8027-000000000030' WHERE id = 'd0270000-0027-4027-8027-000000000026'$s$,
     '45002'),
    ('sacar la evidencia de la superada hacia el objetivo de un borrador',
     $s$UPDATE profile_evidence SET objective_id = 'd0270000-0027-4027-8027-000000000036' WHERE id = 'd0270000-0027-4027-8027-000000000027'$s$,
     '45002'),
    ('meter una oferta de un borrador en la superada',
     $s$UPDATE profile_offers SET profile_id = 'd0270000-0027-4027-8027-000000000020' WHERE id = 'd0270000-0027-4027-8027-000000000031'$s$,
     '45002'),
    ('mover una oferta entre dos borradores',
     $s$UPDATE profile_offers SET profile_id = 'd0280000-0028-4028-8028-000000000110' WHERE id = 'd0270000-0027-4027-8027-000000000031'$s$,
     NULL::text),
    ('mover la evidencia entre objetivos de dos borradores',
     $s$UPDATE profile_evidence SET objective_id = 'd0280000-0028-4028-8028-000000000116' WHERE id = 'd0270000-0027-4027-8027-000000000037'$s$,
     NULL::text)
) AS c(caso, sql, esperado);

CREATE TEMP TABLE h12_mudanza_r ON COMMIT DROP AS
SELECT caso, esperado, pg_temp.sqlstate_sin_huella(sql) AS estado FROM h12_mudanza;

INSERT INTO defect_report
SELECT 112, 'una hija se puede sacar de una versión congelada moviéndola a un borrador',
       EXISTS (SELECT 1 FROM h12_mudanza_r WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_mudanza_r WHERE estado IS DISTINCT FROM esperado)
            THEN 'sacar oferta, objetivo y evidencia de la superada, y meter una oferta en ella, murieron con 45002; mover entre borradores entró'
            ELSE 'desvíos: ' || (SELECT string_agg(caso || ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || coalesce(esperado, 'ACEPTADO') || ')', '; ' ORDER BY caso)
                                   FROM h12_mudanza_r WHERE estado IS DISTINCT FROM esperado) END;

-- ── 113 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la ficha NO congele el catálogo (decisión 12 de la `0027`).
-- `profile_offers.service_id` es `ON DELETE SET NULL (service_id)` desde la
-- `0026`, y ese SET NULL es un UPDATE sobre la oferta. Medido por la revisión: el
-- guard lo rechazaba con 45002 y el servicio quedaba imposible de borrar para
-- siempre si alguna versión publicada o superada lo citaba — lo contrario de lo
-- que la `0026` y la `0027` dicen.
--
-- Tres cosas, y las tres hacen falta: desenganchar la oferta A MANO sigue
-- muriendo con 45002 (la excepción no es «service_id se puede anular»); borrar
-- el servicio ENTRA; y después la oferta sigue ahí, sin servicio, que es lo que
-- la `0026` decidió.
INSERT INTO businesses (id, organization_id, name)
SELECT 'd0280000-0028-4028-8028-000000000200', org_alice, 'Alice Catalogo' FROM t;
INSERT INTO business_services (id, organization_id, business_id, slug, name)
SELECT 'd0280000-0028-4028-8028-000000000201', org_alice,
       'd0280000-0028-4028-8028-000000000200', 'catalogo-servicio', 'Servicio del catalogo' FROM t;
INSERT INTO company_profiles (id, organization_id, business_id, version, status)
SELECT 'd0280000-0028-4028-8028-000000000210', org_alice,
       'd0280000-0028-4028-8028-000000000200', 1, 'draft' FROM t;
INSERT INTO profile_offers (id, organization_id, profile_id, name, service_id)
SELECT 'd0280000-0028-4028-8028-000000000211', org_alice,
       'd0280000-0028-4028-8028-000000000210', 'Oferta con servicio',
       'd0280000-0028-4028-8028-000000000201' FROM t;
UPDATE company_profiles
   SET status = 'published', published_at = now() - interval '1 day', published_by = '11111111-1111-4111-8111-111111111111'
 WHERE id = 'd0280000-0028-4028-8028-000000000210';

SELECT set_config('qa.b113_mano', coalesce(pg_temp.sqlstate_sin_huella(
    $s$UPDATE profile_offers SET service_id = NULL WHERE id = 'd0280000-0028-4028-8028-000000000211'$s$),
    'ACEPTADO'), true);

CREATE TEMP TABLE h12_catalogo ON COMMIT DROP AS
SELECT pg_temp.sqlstate_of(
           $s$DELETE FROM business_services WHERE id = 'd0280000-0028-4028-8028-000000000201'$s$) AS estado;

INSERT INTO defect_report
SELECT 113, 'la ficha congela el catálogo: un servicio citado por una oferta publicada no se puede borrar',
       current_setting('qa.b113_mano') <> '45002' OR c.estado IS NOT NULL OR o.n <> 1 OR o.con_servicio <> 0,
       'desenganchar a mano dio ' || current_setting('qa.b113_mano') || ' (esperado 45002); ' ||
       'borrar el servicio dio ' || coalesce(c.estado, 'ACEPTADO') || ' (esperado ACEPTADO); ' ||
       'quedan ' || o.n || ' ofertas, ' || o.con_servicio || ' con servicio (esperado 1 y 0)'
  FROM h12_catalogo c
 CROSS JOIN (SELECT count(*) AS n, count(service_id) AS con_servicio
               FROM profile_offers WHERE id = 'd0280000-0028-4028-8028-000000000211') o;

-- ── 114 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que un reporte no pueda citar la ficha de OTRA EMPRESA de su misma
-- organización (decisión 2 de la `0028`). Medido por la revisión contra la FK de
-- dos columnas: el INSERT entraba, y también MOVER un reporte citado con un
-- UPDATE de `business_id`, que ni disparaba el trigger — y con eso la otra
-- empresa quedaba imposible de dar de baja. Exige 23503 exacto: la FK de tres
-- columnas.
--
-- El tercer caso es el control positivo: mover un reporte SIN cita entre
-- empresas sigue permitido; lo que la FK mira es la cita.
INSERT INTO reports (id, organization_id, business_id, title, profile_version_id, created_at)
SELECT 'd0280000-0028-4028-8028-000000000300', org_alice,
       'd0270000-0027-4027-8027-000000000002', 'Reporte de la superada, guardado',
       'd0270000-0027-4027-8027-000000000020', now() - interval '7 days' FROM t;
INSERT INTO reports (id, organization_id, business_id, title)
SELECT 'd0280000-0028-4028-8028-000000000301', org_alice,
       'd0270000-0027-4027-8027-000000000002', 'Reporte sin cita, para mover' FROM t;

CREATE TEMP TABLE h12_otra_empresa ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('citar la ficha de otra empresa de la misma organización',
     $s$INSERT INTO reports (organization_id, business_id, title, profile_version_id, created_at)
        SELECT org_alice, 'd0270000-0027-4027-8027-000000000003', 'Reporte de otra empresa',
               'd0270000-0027-4027-8027-000000000020', now() - interval '7 days' FROM t$s$,
     '23503'),
    ('mover a otra empresa un reporte que cita la ficha de la suya',
     $s$UPDATE reports SET business_id = 'd0270000-0027-4027-8027-000000000003' WHERE id = 'd0280000-0028-4028-8028-000000000300'$s$,
     '23503'),
    ('mover a otra empresa un reporte sin cita',
     $s$UPDATE reports SET business_id = 'd0270000-0027-4027-8027-000000000003' WHERE id = 'd0280000-0028-4028-8028-000000000301'$s$,
     NULL::text)
) AS c(caso, sql, esperado);

CREATE TEMP TABLE h12_otra_empresa_r ON COMMIT DROP AS
SELECT caso, esperado, pg_temp.sqlstate_sin_huella(sql) AS estado FROM h12_otra_empresa;

INSERT INTO defect_report
SELECT 114, 'un reporte puede citar la ficha de otra empresa de su organización',
       EXISTS (SELECT 1 FROM h12_otra_empresa_r WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_otra_empresa_r WHERE estado IS DISTINCT FROM esperado)
            THEN 'citar o mover hacia otra empresa murió con 23503; mover un reporte sin cita entró'
            ELSE 'desvíos: ' || (SELECT string_agg(caso || ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || coalesce(esperado, 'ACEPTADO') || ')', '; ' ORDER BY caso)
                                   FROM h12_otra_empresa_r WHERE estado IS DISTINCT FROM esperado) END;

-- ── 115 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que la versión citada estuviera VIGENTE cuando se escribió el
-- reporte (decisión 8 de la `0028`). Medido por la revisión: «poner la cita por
-- primera vez» dejaba completar un reporte de enero con una versión publicada en
-- septiembre, y la FK resolvía a una estrategia que el reporte nunca vio.
--
-- La superada del fixture estuvo vigente de hace diez días a hace cinco. Tres
-- formas de citarla fuera de eso, y la última es el control positivo (la 108 es
-- el otro).
--
-- Y EL BORDE, que la tercera ronda de la revisión encontró sin fijar: la
-- ventana es semiabierta —`published_at <= created_at < superseded_at`—, y en el
-- instante exacto del relevo la saliente ya no rige y la entrante sí. Sin estos
-- dos casos, cambiar `>=` por `>` dejaba citar LAS DOS en ese instante, y `<` por
-- `<=` ninguna. Dentro de una transacción `now()` no avanza, así que publicar y
-- generar el reporte en la misma transacción cae exactamente ahí. La saliente es
-- la superada del fixture (superada hace cinco días); la entrante, la versión 2
-- de la misma empresa que armó el 107 (publicada hace cinco días).
--
-- Las dos fechas de los casos se LEEN de las filas y no se escriben: la cuarta
-- ronda de la revisión mostró que, escritas como literales, los casos quedaban
-- en el borde sólo porque tres `'5 days'` de tres lugares distintos
-- coincidían, y mover cualquiera a `'6 days'` dejaba el borde sin medir y todo
-- verde. Y la anti-vacuidad de abajo exige que la salida de una y la entrada de
-- la otra sean el MISMO instante; si no, no es un relevo.
INSERT INTO reports (id, organization_id, business_id, title, created_at)
SELECT 'd0280000-0028-4028-8028-000000000302', org_alice,
       'd0270000-0027-4027-8027-000000000002', 'Reporte viejo, de antes de la ficha',
       now() - interval '30 days' FROM t;
INSERT INTO reports (id, organization_id, business_id, title, created_at)
SELECT 'd0280000-0028-4028-8028-000000000303', org_alice,
       'd0270000-0027-4027-8027-000000000002', 'Reporte de cuando la superada estaba vigente',
       now() - interval '7 days' FROM t;

CREATE TEMP TABLE h12_vigencia ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('un reporte de hoy citando una versión superada hace cinco días',
     $s$INSERT INTO reports (organization_id, business_id, title, profile_version_id)
        SELECT org_alice, 'd0270000-0027-4027-8027-000000000002', 'Reporte de hoy',
               'd0270000-0027-4027-8027-000000000020' FROM t$s$,
     '45004'),
    ('completar un reporte de hace treinta días con una versión publicada hace diez',
     $s$UPDATE reports SET profile_version_id = 'd0270000-0027-4027-8027-000000000020' WHERE id = 'd0280000-0028-4028-8028-000000000302'$s$,
     '45004'),
    ('mover la fecha de un reporte citado fuera de la vigencia de su versión',
     $s$UPDATE reports SET created_at = now() WHERE id = 'd0280000-0028-4028-8028-000000000300'$s$,
     '45004'),
    ('un reporte escrito en el instante exacto del relevo citando la versión saliente',
     $s$INSERT INTO reports (organization_id, business_id, title, profile_version_id, created_at)
        SELECT org_alice, 'd0270000-0027-4027-8027-000000000002', 'Reporte del relevo, contra la saliente',
               'd0270000-0027-4027-8027-000000000020',
               (SELECT superseded_at FROM company_profiles WHERE id = 'd0270000-0027-4027-8027-000000000020')
          FROM t$s$,
     '45004'),
    ('un reporte escrito en el instante exacto del relevo citando la versión entrante',
     $s$INSERT INTO reports (organization_id, business_id, title, profile_version_id, created_at)
        SELECT org_alice, 'd0270000-0027-4027-8027-000000000002', 'Reporte del relevo, contra la entrante',
               'd0280000-0028-4028-8028-000000000022',
               (SELECT published_at FROM company_profiles WHERE id = 'd0280000-0028-4028-8028-000000000022')
          FROM t$s$,
     NULL::text),
    ('completar un reporte de hace siete días con la versión vigente entonces',
     $s$UPDATE reports SET profile_version_id = 'd0270000-0027-4027-8027-000000000020' WHERE id = 'd0280000-0028-4028-8028-000000000303'$s$,
     NULL::text)
) AS c(caso, sql, esperado);

DO $$
DECLARE
    sale timestamptz := (SELECT superseded_at FROM company_profiles WHERE id = 'd0270000-0027-4027-8027-000000000020');
    entra timestamptz := (SELECT published_at FROM company_profiles WHERE id = 'd0280000-0028-4028-8028-000000000022');
BEGIN
    IF sale IS NULL OR entra IS NULL OR sale <> entra THEN
        RAISE EXCEPTION 'Corrida vacua del bloque 115: la saliente sale el % y la entrante entra el %: no es un relevo.', sale, entra;
    END IF;
END
$$;

CREATE TEMP TABLE h12_vigencia_r ON COMMIT DROP AS
SELECT caso, esperado, pg_temp.sqlstate_sin_huella(sql) AS estado FROM h12_vigencia;

INSERT INTO defect_report
SELECT 115, 'un reporte puede citar una versión que no estaba vigente cuando se escribió',
       EXISTS (SELECT 1 FROM h12_vigencia_r WHERE estado IS DISTINCT FROM esperado),
       CASE WHEN NOT EXISTS (SELECT 1 FROM h12_vigencia_r WHERE estado IS DISTINCT FROM esperado)
            THEN 'las tres citas fuera de la vigencia y la de la saliente en el relevo murieron con 45004; la entrante en el relevo y completar con la versión vigente entraron'
            ELSE 'desvíos: ' || (SELECT string_agg(caso || ' dio ' || coalesce(estado, 'ACEPTADO') ||
                                                   ' (esperado ' || coalesce(esperado, 'ACEPTADO') || ')', '; ' ORDER BY caso)
                                   FROM h12_vigencia_r WHERE estado IS DISTINCT FROM esperado) END;

-- ── 116 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el trigger de la cita no le diga a otra organización si una
-- versión suya es un borrador (decisión 6 de la `0028`). Medido por la revisión
-- contra el trigger `BEFORE`: un miembro de la organización A escribiendo un
-- reporte con el `organization_id` de la B recibía 45004 si la versión de B era
-- un borrador y 42501 si no — el oráculo entre tenants que la decisión 11 de la
-- `0027` había cerrado, reabierto por otra puerta. Con el trigger `AFTER`, RLS
-- contesta primero y la respuesta es 42501 siempre.
--
-- BOB SONDEA A ALICE, Y NO AL REVÉS. La primera versión de este bloque ponía a
-- alice sondeando a bob, y daba 45004 con el arreglo puesto: alice ES miembro de
-- la organización de bob desde el bloque 5 (lo dice el 92), así que RLS la deja
-- pasar y saber que es un borrador es su derecho. Bob no es miembro de la de
-- alice —el 89 lo mide—, que es lo que hace falta para que esto sea un sondeo.
--
-- La versión de alice TIENE que ser un borrador para que el caso mida algo: si no
-- lo fuera, el 42501 saldría igual con el trigger viejo. El predicado lo afirma.
SELECT set_config('qa.sql116', format($s$
    INSERT INTO reports (organization_id, business_id, title, profile_version_id)
    VALUES (%L, 'd0270000-0027-4027-8027-000000000003', 'Sondeo de bob',
            'd0270000-0027-4027-8027-000000000030')
$s$, (SELECT org_alice FROM t)), true);
SELECT set_config('qa.b116_estado',
       coalesce((SELECT status FROM company_profiles WHERE id = 'd0270000-0027-4027-8027-000000000030'), 'no existe'),
       true);

SELECT pg_temp.be('22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b116',
       coalesce(pg_temp.sqlstate_sin_huella(current_setting('qa.sql116')), 'ACEPTADO'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 116, 'el trigger de la cita le dice a otra organización si una versión suya es un borrador',
       current_setting('qa.b116') <> '42501' OR current_setting('qa.b116_estado') <> 'draft',
       'bob citando el borrador de alice con el tenant de alice dio ' || current_setting('qa.b116') ||
       ' (esperado 42501, la policy antes que el trigger); la versión de alice es ' ||
       current_setting('qa.b116_estado') || ' (tiene que ser draft para que esto mida)';

-- ── 117 ──────────────────────────────────────────────────────────────────────
-- QUÉ CUIDA: que el trigger de la cita no dependa de lo que ve quien escribe
-- (decisión 6 de la `0028`: `SECURITY DEFINER`). Medido por la revisión: ningún
-- bloque usaba un rol que pudiera insertar reportes y NO viera
-- `company_profiles`, así que pasar la función a `SECURITY INVOKER` dejaba todo
-- verde — y con eso un rol ciego a la ficha citaba un borrador: su SELECT no
-- encontraba la fila, y «sin fila» es dejar pasar.
--
-- `growthos_app` es ese rol: la policy de `reports` lo alcanza, y las de la
-- ficha son `TO authenticated`. Las dos primeras mediciones son la
-- anti-vacuidad: que de verdad no vea la ficha, y que de verdad pueda escribir
-- reportes. Si cualquiera de las dos fallara, el 45004 no probaría nada.
SELECT set_config('qa.sql117a', format($s$
    INSERT INTO reports (organization_id, business_id, title)
    VALUES (%L, 'd0270000-0027-4027-8027-000000000003', 'Reporte sin cita, como growthos_app')
$s$, (SELECT org_alice FROM t)), true);
SELECT set_config('qa.sql117b', format($s$
    INSERT INTO reports (organization_id, business_id, title, profile_version_id)
    VALUES (%L, 'd0270000-0027-4027-8027-000000000003', 'Reporte contra el borrador, como growthos_app',
            'd0270000-0027-4027-8027-000000000030')
$s$, (SELECT org_alice FROM t)), true);

SELECT pg_temp.be('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE growthos_app;
SELECT set_config('qa.b117_ve',
       pg_temp.escalar($s$SELECT count(*)::text FROM company_profiles$s$), true);
SELECT set_config('qa.b117_sin_cita',
       coalesce(pg_temp.sqlstate_sin_huella(current_setting('qa.sql117a')), 'ACEPTADO'), true);
SELECT set_config('qa.b117_borrador',
       coalesce(pg_temp.sqlstate_sin_huella(current_setting('qa.sql117b')), 'ACEPTADO'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 117, 'el trigger de la cita depende de lo que ve quien escribe: un rol ciego a la ficha cita un borrador',
       NOT (current_setting('qa.b117_ve') = '0'
            AND current_setting('qa.b117_sin_cita') = 'ACEPTADO'
            AND current_setting('qa.b117_borrador') = '45004'),
       'growthos_app ve ' || current_setting('qa.b117_ve') || ' filas de la ficha (esperado 0); ' ||
       'insertar un reporte sin cita dio ' || current_setting('qa.b117_sin_cita') || ' (esperado ACEPTADO); ' ||
       'citar un borrador dio ' || current_setting('qa.b117_borrador') || ' (esperado 45004)';

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 118 a 120. La baja de una organización con su ficha publicada — CERRADO por
-- la decisión 18 de la 0026
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDAN: que dar de baja a un cliente sea posible aunque haya publicado su
-- ficha, sin que deje de valer que una versión no puede quedar firmada por alguien
-- que no es miembro.
--
-- Medido el 2026-09-30 y el 2026-10-01, revisando H1.2: con una versión publicada,
-- `DELETE FROM organizations` moría con 23503 en
-- `company_profiles_published_by_member_fkey` y, con esa FK sacada, en
-- `profile_evidence_verified_by_member_fkey`. Ningún bloque borraba nunca una
-- organización, así que los 94 estaban en verde con la baja imposible. Y
-- `deleteMyAccount` se tragaba el error: la persona veía éxito.
--
-- FIXTURES PROPIAS: olga (dueña, por el alta real de `handle_new_user`), víctor
-- (editor, verifica la evidencia) e inés (lectora, no firma nada), los tres en la
-- MISMA organización. Ningún otro bloque las toca, y los tres bloques deshacen lo
-- que hacen: la organización sigue entera para el siguiente.
--
-- LA FICHA SE PUBLICA DESPUÉS DE CARGAR LAS HIJAS, no al revés: es el orden en que
-- una ficha se publica de verdad, y el único que sigue valiendo con el guard de
-- inmutabilidad de H1.2 (#106), que rechaza hijas nuevas en una versión publicada.
--
-- CORREN COMO `service_role`, que es el rol con el que `deleteMyAccount` borra
-- (`createSupabaseAdminClient`): la vía real (R9). La única excepción es el borrado
-- desde `auth.users` del 119, dicha ahí.
--
-- Y CADA UNO DISPARA LO QUE COMPROBARÍA EL COMMIT, por lo que dice el bloque 92:
-- este archivo termina en ROLLBACK, y sin `SET CONSTRAINTS ALL IMMEDIATE` las
-- comprobaciones diferidas no correrían nunca —el 118 pasaría sin haber mirado y
-- el 119 no vería ninguna negativa—.

INSERT INTO auth.users (id, email) VALUES
    ('d0260000-0026-4026-8026-000000000a01', 'olga@example.test'),
    ('d0260000-0026-4026-8026-000000000a02', 'victor@example.test'),
    ('d0260000-0026-4026-8026-000000000a03', 'ines@example.test');

CREATE TEMP TABLE baja AS
SELECT organization_id AS org
  FROM org_members
 WHERE user_id = 'd0260000-0026-4026-8026-000000000a01' AND role = 'owner';

INSERT INTO org_members (organization_id, user_id, role)
SELECT org, 'd0260000-0026-4026-8026-000000000a02'::uuid, 'editor' FROM baja
UNION ALL
SELECT org, 'd0260000-0026-4026-8026-000000000a03'::uuid, 'viewer' FROM baja;

INSERT INTO businesses (id, organization_id, name)
SELECT 'd0260000-0026-4026-8026-000000000a10', org, 'Baja Olga Co' FROM baja;
INSERT INTO business_services (id, organization_id, business_id, slug, name)
SELECT 'd0260000-0026-4026-8026-000000000a11', org,
       'd0260000-0026-4026-8026-000000000a10', 'olga-servicio', 'Servicio de Olga' FROM baja;

-- La ficha ENTERA: la versión y sus siete hijas, el ICP apuntando a su segmento,
-- la oferta a su servicio, la evidencia `manual` verificada por víctor y una fila
-- de scrape de `competitors` colgada del rival curado. Cada FK del subárbol tiene
-- algo que comprobar cuando la cascada pasa.
INSERT INTO company_profiles (id, organization_id, business_id, version, status)
SELECT 'd0260000-0026-4026-8026-000000000a20', org,
       'd0260000-0026-4026-8026-000000000a10', 1, 'draft' FROM baja;
INSERT INTO profile_offers (organization_id, profile_id, service_id, name)
SELECT org, 'd0260000-0026-4026-8026-000000000a20',
       'd0260000-0026-4026-8026-000000000a11', 'Oferta de Olga' FROM baja;
INSERT INTO profile_markets (organization_id, profile_id, country)
SELECT org, 'd0260000-0026-4026-8026-000000000a20', 'SE' FROM baja;
INSERT INTO profile_segments (id, organization_id, profile_id, name)
SELECT 'd0260000-0026-4026-8026-000000000a21', org,
       'd0260000-0026-4026-8026-000000000a20', 'Segmento de Olga' FROM baja;
INSERT INTO profile_competitors (id, organization_id, profile_id, name)
SELECT 'd0260000-0026-4026-8026-000000000a22', org,
       'd0260000-0026-4026-8026-000000000a20', 'Rival de Olga' FROM baja;
INSERT INTO profile_icp (organization_id, profile_id, definition, primary_segment_id)
SELECT org, 'd0260000-0026-4026-8026-000000000a20', 'ICP de Olga',
       'd0260000-0026-4026-8026-000000000a21' FROM baja;
INSERT INTO profile_objectives (id, organization_id, profile_id, statement, kind)
SELECT 'd0260000-0026-4026-8026-000000000a23', org,
       'd0260000-0026-4026-8026-000000000a20', 'Somos los mas rapidos', 'claim' FROM baja;
INSERT INTO profile_evidence (organization_id, objective_id, kind, url, verified_at, verified_by)
SELECT org, 'd0260000-0026-4026-8026-000000000a23', 'manual', 'https://example.org/olga',
       now(), 'd0260000-0026-4026-8026-000000000a02' FROM baja;
INSERT INTO competitors (organization_id, business_id, name, profile_competitor_id)
SELECT org, 'd0260000-0026-4026-8026-000000000a10', 'Rival scrapeado',
       'd0260000-0026-4026-8026-000000000a22' FROM baja;

UPDATE company_profiles
   SET status = 'published', published_at = now(),
       published_by = 'd0260000-0026-4026-8026-000000000a01'
 WHERE id = 'd0260000-0026-4026-8026-000000000a20';

-- Anti-vacuidad: «no quedó nada» sobre una organización que no tenía nada no
-- mide una baja. Cada tabla que la fixture dice poblar tiene que tener su fila,
-- la versión tiene que estar PUBLICADA por olga y la evidencia VERIFICADA por
-- víctor —sin eso el 119 pediría una negativa a una FK que no tiene qué
-- comprobar—. Y se dispara lo que el COMMIT comprobaría: una fixture que violara
-- una FK diferida corta la corrida acá, y no aparece como un rojo del 118.
--
-- EN UNA SUBTRANSACCIÓN, Y NO CON UN `SET CONSTRAINTS ALL DEFERRED` DESPUÉS. La
-- primera versión de este bloque hacía eso, y una mutación lo midió: `ALL
-- DEFERRED` difiere TODA constraint diferible por el resto de la transacción,
-- incluida una `DEFERRABLE INITIALLY IMMEDIATE`, así que la mutación que le
-- devolvía a la FK su comprobación inmediata —la que traba la baja— sobrevivía
-- con los 97 checks de entonces en verde. Revertir la subtransacción devuelve a
-- cada constraint SU modo, no el que alguien eligió para todas.
DO $$
BEGIN
    BEGIN
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'qa: devolver el modo de las constraints' USING ERRCODE = 'QA000';
    EXCEPTION WHEN SQLSTATE 'QA000' THEN
        NULL;
    END;
END
$$;

DO $$
DECLARE
    o      uuid := (SELECT org FROM baja);
    vacias text;
BEGIN
    SELECT string_agg(tabla, ', ' ORDER BY tabla) INTO vacias
      FROM (VALUES
            ('org_members',         (SELECT count(*) FROM org_members WHERE organization_id = o) = 3),
            ('businesses',          (SELECT count(*) FROM businesses WHERE organization_id = o) = 1),
            ('business_services',   (SELECT count(*) FROM business_services WHERE organization_id = o) = 1),
            ('competitors',         (SELECT count(*) FROM competitors WHERE organization_id = o
                                                                       AND profile_competitor_id IS NOT NULL) = 1),
            ('company_profiles',    (SELECT count(*) FROM company_profiles WHERE organization_id = o
                                                                            AND status = 'published'
                                                                            AND published_by = 'd0260000-0026-4026-8026-000000000a01') = 1),
            ('profile_offers',      (SELECT count(*) FROM profile_offers WHERE organization_id = o) = 1),
            ('profile_markets',     (SELECT count(*) FROM profile_markets WHERE organization_id = o) = 1),
            ('profile_segments',    (SELECT count(*) FROM profile_segments WHERE organization_id = o) = 1),
            ('profile_competitors', (SELECT count(*) FROM profile_competitors WHERE organization_id = o) = 1),
            ('profile_icp',         (SELECT count(*) FROM profile_icp WHERE organization_id = o
                                                                       AND primary_segment_id IS NOT NULL) = 1),
            ('profile_objectives',  (SELECT count(*) FROM profile_objectives WHERE organization_id = o) = 1),
            ('profile_evidence',    (SELECT count(*) FROM profile_evidence WHERE organization_id = o
                                                                            AND verified_by = 'd0260000-0026-4026-8026-000000000a02') = 1)
           ) AS f(tabla, ok)
     WHERE NOT ok;
    IF vacias IS NOT NULL THEN
        RAISE EXCEPTION 'Vacuous run: la fixture de los bloques 118 a 120 no pobló: %', vacias;
    END IF;
END
$$;

-- Corre una sentencia con un rol, dispara lo que el COMMIT comprobaría, y la
-- DESHACE, para que el bloque siguiente encuentre la organización entera.
-- Devuelve `SQLSTATE | mensaje` si murió. Si pasó, devuelve 'paso' y, con
-- `p_org`, cuántas tablas miró y cuáles de esas todavía tienen filas de la
-- organización.
--
-- EL DENOMINADOR DE «NO QUEDÓ NADA» SALE DEL CATÁLOGO, no de una lista: toda
-- tabla de `public` con `organization_id`, más la organización misma. Una tabla
-- que la baja dejara colgada aparece acá aunque nadie la haya nombrado (R14). Y
-- se cuenta como `postgres` —después del `RESET ROLE`— porque la pregunta es qué
-- quedó en la base, no qué alcanza a ver el rol que borró.
--
-- Cómo deshace: como `sqlstate_sin_huella()`, con una excepción propia que sólo
-- atrapa el handler de adentro. El rol, el modo de las constraints y las filas
-- vuelven con la subtransacción.
CREATE OR REPLACE FUNCTION pg_temp.al_commit(p_sql text, p_rol text, p_org uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    r       record;
    n       bigint;
    miradas int  := 0;
    restos  text := '';
    salida  text;
BEGIN
    BEGIN
        EXECUTE format('SET LOCAL ROLE %I', p_rol);
        EXECUTE p_sql;
        SET CONSTRAINTS ALL IMMEDIATE;
        RESET ROLE;

        IF p_org IS NULL THEN
            salida := 'paso';
        ELSE
            FOR r IN
                SELECT c.relname
                  FROM pg_class c
                  JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = 'public'
                  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id'
                                     AND NOT a.attisdropped
                 WHERE c.relkind IN ('r', 'p')
                 ORDER BY c.relname
            LOOP
                EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = $1', r.relname)
                   INTO n USING p_org;
                miradas := miradas + 1;
                IF n > 0 THEN restos := restos || r.relname || '=' || n || ' '; END IF;
            END LOOP;
            SELECT count(*) INTO n FROM public.organizations WHERE id = p_org;
            IF n > 0 THEN restos := restos || 'organizations=' || n || ' '; END IF;
            salida := format('paso; %s tablas; quedaron: [%s]', miradas, trim(restos));
        END IF;

        RAISE EXCEPTION 'qa: deshacer la baja' USING ERRCODE = 'QA000';
    EXCEPTION WHEN SQLSTATE 'QA000' THEN
        RETURN salida;
    END;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' | ' || SQLERRM;
END
$$;

-- ── 118 ──────────────────────────────────────────────────────────────────────
-- La baja de la organización entera. Lo que la persona pide con «borrar mi
-- cuenta» es exactamente esto: el primer paso de `deleteMyAccount`.
--
-- Exige DOS cosas y las dos hacen falta: que pase —el defecto medido— y que no
-- quede ni una fila de la organización en ninguna tabla con `organization_id`. Un
-- arreglo que sacara la FK de la ficha de la cascada, o que dejara la ficha
-- huérfana para que el borrado pase, estaría en verde en la primera mitad.
--
-- Y el número de tablas miradas tiene piso: con cero —un catálogo que no
-- encontró nada— «no quedó nada» es cero sobre cero. Doce son las que la fixture
-- puebla; el catálogo tiene más, y alcanza con que no tenga menos.
SELECT set_config('qa.b118', pg_temp.al_commit(
           format('DELETE FROM organizations WHERE id = %L', (SELECT org FROM baja)),
           'service_role', (SELECT org FROM baja)), true);

INSERT INTO defect_report
SELECT 118, 'una organización con la ficha publicada no se puede dar de baja, o la baja deja filas',
       NOT (resultado ~ '^paso; [0-9]+ tablas; quedaron: \[\]$'
            AND substring(resultado FROM '^paso; ([0-9]+) tablas')::int >= 12),
       CASE WHEN resultado ~ '^paso; [0-9]+ tablas; quedaron: \[\]$'
                 AND substring(resultado FROM '^paso; ([0-9]+) tablas')::int >= 12
            THEN 'la baja pasó al COMMIT como service_role: organización, tres membresías, negocio, ' ||
                 'ficha publicada y sus siete hijas; ' || resultado
            ELSE 'la baja devolvió: ' || resultado END
  FROM (SELECT current_setting('qa.b118') AS resultado) x;

-- ── 119 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL DE QUE LA DECISIÓN 4 SIGUE VALIENDO PARA UNA PERSONA. Sin este
-- bloque, sacar las dos FK pondría el 118 en verde: la baja pasaría, y una versión
-- quedaría firmada por alguien que ya no es miembro.
--
-- Tres bajas sueltas, con la organización y la versión en pie, y las tres tienen
-- que morir con 23503 NOMBRANDO SU FK —un 23503 de otra FK, o un 23514 de un
-- `SET NULL` que choca con el CHECK, no es la negativa que se mide—:
--
--   a. la membresía de olga, que publicó (el paso 2 de `deleteMyAccount`);
--   b. la de víctor, que verificó la evidencia;
--   c. olga desde `auth.users`, que cae por cascada en su membresía. Éste corre
--      como `postgres` y no como `service_role`: en hosted lo borra GoTrue con
--      `supabase_auth_admin`, que en esta réplica `postgres` no puede asumir, y
--      `service_role` no tiene DELETE sobre `auth.users`. Lo que se mide es la
--      cascada a la membresía, que es la misma la dispare quien la dispare.
SELECT set_config('qa.b119a', pg_temp.al_commit(format(
           'DELETE FROM org_members WHERE organization_id = %L AND user_id = %L',
           (SELECT org FROM baja), 'd0260000-0026-4026-8026-000000000a01'), 'service_role'), true);
SELECT set_config('qa.b119b', pg_temp.al_commit(format(
           'DELETE FROM org_members WHERE organization_id = %L AND user_id = %L',
           (SELECT org FROM baja), 'd0260000-0026-4026-8026-000000000a02'), 'service_role'), true);
SELECT set_config('qa.b119c', pg_temp.al_commit(
           'DELETE FROM auth.users WHERE id = ''d0260000-0026-4026-8026-000000000a01''',
           'postgres'), true);

INSERT INTO defect_report
SELECT 119, 'se puede borrar a UN miembro que publicó o verificó mientras su versión sigue en pie',
       NOT (a LIKE '23503 |%"company_profiles_published_by_member_fkey"%'
            AND b LIKE '23503 |%"profile_evidence_verified_by_member_fkey"%'
            AND c LIKE '23503 |%"company_profiles_published_by_member_fkey"%'),
       CASE WHEN a LIKE '23503 |%"company_profiles_published_by_member_fkey"%'
                 AND b LIKE '23503 |%"profile_evidence_verified_by_member_fkey"%'
                 AND c LIKE '23503 |%"company_profiles_published_by_member_fkey"%'
            THEN 'las tres bajas sueltas mueren al COMMIT con 23503 nombrando su FK: ' ||
                 'olga (published_by), víctor (verified_by) y olga desde auth.users'
            ELSE 'olga: ' || a || ' / víctor: ' || b || ' / olga desde auth.users: ' || c END
  FROM (SELECT current_setting('qa.b119a') AS a, current_setting('qa.b119b') AS b,
               current_setting('qa.b119c') AS c) x;

-- ── 120 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DEL 119: inés no publicó ni verificó nada, y su baja PASA.
-- Sin este bloque, un esquema que rechazara toda baja de miembro —un trigger que
-- la prohíba, una FK nueva que la trabe— pondría el 119 en verde por el motivo
-- equivocado.
SELECT set_config('qa.b120', pg_temp.al_commit(format(
           'DELETE FROM org_members WHERE organization_id = %L AND user_id = %L',
           (SELECT org FROM baja), 'd0260000-0026-4026-8026-000000000a03'), 'service_role'), true);

INSERT INTO defect_report
SELECT 120, 'el esquema también rechaza la baja de un miembro que no firmó nada',
       current_setting('qa.b120') <> 'paso',
       CASE WHEN current_setting('qa.b120') = 'paso'
            THEN 'la baja de inés pasó al COMMIT: el 119 rechaza a quien firmó, no a cualquiera'
            ELSE 'la baja de inés murió: ' || current_setting('qa.b120') END;

-- ─────────────────────────────────────────────────────────────────────────────
-- 121 a 135. El tablero transversal — la puerta de H3.1, CERRADO por la 0029
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDAN: que una tarjeta no pueda nombrar como responsable, creador,
-- aprobador o colaborador a alguien que no es miembro de SU organización, que
-- ninguna organización lea el tablero de otra, y que ninguna columna del tablero
-- guarde un identificador de persona sin la FK compuesta que lo ata al tenant.
--
-- Los cuatro puntos de la puerta, y su bloque:
--
--   (1) 121 — la tarjeta con una persona que NO es miembro, en las cuatro columnas
--       de persona, muere con 23503 NOMBRANDO la FK compuesta;
--   (2) 122 — la MISMA sentencia, con esa persona ya miembro, pasa al COMMIT;
--   (3) 126 — bajo el `auth.uid()` de una persona de OTRA organización, como
--       `authenticated`, cada relación del tablero y de su alcance —tablas,
--       vistas y vistas materializadas— no le devuelve ninguna fila que no sea
--       de su organización; el 127 es su contraprueba;
--   (4) 128 — por catálogo: toda columna uuid, en el tablero y en lo que el
--       tablero alcanza, viene del padrón (`org_members (organization_id,
--       user_id)`) o de una fila que la base acuñó con un generador, por una FK
--       validada que empareja el tenant; ninguna es un contenedor; todo texto es
--       un conjunto cerrado o está declarado como texto libre; con su
--       denominador.
--
-- LAS RELACIONES DEL TABLERO SE DESCUBREN, NO SE ENUMERAN. `pg_temp.tablero()`
-- toma las de `public` con prefijo `board_` —tablas, particionadas, vistas,
-- vistas materializadas y foráneas— y les suma, por cierre transitivo, todo lo
-- que alcanza sus filas por otro camino:
--
--   * toda tabla que las referencie por FK;
--   * sus hijas por herencia o partición (`pg_inherits`), y sus padres: las filas
--     de una hija se leen desde el padre, y una hija por `INHERITS` NO hereda las
--     FK —PostgreSQL no las copia—, así que es exactamente el lugar donde una
--     tarjeta con un responsable ajeno entraría sin que ninguna FK la mire;
--   * toda vista o vista materializada que lea de ellas (`pg_depend` sobre su
--     regla `_RETURN`): una vista de `postgres` sin `security_invoker` lee con
--     BYPASSRLS, y una materializada no tiene RLS posible;
--   * el DESTINO de toda regla que no es de SELECT puesta sobre ellas —`CREATE
--     RULE ... DO ALSO INSERT INTO otra`—: la regla corre con los permisos del
--     dueño y copia cada fila. Ahí la arista va AL REVÉS que la de las vistas:
--     en una vista lo nuevo es la regla (`ev_class`) y lo viejo lo que lee; en
--     una regla sobre el tablero lo viejo es `ev_class` y lo nuevo, adonde
--     escribe. La primera versión las recorría a las dos como vistas, y un
--     verificador copió las tarjetas de T a una tabla sin RLS con los 135 en
--     verde.
--
-- Y LO QUE EL TABLERO ALCANZA HACIA ARRIBA, `pg_temp.alcance()`: lo que una
-- relación del tablero referencia por FK, lo que una vista del tablero LEE
-- —sus tablas de abajo— y el padre por herencia de cualquiera de ellos, por
-- cierre transitivo, deteniéndose en las dos ANCLAS que la puerta nombra
-- (`organizations`, el tenant, y `org_members`, el padrón). No son filas del
-- tablero, pero son filas que el tablero expone o nombra a un salto: un padre
-- por FK que guarda el cuerpo de la tarjeta, o la tabla que una vista del
-- tablero junta con las tarjetas, son contenido del tablero con otro nombre.
-- Dos verificadores lo midieron: un padre sin RLS y una vista con
-- `security_invoker` sobre una tabla sin RLS le daban a pau las tarjetas de T
-- con los 135 en verde, porque `tablero()` sólo baja. Hoy el alcance es uno:
-- `businesses`, por `cited_business_id`.
--
-- Una relación nueva del tablero entra sola en el 126, el 127, el 128, el 129 y
-- el 130, aunque se llame de otra forma, porque la descubre su FK, su herencia,
-- su dependencia o su regla y no su nombre (R14); una del alcance entra en el
-- 126, el 127, el 128 y el 129. La anti-vacuidad del 126 obliga a poblarlas en
-- la fixture: sin una fila de T, el 126 se pone ROJO en el informe —no corta la
-- corrida, para que la misma mutación muestre también qué dicen el 128 y el
-- 129—.
--
-- QUÉ NO VE, y queda dicho: lo que llega al tablero por el CUERPO de una
-- función plpgsql. Ese cuerpo es texto que el servidor no analiza al crearla, y
-- no deja dependencias en el catálogo: ni una RPC `SECURITY DEFINER` con
-- `RETURNS TABLE (...)` que devuelva filas del tablero, ni una función de
-- trigger que las copie a otra tabla. Las dos dan los 135 en verde, medido. Las
-- formas que SÍ dejan dependencia —`RETURNS SETOF board_cards`, que depende del
-- tipo fila, y un cuerpo SQL estándar (`BEGIN ATOMIC`), que depende de la
-- tabla— las ve el 130. Una RPC es otra puerta; un trigger sobre el tablero, la
-- migración que lo traiga.
--
-- LOS BLOQUES DE ESTRUCTURA CORREN COMO `postgres`, por el motivo del encabezado
-- del 77: tiene BYPASSRLS, así que ninguna policy puede ser lo que rechaza. Y el
-- rechazo se exige NOMBRANDO la constraint, no sólo el 23503: dos FK distintas
-- de la misma fila dan el mismo SQLSTATE, y la puerta dice «por la clave foránea
-- compuesta», no «por alguna».
--
-- FIXTURES PROPIAS: tere (dueña de su organización, la «T», por el alta real de
-- `handle_new_user`), teo (editor de T; también tiene su organización propia,
-- porque el alta se la da) y pau (dueño de la «P», NO miembro de T). Ningún
-- bloque anterior las toca. Los nombres de las filas llevan «QA», como pide la
-- regla de datos de prueba.

RESET ROLE;

INSERT INTO auth.users (id, email) VALUES
    ('d0290000-0029-4029-8029-000000000a01', 'tere@example.test'),
    ('d0290000-0029-4029-8029-000000000a02', 'teo@example.test'),
    ('d0290000-0029-4029-8029-000000000a03', 'pau@example.test');

CREATE TEMP TABLE h31 AS
SELECT (SELECT organization_id FROM org_members
         WHERE user_id = 'd0290000-0029-4029-8029-000000000a01' AND role = 'owner') AS org_t,
       (SELECT organization_id FROM org_members
         WHERE user_id = 'd0290000-0029-4029-8029-000000000a03' AND role = 'owner') AS org_p;

INSERT INTO org_members (organization_id, user_id, role)
SELECT org_t, 'd0290000-0029-4029-8029-000000000a02'::uuid, 'editor' FROM h31;

INSERT INTO businesses (id, organization_id, name)
SELECT 'd0290000-0029-4029-8029-000000000b01', org_t, 'QA Tablero T' FROM h31;
INSERT INTO businesses (id, organization_id, name)
SELECT 'd0290000-0029-4029-8029-000000000b02', org_p, 'QA Tablero P' FROM h31;

-- T1: las cuatro personas puestas —tere responsable, creadora y aprobadora; teo
-- colaborador— y el negocio citado. T2: teo responsable y creador, y depende de
-- T1. T3: sin personas, destino de los controles positivos. P1 y P2: el tablero
-- de pau, que es lo que hace «cruzado» construible en el 123.
INSERT INTO board_cards (id, organization_id, product, objective, cited_business_id,
                         status, priority, estimate_minutes, actual_minutes,
                         assignee_id, created_by, approved_by, approved_at, result)
SELECT 'd0290000-0029-4029-8029-000000000c01', org_t, 'growth_os', 'QA auditar la ficha de T',
       'd0290000-0029-4029-8029-000000000b01', 'done', 'high', 120, 95,
       'd0290000-0029-4029-8029-000000000a01', 'd0290000-0029-4029-8029-000000000a01',
       'd0290000-0029-4029-8029-000000000a01', now(), 'QA hecho'
  FROM h31;
INSERT INTO board_cards (id, organization_id, product, objective, assignee_id, created_by)
SELECT 'd0290000-0029-4029-8029-000000000c02', org_t, 'lead_engine', 'QA calificar leads de T',
       'd0290000-0029-4029-8029-000000000a02', 'd0290000-0029-4029-8029-000000000a02'
  FROM h31;
INSERT INTO board_cards (id, organization_id, product, objective)
SELECT 'd0290000-0029-4029-8029-000000000c03', org_t, 'vulkan_os', 'QA tarjeta sin personas' FROM h31;
INSERT INTO board_cards (id, organization_id, product, objective, assignee_id)
SELECT 'd0290000-0029-4029-8029-000000000c11', org_p, 'growth_os', 'QA tablero de P',
       'd0290000-0029-4029-8029-000000000a03' FROM h31;
INSERT INTO board_cards (id, organization_id, product, objective)
SELECT 'd0290000-0029-4029-8029-000000000c12', org_p, 'growth_os', 'QA otra de P' FROM h31;

INSERT INTO board_card_collaborators (organization_id, card_id, user_id)
SELECT org_t, 'd0290000-0029-4029-8029-000000000c01', 'd0290000-0029-4029-8029-000000000a02' FROM h31;
INSERT INTO board_card_dependencies (organization_id, card_id, depends_on_card_id)
SELECT org_t, 'd0290000-0029-4029-8029-000000000c02', 'd0290000-0029-4029-8029-000000000c01' FROM h31;
INSERT INTO board_card_sources (organization_id, card_id, url, title)
SELECT org_t, 'd0290000-0029-4029-8029-000000000c01', 'https://example.org/qa-tablero', 'QA fuente' FROM h31;

-- Las relaciones del tablero, por catálogo: prefijo `board_` en `public` y el
-- cierre transitivo de todo lo que alcanza sus filas. Ver el encabezado de esta
-- tanda. Una sola referencia recursiva —PostgreSQL no admite más—, así que los
-- cuatro caminos van como aristas `(nueva, vieja)`: «si `vieja` es del tablero,
-- `nueva` también».
CREATE OR REPLACE FUNCTION pg_temp.tablero()
RETURNS TABLE (oid oid, relname name, relkind "char")
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE arista(nueva, vieja) AS (
        -- quien la referencia por FK
        SELECT co.conrelid, co.confrelid FROM pg_constraint co WHERE co.contype = 'f'
        UNION ALL
        -- sus hijas por herencia o partición, y sus padres
        SELECT i.inhrelid, i.inhparent FROM pg_inherits i
        UNION ALL
        SELECT i.inhparent, i.inhrelid FROM pg_inherits i
        UNION ALL
        -- toda vista o vista materializada que la lee: su regla `_RETURN`, la
        -- única de SELECT (`ev_type` 1)
        SELECT rw.ev_class, d.refobjid
          FROM pg_depend d
          JOIN pg_rewrite rw ON rw.oid = d.objid
         WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
           AND rw.ev_type = '1'
        UNION ALL
        -- adonde escribe una regla que no es de SELECT puesta sobre ella: AL
        -- REVÉS que la de arriba. Sin las anclas: una regla que mire
        -- `organizations` no hace del tenant una tabla del tablero.
        SELECT d.refobjid, rw.ev_class
          FROM pg_depend d
          JOIN pg_rewrite rw ON rw.oid = d.objid
         WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
           AND rw.ev_type <> '1' AND d.refobjid <> rw.ev_class
           AND d.refobjid NOT IN ('public.organizations'::regclass, 'public.org_members'::regclass)
    ),
    t(oid) AS (
        SELECT c.oid
          FROM pg_class c
         WHERE c.relnamespace = 'public'::regnamespace
           AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND c.relname LIKE 'board\_%'
        UNION
        SELECT a.nueva FROM arista a JOIN t ON a.vieja = t.oid
    )
    SELECT c.oid, c.relname, c.relkind FROM t JOIN pg_class c ON c.oid = t.oid ORDER BY c.relname
$$;

-- Lo que el tablero ALCANZA hacia arriba, fuera del tablero y de las anclas. Ver
-- el encabezado de esta tanda. Las aristas van `(nueva, vieja)` igual que en
-- `tablero()`, pero subiendo: lo que `vieja` referencia por FK, lo que `vieja`
-- lee si es una vista, y el padre por herencia de `vieja`, que lee sus filas. Se
-- siembra con el tablero entero y se sube sin pasar por las anclas: el padrón y
-- el tenant son el final del camino, no un tramo.
CREATE OR REPLACE FUNCTION pg_temp.alcance()
RETURNS TABLE (oid oid, relname name, relkind "char")
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE arista(nueva, vieja) AS (
        SELECT co.confrelid, co.conrelid FROM pg_constraint co WHERE co.contype = 'f'
        UNION ALL
        SELECT d.refobjid, rw.ev_class
          FROM pg_depend d
          JOIN pg_rewrite rw ON rw.oid = d.objid
         WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
           AND rw.ev_type = '1' AND d.refobjid <> rw.ev_class
        UNION ALL
        SELECT i.inhparent, i.inhrelid FROM pg_inherits i
    ),
    s(oid) AS (
        SELECT tb.oid FROM pg_temp.tablero() tb
        UNION
        SELECT a.nueva
          FROM arista a
          JOIN s ON a.vieja = s.oid
         WHERE s.oid NOT IN ('public.organizations'::regclass, 'public.org_members'::regclass)
    )
    SELECT c.oid, c.relname, c.relkind
      FROM s
      JOIN pg_class c ON c.oid = s.oid
     WHERE s.oid NOT IN ('public.organizations'::regclass, 'public.org_members'::regclass)
       AND s.oid NOT IN (SELECT tb.oid FROM pg_temp.tablero() tb)
     ORDER BY c.relname
$$;

-- Las dos juntas, con de dónde viene cada una: lo que leen el 126 y el 127, y lo
-- que mira el 129.
CREATE OR REPLACE FUNCTION pg_temp.tablero_y_alcance()
RETURNS TABLE (oid oid, relname name, relkind "char", de text)
LANGUAGE sql STABLE AS $$
    SELECT tb.oid, tb.relname, tb.relkind, 'tablero' FROM pg_temp.tablero() tb
    UNION ALL
    SELECT al.oid, al.relname, al.relkind, 'alcance' FROM pg_temp.alcance() al
$$;

-- Corre una sentencia con un rol, dispara lo que el COMMIT comprobaría, mira el
-- resultado con `p_mira` como `postgres`, y DESHACE todo. Es `al_commit()` del
-- bloque 118 con una mirada después: el 133 tiene que decir no sólo que la baja
-- pasó sino qué quedó de la tarjeta. Devuelve `paso; <lo que miró>`, o
-- `SQLSTATE | mensaje` si murió.
CREATE OR REPLACE FUNCTION pg_temp.al_commit_y_mira(p_sql text, p_rol text, p_mira text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    visto  text;
    salida text;
BEGIN
    BEGIN
        EXECUTE format('SET LOCAL ROLE %I', p_rol);
        EXECUTE p_sql;
        SET CONSTRAINTS ALL IMMEDIATE;
        RESET ROLE;
        EXECUTE p_mira INTO visto;
        salida := 'paso; ' || coalesce(visto, '');
        RAISE EXCEPTION 'qa: deshacer la baja' USING ERRCODE = 'QA000';
    EXCEPTION WHEN SQLSTATE 'QA000' THEN
        RETURN salida;
    END;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' | ' || SQLERRM;
END
$$;

-- Precondiciones de la fixture, como `postgres`. Si alguna falla, la corrida se
-- corta acá y no aparece como un rojo de la puerta:
--   * pau EXISTE en `auth.users` —sin eso, una FK simple contra `auth.users`
--     también lo rechazaría y el 121 no distinguiría la FK compuesta de la
--     simple, que es justo la mutación que la puerta nombra—;
--   * pau NO es miembro de T, y teo sí;
--   * T1 tiene las cuatro personas puestas y T2 a teo de responsable y creador:
--     sin eso, el 131 al 133 piden a FK que no tienen nada que comprobar;
--   * se dispara lo que el COMMIT comprobaría, en una subtransacción, como el
--     bloque 118: una fixture que violara una FK diferida se corta acá.
DO $$
BEGIN
    BEGIN
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'qa: devolver el modo de las constraints' USING ERRCODE = 'QA000';
    EXCEPTION WHEN SQLSTATE 'QA000' THEN
        NULL;
    END;
END
$$;

DO $$
DECLARE
    t     uuid := (SELECT org_t FROM h31);
    fallas text;
BEGIN
    SELECT string_agg(que, '; ') INTO fallas FROM (VALUES
        ('pau no existe en auth.users',
         NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0290000-0029-4029-8029-000000000a03')),
        ('pau ya es miembro de T',
         EXISTS (SELECT 1 FROM org_members WHERE organization_id = t
                    AND user_id = 'd0290000-0029-4029-8029-000000000a03')),
        -- el 126 cuenta lo que pau ve y no es de P: eso es una fuga sólo si P es
        -- su única organización
        ('pau es miembro de alguna organización además de P',
         EXISTS (SELECT 1 FROM org_members WHERE user_id = 'd0290000-0029-4029-8029-000000000a03'
                    AND organization_id <> (SELECT org_p FROM h31))),
        ('teo no es miembro de T',
         NOT EXISTS (SELECT 1 FROM org_members WHERE organization_id = t
                        AND user_id = 'd0290000-0029-4029-8029-000000000a02')),
        ('T y P son la misma organización', t = (SELECT org_p FROM h31)),
        ('T1 no tiene las tres personas de la tarjeta',
         NOT EXISTS (SELECT 1 FROM board_cards WHERE id = 'd0290000-0029-4029-8029-000000000c01'
                        AND assignee_id = 'd0290000-0029-4029-8029-000000000a01'
                        AND created_by  = 'd0290000-0029-4029-8029-000000000a01'
                        AND approved_by = 'd0290000-0029-4029-8029-000000000a01')),
        ('T2 no tiene a teo de responsable y creador',
         NOT EXISTS (SELECT 1 FROM board_cards WHERE id = 'd0290000-0029-4029-8029-000000000c02'
                        AND assignee_id = 'd0290000-0029-4029-8029-000000000a02'
                        AND created_by  = 'd0290000-0029-4029-8029-000000000a02')),
        ('teo no colabora en T1',
         NOT EXISTS (SELECT 1 FROM board_card_collaborators
                      WHERE organization_id = t AND card_id = 'd0290000-0029-4029-8029-000000000c01'
                        AND user_id = 'd0290000-0029-4029-8029-000000000a02'))
    ) AS f(que, falla)
    WHERE falla;

    IF fallas IS NOT NULL THEN
        RAISE EXCEPTION 'Vacuous run: la fixture de los bloques 121 a 133 no es la que dicen: %', fallas;
    END IF;
END
$$;

-- ── 121 y 122 ────────────────────────────────────────────────────────────────
-- LA PUERTA DE H3.1, PUNTOS (1) Y (2), EN LAS CUATRO COLUMNAS DE PERSONA.
--
-- Cada caso es UNA sentencia. El 121 la corre tal cual, con pau, que no es
-- miembro de T. El 122 corre EL MISMO TEXTO concatenado detrás del alta de pau
-- como miembro de T: no una sentencia «parecida», la misma cadena, así que lo
-- único que cambió entre las dos corridas es la membresía.
--
-- Las dos se corren con `al_commit()` —la del bloque 118— como `postgres`:
-- dispara lo que el COMMIT comprobaría y deshace, para que el caso siguiente
-- encuentre la fixture como estaba. Hoy ninguna FK del tablero es diferible
-- (decisión 4 de la `0029`), y el disparo es lo que hace que este bloque siga
-- midiendo lo mismo el día que una lo sea: sin él, ese INSERT «pasaría» la
-- sentencia y el 121 se pondría verde por no haber mirado.
CREATE TEMP TABLE h31_personas (
    n         int  PRIMARY KEY,
    columna   text NOT NULL,
    fkey      text NOT NULL,
    sentencia text NOT NULL
) ON COMMIT DROP;

INSERT INTO h31_personas
SELECT 1, 'board_cards.assignee_id', 'board_cards_assignee_member_fkey',
       format($sql$INSERT INTO board_cards (id, organization_id, product, objective, assignee_id)
                   VALUES ('d0290000-0029-4029-8029-000000000d01', %L, 'growth_os',
                           'QA responsable ajeno', 'd0290000-0029-4029-8029-000000000a03')$sql$, org_t)
  FROM h31
UNION ALL
SELECT 2, 'board_cards.created_by', 'board_cards_creator_member_fkey',
       format($sql$INSERT INTO board_cards (id, organization_id, product, objective, created_by)
                   VALUES ('d0290000-0029-4029-8029-000000000d02', %L, 'growth_os',
                           'QA creador ajeno', 'd0290000-0029-4029-8029-000000000a03')$sql$, org_t)
  FROM h31
UNION ALL
SELECT 3, 'board_cards.approved_by', 'board_cards_approver_member_fkey',
       format($sql$INSERT INTO board_cards (id, organization_id, product, objective, approved_by, approved_at)
                   VALUES ('d0290000-0029-4029-8029-000000000d03', %L, 'growth_os',
                           'QA aprobador ajeno', 'd0290000-0029-4029-8029-000000000a03', now())$sql$, org_t)
  FROM h31
UNION ALL
SELECT 4, 'board_card_collaborators.user_id', 'board_card_collaborators_member_fkey',
       format($sql$INSERT INTO board_card_collaborators (organization_id, card_id, user_id)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c01',
                           'd0290000-0029-4029-8029-000000000a03')$sql$, org_t)
  FROM h31;

CREATE TEMP TABLE h31_personas_res ON COMMIT DROP AS
SELECT p.n, p.columna, p.fkey,
       pg_temp.al_commit(p.sentencia, 'postgres') AS ajeno,
       pg_temp.al_commit(format(
           $sql$INSERT INTO org_members (organization_id, user_id, role)
                VALUES (%L, 'd0290000-0029-4029-8029-000000000a03', 'editor'); $sql$,
           (SELECT org_t FROM h31)) || p.sentencia, 'postgres') AS miembro
  FROM h31_personas p;

-- Anti-vacuidad: cuatro casos, y son las cuatro columnas declaradas.
DO $$
DECLARE
    faltan text;
BEGIN
    SELECT string_agg(d, ', ') INTO faltan
      FROM unnest(ARRAY['board_cards.assignee_id', 'board_cards.created_by',
                        'board_cards.approved_by', 'board_card_collaborators.user_id']) d
     WHERE d NOT IN (SELECT columna FROM h31_personas_res);
    IF (SELECT count(*) FROM h31_personas_res) <> 4 OR faltan IS NOT NULL THEN
        RAISE EXCEPTION 'Vacuous run: los bloques 121 y 122 midieron % casos; faltan: %',
            (SELECT count(*) FROM h31_personas_res), coalesce(faltan, '-');
    END IF;
END
$$;

INSERT INTO defect_report
SELECT 121, 'una tarjeta nombra a una persona que no es miembro de su organización',
       count(*) FILTER (WHERE ajeno NOT LIKE '23503 |%"' || fkey || '"%') > 0,
       CASE WHEN count(*) FILTER (WHERE ajeno NOT LIKE '23503 |%"' || fkey || '"%') = 0
            THEN 'las ' || count(*) || ' columnas de persona rechazan a pau, que no es miembro, ' ||
                 'con 23503 nombrando su FK compuesta: ' || string_agg(fkey, ', ' ORDER BY n)
            ELSE 'no rechazan por su FK compuesta: ' ||
                 string_agg(columna || ' = ' || ajeno, ' / ' ORDER BY n)
                     FILTER (WHERE ajeno NOT LIKE '23503 |%"' || fkey || '"%')
            END
  FROM h31_personas_res;

-- ── 122 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO, Y LA MITAD (2) DE LA PUERTA. Sin él, un esquema que
-- rechazara toda tarjeta con persona —una FK contra una tabla vacía, un CHECK
-- imposible— pondría el 121 en verde.
INSERT INTO defect_report
SELECT 122, 'la misma tarjeta, con la persona ya miembro, también se rechaza',
       count(*) FILTER (WHERE miembro <> 'paso') > 0,
       CASE WHEN count(*) FILTER (WHERE miembro <> 'paso') = 0
            THEN 'las mismas ' || count(*) || ' sentencias pasan al COMMIT con pau dado de alta en T'
            ELSE 'rechazadas aun con la membresía: ' ||
                 string_agg(columna || ' = ' || miembro, ' / ' ORDER BY n) FILTER (WHERE miembro <> 'paso')
            END
  FROM h31_personas_res;

-- ── 123 y 124 ────────────────────────────────────────────────────────────────
-- LAS RELACIONES QUE NO SON PERSONAS, CRUZADAS DE ORGANIZACIÓN. El tenant en
-- cada punta: la tarjeta de una arista, de una fuente o de una colaboración
-- tiene que ser de la organización de la fila, y el negocio citado también.
--
-- Cada caso con su control positivo: la misma forma, el dato de la propia
-- organización. Las dos puntas de la dependencia van por separado, porque son
-- dos FK y cualquiera de las dos podía volverse simple sola.
CREATE TEMP TABLE h31_cruces (
    n        int  PRIMARY KEY,
    relacion text NOT NULL,
    fkey     text NOT NULL,
    cruzado  text NOT NULL,
    legitimo text NOT NULL
) ON COMMIT DROP;

INSERT INTO h31_cruces
SELECT 1, 'board_cards -> businesses', 'board_cards_business_fkey',
       format($sql$INSERT INTO board_cards (id, organization_id, product, objective, cited_business_id)
                   VALUES ('d0290000-0029-4029-8029-000000000e01', %L, 'growth_os', 'QA cita ajena',
                           'd0290000-0029-4029-8029-000000000b02')$sql$, org_t),
       format($sql$INSERT INTO board_cards (id, organization_id, product, objective, cited_business_id)
                   VALUES ('d0290000-0029-4029-8029-000000000e01', %L, 'growth_os', 'QA cita propia',
                           'd0290000-0029-4029-8029-000000000b01')$sql$, org_t)
  FROM h31
UNION ALL
SELECT 2, 'board_card_collaborators -> board_cards', 'board_card_collaborators_card_fkey',
       format($sql$INSERT INTO board_card_collaborators (organization_id, card_id, user_id)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c01',
                           'd0290000-0029-4029-8029-000000000a03')$sql$, org_p),
       format($sql$INSERT INTO board_card_collaborators (organization_id, card_id, user_id)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c11',
                           'd0290000-0029-4029-8029-000000000a03')$sql$, org_p)
  FROM h31
UNION ALL
SELECT 3, 'board_card_dependencies.card_id -> board_cards', 'board_card_dependencies_card_fkey',
       format($sql$INSERT INTO board_card_dependencies (organization_id, card_id, depends_on_card_id)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c01',
                           'd0290000-0029-4029-8029-000000000c11')$sql$, org_p),
       format($sql$INSERT INTO board_card_dependencies (organization_id, card_id, depends_on_card_id)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c12',
                           'd0290000-0029-4029-8029-000000000c11')$sql$, org_p)
  FROM h31
UNION ALL
SELECT 4, 'board_card_dependencies.depends_on_card_id -> board_cards', 'board_card_dependencies_depends_on_fkey',
       format($sql$INSERT INTO board_card_dependencies (organization_id, card_id, depends_on_card_id)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c03',
                           'd0290000-0029-4029-8029-000000000c11')$sql$, org_t),
       format($sql$INSERT INTO board_card_dependencies (organization_id, card_id, depends_on_card_id)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c03',
                           'd0290000-0029-4029-8029-000000000c01')$sql$, org_t)
  FROM h31
UNION ALL
SELECT 5, 'board_card_sources -> board_cards', 'board_card_sources_card_fkey',
       format($sql$INSERT INTO board_card_sources (organization_id, card_id, url)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c01', 'https://example.org/qa-cruzada')$sql$, org_p),
       format($sql$INSERT INTO board_card_sources (organization_id, card_id, url)
                   VALUES (%L, 'd0290000-0029-4029-8029-000000000c11', 'https://example.org/qa-propia')$sql$, org_p)
  FROM h31;

CREATE TEMP TABLE h31_cruces_res ON COMMIT DROP AS
SELECT n, relacion, fkey,
       pg_temp.al_commit(cruzado, 'postgres')  AS cruzado,
       pg_temp.al_commit(legitimo, 'postgres') AS legitimo
  FROM h31_cruces;

DO $$
BEGIN
    IF (SELECT count(*) FROM h31_cruces_res) <> 5 THEN
        RAISE EXCEPTION 'Vacuous run: los bloques 123 y 124 midieron % de 5 relaciones.',
            (SELECT count(*) FROM h31_cruces_res);
    END IF;
END
$$;

INSERT INTO defect_report
SELECT 123, 'una fila del tablero se cuelga de una tarjeta o un negocio de otra organización',
       count(*) FILTER (WHERE cruzado NOT LIKE '23503 |%"' || fkey || '"%') > 0,
       CASE WHEN count(*) FILTER (WHERE cruzado NOT LIKE '23503 |%"' || fkey || '"%') = 0
            THEN 'las ' || count(*) || ' relaciones rechazan el cruce con 23503 nombrando su FK compuesta'
            ELSE 'no rechazan por su FK compuesta: ' ||
                 string_agg(relacion || ' = ' || cruzado, ' / ' ORDER BY n)
                     FILTER (WHERE cruzado NOT LIKE '23503 |%"' || fkey || '"%')
            END
  FROM h31_cruces_res;

-- ── 124 ──────────────────────────────────────────────────────────────────────
INSERT INTO defect_report
SELECT 124, 'el tablero también rechaza la fila legítima de la propia organización',
       count(*) FILTER (WHERE legitimo <> 'paso') > 0,
       CASE WHEN count(*) FILTER (WHERE legitimo <> 'paso') = 0
            THEN 'las ' || count(*) || ' filas legítimas pasan al COMMIT'
            ELSE 'rechazadas: ' ||
                 string_agg(relacion || ' = ' || legitimo, ' / ' ORDER BY n) FILTER (WHERE legitimo <> 'paso')
            END
  FROM h31_cruces_res;

-- ── 125 ──────────────────────────────────────────────────────────────────────
-- Una tarjeta que depende de sí misma. El control positivo es el caso 4 del
-- 124: la misma tabla, otra tarjeta de la misma organización, pasa.
SELECT set_config('qa.b125', pg_temp.al_commit(format(
           $sql$INSERT INTO board_card_dependencies (organization_id, card_id, depends_on_card_id)
                VALUES (%L, 'd0290000-0029-4029-8029-000000000c01',
                        'd0290000-0029-4029-8029-000000000c01')$sql$, (SELECT org_t FROM h31)),
           'postgres'), true);

INSERT INTO defect_report
SELECT 125, 'una tarjeta puede depender de sí misma',
       current_setting('qa.b125') NOT LIKE '23514 |%"board_card_dependencies_not_self"%',
       CASE WHEN current_setting('qa.b125') LIKE '23514 |%"board_card_dependencies_not_self"%'
            THEN 'la auto-dependencia muere con 23514 en board_card_dependencies_not_self'
            ELSE 'la auto-dependencia devolvió: ' || current_setting('qa.b125') END;

-- ── 126 y 127 ────────────────────────────────────────────────────────────────
-- LA PUERTA DE H3.1, PUNTO (3): LEÍDO BAJO EL `auth.uid()` DE OTRA ORGANIZACIÓN.
--
-- Como `authenticated`, que es el rol al que las ocho policies de la `0029`
-- apuntan —`growthos_app` no es miembro de ese rol y vería cero filas por no
-- tener policy aplicable, que es otra cosa (ver el encabezado del archivo)—.
--
-- LA CONSULTA SE ARMA COMO `postgres` DESDE EL CATÁLOGO y se ejecuta como
-- `authenticated`, con el resultado viajando por un GUC: el patrón del 88. Una
-- fila por relación del tablero Y DE SU ALCANCE que se puede leer —tabla,
-- particionada, vista o vista materializada—, `relación=n`. Las vistas también:
-- una vista de `postgres` sin `security_invoker` lee con BYPASSRLS, y el punto
-- (3) de la puerta es lo que el lector alcanza, no lo que dice la policy de la
-- tabla de abajo. Por `regclass` y no por nombre en `public`: la vista que lee
-- el tablero puede vivir en otro esquema.
--
-- QUÉ SE CUENTA: para pau, las filas que ve y que NO son de P
-- (`organization_id IS DISTINCT FROM P`); para tere, en el 127, las de T. La
-- primera versión le contaba a pau `organization_id = T`, y eso es contar por
-- la columna que la RELACIÓN declara: una vista cuyo `organization_id` sale de
-- un LEFT JOIN a `organizations` —que tiene RLS— se la muestra en NULL a quien
-- no es miembro, y un verificador le dio así a pau las tres tarjetas de T con
-- el 126 en «board_digest=0». pau es miembro de P y de nada más: toda fila que
-- ve y no es de P, NULL incluido, es una que no tendría que ver.
--
-- ANTI-VACUIDAD, como `postgres`, y EN EL INFORME, no cortando la corrida: toda
-- relación legible que el catálogo dice del tablero o de su alcance tiene que
-- tener `organization_id` y al menos una fila de T. Sin eso, «pau ve cero»
-- sobre una relación vacía sería verde y mentira. Y tiene que haber al menos
-- una. En el informe por el motivo del 135: cortar la corrida acá escondía, en
-- la mutación de una hija nueva, el rojo del 128 y del 129, que son los que
-- dicen qué está mal en ella.
CREATE OR REPLACE FUNCTION pg_temp.tiene_tenant(p_rel oid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = p_rel AND a.attname = 'organization_id' AND NOT a.attisdropped)
$$;

DO $$
DECLARE
    r          record;
    n          bigint;
    legibles   int := 0;
    vacias     text := '';
    sin_tenant text := '';
BEGIN
    FOR r IN SELECT * FROM pg_temp.tablero_y_alcance() WHERE relkind IN ('r', 'p', 'v', 'm') LOOP
        legibles := legibles + 1;
        IF NOT pg_temp.tiene_tenant(r.oid) THEN
            sin_tenant := sin_tenant || r.relname || ' ';
            CONTINUE;
        END IF;
        EXECUTE format('SELECT count(*) FROM %s WHERE organization_id = $1', r.oid::regclass)
           INTO n USING (SELECT org_t FROM h31);
        IF n = 0 THEN vacias := vacias || r.relname || ' '; END IF;
    END LOOP;
    PERFORM set_config('qa.b126vacua',
        CASE WHEN legibles = 0 THEN 'el catálogo no dio ninguna relación legible del tablero'
             WHEN vacias <> '' OR sin_tenant <> ''
             THEN format('corrida vacua en [%s]: sin filas de T: [%s]; sin organization_id: [%s]',
                         btrim(vacias || sin_tenant), btrim(vacias), btrim(sin_tenant))
             ELSE '' END, true);
    RAISE NOTICE 'Bloques 126 y 127: % relaciones legibles del tablero y de su alcance por catálogo (%).', legibles,
        (SELECT string_agg(tb.relname || ':' || tb.relkind::text || CASE WHEN tb.de = 'alcance' THEN ' (alcance)' ELSE '' END,
                           ', ' ORDER BY tb.relname) FROM pg_temp.tablero_y_alcance() tb);
END
$$;

-- pau: lo que ve y no es de P. tere: lo que ve de T.
SELECT set_config('qa.sql126', coalesce((
    SELECT 'SELECT string_agg(r, '', '' ORDER BY r) FROM (' ||
           string_agg(format('SELECT %L || ''='' || (SELECT count(*) FROM %s WHERE organization_id IS DISTINCT FROM %L) AS r',
                             tb.relname, tb.oid::regclass, (SELECT org_p FROM h31)), ' UNION ALL ') ||
           ') z'
      FROM pg_temp.tablero_y_alcance() tb
     WHERE tb.relkind IN ('r', 'p', 'v', 'm') AND pg_temp.tiene_tenant(tb.oid)), 'SELECT NULL'), true);
SELECT set_config('qa.sql127', coalesce((
    SELECT 'SELECT string_agg(r, '', '' ORDER BY r) FROM (' ||
           string_agg(format('SELECT %L || ''='' || (SELECT count(*) FROM %s WHERE organization_id = %L) AS r',
                             tb.relname, tb.oid::regclass, (SELECT org_t FROM h31)), ' UNION ALL ') ||
           ') z'
      FROM pg_temp.tablero_y_alcance() tb
     WHERE tb.relkind IN ('r', 'p', 'v', 'm') AND pg_temp.tiene_tenant(tb.oid)), 'SELECT NULL'), true);

-- Y lo suyo: pau tiene que ser un lector que funciona, no un rol ciego. Armada
-- acá, como `postgres`: `authenticated` no puede leer `h31`.
SELECT set_config('qa.sql126p', format(
           'SELECT count(*) FROM public.board_cards WHERE organization_id = %L',
           (SELECT org_p FROM h31)), true);

-- pau, de la organización P, leyendo T.
SELECT pg_temp.be('d0290000-0029-4029-8029-000000000a03');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b126', pg_temp.escalar(current_setting('qa.sql126')), true);
SELECT set_config('qa.b126p', pg_temp.escalar(current_setting('qa.sql126p')), true);
RESET ROLE;

-- tere, la dueña de T, leyendo T.
SELECT pg_temp.be('d0290000-0029-4029-8029-000000000a01');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b127', pg_temp.escalar(current_setting('qa.sql127')), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 126, 'una persona de otra organización lee el tablero',
       NOT (vacua = '' AND v ~ '^[a-z0-9_]+=[0-9]+(, [a-z0-9_]+=[0-9]+)*$' AND v !~ '=[1-9]'),
       CASE WHEN vacua <> ''
            THEN vacua || ' / pau, filas que no son de P: ' || v
            WHEN v ~ '^[a-z0-9_]+=[0-9]+(, [a-z0-9_]+=[0-9]+)*$' AND v !~ '=[1-9]'
            THEN 'pau, de P, como authenticated, ve 0 filas que no son de P en las ' ||
                 array_length(string_to_array(v, ', '), 1) || ' relaciones del tablero y de su alcance: ' || v
            ELSE 'pau alcanza filas que no son de P: ' || v END
  FROM (SELECT current_setting('qa.b126') AS v, current_setting('qa.b126vacua') AS vacua) x;

-- ── 127 ──────────────────────────────────────────────────────────────────────
-- LA CONTRAPRUEBA. Sin ella, el 126 lo satisface un REVOKE, una policy que no
-- deja pasar a nadie, o una tabla vacía. La dueña lee lo suyo de T en CADA
-- relación del tablero y de su alcance, y pau lee lo suyo de P.
INSERT INTO defect_report
SELECT 127, 'la dueña no lee su propio tablero, o el lector del 126 es ciego',
       NOT (v ~ '^[a-z0-9_]+=[0-9]+(, [a-z0-9_]+=[0-9]+)*$' AND v !~ '=0(,|$)' AND p ~ '^[1-9][0-9]*$'),
       CASE WHEN v ~ '^[a-z0-9_]+=[0-9]+(, [a-z0-9_]+=[0-9]+)*$' AND v !~ '=0(,|$)' AND p ~ '^[1-9][0-9]*$'
            THEN 'tere lee T en cada relación (' || v || ') y pau lee ' || p || ' tarjetas de P'
            ELSE 'tere: ' || v || ' / pau sobre P: ' || p END
  FROM (SELECT current_setting('qa.b127') AS v, current_setting('qa.b126p') AS p) x;

-- ── 128 ──────────────────────────────────────────────────────────────────────
-- LA PUERTA DE H3.1, PUNTO (4), CON LA CORRECCIÓN DEL CRÍTICO.
--
-- El sub de Keycloak es un uuid: no se distingue por FORMA de uno de Supabase.
-- Lo único que vuelve imposible guardarlo es que no haya dónde: que toda columna
-- que pueda llevar un identificador lo reciba de un lugar que no sea un padrón
-- libre. «Atada por una FK que empareja el tenant», que era lo que este bloque
-- pedía en su primera versión, NO alcanzaba, y lo dijeron las mutaciones de un
-- verificador independiente: una FK compuesta contra CUALQUIER tabla con tenant
-- —`identity_links (organization_id, keycloak_sub)`, `kc_people`,
-- `card_people`, una `board_external_people` con su PK libre— guardaba el sub
-- con los 135 en verde. La pregunta correcta no es «¿tiene FK?» sino «¿de dónde
-- viene el valor?».
--
-- QUÉ SE MIRA. Las relaciones que PERSISTEN filas —tablas, particionadas,
-- vistas materializadas, foráneas— de `pg_temp.tablero()` y de
-- `pg_temp.alcance()`: lo que el tablero referencia por FK y lo que sus vistas
-- leen, transitivamente, hasta las dos ANCLAS que la puerta nombra
-- —`organizations`, el tenant, y `org_members`, el padrón, la única fuente de
-- personas—. Un padre, o la tabla que una vista del tablero junta con las
-- tarjetas, es un lugar donde una persona vive a un salto de la tarjeta. La
-- primera versión subía sólo por FK, y un verificador guardó el sub como uuid,
-- con su nombre, en una tabla que sólo una VISTA del tablero leía: los 135 en
-- verde. Hoy el único alcance examinado es `businesses`, por
-- `cited_business_id`, y es a propósito: una columna nueva de `businesses` que
-- guarde una identidad sin procedencia pone este bloque en rojo, porque el
-- tablero la nombra.
--
-- QUÉ SE EXIGE, columna por columna, con el tipo resuelto hasta el fondo de los
-- dominios —un dominio sobre un dominio sobre uuid ES uuid; la primera versión
-- resolvía un solo salto—:
--
--   a. TODA COLUMNA uuid, salvo `organization_id`, tiene PROCEDENCIA. O es una
--      identidad ACUÑADA por la base —la PK de una sola columna de su tabla, que
--      no está en ninguna FK, y cuyo default es una llamada sin argumentos a un
--      GENERADOR: una función volátil que devuelve uuid y que es del servidor
--      (`pg_catalog`: `gen_random_uuid()`) o de una extensión (`pg_depend`
--      `deptype 'e'`: `uuid_generate_v4()`), resuelta por catálogo y no por
--      nombre—, o está cubierta por una FK VALIDADA que empareja el
--      `organization_id` de la fila con el del padre Y cuya columna destino es
--      `org_members.user_id` o una identidad acuñada del padre. VALIDADA porque
--      una FK `NOT VALID` —la forma estándar de agregar una FK sobre una tabla
--      con datos— no miró las filas que ya estaban. Y la exención vieja de «la
--      PK propia» se fue: una PK de una sola columna sin default
--      (`board_external_people.id`), o metida en una FK
--      (`board_member_prefs.user_id REFERENCES auth.users`,
--      `board_card_reviews.card_id REFERENCES board_cards (id)`), era
--      exactamente el hueco. Y «volátil, sin argumentos y devuelve uuid»
--      tampoco alcanzaba para decir GENERADOR, y lo midieron dos verificadores:
--      toda función creada sin marca de volatilidad es VOLATILE, así que un
--      helper propio que lee `request.jwt.claim.sub` puesto de default copiaba
--      el sub de quien inserta en una PK «acuñada», sin que nadie lo escribiera
--      a mano y con los 135 en verde. Lo que distingue a un generador es de
--      quién es la función, y eso está en el catálogo;
--   b. `organization_id` está cubierto por una FK validada contra
--      `organizations (id)` o contra el `organization_id` de un padre;
--   c. NINGUNA COLUMNA ES UN CONTENEDOR: todo tipo base que no sea uuid ni texto
--      y que pueda llevar 128 bits —arrays, json, xml, bytea, numeric, tipos
--      fila, rangos— está prohibido. Por catálogo y no por lista: un tipo de
--      longitud fija menor que la de un uuid (`typlen` entre 1 y 15: enteros,
--      fechas, booleanos, enums) no puede llevar uno entero; cualquier otro, sí.
--      Un identificador dentro de un contenedor no tiene FK posible (decisión 2
--      de la `0029`), y la primera versión sólo miraba arrays y json;
--   c'. EL TEXTO ES UN CONTENEDOR MÁS, y la (a) no lo miraba: un verificador
--      guardó el sub en `card_links.external_key text` —el padre de la tabla
--      puente de la primera tanda, con un solo cambio de tipo— y en
--      `board_cards.external_ref text`, los dos con los 135 en verde; el sub
--      llega como texto en el JWT, así que es la forma NATURAL de guardarlo. El
--      catálogo no distingue texto libre de un identificador, pero sí ve una
--      columna de texto NUEVA. Así que toda columna de texto examinada es, o un
--      CONJUNTO CERRADO —un CHECK validado sobre esa sola columna que es
--      exactamente `col = ANY (ARRAY['literal'::text, ...])`, deparseado por el
--      servidor: `product`, `status`, `priority`—, o está en la lista
--      `h31_texto_libre` de abajo, que es LO QUE QUEDA ABIERTO dicho columna por
--      columna, no lo que está bien. Una columna de texto nueva, en el tablero o
--      en lo que el tablero alcanza, pone este bloque en rojo hasta que quien la
--      agrega la declare ahí con su motivo;
--   d. SEGUNDA LÍNEA, MÁS FLOJA Y DICHA COMO TAL: una columna con nombre de
--      identidad o de rol de persona —`sub`, `user`, `*_by`, `assignee`,
--      `approver`, `creator`, `reviewer`, `collaborator`, `author`, `owner`,
--      `email`...— no puede ser texto, y si es uuid tiene que ser EL PAR contra
--      el padrón: no le alcanza una identidad acuñada de otra tabla. Es la que ve
--      un `external_assignee_id` contra un padrón propio con la PK acuñada. No es
--      la garantía —un nombre neutro la esquiva—: es la red de la (a). Con UNA
--      excepción, cierta: un uuid cuya FK validada empareja el tenant y apunta a
--      `board_cards.id` es una TARJETA, no una persona —`superseded_by`,
--      `blocked_by_card_id`, el nombre de Jira para una dependencia— y daba un
--      falso rojo sólo por llamarse así. Los falsos rojos por nombre que quedan
--      están dichos: un texto que se llame `author` —el autor del artículo
--      citado— da rojo aunque no sea una persona del sistema, y el remedio es el
--      nombre (`byline`); y la procedencia no es transitiva: una nieta que
--      cuelga de `board_card_collaborators` por su PK natural
--      `(organization_id, card_id, user_id)` da rojo en `card_id` y en `user_id`,
--      porque el destino es una columna de la PK de la tabla puente y no la
--      tarjeta ni el padrón. Pasa con dos FK más, directas a `board_cards` y a
--      `org_members`, medido; es el costo de no seguir la procedencia por la
--      cadena.
--
-- Y aparte, cuántas FK van contra `org_members` y que TODAS emparejen
-- `(organization_id, <persona>)` con `(organization_id, user_id)` y estén
-- validadas: una FK contra `org_members (id)` también ataría la columna a algo,
-- y no a una persona del tenant.
--
-- LO QUE NO VE, y queda dicho:
--   * una tabla con su PK ACUÑADA por un generador, sin ninguna palabra de
--     persona en los nombres, en la que alguien inserta A MANO el sub como `id`.
--     Un default se pisa con un valor explícito —lo mismo vale para
--     `board_cards.id`—, y el catálogo ve el diseño, no cada INSERT. Medido: es
--     una de las mutaciones que sobreviven en la tabla de la `0029`;
--   * una persona escrita a mano en una columna de `h31_texto_libre`
--     —`objective`, `result`, el título o la URL de una fuente, el texto de
--     `businesses`—;
--   * un identificador PARTIDO en columnas angostas: dos `bigint` llevan 128
--     bits, y también dos `timestamptz`. Por catálogo, un número es un número;
--     medido, da los 135 en verde con nombres neutros.
--
-- EL DENOMINADOR SE IMPRIME, también en verde, y se exige: relaciones > 0,
-- columnas uuid miradas > 0, FK a `org_members` > 0. Cero sobre cero no informa
-- cero.
CREATE OR REPLACE FUNCTION pg_temp.tipo_base(p_tipo oid) RETURNS oid
LANGUAGE plpgsql STABLE AS $$
DECLARE
    t oid := p_tipo;
BEGIN
    WHILE (SELECT ty.typtype FROM pg_type ty WHERE ty.oid = t) = 'd' LOOP
        t := (SELECT ty.typbasetype FROM pg_type ty WHERE ty.oid = t);
    END LOOP;
    RETURN t;
END
$$;

-- Una identidad ACUÑADA por la base. La expresión del default se lee deparseada
-- por el servidor —no es texto que alguien escribió, no puede traer un
-- comentario— y la función se resuelve con `to_regprocedure` en la misma sesión
-- que la deparseó, así que el `search_path` no la mueve. Y la función tiene que
-- ser un GENERADOR: del servidor (`pg_catalog`) o miembro de una extensión.
-- Una función propia en `public` que se llame igual que uno
-- —`public.gen_random_uuid()` que lea el JWT— se deparsea calificada y no pasa.
CREATE OR REPLACE FUNCTION pg_temp.acunada(p_rel oid, p_attnum int2) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM pg_constraint pk
                    WHERE pk.conrelid = p_rel AND pk.contype = 'p' AND pk.conkey = ARRAY[p_attnum])
       AND NOT EXISTS (SELECT 1 FROM pg_constraint fk
                        WHERE fk.conrelid = p_rel AND fk.contype = 'f' AND p_attnum = ANY (fk.conkey))
       AND EXISTS (SELECT 1
                     FROM pg_attrdef d
                     JOIN pg_proc f
                       ON f.oid = CASE WHEN pg_get_expr(d.adbin, d.adrelid) ~ '^[[:alnum:]_.]+\(\)$'
                                       THEN to_regprocedure(pg_get_expr(d.adbin, d.adrelid))::oid END
                    WHERE d.adrelid = p_rel AND d.adnum = p_attnum
                      AND f.prorettype = 'uuid'::regtype AND f.provolatile = 'v'
                      AND (f.pronamespace = 'pg_catalog'::regnamespace
                           OR EXISTS (SELECT 1 FROM pg_depend e
                                       WHERE e.classid = 'pg_proc'::regclass AND e.objid = f.oid
                                         AND e.refclassid = 'pg_extension'::regclass
                                         AND e.deptype = 'e')))
$$;

CREATE TEMP TABLE h31_examinadas ON COMMIT DROP AS
SELECT tb.oid, tb.oid::regclass::text AS relname, tb.de
  FROM pg_temp.tablero_y_alcance() tb
 WHERE tb.relkind IN ('r', 'p', 'm', 'f');

-- LO QUE QUEDA ABIERTO EN EL TEXTO, columna por columna (la c'). No es una lista
-- de lo que está bien: es la de lo que el catálogo NO puede cerrar, dicha. Una
-- columna de texto examinada que no sea un conjunto cerrado y no esté acá pone
-- el 128 en rojo.
CREATE TEMP TABLE h31_texto_libre (relacion regclass, columna name, motivo text) ON COMMIT DROP;
INSERT INTO h31_texto_libre VALUES
    ('public.board_cards',        'objective',         'el objetivo de §6.2: texto libre de una persona'),
    ('public.board_cards',        'result',            'el resultado de §6.2: texto libre de una persona'),
    ('public.board_card_sources', 'url',               'una URL: su CHECK es de forma y el camino lleva cualquier cosa'),
    ('public.board_card_sources', 'title',             'el título de la fuente citada'),
    ('public.businesses',         'name',              'el alcance: de la 0001, el tablero lo cita'),
    ('public.businesses',         'website',           'el alcance: de la 0001'),
    ('public.businesses',         'industry',          'el alcance: de la 0001'),
    ('public.businesses',         'brand_tone',        'el alcance: de la 0001'),
    ('public.businesses',         'primary_locale',    'el alcance: de la 0001'),
    ('public.businesses',         'value_proposition', 'el alcance: de la 0001'),
    ('public.businesses',         'logo_color',        'el alcance: de la 0001'),
    ('public.businesses',         'slug',              'el alcance: su CHECK de forma acepta un uuid en texto');

CREATE TEMP TABLE h31_columnas ON COMMIT DROP AS
WITH padron AS (
    SELECT (SELECT a.attnum FROM pg_attribute a
             WHERE a.attrelid = 'public.org_members'::regclass AND a.attname = 'organization_id') AS m_org,
           (SELECT a.attnum FROM pg_attribute a
             WHERE a.attrelid = 'public.org_members'::regclass AND a.attname = 'user_id') AS m_user
),
col AS (
    SELECT e.relname, e.de, a.attrelid, a.attnum, a.attname,
           bt.oid AS base_oid, bt.typname AS base, bt.typcategory AS categoria, bt.typlen AS largo,
           (SELECT oa.attnum FROM pg_attribute oa
             WHERE oa.attrelid = a.attrelid AND oa.attname = 'organization_id'
               AND NOT oa.attisdropped) AS org_attnum
      FROM h31_examinadas e
      JOIN pg_attribute a ON a.attrelid = e.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_type bt ON bt.oid = pg_temp.tipo_base(a.atttypid)
)
SELECT c.*,
       CASE WHEN c.base_oid = 'uuid'::regtype THEN 'uuid'
            WHEN c.categoria = 'S'           THEN 'texto'
            WHEN c.largo BETWEEN 1 AND 15    THEN 'angosto'
            ELSE 'contenedor' END AS clase,
       c.attname ~ ('(^|_)(sub|subject|user|users|uid|by|assignee|assignees|assigned|approver|approvers|'
                    'creator|creators|reviewer|reviewers|collaborator|collaborators|author|authors|owner|'
                    'owners|member|members|person|people|keycloak|kc|actor|identity|principal|email|mail)(_|$)')
           AS nombre_de_persona,
       pg_temp.acunada(c.attrelid, c.attnum) AS acunada,
       -- (c'): un conjunto cerrado, por un CHECK validado sobre esta sola
       -- columna que el servidor deparsea EXACTAMENTE como una lista de
       -- literales.
       -- Anclado de punta a punta: `... OR true`, o un `~` agregado, no pasa.
       c.categoria = 'S' AND c.attname ~ '^[a-z_][a-z0-9_]*$'
       AND EXISTS (SELECT 1 FROM pg_constraint ck
                    WHERE ck.conrelid = c.attrelid AND ck.contype = 'c' AND ck.convalidated
                      AND ck.conkey = ARRAY[c.attnum]::int2[]
                      AND pg_get_expr(ck.conbin, ck.conrelid)
                          ~ ('^\(' || c.attname || $re$ = ANY \(ARRAY\['([^']|'')*'::text(, '([^']|'')*'::text)*\]\)\)$$re$))
           AS texto_cerrado,
       EXISTS (SELECT 1 FROM h31_texto_libre l WHERE l.relacion = c.attrelid AND l.columna = c.attname)
           AS texto_declarado,
       -- (d), su excepción: una FK validada que empareja el tenant y apunta a
       -- `board_cards.id`. Es una tarjeta, no una persona.
       EXISTS (SELECT 1
                 FROM pg_constraint fk
                CROSS JOIN LATERAL generate_subscripts(fk.conkey, 1) AS g(j)
                WHERE fk.conrelid = c.attrelid AND fk.contype = 'f' AND fk.convalidated
                  AND fk.conkey[g.j] = c.attnum
                  AND fk.confrelid = 'public.board_cards'::regclass
                  AND (SELECT pa.attname FROM pg_attribute pa
                        WHERE pa.attrelid = fk.confrelid AND pa.attnum = fk.confkey[g.j]) = 'id'
                  AND EXISTS (SELECT 1 FROM generate_subscripts(fk.conkey, 1) AS h(i)
                               WHERE fk.conkey[h.i] = c.org_attnum
                                 AND (SELECT pa.attname FROM pg_attribute pa
                                       WHERE pa.attrelid = fk.confrelid
                                         AND pa.attnum = fk.confkey[h.i]) = 'organization_id'))
           AS apunta_a_tarjeta,
       -- (a): una FK validada que la contiene, empareja el tenant con el del
       -- padre, y apunta al padrón o a una identidad acuñada del padre.
       EXISTS (SELECT 1
                 FROM pg_constraint fk
                CROSS JOIN LATERAL generate_subscripts(fk.conkey, 1) AS g(j)
                WHERE fk.conrelid = c.attrelid AND fk.contype = 'f' AND fk.convalidated
                  AND fk.conkey[g.j] = c.attnum
                  AND EXISTS (SELECT 1 FROM generate_subscripts(fk.conkey, 1) AS h(i)
                               WHERE fk.conkey[h.i] = c.org_attnum
                                 AND (SELECT pa.attname FROM pg_attribute pa
                                       WHERE pa.attrelid = fk.confrelid
                                         AND pa.attnum = fk.confkey[h.i]) = 'organization_id')
                  AND ((fk.confrelid = 'public.org_members'::regclass
                        AND fk.confkey[g.j] = (SELECT m_user FROM padron))
                       OR pg_temp.acunada(fk.confrelid, fk.confkey[g.j])))
           AS con_procedencia,
       -- (b): el tenant, contra organizations (id) o contra el tenant del padre.
       EXISTS (SELECT 1
                 FROM pg_constraint fk
                CROSS JOIN LATERAL generate_subscripts(fk.conkey, 1) AS g(j)
                WHERE fk.conrelid = c.attrelid AND fk.contype = 'f' AND fk.convalidated
                  AND fk.conkey[g.j] = c.attnum
                  AND (SELECT pa.attname FROM pg_attribute pa
                        WHERE pa.attrelid = fk.confrelid AND pa.attnum = fk.confkey[g.j])
                      = CASE WHEN fk.confrelid = 'public.organizations'::regclass
                             THEN 'id' ELSE 'organization_id' END)
           AS tenant_con_procedencia,
       -- (d): el par contra el padrón, exacto y validado.
       EXISTS (SELECT 1 FROM pg_constraint fk
                WHERE fk.conrelid = c.attrelid AND fk.contype = 'f' AND fk.convalidated
                  AND fk.confrelid = 'public.org_members'::regclass
                  AND fk.conkey = ARRAY[c.org_attnum, c.attnum]::int2[]
                  AND fk.confkey = (SELECT ARRAY[m_org, m_user]::int2[] FROM padron))
           AS par_del_padron
  FROM col c;

CREATE TEMP TABLE h31_identidad ON COMMIT DROP AS
SELECT (SELECT count(DISTINCT attrelid) FROM h31_columnas WHERE de = 'tablero')        AS relaciones,
       coalesce((SELECT string_agg(DISTINCT relname, ', ') FROM h31_columnas WHERE de = 'alcance'),
                '')                                                                    AS alcance,
       (SELECT count(*) FROM h31_columnas)                                             AS columnas,
       (SELECT count(*) FROM h31_columnas WHERE clase = 'uuid')                        AS uuid_miradas,
       (SELECT count(*) FROM h31_columnas WHERE clase = 'uuid' AND acunada)            AS acunadas,
       (SELECT count(*) FROM h31_columnas WHERE clase = 'texto')                       AS textos,
       (SELECT count(*) FROM h31_columnas WHERE clase = 'texto' AND texto_cerrado)     AS textos_cerrados,
       (SELECT count(*) FROM h31_columnas WHERE clase = 'texto' AND NOT texto_cerrado
                                            AND texto_declarado)                       AS textos_declarados,
       coalesce((SELECT string_agg(relname || '.' || attname, ', ' ORDER BY relname, attname)
                   FROM h31_columnas
                  WHERE clase = 'uuid' AND attname <> 'organization_id'
                    AND NOT acunada AND NOT con_procedencia), '')                      AS uuid_sin_procedencia,
       coalesce((SELECT string_agg(relname, ', ' ORDER BY relname)
                   FROM h31_columnas
                  WHERE attname = 'organization_id' AND NOT tenant_con_procedencia), '') AS tenant_sin_procedencia,
       coalesce((SELECT string_agg(relname || '.' || attname || ' (' || base || ')', ', ' ORDER BY relname, attname)
                   FROM h31_columnas WHERE clase = 'contenedor'), '')                  AS contenedores,
       coalesce((SELECT string_agg(relname || '.' || attname || ' (' || base || ')', ', ' ORDER BY relname, attname)
                   FROM h31_columnas
                  WHERE clase = 'texto' AND NOT texto_cerrado AND NOT texto_declarado), '') AS texto_abierto,
       coalesce((SELECT string_agg(relname || '.' || attname || ' (' || base || ')', ', ' ORDER BY relname, attname)
                   FROM h31_columnas
                  WHERE nombre_de_persona
                    AND (clase = 'texto'
                         OR (clase = 'uuid' AND NOT par_del_padron AND NOT apunta_a_tarjeta))), '') AS persona_fuera_del_padron,
       (SELECT count(*) FROM pg_constraint fk
          JOIN h31_examinadas e ON e.oid = fk.conrelid
         WHERE fk.contype = 'f' AND fk.confrelid = 'public.org_members'::regclass)     AS fk_a_miembros,
       coalesce((SELECT string_agg(fk.conname, ', ' ORDER BY fk.conname)
                   FROM pg_constraint fk
                   JOIN h31_examinadas e ON e.oid = fk.conrelid
                  WHERE fk.contype = 'f' AND fk.confrelid = 'public.org_members'::regclass
                    AND NOT (fk.convalidated
                             AND array_length(fk.confkey, 1) = 2
                             AND (SELECT pa.attname FROM pg_attribute pa
                                   WHERE pa.attrelid = fk.conrelid AND pa.attnum = fk.conkey[1]) = 'organization_id'
                             AND (SELECT pa.attname FROM pg_attribute pa
                                   WHERE pa.attrelid = fk.confrelid AND pa.attnum = fk.confkey[1]) = 'organization_id'
                             AND (SELECT pa.attname FROM pg_attribute pa
                                   WHERE pa.attrelid = fk.confrelid AND pa.attnum = fk.confkey[2]) = 'user_id')),
                '')                                                                     AS fk_a_miembros_mal;

INSERT INTO defect_report
SELECT 128, 'una columna del tablero puede guardar un identificador de persona sin la FK compuesta',
       NOT ok,
       CASE WHEN ok
            THEN format('%s columnas miradas, de %s relaciones del tablero y de su alcance [%s]; %s de ellas uuid ' ||
                        '(%s acuñadas por un generador): toda uuid viene del padrón o de una identidad acuñada, ' ||
                        'por una FK validada que empareja el tenant; sin contenedores; %s de texto, %s conjuntos ' ||
                        'cerrados y %s declaradas como texto libre; ningún nombre de persona fuera del padrón; ' ||
                        '%s FK a org_members, todas (organization_id, persona) -> (organization_id, user_id)',
                        columnas, relaciones, alcance, uuid_miradas, acunadas, textos, textos_cerrados,
                        textos_declarados, fk_a_miembros)
            ELSE format('relaciones=%s alcance=[%s] columnas=%s uuid=%s fk_a_miembros=%s; ' ||
                        'uuid sin procedencia: [%s]; organization_id sin procedencia: [%s]; ' ||
                        'contenedores: [%s]; texto que no es un conjunto cerrado ni está declarado: [%s]; ' ||
                        'nombre de persona fuera del padrón: [%s]; ' ||
                        'FK a org_members que no es el par validado: [%s]',
                        relaciones, alcance, columnas, uuid_miradas, fk_a_miembros, uuid_sin_procedencia,
                        tenant_sin_procedencia, contenedores, texto_abierto, persona_fuera_del_padron,
                        fk_a_miembros_mal)
            END
  FROM (SELECT *,
               relaciones > 0 AND uuid_miradas > 0 AND fk_a_miembros > 0
               AND uuid_sin_procedencia = '' AND tenant_sin_procedencia = '' AND contenedores = ''
               AND texto_abierto = '' AND persona_fuera_del_padron = '' AND fk_a_miembros_mal = '' AS ok
          FROM h31_identidad) x;

-- El denominador, impreso también en verde: la corrección del crítico lo pide, y
-- un bloque que sólo lo dice cuando falla no deja ver si miró algo.
DO $$
BEGIN
    RAISE NOTICE 'Bloque 128: % columnas miradas, de % relaciones del tablero y de su alcance [%]; % uuid, % acuñadas; % de texto (% cerradas, % declaradas); % FK a org_members.',
        (SELECT columnas FROM h31_identidad), (SELECT relaciones FROM h31_identidad),
        (SELECT alcance FROM h31_identidad), (SELECT uuid_miradas FROM h31_identidad),
        (SELECT acunadas FROM h31_identidad), (SELECT textos FROM h31_identidad),
        (SELECT textos_cerrados FROM h31_identidad), (SELECT textos_declarados FROM h31_identidad),
        (SELECT fk_a_miembros FROM h31_identidad);
END
$$;

-- ── 129 ──────────────────────────────────────────────────────────────────────
-- TODA RELACIÓN DEL TABLERO —por catálogo— está acotada al tenant:
--
--   * una TABLA (o particionada) lleva `organization_id` uuid NOT NULL, RLS
--     ENABLE y FORCE, y sus dos capas de policy acotadas EXACTAMENTE por
--     `current_user_org_ids()`;
--   * una VISTA lleva `organization_id` y `security_invoker`: sin él, una vista
--     de `postgres` lee con BYPASSRLS y la policy de la tabla de abajo no corre;
--   * una VISTA MATERIALIZADA o una tabla FORÁNEA no puede ser del tablero: no
--     tienen RLS posible.
--
-- Y TODA RELACIÓN DE SU ALCANCE (`pg_temp.alcance()`), con la misma regla para
-- vistas, materializadas y foráneas, y para las tablas una más floja que no
-- deja de acotar: `organization_id` uuid NOT NULL, ENABLE y FORCE, al menos una
-- permisiva de lectura para `authenticated` (o `PUBLIC`) IGUAL a la forma
-- canónica, y ninguna permisiva distinta. Más floja porque el alcance tiene
-- tablas de antes de la `0029` con su propia forma —la de `businesses` es UNA
-- permisiva `FOR ALL TO PUBLIC` de la `0001`, sin restrictiva— y la conducta
-- del 126 es lo que mide la lectura. Lo que NO se afloja es que la tabla de
-- abajo tenga RLS: «la policy de la tabla de abajo» era un supuesto que la
-- primera versión de este bloque hacía para las vistas sin mirarlo, y un
-- verificador le puso a una vista del tablero, con `security_invoker`, una
-- tabla de abajo sin RLS.
--
-- Las policies por catálogo y no sólo por conducta, por lo que el bloque 94
-- midió con la ficha: para un SELECT la permisiva y la restrictiva se tapan, así
-- que degradar UNA de las dos deja verdes al 126 y al 127.
--
-- Y POR IGUALDAD, NO POR TEXTO PARECIDO (R14). La primera versión pedía
-- `LIKE '%organization_id%current_user_org_ids()%'`, y un verificador la rompió
-- dos veces: `organization_id IS NOT NULL OR organization_id IN (...)` y
-- `organization_id IN (...) OR true` contienen ese texto y no acotan nada, en
-- UNA capa —verde con los 135— o en las dos —sólo el 126 rojo—. Un escaneo de
-- texto no distingue un predicado que acota de uno que lo nombra. Ahora cada
-- expresión tiene que ser IGUAL a la forma canónica, y la forma canónica no está
-- escrita a mano: se crea una policy con el predicado de la puerta sobre una
-- tabla temporal y se deparsea en esta misma sesión, así que ni el `search_path`
-- ni la versión del deparser la mueven.
--
-- Qué se exige de las policies de cada tabla:
--   * una restrictiva `FOR ALL TO authenticated` cuyo USING y WITH CHECK son la
--     forma canónica;
--   * una permisiva de lectura (`SELECT` o `ALL`) `TO authenticated` cuyo USING
--     es la forma canónica;
--   * NINGUNA permisiva, de ningún rol ni comando, con un USING o un WITH CHECK
--     distinto de la forma canónica: las permisivas se suman, y una floja abre
--     la capa aunque la otra esté bien.
CREATE TEMP TABLE h31_canon (organization_id uuid) ON COMMIT DROP;
CREATE POLICY h31_canon ON h31_canon USING (organization_id IN (SELECT public.current_user_org_ids()));
SELECT set_config('qa.canon129',
                  (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p
                    WHERE p.polrelid = 'h31_canon'::regclass), true);

DO $$
BEGIN
    IF coalesce(current_setting('qa.canon129'), '') !~ 'current_user_org_ids' THEN
        RAISE EXCEPTION 'Vacuous run: la forma canónica del 129 salió vacía: [%]', current_setting('qa.canon129');
    END IF;
END
$$;

CREATE TEMP TABLE h31_tablas ON COMMIT DROP AS
SELECT tb.relname, tb.relkind, tb.de,
       coalesce((SELECT a.atttypid = 'uuid'::regtype AND (a.attnotnull OR tb.relkind = 'v')
                   FROM pg_attribute a
                  WHERE a.attrelid = tb.oid AND a.attname = 'organization_id' AND NOT a.attisdropped),
                false) AS tenant_ok,
       c.relrowsecurity AND c.relforcerowsecurity AS rls_ok,
       coalesce(array_to_string(c.reloptions, ',') ~* '(^|,)security_invoker=(true|on|yes|1)(,|$)', false)
           AS invoker_ok,
       EXISTS (SELECT 1 FROM pg_policy p
                WHERE p.polrelid = tb.oid AND NOT p.polpermissive AND p.polcmd = '*'
                  AND 'authenticated'::regrole::oid = ANY (p.polroles)
                  AND pg_get_expr(p.polqual, p.polrelid) = current_setting('qa.canon129')
                  AND pg_get_expr(p.polwithcheck, p.polrelid) = current_setting('qa.canon129'))
           AS restrictiva_ok,
       EXISTS (SELECT 1 FROM pg_policy p
                WHERE p.polrelid = tb.oid AND p.polpermissive AND p.polcmd IN ('r', '*')
                  AND 'authenticated'::regrole::oid = ANY (p.polroles)
                  AND pg_get_expr(p.polqual, p.polrelid) = current_setting('qa.canon129'))
           AS lectura_ok,
       -- La del alcance: la misma lectura, también si la policy es de PUBLIC
       -- (oid 0).
       EXISTS (SELECT 1 FROM pg_policy p
                WHERE p.polrelid = tb.oid AND p.polpermissive AND p.polcmd IN ('r', '*')
                  AND ('authenticated'::regrole::oid = ANY (p.polroles) OR 0::oid = ANY (p.polroles))
                  AND pg_get_expr(p.polqual, p.polrelid) = current_setting('qa.canon129'))
           AS lectura_alcance_ok,
       NOT EXISTS (SELECT 1 FROM pg_policy p
                    WHERE p.polrelid = tb.oid AND p.polpermissive
                      AND ((p.polcmd <> 'a'
                            AND pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM current_setting('qa.canon129'))
                           OR (p.polcmd = 'a'
                               AND pg_get_expr(p.polwithcheck, p.polrelid) IS DISTINCT FROM current_setting('qa.canon129'))
                           OR (p.polwithcheck IS NOT NULL
                               AND pg_get_expr(p.polwithcheck, p.polrelid) <> current_setting('qa.canon129'))))
           AS sin_permisiva_floja
  FROM pg_temp.tablero_y_alcance() tb
  JOIN pg_class c ON c.oid = tb.oid;

INSERT INTO defect_report
SELECT 129, 'una relación del tablero no lleva el tenant, RLS ENABLE y FORCE, o sus policies no acotan',
       count(*) FILTER (WHERE de = 'tablero') = 0 OR count(*) FILTER (WHERE NOT ok) > 0,
       CASE WHEN count(*) FILTER (WHERE de = 'tablero') > 0 AND count(*) FILTER (WHERE NOT ok) = 0
            THEN 'las ' || count(*) FILTER (WHERE de = 'tablero') || ' relaciones del tablero (' ||
                 string_agg(relname || ':' || relkind::text, ', ' ORDER BY relname) FILTER (WHERE de = 'tablero') ||
                 '): cada tabla con organization_id uuid NOT NULL, ENABLE + FORCE, una restrictiva y una ' ||
                 'permisiva de lectura IGUALES a la forma canónica (' || current_setting('qa.canon129') ||
                 '), ninguna permisiva distinta; cada vista con security_invoker; ninguna materializada ni ' ||
                 'foránea. Y de su alcance, ' || count(*) FILTER (WHERE de = 'alcance') || ' (' ||
                 coalesce(string_agg(relname || ':' || relkind::text, ', ' ORDER BY relname)
                              FILTER (WHERE de = 'alcance'), '') ||
                 '): cada tabla con organization_id uuid NOT NULL, ENABLE + FORCE, una permisiva de lectura ' ||
                 'canónica y ninguna distinta'
            ELSE coalesce(string_agg(CASE WHEN relkind IN ('r', 'p') AND de = 'tablero'
                                          THEN format('%s: tenant=%s rls=%s restrictiva=%s lectura=%s sin_floja=%s',
                                                      relname, tenant_ok, rls_ok, restrictiva_ok, lectura_ok,
                                                      sin_permisiva_floja)
                                          WHEN relkind IN ('r', 'p')
                                          THEN format('%s (alcance): tenant=%s rls=%s lectura=%s sin_floja=%s',
                                                      relname, tenant_ok, rls_ok, lectura_alcance_ok,
                                                      sin_permisiva_floja)
                                          WHEN relkind = 'v'
                                          THEN format('%s (vista%s): tenant=%s security_invoker=%s', relname,
                                                      CASE WHEN de = 'alcance' THEN ', alcance' ELSE '' END,
                                                      tenant_ok, invoker_ok)
                                          ELSE format('%s (relkind %s%s): no admite RLS', relname, relkind,
                                                      CASE WHEN de = 'alcance' THEN ', alcance' ELSE '' END) END,
                                     ' / ' ORDER BY relname) FILTER (WHERE NOT ok),
                          'el catálogo no encontró ninguna relación del tablero')
            END
  FROM (SELECT *,
               CASE WHEN relkind IN ('r', 'p') AND de = 'tablero'
                    THEN tenant_ok AND rls_ok AND restrictiva_ok AND lectura_ok AND sin_permisiva_floja
                    WHEN relkind IN ('r', 'p')
                    THEN tenant_ok AND rls_ok AND lectura_alcance_ok AND sin_permisiva_floja
                    WHEN relkind = 'v' THEN tenant_ok AND invoker_ok
                    ELSE false END AS ok
          FROM h31_tablas) x;

-- ── 130 ──────────────────────────────────────────────────────────────────────
-- LOS PRIVILEGIOS DEL TABLERO, POR CATÁLOGO, sobre toda relación del tablero
-- —vistas y materializadas incluidas—. `anon` no tiene NADA —ni leer: el bloque
-- 14 mira sólo la escritura de `anon`, y una lectura otorgada de más es
-- superficie aunque hoy la RLS la vacíe—; `authenticated` sólo SELECT (decisión
-- 11 de la `0029`). Efectivo, con `has_table_privilege`, que cuenta lo que llega
-- por PUBLIC y por pertenencia a otro rol; Y POR COLUMNA, con
-- `has_any_column_privilege`: un `GRANT SELECT (assignee_id) ... TO anon` no es
-- un privilegio de tabla y `has_table_privilege` da `f` sobre él, así que la
-- primera versión de este bloque no lo veía. TRUNCATE, DELETE, TRIGGER y
-- MAINTAIN no existen por columna.
--
-- LOS OCHO, NO LOS SIETE: `MAINTAIN` existe desde PostgreSQL 17, que es lo que
-- corren la réplica y hosted, y entra en el `GRANT ALL` de los default
-- privileges de Supabase. Con él, `anon` toma `ACCESS EXCLUSIVE` sobre la tabla
-- con un `LOCK TABLE` —frena toda lectura y escritura del tablero—, o corre
-- `VACUUM FULL`, `CLUSTER` o `REINDEX`. No lee filas: es superficie y es un
-- corte de servicio. La primera versión miraba siete y un `GRANT MAINTAIN` la
-- dejaba en verde.
--
-- Y LAS RPC QUE EL CATÁLOGO ATA AL TABLERO: una función `SECURITY DEFINER` que
-- depende de una relación del tablero o de su tipo fila —`RETURNS SETOF
-- board_cards`, aunque sea plpgsql, o un cuerpo SQL estándar `BEGIN ATOMIC` que
-- lee la tabla— y que `anon` o `authenticated` pueden ejecutar. Corre como su
-- dueño, que tiene BYPASSRLS, así que es una lectura del tablero ajeno con otro
-- nombre: medido, pau leía las tres tarjetas de T por cada una con los 135 en
-- verde. Las que NO dejan dependencia —plpgsql con `RETURNS TABLE (...)`— son
-- el residuo dicho en el encabezado de esta tanda.
CREATE TEMP TABLE h31_grants ON COMMIT DROP AS
SELECT tb.relname, r.rol, pr.priv,
       has_table_privilege(r.rol, tb.oid, pr.priv)
       OR (pr.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
           AND has_any_column_privilege(r.rol, tb.oid, pr.priv)) AS tiene
  FROM pg_temp.tablero() tb
 CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rol)
 CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) pr(priv);

CREATE TEMP TABLE h31_rpc ON COMMIT DROP AS
SELECT DISTINCT f.oid::regprocedure::text AS funcion, r.rol
  FROM pg_proc f
  JOIN pg_depend d ON d.classid = 'pg_proc'::regclass AND d.objid = f.oid
  JOIN pg_temp.tablero() tb
    ON (d.refclassid = 'pg_class'::regclass AND d.refobjid = tb.oid)
    OR (d.refclassid = 'pg_type'::regclass
        AND d.refobjid = (SELECT c.reltype FROM pg_class c WHERE c.oid = tb.oid))
 CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rol)
 WHERE f.prosecdef AND has_function_privilege(r.rol, f.oid, 'EXECUTE');

INSERT INTO defect_report
SELECT 130, 'un rol de la API tiene sobre el tablero más que lo decidido',
       count(*) = 0 OR count(*) FILTER (WHERE tiene <> (rol = 'authenticated' AND priv = 'SELECT')) > 0
       OR (SELECT count(*) FROM h31_rpc) > 0,
       CASE WHEN count(*) > 0 AND count(*) FILTER (WHERE tiene <> (rol = 'authenticated' AND priv = 'SELECT')) = 0
                 AND (SELECT count(*) FROM h31_rpc) = 0
            THEN count(*) || ' privilegios mirados, de tabla y por columna, sobre ' || count(DISTINCT relname) ||
                 ' relaciones: anon ninguno, authenticated sólo SELECT; ninguna función SECURITY DEFINER ' ||
                 'atada al tablero por el catálogo que anon o authenticated puedan ejecutar'
            ELSE coalesce('fuera de lo decidido: ' ||
                          string_agg(rol || (CASE WHEN tiene THEN ' tiene ' ELSE ' NO tiene ' END) ||
                                     priv || ' en ' || relname, ', ' ORDER BY relname, rol, priv)
                              FILTER (WHERE tiene <> (rol = 'authenticated' AND priv = 'SELECT')),
                          CASE WHEN count(*) = 0 THEN 'el catálogo no encontró ninguna relación del tablero'
                               ELSE 'los privilegios de tabla, como se decidió' END) ||
                 coalesce(' / SECURITY DEFINER sobre el tablero, ejecutable por la API: ' ||
                          (SELECT string_agg(funcion || ' por ' || rol, ', ' ORDER BY funcion, rol) FROM h31_rpc), '')
            END
  FROM h31_grants;

-- ── 131 ──────────────────────────────────────────────────────────────────────
-- LA BAJA DE LA ORGANIZACIÓN ENTERA, CON EL TABLERO POBLADO. Es el paso 1 de
-- `deleteMyAccount` para tere, que es dueña de T: lo corre `service_role`.
--
-- Exige que pase al COMMIT —con una tarjeta APROBADA adentro, que es la FK que
-- se niega: la decisión 4 de la `0029` midió que no necesita ser diferible porque
-- la tarjeta cuelga directo de la organización— y que no quede una fila de T en
-- ninguna tabla de `public` con
-- `organization_id`, contadas por catálogo dentro de `al_commit()`. El número de
-- tablas miradas se compara contra el MISMO catálogo leído acá afuera: menos
-- quiere decir que la cuenta no miró lo que dice.
SELECT set_config('qa.b131', pg_temp.al_commit(
           format('DELETE FROM organizations WHERE id = %L', (SELECT org_t FROM h31)),
           'service_role', (SELECT org_t FROM h31)), true);

INSERT INTO defect_report
SELECT 131, 'una organización con tablero no se puede dar de baja, o la baja deja filas',
       NOT (v ~ '^paso; [0-9]+ tablas; quedaron: \[\]$'
            AND substring(v FROM '^paso; ([0-9]+) tablas')::int = esperadas),
       CASE WHEN v ~ '^paso; [0-9]+ tablas; quedaron: \[\]$'
                 AND substring(v FROM '^paso; ([0-9]+) tablas')::int = esperadas
            THEN 'la baja de T pasó al COMMIT como service_role, con tarjetas, aprobación, colaboración, ' ||
                 'dependencia y fuente puestas: ' || v
            ELSE 'la baja de T devolvió: ' || v || ' (se esperaban ' || esperadas || ' tablas)' END
  FROM (SELECT current_setting('qa.b131') AS v,
               (SELECT count(*)::int
                  FROM pg_class c
                  JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = 'public'
                  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id'
                                     AND NOT a.attisdropped
                 WHERE c.relkind IN ('r', 'p')) AS esperadas) x;

-- ── 132 ──────────────────────────────────────────────────────────────────────
-- LA BAJA DE QUIEN APROBÓ SE NIEGA (decisión 3 de la `0029`). Con T en pie, dos
-- caminos a la misma membresía de tere, y los dos tienen que morir con 23503
-- NOMBRANDO la FK del aprobador:
--
--   a. el paso 2 de `deleteMyAccount`, como `service_role`;
--   b. tere desde `auth.users`, que cae por cascada en la membresía. Como
--      `postgres`, por el motivo escrito en el 119: en hosted lo borra GoTrue.
--
-- tere es además responsable y creadora de T1: esas dos se anulan en la misma
-- sentencia, y lo que la frena es la tercera. Un 23503 de otra FK, o un 23514
-- de un SET NULL que choque con el CHECK de la aprobación, no es la negativa que
-- se mide.
SELECT set_config('qa.b132a', pg_temp.al_commit(format(
           'DELETE FROM org_members WHERE organization_id = %L AND user_id = %L',
           (SELECT org_t FROM h31), 'd0290000-0029-4029-8029-000000000a01'), 'service_role'), true);
SELECT set_config('qa.b132b', pg_temp.al_commit(
           'DELETE FROM auth.users WHERE id = ''d0290000-0029-4029-8029-000000000a01''',
           'postgres'), true);

INSERT INTO defect_report
SELECT 132, 'se puede dar de baja a quien aprobó una tarjeta mientras la tarjeta sigue en pie',
       NOT (a LIKE '23503 |%"board_cards_approver_member_fkey"%'
            AND b LIKE '23503 |%"board_cards_approver_member_fkey"%'),
       CASE WHEN a LIKE '23503 |%"board_cards_approver_member_fkey"%'
                 AND b LIKE '23503 |%"board_cards_approver_member_fkey"%'
            THEN 'las dos bajas de tere mueren con 23503 en board_cards_approver_member_fkey'
            ELSE 'membresía: ' || a || ' / desde auth.users: ' || b END
  FROM (SELECT current_setting('qa.b132a') AS a, current_setting('qa.b132b') AS b) x;

-- ── 133 ──────────────────────────────────────────────────────────────────────
-- LA BAJA DEL RESPONSABLE PASA Y ANULA (decisión 3 de la `0029`). teo es
-- responsable y creador de T2 y colabora en T1, y no aprobó nada. Su baja —el
-- paso 2 de `deleteMyAccount`, como `service_role`— tiene que pasar al COMMIT y
-- dejar:
--   * las dos tarjetas EN PIE (anular no es borrar);
--   * T2 sin responsable y sin creador;
--   * la arista de colaboración de teo en T1, borrada;
--   * la dependencia de T2 sobre T1, intacta.
-- Si alguien cambia el SET NULL por una negativa, esto se pone rojo: es lo que
-- hace de la decisión 3 una decisión y no un efecto secundario.
SELECT set_config('qa.b133', pg_temp.al_commit_y_mira(
           format('DELETE FROM org_members WHERE organization_id = %L AND user_id = %L',
                  (SELECT org_t FROM h31), 'd0290000-0029-4029-8029-000000000a02'),
           'service_role',
           $sql$SELECT format('tarjetas=%s responsable=%s creador=%s colaboraciones=%s dependencias=%s',
                   (SELECT count(*) FROM board_cards
                     WHERE id IN ('d0290000-0029-4029-8029-000000000c01', 'd0290000-0029-4029-8029-000000000c02')),
                   (SELECT count(*) FROM board_cards
                     WHERE id = 'd0290000-0029-4029-8029-000000000c02' AND assignee_id IS NOT NULL),
                   (SELECT count(*) FROM board_cards
                     WHERE id = 'd0290000-0029-4029-8029-000000000c02' AND created_by IS NOT NULL),
                   (SELECT count(*) FROM board_card_collaborators
                     WHERE user_id = 'd0290000-0029-4029-8029-000000000a02'),
                   (SELECT count(*) FROM board_card_dependencies
                     WHERE card_id = 'd0290000-0029-4029-8029-000000000c02'))$sql$), true);

INSERT INTO defect_report
SELECT 133, 'la baja de un responsable no pasa, o borra la tarjeta en vez de anular',
       current_setting('qa.b133') <> 'paso; tarjetas=2 responsable=0 creador=0 colaboraciones=0 dependencias=1',
       CASE WHEN current_setting('qa.b133') = 'paso; tarjetas=2 responsable=0 creador=0 colaboraciones=0 dependencias=1'
            THEN 'la baja de teo pasó al COMMIT: las dos tarjetas siguen, T2 sin responsable ni creador, ' ||
                 'su colaboración se fue y la dependencia quedó'
            ELSE 'la baja de teo devolvió: ' || current_setting('qa.b133') END;

-- ── 134 ──────────────────────────────────────────────────────────────────────
-- APROBADA QUIERE DECIR FECHA Y PERSONA (decisión 5 de la `0029`). Una tarjeta
-- con fecha de aprobación y sin quien aprobó, y una con aprobador y sin fecha,
-- tienen que morir con 23514 nombrando el CHECK. Sin él, una aprobación sin
-- persona sería exactamente lo que la FK del aprobador no puede mirar: MATCH
-- SIMPLE deja pasar el NULL. El control positivo es el caso 3 del 122: con las
-- dos, y con un aprobador que es miembro, la tarjeta entra.
SELECT set_config('qa.b134a', pg_temp.al_commit(format(
           $sql$INSERT INTO board_cards (id, organization_id, product, objective, approved_at)
                VALUES ('d0290000-0029-4029-8029-000000000f01', %L, 'growth_os',
                        'QA aprobada sin persona', now())$sql$, (SELECT org_t FROM h31)), 'postgres'), true);
SELECT set_config('qa.b134b', pg_temp.al_commit(format(
           $sql$INSERT INTO board_cards (id, organization_id, product, objective, approved_by)
                VALUES ('d0290000-0029-4029-8029-000000000f02', %L, 'growth_os',
                        'QA aprobada sin fecha', 'd0290000-0029-4029-8029-000000000a01')$sql$,
           (SELECT org_t FROM h31)), 'postgres'), true);

INSERT INTO defect_report
SELECT 134, 'una tarjeta puede decir que está aprobada sin persona o sin fecha',
       NOT (a LIKE '23514 |%"board_cards_approval_is_complete"%'
            AND b LIKE '23514 |%"board_cards_approval_is_complete"%'),
       CASE WHEN a LIKE '23514 |%"board_cards_approval_is_complete"%'
                 AND b LIKE '23514 |%"board_cards_approval_is_complete"%'
            THEN 'las dos aprobaciones a medias mueren con 23514 en board_cards_approval_is_complete'
            ELSE 'sin persona: ' || a || ' / sin fecha: ' || b END
  FROM (SELECT current_setting('qa.b134a') AS a, current_setting('qa.b134b') AS b) x;

-- ── 135 ──────────────────────────────────────────────────────────────────────
-- LA REGLA DE LA DECISIÓN 4 DE LA `0029`, POR CATÁLOGO, PARA LA PRÓXIMA TABLA.
--
-- El 131 mide la baja de la organización con la fixture que hay. No ve una tabla
-- nueva del tablero cuya persona se NIEGUE si la fixture no la puebla con una
-- persona puesta —una FK con la columna en NULL no tiene nada que comprobar—, y
-- la anti-vacuidad del 126 obliga a poblar la tabla, no la columna. Eso lo dijo
-- una mutación: una nieta con `added_by` inmediata dejaba los 134 en verde.
--
-- Lo que sí se puede afirmar sin fixture es la causa. Toda FK de una tabla del
-- tablero contra `org_members` que se NIEGA (`NO ACTION` o `RESTRICT`) tiene que
-- estar en una tabla que cuelga DIRECTO de `organizations` con `ON DELETE
-- CASCADE` —entonces su cascada corre antes que la comprobación, decisión 4— o
-- ser `DEFERRABLE INITIALLY DEFERRED` —decisión 18 de la `0026`—. Una nieta con
-- una negativa inmediata traba la baja de la organización entera, y eso es lo que
-- este bloque nombra. El denominador son las FK de persona que se niegan, y se
-- imprime: hoy es una, la del aprobador, en una tabla hija directa.
CREATE TEMP TABLE h31_negativas ON COMMIT DROP AS
SELECT tb.relname, fk.conname,
       EXISTS (SELECT 1 FROM pg_constraint o
                WHERE o.conrelid = fk.conrelid AND o.contype = 'f'
                  AND o.confrelid = 'public.organizations'::regclass
                  AND o.confdeltype = 'c') AS hija_directa,
       fk.condeferrable AND fk.condeferred AS al_commit
  FROM pg_temp.tablero() tb
  JOIN pg_constraint fk ON fk.conrelid = tb.oid AND fk.contype = 'f'
 WHERE fk.confrelid = 'public.org_members'::regclass
   AND fk.confdeltype IN ('a', 'r');

INSERT INTO defect_report
SELECT 135, 'una persona que se niega en una nieta de la organización traba la baja de la organización',
       count(*) = 0 OR count(*) FILTER (WHERE NOT (hija_directa OR al_commit)) > 0,
       CASE WHEN count(*) = 0
            -- Anti-vacuidad, dentro del bloque y no como excepción: sin ninguna
            -- FK que se niegue, «todas cumplen» es cero sobre cero. Y en el
            -- informe y no cortando la corrida, para que la mutación que saca la
            -- negativa del aprobador muestre TAMBIÉN el rojo del 132, que es el
            -- que dice qué se perdió.
            THEN 'corrida vacua: ninguna FK de persona se niega en el tablero, y la decisión 3 de la 0029 dice que la del aprobador sí'
            WHEN count(*) FILTER (WHERE NOT (hija_directa OR al_commit)) = 0
            THEN count(*) || ' FK de persona que se niegan en el tablero, todas en una hija directa de ' ||
                 'organizations o al COMMIT: ' || string_agg(conname, ', ' ORDER BY conname)
            ELSE 'inmediatas en una tabla que no cuelga directo de organizations: ' ||
                 string_agg(relname || '.' || conname, ', ' ORDER BY conname)
                     FILTER (WHERE NOT (hija_directa OR al_commit))
            END
  FROM h31_negativas;

-- ─────────────────────────────────────────────────────────────────────────────
-- 136 a 143. La caché de PageSpeed, de cada organización y sólo del servidor —
-- CERRADO por la 0030
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDAN: que la lista de clientes no se pueda leer con la clave del bundle,
-- que nadie que no sea el servidor escriba lo que un reporte presenta como
-- medido por Google, y que la caché de una organización no conteste por otra.
--
-- Medido en producción el 2026-10-06, y ninguno de los 120 bloques de entonces
-- lo veía: el 10 sólo mira policies de ESCRITURA que aplican a PUBLIC —la `0005`
-- las había pasado a `authenticated`, así que daba verde—, y declaraba el SELECT
-- abierto de esta tabla como una decisión deliberada. Era la decisión
-- equivocada: la clave de la tabla es la URL del cliente. Y la escritura de
-- `authenticated` no protegía nada con el alta de cuentas abierta. Ver el
-- encabezado de la `0030`.
--
-- NUMERACIÓN: 121 a 135 son del tablero (`0029`, rama
-- `feat/el-tablero-nace-con-la-llave`), que se mergea antes que éstos. En una
-- base sin la `0029` el conteo de abajo es 128 y no 143; con las dos, 143.
--
-- CADA ROL SE MIDE DOS VECES, y las dos hacen falta. Por PRIVILEGIO, en el
-- catálogo, porque es lo que dice qué puede pasar mañana con una policy nueva.
-- Y por INTENTO, ejecutando como ese rol el SELECT, el upsert y el INSERT que
-- PostgREST haría, porque el catálogo dice qué privilegio hay y no qué pasa. El
-- intento se afirma por MENSAJE y no sólo por SQLSTATE: una policy que rechaza
-- una fila también da 42501 («new row violates row-level security policy»), y
-- eso sería la RLS conteniendo un privilegio que no tendría que estar — la
-- lección del bloque 54 con el Vault.
--
-- Y EL PRIVILEGIO ES DE TABLA Y DE COLUMNA. La primera versión de estos bloques
-- preguntaba con `has_table_privilege`, que mira sólo el nivel de tabla, y
-- leía `relacl` y no `attacl`. Medido el 2026-10-07: con un `GRANT INSERT (url,
-- strategy, result, fetched_at) ... TO anon, authenticated` los 126 de entonces
-- seguían en verde —el único intento era el upsert, que además pide UPDATE y
-- SELECT y moría igual en el privilegio—, y un INSERT plano como `anon` pasaba
-- el privilegio y lo frenaba recién la RLS. Por eso el catálogo se pregunta con
-- `has_any_column_privilege` donde existe, el intento incluye el INSERT plano, y
-- el 140 lee las dos ACL.
--
-- Y LA TABLA NO ES EL ÚNICO CAMINO. Una función SECURITY DEFINER o una vista
-- sobre esta tabla corren como su dueño, `postgres`, que tiene BYPASSRLS; y los
-- default privileges de `postgres` en `public` le dan EXECUTE y SELECT a `anon`
-- y `authenticated` en todo lo nuevo, sin un GRANT a mano. Medido el
-- 2026-10-07: con una función que lee la fila y otra que la upsertea, `anon`
-- leía el 91 y lo pisaba con un 3, y los 126 de entonces seguían en verde. Eso
-- es el 142.
--
-- FIXTURES PROPIAS: dos personas dadas de alta por el alta real
-- (`handle_new_user`), cada una con su organización. La del CLIENTE es dueña de
-- la fila de caché, escrita como `postgres` —el dueño, con BYPASSRLS en la
-- imagen de Supabase—. La RECIÉN REGISTRADA no tiene relación con ese cliente:
-- es exactamente quien hizo el envenenamiento medido. Los intentos de escritura
-- corren SIN HUELLA (ver `error_sin_huella`), así que la fila sigue diciendo 91
-- para el 141 y existiendo para el 143.

RESET ROLE;

INSERT INTO auth.users (id, email) VALUES
    ('d0300000-0030-4030-8030-000000000001', 'recien-registrada@example.test'),
    ('d0300000-0030-4030-8030-000000000002', 'cliente-de-la-agencia@example.test');

SELECT set_config('qa.psc_org_sonda', (SELECT organization_id::text FROM org_members
         WHERE user_id = 'd0300000-0030-4030-8030-000000000001' AND role = 'owner'), true);
SELECT set_config('qa.psc_org_cliente', (SELECT organization_id::text FROM org_members
         WHERE user_id = 'd0300000-0030-4030-8030-000000000002' AND role = 'owner'), true);

INSERT INTO public.pagespeed_cache (organization_id, url, strategy, result, fetched_at)
VALUES (current_setting('qa.psc_org_cliente')::uuid, 'https://cliente-de-la-agencia.example', 'mobile',
        '{"lcp": 2100, "inp": 180, "cls": 0.05, "lighthouseScore": 91, "fetchedAt": "2026-10-06T00:00:00.000Z"}',
        now());

-- Anti-vacuidad: un SELECT que «no ve nada» sobre una tabla vacía no mide un
-- cierre, una persona sin organización no es alguien recién registrado, y dos
-- personas en la misma organización no miden nada entre organizaciones.
DO $$
BEGIN
    IF (SELECT count(*) FROM public.pagespeed_cache
         WHERE url = 'https://cliente-de-la-agencia.example') <> 1 THEN
        RAISE EXCEPTION 'Vacuous run: la fixture de los bloques 136 a 143 no dejó UNA fila en la caché.';
    END IF;
    IF current_setting('qa.psc_org_sonda', true) IS NULL
       OR current_setting('qa.psc_org_cliente', true) IS NULL
       OR current_setting('qa.psc_org_sonda') = current_setting('qa.psc_org_cliente') THEN
        RAISE EXCEPTION 'Vacuous run: las dos personas de los bloques 136 a 143 no pasaron por el alta real, o comparten organización.';
    END IF;
END
$$;

-- Como `sqlstate_sin_huella()`, pero devuelve también el MENSAJE: acá dos
-- negativas distintas —privilegio y policy— comparten el 42501, y lo que se
-- afirma es cuál de las dos fue. NULL quiere decir «fue aceptada», y en ese caso
-- su efecto ya se deshizo.
CREATE OR REPLACE FUNCTION pg_temp.error_sin_huella(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION 'qa: deshacer el intento' USING ERRCODE = 'QA000';
    EXCEPTION WHEN SQLSTATE 'QA000' THEN
        RETURN NULL;
    END;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' | ' || SQLERRM;
END
$$;

-- Lo que PostgREST ejecuta con `GET /rest/v1/pagespeed_cache?select=url`, con
-- el upsert del orquestador viejo y con un INSERT a secas, armado como
-- `postgres` y viajando por un GUC como en los bloques 49 y 51: `anon` y
-- `authenticated` no escriben en `defect_report`, y darles ese permiso sería
-- ensancharles los privilegios a los roles que estos bloques miden.
--
-- El upsert pisa la fila del cliente con un 3 y un `fetched_at` en el año 2999:
-- la forma exacta del envenenamiento que, antes de la `0030`, quedaba «fresco»
-- para siempre. El INSERT es una URL que todavía no está en la caché, que es
-- el envenenamiento que no necesita UPDATE ni SELECT.
SELECT set_config('qa.psc_leer', 'SELECT count(*) FROM public.pagespeed_cache', true);
SELECT set_config('qa.psc_envenenar', format($s$
    INSERT INTO public.pagespeed_cache (organization_id, url, strategy, result, fetched_at)
    VALUES (%L, 'https://cliente-de-la-agencia.example', 'mobile',
            '{"lcp": 9999, "inp": 9999, "cls": 1, "lighthouseScore": 3, "fetchedAt": "2999-01-01T00:00:00.000Z"}',
            '2999-01-01T00:00:00Z')
    ON CONFLICT (organization_id, url, strategy) DO UPDATE
       SET result = EXCLUDED.result, fetched_at = EXCLUDED.fetched_at
$s$, current_setting('qa.psc_org_cliente')), true);
SELECT set_config('qa.psc_insertar', format($s$
    INSERT INTO public.pagespeed_cache (organization_id, url, strategy, result, fetched_at)
    VALUES (%L, 'https://nuevo-cliente.example', 'mobile', '{"lighthouseScore": 3}', now())
$s$, current_setting('qa.psc_org_cliente')), true);
SELECT set_config('qa.psc_denegado', '42501 | permission denied for table pagespeed_cache', true);

-- Los privilegios de escritura, uno por uno para que la evidencia diga cuál
-- sobra. REFERENCES, TRIGGER y MAINTAIN no escriben una fila, y están igual: la
-- `0030` revoca ALL, y un privilegio que nadie necesita es uno que no se deja.
CREATE TEMP TABLE psc_escritura (privilegio text) ON COMMIT DROP;
INSERT INTO psc_escritura VALUES
    ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN');

-- Los que sobran para un rol, de tabla o de columna. INSERT, UPDATE y
-- REFERENCES existen también por columna, y `has_any_column_privilege` los ve
-- en los dos niveles; los otros cuatro sólo existen por tabla. La evidencia dice
-- «por columna» cuando el de tabla no está.
CREATE OR REPLACE FUNCTION pg_temp.psc_sobran(p_rol text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT string_agg(privilegio ||
               CASE WHEN has_table_privilege(p_rol, 'public.pagespeed_cache', privilegio)
                    THEN '' ELSE ' por columna' END,
               ', ' ORDER BY privilegio)
      FROM psc_escritura
     WHERE has_table_privilege(p_rol, 'public.pagespeed_cache', privilegio)
        OR (privilegio IN ('INSERT', 'UPDATE', 'REFERENCES')
            AND has_any_column_privilege(p_rol, 'public.pagespeed_cache', privilegio));
$$;

-- ── 136 ──────────────────────────────────────────────────────────────────────
-- `anon` LEE la caché: la lista de clientes, con la clave del bundle y sin
-- sesión. Es el defecto 1 de la `0030`, el que se midió en producción.
SET LOCAL ROLE anon;
SELECT set_config('qa.b136', pg_temp.escalar(current_setting('qa.psc_leer')), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 136, 'anon puede leer la caché de PageSpeed, o sea la lista de clientes',
       has_any_column_privilege('anon', 'public.pagespeed_cache', 'SELECT')
         OR current_setting('qa.b136') <> 'ERROR ' || current_setting('qa.psc_denegado'),
       'privilegio SELECT de anon, de tabla o de alguna columna: ' ||
       has_any_column_privilege('anon', 'public.pagespeed_cache', 'SELECT')::text ||
       '; el SELECT como anon dio: ' || current_setting('qa.b136') ||
       ' (se espera ERROR ' || current_setting('qa.psc_denegado') || ')';

-- ── 137 ──────────────────────────────────────────────────────────────────────
-- `anon` ESCRIBE la caché. Cerrado desde la `0005` por privilegio; se vuelve a
-- medir porque la `0030` toca el mismo GRANT, y porque el intento es la única
-- forma de saber que no lo para una policy en vez del privilegio.
SET LOCAL ROLE anon;
SELECT set_config('qa.b137a',
       coalesce(pg_temp.error_sin_huella(current_setting('qa.psc_envenenar')), 'ACEPTADO'), true);
SELECT set_config('qa.b137b',
       coalesce(pg_temp.error_sin_huella(current_setting('qa.psc_insertar')), 'ACEPTADO'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 137, 'anon puede escribir la caché de PageSpeed',
       coalesce(sobran, '') <> ''
         OR current_setting('qa.b137a') <> current_setting('qa.psc_denegado')
         OR current_setting('qa.b137b') <> current_setting('qa.psc_denegado'),
       'privilegios de escritura de anon: [' || coalesce(sobran, '') ||
       ']; el upsert como anon dio: ' || current_setting('qa.b137a') ||
       '; el INSERT como anon dio: ' || current_setting('qa.b137b') ||
       ' (se espera ' || current_setting('qa.psc_denegado') || ' en los dos)'
  FROM (SELECT pg_temp.psc_sobran('anon') AS sobran) x;

-- ── 138 ──────────────────────────────────────────────────────────────────────
-- `authenticated` LEE la caché. Con el alta abierta, «tener sesión» es «tener
-- un correo»: lo mismo que el 136, con un paso más.
SELECT pg_temp.be('d0300000-0030-4030-8030-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b138', pg_temp.escalar(current_setting('qa.psc_leer')), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 138, 'una sesión cualquiera puede leer la caché de PageSpeed',
       has_any_column_privilege('authenticated', 'public.pagespeed_cache', 'SELECT')
         OR current_setting('qa.b138') <> 'ERROR ' || current_setting('qa.psc_denegado'),
       'privilegio SELECT de authenticated, de tabla o de alguna columna: ' ||
       has_any_column_privilege('authenticated', 'public.pagespeed_cache', 'SELECT')::text ||
       '; el SELECT de una persona recién registrada dio: ' || current_setting('qa.b138') ||
       ' (se espera ERROR ' || current_setting('qa.psc_denegado') || ')';

-- ── 139 ──────────────────────────────────────────────────────────────────────
-- `authenticated` ESCRIBE la caché: el envenenamiento, ejecutado. Una persona
-- recién registrada upsertea un 3 de Lighthouse, con fecha del año 2999, en la
-- fila de un cliente que no es suyo, e inserta una URL nueva a nombre de esa
-- organización; con la `0005`, entraba y se servía en el reporte del cliente.
SELECT pg_temp.be('d0300000-0030-4030-8030-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('qa.b139a',
       coalesce(pg_temp.error_sin_huella(current_setting('qa.psc_envenenar')), 'ACEPTADO'), true);
SELECT set_config('qa.b139b',
       coalesce(pg_temp.error_sin_huella(current_setting('qa.psc_insertar')), 'ACEPTADO'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 139, 'una sesión cualquiera puede escribir el resultado de PageSpeed del reporte de otro',
       coalesce(sobran, '') <> ''
         OR current_setting('qa.b139a') <> current_setting('qa.psc_denegado')
         OR current_setting('qa.b139b') <> current_setting('qa.psc_denegado'),
       'privilegios de escritura de authenticated: [' || coalesce(sobran, '') ||
       ']; el upsert de una persona recién registrada sobre la fila de un cliente dio: ' ||
       current_setting('qa.b139a') || '; su INSERT dio: ' || current_setting('qa.b139b') ||
       ' (se espera ' || current_setting('qa.psc_denegado') || ' en los dos)'
  FROM (SELECT pg_temp.psc_sobran('authenticated') AS sobran) x;

-- ── 140 ──────────────────────────────────────────────────────────────────────
-- LA SEGUNDA CAPA, por catálogo. Del 136 al 139 los para el privilegio; esto es
-- lo que los sigue parando el día que alguien devuelva un GRANT —los default
-- privileges de Supabase lo hacen solos en cada tabla nueva, y un `GRANT ... ON
-- ALL TABLES` como el de la `0010` lo haría con ésta—:
--
--   * ninguna policy de la tabla alcanza a PUBLIC, `anon` o `authenticated`
--     (con RLS y sin policy, un GRANT devuelto da cero filas y no una fuga);
--   * la RLS sigue ENABLE y FORCE;
--   * PUBLIC, `anon`, `authenticated` y `growthos_app` no tienen ningún
--     privilegio, ni en la tabla (`relacl`) ni en una columna (`attacl`). El
--     último es el rol con el que la suite hace de aplicación: si `app_role.sql`
--     dejara de revocárselo, mediría una sesión más laxa que la de producción.
--
-- Cada condición pone el bloque en rojo por sí sola, y la evidencia dice cuál.
INSERT INTO defect_report
SELECT 140, 'algo que no es el servidor sigue alcanzando la caché de PageSpeed por policy, RLS o privilegio',
       coalesce(policies, '') <> '' OR NOT (rls AND forzada) OR coalesce(acl, '') <> ''
         OR coalesce(columnas, '') <> '',
       'policies para PUBLIC/anon/authenticated: [' || coalesce(policies, '') ||
       ']; RLS enable=' || rls || ' force=' || forzada ||
       '; privilegios de tabla de PUBLIC, anon, authenticated o growthos_app: [' || coalesce(acl, '') ||
       ']; de columna: [' || coalesce(columnas, '') || ']'
  FROM (SELECT
          (SELECT string_agg(p.polname, ', ' ORDER BY p.polname)
             FROM pg_policy p
            WHERE p.polrelid = 'public.pagespeed_cache'::regclass
              AND (p.polroles && ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid])) AS policies,
          c.relrowsecurity AS rls,
          c.relforcerowsecurity AS forzada,
          (SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
                             || ' ' || a.privilege_type, ', ' ORDER BY a.grantee, a.privilege_type)
             FROM aclexplode(c.relacl) a
            WHERE a.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid,
                                'growthos_app'::regrole::oid)) AS acl,
          (SELECT string_agg(t.attname || ' ' ||
                             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
                             || ' ' || a.privilege_type, ', ' ORDER BY t.attname, a.grantee, a.privilege_type)
             FROM pg_attribute t, LATERAL aclexplode(t.attacl) a
            WHERE t.attrelid = c.oid AND t.attnum > 0 AND NOT t.attisdropped
              AND a.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid,
                                'growthos_app'::regrole::oid)) AS columnas
          FROM pg_class c
         WHERE c.oid = 'public.pagespeed_cache'::regclass) x;

-- ── 141 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO: `service_role` —el rol de `createSupabaseAdminClient`,
-- con el que el orquestador lee y escribe desde la `0030`— lee la fila del
-- cliente, la upsertea por el camino del conflicto de la clave nueva (que pide
-- SELECT, INSERT y UPDATE), guarda la MISMA URL para OTRA organización sin
-- chocar —eso es la clave por organización, y con la vieja `(url, strategy)`
-- muere con 23505— y la puede borrar. Sin este bloque, una migración que
-- cerrara la tabla también para el servidor pondría del 136 al 140 en verde con
-- la caché muerta: cada reporte volvería a gastar cuota de Google, y nada lo
-- diría.
SET LOCAL ROLE service_role;
SELECT set_config('qa.b141a', pg_temp.escalar(format($s$
    SELECT result->>'lighthouseScore' FROM public.pagespeed_cache
     WHERE organization_id = %L AND url = 'https://cliente-de-la-agencia.example' AND strategy = 'mobile'
$s$, current_setting('qa.psc_org_cliente'))), true);
SELECT set_config('qa.b141b', coalesce(pg_temp.error_sin_huella(format($s$
    INSERT INTO public.pagespeed_cache (organization_id, url, strategy, result, fetched_at)
    VALUES (%L, 'https://cliente-de-la-agencia.example', 'mobile', '{"lighthouseScore": 92}', now())
    ON CONFLICT (organization_id, url, strategy) DO UPDATE
       SET result = EXCLUDED.result, fetched_at = EXCLUDED.fetched_at
$s$, current_setting('qa.psc_org_cliente'))), 'ACEPTADO'), true);
SELECT set_config('qa.b141c', coalesce(pg_temp.error_sin_huella(format($s$
    INSERT INTO public.pagespeed_cache (organization_id, url, strategy, result, fetched_at)
    VALUES (%L, 'https://cliente-de-la-agencia.example', 'mobile', '{"lighthouseScore": 40}', now())
$s$, current_setting('qa.psc_org_sonda'))), 'ACEPTADO'), true);
SELECT set_config('qa.b141d', coalesce(pg_temp.error_sin_huella(format($s$
    DELETE FROM public.pagespeed_cache WHERE organization_id = %L
$s$, current_setting('qa.psc_org_cliente'))), 'ACEPTADO'), true);
RESET ROLE;

INSERT INTO defect_report
SELECT 141, 'el servidor no puede leer, escribir por organización o purgar la caché de PageSpeed',
       NOT (current_setting('qa.b141a') = '91'
            AND current_setting('qa.b141b') = 'ACEPTADO'
            AND current_setting('qa.b141c') = 'ACEPTADO'
            AND current_setting('qa.b141d') = 'ACEPTADO'),
       'service_role leyendo la fila del cliente dio: ' || current_setting('qa.b141a') ||
       ' (se espera 91); su upsert por (organization_id, url, strategy) dio: ' || current_setting('qa.b141b') ||
       '; la misma URL para otra organización dio: ' || current_setting('qa.b141c') ||
       '; su DELETE dio: ' || current_setting('qa.b141d') || ' (se esperan los tres ACEPTADO)';

-- ── 142 ──────────────────────────────────────────────────────────────────────
-- NADA MÁS EN LA BASE ALCANZA LA TABLA. Del 136 al 140 miran la tabla; esto
-- mira lo que podría llegar a ella sin pasar por sus privilegios:
--
--   * una VISTA o una REGLA cuya reescritura la nombra: corre como su dueño,
--     y `postgres` tiene BYPASSRLS, así que el FORCE tampoco la frena;
--   * una FUNCIÓN que la nombra, por texto (`prosrc`) o por dependencia (un
--     cuerpo `BEGIN ATOMIC` no deja texto, deja `pg_depend`). Cualquier
--     función y no sólo las SECURITY DEFINER: una INVOKER llamada desde una
--     DEFINER que no nombra la tabla corre con los privilegios de la de afuera;
--   * una FK de otra tabla que la referencia: el chequeo de la FK corre como
--     el dueño, y un INSERT en la otra tabla contesta si la fila existe.
--
-- Hoy no hay ninguno de los cuatro (medido el 2026-10-07: `pg_rewrite` sin
-- nada que dependa de la tabla, y ningún `prosrc` con «pagespeed»). La caché la
-- toca el orquestador por PostgREST con `service_role`, y nada en la base tiene
-- por qué nombrarla. Lo que NO ve: SQL dinámico que arme el nombre por partes
-- (`'pagespeed' || '_cache'`). Eso no lo ve ningún catálogo.
--
-- Las funciones de `pg_temp` quedan fuera —las de este archivo nombran la
-- tabla— y las de una extensión también: no son de este repositorio.
CREATE OR REPLACE FUNCTION pg_temp.psc_caminos() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT string_agg(camino, '; ' ORDER BY camino) FROM (
        SELECT DISTINCT 'relación ' || r.ev_class::regclass::text AS camino
          FROM pg_depend d
          JOIN pg_rewrite r ON r.oid = d.objid
         WHERE d.classid = 'pg_rewrite'::regclass
           AND d.refclassid = 'pg_class'::regclass
           AND d.refobjid = 'public.pagespeed_cache'::regclass
           AND r.ev_class <> 'public.pagespeed_cache'::regclass
        UNION
        SELECT DISTINCT 'función ' || p.oid::regprocedure::text
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND n.nspname NOT LIKE 'pg_temp%'
           AND NOT EXISTS (SELECT 1 FROM pg_depend e
                            WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e')
           AND (p.prosrc ILIKE '%pagespeed_cache%'
                OR EXISTS (SELECT 1 FROM pg_depend d
                            WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                              AND d.refclassid = 'pg_class'::regclass
                              AND d.refobjid = 'public.pagespeed_cache'::regclass))
        UNION
        SELECT 'FK ' || co.conrelid::regclass::text || '.' || co.conname
          FROM pg_constraint co
         WHERE co.contype = 'f'
           AND co.confrelid = 'public.pagespeed_cache'::regclass
           AND co.conrelid <> 'public.pagespeed_cache'::regclass
    ) x;
$$;

-- EL CONTROL DEL DETECTOR. Cero caminos sobre una consulta que no sabe
-- encontrarlos no mide nada, así que acá se arman los cuatro —una función de
-- texto, una `BEGIN ATOMIC`, una vista y una FK— en una subtransacción que se
-- deshace, y el detector los tiene que nombrar a los cuatro. La FK se arma
-- sobre la clave primaria que la tabla TENGA, leída del catálogo: si no, un
-- cambio de clave abortaría el archivo acá en vez de ponerse rojo donde se mide.
DO $$
DECLARE
    clave  text;
    vistos text;
BEGIN
    BEGIN
        SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) INTO clave
          FROM pg_constraint c,
               unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = 'public.pagespeed_cache'::regclass AND a.attnum = k.attnum
         WHERE c.conrelid = 'public.pagespeed_cache'::regclass AND c.contype = 'p';

        EXECUTE $f$CREATE FUNCTION public.qa_psc_leer(p_url text) RETURNS jsonb
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
            AS 'SELECT result FROM public.pagespeed_cache WHERE url = p_url'$f$;
        EXECUTE $f$CREATE FUNCTION public.qa_psc_contar() RETURNS bigint
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
            BEGIN ATOMIC SELECT count(*) FROM public.pagespeed_cache; END$f$;
        EXECUTE 'CREATE VIEW public.qa_psc_sitios AS SELECT url FROM public.pagespeed_cache';
        EXECUTE format('CREATE TABLE public.qa_psc_sonda AS SELECT %s FROM public.pagespeed_cache WITH NO DATA', clave);
        EXECUTE format('ALTER TABLE public.qa_psc_sonda ADD CONSTRAINT qa_psc_sonda_fkey
                            FOREIGN KEY (%s) REFERENCES public.pagespeed_cache (%s)', clave, clave);

        vistos := pg_temp.psc_caminos();
        RAISE EXCEPTION 'qa: deshacer el control' USING ERRCODE = 'QA000';
    EXCEPTION WHEN SQLSTATE 'QA000' THEN
        NULL;
    END;
    PERFORM set_config('qa.b142_control', coalesce(vistos, ''), true);
END
$$;

INSERT INTO defect_report
SELECT 142, 'una vista, regla, función o FK de otra tabla alcanza la caché de PageSpeed sin pasar por sus privilegios',
       coalesce(caminos, '') <> '' OR control <> esperado,
       'caminos hacia la tabla: [' || coalesce(caminos, '') ||
       ']; el detector, con cuatro caminos armados a propósito, vio: [' || control ||
       '] (se espera [' || esperado || '])'
  FROM (SELECT pg_temp.psc_caminos() AS caminos,
               current_setting('qa.b142_control') AS control,
               'FK qa_psc_sonda.qa_psc_sonda_fkey; función qa_psc_contar(); ' ||
               'función qa_psc_leer(text); relación qa_psc_sitios' AS esperado) x;

-- ── 143 ──────────────────────────────────────────────────────────────────────
-- LA BAJA DE UN CLIENTE SE LLEVA SUS URLs. Hasta la `0030` la tabla no tenía
-- organización, así que la baja de un cliente dejaba su web en la caché para
-- siempre: en la tabla que `anon` leía. La FK con cascada es la que lo impide,
-- y esto la mide por su efecto, con la misma baja del 118: la organización del
-- cliente, borrada como `service_role`, tiene que pasar al COMMIT sin dejar
-- nada en ninguna tabla con `organization_id`.
--
-- Anti-vacuidad: la organización tiene que tener SU fila en la caché antes de
-- la baja; sin ella, «no quedó nada» no mediría la cascada.
SELECT set_config('qa.b143', pg_temp.al_commit(
           format('DELETE FROM organizations WHERE id = %L', current_setting('qa.psc_org_cliente')),
           'service_role', current_setting('qa.psc_org_cliente')::uuid), true);

INSERT INTO defect_report
SELECT 143, 'la baja de una organización deja sus URLs en la caché de PageSpeed, o no se puede dar',
       NOT (resultado ~ '^paso; [0-9]+ tablas; quedaron: \[\]$' AND tenia = 1),
       'la organización del cliente tenía ' || tenia || ' fila(s) en la caché (se espera 1); ' ||
       'su baja como service_role devolvió: ' || resultado
  FROM (SELECT current_setting('qa.b143') AS resultado,
               (SELECT count(*) FROM public.pagespeed_cache
                 WHERE organization_id = current_setting('qa.psc_org_cliente')::uuid) AS tenia) x;

RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 200 a 213. El rol de cliente no es cosmético — CERRADO por la 0031 (H4.1)
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CUIDAN: la puerta H4.1. Un usuario con rol `client` en la organización X,
-- autenticado de verdad (`SET ROLE authenticated` y el GUC del uid, como los
-- bloques 45, 88 y 89: las policies corren tal como están escritas), VE los
-- datos de X; y las tres acciones prohibidas —leer otra organización, modificar
-- integraciones, aprobar— dejan CERO filas cambiadas por PostgREST.
--
-- Medido en hosted el 2026-10-07: las `*_rw_member` de la 0001/0004 son FOR ALL
-- y no miran el rol. Antes de la 0031 un `viewer` —y un `client`, si el CHECK lo
-- hubiera dejado entrar— escribía y borraba todo lo de su organización.
--
-- LA CORRECCIÓN DEL CRÍTICO, que es la forma de estos bloques: cada negativa se
-- mide con el client EN LA MISMA ORGANIZACIÓN donde el manager SÍ puede. La
-- MISMA sentencia corre con los dos —y con el viewer, el editor y el owner— y se
-- compara. Una negativa que sólo se observa desde otra organización mide el
-- tenant, no el rol.
--
-- EL DENOMINADOR SALE DEL CATÁLOGO: toda tabla de `public` con
-- `organization_id` y RLS, la misma consulta que usa la 0031. Ninguna lista a
-- mano decide qué se mide. Y qué es interno lo decide `is_internal_surface()`,
-- el lugar único de la 0031; el bloque 208 fija esa lista contra D2, porque si
-- la suite le creyera a la función sin más, sacar una tabla de la lista
-- convertiría «el client ve lo interno» en «es de cara al cliente» y todo
-- quedaría en verde.
--
-- CÓMO SE MIDE UNA ESCRITURA SIN DEJAR HUELLA: `h41_como()` corre la sentencia
-- como `authenticated` con el uid puesto, dentro de una subtransacción que
-- siempre se deshace, y devuelve `n=<filas>` o `ERR <sqlstate> <motivo>`. El
-- motivo distingue el 42501 de la RLS (`rls`: «new row violates row-level
-- security policy») del 42501 del privilegio (`priv`: «permission denied for
-- table»), que comparten código y no son la misma negativa.
--
-- LAS SENTENCIAS SON GENÉRICAS, armadas del catálogo sobre la PRIMERA fila de X
-- por id de cada tabla: un UPDATE que no cambia nada (`SET organization_id =
-- organization_id`, que igual cuenta la fila), un DELETE de esa fila y un
-- INSERT de una copia con id nuevo. La copia le agrega `-copia` a las columnas
-- de texto que integran una única; la única excepción escrita es
-- `org_members.user_id`, que va a una usuaria sin membresía en X (la única es
-- `(organization_id, user_id)` y un uuid no se puede «sufijar»). La fixture está
-- armada para que la primera fila por id sea una HOJA: el negocio que se
-- copia, actualiza y borra no tiene hijos, y el asset es el borrador.
--
-- QUÉ ES «ESCRIBIBLE POR SESIÓN», TAMBIÉN DEL CATÁLOGO: `authenticated` tiene
-- el privilegio del verbo Y hay una permisiva para ese comando. Son los pares
-- (tabla, verbo) donde el rol es lo ÚNICO que separa al client del manager, y
-- ahí el 205 exige que el manager cambie la fila. En los demás —sin privilegio,
-- como `publications` o la ficha; o sin permisiva, como el UPDATE de
-- `activity_logs`— nadie escribe por sesión desde antes, la negativa del client
-- es de diseño previo, y el rol se mide POR RUTA (vitest). En `org_members` la
-- permisiva es sólo de owner y admin desde la 0013, y la contraprueba es el
-- owner.
--
-- FIXTURES PROPIAS: X es la organización de omar (owner, alta real de
-- `handle_new_user`) con marta (manager), eva (editor), vito (viewer), clara
-- (client) y arturo (manager ARCHIVADO); Y es la de yago. Cada tabla del
-- catálogo tiene filas en X y en Y. Se cargan como `postgres`.
--
-- TRES CLASES DE TABLA, todas del catálogo: «de cara al cliente» (la sesión la
-- alcanza y no es interna), «interna» (`is_internal_surface()`) y «sólo
-- servidor» (ninguna permisiva para PUBLIC, `anon` o `authenticated`: hoy
-- `pagespeed_cache`, de la 0030). La tercera no lleva eje —ver el encabezado de
-- la 0031— y ahí se mide que NADIE de la sesión la lea ni la escriba, el client
-- incluido.
--
-- Y SI APARECE UNA TABLA NUEVA, el anti-vacío de abajo se pone ROJO hasta que
-- esta fixture tenga una fila suya en X y en Y. Es a propósito: un eje que nadie
-- ejecutó es una afirmación. Pasó con `board_*` (0029) y `pagespeed_cache`
-- (0030), que entraron a `main` mientras esto estaba abierto: la suite los
-- encontró sin filas y los nombró.
--
-- LAS TABLAS SIN `id`. `board_card_collaborators`, `board_card_dependencies` y
-- `pagespeed_cache` tienen una clave primaria compuesta, así que la fila fuente
-- se elige y se nombra por su CLAVE PRIMARIA, leída del catálogo, y no por `id`.
-- La copia del INSERT conserva esa clave y chocaría con la fila fuente (23505);
-- hoy no llega a chocar porque `authenticated` no tiene INSERT en ninguna de las
-- tres y el privilegio se mira antes. El día que alguien se lo dé, el 205 pide
-- que el manager inserte, recibe el 23505 y se pone rojo: es el aviso para
-- escribir la copia de esa tabla a mano.

RESET ROLE;

CREATE OR REPLACE FUNCTION pg_temp.h41_id(p_n int, p_k int) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
    SELECT format('c4100000-0031-4031-8031-%s%s', p_n, lpad(p_k::text, 11, '0'))::uuid;
$$;

INSERT INTO auth.users (id, email) VALUES
    (pg_temp.h41_id(0, 1), 'omar.h41@example.test'),
    (pg_temp.h41_id(0, 2), 'marta.h41@example.test'),
    (pg_temp.h41_id(0, 3), 'eva.h41@example.test'),
    (pg_temp.h41_id(0, 4), 'vito.h41@example.test'),
    (pg_temp.h41_id(0, 5), 'clara.h41@example.test'),
    (pg_temp.h41_id(0, 6), 'yago.h41@example.test'),
    (pg_temp.h41_id(0, 7), 'sin-membresia.h41@example.test'),
    (pg_temp.h41_id(0, 8), 'arturo.h41@example.test');

CREATE TEMP TABLE h41 AS
SELECT (SELECT organization_id FROM org_members
         WHERE user_id = pg_temp.h41_id(0, 1) AND role = 'owner') AS x,
       (SELECT organization_id FROM org_members
         WHERE user_id = pg_temp.h41_id(0, 6) AND role = 'owner') AS y;

INSERT INTO org_members (organization_id, user_id, role, state)
SELECT x, pg_temp.h41_id(0, 2), 'manager', 'active'  FROM h41 UNION ALL
SELECT x, pg_temp.h41_id(0, 3), 'editor',  'active'  FROM h41 UNION ALL
SELECT x, pg_temp.h41_id(0, 4), 'viewer',  'active'  FROM h41 UNION ALL
SELECT x, pg_temp.h41_id(0, 5), 'client',  'active'  FROM h41 UNION ALL
SELECT x, pg_temp.h41_id(0, 8), 'manager', 'archived' FROM h41;

-- Quiénes miden, con su uid.
CREATE TEMP TABLE h41_actores (actor text PRIMARY KEY, uid uuid NOT NULL);
INSERT INTO h41_actores VALUES
    ('client',  pg_temp.h41_id(0, 5)),
    ('viewer',  pg_temp.h41_id(0, 4)),
    ('editor',  pg_temp.h41_id(0, 3)),
    ('manager', pg_temp.h41_id(0, 2)),
    ('owner',   pg_temp.h41_id(0, 1));

-- Una fila de cada tabla del catálogo en X (n = 1) y en Y (n = 2). El orden de
-- los ids importa: k = 1 es el negocio HOJA, que es el primero por id y el que
-- las sentencias genéricas tocan; k = 2 es el negocio del que cuelga todo lo
-- demás. Lo mismo el asset: k = 10 es el borrador, k = 11 el aprobado.
DO $$
DECLARE
    o       record;
    dueno   uuid;
    secreto uuid;
BEGIN
    FOR o IN SELECT 1 AS n, x AS org FROM h41 UNION ALL SELECT 2, y FROM h41 LOOP
        dueno := CASE o.n WHEN 1 THEN pg_temp.h41_id(0, 1) ELSE pg_temp.h41_id(0, 6) END;

        INSERT INTO businesses (id, organization_id, name)
        VALUES (pg_temp.h41_id(o.n, 1), o.org, 'Hoja H41 ' || o.n),
               (pg_temp.h41_id(o.n, 2), o.org, 'Negocio H41 ' || o.n);
        INSERT INTO business_locations (id, organization_id, business_id, label, is_primary)
        VALUES (pg_temp.h41_id(o.n, 3), o.org, pg_temp.h41_id(o.n, 2), 'Local H41', false);
        INSERT INTO business_services (id, organization_id, business_id, slug, name)
        VALUES (pg_temp.h41_id(o.n, 4), o.org, pg_temp.h41_id(o.n, 2), 'h41-servicio', 'Servicio H41');
        INSERT INTO competitors (id, organization_id, business_id, name)
        VALUES (pg_temp.h41_id(o.n, 5), o.org, pg_temp.h41_id(o.n, 2), 'Rival H41');
        INSERT INTO reviews (id, organization_id, business_id, author, rating, text)
        VALUES (pg_temp.h41_id(o.n, 6), o.org, pg_temp.h41_id(o.n, 2), 'Autora H41', 5, 'Muy bien');
        INSERT INTO campaigns (id, organization_id, business_id, name)
        VALUES (pg_temp.h41_id(o.n, 7), o.org, pg_temp.h41_id(o.n, 2), 'Campaña H41');
        INSERT INTO platform_tasks (id, organization_id, business_id, title)
        VALUES (pg_temp.h41_id(o.n, 8), o.org, pg_temp.h41_id(o.n, 2), 'Tarea interna H41');
        INSERT INTO reports (id, organization_id, business_id, title)
        VALUES (pg_temp.h41_id(o.n, 9), o.org, pg_temp.h41_id(o.n, 2), 'Reporte H41');
        INSERT INTO content_assets (id, organization_id, business_id, kind, body)
        VALUES (pg_temp.h41_id(o.n, 10), o.org, pg_temp.h41_id(o.n, 2), 'post', 'Borrador H41'),
               (pg_temp.h41_id(o.n, 11), o.org, pg_temp.h41_id(o.n, 2), 'post', 'Aprobado H41');
        UPDATE content_assets
           SET status = 'approved', approved_hash = payload_hash,
               approved_by = dueno, approved_at = now()
         WHERE id = pg_temp.h41_id(o.n, 11);
        INSERT INTO social_image_assets (id, organization_id, business_id, platform, aspect_ratio,
                                         prompt, caption, image_url)
        VALUES (pg_temp.h41_id(o.n, 12), o.org, pg_temp.h41_id(o.n, 2), 'linkedin', '1:1',
                'prompt', 'caption', 'https://h41.example/img.png');
        INSERT INTO agent_runs (id, organization_id, business_id, agent_id, scope, scope_id)
        VALUES (pg_temp.h41_id(o.n, 13), o.org, pg_temp.h41_id(o.n, 2), 'seo-agent', 'business', 'h41');
        INSERT INTO activity_logs (id, organization_id, scope, scope_id, action)
        VALUES (pg_temp.h41_id(o.n, 14), o.org, 'business', 'h41', 'h41.accion');
        INSERT INTO contacts (id, organization_id, business_id, display_name)
        VALUES (pg_temp.h41_id(o.n, 15), o.org, pg_temp.h41_id(o.n, 2), 'Contacto H41');
        INSERT INTO aeo_audits (id, organization_id, business_id, url, robots_leido, acceso,
                                caracteres_sin_js, schema_encontrado, llms_txt)
        VALUES (pg_temp.h41_id(o.n, 16), o.org, pg_temp.h41_id(o.n, 2), 'https://h41.example/',
                true, '{}'::jsonb, 0, '{}'::jsonb, false);
        INSERT INTO company_profiles (id, organization_id, business_id, version)
        VALUES (pg_temp.h41_id(o.n, 17), o.org, pg_temp.h41_id(o.n, 2), 1);
        INSERT INTO profile_offers (id, organization_id, profile_id, name)
        VALUES (pg_temp.h41_id(o.n, 18), o.org, pg_temp.h41_id(o.n, 17), 'Oferta H41');
        INSERT INTO profile_markets (id, organization_id, profile_id, country)
        VALUES (pg_temp.h41_id(o.n, 19), o.org, pg_temp.h41_id(o.n, 17), 'SE');
        INSERT INTO profile_segments (id, organization_id, profile_id, name)
        VALUES (pg_temp.h41_id(o.n, 20), o.org, pg_temp.h41_id(o.n, 17), 'Segmento H41');
        INSERT INTO profile_competitors (id, organization_id, profile_id, name)
        VALUES (pg_temp.h41_id(o.n, 21), o.org, pg_temp.h41_id(o.n, 17), 'Rival curado H41');
        INSERT INTO profile_icp (id, organization_id, profile_id, definition)
        VALUES (pg_temp.h41_id(o.n, 22), o.org, pg_temp.h41_id(o.n, 17), 'ICP H41');
        INSERT INTO profile_objectives (id, organization_id, profile_id, statement, kind)
        VALUES (pg_temp.h41_id(o.n, 23), o.org, pg_temp.h41_id(o.n, 17), 'Objetivo H41', 'goal');
        INSERT INTO profile_evidence (id, organization_id, objective_id, kind, url)
        VALUES (pg_temp.h41_id(o.n, 24), o.org, pg_temp.h41_id(o.n, 23), 'http', 'https://h41.example/evidencia');
        INSERT INTO integration_probe (id, organization_id, provider, outcome)
        VALUES (pg_temp.h41_id(o.n, 25), o.org, 'ga4', 'ok');
        INSERT INTO integration_properties (id, organization_id, provider, property_ref)
        VALUES (pg_temp.h41_id(o.n, 26), o.org, 'ga4', 'properties/3100310' || o.n);
        secreto := vault.create_secret('ya29.H41-NO-ES-UN-TOKEN-' || o.n, 'h41/' || o.n, 'fixture H4.1');
        INSERT INTO integration_tokens (id, organization_id, provider, secret_id, expires_at)
        VALUES (pg_temp.h41_id(o.n, 27), o.org, 'google', secreto, now() + interval '30 days');
        INSERT INTO publications (id, organization_id, asset_id, approved_hash, destination)
        SELECT pg_temp.h41_id(o.n, 28), o.org, id, approved_hash, 'google_business_profile'
          FROM content_assets WHERE id = pg_temp.h41_id(o.n, 11);
        -- Un segundo aprobado, SIN publicación: el 212 lo edita. El de k = 11 no
        -- sirve para eso, porque la FK de la 0016 contra `(id, approved_hash)`
        -- impide soltarle el sello mientras haya una publicación que lo cite.
        INSERT INTO content_assets (id, organization_id, business_id, kind, body)
        VALUES (pg_temp.h41_id(o.n, 29), o.org, pg_temp.h41_id(o.n, 2), 'post', 'Aprobado sin publicar H41');
        UPDATE content_assets
           SET status = 'approved', approved_hash = payload_hash,
               approved_by = dueno, approved_at = now()
         WHERE id = pg_temp.h41_id(o.n, 29);

        -- El tablero de la 0029. k = 30 es la tarjeta HOJA —la primera por id, la
        -- que tocan las sentencias genéricas—; de k = 31 cuelgan el colaborador,
        -- la dependencia (contra k = 32) y la fuente. El colaborador tiene que
        -- ser miembro de la organización (FK por el par): marta en X, yago en Y.
        INSERT INTO board_cards (id, organization_id, product, objective)
        VALUES (pg_temp.h41_id(o.n, 30), o.org, 'growth_os', 'Hoja H41'),
               (pg_temp.h41_id(o.n, 31), o.org, 'growth_os', 'Tarjeta H41'),
               (pg_temp.h41_id(o.n, 32), o.org, 'growth_os', 'Dependida H41');
        INSERT INTO board_card_collaborators (organization_id, card_id, user_id)
        VALUES (o.org, pg_temp.h41_id(o.n, 31),
                CASE o.n WHEN 1 THEN pg_temp.h41_id(0, 2) ELSE pg_temp.h41_id(0, 6) END);
        INSERT INTO board_card_dependencies (organization_id, card_id, depends_on_card_id)
        VALUES (o.org, pg_temp.h41_id(o.n, 31), pg_temp.h41_id(o.n, 32));
        INSERT INTO board_card_sources (id, organization_id, card_id, url, title)
        VALUES (pg_temp.h41_id(o.n, 33), o.org, pg_temp.h41_id(o.n, 31), 'https://h41.example/fuente', 'Fuente H41');

        -- La caché de PageSpeed de la 0030, sólo del servidor. `postgres` la
        -- escribe porque tiene BYPASSRLS en la imagen de Supabase, como en hosted.
        INSERT INTO pagespeed_cache (organization_id, url, strategy, result)
        VALUES (o.org, 'https://h41.example/', 'mobile', '{"lighthouseScore": 41}'::jsonb);
    END LOOP;
END
$$;

-- Corre `p_sql` como `authenticated` con el uid puesto, y lo DESHACE. Con
-- `p_modo = 'cuenta'` devuelve el escalar que la consulta devuelve; si no, las
-- filas que la sentencia tocó. Ver el encabezado del bloque.
CREATE OR REPLACE FUNCTION pg_temp.h41_como(p_uid uuid, p_sql text, p_modo text DEFAULT 'efecto')
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    n      bigint;
    salida text;
BEGIN
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        IF p_modo = 'cuenta' THEN
            EXECUTE p_sql INTO n;
        ELSE
            EXECUTE p_sql;
            GET DIAGNOSTICS n = ROW_COUNT;
        END IF;
        RESET ROLE;
        salida := 'n=' || n;
        RAISE EXCEPTION 'qa: deshacer la medición' USING ERRCODE = 'QA000';
    EXCEPTION WHEN SQLSTATE 'QA000' THEN
        RETURN salida;
    END;
EXCEPTION WHEN OTHERS THEN
    RETURN 'ERR ' || SQLSTATE || ' ' ||
           CASE WHEN SQLERRM LIKE 'new row violates row-level security policy%' THEN 'rls'
                WHEN SQLERRM LIKE 'permission denied for table%'                 THEN 'priv'
                ELSE left(SQLERRM, 160) END;
END
$$;

-- El denominador: la MISMA consulta de catálogo que la 0031, con la clase de
-- cada tabla. «Sólo servidor» se lee del catálogo, igual que en la 0031: ninguna
-- permisiva para una sesión.
CREATE TEMP TABLE h41_tablas AS
SELECT x.tabla,
       x.clase,
       x.clase = 'interna'  AS interna,
       x.clase = 'servidor' AS servidor
  FROM (SELECT c.relname::text AS tabla,
               CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policy p
                                      WHERE p.polrelid = c.oid AND p.polpermissive
                                        AND p.polroles && ARRAY[0::oid, 'anon'::regrole::oid,
                                                                'authenticated'::regrole::oid])
                         THEN 'servidor'
                    WHEN public.is_internal_surface(c.relname) THEN 'interna'
                    ELSE 'cliente' END AS clase
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
         WHERE c.relkind IN ('r', 'p')
           AND c.relrowsecurity) x;

-- Anti-vacío de la fixture: cada tabla del catálogo tiene filas en X y en Y. Sin
-- esto, «el client lee 0» es cero sobre cero.
DO $$
DECLARE
    r      record;
    nx     bigint;
    ny     bigint;
    vacias text := '';
    total  int;
BEGIN
    SELECT count(*) INTO total FROM h41_tablas;
    IF total < 32 THEN
        RAISE EXCEPTION 'Vacuous run: el catálogo de los bloques 200 a 213 trajo % tablas, y la 0031 encontró 32.', total;
    END IF;
    IF (SELECT count(DISTINCT clase) FROM h41_tablas) <> 3 THEN
        RAISE EXCEPTION 'Vacuous run: el catálogo de los bloques 200 a 213 no tiene las tres clases: %',
            (SELECT string_agg(DISTINCT clase, ', ') FROM h41_tablas);
    END IF;
    FOR r IN SELECT tabla FROM h41_tablas ORDER BY tabla LOOP
        EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = $1', r.tabla)
           INTO nx USING (SELECT x FROM h41);
        EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = $1', r.tabla)
           INTO ny USING (SELECT y FROM h41);
        IF nx = 0 OR ny = 0 THEN
            vacias := vacias || r.tabla || ' (X=' || nx || ', Y=' || ny || ') ';
        END IF;
    END LOOP;
    IF vacias <> '' THEN
        RAISE EXCEPTION 'Vacuous run: la fixture de los bloques 200 a 213 no tiene filas en X y en Y de: %', vacias;
    END IF;
END
$$;

-- ── La matriz de lectura ────────────────────────────────────────────────────
-- Cuántas filas de X y de Y ve cada uno, tabla por tabla, como `authenticated`.
CREATE TEMP TABLE h41_lectura AS
SELECT t.tabla, t.clase, t.interna, t.servidor,
       pg_temp.h41_como(pg_temp.h41_id(0, 5),
           format('SELECT count(*) FROM public.%I WHERE organization_id = %L', t.tabla, h.x), 'cuenta') AS client_x,
       pg_temp.h41_como(pg_temp.h41_id(0, 5),
           format('SELECT count(*) FROM public.%I WHERE organization_id = %L', t.tabla, h.y), 'cuenta') AS client_y,
       pg_temp.h41_como(pg_temp.h41_id(0, 4),
           format('SELECT count(*) FROM public.%I WHERE organization_id = %L', t.tabla, h.x), 'cuenta') AS viewer_x,
       pg_temp.h41_como(pg_temp.h41_id(0, 2),
           format('SELECT count(*) FROM public.%I WHERE organization_id = %L', t.tabla, h.x), 'cuenta') AS manager_x,
       pg_temp.h41_como(pg_temp.h41_id(0, 6),
           format('SELECT count(*) FROM public.%I WHERE organization_id = %L', t.tabla, h.y), 'cuenta') AS yago_y
  FROM h41_tablas t, h41 h;

-- El personal ve todo lo suyo, y yago lo de Y: sin eso, los ceros de abajo no
-- distinguen «no puede» de «no hay». Salvo en lo de «sólo servidor», que no lo
-- lee nadie de la sesión por diseño de la 0030: ahí lo que se mide es eso.
DO $$
DECLARE malas text;
BEGIN
    SELECT string_agg(tabla || ' (manager X ' || manager_x || ', yago Y ' || yago_y || ')', ', ' ORDER BY tabla)
      INTO malas
      FROM h41_lectura
     WHERE NOT servidor AND (manager_x !~ '^n=[1-9]' OR yago_y !~ '^n=[1-9]');
    IF malas IS NOT NULL THEN
        RAISE EXCEPTION 'Vacuous run: el personal no ve sus propias filas en: %', malas;
    END IF;
END
$$;

-- ── 200 ──────────────────────────────────────────────────────────────────────
-- Un rol que no sirve: el client de X tiene que ver, en CADA superficie de cara
-- al cliente, exactamente lo que ve el manager de X. Rojo si la lectura propia
-- devuelve cero en alguna.
INSERT INTO defect_report
SELECT 200, 'el client de X no ve una superficie de cara al cliente de su propia organización',
       count(*) FILTER (WHERE client_x !~ '^n=[1-9]' OR client_x <> manager_x) > 0,
       CASE WHEN count(*) FILTER (WHERE client_x !~ '^n=[1-9]' OR client_x <> manager_x) = 0
            THEN 'clara (client de X) ve lo mismo que marta (manager de X) en las ' || count(*) ||
                 ' superficies de cara al cliente del catálogo, ninguna en cero; denominador: ' ||
                 (SELECT count(*) FROM h41_tablas) || ' tablas con organization_id y RLS, ' ||
                 (SELECT count(*) FROM h41_tablas WHERE interna) || ' internas, ' ||
                 (SELECT count(*) FROM h41_tablas WHERE servidor) || ' sólo del servidor'
            ELSE 'no ve (client/manager): ' ||
                 string_agg(tabla || ' ' || client_x || '/' || manager_x, ', ' ORDER BY tabla)
                     FILTER (WHERE client_x !~ '^n=[1-9]' OR client_x <> manager_x)
            END
  FROM h41_lectura WHERE clase = 'cliente';

-- ── 201 ──────────────────────────────────────────────────────────────────────
-- Lo interno de X, para el client de X: cero filas, en CADA tabla interna,
-- mientras el manager de la misma organización las ve (anti-vacío de arriba).
-- Y en lo de «sólo servidor», tampoco: ahí la negativa es el privilegio (42501)
-- y vale lo mismo, el client no lee. Cero filas o 42501 de privilegio, nada más.
INSERT INTO defect_report
SELECT 201, 'el client de X lee superficies internas de su organización',
       count(*) FILTER (WHERE client_x NOT IN ('n=0', 'ERR 42501 priv')) > 0
       OR count(*) FILTER (WHERE interna) = 0 OR count(*) FILTER (WHERE servidor) = 0,
       CASE WHEN count(*) FILTER (WHERE client_x NOT IN ('n=0', 'ERR 42501 priv')) = 0
                 AND count(*) FILTER (WHERE interna) > 0 AND count(*) FILTER (WHERE servidor) > 0
            THEN 'clara lee 0 filas en las ' || count(*) FILTER (WHERE interna) || ' tablas internas (' ||
                 string_agg(tabla, ', ' ORDER BY tabla) FILTER (WHERE interna) ||
                 '), donde marta lee las suyas; y en las ' || count(*) FILTER (WHERE servidor) ||
                 ' sólo del servidor (' || string_agg(tabla, ', ' ORDER BY tabla) FILTER (WHERE servidor) ||
                 ') la niega el privilegio'
            ELSE 'clara lee: ' || coalesce(string_agg(tabla || ' ' || client_x, ', ' ORDER BY tabla)
                                              FILTER (WHERE client_x NOT IN ('n=0', 'ERR 42501 priv')), '-') ||
                 ' / internas: ' || count(*) FILTER (WHERE interna) ||
                 ' / sólo del servidor: ' || count(*) FILTER (WHERE servidor)
            END
  FROM h41_lectura WHERE interna OR servidor;

-- ── 202 ──────────────────────────────────────────────────────────────────────
-- LO QUE DISTINGUE AL CLIENT DEL VIEWER. El viewer es personal de la agencia en
-- sólo lectura y SÍ ve lo interno. Sin este bloque, el 201 se pondría verde con
-- una policy que esconde lo interno a TODO el que no escribe —o sea, con el
-- client sin distinguir del viewer, que es el defecto de la puerta—.
INSERT INTO defect_report
SELECT 202, 'el viewer de X no ve lo interno: el client no se distingue del viewer',
       count(*) FILTER (WHERE viewer_x <> manager_x) > 0 OR count(*) = 0,
       CASE WHEN count(*) FILTER (WHERE viewer_x <> manager_x) = 0 AND count(*) > 0
            THEN 'vito (viewer de X) ve lo mismo que marta en las ' || count(*) ||
                 ' tablas internas; clara, cero (bloque 201)'
            ELSE 'vito/marta: ' || string_agg(tabla || ' ' || viewer_x || '/' || manager_x, ', ' ORDER BY tabla)
                                       FILTER (WHERE viewer_x <> manager_x)
            END
  FROM h41_lectura WHERE interna;

-- ── 203 ──────────────────────────────────────────────────────────────────────
-- Leer otra organización: cero filas de Y, en TODA tabla del catálogo, mientras
-- yago —dueño de Y— las ve (salvo lo de «sólo servidor», donde la negativa es
-- el privilegio para los dos).
INSERT INTO defect_report
SELECT 203, 'el client de X lee filas de otra organización',
       count(*) FILTER (WHERE NOT (client_y = 'n=0' OR (servidor AND client_y = 'ERR 42501 priv'))) > 0,
       CASE WHEN count(*) FILTER (WHERE NOT (client_y = 'n=0' OR (servidor AND client_y = 'ERR 42501 priv'))) = 0
            THEN 'clara lee 0 filas de Y en las ' || count(*) FILTER (WHERE NOT servidor) ||
                 ' tablas del catálogo que una sesión alcanza, donde yago ve las suyas; y el privilegio ' ||
                 'la niega en las ' || count(*) FILTER (WHERE servidor) || ' sólo del servidor'
            ELSE 'clara lee de Y: ' || string_agg(tabla || ' ' || client_y, ', ' ORDER BY tabla)
                     FILTER (WHERE NOT (client_y = 'n=0' OR (servidor AND client_y = 'ERR 42501 priv')))
            END
  FROM h41_lectura;

-- ── La matriz de escritura ──────────────────────────────────────────────────
-- La fila fuente de cada tabla: la primera de X por su CLAVE PRIMARIA, leída
-- como `postgres`, y la condición que la nombra (`donde`), armada con esa misma
-- clave: `id` en casi todas, la compuesta en las que no tienen `id`. Y las
-- columnas de la copia, del catálogo: todas las que no son generadas, con `id`
-- nuevo y `-copia` en el texto que integra una única.
CREATE OR REPLACE FUNCTION pg_temp.h41_primera(p_tabla text, OUT donde text, OUT fila jsonb)
LANGUAGE plpgsql AS $$
DECLARE
    clave text;
BEGIN
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
      INTO clave
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = ('public.' || quote_ident(p_tabla))::regclass AND i.indisprimary;
    IF clave IS NULL THEN
        RAISE EXCEPTION 'Vacuous run: % no tiene clave primaria; los bloques 200 a 213 no saben nombrar su fila.', p_tabla;
    END IF;
    EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.organization_id = $1 '
                   'ORDER BY %s LIMIT 1', p_tabla, clave)
       INTO fila USING (SELECT x FROM h41);
    donde := format('(%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, %L::jsonb) r)',
                    clave, clave, p_tabla, fila);
END
$$;

CREATE TEMP TABLE h41_fuente AS
SELECT t.tabla,
       f.donde,
       f.fila,
       (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
          FROM pg_attribute a
         WHERE a.attrelid = ('public.' || quote_ident(t.tabla))::regclass
           AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '') AS columnas,
       (SELECT string_agg(
                   CASE
                       WHEN a.attname = 'id' THEN 'gen_random_uuid()'
                       WHEN t.tabla = 'org_members' AND a.attname = 'user_id'
                           THEN quote_literal(pg_temp.h41_id(0, 7)) || '::uuid'
                       WHEN a.atttypid = 'text'::regtype AND EXISTS (
                                SELECT 1 FROM pg_index i
                                 WHERE i.indrelid = a.attrelid AND i.indisunique AND NOT i.indisprimary
                                   AND a.attnum = ANY (i.indkey::int2[]))
                           THEN 'r.' || quote_ident(a.attname) || ' || ''-copia'''
                       ELSE 'r.' || quote_ident(a.attname)
                   END, ', ' ORDER BY a.attnum)
          FROM pg_attribute a
         WHERE a.attrelid = ('public.' || quote_ident(t.tabla))::regclass
           AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '') AS expresiones
  FROM h41_tablas t
  CROSS JOIN LATERAL pg_temp.h41_primera(t.tabla) f;

-- Qué pares (tabla, verbo) son ESCRIBIBLES POR SESIÓN: privilegio del verbo para
-- `authenticated` Y una permisiva de ese comando. Ver el encabezado del bloque.
-- La contraprueba es el owner cuando TODA permisiva del comando es de admin
-- (`org_members`, desde la 0013); si no, el manager.
CREATE TEMP TABLE h41_pares AS
WITH v(verbo, cmd) AS (VALUES ('insert', 'a'), ('update', 'w'), ('delete', 'd')),
p AS (
    SELECT t.tabla, v.verbo, pol.polname,
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ||
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS texto
      FROM h41_tablas t
      CROSS JOIN v
      JOIN pg_policy pol ON pol.polrelid = ('public.' || quote_ident(t.tabla))::regclass
                        AND pol.polpermissive
                        AND pol.polcmd IN ('*', v.cmd::"char")
                        AND (pol.polroles = '{0}'::oid[]
                             OR 'authenticated'::regrole::oid = ANY (pol.polroles))
)
SELECT t.tabla, v.verbo,
       has_table_privilege('authenticated', ('public.' || quote_ident(t.tabla))::regclass,
                           upper(v.verbo)) AS privilegio,
       EXISTS (SELECT 1 FROM p WHERE p.tabla = t.tabla AND p.verbo = v.verbo) AS permisiva,
       CASE WHEN EXISTS (SELECT 1 FROM p WHERE p.tabla = t.tabla AND p.verbo = v.verbo)
                 AND NOT EXISTS (SELECT 1 FROM p WHERE p.tabla = t.tabla AND p.verbo = v.verbo
                                                   AND p.texto NOT LIKE '%current_user_admin_org_ids%')
            THEN 'owner' ELSE 'manager' END AS contraprueba
  FROM h41_tablas t CROSS JOIN v;

CREATE TEMP TABLE h41_sentencias AS
SELECT f.tabla, v.verbo,
       CASE v.verbo
           WHEN 'insert' THEN format(
               'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, %L::jsonb) r',
               f.tabla, f.columnas, f.expresiones, f.tabla, f.fila)
           WHEN 'update' THEN format(
               'UPDATE public.%I SET organization_id = organization_id WHERE %s', f.tabla, f.donde)
           ELSE format('DELETE FROM public.%I WHERE %s', f.tabla, f.donde)
       END AS sentencia
  FROM h41_fuente f
  CROSS JOIN (VALUES ('insert'), ('update'), ('delete')) v(verbo);

-- La MISMA sentencia, con cada uno de los cinco.
CREATE TEMP TABLE h41_escritura AS
SELECT s.tabla, s.verbo, a.actor, pg_temp.h41_como(a.uid, s.sentencia) AS resultado
  FROM h41_sentencias s CROSS JOIN h41_actores a;

-- Anti-vacío de la matriz: tres verbos por tabla del catálogo, cinco actores, y
-- al menos un par escribible por sesión —sin él, el 205 es cero sobre cero—.
DO $$
DECLARE
    esperadas int;
    medidas   int;
    pares     int;
BEGIN
    SELECT count(*) * 3 * 5 INTO esperadas FROM h41_tablas;
    SELECT count(*) INTO medidas FROM h41_escritura;
    SELECT count(*) INTO pares FROM h41_pares WHERE privilegio AND permisiva;
    IF medidas <> esperadas OR pares = 0 THEN
        RAISE EXCEPTION 'Vacuous run: la matriz de escritura midió % de % sentencias y % pares escribibles.',
            medidas, esperadas, pares;
    END IF;
END
$$;

-- Cómo terminó cada sentencia, en una palabra: «cambió», «0 filas», «42501 rls»,
-- «42501 privilegio» u «otro». El 204 y el 206 informan con esto.
CREATE OR REPLACE FUNCTION pg_temp.h41_clase(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p ~ '^n=[1-9]'           THEN 'cambió'
                WHEN p = 'n=0'                THEN '0 filas'
                WHEN p = 'ERR 42501 rls'      THEN '42501 rls'
                WHEN p = 'ERR 42501 priv'     THEN '42501 privilegio'
                ELSE 'otro: ' || p END;
$$;

-- ── 204 ──────────────────────────────────────────────────────────────────────
-- El client de X no cambia NI UNA fila de X, en ninguna tabla del catálogo y con
-- ninguno de los tres verbos. Lo que se acepta: 0 filas (UPDATE y DELETE: la
-- restrictiva le esconde la fila al verbo) o 42501 (INSERT: la WITH CHECK
-- restrictiva; o el privilegio, donde `authenticated` nunca lo tuvo).
INSERT INTO defect_report
SELECT 204, 'el client de X cambia filas de su organización por PostgREST',
       count(*) FILTER (WHERE pg_temp.h41_clase(resultado) NOT IN ('0 filas', '42501 rls', '42501 privilegio')) > 0,
       CASE WHEN count(*) FILTER (WHERE pg_temp.h41_clase(resultado) NOT IN ('0 filas', '42501 rls', '42501 privilegio')) = 0
            THEN 'clara no cambió ninguna fila en ' || count(*) || ' sentencias (' ||
                 (SELECT string_agg(verbo || ': ' || resumen, '; ' ORDER BY verbo)
                    FROM (SELECT verbo, string_agg(clase || ' x' || n, ', ' ORDER BY clase) AS resumen
                            FROM (SELECT verbo, pg_temp.h41_clase(resultado) AS clase, count(*) AS n
                                    FROM h41_escritura WHERE actor = 'client' GROUP BY 1, 2) c
                           GROUP BY verbo) r) || ')'
            ELSE 'clara: ' || string_agg(tabla || ' ' || verbo || ' ' || resultado, ', ' ORDER BY tabla, verbo)
                                  FILTER (WHERE pg_temp.h41_clase(resultado) NOT IN ('0 filas', '42501 rls', '42501 privilegio'))
            END
  FROM h41_escritura WHERE actor = 'client';

-- ── 205 ──────────────────────────────────────────────────────────────────────
-- LA CORRECCIÓN DEL CRÍTICO. En cada par escribible por sesión, la MISMA
-- sentencia que el client no pudo ejecutar, ejecutada por el manager de la MISMA
-- organización (el owner en `org_members`), cambia la fila. Sin esto el 204 se
-- pone verde con un esquema que no deja escribir a NADIE —o con una fila que no
-- es de X—, y la negativa no diría nada del rol.
INSERT INTO defect_report
SELECT 205, 'la negativa al client no es por el rol: el personal de X tampoco escribe donde debería',
       count(*) FILTER (WHERE e.resultado <> 'n=1') > 0 OR count(*) = 0,
       CASE WHEN count(*) FILTER (WHERE e.resultado <> 'n=1') = 0 AND count(*) > 0
            THEN 'en los ' || count(*) || ' pares (tabla, verbo) escribibles por sesión la misma sentencia ' ||
                 'cambia una fila con marta (omar en org_members) y ninguna con clara; ' ||
                 (SELECT count(*) FROM h41_pares WHERE NOT (privilegio AND permisiva)) ||
                 ' pares más están negados a todos por diseño previo (sin privilegio o sin permisiva), ' ||
                 'y ahí el rol se mide por ruta'
            ELSE 'no escribió la contraprueba: ' ||
                 string_agg(p.tabla || ' ' || p.verbo || ' (' || p.contraprueba || ') ' || e.resultado, ', '
                            ORDER BY p.tabla, p.verbo) FILTER (WHERE e.resultado <> 'n=1')
            END
  FROM h41_pares p
  JOIN h41_escritura e ON e.tabla = p.tabla AND e.verbo = p.verbo AND e.actor = p.contraprueba
 WHERE p.privilegio AND p.permisiva;

-- ── 206 ──────────────────────────────────────────────────────────────────────
-- D3: el viewer tampoco escribe. Es personal de la agencia en sólo lectura.
INSERT INTO defect_report
SELECT 206, 'el viewer de X cambia filas de su organización por PostgREST',
       count(*) FILTER (WHERE pg_temp.h41_clase(resultado) NOT IN ('0 filas', '42501 rls', '42501 privilegio')) > 0,
       CASE WHEN count(*) FILTER (WHERE pg_temp.h41_clase(resultado) NOT IN ('0 filas', '42501 rls', '42501 privilegio')) = 0
            THEN 'vito no cambió ninguna fila en ' || count(*) || ' sentencias'
            ELSE 'vito: ' || string_agg(tabla || ' ' || verbo || ' ' || resultado, ', ' ORDER BY tabla, verbo)
                                 FILTER (WHERE pg_temp.h41_clase(resultado) NOT IN ('0 filas', '42501 rls', '42501 privilegio'))
            END
  FROM h41_escritura WHERE actor = 'viewer';

-- ── 207 ──────────────────────────────────────────────────────────────────────
-- D3, el otro lado: el editor SÍ escribe, donde escribe el manager. Sin esto, un
-- eje que dejara afuera al editor pondría verdes el 204 y el 206 y rompería el
-- trabajo de la agencia.
INSERT INTO defect_report
SELECT 207, 'el editor de X no escribe donde el personal escribe por sesión',
       count(*) FILTER (WHERE e.resultado <> 'n=1') > 0 OR count(*) = 0,
       CASE WHEN count(*) FILTER (WHERE e.resultado <> 'n=1') = 0 AND count(*) > 0
            THEN 'eva cambia una fila en los ' || count(*) || ' pares donde escribe el manager'
            ELSE 'eva no escribió: ' || string_agg(p.tabla || ' ' || p.verbo || ' ' || e.resultado, ', '
                                                   ORDER BY p.tabla, p.verbo) FILTER (WHERE e.resultado <> 'n=1')
            END
  FROM h41_pares p
  JOIN h41_escritura e ON e.tabla = p.tabla AND e.verbo = p.verbo AND e.actor = 'editor'
 WHERE p.privilegio AND p.permisiva AND p.contraprueba = 'manager';

-- ── 208 ──────────────────────────────────────────────────────────────────────
-- EL EJE, POR CATÁLOGO, que es lo único que ve las tablas donde la conducta no
-- distingue: en las que `authenticated` no tiene el privilegio —`publications`,
-- la ficha, las de integraciones, el tablero— el client y el manager mueren
-- igual por el privilegio, así que borrarles el eje no pondría rojo ningún
-- bloque de conducta. El día que alguien les devuelva un grant, el eje es lo que
-- queda.
--
-- Lo que afirma, en cada tabla del catálogo que una sesión alcanza:
--   * una RESTRICTIVA de INSERT para PUBLIC cuyo WITH CHECK ES la forma canónica
--     del rol que escribe, una de UPDATE con esa forma en USING y en WITH CHECK,
--     y una de DELETE con ella en USING;
--   * en las internas, una RESTRICTIVA de SELECT cuyo USING ES la forma canónica
--     del personal; y en las de cara al cliente, ninguna;
-- en cada tabla de «sólo servidor», NINGUNA de las cuatro (la 0031 no se las
-- pone, y la 0030 las rechaza en su bloque 140);
-- y que las internas son las de D2, escritas acá como literal: la suite no le
-- cree a `is_internal_surface()` —sacar una tabla de esa lista volvería verde
-- todo lo de arriba— sino que la compara con la decisión.
--
-- POR IGUALDAD Y NO POR TEXTO PARECIDO, por lo que el bloque 129 aprendió (R14):
-- `organization_id IN (SELECT current_user_writer_org_ids()) OR true` CONTIENE
-- el nombre de la función y no acota nada. La forma canónica sale de deparsear,
-- en esta misma sesión, una policy con el predicado de la 0031 sobre una tabla
-- temporal; así ni el `search_path` ni la versión del deparser la mueven.
CREATE TEMP TABLE h41_canon (organization_id uuid);
CREATE POLICY h41_canon_escribe ON h41_canon
    USING (organization_id IN (SELECT public.current_user_writer_org_ids()));
CREATE POLICY h41_canon_personal ON h41_canon
    USING (organization_id IN (SELECT public.current_user_staff_org_ids()));
SELECT set_config('qa.h41_escribe',
                  (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p
                    WHERE p.polrelid = 'h41_canon'::regclass AND p.polname = 'h41_canon_escribe'), true),
       set_config('qa.h41_personal',
                  (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p
                    WHERE p.polrelid = 'h41_canon'::regclass AND p.polname = 'h41_canon_personal'), true);

DO $$
BEGIN
    IF coalesce(current_setting('qa.h41_escribe'), '') !~ 'current_user_writer_org_ids'
       OR coalesce(current_setting('qa.h41_personal'), '') !~ 'current_user_staff_org_ids' THEN
        RAISE EXCEPTION 'Vacuous run: la forma canónica del 208 salió vacía: [%] [%]',
            current_setting('qa.h41_escribe'), current_setting('qa.h41_personal');
    END IF;
END
$$;

CREATE TEMP TABLE h41_eje AS
WITH pol AS (
    SELECT c.relname::text AS tabla, p.polcmd, p.polpermissive, p.polroles,
           pg_get_expr(p.polqual, p.polrelid)      AS usando,
           pg_get_expr(p.polwithcheck, p.polrelid) AS con_check
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
),
r AS (SELECT * FROM pol WHERE NOT polpermissive AND polroles = '{0}'::oid[])
SELECT t.tabla, t.interna, t.servidor,
       EXISTS (SELECT 1 FROM r WHERE r.tabla = t.tabla AND r.polcmd = 'a'
                                 AND r.con_check = current_setting('qa.h41_escribe')) AS ins,
       EXISTS (SELECT 1 FROM r WHERE r.tabla = t.tabla AND r.polcmd = 'w'
                                 AND r.usando = current_setting('qa.h41_escribe')
                                 AND r.con_check = current_setting('qa.h41_escribe')) AS upd,
       EXISTS (SELECT 1 FROM r WHERE r.tabla = t.tabla AND r.polcmd = 'd'
                                 AND r.usando = current_setting('qa.h41_escribe')) AS del,
       EXISTS (SELECT 1 FROM r WHERE r.tabla = t.tabla AND r.polcmd = 'r'
                                 AND r.usando = current_setting('qa.h41_personal')) AS lee_staff,
       -- Cualquier policy del eje, por nombre, aunque su expresión esté mal: lo
       -- que una tabla de «sólo servidor» no tiene que tener.
       EXISTS (SELECT 1 FROM pol WHERE pol.tabla = t.tabla AND NOT pol.polpermissive
                                   AND pol.polroles = '{0}'::oid[]) AS alguna_restrictiva_publica
  FROM h41_tablas t;

-- Las internas que D2 decidió, sobre el catálogo de hoy. El literal es la
-- decisión; `is_internal_surface()` es su implementación.
CREATE TEMP TABLE h41_d2 AS
SELECT (SELECT coalesce(array_agg(tabla ORDER BY tabla), '{}') FROM h41_tablas WHERE interna) AS declaradas,
       (SELECT coalesce(array_agg(tabla ORDER BY tabla), '{}') FROM h41_tablas
         WHERE NOT servidor
           AND (tabla IN ('activity_logs', 'agent_runs', 'integration_probe',
                          'integration_properties', 'integration_tokens', 'platform_tasks')
                OR tabla LIKE 'board\_%')) AS decididas;

CREATE OR REPLACE FUNCTION pg_temp.h41_eje_mal(e h41_eje) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN e.servidor THEN e.alguna_restrictiva_publica
                ELSE NOT (e.ins AND e.upd AND e.del) OR e.lee_staff <> e.interna END;
$$;

INSERT INTO defect_report
SELECT 208, 'el eje de rol falta, no mira el rol, o lo interno dejó de ser lo de D2',
       count(*) FILTER (WHERE pg_temp.h41_eje_mal(h41_eje)) > 0
       OR count(*) FILTER (WHERE NOT servidor) = 0
       OR (SELECT declaradas IS DISTINCT FROM decididas FROM h41_d2),
       CASE WHEN count(*) FILTER (WHERE pg_temp.h41_eje_mal(h41_eje)) = 0
                 AND count(*) FILTER (WHERE NOT servidor) > 0
                 AND (SELECT declaradas IS NOT DISTINCT FROM decididas FROM h41_d2)
            THEN 'las ' || count(*) FILTER (WHERE NOT servidor) || ' tablas del catálogo que una sesión alcanza ' ||
                 'tienen sus tres restrictivas de escritura IGUALES a la forma canónica del rol que escribe; las ' ||
                 count(*) FILTER (WHERE interna) || ' internas, y sólo ellas, la de lectura del personal; las ' ||
                 count(*) FILTER (WHERE servidor) || ' sólo del servidor no tienen ninguna; ' ||
                 'y las internas son las de D2'
            ELSE 'eje mal puesto: [' || coalesce(string_agg(tabla || ' (ins ' || ins || ', upd ' || upd ||
                                                             ', del ' || del || ', lee ' || lee_staff ||
                                                             ', interna ' || interna || ', servidor ' || servidor || ')',
                                                             ', ' ORDER BY tabla)
                                                  FILTER (WHERE pg_temp.h41_eje_mal(h41_eje)), '') ||
                 ']; internas según is_internal_surface(): ' || (SELECT declaradas::text FROM h41_d2) ||
                 '; según D2: ' || (SELECT decididas::text FROM h41_d2)
            END
  FROM h41_eje;

-- ── 209 ──────────────────────────────────────────────────────────────────────
-- Las tres funciones de la 0031, rol por rol, más el resolutor de siempre. Una
-- cadena por persona: escribe, es personal, aprueba, es miembro. Arturo es
-- manager ARCHIVADO: sin `state = 'active'` en una de las tres, escribiría.
CREATE TEMP TABLE h41_funciones AS
SELECT q.quien, q.esperado,
       (SELECT string_agg(CASE WHEN pg_temp.h41_como(q.uid,
                                   format('SELECT count(*) FROM %s() f WHERE f = %L', f.fn, (SELECT x FROM h41)),
                                   'cuenta') = 'n=1' THEN '1' ELSE '0' END, '' ORDER BY f.orden)
          FROM (VALUES (1, 'public.current_user_writer_org_ids'),
                       (2, 'public.current_user_staff_org_ids'),
                       (3, 'public.current_user_approver_org_ids'),
                       (4, 'public.current_user_org_ids')) f(orden, fn)) AS medido
  FROM (VALUES ('omar (owner)',               pg_temp.h41_id(0, 1), '1111'),
               ('marta (manager)',            pg_temp.h41_id(0, 2), '1111'),
               ('eva (editor)',               pg_temp.h41_id(0, 3), '1101'),
               ('vito (viewer)',              pg_temp.h41_id(0, 4), '0101'),
               ('clara (client)',             pg_temp.h41_id(0, 5), '0001'),
               ('arturo (manager archivado)', pg_temp.h41_id(0, 8), '0000')) q(quien, uid, esperado);

INSERT INTO defect_report
SELECT 209, 'las funciones de rol de la 0031 no devuelven los conjuntos de D2 a D4',
       count(*) FILTER (WHERE medido IS DISTINCT FROM esperado) > 0 OR count(*) <> 6,
       CASE WHEN count(*) FILTER (WHERE medido IS DISTINCT FROM esperado) = 0 AND count(*) = 6
            THEN 'escribe/personal/aprueba/miembro: ' ||
                 string_agg(quien || ' ' || medido, ', ' ORDER BY esperado DESC, quien)
            ELSE 'medido (esperado): ' ||
                 string_agg(quien || ' ' || coalesce(medido, '?') || ' (' || esperado || ')', ', '
                            ORDER BY quien) FILTER (WHERE medido IS DISTINCT FROM esperado)
            END
  FROM h41_funciones;

-- ── 210 ──────────────────────────────────────────────────────────────────────
-- Que el client no se ascienda: ni cambiándose el rol ni dándose de alta otra
-- membresía. Y el owner de la misma organización sí puede cambiarle el rol —sin
-- eso, la negativa no distinguiría a quien llama—.
SELECT set_config('qa.b210a', pg_temp.h41_como(pg_temp.h41_id(0, 5), format(
           'UPDATE public.org_members SET role = ''owner'' WHERE organization_id = %L AND user_id = %L',
           (SELECT x FROM h41), pg_temp.h41_id(0, 5))), true);
SELECT set_config('qa.b210b', pg_temp.h41_como(pg_temp.h41_id(0, 5), format(
           'INSERT INTO public.org_members (organization_id, user_id, role) VALUES (%L, %L, ''owner'')',
           (SELECT x FROM h41), pg_temp.h41_id(0, 7))), true);
SELECT set_config('qa.b210c', pg_temp.h41_como(pg_temp.h41_id(0, 1), format(
           'UPDATE public.org_members SET role = ''manager'' WHERE organization_id = %L AND user_id = %L',
           (SELECT x FROM h41), pg_temp.h41_id(0, 5))), true);

INSERT INTO defect_report
SELECT 210, 'el client de X se puede dar un rol mayor',
       NOT (a = 'n=0' AND b = 'ERR 42501 rls' AND c = 'n=1'),
       CASE WHEN a = 'n=0' AND b = 'ERR 42501 rls' AND c = 'n=1'
            THEN 'clara no se cambia el rol (0 filas) ni se da de alta como owner (42501 rls); ' ||
                 'omar, owner de X, le cambia el rol (1 fila)'
            ELSE 'clara cambia su rol: ' || a || ' / clara se da de alta: ' || b || ' / omar le cambia el rol: ' || c
            END
  FROM (SELECT current_setting('qa.b210a') AS a, current_setting('qa.b210b') AS b,
               current_setting('qa.b210c') AS c) x;

-- ── 211 ──────────────────────────────────────────────────────────────────────
-- APROBAR, POR POSTGREST. La sentencia exacta que escribe `/api/content/approve`
-- —el sello con el hash que calculó la base— sobre el borrador de X:
--
--   a. clara (client): 0 filas, por el eje de rol;
--   b. clara reservando en el ledger: 42501 de privilegio, como cualquier sesión;
--   c. eva (editor): 42501 de la RLS, por el eje de APROBACIÓN. Escribe, pero no
--      sella (D4);
--   d. marta (manager): 1 fila. La contraprueba;
--   e. eva INSERTANDO un asset que nace sellado: 42501 de la RLS. Es la otra
--      mitad del eje —la policy de INSERT— y sin este caso se podía borrar
--      entera con la suite en verde (medido: la mutación sobrevivió);
--   f. marta, el mismo INSERT: 1 fila.
CREATE OR REPLACE FUNCTION pg_temp.h41_sellar(p_uid uuid) RETURNS text
LANGUAGE sql AS $$
    SELECT pg_temp.h41_como(p_uid, format(
        'UPDATE public.content_assets SET status = ''approved'', approved_hash = payload_hash, '
        'approved_by = %L, approved_at = now() WHERE id = %L',
        p_uid, pg_temp.h41_id(1, 10)));
$$;

SELECT set_config('qa.b211a', pg_temp.h41_sellar(pg_temp.h41_id(0, 5)), true);
SELECT set_config('qa.b211b', pg_temp.h41_como(pg_temp.h41_id(0, 5), format(
           'INSERT INTO public.publications (organization_id, asset_id, approved_hash, destination) '
           'VALUES (%L, %L, %L, ''google_business_profile'')',
           (SELECT x FROM h41), pg_temp.h41_id(1, 29),
           (SELECT approved_hash FROM content_assets WHERE id = pg_temp.h41_id(1, 29)))), true);
SELECT set_config('qa.b211c', pg_temp.h41_sellar(pg_temp.h41_id(0, 3)), true);
SELECT set_config('qa.b211d', pg_temp.h41_sellar(pg_temp.h41_id(0, 2)), true);

-- El hash se calcula acá, como `postgres`, con la misma función que la columna
-- generada: lo que se mide es quién puede escribir una fila sellada, no si
-- `authenticated` puede llamar a `content_payload_hash()`.
CREATE OR REPLACE FUNCTION pg_temp.h41_nace_sellado(p_uid uuid) RETURNS text
LANGUAGE sql AS $$
    SELECT pg_temp.h41_como(p_uid, format(
        'INSERT INTO public.content_assets (organization_id, business_id, kind, body, locale, status, '
        'approved_hash, approved_by, approved_at) '
        'VALUES (%L, %L, ''post'', ''Nace sellado H41'', ''en'', ''approved'', %L, %L, now())',
        (SELECT x FROM h41), pg_temp.h41_id(1, 2),
        public.content_payload_hash(NULL, 'Nace sellado H41', 'en', 'post', NULL), p_uid));
$$;

SELECT set_config('qa.b211e', pg_temp.h41_nace_sellado(pg_temp.h41_id(0, 3)), true);
SELECT set_config('qa.b211f', pg_temp.h41_nace_sellado(pg_temp.h41_id(0, 2)), true);

INSERT INTO defect_report
SELECT 211, 'se puede aprobar o reservar una publicación por PostgREST sin un rol que aprueba',
       NOT (a = 'n=0' AND b = 'ERR 42501 priv' AND c = 'ERR 42501 rls' AND d = 'n=1'
            AND e = 'ERR 42501 rls' AND f = 'n=1'),
       CASE WHEN a = 'n=0' AND b = 'ERR 42501 priv' AND c = 'ERR 42501 rls' AND d = 'n=1'
                 AND e = 'ERR 42501 rls' AND f = 'n=1'
            THEN 'clara no sella (0 filas) ni reserva en el ledger (42501 privilegio); eva, editor, ' ||
                 'no sella (42501 rls) ni inserta algo ya sellado (42501 rls); marta, manager de la ' ||
                 'misma organización, sella (1 fila) e inserta sellado (1 fila)'
            ELSE 'clara sella: ' || a || ' / clara reserva: ' || b || ' / eva sella: ' || c ||
                 ' / marta sella: ' || d || ' / eva inserta sellado: ' || e || ' / marta inserta sellado: ' || f
            END
  FROM (SELECT current_setting('qa.b211a') AS a, current_setting('qa.b211b') AS b,
               current_setting('qa.b211c') AS c, current_setting('qa.b211d') AS d,
               current_setting('qa.b211e') AS e, current_setting('qa.b211f') AS f) x;

-- ── 212 ──────────────────────────────────────────────────────────────────────
-- EL CONTROL POSITIVO DEL EJE DE APROBACIÓN: eva edita el cuerpo de un asset
-- aprobado y la fila vuelve a borrador sin sello, que es lo que la 0015 promete.
-- Un eje que rechazara toda escritura de un editor sobre una fila aprobada
-- pondría verde el 211 y rompería la edición.
SELECT set_config('qa.b212', pg_temp.h41_como(pg_temp.h41_id(0, 3), format(
           'WITH u AS (UPDATE public.content_assets SET body = body || '' (editado)'' WHERE id = %L '
           'RETURNING status, approved_hash) '
           'SELECT count(*) FROM u WHERE status = ''draft'' AND approved_hash IS NULL',
           pg_temp.h41_id(1, 29)), 'cuenta'), true);

INSERT INTO defect_report
SELECT 212, 'el editor no puede editar un asset aprobado: el eje de aprobación bloquea de más',
       current_setting('qa.b212') <> 'n=1',
       CASE WHEN current_setting('qa.b212') = 'n=1'
            THEN 'eva edita el cuerpo del aprobado y la fila queda en draft sin sello'
            ELSE 'eva edita el aprobado: ' || current_setting('qa.b212') END;

-- ── 213 ──────────────────────────────────────────────────────────────────────
-- MODIFICAR INTEGRACIONES, POR POSTGREST. Las tres tablas y la RPC que guarda el
-- token: clara no escribe ninguna (42501 de privilegio) ni lee nada de ellas.
-- Tampoco marta: por sesión NADIE modifica integraciones —lo hace el servidor
-- con `service_role`—, así que la negativa de acá es del privilegio y no del
-- rol. El rol de esta acción se mide por ruta, en
-- `property-actions.test.ts` y en los tests de `/api/auth/google/*`.
SELECT set_config('qa.b213rpc', pg_temp.h41_como(pg_temp.h41_id(0, 5), format(
           'SELECT public.store_integration_token(%L, ''google'', ''ya29.no-es-un-token'', now() + interval ''1 hour'')',
           (SELECT x FROM h41))), true);

CREATE TEMP TABLE h41_integraciones AS
SELECT count(*) FILTER (WHERE actor = 'client') AS medidas,
       count(*) FILTER (WHERE actor = 'client'
                          AND pg_temp.h41_clase(resultado) NOT IN ('0 filas', '42501 privilegio')) AS pasaron,
       count(*) FILTER (WHERE actor = 'manager' AND pg_temp.h41_clase(resultado) = '42501 privilegio') AS manager_priv,
       (SELECT count(*) FROM h41_lectura
         WHERE tabla IN ('integration_tokens', 'integration_properties', 'integration_probe')
           AND client_x = 'n=0') AS lecturas_en_cero,
       string_agg(tabla || ' ' || verbo || ' ' || resultado, ', ' ORDER BY tabla, verbo)
           FILTER (WHERE actor = 'client') AS detalle
  FROM h41_escritura
 WHERE tabla IN ('integration_tokens', 'integration_properties', 'integration_probe');

INSERT INTO defect_report
SELECT 213, 'el client de X modifica o lee las integraciones de su organización por PostgREST',
       NOT (medidas = 9 AND pasaron = 0 AND lecturas_en_cero = 3
            AND current_setting('qa.b213rpc') LIKE 'ERR 42501%'),
       CASE WHEN medidas = 9 AND pasaron = 0 AND lecturas_en_cero = 3
                 AND current_setting('qa.b213rpc') LIKE 'ERR 42501%'
            THEN 'clara: 9 de 9 escrituras sobre las tres tablas de integraciones negadas, 0 filas leídas en ' ||
                 'las tres, la RPC del token negada; marta también por privilegio en ' || manager_priv ||
                 ' de 9: la puerta de esta acción es la ruta'
            ELSE 'clara: ' || coalesce(detalle, '') || ' / lecturas en cero: ' || lecturas_en_cero ||
                 ' de 3 / RPC: ' || current_setting('qa.b213rpc')
            END
  FROM h41_integraciones;

-- El denominador, publicado: lo que estos bloques miraron, para que el verde se
-- lea como lo que es y no como «todas».
DO $$
DECLARE
    tablas      int;
    internas    int;
    servidor    int;
    pares       int;
    escribibles int;
    medidas     int;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE interna), count(*) FILTER (WHERE h41_tablas.servidor)
      INTO tablas, internas, servidor FROM h41_tablas;
    SELECT count(*), count(*) FILTER (WHERE privilegio AND permisiva) INTO pares, escribibles FROM h41_pares;
    SELECT count(*) INTO medidas FROM h41_escritura;
    RAISE NOTICE 'H4.1: % tablas con organization_id y RLS (% de cara al cliente, % internas, % sólo del servidor); % pares (tabla, verbo): % escribibles por sesión, % negados a todos por diseño previo; % sentencias de escritura medidas.',
        tablas, tablas - internas - servidor, internas, servidor, pares, escribibles, pares - escribibles, medidas;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Report
-- ─────────────────────────────────────────────────────────────────────────────
-- Anti-vacuity: a hundred and fifty-seven checks were written, so a hundred
-- and fifty-seven rows must be present. Fewer means a check silently failed to record and the report is lying
-- by omission.
--
-- La numeración salta del 143 al 200 a propósito: los bloques de la 0031 (H4.1)
-- arrancaron en 200 cuando la 0029 (121 a 135) y la 0030 (136 en adelante)
-- todavía estaban en PRs abiertos, para que los tres frentes no chocaran al
-- mergearse. El conteo de abajo es de FILAS, no el número más alto: 143 + 14.
--
-- El número de esta prosa estuvo DESFASADO del código —decía «sixty-eight»
-- mientras el código exigía 76— en el archivo cuyo trabajo es que los números no
-- mientan. Corregido con la `0026`, y dicho acá: el conteo está escrito a mano en
-- cinco lugares de este bloque y hay que tocarlos todos. Y en el encabezado del
-- archivo, que es el sexto.

DO $$
DECLARE
    checks    int;
    n_present int;
    detail    text;
BEGIN
    SELECT count(*) INTO checks FROM defect_report;
    IF checks <> 157 THEN
        RAISE EXCEPTION 'Vacuous run: % of 157 checks recorded a result.', checks;
    END IF;

    SELECT count(*) INTO n_present FROM defect_report d WHERE d.present;

    SELECT string_agg(format('  %s. %s' || chr(10) || '     %s',
                             d.num, d.name, d.evidence), chr(10) ORDER BY d.num)
      INTO detail
      FROM defect_report d WHERE d.present;

    IF n_present > 0 THEN
        RAISE EXCEPTION E'% of 157 isolation defects are live in this schema:\n%',
            n_present, detail;
    END IF;

    RAISE NOTICE 'All 157 checks green: the schema prevents every one of them.';
END
$$;

ROLLBACK;
