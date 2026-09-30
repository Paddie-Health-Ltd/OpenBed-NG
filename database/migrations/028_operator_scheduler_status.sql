-- ============================================================
-- 028_operator_scheduler_status.sql
-- ============================================================
-- THE SCHEDULER'S STATUS, READABLE BY THE OPERATOR'S ADMIN APP
-- (R-2026-09-30-175 EY-2, issued as R-PROVISIONAL-2026-09-30-EY; W2 of the facility-one
-- build). 027 gave the health endpoint one read of the scheduler, for service_role only.
-- The operator has no way to see the same read: a psql session is not a screen, and the
-- admin app must never hold a service_role credential. This is the operator's door to
-- the same jsonb, behind the same platform-admin check every operator function makes.
--
-- Empirical state at base: 001-027 applied locally; hosted at 027, recorded
-- 2026-09-30 (database/migrations/applied-hosted.json). app.scheduler_status() exists
-- and is owner-only; public.health_probe() exists and is service_role's. The wrapper
-- below is a SECURITY DEFINER owned by the migration role, exactly as health_probe is,
-- so it reads what app.scheduler_status() reads with no new privilege on cron.*.
--
-- WHAT IT CHANGES, and nothing else:
--   public.operator_scheduler_status(): it calls app.assert_operator() first, which
--   raises 42501 for no session, for a non-operator and for a deactivated operator, and
--   then returns app.scheduler_status()'s result and nothing else. STABLE, read-only.
--   It is NOT operator_register: that function stays as it is, and its retention_alert
--   keeps its Notice.
--
-- GRANTS. EXECUTE revoked from PUBLIC, then from anon, authenticated and service_role by
-- name, then granted to authenticated alone, as 026's operator functions do. The
-- REVOKE ... FROM PUBLIC is the load-bearing line: PostgreSQL grants EXECUTE on every
-- new function to PUBLIC by its own built-in default, and a per-schema default ACL only
-- adds to that and cannot remove it (R-2026-09-30-175 EY-1). The by-name revokes are a
-- second barrier, for a schema whose default names a role and against a later change of
-- Supabase's defaults. packages/fixtures/function-grants.json lists it with execute
-- ["authenticated"]. service_role gains nothing: health_probe stays its one function.
--
-- DEPLOYMENT ORDER. Applied to hosted BEFORE the admin app is redeployed from the
-- change that adds its System status section. Until then that section reads the
-- server's "function is missing" answer inside itself, and the register is unaffected.
--
-- NOT DONE HERE, deliberately: no job is added, changed or paused, and nothing is
-- written. The hosted grant read is a founder read-back after the apply
-- (scripts/readback_function_grants.sh) and is asserted locally only by
-- tests/db/operator_scheduler_status.test.ts and tests/db/function_grants.test.ts.
--
-- Idempotency: CREATE OR REPLACE for the function; the revoke loop is repeatable and
-- re-runs the grant; the ledger insert is ON CONFLICT DO NOTHING. It creates no table,
-- column or job, so the digest is unchanged by a second application.
-- ============================================================


-- ============================================================
-- 1. public.operator_scheduler_status() -- the operator's read.
-- ============================================================
CREATE OR REPLACE FUNCTION public.operator_scheduler_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
BEGIN
    PERFORM app.assert_operator();
    RETURN app.scheduler_status();
END;
$FN$;

DO $$
DECLARE
    r text;
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.operator_scheduler_status() FROM PUBLIC';
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.operator_scheduler_status() FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.operator_scheduler_status() TO authenticated';
    END IF;
END $$;


-- ============================================================
-- Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('028_operator_scheduler_status.sql', now())
ON CONFLICT (filename) DO NOTHING;
