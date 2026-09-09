-- ============================================================
-- 010_append_only_enforcement.down.sql
-- ============================================================
-- Symmetric reversal of 010: triggers, then the function, then the grants.
--
-- REVERSING THIS MAKES THE SAFETY RECORD EDITABLE. It exists so the migration
-- sequence is reversible in development and CI, where the database is rebuilt
-- from zero. Running it against a database that holds a real audit trail removes
-- the only thing standing between that trail and a well-meant UPDATE.
--
-- The grants restored below are the ones 010 revoked, and no more: service_role
-- gets UPDATE and DELETE back because it held them before 010; anon and
-- authenticated get nothing, because they never had anything on `app` -- 001's
-- revoke wall predates this file and is not this file's to undo.
-- ============================================================

DROP TRIGGER IF EXISTS trg_audit_log_append_only         ON app.audit_log;
DROP TRIGGER IF EXISTS trg_ward_status_event_append_only ON app.ward_status_event;

DROP FUNCTION IF EXISTS app.raise_append_only();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT UPDATE, DELETE ON app.ward_status_event TO service_role';
        EXECUTE 'GRANT UPDATE, DELETE ON app.audit_log TO service_role';
    END IF;
END $$;

DELETE FROM app.schema_migrations WHERE filename = '010_append_only_enforcement.sql';
