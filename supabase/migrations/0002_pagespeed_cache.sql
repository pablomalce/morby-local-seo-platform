-- PageSpeed Insights result cache (Sprint 1, item #8).
--
-- Non-tenant, public, non-sensitive cache keyed by (url, strategy). The orchestrator stores ONLY
-- successful "live" Web Vitals here, so a failed Lighthouse run is never cached. 24h freshness is
-- enforced in application code (orchestrator.ts). This makes /reports fast again — a good result
-- is reused across requests and survives redeploys — without re-introducing the cache-poisoning
-- bug that the per-request fetch cache had.

create table if not exists public.pagespeed_cache (
  url         text not null,
  strategy    text not null default 'mobile',
  result      jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (url, strategy)
);

alter table public.pagespeed_cache enable row level security;

-- The reports page runs unauthenticated in demo mode, so the anon role must be able to read and
-- upsert. The data is public PageSpeed metrics keyed by URL (no PII, no tenant data), so permissive
-- policies are acceptable for a shared cache.
drop policy if exists "pagespeed_cache_select" on public.pagespeed_cache;
create policy "pagespeed_cache_select" on public.pagespeed_cache
  for select using (true);

drop policy if exists "pagespeed_cache_insert" on public.pagespeed_cache;
create policy "pagespeed_cache_insert" on public.pagespeed_cache
  for insert with check (true);

drop policy if exists "pagespeed_cache_update" on public.pagespeed_cache;
create policy "pagespeed_cache_update" on public.pagespeed_cache
  for update using (true) with check (true);

-- Tell PostgREST to reload its schema cache so the REST API sees the new table immediately.
-- Without this, the app's REST upsert can fail silently ("table not found in schema cache")
-- until PostgREST next reloads on its own.
notify pgrst, 'reload schema';
