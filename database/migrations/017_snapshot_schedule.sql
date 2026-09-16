-- ============================================================
-- 017_snapshot_schedule.sql
-- ============================================================
-- Stage 1. The schedule: pg_cron, one job calling app.regenerate_snapshot()
-- every minute, one job calling app.refresh_lga_rollup() every five, and the
-- repair that giving the rollup a caller makes necessary.
--
-- Empirical state at base: 001-016 applied, locally and hosted (hosted recorded
-- in database/migrations/applied-hosted.json, R-2026-09-16-02). pg_cron is NOT
-- installed. It is preloaded on the local Supabase image (observed 2026-09-16:
-- shared_preload_libraries includes pg_cron; 1.6.4 available, not installed;
-- cron.database_name = postgres; PostgreSQL 17.6). Hosted availability is a
-- founder-side runbook check before the apply, not a fact this file asserts.
--
-- Idempotency: CREATE EXTENSION IF NOT EXISTS; CREATE OR REPLACE FUNCTION, which
-- keeps the function's owner and ACL; the REVOKEs are no-ops when already in
-- force; cron.schedule(name, schedule, command) UPSERTS by name for the calling
-- role -- re-running it returned the same jobid with one row (observed
-- 2026-09-16) -- and it leaves `active` as it found it: a job paused with
-- cron.alter_job stayed paused when re-scheduled, even with a changed schedule
-- string (observed 2026-09-16). Re-applying changes nothing -- asserted by
-- tests/db/migration_idempotency.test.ts for app and public. That digest does
-- NOT see the cron schema: a second cron.job row is data outside it, so the
-- duplicate case is asserted by tests/db/snapshot_schedule_state.test.ts, which
-- applies this file twice in a rolled-back transaction and counts rows per job
-- name.
--
-- THE ROUTE (R-2026-09-16-07): pg_cron running as `postgres`, single head. The
-- job runs as the role that scheduled it (cron.job.username = postgres,
-- observed), and postgres owns both functions. NO GRANT: service_role has no
-- USAGE on schema app (016's EXECUTE note), so a grant to it was never a route,
-- and no public surface is added. Decision 3 stays closed. Rejected: a direct
-- owner connection (needs a host and a stored production credential; there is
-- no server) and a public wrapper with EXECUTE for service_role (reopens
-- decision 3).
--
-- CADENCES. openbed_regenerate_snapshot at `* * * * *`: the nearest cron
-- expression to v1:65's "regenerated every 60 seconds". It does not rest on any
-- claim about pg_cron's minimum interval; 1.6.4 accepts '30 seconds' (observed).
-- openbed_refresh_lga_rollup at `*/5 * * * *`: a full DELETE-and-recompute of a
-- published table that nothing reads yet (the payload key is Stage 3), so five
-- minutes ends "frozen at seed time" cheaply. Both are one-line changes.
--
-- RETENTION NEEDS NO JOB. app.regenerate_snapshot() prunes public.snapshot_current
-- against app.snapshot_retention() (24 hours) in its own transaction, so
-- scheduling the generator schedules retention. Do not add a cron entry for it.
--
-- THE ROLLUP JOB CLOSES v2's FINDING 1 (R-2026-09-16-08). app.refresh_lga_rollup()
-- had no production caller since 009. 016 declined to be that caller for a reason
-- that does not apply here: calling it FROM THE GENERATOR would make the
-- generator a writer of a published surface inside the public read path, holding
-- base-table locks in the snapshot transaction. A separate job is its own
-- transaction, outside that path. Corrections to frozen text this file cannot
-- edit: 016's header says finding 1 "stays OPEN" -- closed here; 009's header
-- says the function is "invoked by the snapshot generator (B4)" -- it never was,
-- and is invoked by this schedule.
--
-- THE REPAIR, AND ITS REASON AS OBSERVED (2026-09-16, rolled-back transactions,
-- local). 009 defines the function SECURITY DEFINER with search_path = '' and no
-- row_security attribute, while public.lga_rollup is ENABLE + FORCE ROW LEVEL
-- SECURITY (007) with one policy, SELECT for anon. Handed to an owner without
-- BYPASSRLS:
--   - where any cell publishes, the INSERT is refused loudly ("new row violates
--     row-level security policy for table lga_rollup");
--   - where the recompute should make a cell VANISH below the k-floor, the DELETE
--     affects nothing, nothing is inserted, the function returns 0 silently, and
--     THE CELL STAYS PUBLISHED AT ITS EXACT BED COUNT (a quiet facility
--     deactivated leaving 4 in the cell; the 15-bed cell remained). That is not
--     a stale aggregate. It is the disclosure the k-floor exists to prevent.
-- With `SET row_security = off` the same case raises at the DELETE ("query would
-- be affected by row-level security policy for table lga_rollup"), and under
-- postgres the refresh is unchanged. It works today only because postgres
-- bypasses RLS, the attribute R-2026-09-15-07 refused to depend on. 009 is
-- frozen, so the repair is a CREATE OR REPLACE here: 009's function text
-- byte-for-byte, plus the one attribute line, mirroring 016's generator.
--
-- CONCURRENCY, OBSERVED, because this file creates the first concurrent caller.
-- 009's header says running the refresh concurrently "is safe under the table's
-- primary key". Two overlapping refreshes (2026-09-16): the first commits; the
-- second's DELETE waits, never sees the first's inserted rows, and its INSERT
-- fails "duplicate key value violates unique constraint lga_rollup_pkey". The
-- published rows are the first refresh's and are correct. So: safe in that
-- nothing is corrupted, and the loser ERRORS rather than succeeding. A job run
-- that loses is recorded failed in cron.job_run_details and the next tick
-- recomputes.
--
-- WHAT IS OUT.
--   - The extension is NOT dropped by the down file: it is cluster-wide, and
--     dropping it is a wider blast radius than this migration's own.
--   - `cron` is NOT added to [api] schemas in supabase/config.toml, which
--     tests/db/config_drift.test.ts asserts.
--   - Detection of a stopped scheduler: 016's app.system_heartbeat.last_snapshot_at
--     is the column a sensor reads; building one belongs to the alerting sprint.
--   - NOT ASSERTED BY THE LOCAL SUITE: that the jobs are active on hosted. The
--     db test project pauses both jobs so they cannot write mid-test (R-2026-09-16-10);
--     condition F asserts what this file produces from its own re-application.
--     The hosted jobs are confirmed at the apply, in the runbook.
--
-- Deployment ordering gate: 016 must be applied (app.regenerate_snapshot() and
-- app.system_heartbeat.last_snapshot_at exist). On hosted, pg_cron must be
-- available to CREATE EXTENSION before this file runs.
--
-- Object ledger -- 1 extension, 1 function redefined, 2 jobs:
--   pg_cron                             CREATE EXTENSION IF NOT EXISTS.
--   app.refresh_lga_rollup()            009's definition + SET row_security = off.
--   cron job openbed_regenerate_snapshot  * * * * *    select app.regenerate_snapshot()
--   cron job openbed_refresh_lga_rollup   */5 * * * *  select app.refresh_lga_rollup()
-- ============================================================


-- ============================================================
-- 1. pg_cron.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ============================================================
-- 2. app.refresh_lga_rollup(), repaired. 009's text plus one attribute line.
-- ============================================================
CREATE OR REPLACE FUNCTION app.refresh_lga_rollup()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $FN$
DECLARE
    v_rows integer;
BEGIN
    -- Full recompute. A cell that no longer clears the k-floor must DISAPPEAR,
    -- and an incremental update would leave it behind -- which is precisely the
    -- disclosure the floor exists to prevent.
    DELETE FROM public.lga_rollup;

    WITH contrib AS (
        -- One row per (cell, facility). THE SET.
        SELECT
            f.state,
            f.lga,
            ws.category,
            f.id AS facility_id,
            sum(coalesce(ws.bed_count, 0))::integer AS beds
          FROM app.facility f
          JOIN app.ward_status ws ON ws.facility_id = f.id
         WHERE f.quiet_mode
           AND f.is_active
           AND ws.offering = 'OFFERED'
         GROUP BY f.state, f.lga, ws.category, f.id
    ),
    agg AS (
        SELECT
            c.state,
            c.lga,
            c.category,
            count(DISTINCT c.facility_id)::integer AS facility_count,
            sum(c.beds)::integer                   AS total_beds,
            max(c.beds)::integer                   AS max_facility_beds
          FROM contrib c
         GROUP BY c.state, c.lga, c.category
    )
    INSERT INTO public.lga_rollup (state, lga, category, facility_count, total_beds, updated_at)
    SELECT a.state, a.lga, a.category, a.facility_count, a.total_beds, now()
      FROM agg a
     WHERE CASE
               -- 1. K-FLOOR. Fewer than 5 contributing facilities: suppress.
               --    Stable over time, which is what makes it safe: a cell that is
               --    always absent tells an observer nothing.
               WHEN a.facility_count < 5 THEN false

               -- 2. ALL-ZERO. PUBLISH, and return before any division is reached.
               --
               --    This arm MUST precede arm 3. CASE evaluates its conditions in
               --    order and stops at the first true one, so arm 3's division is
               --    unreachable when total_beds = 0.
               --
               --    Published rather than suppressed because suppressing would not
               --    hide it: if all-zero were the only condition beyond the k-floor
               --    that removed a cell, the cell would be present on normal days
               --    and absent on zero days, and the absence would be the signal.
               --    Suppression buys nothing and costs the most useful thing the
               --    rollup can say.
               WHEN a.total_beds = 0 THEN true

               -- 3. DOMINANCE. Reachable only when total_beds > 0.
               --    NULLIF is belt-and-braces on top of the ordering above: if
               --    anyone ever reorders these arms, this yields NULL (row not
               --    selected) rather than raising division_by_zero and taking the
               --    whole refresh down.
               WHEN a.max_facility_beds::numeric / nullif(a.total_beds, 0) <= 0.40 THEN true

               ELSE false
           END;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$FN$;

COMMENT ON FUNCTION app.refresh_lga_rollup() IS
    'Full recompute of public.lga_rollup over QUIET facilities only. Applies the '
    'k-floor (>= 5 contributing facilities), publishes the all-zero cell, and '
    'suppresses any cell where one facility holds more than 40% of total beds. '
    'facility_count, total_beds and max_facility_beds all range over the same set: '
    'quiet active facilities in the cell that OFFER the category. Mirrored by '
    'rollupPublishable() in packages/gate/src/rollup.ts. row_security = off (017): '
    'an owner that cannot bypass RLS fails loudly rather than leaving a below-floor '
    'cell published. Called every five minutes by the pg_cron job '
    'openbed_refresh_lga_rollup.';

-- EXECUTE: owner only, as 009 left it. No-ops today; restated so this file's
-- definition does not depend on a grant state it did not set.
REVOKE ALL ON FUNCTION app.refresh_lga_rollup() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION app.refresh_lga_rollup() FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 3. The two jobs. By-name cron.schedule upserts; see Idempotency above.
-- ============================================================
SELECT cron.schedule('openbed_regenerate_snapshot', '* * * * *', 'select app.regenerate_snapshot()');
SELECT cron.schedule('openbed_refresh_lga_rollup', '*/5 * * * *', 'select app.refresh_lga_rollup()');


-- ============================================================
-- 4. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('017_snapshot_schedule.sql', now())
ON CONFLICT (filename) DO NOTHING;
