# Vulkan Growth OS — Phase 4 cost & integration options

> Prepared for: Gerencia · Vulkan Studios
> Document version: 1.0 · June 2026
> Prepared by: Engineering

---

## Executive summary

We've just shipped the heuristic reporting engine — every tenant in Vulkan Growth OS can now produce a structured executive report on demand (current state, prioritized issues, 90-day action plan, KPIs to track) at **zero variable cost**.

The next decision is: **which external data sources do we connect, and which optional LLM layer do we add**, to lift report quality from "demo grade" to "production grade".

This document lays out **four Google API integrations** and **two LLM provider options**, with concrete pricing and the trade-offs of each. Our recommendation is at the end.

---

## What's already shipped (free, zero ongoing cost)

| Capability | Status | Cost |
|---|---|---|
| Multi-tenant SaaS foundation | Live | $0 |
| Supabase Postgres + Auth | Live | $0 — free tier covers 50k MAU |
| Vercel hosting | Live | $0 — Hobby tier handles current scale |
| Vulkan UI Kit applied | Live | $0 |
| GDPR cookie consent + legal pages | Live | $0 |
| Heuristic reporting engine | **Live** | $0 — pure deterministic, no API calls |

**The reporting engine alone is already useful.** It analyses everything we have on a tenant (services, locations, competitors, reviews, content, plan) and outputs a structured report with 25+ heuristics covering GBP, content, reviews, competitive, technical SEO and authority categories.

What it **can't** do without external data: tell you your **real** rank on Google, **real** GBP score, **real** Search Console impressions, or **real** GA4 traffic. For that we need the Google APIs.

---

## Option A — Connect Google Places API

**What you unlock:** real business rating (★ X.X), real total review count from Google, real business categories, place ID for deep-linking. No per-tenant OAuth — single platform-wide key.

**Pricing (Google Cloud Platform, current rates):**

| API | Cost per 1,000 requests | Free tier |
|---|---|---|
| Places Text Search | $32 | $200/month free credit covers ~6,250 calls |
| Place Details (Basic) | $17 | Included in same $200 credit |

**Real cost for typical SaaS usage:**

| Tenants | Reports/tenant/month | Calls/report | Total calls/month | Cost |
|---|---|---|---|---|
| 10 | 4 | 2 | 80 | **$0** (covered by free credit) |
| 50 | 4 | 2 | 400 | **$0** |
| 200 | 4 | 2 | 1,600 | **$0** |
| 1,000 | 4 | 2 | 8,000 | ~$56/month (after free credit) |

**Setup time:** ~10 minutes (create GCP project, enable Places API, generate key, add to Vercel env). No Google verification required.

**Recommendation:** ✅ **Enable now.** Free at our current scale, instant production-grade rating data, no OAuth complexity. Hard limits configurable in GCP to prevent runaway cost.

---

## Option B — Connect Google Search Console API

**What you unlock:** real search positions for every query users find them through, impressions, clicks, CTR per page. This is the **single highest-value SEO data source** because it's what Google itself shows you about your visibility.

**Pricing:** **100% FREE**. No quotas to worry about at our scale (default 1,200 queries/minute per project — we'd hit ~1 query/tenant/day).

**Setup cost:**
- **Time:** ~2-3 days engineering work (OAuth flow per tenant, token storage, refresh logic).
- **Google verification:** Search Console scope is **sensitive but not restricted**. Google may require us to add a privacy policy link in our OAuth consent screen (we already have one). No security audit needed. Approval usually within 5-7 business days.

**Per-tenant friction:** Each user has to grant OAuth permission once during onboarding. ~30 seconds of UX.

**Recommendation:** ✅ **Highest ROI of all options.** Free, unlocks real ranking data that justifies the rest of the platform. Phase 4b candidate.

---

## Option C — Connect Google Business Profile API

**What you unlock:** real GBP score (not heuristic), live post publishing, photo uploads, review monitoring with reply capability, insights (calls, direction requests, website clicks).

**Pricing:** **100% FREE** — all GBP APIs are free.

**Setup cost — this is where it gets harder:**
- **Time:** ~5-7 days engineering work.
- **Google verification:** GBP API uses a **restricted scope**. Google requires:
  1. App verification (privacy policy ✅, terms of service ✅, brand consistency ✅, public OAuth consent screen).
  2. **CASA (Cloud Application Security Assessment) audit** for production. This is an annual independent security audit performed by a Google-approved third-party. **Cost: $5,000–$10,000 USD/year, recurring**.
  3. The audit takes 4–8 weeks to complete.

Until the audit is done, only "test users" (max 100, manually whitelisted by us) can connect their GBP. Useful for closed beta, blocking for public launch.

**Recommendation:** ⏸️ **Defer until we have 5+ paying customers.** The $5–10k/year audit fee only makes sense once GBP integration is a paid feature or competitive necessity. In the meantime, use Places API (Option A) which gives us 80% of the same insights without the audit.

---

## Option D — Connect Google Analytics 4 Data API

**What you unlock:** real website traffic, sessions, conversions, traffic sources, conversion paths. Essential for tying SEO improvements to revenue.

**Pricing:** **100% FREE** — Data API has a generous default quota (200k tokens/property/day, way beyond our scale).

**Setup cost:**
- **Time:** ~3-4 days engineering work.
- **Google verification:** GA4 Data API scope is **non-sensitive**. No verification required for production. Users grant read-only access during OAuth.

**Per-tenant friction:** Same as Search Console — 30 seconds of OAuth during onboarding.

**Recommendation:** ✅ **Pair with Search Console**. Together they make the report's "Traffic" section meaningful instead of synthetic. Phase 4b candidate.

---

## Option E — Add LLM layer for natural-language refinement

The heuristic engine outputs structured data + rule-based copy. An LLM can rewrite the executive summary and issue rationales in more natural language, suggest sharper recommendations, and adapt tone to the business's brand voice.

**This is OPTIONAL.** The heuristic engine is shippable without an LLM. The LLM is a quality multiplier, not a requirement.

### Provider comparison

| Provider | Model | Cost per report (~2k input + 1.5k output tokens) | Quality for SEO reports |
|---|---|---|---|
| OpenAI | gpt-4o-mini | **$0.001** | Good — formulaic, sometimes generic |
| OpenAI | gpt-4o | $0.025 | Excellent |
| Anthropic | **Claude Haiku 4.5** | **$0.003** | **Best in class for reasoning + balance** |
| Anthropic | Claude Sonnet 4.6 | $0.018 | Overkill for this use case |

### Real cost at scale

| Tenants | Reports/month | Cost with Claude Haiku | Cost with gpt-4o-mini |
|---|---|---|---|
| 10 | 40 | **$0.12/month** | $0.04/month |
| 50 | 200 | **$0.60/month** | $0.20/month |
| 200 | 800 | **$2.40/month** | $0.80/month |
| 1,000 | 4,000 | **$12/month** | $4/month |

### Why Claude (Anthropic) over OpenAI

- **Better long-context reasoning.** Reports analyse 2-3k tokens of structured tenant data; Claude handles structured-output tasks more reliably.
- **Less "AI-feel" language.** Claude's outputs read more like a senior consultant, OpenAI's tend toward generic SaaS-speak.
- **Better at following our specific format constraints** (priority levels, action ownership, week scheduling).
- **Anthropic's spending caps** in their console are easier to use than OpenAI's. We can set a $5/month hard limit and never have a surprise bill.

**Important clarification:** Claude Pro/Max subscriptions ($20/month) are **chat-only** — they don't include API access. To use Claude from our backend we'd need a separate Anthropic API account at <https://console.anthropic.com/> with per-token billing. Same model with OpenAI (ChatGPT Plus ≠ API).

**Recommendation:** ⏸️ **Defer until we have 50+ active tenants.** Below that scale, the heuristic engine output is good enough and the $0.60/month is a rounding error not worth the operational complexity.

---

## Recommended roadmap

| Phase | Action | Cost | Time |
|---|---|---|---|
| **4a (now)** | Add Google Places API key | $0 | 10 min setup |
| **4b (next 2 weeks)** | Build Search Console + GA4 OAuth flows | $0 | 5-7 days dev |
| **4c (90-day horizon)** | Add Claude Haiku LLM layer | <$1/month at current scale | 2 days dev |
| **4d (when first paying customer)** | Begin GBP API audit process | $5-10k/year | 6-8 weeks |

**Total cost in next 90 days:** ~$0 (all free tier).

**First real recurring cost:** Only when we cross 1,000+ tenants (Places + Claude usage tipping us past free tiers).

---

## Risk & cost controls

We're not flying blind on cost. Every paid component below has a hard spending limit:

- **Google Cloud Platform**: budget alerts + automatic API disable at threshold ($50/month default cap recommended).
- **Anthropic Console**: hard monthly spend limit ($5/month default — calls fail when reached, no overage).
- **Supabase / Vercel**: free tier hard limits, app degrades gracefully not bills.

**Total worst-case cost if every external service blew up:** $55/month. Set those caps day one.

---

## What we need from gerencia to proceed

1. **GCP project access** — to enable Places API and add the key to Vercel. Can be done by whoever owns the `vulkan-studios.com` Google account.
2. **Approval for Phase 4b time investment** — 5-7 dev days for Search Console + GA4 OAuth scaffold (cost: time only, no $).
3. **Decision on Phase 4c** — green light to set up Anthropic API ($0–$5/month) when we hit 50 tenants, or wait until first paying customer.
4. **Decision on Phase 4d** — green light to start the $5–10k/year GBP audit when our first paying customer needs publishing capability (revenue should cover it 3x over).

---

## Recommendation in one line

**Enable Google Places API this week (free, 10 min). Start Search Console + GA4 OAuth work next week (free, 5-7 days). Hold on LLM and GBP audit until we have customer revenue justifying the recurring costs.**

— Engineering team
