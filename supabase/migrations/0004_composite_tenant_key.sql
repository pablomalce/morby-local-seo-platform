-- Expand: give every child table its own tenant column and a composite key.
--
-- Defect 5 of 0003_expand_tenant_isolation.sql is closed today by a trigger
-- that refuses to reparent a business. That works and it is not the shape the
-- schema should have: the ten child tables still store only business_id, so
-- their tenant remains whatever the parent says it is at this instant. Delete
-- the trigger and the hole is back.
--
-- This migration makes the move structurally impossible instead of merely
-- forbidden. Each child gains organization_id and a composite foreign key
-- (organization_id, business_id) -> businesses (organization_id, id). A parent
-- that changes organization now has to break a foreign key from every child it
-- owns, which PostgreSQL refuses without any trigger being involved.
--
-- Additive for the application. A BEFORE INSERT trigger fills organization_id
-- from business_id when the writer does not supply it, so every INSERT the
-- TypeScript code performs today keeps working unchanged. When the application
-- starts sending the column explicitly, the trigger is dropped by the contract
-- migration. No .ts file is touched by this migration.
--
-- Evidence that the structure -- and not just the trigger -- is what refuses:
-- checks 7 to 9 of supabase/qa/defects_test.sql.

begin;

-- The backfill below must see every row, and 0003 put FORCE ROW LEVEL SECURITY
-- on all of them, which removes the owner's exemption. Without this, the
-- backfill would silently match zero rows and the migration would "succeed"
-- having done nothing. Set explicitly so that a role which cannot do it fails
-- loudly here rather than quietly three statements later.
set local row_security = off;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Parent-side unique keys for the composite foreign keys to point at
-- ─────────────────────────────────────────────────────────────────────────────
-- Neither of these restricts anything: id alone is already the primary key, so
-- any pair containing it is unique by construction. They exist because a
-- foreign key needs a unique constraint on exactly the columns it references.
--
-- business_services already got its (business_id, id) key in 0003, for the
-- content_assets composite key. It is not repeated here.

alter table public.businesses
  add constraint businesses_organization_id_id_key unique (organization_id, id);

alter table public.business_locations
  add constraint business_locations_business_id_id_key unique (business_id, id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The trigger that keeps the application unchanged
-- ─────────────────────────────────────────────────────────────────────────────
-- Fills organization_id from the parent when the writer omits it. It is the
-- single reason this migration needs no application change, and it is the piece
-- that the contract migration removes once the writers send the column.
--
-- Deliberately NOT security definer. Reading businesses here is subject to the
-- same policy the caller is already subject to: if they cannot see the parent,
-- organization_id stays NULL and the write is refused by NOT NULL. Making this
-- definer would let a caller write a child under a business they cannot read.
--
-- Only fills. It never corrects a value the writer supplied: an explicit
-- organization_id that disagrees with the parent must be rejected by the
-- foreign key, not silently rewritten into something that passes.

create or replace function public.fill_organization_id_from_business()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is null and new.business_id is not null then
    select b.organization_id into new.organization_id
      from public.businesses b
     where b.id = new.business_id;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The nine children whose business_id is NOT NULL
-- ─────────────────────────────────────────────────────────────────────────────
-- agent_runs is the tenth and is handled separately below: its business_id is
-- nullable, so it cannot take NOT NULL on the tenant column.
--
-- A loop rather than nine copies. The steps are identical for all nine and a
-- copy that drifts from its eight siblings is the failure mode worth avoiding;
-- the checks in defects_test.sql are what prove the loop actually ran.
--
-- SET NOT NULL is the real guard on the backfill. It scans the whole table and
-- is not filtered by any policy, so a backfill that matched nothing fails here
-- loudly instead of leaving a nullable column that silently disables the
-- composite key (an unmatched NULL makes a MATCH SIMPLE foreign key pass).

do $$
declare
  t text;
begin
  foreach t in array array[
    'business_locations', 'business_services', 'competitors', 'reviews',
    'content_assets', 'social_image_assets', 'campaigns', 'platform_tasks',
    'reports'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists organization_id uuid', t);

    execute format(
      'update public.%I c set organization_id = b.organization_id
         from public.businesses b
        where b.id = c.business_id and c.organization_id is null', t);

    -- Leading column is organization_id because that is what the rewritten
    -- policy filters on; the pair also serves the composite foreign key.
    execute format(
      'create index if not exists idx_%s_org_business on public.%I
         (organization_id, business_id)', t, t);

    execute format(
      'alter table public.%I alter column organization_id set not null', t);

    execute format(
      'drop trigger if exists trg_%s_fill_org on public.%I', t, t);
    execute format(
      'create trigger trg_%s_fill_org before insert on public.%I
         for each row execute function public.fill_organization_id_from_business()',
      t, t);

    -- The single-column foreign key is replaced, not supplemented: the
    -- composite one is strictly stronger and keeping both would leave two
    -- constraints to reason about on every delete.
    execute format(
      'alter table public.%I drop constraint %I', t, t || '_business_id_fkey');

    -- NOT VALID then VALIDATE as a separate statement, so a row that is already
    -- crossed reports as a failed VALIDATE naming the row, instead of a failed
    -- ALTER naming nothing.
    execute format(
      'alter table public.%I add constraint %I
         foreign key (organization_id, business_id)
         references public.businesses (organization_id, id)
         on delete cascade not valid', t, t || '_tenant_fkey');
    execute format(
      'alter table public.%I validate constraint %I', t, t || '_tenant_fkey');
  end loop;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. agent_runs, whose business_id is nullable
-- ─────────────────────────────────────────────────────────────────────────────
-- 0003 left business_id nullable and added agent_runs_business_id_not_null as
-- NOT VALID, because rows without a business already existed. The same applies
-- to organization_id here, and for the same reason: NOT NULL would fail against
-- those rows, and deciding their fate is the contract migration's job.
--
-- A tenant-less run stays invisible to everyone under the rewritten policy,
-- which is the safe direction. What must not happen is a run that HAS a
-- business but no tenant, since a MATCH SIMPLE foreign key does not check a row
-- with a NULL in it: that pair is what the check constraint below forbids, and
-- VALIDATE is what proves the backfill reached every such row.

alter table public.agent_runs add column if not exists organization_id uuid;

update public.agent_runs r set organization_id = b.organization_id
  from public.businesses b
 where b.id = r.business_id and r.organization_id is null;

create index if not exists idx_agent_runs_org_business
  on public.agent_runs (organization_id, business_id);

alter table public.agent_runs
  add constraint agent_runs_tenant_pair_complete
  check (business_id is null or organization_id is not null) not valid;

alter table public.agent_runs
  validate constraint agent_runs_tenant_pair_complete;

drop trigger if exists trg_agent_runs_fill_org on public.agent_runs;
create trigger trg_agent_runs_fill_org before insert on public.agent_runs
  for each row execute function public.fill_organization_id_from_business();

-- ON DELETE SET NULL is kept from the constraint being replaced: deleting a
-- business must not delete the record that an agent ran against it. Both
-- columns go NULL together, which is precisely the state the check constraint
-- above tolerates and the policy hides.
alter table public.agent_runs drop constraint agent_runs_business_id_fkey;

alter table public.agent_runs
  add constraint agent_runs_tenant_fkey
  foreign key (organization_id, business_id)
  references public.businesses (organization_id, id)
  on delete set null
  not valid;

alter table public.agent_runs validate constraint agent_runs_tenant_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The ten policies stop resolving the tenant through the parent
-- ─────────────────────────────────────────────────────────────────────────────
-- Every one of them read `business_id in (select id from businesses where
-- organization_id in (...))`. That was the only way to know a child's tenant
-- while the child did not store it. Now it does.
--
-- Measured, so that the reason claimed here is the real one: reverting a single
-- policy to the subquery form and re-running supabase/qa/defects_test.sql
-- leaves all nine checks green. That is the honest result. Once the composite
-- key exists, the parent's organization_id and the child's are the same value
-- by construction, so both forms resolve to the same tenant and neither is more
-- correct than the other. The rewrite is worth doing for two smaller reasons,
-- and neither of them is "it closes defect 5" -- the foreign key does that:
--
--   * one subquery against businesses disappears from every row of every read;
--   * a row whose business_id is NULL stops being unreadable by definition.
--     Only agent_runs has such rows, and a run its tenant owns but that names
--     no business should be visible to that tenant, not to nobody.

do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('business_locations',  'locations_rw_member'),
      ('business_services',   'services_rw_member'),
      ('competitors',         'competitors_rw_member'),
      ('reviews',             'reviews_rw_member'),
      ('content_assets',      'content_rw_member'),
      ('social_image_assets', 'images_rw_member'),
      ('campaigns',           'campaigns_rw_member'),
      ('platform_tasks',      'tasks_rw_member'),
      ('reports',             'reports_rw_member'),
      ('agent_runs',          'runs_rw_member')
    ) as v(tbl, pol)
  loop
    execute format('drop policy if exists %I on public.%I', p.pol, p.tbl);
    execute format(
      'create policy %I on public.%I for all
         using (organization_id in (select public.current_user_org_ids()))
         with check (organization_id in (select public.current_user_org_ids()))',
      p.pol, p.tbl);
  end loop;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. The grandchildren
-- ─────────────────────────────────────────────────────────────────────────────
-- location_id and service_id are the same hole one level down: nothing tied
-- them to the row's own business, so a competitor of one business could point
-- at a location of another -- including another tenant's, once the tenant
-- column alone is what the policy checks.
--
-- Four constraints, not the five the plan expected: content_assets.service_id
-- already became composite in 0003 and is left alone, beyond dropping the
-- single-column key it made redundant.
--
-- Scoped to (business_id, ...) rather than (organization_id, ...) on purpose. A
-- location belongs to a business, not merely to a tenant, and the tighter of
-- two correct keys is the one to pick.

alter table public.competitors drop constraint competitors_location_id_fkey;
alter table public.competitors
  add constraint competitors_location_same_business_fkey
  foreign key (business_id, location_id)
  references public.business_locations (business_id, id)
  on delete set null not valid;
alter table public.competitors
  validate constraint competitors_location_same_business_fkey;

alter table public.reviews drop constraint reviews_location_id_fkey;
alter table public.reviews
  add constraint reviews_location_same_business_fkey
  foreign key (business_id, location_id)
  references public.business_locations (business_id, id)
  on delete set null not valid;
alter table public.reviews
  validate constraint reviews_location_same_business_fkey;

alter table public.social_image_assets drop constraint social_image_assets_location_id_fkey;
alter table public.social_image_assets
  add constraint social_image_assets_location_same_business_fkey
  foreign key (business_id, location_id)
  references public.business_locations (business_id, id)
  on delete set null not valid;
alter table public.social_image_assets
  validate constraint social_image_assets_location_same_business_fkey;

alter table public.social_image_assets drop constraint social_image_assets_service_id_fkey;
alter table public.social_image_assets
  add constraint social_image_assets_service_same_business_fkey
  foreign key (business_id, service_id)
  references public.business_services (business_id, id)
  on delete set null not valid;
alter table public.social_image_assets
  validate constraint social_image_assets_service_same_business_fkey;

-- Redundant since 0003: content_assets_service_same_business_fkey covers the
-- same reference and adds the business. Two foreign keys where one is a strict
-- subset of the other is two things to keep in step for no gain.
alter table public.content_assets drop constraint content_assets_service_id_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. The reparenting trigger is deleted, as 0003 said it would be
-- ─────────────────────────────────────────────────────────────────────────────
-- Its own comment named the condition for its removal: "when the composite keys
-- land, this trigger is deleted by the same migration that adds them."
--
-- What replaces it is not equivalent, and the difference is worth stating. The
-- trigger refused every reparenting. The foreign keys refuse a reparenting that
-- would carry child rows across tenants -- which is every case where children
-- exist, and is the entire content of defect 5. A business with no children at
-- all can now change organization, because there is nothing to carry and no row
-- whose tenant would change without a write of its own.

drop trigger if exists trg_businesses_no_reparenting on public.businesses;
drop function if exists public.reject_business_reparenting();

commit;
