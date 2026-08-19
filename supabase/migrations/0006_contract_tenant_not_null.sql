-- 0006_contract_tenant_not_null.sql — the contract half of #18 and #19, as far
-- as it can go today.
--
-- WHAT THIS CLOSES
--
-- 0003 and 0004 were the expand halves: they added organization_id, backfilled
-- it, and added the NOT NULL checks as NOT VALID so the migration would not
-- take a long lock and would not fail on rows that predated it. A NOT VALID
-- check constrains new rows and says nothing about the ones already there,
-- which is the point of expand — and which is why leaving it at that means the
-- column is still, formally, nullable.
--
-- Measured on tpqiltnskfeycnybczgz before writing this:
--
--   activity_logs_organization_id_not_null   NOT VALID
--   agent_runs_business_id_not_null          NOT VALID
--
-- and three columns still nullable in the catalogue: activity_logs.
-- organization_id, agent_runs.business_id, agent_runs.organization_id.
--
-- WHY IT IS SAFE, MEASURED RATHER THAN ASSUMED
--
-- The application does not write to either table. Not "writes them with the
-- column" — does not write them at all: the only reference to agent_runs in
-- src/ is a select("*") in lib/auth/account-actions.ts, and activity_logs
-- appears solely in the generated types. So SET NOT NULL cannot break an INSERT
-- that does not exist.
--
-- agent_runs.organization_id is included even though it has no NOT VALID check
-- of its own, because trg_agent_runs_fill_org fills it BEFORE INSERT from
-- business_id — and business_id becomes NOT NULL right here, so there is always
-- something to fill it from.
--
-- VALIDATE reads every row and fails if any one violates the check. On a
-- database with tenant-less rows this migration stops, which is correct: those
-- rows are a decision, not something a migration should paper over. The hosted
-- database currently has none — it has no rows at all.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not remove fill_organization_id_from_business() or its ten triggers,
-- and it must not until the application sends organization_id explicitly.
-- Measured, in the code and not from memory: supabaseTenantStore.ts:236 inserts
-- into business_locations with business_id and no organization_id, and the same
-- shape repeats for business_services, competitors, content_assets, reports and
-- reviews. Six live INSERT sites depend on that trigger today. Dropping it
-- would not fail loudly at deploy time — it would start writing tenant-less
-- rows, which is the defect 0003 existed to close.
--
-- That is one release away, and the release is an application change, not a
-- migration.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- activity_logs.organization_id
-- ─────────────────────────────────────────────────────────────────────────────
-- The tenant-less branch in this table's policy was defect 1: the policy read
-- `organization_id IS NULL OR ...`, so a NULL tenant satisfied it for every
-- organization at once. 0003 removed the branch; this makes the column unable
-- to hold the value the branch used to let through.

ALTER TABLE public.activity_logs VALIDATE CONSTRAINT activity_logs_organization_id_not_null;
ALTER TABLE public.activity_logs ALTER COLUMN organization_id SET NOT NULL;

-- The check and the column constraint now say the same thing, and the redundant
-- one is the check: it was scaffolding for the expand half. Removing it takes
-- only a catalogue lock, no table scan.
ALTER TABLE public.activity_logs DROP CONSTRAINT activity_logs_organization_id_not_null;

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_runs
-- ─────────────────────────────────────────────────────────────────────────────
-- business_id first: organization_id is derived from it by the fill trigger, so
-- a run without a business could not have a tenant either.

ALTER TABLE public.agent_runs VALIDATE CONSTRAINT agent_runs_business_id_not_null;
ALTER TABLE public.agent_runs ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_business_id_not_null;

-- No NOT VALID check to validate here — 0004 added the column and the trigger
-- but no constraint. The trigger is what guarantees the value, and business_id
-- being NOT NULL one line above is what guarantees the trigger has an input.
ALTER TABLE public.agent_runs ALTER COLUMN organization_id SET NOT NULL;
