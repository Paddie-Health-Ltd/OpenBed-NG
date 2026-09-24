-- ============================================================
-- 020_operator_functions_and_listing.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 019 state. The operator and provisioning
-- functions go, and so do the version trigger, the two unique indexes and both
-- columns. The two public-membership bodies return to 008's and 017's, and the
-- ledger row is removed.
--
-- WHAT APPLYING THIS DOES, STATED PLAINLY. Every facility becomes public again
-- whether or not it was listed, because the listing state is dropped with its
-- column. An unlisted facility would then reach the mirrors, and the rollup too if
-- quiet, on its next projection. Nothing publishes it until that projection runs:
-- dropping a column fires no trigger. More than one open invite per scope, and more
-- than one active account per ward, become possible again.
--
-- The two bodies below are 008's and 017's VERBATIM, copied from those files and
-- not retyped, so the reversal restores exactly what the forward replaced.
--
-- Idempotency: DROP ... IF EXISTS throughout; CREATE OR REPLACE; the ledger DELETE
-- matches at most one row. Everything is dropped RESTRICT, never CASCADE.
-- ============================================================


-- ============================================================
-- 1. The operator and provisioning functions.
-- ============================================================
DROP FUNCTION IF EXISTS public.operator_create_facility(text, text, text, text, double precision, double precision, text) RESTRICT;
DROP FUNCTION IF EXISTS public.operator_edit_facility(text, integer, text, text, text, double precision, double precision, text) RESTRICT;
DROP FUNCTION IF EXISTS public.operator_set_facility_listed(text, integer) RESTRICT;
DROP FUNCTION IF EXISTS public.operator_add_category(text, text, text) RESTRICT;
DROP FUNCTION IF EXISTS public.operator_list_facilities() RESTRICT;
DROP FUNCTION IF EXISTS app.provision_begin(uuid, text, text) RESTRICT;
DROP FUNCTION IF EXISTS app.provision_complete(uuid, uuid) RESTRICT;
DROP FUNCTION IF EXISTS app.operator_session(uuid) RESTRICT;
DROP FUNCTION IF EXISTS app.assert_operator() RESTRICT;


-- ============================================================
-- 2. The unique indexes and the version trigger.
-- ============================================================
DROP INDEX IF EXISTS app.invite_one_open_per_scope RESTRICT;
DROP INDEX IF EXISTS app.ward_account_one_active_per_ward RESTRICT;
DROP TRIGGER IF EXISTS trg_facility_version ON app.facility;
DROP FUNCTION IF EXISTS app.bump_facility_version() RESTRICT;


-- ============================================================
-- 3. The two public-membership bodies, restored to 008 and 017, BEFORE the column
--    they read is dropped.
-- ============================================================
CREATE OR REPLACE FUNCTION app.project_facility(p_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_visible boolean;
BEGIN
    -- Visible means: the facility exists, is active, and is not in quiet mode.
    -- A facility row that has been deleted yields NULL, which coalesces to false
    -- and therefore removes its mirror rows -- the correct behaviour.
    SELECT f.is_active AND NOT f.quiet_mode
      INTO v_visible
      FROM app.facility f
     WHERE f.id = p_facility_id;

    v_visible := coalesce(v_visible, false);

    IF NOT v_visible THEN
        -- QUIET, INACTIVE OR GONE: no row, not a filtered row. See the header
        -- for why a DELETE is safe here and a tombstone would not be.
        DELETE FROM public.ward_public     WHERE facility_id = p_facility_id;
        DELETE FROM public.facility_public WHERE facility_id = p_facility_id;
        RETURN;
    END IF;

    -- ---- facility_public ------------------------------------------------
    INSERT INTO public.facility_public
        (facility_id, name, lga, state, lat, lng, public_phone_e164, updated_at)
    SELECT f.id, f.name, f.lga, f.state, f.lat, f.lng, f.public_phone_e164, f.updated_at
      FROM app.facility f
     WHERE f.id = p_facility_id
    ON CONFLICT (facility_id) DO UPDATE SET
        name              = EXCLUDED.name,
        lga               = EXCLUDED.lga,
        state             = EXCLUDED.state,
        lat               = EXCLUDED.lat,
        lng               = EXCLUDED.lng,
        public_phone_e164 = EXCLUDED.public_phone_e164,
        updated_at        = EXCLUDED.updated_at;

    -- ---- ward_public ----------------------------------------------------
    -- accepting_effective composes two things, and both are deliberate:
    --   (a) offering = 'OFFERED'  -- a ward the facility does not offer is never
    --       accepting, whatever its stored claim says. Mirrored by
    --       acceptingEffectiveForWard() in packages/gate/src/gate.ts.
    --   (b) accepting AND gate IS NULL -- the ward's claim, reduced by the gate.
    --       The gate can close; it can never open. The only route to `true` here
    --       is the ward having claimed `true`.
    INSERT INTO public.ward_public
        (facility_id, category, offering, bed_count,
         accepting_effective, gated_by, state, source, monitoring_state, updated_at)
    SELECT
        ws.facility_id,
        ws.category,
        ws.offering,
        ws.bed_count,
        (ws.offering = 'OFFERED'
             AND ws.accepting
             AND app.gate(ws.category, ops.anaesthetist, ops.obstetrician, ops.paediatrician) IS NULL),
        app.gate(ws.category, ops.anaesthetist, ops.obstetrician, ops.paediatrician),
        ws.state,
        ws.source,
        ws.monitoring_state,
        ws.updated_at
      FROM app.ward_status ws
      -- LEFT JOIN, not JOIN. A facility with no facility_ops row must still
      -- publish its wards, ungated: no recorded duty cover is not the same thing
      -- as recorded absence of cover. An inner join here would make every ward at
      -- such a facility silently vanish from the public dashboard.
      LEFT JOIN app.facility_ops ops ON ops.facility_id = ws.facility_id
     WHERE ws.facility_id = p_facility_id
    ON CONFLICT (facility_id, category) DO UPDATE SET
        offering            = EXCLUDED.offering,
        bed_count           = EXCLUDED.bed_count,
        accepting_effective = EXCLUDED.accepting_effective,
        gated_by            = EXCLUDED.gated_by,
        state               = EXCLUDED.state,
        source              = EXCLUDED.source,
        monitoring_state    = EXCLUDED.monitoring_state,
        updated_at          = EXCLUDED.updated_at;

    -- Remove mirror rows whose source ward_status row is gone.
    DELETE FROM public.ward_public wp
     WHERE wp.facility_id = p_facility_id
       AND NOT EXISTS (
           SELECT 1 FROM app.ward_status ws
            WHERE ws.facility_id = wp.facility_id
              AND ws.category    = wp.category
       );
END;
$FN$;

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


-- ============================================================
-- 4. The columns.
-- ============================================================
ALTER TABLE app.facility DROP COLUMN IF EXISTS version RESTRICT;
ALTER TABLE app.facility DROP COLUMN IF EXISTS listed_at RESTRICT;


-- ============================================================
-- 5. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '020_operator_functions_and_listing.sql';
