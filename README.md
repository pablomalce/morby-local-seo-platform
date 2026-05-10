# Mörby Local SEO Intelligence Platform

A Phase 1 demo web app for **Mörby Fotvård och Skönhet**. The platform is designed as an AI-powered local SEO command center to help improve visibility for **"ansiktsbehandling danderyd"**.

This first version is intentionally built in **Demo Mode**. It includes the user experience, dashboard, mock data, agent architecture, placeholder API routes and future-ready integration files.

## What is included

- Premium SaaS dashboard
- Competitor Intelligence page
- Google Business Profile Optimization page
- SEO Content Studio with Swedish demo content
- Reviews Strategy page
- 90-Day Strategy Planner
- Reports page with export placeholders
- AI Agent Center with simulated agent runs
- Settings and integration-readiness checklist
- Prisma schema prepared for future persistence
- API route placeholders for agents, content, GBP, SEO audit, reports and Places search
- PWA manifest for installable-app direction

## Tech stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Recharts
- Framer Motion-ready structure
- Lucide icons
- Prisma
- SQLite for local development

## Install on macOS

```bash
cd morby-local-seo-platform
cp .env.example .env.local
npm install
npx prisma generate
npm run dev
```

Open:

```text
http://localhost:3000
```

## Install on Windows

Using PowerShell:

```powershell
cd morby-local-seo-platform
copy .env.example .env.local
npm install
npx prisma generate
npm run dev
```

Open:

```text
http://localhost:3000
```

## Important

This version does **not** connect to real Google or OpenAI APIs yet. It is built to validate the product, user flow and visual interface first.

## Phase 2 recommendation

Implement real OpenAI integration first:

1. Add `OPENAI_API_KEY` to `.env.local`
2. Replace placeholder logic in `src/lib/integrations/openai.ts`
3. Connect the Content Studio and Agents page to the API routes
4. Keep demo mode as fallback

Recommended next prompt:

```text
Implement Phase 2: connect the AI agents and SEO Content Studio to the OpenAI API using server-side API routes only. Keep demo mode as fallback. Do not expose API keys to the frontend. Add loading, error and success states.
```

## Future integrations

- OpenAI API
- Google Places API
- Google Business Profile API with OAuth
- Google Search Console API
- Google Analytics GA4 Data API
- PDF/DOCX/CSV report export
- Real database persistence with Prisma

## Project structure

```text
src/app              App Router pages and API routes
src/components       Reusable UI and layout components
src/lib/mock         Demo data
src/lib/integrations Future API integration layer
src/lib/agents       Agent orchestrator
prisma               Database schema
public               PWA manifest
```

## Product goal

The app should reduce manual work and guide the user toward the next best action for local SEO growth: content, reviews, Google Business Profile optimization, competitor analysis, reporting and 90-day task execution.
