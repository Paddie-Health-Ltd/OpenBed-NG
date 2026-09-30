-- ============================================================
-- 027_scheduler_status.sql
-- ============================================================
-- THE SCHEDULER'S STATUS, READABLE BY THE HEALTH ENDPOINT AND BY NOTHING ELSE
-- (R-2026-09-29-173 EW-1, issued as R-PROVISIONAL-2026-09-29-EW; the sensor bundle of
-- R-2026-09-22-54 B). Nothing alerts anyone today when the snapshot job stops. The
-- public page degrades honestly from 3 minutes, but no alarm reaches the founder.
-- The external monitor polls /api/health, and /api/health needs one read: is the
-- snapshot fresh, and is its pg_cron job there and switched on?
--
-- Empirical state at base: 001-026 applied locally; hosted at 026
-- (database/migrations/applied-hosted.json). pg_cron's row security on cron.job and
-- cron.job_run_details is `username = current_user`; inside a definer that is the
-- function's owner, and the jobs were scheduled by that same role (017, 024), so a
-- definer owned by the migration role reads them. 026's operator_register already
-- does, and hosted has applied it. The local read is asserted by
-- tests/db/health_probe.test.ts; the hosted read is NOT ASSERTED by any test here and
-- is a founder read-back after the apply (health_probe read as service_role).
--
-- WHAT IT CHANGES, and nothing else:
--   1. app.scheduler_status(): one jsonb, read-only. server_now (the database's
--      clock), generated_at (the newest public.snapshot_current row by v, the row
--      /beds.json serves; null when there is none, never coerced),
--      last_snapshot_at (the heartbeat), and for every pg_cron job whose name starts
--      openbed_ its name, active flag, schedule and latest FINISHED run (end_time
--      set, highest runid) with status and start_time, looked up only over the last
--      two days and null when there is none.
--   2. public.health_probe(): the same jsonb, for service_role only. It is the first
--      service_role grant on a function in this repository.
--
-- DECISION 3. 017's header and the record name "a public wrapper with EXECUTE for
-- service_role" as the shape that reopens decision 3, and say it must be faced
-- deliberately. This is that facing (R-2026-09-29-173 EW-1 c). Decision 3 keeps the
-- generator's reader to service_role and forbids a second, CDN-bypassing serving path
-- for the snapshot. health_probe serves no snapshot payload, triggers no generation
-- and writes nothing. It is read-only and STABLE. It returns ages, a job name and a
-- status, and nothing that /beds.json does not already show or that names a person.
--
-- GRANTS. app.scheduler_status() is owner-only: EXECUTE revoked from PUBLIC, anon,
-- authenticated and service_role by name, listed in
-- packages/fixtures/function-grants.json with execute []. public.health_probe() is
-- revoked from PUBLIC, anon and authenticated by name and granted to service_role
-- alone; the fixture lists it with execute ["service_role"]. The anon allow-list and
-- the authenticated closed list do not move.
--
-- NOT DONE HERE, deliberately: no job is added, changed or paused, and nothing is
-- written. cron.job_run_details is not pruned by anything in this repository (about
-- 1,440 rows a day from the snapshot job alone), which is why the run lookup is
-- bounded to two days; the register's trigger row says when that stops being enough.
--
-- Idempotency: CREATE OR REPLACE for both functions; the revoke loops are repeatable
-- and re-run the grant; the ledger insert is ON CONFLICT DO NOTHING. It creates no
-- table, column or job, so the digest is unchanged by a second application.
-- ============================================================


-- ============================================================
-- 1. app.scheduler_status() -- the read.
-- ============================================================
CREATE OR REPLACE FUNCTION app.scheduler_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
BEGIN
    RETURN jsonb_build_object(
        'server_now', now(),
        -- The newest row by v, as /beds.json reads it. A subquery over no rows is
        -- null, and null is what this reports: an empty table is not "fresh".
        'generated_at', (SELECT s.generated_at
                           FROM public.snapshot_current s
                          ORDER BY s.v DESC
                          LIMIT 1),
        'last_snapshot_at', (SELECT h.last_snapshot_at
                               FROM app.system_heartbeat h
                              WHERE h.id),
        'jobs', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'name',            j.jobname,
                       'active',          j.active,
                       'schedule',        j.schedule,
                       'last_status',     d.status,
                       'last_start_time', d.start_time
                   ) ORDER BY j.jobname)
              FROM cron.job j
              LEFT JOIN LATERAL (
                   SELECT r.status, r.start_time
                     FROM cron.job_run_details r
                    WHERE r.jobid = j.jobid
                      AND r.end_time IS NOT NULL
                      AND r.start_time > now() - interval '2 days'
                    ORDER BY r.runid DESC
                    LIMIT 1) d ON true
             WHERE j.jobname LIKE 'openbed\_%'
        ), '[]'::jsonb));
END;
$FN$;

-- Owner only.
DO $$
DECLARE
    r text;
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION app.scheduler_status() FROM PUBLIC';
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION app.scheduler_status() FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 2. public.health_probe() -- service_role's one door to it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.health_probe()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
BEGIN
    RETURN app.scheduler_status();
END;
$FN$;

DO $$
DECLARE
    r text;
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.health_probe() FROM PUBLIC';
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.health_probe() FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.health_probe() TO service_role';
    END IF;
END $$;


-- ============================================================
-- Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('027_scheduler_status.sql', now())
ON CONFLICT (filename) DO NOTHING;
