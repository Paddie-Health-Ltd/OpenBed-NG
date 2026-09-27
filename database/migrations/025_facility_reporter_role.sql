-- ============================================================
-- 025_facility_reporter_role.sql
-- ============================================================
-- THE FACILITY_REPORTER ROLE: THE ENUM VALUE, ALONE (R-2026-09-27-144 DT, issued as
-- R-PROVISIONAL-2026-09-27-DT; the reporting model is the founder's, R-2026-09-27-141
-- DQ-3). One login for a facility where one nurse in charge knows every bed on each
-- shift; it publishes as a ward does (source WARD), for any ward at its own facility.
-- FACILITY_ADMIN keeps its meaning -- oversight and override -- and is not reused.
--
-- WHY THIS FILE HOLDS ONE STATEMENT. scripts/run_migrations.sh applies each file with
-- psql --single-transaction, and PostgreSQL refuses to USE an enum value in the
-- transaction that added it: ADD VALUE itself is transactional (PostgreSQL 12 and
-- later), but a CHECK, an index predicate or a cast naming the new value fails until
-- the value is committed. Observed locally 2026-09-27 (PostgreSQL 17.6), with 026's
-- content appended to this file and applied as one transaction:
--     ERROR:  unsafe use of new value "FACILITY_REPORTER" of enum type app.app_role
--     HINT:  New enum values must be committed before they can be used.
-- So every CHECK, index, trigger and function that names the value is 026, applied
-- as the next file in its own transaction. tests/db/migration_025_round_trip.test.ts
-- proves the rule on a scratch enum type.
--
-- THIS IS THE SPRINT'S ONE IRREVERSIBLE ELEMENT. PostgreSQL cannot drop an enum
-- value. The down file removes nothing but the ledger row: it refuses while any
-- app.ward_account or app.invite row holds the role, and otherwise says the value
-- stays, unused.
--
-- Empirical state at base: 001-024 applied locally; hosted at 024
-- (database/migrations/applied-hosted.json). app.app_role holds WARD_STAFF,
-- FACILITY_ADMIN and PLATFORM_ADMIN (002).
--
-- WHAT IT CHANGES, and nothing else: app.app_role gains 'FACILITY_REPORTER', after
-- PLATFORM_ADMIN. Nothing can hold it until 026: 003's two scope CHECKs have no arm
-- for it, so an account or invite with the role is refused 23514.
--
-- Idempotency: ADD VALUE IF NOT EXISTS is a no-op when the value exists; the ledger
-- insert is ON CONFLICT DO NOTHING.
-- ============================================================


-- ============================================================
-- 1. The value.
-- ============================================================
ALTER TYPE app.app_role ADD VALUE IF NOT EXISTS 'FACILITY_REPORTER';


-- ============================================================
-- 2. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('025_facility_reporter_role.sql', now())
ON CONFLICT (filename) DO NOTHING;
