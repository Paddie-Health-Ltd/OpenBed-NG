-- ============================================================
-- 019_snapshot_single_read_and_mirror_integrity.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 018 state: 016's two-statement generator
-- back, the foreign key and the name check gone, the ledger row removed.
--
-- WHAT APPLYING THIS DOES, STATED PLAINLY. It reopens the torn read 019 closed:
-- a facility made visible between the generator's two statements yields a
-- payload with wards whose facility is absent, and the page drops them
-- (R-2026-09-23-66 B1). It also lets a ward_public row name a facility that is
-- not there, and a facility carry a blank name. Nothing else changes.
--
-- The generator below is 016's body VERBATIM -- copied from
-- 016_snapshot.sql, not retyped -- so a reversal restores exactly what the
-- forward replaced and nothing more.
--
-- Idempotency: DROP CONSTRAINT IF EXISTS; CREATE OR REPLACE; the ledger DELETE
-- matches at most one row. Constraints are dropped RESTRICT, never CASCADE.
-- ============================================================


-- ============================================================
-- 1. The generator, restored to 016.
-- ============================================================
CREATE OR REPLACE FUNCTION app.regenerate_snapshot()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $FN$
DECLARE
    v_now         timestamptz := now();
    v_v           bigint;
    v_facilities  jsonb;
    v_wards       jsonb;
    v_fac_read    bigint;
    v_ward_read   bigint;
BEGIN
    -- READ 1: public.facility_public, once, counted from the same read.
    WITH src AS MATERIALIZED (
        SELECT * FROM public.facility_public
    ), enc AS (
        SELECT coalesce(jsonb_agg(jsonb_build_array(
                   src.facility_id, src.name, src.lga, src.state, src.lat, src.lng,
                   src.public_phone_e164, src.updated_at
               ) ORDER BY src.facility_id), '[]'::jsonb) AS rows
          FROM src
    )
    SELECT (SELECT count(*) FROM src), enc.rows
      INTO v_fac_read, v_facilities
      FROM enc;

    -- READ 2: public.ward_public, the same way.
    WITH src AS MATERIALIZED (
        SELECT * FROM public.ward_public
    ), enc AS (
        SELECT coalesce(jsonb_agg(jsonb_build_array(
                   src.facility_id, src.category, src.offering, src.bed_count,
                   src.accepting_effective, src.gated_by, src.state, src.source,
                   src.monitoring_state, src.updated_at
               ) ORDER BY src.facility_id, src.category), '[]'::jsonb) AS rows
          FROM src
    )
    SELECT (SELECT count(*) FROM src), enc.rows
      INTO v_ward_read, v_wards
      FROM enc;

    IF jsonb_array_length(v_facilities) <> v_fac_read THEN
        RAISE EXCEPTION 'SNAPSHOT_ROWS_DROPPED'
              USING ERRCODE = 'P0001',
                    DETAIL  = format('public.facility_public read %s rows; the payload encoded %s',
                                     v_fac_read, jsonb_array_length(v_facilities));
    END IF;
    IF jsonb_array_length(v_wards) <> v_ward_read THEN
        RAISE EXCEPTION 'SNAPSHOT_ROWS_DROPPED'
              USING ERRCODE = 'P0001',
                    DETAIL  = format('public.ward_public read %s rows; the payload encoded %s',
                                     v_ward_read, jsonb_array_length(v_wards));
    END IF;

    -- WRITE 1: the snapshot row. v from the identity sequence, carried into the
    -- payload so the edge file names its own version.
    v_v := nextval(pg_catalog.pg_get_serial_sequence('public.snapshot_current', 'v'));
    INSERT INTO public.snapshot_current (v, generated_at, payload)
    OVERRIDING SYSTEM VALUE
    VALUES (
        v_v,
        v_now,
        jsonb_build_object(
            'v',            v_v,
            'generated_at', v_now,
            'server_now',   v_now,
            'facilities',   v_facilities,
            'wards',        v_wards
        )
    );

    -- WRITE 2: the heartbeat, in the same transaction, so a regeneration can
    -- never be claimed that did not commit.
    UPDATE app.system_heartbeat SET last_snapshot_at = v_now WHERE id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SNAPSHOT_HEARTBEAT_MISSING'
              USING ERRCODE = 'P0001',
                    DETAIL  = 'app.system_heartbeat has no row; 004 seeds one';
    END IF;

    -- WRITE 1, continued: prune past the window, in the same transaction.
    DELETE FROM public.snapshot_current
     WHERE generated_at < v_now - app.snapshot_retention();

    RETURN v_v;
END;
$FN$;

COMMENT ON FUNCTION app.regenerate_snapshot() IS
    'Reads only public.facility_public and public.ward_public; writes only '
    'public.snapshot_current and app.system_heartbeat.last_snapshot_at, in one '
    'transaction. row_security = off: a caller that cannot bypass RLS fails '
    'loudly rather than publishing an empty snapshot.';


-- ============================================================
-- 2. The constraints.
-- ============================================================
ALTER TABLE app.facility DROP CONSTRAINT IF EXISTS facility_name_not_blank RESTRICT;
ALTER TABLE public.ward_public DROP CONSTRAINT IF EXISTS ward_public_facility_id_fkey RESTRICT;


-- ============================================================
-- 3. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '019_snapshot_single_read_and_mirror_integrity.sql';
