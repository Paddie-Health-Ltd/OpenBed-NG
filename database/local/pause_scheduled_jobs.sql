-- ============================================================
-- pause_scheduled_jobs.sql -- LOCAL AND CI DATABASES ONLY. NEVER HOSTED.
-- ============================================================
-- Pauses the two pg_cron jobs migration 017 schedules, and waits until neither
-- has a run in flight. Ruling R-2026-09-16-11.
--
-- WHY. From the moment scripts/run_migrations.sh applies 017, both jobs are live.
-- Live, they write while the repository is being checked:
--   - openbed_refresh_lga_rollup DELETEs and recomputes public.lga_rollup, and
--     database/seed/001_synthetic_seed.sql calls the same refresh. Two overlapping
--     refreshes make the second fail on lga_rollup_pkey (observed 2026-09-16) --
--     a loud intermittent red that is not a regression.
--   - openbed_regenerate_snapshot writes app.system_heartbeat and
--     public.snapshot_current. tests/db/migration_idempotency.test.ts hashes the
--     heartbeat (2 of 83 runs red with the job live, observed 2026-09-16). In the
--     golden path's snapshot-regenerates step a job regeneration would satisfy
--     the heartbeat and payload checks; the step's `v` check brackets its own
--     call within milliseconds and held without the pause (4 of 4 red with the
--     call removed and a one-second job, observed 2026-09-16), so the pause there
--     buys attributable evidence rather than rescuing a vacuous step.
--
-- WHERE IT RUNS, AND WHY THERE. scripts/seed.sh applies it after its local-only
-- host check and before any seed file. seed.sh is the one script that
-- structurally cannot reach hosted (tests/compliance/seed_local_only.test.ts),
-- and it runs straight after the migrations on every local and CI database, so
-- the pause holds from migration to the end of the run. scripts/run_migrations.sh
-- is NOT the seam: it is also the hosted runner. The db and e2e test setups apply
-- this same file again through tests/setup/db.ts, so a database migrated without
-- the seed is paused too. ON HOSTED THE JOBS MUST STAY ACTIVE.
--
-- TWO TOP-LEVEL STATEMENTS, DELIBERATELY. psql autocommits each, so the pause is
-- COMMITTED before the wait begins: cron.alter_job is transactional (observed
-- 2026-09-16), and pg_cron cannot see an uncommitted pause. Applied inside one
-- transaction (as tests/db/scheduled_jobs_paused.test.ts does) the file still
-- runs; only the ordering guarantee is psql's.
--
-- THE SETTLE. After a committed pause, no run of a '1 seconds' job started in
-- the following four seconds, in five of five trials, while its earlier runs
-- were recorded (observed 2026-09-16). Two seconds is waited before looking for
-- in-flight runs. openbed.pause_settle_seconds and
-- openbed.pause_deadline_seconds override the defaults, for the test's plants.
--
-- Every failure raises with the prefix OPENBED_JOBS_NOT_PAUSED.
-- ============================================================

DO $$
DECLARE
    v_jobs  text[] := ARRAY['openbed_refresh_lga_rollup', 'openbed_regenerate_snapshot'];
    v_state text;
    v_n     integer;
BEGIN
    IF to_regclass('cron.job') IS NULL THEN
        RAISE EXCEPTION 'OPENBED_JOBS_NOT_PAUSED: pg_cron is not installed (no cron.job); the database is not migrated to 017_snapshot_schedule.sql';
    END IF;

    PERFORM cron.alter_job(jobid, active := false)
       FROM cron.job
      WHERE jobname = ANY (v_jobs) AND username = current_user;

    SELECT count(*) FILTER (WHERE NOT active),
           coalesce(string_agg(jobname || ':active=' || active, ', ' ORDER BY jobname), 'no rows')
      INTO v_n, v_state
      FROM cron.job
     WHERE jobname = ANY (v_jobs) AND username = current_user;

    IF v_n IS DISTINCT FROM array_length(v_jobs, 1) THEN
        RAISE EXCEPTION 'OPENBED_JOBS_NOT_PAUSED: expected % paused, found %', array_to_string(v_jobs, ', '), v_state;
    END IF;
END $$;

DO $$
DECLARE
    v_jobs     text[] := ARRAY['openbed_refresh_lga_rollup', 'openbed_regenerate_snapshot'];
    v_settle   numeric := coalesce(nullif(current_setting('openbed.pause_settle_seconds', true), ''), '2')::numeric;
    v_deadline timestamptz := clock_timestamp()
                 + make_interval(secs => coalesce(nullif(current_setting('openbed.pause_deadline_seconds', true), ''), '30')::numeric);
    v_flight   text;
BEGIN
    PERFORM pg_sleep(v_settle);
    LOOP
        -- A run is in flight while its row reads starting or running. Only recent
        -- rows count: a row left `running` by a crashed server would otherwise
        -- hold every future pause at its deadline.
        SELECT string_agg(j.jobname || ' runid=' || d.runid || ' ' || d.status, ', ')
          INTO v_flight
          FROM cron.job_run_details d
          JOIN cron.job j USING (jobid)
         WHERE j.jobname = ANY (v_jobs)
           AND d.status IN ('starting', 'running')
           AND (d.start_time IS NULL OR d.start_time > now() - interval '10 minutes');
        EXIT WHEN v_flight IS NULL;
        IF clock_timestamp() > v_deadline THEN
            RAISE EXCEPTION 'OPENBED_JOBS_NOT_PAUSED: a run is still in flight at the deadline: %', v_flight;
        END IF;
        PERFORM pg_sleep(0.2);
    END LOOP;
END $$;
