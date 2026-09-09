-- ============================================================
-- 010_append_only_enforcement.sql
-- ============================================================
-- Sprint 1, Bundle 1. Make app.ward_status_event and app.audit_log append-only.
--
-- Empirical state at base: 001-009 applied. Both tables exist (004 section 2,
-- 005 section 1) and are currently UPDATE-able and DELETE-able by their owner.
--
-- GRANTS ALONE DO NOT STOP A SERVICE-ROLE SCRIPT, so this file ships both:
--   (a) REVOKE UPDATE, DELETE from every client role AND from service_role, and
--   (b) a BEFORE UPDATE OR DELETE trigger that raises unconditionally.
-- (a) stops a misconfigured client. (b) stops the far likelier case: a
-- maintenance script running as service_role that "just needs to fix one row".
--
-- THE TRIGGERS ARE DECLARED `ENABLE ALWAYS`, AND THAT IS NOT COSMETIC.
--   An ordinary trigger (tgenabled = 'O') does NOT fire when
--   session_replication_role = 'replica'. That setting is not exotic -- it is
--   what logical replication apply workers use, and it is what a restore or a
--   bulk-load script commonly sets to skip triggers. Under it, an ordinary
--   append-only trigger silently stops enforcing while every grant still looks
--   correct. ENABLE ALWAYS (tgenabled = 'A') fires regardless.
--   tests/db/config_drift.test.ts asserts tgenabled = 'A', not merely that the
--   trigger exists.
--
-- KNOWN LIMIT, STATED RATHER THAN PAPERED OVER (Clause 5).
--   REVOKE accomplishes NOTHING against a superuser, and a superuser can also
--   ALTER TABLE ... DISABLE TRIGGER. Locally, Supabase's `postgres` role IS a
--   superuser; on a hosted Supabase project it is NOT. So
--   tests/db/append_only_enforcement.test.ts can pass locally while production
--   behaves differently, and it could equally pass for the wrong reason.
--   The test asserts what it can (the trigger fires for service_role, the grants
--   are absent, tgenabled = 'A') and names this asymmetry in its own header. The
--   hosted behaviour is a hand-check in
--   docs/runbook-supabase-project-creation.md. Do not add a test that claims to
--   verify the hosted case.
--
-- Idempotency: REVOKE is idempotent; the function is CREATE OR REPLACE; triggers
-- are guarded on pg_trigger.
--
-- Deployment ordering gate: CRITICAL, and it points backwards. Once this lands,
-- NOTHING can update or delete from these two tables -- including a later
-- migration. A future migration that needs to change their shape must add a
-- column (allowed) rather than rewrite rows (not allowed). Backfilling an
-- append-only table is not a schema change, it is a rewrite of the safety record.
--
-- WHAT IS DELIBERATELY *NOT* APPEND-ONLY, AND WHY IT MUST STAY THAT WAY.
--   app.facility_contact (003 section 5) holds the one invited human per
--   facility -- business-contact data on a contract basis, and the only named
--   person anywhere in this system. It is deliberately OUTSIDE this file's
--   append-only set, because that row must remain deletable on request.
--
--   Do not add a trigger for it "for consistency". Consistency is not the
--   property being protected here: the append-only set exists to make the
--   OPERATIONAL RECORD immutable, and a business contact is not part of the
--   operational record. Adding a trigger would destroy the erasure route and
--   would do so while looking like tidying up.
--
--   app.notification_outbox is likewise outside the set, which is what keeps
--   `recipient_contact_id ... ON DELETE SET NULL` executable when a contact is
--   erased.
--
-- Object ledger -- 1 function, 2 triggers, 2 revocation groups:
--   app.raise_append_only()
--   trg_ward_status_event_append_only  BEFORE UPDATE OR DELETE, ENABLE ALWAYS
--   trg_audit_log_append_only          BEFORE UPDATE OR DELETE, ENABLE ALWAYS
-- ============================================================


-- ============================================================
-- 1. The guard function.
-- ============================================================
-- Raises P0001 with a STABLE, MACHINE-READABLE code in the message. Clients map
-- codes; nothing anywhere keys off message text.
CREATE OR REPLACE FUNCTION app.raise_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $FN$
BEGIN
    RAISE EXCEPTION 'APPEND_ONLY_VIOLATION: % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'P0001',
              HINT = 'This table is the operational safety record. Correct a bad '
                     'entry by appending a superseding row, never by editing or '
                     'deleting the original.';
END;
$FN$;

REVOKE ALL ON FUNCTION app.raise_append_only() FROM PUBLIC;


-- ============================================================
-- 2. Revoke UPDATE and DELETE -- including from service_role.
-- ============================================================
REVOKE UPDATE, DELETE, TRUNCATE ON app.ward_status_event FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_log         FROM PUBLIC;

DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON app.ward_status_event FROM %I', r);
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_log FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 3. The triggers. ENABLE ALWAYS -- see the header.
-- ============================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ward_status_event_append_only') THEN
        EXECUTE 'CREATE TRIGGER trg_ward_status_event_append_only
                     BEFORE UPDATE OR DELETE ON app.ward_status_event
                     FOR EACH ROW EXECUTE FUNCTION app.raise_append_only()';
    END IF;
    -- Separate statement, and unconditional: a trigger created by an earlier
    -- version of this migration without ENABLE ALWAYS must be upgraded, not
    -- skipped because it already exists.
    EXECUTE 'ALTER TABLE app.ward_status_event ENABLE ALWAYS TRIGGER trg_ward_status_event_append_only';
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_append_only') THEN
        EXECUTE 'CREATE TRIGGER trg_audit_log_append_only
                     BEFORE UPDATE OR DELETE ON app.audit_log
                     FOR EACH ROW EXECUTE FUNCTION app.raise_append_only()';
    END IF;
    EXECUTE 'ALTER TABLE app.audit_log ENABLE ALWAYS TRIGGER trg_audit_log_append_only';
END $$;


-- ============================================================
-- 4. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('010_append_only_enforcement.sql', now())
ON CONFLICT (filename) DO NOTHING;
