-- ============================================================
-- 008_projection_triggers.sql
-- ============================================================
-- Sprint 1, Bundle 1. The projection: `app` base tables -> `public` mirrors.
--
-- Empirical state at base: 001-007 applied. public.facility_public,
-- public.ward_public and public.lga_rollup exist and are EMPTY. app.gate() and
-- app.gate_for_facility() exist (006).
--
-- Empirical anchors:
--   - 007 section 2: ward_public's frozen 10-column list. app.project_facility()
--     below writes exactly those columns and no others.
--   - 007 section 3: all three mirrors are REPLICA IDENTITY DEFAULT. The quiet
--     mode argument below depends on that and on nothing else.
--   - 006: the gate is called, never re-implemented. There is no CASE over
--     ward categories anywhere in this file.
--
-- THE TRIGGER FIRES ON THREE TABLES, NOT ONE.
--   app.ward_status   -- the obvious one.
--   app.facility_ops  -- REQUIRED. A duty flag returning to 'YES' or 'UNKNOWN'
--                        must un-gate the ward's original claim with ZERO human
--                        action. If the projection only fired on ward_status,
--                        the 06:00 restoration would need someone to re-publish
--                        a number that never changed -- and it would not happen.
--   app.facility      -- REQUIRED, and not named in the kickoff's task list.
--                        quiet_mode and is_active live on this table, as do the
--                        name and phone number the mirror publishes. Without
--                        this trigger, flipping a facility to quiet would leave
--                        its rows sitting in the public mirrors indefinitely --
--                        the exact opposite of what quiet mode means. Added
--                        deliberately; flagged here so it reads as a decision
--                        rather than as scope creep.
--
-- QUIET MODE IS A DELETE FROM THE MIRROR, AND THAT NEEDS DEFENDING.
--   Decision A3 says: never delete from a published table, tombstone instead,
--   because Realtime DELETE events are NOT RLS-filtered. Taken alone that reads
--   as a prohibition on what this file does.
--
--   The DELETE is correct HERE, SPECIFICALLY, and the reason is narrow:
--   REPLICA IDENTITY DEFAULT ships ONLY THE PRIMARY KEY in a DELETE payload. The
--   primary keys are (facility_id) and (facility_id, category) -- and both are
--   public information by construction, since the facility was visible in the
--   mirror a moment ago and its categories are the same eight every facility has.
--   The payload therefore leaks nothing beyond "this facility stopped being
--   listed", which is exactly the observable fact quiet mode creates and cannot
--   hide.
--
--   A tombstone column would be WORSE, not better: it would keep a row for the
--   quiet facility in an anon-readable table forever, and the whole requirement
--   is that a quiet facility has NO ROW. The A3 rule and this exception are both
--   stated because a future contributor reading A3 alone will otherwise "fix"
--   this into a tombstone and silently re-expose every quiet facility.
--
--   WHAT WOULD BREAK IT: setting REPLICA IDENTITY FULL on any mirror. That ships
--   the whole old row on DELETE, to unfiltered Realtime subscribers, and turns
--   this from safe into a disclosure. tests/db/config_drift.test.ts asserts no
--   published table has relreplident = 'f'.
--
-- Idempotency: CREATE OR REPLACE FUNCTION; triggers guarded on pg_trigger.
--
-- Deployment ordering gate: none. The functions are self-contained and the
-- triggers only fire on writes that do not yet happen.
--
-- Object ledger -- 2 functions, 5 triggers:
--   app.project_facility(uuid)                 -- the single projection routine
--   app.trg_project()                          -- trigger shim, resolves facility_id
--   trg_ward_status_project      AFTER INSERT OR UPDATE OR DELETE ON app.ward_status
--   trg_facility_ops_project     AFTER INSERT OR UPDATE OR DELETE ON app.facility_ops
--   trg_facility_project         AFTER INSERT OR UPDATE OR DELETE ON app.facility
--   Total: 3 triggers on 3 tables, all row-level, all calling one function.
-- ============================================================


-- ============================================================
-- 1. app.project_facility() -- recompute one facility's mirror rows.
-- ============================================================
-- Runs in the SAME TRANSACTION as the write that triggered it. A published bed
-- count and its source row can never disagree, because there is no window in
-- which one exists without the other.
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

COMMENT ON FUNCTION app.project_facility(uuid) IS
    'Recomputes every public mirror row for one facility, in the caller''s '
    'transaction. The single writer of public.facility_public and '
    'public.ward_public. Quiet, inactive or deleted facilities have their rows '
    'removed rather than filtered.';

-- SECURITY DEFINER, so REVOKE from PUBLIC. 001's default-privilege revocation on
-- `app` already covers this; restated because an explicit revocation is what the
-- allowlist test reads, and because the consequence of missing one here is that
-- an anonymous caller could rewrite the public dashboard.
REVOKE ALL ON FUNCTION app.project_facility(uuid) FROM PUBLIC;


-- ============================================================
-- 2. app.trg_project() -- resolve the facility and delegate.
-- ============================================================
-- One shim for all three tables. app.facility keys on `id`; the other two key on
-- `facility_id`. TG_TABLE_NAME rather than three near-identical functions,
-- because three copies of a projection call is three places to forget one.
CREATE OR REPLACE FUNCTION app.trg_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_facility_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'facility' THEN
        v_facility_id := coalesce(NEW.id, OLD.id);
    ELSE
        v_facility_id := coalesce(NEW.facility_id, OLD.facility_id);
    END IF;

    IF v_facility_id IS NOT NULL THEN
        PERFORM app.project_facility(v_facility_id);
    END IF;

    -- AFTER trigger: the return value is ignored, but returning NULL from an
    -- AFTER trigger is conventional and avoids implying the row was modified.
    RETURN NULL;
END;
$FN$;

REVOKE ALL ON FUNCTION app.trg_project() FROM PUBLIC;


-- ============================================================
-- 3. The three triggers.
-- ============================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ward_status_project') THEN
        EXECUTE 'CREATE TRIGGER trg_ward_status_project
                     AFTER INSERT OR UPDATE OR DELETE ON app.ward_status
                     FOR EACH ROW EXECUTE FUNCTION app.trg_project()';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_facility_ops_project') THEN
        EXECUTE 'CREATE TRIGGER trg_facility_ops_project
                     AFTER INSERT OR UPDATE OR DELETE ON app.facility_ops
                     FOR EACH ROW EXECUTE FUNCTION app.trg_project()';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_facility_project') THEN
        EXECUTE 'CREATE TRIGGER trg_facility_project
                     AFTER INSERT OR UPDATE OR DELETE ON app.facility
                     FOR EACH ROW EXECUTE FUNCTION app.trg_project()';
    END IF;
END $$;


-- ============================================================
-- 4. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('008_projection_triggers.sql', now())
ON CONFLICT (filename) DO NOTHING;
