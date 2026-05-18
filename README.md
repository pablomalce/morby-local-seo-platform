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
