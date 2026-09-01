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
docker exec growthos-replica psql -U postgres -d growthos \
    -v ON_ERROR_STOP=1 -f /tmp/forma_canonica.sql
```

`replica.sh` builds a throwaway PostgreSQL from this repo's own migrations, in
order, with the auth objects stubbed from the same file the CI job uses — and
since 2026-08-26 that stub also sets **Supabase's default privileges**, so the
replica starts where the hosted project starts. Without them the replica was
BUILT SAFER THAN PRODUCTION: in a Supabase project every new object in `public`
is born with `GRANT ALL` for `anon`, `authenticated` and `service_role`, and on
a bare PostgreSQL it is born with nothing, so a migration relying on *"nobody
has permission until I grant it"* passed green here and left the permission open
there.

Measured when it was added: **zero lines of the fingerprint moved.** This repo's
migrations declare their ACLs explicitly enough that the change of starting
point reveals nothing — which is the answer to whether these checks were
measuring the replica or the product. The same change in Lead Engine moved
twelve lines and uncovered `anon` holding `UPDATE` on all twelve of its
sequences.
`defects_test.sql` then runs forty-nine isolation checks as a NOSUPERUSER NOBYPASSRLS
role — as the owner they would prove nothing, since the owner is exempt from
every policy that is not FORCEd. Exit 0 means the schema refuses all forty-nine.
The count is written by hand in five places inside that file and is a gate, not
a nuisance: a check that silently stops recording a result would otherwise leave
the report lying by omission.

Check 13 is the odd one and worth knowing about before it surprises someone: it
is the only one where the DEFECT is an object being present rather than absent.
It used to be the reverse — see below.

Checks 15 to 19 arrived with `0013` and are about how a member is taken off an
organisation: it archives, never deletes. They are the only ones that measure a
BEHAVIOUR the canonical cannot — its tenant resolver reads a GUC and never
touches `org_members`, so archiving somebody there cannot cut anything.

Checks 37 to 45 arrived with `0017` and guard the property mapping, which with
an agency-wide Google token IS the boundary between clients: one token reaches
every client's data, so the only thing deciding whose numbers land in a report
is which property was queried. Two of them look like duplicates and are not.
**38** asks whether `growthos_app` — the replica's stand-in for a browser
session — can write a mapping. **45** asks the same of `authenticated` itself,
the role the migration actually names, because the privilege stopping
`growthos_app` lives in `supabase/qa/app_role.sql` and not in `0017`. Measured
2026-08-29: without 45, regranting write to `authenticated` inside the migration
left every other check green.

Checks 46 to 49 arrived with `0018` and cover the two tables the lead ingest
writes into. **46 and 47** are the ordinary pair for a new tenant table —
cross-tenant read, and whether a new permissive policy widens it — and `contacts`
earns them because it holds personal data, including `source`, the field you have
to be able to answer with when somebody exercises a GDPR right.

**48 and 49** are about `ingest_events`, which is deliberately different: it is a
platform table like `schema_migrations`, with no RLS, so **the privilege is its
entire isolation**. 48 asks whether the browser-side role can WRITE it — claiming
another lead's idempotency key would make the real delivery be rejected as a
duplicate, so the client is never created and the producer records a successful
delivery. A client lost with no error in any log. 49 asks whether
`authenticated` can READ it, which without RLS returns which clients entered and
when across the whole platform. It is the only check in the file where the defect
is a SELECT that works, and it exists for the reason check 45 does: the privilege
stopping `growthos_app` lives in `app_role.sql`, so what the migration declares
for `authenticated` would otherwise be measured by nobody.

`forma_canonica.sql` is the third step and it is not an isolation check. The
canonical shape of a `property_ref` lives in two places — the `CHECK` in `0017`
and `src/lib/integrations/google/mapping.ts`, which repeats it in JavaScript so
the operator gets "expected properties/N" instead of a PostgreSQL error. Two
copies of a rule drift; this is what says so when they do. Its other half is the
`describe("los patrones están clavados a un literal escrito")` block in
`mapping.test.ts`: each side writes the same three patterns as its own literal,
so changing one alone turns something red.

The `schema isolation` job in CI runs exactly these steps on every pull
request, so a migration that reopens one of them cannot merge.

**How a tenant is resolved.** Every table that belongs to an organization
stores `organization_id` itself, and every child of `businesses` is tied to it
by a composite foreign key `(organization_id, business_id)` referencing
`businesses (organization_id, id)`. A row therefore cannot claim a tenant its
parent does not have, and a business cannot change organization while it owns
child rows. Policies read `organization_id` off the row; none of them resolves
a tenant through a subquery against another table.

**Writers supply `organization_id` themselves.** They did not always: a
`BEFORE INSERT` trigger filled it from `business_id` on ten tables, which is why
the application could ignore the column. That was scaffolding, and `0012`
removed it — the function and all ten triggers — once every writer sent the
value. The column is `NOT NULL` everywhere except `agent_runs`, whose
`business_id` is nullable, so an INSERT that omits it is now refused rather than
quietly completed.

Two things keep it that way, one on each side.
`src/lib/store/__tests__/tenantOnInsert.test.ts` reads the exact argument of
every `.insert(` into a tenant-scoped table — parentheses balanced, comments
stripped — and fails if one leaves the column out. Check 13 of `defects_test.sql`
fails if the function or any of its triggers comes back. Neither is optional:
the reason the trigger had to go is that a `NOT NULL` column is a fact the
catalogue enforces, while *"a trigger will get there first"* is not, and no
migration can validate the second one.

The order in which that happened was the whole risk, and it is recorded in
`0012` itself: the INSERTs run in the browser, so the writers had to be live in
production **before** the triggers came out. Dropping them first would not have
failed a deploy — a tab holding the old bundle would simply have started writing
tenant-less rows.

**Writers need a session.** Supabase grants every privilege on public tables to
`anon` by default, and the anon key ships in the browser bundle. Check 10 refuses
any write policy that applies to PUBLIC without checking anything — the shape
`pagespeed_cache` had, and which let an unauthenticated upsert through PostgREST
return 201 against a real project.

Adding a migration means adding its check here too. A defect that is only ever
read about is a claim; the file is what makes it a measurement.

### Nothing applies these migrations for you

Measured, because it is easy to assume otherwise: no part of this repository
applies `supabase/migrations/` to the hosted project. Not the CI workflow —
that applies them to a throwaway PostgreSQL so the assertions have a schema to
run against; not `vercel.json`; not a `package.json` script. They reach
`tpqiltnskfeycnybczgz` because somebody applies them by hand.

A process like that drifts, and drift does not announce itself. So there is a
way to look:

```bash
./supabase/qa/replica.sh
docker exec growthos-replica psql -U postgres -d growthos \
    -tAf /tmp/schema_fingerprint.sql > local.txt
# paste supabase/qa/schema_fingerprint.sql into the hosted SQL editor, save as hosted.txt
diff local.txt hosted.txt
```

Each line is one object and a hash of what defines it, so a difference names the
object rather than reporting that something, somewhere, differs.

The example that earned the file: run this way, the diff once came back as
exactly migration `0006` — three columns whose `NOT NULL` was missing on hosted,
and the two `NOT VALID` checks the migration removes — while every other
category was byte-identical. `0006` was merged and green in CI, and nothing else
anywhere would have told you it was not on the database.

The numbers move every time a migration is applied, so this paragraph does not
quote a current one. The `deriva` job below reports the live figure.

### Asking a database what it has

Since `0008` there is a table that answers directly, instead of the diff above
being the only way to find out:

```sql
SELECT version, applied_at FROM public.schema_migrations ORDER BY version;
```

Every migration writes its own row as its last statement, with
`ON CONFLICT DO NOTHING` so re-applying one is not an error. There is no runner
doing it, because the runner is a person — and a person forgets.
`src/lib/store/__tests__/migrationsRegistered.test.ts` is what makes sure they
do not have to remember: it fails if a migration does not register itself, if
the numbering has a gap, or if `0008` stops backfilling one of the seven that
came before it.

**Applying a migration to hosted, in full:**

1. Read `schema_migrations` on the hosted project to see what is already there.
2. Apply the pending files, in order, in the SQL editor.
3. Re-read `schema_migrations` — the new rows should be there, written by the
   migrations themselves.
4. Run `schema_fingerprint.sql` on both sides and `diff` them. Zero differences
   is the point; anything else means the file did something different there than
   it did locally.

Step 4 is not ceremony. It is how the `0007` grants were found in the first
place: the schema in the repository and the schema in the database can differ
in ways no migration in the repository accounts for.

### And something that checks without being asked

Those four steps only run when somebody remembers. `.github/workflows/drift.yml`
runs them on every push to `main`, once a day, and on demand: it reads
`schema_migrations`, works out what is missing, compares the fingerprint against
a schema built from that commit's migrations, and fails naming what differs. It
**applies nothing** — reading and comparing is all it does.

It needs one secret, and that is the one part of this that cannot come from the
repository:

```bash
gh secret set SUPABASE_DB_URL --repo pablomalce/morby-local-seo-platform
```

Read-only credentials are enough. Without the secret the job does not fail; it
prints what is missing and writes it into the run summary, because breaking
every build until someone configures a secret is a reliable way to make the
warning stop being read.

Verified against a second database standing in for hosted: a missing migration,
a version present in the database but not in the repository, and an index
created outside the migrations are each caught and named. The last one is the
case nothing else here would have seen.

## Verifying a test by breaking what it measures

A green test says nothing until you have seen it go red for the right reason.

```bash
./scripts/mutar.sh --linea-base
./scripts/mutar.sh <file> '<text to find>' '<replacement>' --espera <test file>
```

The replacement is literal, not a regex, and the file is always restored. What
the script buys over doing it by hand is that it separates, **by construction**,
the three ways a mutation reports a red without having proved anything — all
three have happened in this project and all three look identical in a terminal:

| result | what it means |
|---|---|
| `NO APLICADA` | the text was not in the file; nothing ran, and the code was never changed |
| `NO CARGA` | fewer tests *executed* than the baseline: the file stopped parsing, so no assertion was reached |
| `CAYÓ` | tests failed, and it names which ones — `--espera` flags any that live in another file |
| `SOBREVIVIÓ` | the code changed and everything stayed green: the test is wrong, not the mutation |

`CAYÓ` on a block in another file is the subtle one: something went red, and it
was not the test being verified.

Schema-side mutations go through `replica.sh` instead, and `defects_test.sql`
already separates the same three cases: it refuses to report unless all
forty-five checks recorded a result, and it names the check that fell.

## Google integrations, per organization

`/app/integrations` is where the property mapping is operated. It exists because
with an agency-wide token the mapping is the boundary between clients, and doing
that with a hand-written INSERT against production is the most expensive
possible way to make a typo.

It shows the four states — connected, not connected, expired, error — and, next
to each, **where it is fixed**. Two of those reasons share a state and are fixed
in different places: `platform-not-connected` is fixed once, in Google Cloud, by
whoever operates the platform; `client-not-mapped` is fixed per client, on this
screen. Showing both as "not connected" sends an operator to configure a client
that is already fine.

**The mapping is written from the server, with `service_role`.** `0017` grants
`authenticated` SELECT and nothing else, and that is not tidiness: a browser
session able to INSERT here can point ITS organization at another client's
property — the row is legitimately its own, so RLS approves it — and the agency
token then serves it the other client's data in its own report. The isolation
holds on the ROW and the leak happens in the CONTENT, so no policy can see it.
Checks 38 and 45 measure both halves.

### Which organization is the agency: `VULKAN_AGENCY_ORG_ID`

Access to Google is delegated: ONE OAuth token, held by the Vulkan account, with
permission over every client's properties. So there is one row in
`integration_tokens` and something has to say whose. That something is an
environment variable holding the organization's UUID.

It was chosen over a column on `organizations` and over a platform singleton
table for what it costs to undo: there is nothing to migrate, and moving it into
the schema later is a trivial migration. Removing a column that already has data
and policies hanging off it is not.

**The screen reports seven states, and four of them are ways of not having an
answer.** `active`, `expired` and `revoked` are what
`public.integration_token_state()` returns when there IS a row. The other four
each have their own fix:

| state | what it means | where it is fixed |
|---|---|---|
| `absent` | the agency is identified and has no token | run the OAuth consent, once |
| `unset` | `VULKAN_AGENCY_ORG_ID` is not set | set it; Google is untouched |
| `malformed` | it is set to something that is not a UUID | correct the value |
| `unreadable` | the lookup failed | investigate; the token may be fine |

`unset`, `malformed` and `unreadable` show as `error` and never as "not
connected". They say nothing about the token, which may well be active — showing
them as "not connected" would send someone to redo an OAuth that is already
done. `absent` is the only one of the four that IS "not connected", because
there the lookup succeeded and the answer was that no token exists.

**Validating the UUID is what stops the worst of these.** Without it, a mistyped
id queries an organization that does not exist, finds no row, and the screen says
"run the OAuth" — someone runs it, it is stored under the correct id, and the
screen keeps saying the same thing. The right answer for the wrong reason, which
is the defect this repository has been removing since #55.

**The state is read with `service_role`, not as the user.** `0014` grants
`authenticated` SELECT on `integration_tokens`, but RLS limits it to the
organizations it belongs to — and whoever is looking at this screen may not be a
member of the agency. Reading it as the user would return zero rows and claim
there is no token over one that exists and works. What is read are two
timestamps of one organization; the `secret_id` and the Vault are never touched.

### The OAuth consent, and the custody it fills

`0014` built the cabinet — the table, the reference into `vault.secrets`, the
distinction between expired and revoked — before there was a token to put in it.
`0021` adds the key, and it has to live in SQL for two reasons: `supabase-js`
only reaches the `public` schema, and creating the secret and writing the row
that references it are two writes that have to be one. A crash between them
leaves an orphaned secret in the Vault — a client's token, encrypted, with no
owner. Same argument as `0019`.

| function | what it is for |
|---|---|
| `store_integration_token` | a NEW authorization: revokes the live one, encrypts the secret, inserts the row |
| `refresh_integration_token` | the SAME authorization with a new access token: replaces the secret in place |
| `integration_token_secret` | the decrypted secret of the live row — the only object in `public` that returns a token |

**All three are `SECURITY INVOKER`, which is the opposite of `0019`, and that was
measured before it was written.** `service_role` already has BYPASSRLS, USAGE on
`vault`, EXECUTE on `vault.create_secret` and SELECT on `vault.decrypted_secrets`;
`authenticated` has none of the four. So `SECURITY DEFINER` would not add a
capability, it would add a loan — and lending the owner's Vault privileges is the
kind of thing that becomes irreversible in silence.

**And the EXECUTE grants are not decorative because of that.** Checks 54 to 57
measure them, and they assert on the error MESSAGE and not just on the SQLSTATE:
with `authenticated` removed from `0021`'s REVOKE, the call still dies with
`permission denied for schema vault`, which is also `42501`. Measured on
2026-09-01 — those checks stayed GREEN with the line that protects them deleted.
Checks 58 to 61 measure behaviour instead of privilege: that a second connection
leaves exactly one live token, that a refresh does not mint a row, that a blank
secret is refused, and that refreshing a connection that does not exist returns
`false`.

**The flow itself is two thin routes and one pure module.**
`/api/auth/google/start` checks that the caller is a member of the agency
organization, draws a `state` with `randomBytes`, keeps a copy in an `httpOnly`
cookie, and redirects to Google. `/api/auth/google/callback` compares the state
BEFORE exchanging anything, re-checks the membership, exchanges the code, and
stores in one RPC. The cookie is deleted on every path: a `state` that survives
its own exchange is a reusable one.

`access_type=offline` and `prompt=consent` are both required and both fail
quietly. Without the first, Google returns only an access token and there is
nothing to refresh tomorrow. Without the second, the SECOND consent by the same
account returns no refresh token at all — so reconnecting, which is what one does
when something is wrong, would produce a connection with no way to refresh.

### The numbers themselves: Search Console and GA4

`statusForResolution()` is gone. It used to return `error` for a source whose
preconditions were met, which was honest — nobody had fetched anything — and the
test that asserted it said, in writing, that the day the client existed the
expectation would change to `live`, and that the change would be the signal the
seam got used. That is what happened.

`hydrateGoogle()` orders the three layers that were already there and adds none:
`sources.ts` decides without asking Google, `tokenStore.ts` produces an access
token or one of six reasons there is none, and `status.ts` translates what Google
answered. The agency token is fetched ONCE for all three surfaces — it is one
token, and asking per surface would also mean three refreshes racing to write the
same row.

**The failure that gets lost is zero versus nothing.** A property with no traffic
answers 200 with no `rows`; a broken body may also have no `rows`. Read as
`rows?.[0]?.clicks ?? 0` both become "0 clicks", once truthfully and once because
something failed — and a zero draws nobody's attention. Search Console
distinguishes them; GA4 has its own version of the same trap, because it returns
numbers as STRINGS and `Number("")` is 0.

**Google Business Profile is still not queried**, and shows `error` when mapped.
Its API has no approved quota yet, so saying `live` would be the right answer for
the wrong reason. The place the call goes is marked in `hydrate.ts`.

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
