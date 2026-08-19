# Local Growth OS — AI Local Growth Platform

A universal, multi-tenant, AI-powered Local Growth & Marketing Intelligence Platform. It helps
agencies, consultants, business owners and marketing teams manage local SEO, Google Business
Profile optimisation, competitor analysis, reputation, reviews, content, social media, AI image
generation, reports, analytics, tasks and 90-day growth planning — reusable across any business
type (beauty clinics, dental, restaurants, cafes, retail, professional services, franchises,
gyms, spas, salons, home services and more).

> Originally seeded from the **Mörby Fotvård och Skönhet** MVP. Phase 1 has evolved that MVP into
> a universal foundation that already ships three demo tenants across different industries.

## Phase 1 — what is included

- **Universal multi-tenant data model** (Organization → Business → Location → Service → ...).
- **Three demo businesses** across distinct industries (beauty clinic, dental, restaurant).
- **Business / Service selectors** with persisted selection — every page reacts.
- **i18n scaffold** for English, Spanish and Swedish with a single dictionary source.
- **Generic agent registry** with platform/org/business/location/service/campaign scopes.
- **Social Content Agent** + **Social Image Agent** scaffolds.
- **Image Generation Studio** with provider abstraction (OpenAI ready, demo SVG generator).
- **Polished UX**: header with tenant switching, status pills, premium SaaS feel.
- **Workflow states** (`draft → pending_review → approved → scheduled → published → archived`).
- **API routes refactored** to accept `businessId` / `scope` parameters universally.
- **Expanded Prisma schema** ready for Phase 2 PostgreSQL migration.

## Tech stack

Next.js App Router · React 18 · TypeScript · Tailwind CSS · Recharts · lucide-react · Prisma ·
Zod · next-themes · framer-motion-ready. SQLite for local dev — Phase 2 swaps to PostgreSQL via
Supabase without changing model shapes.

## Run locally

```bash
cp .env.example .env.local
npm install
npx prisma generate
npm run dev
```

Open <http://localhost:3000>.

## Schema and tenant isolation

The schema is the other half of this repo, and the tests above run against
doubles: they prove the LOGIC, never that one tenant is isolated from another.
That is what `supabase/qa/` is for, and it needs no Supabase project.

```bash
./supabase/qa/replica.sh
docker exec growthos-replica psql -U postgres -d growthos \
    -v ON_ERROR_STOP=1 -f /tmp/defects_test.sql
```

`replica.sh` builds a throwaway PostgreSQL from this repo's own migrations, in
order, with the auth objects stubbed from the same file the CI job uses.
`defects_test.sql` then runs ten isolation checks as a NOSUPERUSER NOBYPASSRLS
role — as the owner they would prove nothing, since the owner is exempt from
every policy that is not FORCEd. Exit 0 means the schema refuses all ten.

The `schema isolation` job in CI runs exactly these two steps on every pull
request, so a migration that reopens one of them cannot merge.

**How a tenant is resolved.** Every table that belongs to an organization
stores `organization_id` itself, and every child of `businesses` is tied to it
by a composite foreign key `(organization_id, business_id)` referencing
`businesses (organization_id, id)`. A row therefore cannot claim a tenant its
parent does not have, and a business cannot change organization while it owns
child rows. Policies read `organization_id` off the row; none of them resolves
a tenant through a subquery against another table.

Writers do not have to supply `organization_id`. A `BEFORE INSERT` trigger
fills it from `business_id`, which is why the application code sends the same
INSERTs it always has. That trigger is scaffolding: it is removed once the
writers send the column explicitly, and the column is `NOT NULL` everywhere
except `agent_runs`, whose `business_id` is nullable.

**Writers need a session.** Supabase grants every privilege on public tables to
`anon` by default, and the anon key ships in the browser bundle. Check 10 refuses
any write policy that applies to PUBLIC without checking anything — the shape
`pagespeed_cache` had, and which let an unauthenticated upsert through PostgREST
return 201 against a real project.

Adding a migration means adding its check here too. A defect that is only ever
read about is a claim; the file is what makes it a measurement.

## Project structure (post-Phase 1)

```text
src/app                       App Router pages and API routes (universal)
src/app/studio/images         Image Generation Studio
src/components                UI primitives, layout, charts
src/components/selectors      Business / Service / Locale switchers
src/lib/types/core.ts         Canonical domain types
src/lib/mock/universal.ts     Multi-tenant demo dataset
src/lib/mock/data.ts          Backward-compat shim
src/lib/i18n                  Dictionaries + provider (EN · ES · SV)
src/lib/context               Selection + composed Providers
src/lib/agents/registry.ts    Scope-aware agent registry
src/lib/integrations          Provider abstraction (OpenAI, Places, Image)
prisma/schema.prisma          Universal Prisma schema
```

## Next phases

- **Phase 2** — Auth scaffold, roles, protected routes, Zod-validated APIs, activity/audit logs,
  Postgres migration.
- **Phase 3** — Real OpenAI integration behind server-only routes, agent execution structure,
  social copy + image prompt generation.
- **Phase 4** — Google Places / Search Console / GA4 / GBP integrations with OAuth, caching and
  rate-limit readiness.
