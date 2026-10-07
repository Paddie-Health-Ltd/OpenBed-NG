-- ============================================================
-- 030_truncate_guard_audit_tables.sql
-- ============================================================
-- THE OWNER STOPPED FROM TRUNCATING THE TWO APPEND-ONLY TABLES OF 010 (R-2026-09-30-205 GE,
-- issued as R-PROVISIONAL-2026-10-06-GE; the founder's word on 2026-10-06 was "yes add it",
-- on Cowork's recommendation in rulings GB and FZ decision 5). 010 stops UPDATE and DELETE on
-- app.audit_log and app.ward_status_event with row-level triggers and revokes UPDATE, DELETE
-- and TRUNCATE from the client roles. A revoke does not bind the table's owner, and a row
-- trigger is never fired by TRUNCATE, which is a statement and not a row. So the owner could
-- empty either table in one statement, and nothing would raise. 029 closed exactly this for
-- its own table with a statement-level BEFORE TRUNCATE trigger; this applies the same to
-- 010's two tables.
--
-- Empirical state at base: 001-029 applied locally; hosted at 029
-- (database/migrations/applied-hosted.json, recorded 2026-10-06). Read on the local stack
-- at base, before this file existed: the owner role postgres reads rolsuper f and
-- rolbypassrls t; each of the two tables carries exactly one non-internal trigger, 010's
-- row-level trigger, ENABLE ALWAYS; and TRUNCATE on either table, as the owner, succeeded
-- (inside a transaction that was rolled back).
--
-- WHAT IT CHANGES, and nothing else:
--   a. app.audit_log: a statement-level BEFORE TRUNCATE trigger, trg_audit_log_no_truncate,
--      calling app.raise_append_only().
--   b. app.ward_status_event: the same, trg_ward_status_event_no_truncate.
--   Each is created inside a DO block guarded on pg_trigger, as 010 and 029 do, and then
--   ENABLE ALWAYS unconditionally, as a separate statement: a trigger that exists without
--   ENABLE ALWAYS is upgraded, not skipped, and ALWAYS is what survives
--   session_replication_role = 'replica'. The names follow 010's pattern. The guard reads
--   tgname alone, so the two names are unique in the whole database, not only per table.
--
-- NOT DONE HERE, deliberately: no new function (app.raise_append_only() is 010's, reads only
-- TG_OP, TG_TABLE_SCHEMA and TG_TABLE_NAME, and so is safe at statement level, where there
-- is no OLD or NEW), no grant change, no row inserted, no column touched. 010 and 029 are
-- frozen and are not edited. No hosted step is taken: the hosted apply is a founder step,
-- by the runbook's section 5.
--
-- WHAT A REFUSAL LOOKS LIKE. The owner is refused by the trigger with APPEND_ONLY_VIOLATION,
-- naming the table. A client role is refused earlier, by the privilege check, with 42501:
-- PostgreSQL checks the privilege before it fires a BEFORE trigger, and 010 revoked TRUNCATE
-- from those roles. The trigger is the second layer, and is what stops a role that were
-- ever granted TRUNCATE.
--
-- KNOWN LIMIT, STATED AND NOT PAPERED OVER. A trigger stops the statement, not the owner's
-- intent. Ownership of a table is enough to run ALTER TABLE ... DISABLE TRIGGER, as it is for
-- 010's and 029's row-level triggers, and a disabled trigger reads D in pg_trigger. What this
-- closes is the one-statement case that nothing raised: an owner, or a script running as the
-- owner, emptying either table in a single TRUNCATE. What it does not close is a deliberate
-- sequence by the owner that disables the trigger first. tests/db/config_drift.test.ts reads
-- the enabled state of every append-only trigger, and A is what it requires.
--
-- Idempotency: each trigger is created inside a DO block guarded on pg_trigger and
-- ENABLE ALWAYS is unconditional; the ledger insert is ON CONFLICT DO NOTHING. It inserts
-- no row and creates no table, so the digest is unchanged by a second application.
-- ============================================================


-- ============================================================
-- a. app.audit_log: TRUNCATE is a statement, so it is stopped at the statement.
-- ============================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_no_truncate') THEN
        EXECUTE 'CREATE TRIGGER trg_audit_log_no_truncate
                     BEFORE TRUNCATE ON app.audit_log
                     FOR EACH STATEMENT EXECUTE FUNCTION app.raise_append_only()';
    END IF;
    EXECUTE 'ALTER TABLE app.audit_log ENABLE ALWAYS TRIGGER trg_audit_log_no_truncate';
END $$;


-- ============================================================
-- b. app.ward_status_event: the same.
-- ============================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ward_status_event_no_truncate') THEN
        EXECUTE 'CREATE TRIGGER trg_ward_status_event_no_truncate
                     BEFORE TRUNCATE ON app.ward_status_event
                     FOR EACH STATEMENT EXECUTE FUNCTION app.raise_append_only()';
    END IF;
    EXECUTE 'ALTER TABLE app.ward_status_event ENABLE ALWAYS TRIGGER trg_ward_status_event_no_truncate';
END $$;


-- ============================================================
-- Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('030_truncate_guard_audit_tables.sql', now())
ON CONFLICT (filename) DO NOTHING;
