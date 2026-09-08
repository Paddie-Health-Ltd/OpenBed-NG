-- ============================================================
-- 009_lga_rollup_kfloor.sql
-- ============================================================
-- Sprint 1, Bundle 1. The k-anonymity rule for public.lga_rollup.
--
-- Empirical state at base: 001-008 applied. public.lga_rollup exists (007
-- section 3) with CHECK (facility_count >= 5) already on the table.
--
-- Empirical anchors:
--   - 007 section 3: the table's own CHECK enforces the k-floor independently of
--     this function, so a future bug here cannot insert an identifying row.
--   - 003 section 2: app.facility.quiet_mode is the membership predicate.
--
-- WHY THIS COVERS QUIET FACILITIES ONLY.
--   A rollup mixing quiet and visible facilities is worse than no rollup. Every
--   visible facility's exact numbers are published in public.ward_public, so an
--   attacker subtracts the visible ones from the aggregate and recovers the quiet
--   one exactly. Quiet mode would be theatre. The membership predicate below is
--   `quiet_mode` and nothing else.
--
-- ONE SET, NOT TWO -- and this had to be resolved rather than left to the query.
--   The kickoff says "a k-floor of 5 REPORTING facilities and no facility
--   exceeding 40% of the DENOMINATOR". Those are two different phrases and could
--   describe two different sets. If the count ranged over one set and the
--   denominator over another, the dominance rule would measure a share of
--   something the count never counted.
--
--   THE SET, stated once and used for all three aggregates:
--     quiet, active facilities in this (state, lga) that OFFER this category.
--   `facility_count`, `total_beds` and `max_facility_beds` all range over
--   exactly that set. A facility with the ward marked NOT_OFFERED is not
--   reporting on this category and is not a member -- it can neither help clear
--   the k-floor nor dilute the dominance ratio.
--
-- THE DENOMINATOR IS SUMMED BED COUNT, NOT FACILITY COUNT.
--   Facility count was considered and REJECTED deliberately, because with k >= 5
--   any single facility is at most 1/5 = 20% of the count, so a 40% rule could
--   never bind. It would be a control that reads as protective and enforces
--   nothing.
--
-- THE BRANCH ORDER IS LOAD-BEARING. See section 1 and the long note in
-- packages/gate/src/rollup.ts. Postgres THROWS on division by zero while
-- JavaScript yields NaN (and `NaN <= 0.40` is false), so an unordered
-- conjunction makes SQL error and the mirror silently suppress, from the same
-- input, with neither reporting a disagreement.
--
-- Idempotency: CREATE OR REPLACE FUNCTION. The refresh itself is a full
-- recompute -- DELETE then INSERT inside one transaction -- so running it twice
-- is a no-op and running it concurrently is safe under the table's primary key.
--
-- Deployment ordering gate: this function is NOT called by a trigger. It is a
-- batch recompute, invoked by the snapshot generator (B4) and by tests. Wiring it
-- to a schedule is Bundle 4/5 work; nothing here assumes it has run.
--
-- Object ledger -- 1 function:
--   app.refresh_lga_rollup()   SECURITY DEFINER, search_path='', EXECUTE revoked.
-- ============================================================


-- ============================================================
-- 1. app.refresh_lga_rollup()
-- ============================================================
CREATE OR REPLACE FUNCTION app.refresh_lga_rollup()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    'rollupPublishable() in packages/gate/src/rollup.ts.';

REVOKE ALL ON FUNCTION app.refresh_lga_rollup() FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION app.refresh_lga_rollup() FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION app.refresh_lga_rollup() FROM authenticated';
    END IF;
END $$;


-- ============================================================
-- 2. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('009_lga_rollup_kfloor.sql', now())
ON CONFLICT (filename) DO NOTHING;
