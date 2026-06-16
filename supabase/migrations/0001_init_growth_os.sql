-- =============================================================================
-- VULKAN GROWTH OS — Initial schema
-- =============================================================================
-- Multi-tenant SaaS schema with Row Level Security (RLS) enforcing
-- organization-scoped isolation. All app data is rooted at Organization.
--
-- Apply this in Supabase SQL Editor (Project → SQL Editor → New query).
-- Safe to re-run: every statement is guarded with IF NOT EXISTS where possible.
-- =============================================================================

-- Extensions ------------------------------------------------------------------

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Trigger helper (no table refs — safe to declare up front)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- Organizations + membership
-- =============================================================================

create table if not exists public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  default_locale text not null default 'en',
  default_currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_orgs_updated_at on public.organizations;
create trigger trg_orgs_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table if not exists public.org_members (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','manager','editor','viewer')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists idx_org_members_user on public.org_members(user_id);
create index if not exists idx_org_members_org on public.org_members(organization_id);

-- Helper function that depends on org_members. Defined here, AFTER the table.
create or replace function public.current_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.org_members
  where user_id = auth.uid();
$$;

-- =============================================================================
-- Businesses + scoped resources
-- =============================================================================

create table if not exists public.businesses (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  website text not null default '',
  industry text not null default 'other',
  brand_tone text not null default '',
  primary_locale text not null default 'en',
  value_proposition text not null default '',
  logo_color text not null default '#EF4C24',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_businesses_org on public.businesses(organization_id);
drop trigger if exists trg_businesses_updated_at on public.businesses;
create trigger trg_businesses_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();

create table if not exists public.business_locations (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  label text not null default 'Main',
  address_line text not null default '',
  city text not null default '',
  region text not null default '',
  country text not null default '',
  primary_geo_query text not null default '',
  latitude double precision,
  longitude double precision,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_locations_business on public.business_locations(business_id);

create table if not exists public.business_services (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  primary_keyword text not null default '',
  supporting_keywords jsonb not null default '[]'::jsonb,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, slug)
);
create index if not exists idx_services_business on public.business_services(business_id);

create table if not exists public.competitors (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid references public.business_locations(id) on delete set null,
  name text not null,
  website text,
  rating numeric(2,1),
  review_count integer,
  strength_score integer not null default 0,
  relevance_score integer not null default 0,
  strengths jsonb not null default '[]'::jsonb,
  weaknesses jsonb not null default '[]'::jsonb,
  opportunities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_competitors_business on public.competitors(business_id);

create table if not exists public.reviews (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid references public.business_locations(id) on delete set null,
  author text not null,
  rating integer not null check (rating between 1 and 5),
  text text not null,
  service_mentioned text,
  suggested_reply text,
  status text not null default 'draft' check (
    status in ('draft','pending_review','approved','rejected','scheduled','published','archived')
  ),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reviews_business on public.reviews(business_id);

create table if not exists public.content_assets (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id uuid references public.business_services(id) on delete set null,
  locale text not null default 'en',
  kind text not null,
  title text,
  body text not null,
  target_keyword text,
  status text not null default 'draft' check (
    status in ('draft','pending_review','approved','rejected','scheduled','published','archived')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_content_business on public.content_assets(business_id);

create table if not exists public.social_image_assets (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id uuid references public.business_services(id) on delete set null,
  location_id uuid references public.business_locations(id) on delete set null,
  platform text not null,
  aspect_ratio text not null,
  visual_style text not null default '',
  campaign_goal text not null default '',
  audience text not null default '',
  language text not null default 'en',
  brand_tone text not null default '',
  prompt text not null,
  caption text not null,
  hashtags jsonb not null default '[]'::jsonb,
  alt_text text not null default '',
  cta text not null default '',
  image_url text not null,
  provider text not null default 'demo',
  status text not null default 'pending_review' check (
    status in ('draft','pending_review','approved','rejected','scheduled','published','archived')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_image_assets_business on public.social_image_assets(business_id);

create table if not exists public.campaigns (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  goal text not null default '',
  start_date date,
  end_date date,
  status text not null default 'draft' check (status in ('draft','active','paused','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_tasks (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'Growth',
  priority text not null default 'Medium',
  impact text not null default 'Medium',
  difficulty text not null default 'Medium',
  week integer,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tasks_business on public.platform_tasks(business_id);

create table if not exists public.reports (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null,
  kind text not null default 'weekly',
  locale text not null default 'en',
  summary text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_runs (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete set null,
  agent_id text not null,
  scope text not null,
  scope_id text not null,
  status text not null default 'idle' check (status in ('idle','queued','running','completed','failed')),
  input jsonb,
  output text,
  error text,
  tokens_used integer,
  cost_usd numeric(10,4),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_agent_runs_business on public.agent_runs(business_id);

create table if not exists public.activity_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  scope text not null,
  scope_id text not null,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- Auth bootstrap — auto-create an Organization for every new user
-- =============================================================================
-- When a user signs up via Supabase Auth (magic link), this trigger:
--   1. Creates an Organization named after them.
--   2. Adds them as owner.
-- Each user is isolated by default; later they can invite teammates.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  base_slug text;
  unique_slug text;
  counter integer := 0;
begin
  base_slug := regexp_replace(lower(coalesce(new.email, 'user')), '[^a-z0-9]+', '-', 'g');
  base_slug := regexp_replace(base_slug, '(^-|-$)', '', 'g');
  unique_slug := base_slug;
  while exists(select 1 from public.organizations where slug = unique_slug) loop
    counter := counter + 1;
    unique_slug := base_slug || '-' || counter::text;
  end loop;

  insert into public.organizations (name, slug)
  values (coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Personal'), unique_slug)
  returning id into new_org_id;

  insert into public.org_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.businesses enable row level security;
alter table public.business_locations enable row level security;
alter table public.business_services enable row level security;
alter table public.competitors enable row level security;
alter table public.reviews enable row level security;
alter table public.content_assets enable row level security;
alter table public.social_image_assets enable row level security;
alter table public.campaigns enable row level security;
alter table public.platform_tasks enable row level security;
alter table public.reports enable row level security;
alter table public.agent_runs enable row level security;
alter table public.activity_logs enable row level security;

-- organizations -----------------------------------------------------------------
drop policy if exists "orgs_select_member" on public.organizations;
create policy "orgs_select_member" on public.organizations
  for select using (id in (select public.current_user_org_ids()));

drop policy if exists "orgs_update_owner" on public.organizations;
create policy "orgs_update_owner" on public.organizations
  for update using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = organizations.id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

-- org_members -------------------------------------------------------------------
drop policy if exists "members_select_self_org" on public.org_members;
create policy "members_select_self_org" on public.org_members
  for select using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "members_owner_write" on public.org_members;
create policy "members_owner_write" on public.org_members
  for all using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = org_members.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

-- businesses --------------------------------------------------------------------
drop policy if exists "businesses_rw_member" on public.businesses;
create policy "businesses_rw_member" on public.businesses
  for all using (organization_id in (select public.current_user_org_ids()))
  with check (organization_id in (select public.current_user_org_ids()));

-- business_locations
drop policy if exists "locations_rw_member" on public.business_locations;
create policy "locations_rw_member" on public.business_locations
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

-- business_services
drop policy if exists "services_rw_member" on public.business_services;
create policy "services_rw_member" on public.business_services
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

-- competitors
drop policy if exists "competitors_rw_member" on public.competitors;
create policy "competitors_rw_member" on public.competitors
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

-- reviews
drop policy if exists "reviews_rw_member" on public.reviews;
create policy "reviews_rw_member" on public.reviews
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

-- content_assets
drop policy if exists "content_rw_member" on public.content_assets;
create policy "content_rw_member" on public.content_assets
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

-- social_image_assets
drop policy if exists "images_rw_member" on public.social_image_assets;
create policy "images_rw_member" on public.social_image_assets
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

-- campaigns
drop policy if exists "campaigns_rw_member" on public.campaigns;
create policy "campaigns_rw_member" on public.campaigns
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

-- platform_tasks
drop policy if exists "tasks_rw_member" on public.platform_tasks;
create policy "tasks_rw_member" on public.platform_tasks
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

-- reports
drop policy if exists "reports_rw_member" on public.reports;
create policy "reports_rw_member" on public.reports
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

-- agent_runs
drop policy if exists "runs_rw_member" on public.agent_runs;
create policy "runs_rw_member" on public.agent_runs
  for all using (
    business_id is null
    or business_id in (
      select id from public.businesses
      where organization_id in (select public.current_user_org_ids())
    )
  )
  with check (
    business_id is null
    or business_id in (
      select id from public.businesses
      where organization_id in (select public.current_user_org_ids())
    )
  );

-- activity_logs
drop policy if exists "logs_select_member" on public.activity_logs;
create policy "logs_select_member" on public.activity_logs
  for select using (
    organization_id is null
    or organization_id in (select public.current_user_org_ids())
  );

drop policy if exists "logs_insert_member" on public.activity_logs;
create policy "logs_insert_member" on public.activity_logs
  for insert with check (
    organization_id is null
    or organization_id in (select public.current_user_org_ids())
  );
