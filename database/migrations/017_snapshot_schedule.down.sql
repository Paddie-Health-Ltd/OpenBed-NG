-- ============================================================
-- 017_snapshot_schedule.down.sql
-- ============================================================
-- Symmetric reversal of 017: unschedule both jobs by name, and return
-- app.refresh_lga_rollup() to 009's definition by removing the one attribute
-- 017 added.
--
-- The extension is NOT dropped. pg_cron is cluster-wide, and dropping it on the
-- way down would remove every job anyone scheduled, not only 017's -- a wider
-- blast radius than this migration's own. A database reversed past 017 keeps an
-- idle pg_cron with no OpenBed jobs.
--
-- Reversing 017 reopens v2's finding 1 (the rollup has no production caller) and
-- restores the silent below-floor path 017's header describes for an owner
-- without BYPASSRLS.
-- ============================================================

DO $$
DECLARE j text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        FOREACH j IN ARRAY ARRAY['openbed_refresh_lga_rollup', 'openbed_regenerate_snapshot'] LOOP
            IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j AND username = current_user) THEN
                PERFORM cron.unschedule(j);
            END IF;
        END LOOP;
    END IF;
END $$;

ALTER FUNCTION app.refresh_lga_rollup() RESET row_security;

COMMENT ON FUNCTION app.refresh_lga_rollup() IS
    'Full recompute of public.lga_rollup over QUIET facilities only. Applies the '
    'k-floor (>= 5 contributing facilities), publishes the all-zero cell, and '
    'suppresses any cell where one facility holds more than 40% of total beds. '
    'facility_count, total_beds and max_facility_beds all range over the same set: '
    'quiet active facilities in the cell that OFFER the category. Mirrored by '
    'rollupPublishable() in packages/gate/src/rollup.ts.';

DELETE FROM app.schema_migrations WHERE filename = '017_snapshot_schedule.sql';
