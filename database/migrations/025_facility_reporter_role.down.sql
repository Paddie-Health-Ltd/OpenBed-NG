-- ============================================================
-- 025_facility_reporter_role.down.sql
-- ============================================================
-- THE REVERSAL OF AN IRREVERSIBLE STEP, STATED RATHER THAN FAKED. PostgreSQL cannot
-- drop a value from an enum type, so this file does not pretend to: 'FACILITY_REPORTER'
-- stays in app.app_role, unused, and only the ledger row goes. Re-applying 025 is
-- then a no-op (ADD VALUE IF NOT EXISTS), which is what makes up, down, up leave
-- exactly one such label.
--
-- IT REFUSES WHILE ANY ROW HOLDS THE ROLE: an app.ward_account or app.invite row with
-- role FACILITY_REPORTER means 026 is still applied or data outlived it, and
-- "reversed" would then be a false word. The comparison is on role::text, so this
-- file names the value only as text.
--
-- Idempotency: the refusal reads only; the notice changes nothing; the ledger DELETE
-- matches at most one row. Nothing is dropped.
-- ============================================================


-- ============================================================
-- 0. Refuse while any row holds the role; otherwise say the value stays.
-- ============================================================
DO $$
DECLARE
    n_acct   integer;
    n_invite integer;
BEGIN
    SELECT count(*) INTO n_acct FROM app.ward_account WHERE role::text = 'FACILITY_REPORTER';
    SELECT count(*) INTO n_invite FROM app.invite WHERE role::text = 'FACILITY_REPORTER';
    IF n_acct > 0 OR n_invite > 0 THEN
        RAISE EXCEPTION 'FACILITY_REPORTER_IN_USE'
              USING DETAIL = format('%s ward_account row(s) and %s invite row(s) hold FACILITY_REPORTER; 025 is not reversed while any does', n_acct, n_invite);
    END IF;
    RAISE NOTICE 'app.app_role keeps FACILITY_REPORTER, unused: PostgreSQL cannot drop an enum value';
END $$;


-- ============================================================
-- 1. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '025_facility_reporter_role.sql';
