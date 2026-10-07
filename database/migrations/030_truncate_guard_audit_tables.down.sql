-- ============================================================
-- 030_truncate_guard_audit_tables.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 029 state: the two statement-level BEFORE TRUNCATE
-- triggers go, and nothing else. The tables, 010's row-level triggers and
-- app.raise_append_only() are 010's and stay.
--
-- REVERSING THIS LETS THE OWNER TRUNCATE THE SAFETY RECORD AGAIN. It exists so the migration
-- sequence is reversible in development and CI, where the database is rebuilt from zero.
-- Running it against a database that holds a real audit trail removes the only thing that
-- stops the table's owner emptying that trail in one statement.
--
-- Idempotency: DROP TRIGGER IF EXISTS throughout; the ledger DELETE matches at most one row.
-- ============================================================

DROP TRIGGER IF EXISTS trg_audit_log_no_truncate         ON app.audit_log;
DROP TRIGGER IF EXISTS trg_ward_status_event_no_truncate ON app.ward_status_event;

DELETE FROM app.schema_migrations WHERE filename = '030_truncate_guard_audit_tables.sql';
