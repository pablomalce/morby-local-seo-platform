-- Expand: stop the anonymous key from writing the PageSpeed cache.
--
-- pagespeed_cache shipped with `for insert with check (true)` and
-- `for update using (true) with check (true)`, applying to PUBLIC. Supabase also
-- grants every privilege on public tables to `anon` by default. The anon key is
-- in the browser bundle by design, so the two together mean anyone who loads the
-- app can write any result for any URL.
--
-- Measured through PostgREST against a real project, with no session at all:
-- the upsert returned 201 and the row read back byte for byte. That is not a
-- theoretical hole, it is the documented path of the report generator being
-- open to everyone.
--
-- What it costs: hydrateWithPageSpeed() serves a cached hit for 24 hours
-- (PAGESPEED_TTL_MS) without revalidating, so a forged row puts invented web
-- vitals into a customer's report for a day. The orchestrator's own test file
-- already names the poisoning risk from the API side; this is the same risk from
-- the database side, and this one nobody had looked at.
--
-- The fix is not to close the table: the application does need to write it. It
-- is to require a session. Reports live behind middleware.ts, which redirects an
-- anonymous request to /login, so every legitimate write already arrives as
-- `authenticated`. Nothing in the application changes.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The write policies stop applying to everyone
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT stays open to PUBLIC on purpose. The table holds PageSpeed scores of
-- public websites, keyed by URL; there is nothing tenant-scoped in it to leak,
-- and a public page that renders a score keeps working. Writing is the part that
-- has to be earned.

drop policy if exists "pagespeed_cache_insert" on public.pagespeed_cache;
create policy "pagespeed_cache_insert" on public.pagespeed_cache
  for insert to authenticated with check (true);

drop policy if exists "pagespeed_cache_update" on public.pagespeed_cache;
create policy "pagespeed_cache_update" on public.pagespeed_cache
  for update to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. And the privilege behind them
-- ─────────────────────────────────────────────────────────────────────────────
-- A policy alone would be enough for PostgREST, but leaving the GRANT means the
-- table is one careless `create policy` away from being writable again. Two
-- barriers, the same reasoning the activity_log design uses: it does not depend
-- on nobody writing an UPDATE, it depends on nobody being able to.

revoke insert, update, delete on public.pagespeed_cache from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TRUNCATE, on every table
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase grants TRUNCATE on public tables to anon and authenticated, and
-- **TRUNCATE is not filtered by row level security**. No policy in this schema
-- protects against it: the fifteen tables are equally exposed to it, including
-- the ones whose isolation the other nine checks prove.
--
-- Honest about the reach: PostgREST exposes SELECT, INSERT, UPDATE, DELETE and
-- RPC, and no TRUNCATE verb, so today the grant is not reachable with an API
-- key. It becomes reachable the day someone writes a SECURITY INVOKER function
-- that truncates, or opens another connection path. A privilege nobody needs
-- and RLS cannot restrain is one to remove before it finds a route, not after.

do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'revoke truncate on public.%I from anon, authenticated', t.tablename);
  end loop;
end
$$;

commit;
