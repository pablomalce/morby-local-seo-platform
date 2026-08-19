-- Expand: close the six isolation defects the QA replica proves are live.
--
-- Additive by construction. Growth OS has data and users, so every step here is
-- either a tightening that no compliant writer can trip, or a constraint added
-- NOT VALID so that existing rows are tolerated until they are cleaned up. The
-- destructive half — NOT NULL on the tenant columns, dropping the tolerated
-- rows — belongs to a contract migration at least one release later.
--
-- Each section names the defect it closes and what it prevents. The evidence
-- that each one WAS live is in supabase/qa/defects_test.sql, which fails
-- against the schema without this migration.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. activity_logs: the tenant-less branch is a leak
-- ─────────────────────────────────────────────────────────────────────────────
-- The policies read `organization_id is null or organization_id in (...)`. A
-- NULL tenant satisfies the first branch for EVERY member of EVERY organization,
-- so a row written without a tenant is readable by all of them. Measured: bob
-- read alice's tenant-less row.
--
-- The branch is removed rather than narrowed. A log line that belongs to no
-- tenant has no reader who is entitled to it, and R1 says a write without a
-- tenant does not ship.
--
-- Rows that already exist with a NULL tenant become invisible to everyone
-- instead of visible to everyone. That is the safe direction: they are still
-- there, still reachable by the owner for triage, and the contract migration
-- decides their fate once someone has looked at them.

drop policy if exists "logs_select_member" on public.activity_logs;
create policy "logs_select_member" on public.activity_logs
  for select using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "logs_insert_member" on public.activity_logs;
create policy "logs_insert_member" on public.activity_logs
  for insert with check (organization_id in (select public.current_user_org_ids()));

-- NOT VALID: new writes must carry a tenant, existing NULL rows are tolerated
-- until the contract migration. Validating this is the contract step.
alter table public.activity_logs
  add constraint activity_logs_organization_id_not_null
  check (organization_id is not null) not valid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. agent_runs: the same shape, the same leak
-- ─────────────────────────────────────────────────────────────────────────────
-- `business_id is null or ...`, so a run recorded without a business is
-- readable and writable by every organization. Measured: bob read alice's run.

drop policy if exists "runs_rw_member" on public.agent_runs;
create policy "runs_rw_member" on public.agent_runs
  for all using (
    business_id in (
      select id from public.businesses
      where organization_id in (select public.current_user_org_ids())
    )
  )
  with check (
    business_id in (
      select id from public.businesses
      where organization_id in (select public.current_user_org_ids())
    )
  );

alter table public.agent_runs
  add constraint agent_runs_business_id_not_null
  check (business_id is not null) not valid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. content_assets.service_id could point at another tenant
-- ─────────────────────────────────────────────────────────────────────────────
-- The policy filters by business_id and never looks at service_id, and nothing
-- structural tied the two together. Measured: alice linked her asset to bob's
-- service and the write was accepted.
--
-- A composite foreign key makes it impossible rather than merely forbidden. It
-- needs a unique key on the parent side to point at; (business_id, id) is
-- already unique because id alone is, so this adds an index, not a restriction.

alter table public.business_services
  add constraint business_services_business_id_id_key unique (business_id, id);

-- NOT VALID so the migration does not fail on rows that are already crossed.
-- Validated immediately below, separately: that way a violation reports as a
-- failed VALIDATE naming the row, instead of a failed ALTER naming nothing.
alter table public.content_assets
  add constraint content_assets_service_same_business_fkey
  foreign key (business_id, service_id)
  references public.business_services (business_id, id)
  on delete set null
  not valid;

alter table public.content_assets
  validate constraint content_assets_service_same_business_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. N primary locations at once
-- ─────────────────────────────────────────────────────────────────────────────
-- is_primary defaulted to true with nothing restricting it, so every location
-- inserted without an explicit value claimed to be the primary one and the code
-- picked whichever row came back first. Measured: 2 of 2.
--
-- Two changes, and both are needed. The unique index alone would turn the
-- second location of any business into an error, because the default would
-- still be claiming primacy. The default alone would leave the existing
-- duplicates in place.

update public.business_locations l
   set is_primary = false
 where l.is_primary
   and exists (
     select 1 from public.business_locations e
      where e.business_id = l.business_id
        and e.is_primary
        and (e.created_at, e.id) < (l.created_at, l.id)
   );

alter table public.business_locations alter column is_primary set default false;

create unique index if not exists business_locations_one_primary_per_business
  on public.business_locations (business_id) where is_primary;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Children migrate tenant in silence
-- ─────────────────────────────────────────────────────────────────────────────
-- Every child table stores business_id and nothing else, so their tenant is
-- whatever the parent says it is at this instant. Changing
-- businesses.organization_id moves all of them at once, with no write to any of
-- them and no trace in any of them. Measured: bob read 2 locations authored
-- inside alice's tenant.
--
-- The canonical answer is a composite key: organization_id on every child and a
-- (org_id, business_id) foreign key, which makes the move structurally
-- impossible. That is ten tables, a backfill and ten policy rewrites, and it is
-- a front of its own.
--
-- What this does instead is refuse the move. It is not the canonical shape, but
-- it closes the hole completely and today: there is no path by which a child
-- row changes tenant without someone being told no. When the composite keys
-- land, this trigger is deleted by the same migration that adds them.
--
-- Deliberately not offering a "sanctioned transfer" path. Moving a business
-- between organizations is a product decision nobody has made, and inventing
-- one inside a migration is how handle_new_user() happened.

create or replace function public.reject_business_reparenting()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception
      'A business cannot change organization: % child tables reference it by '
      'business_id alone and would follow it across tenants without a write of '
      'their own. Move the data explicitly, or add the composite tenant key '
      'first.', 10
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_businesses_no_reparenting on public.businesses;
create trigger trg_businesses_no_reparenting
  before update of organization_id on public.businesses
  for each row execute function public.reject_business_reparenting();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ENABLE without FORCE
-- ─────────────────────────────────────────────────────────────────────────────
-- ENABLE ROW LEVEL SECURITY exempts the table owner. Anything connecting as the
-- owner — a migration, a maintenance job, a console session — is outside
-- isolation entirely. Measured: 0 of 15 tables had FORCE.
--
-- This does not affect Supabase's service_role, which carries BYPASSRLS and is
-- unaffected by FORCE either way. It closes the case where the connection is
-- the owner and nothing else.

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
       and not c.relforcerowsecurity
  loop
    execute format('alter table public.%I force row level security', t.relname);
  end loop;
end
$$;

commit;
