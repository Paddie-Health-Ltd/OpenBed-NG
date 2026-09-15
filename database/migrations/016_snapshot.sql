-- ============================================================
-- 016_snapshot.sql
-- ============================================================
-- Stage 1. The snapshot: public.snapshot_current, app.regenerate_snapshot(),
-- app.snapshot_retention(), and app.system_heartbeat.last_snapshot_at.
-- The schedule that calls the generator (pg_cron) is 017, not this file.
--
-- Empirical state at base: 001-015 applied. None of these objects exists;
-- app.system_heartbeat (004) has last_sweep_at and no last_snapshot_at.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS; ADD COLUMN IF NOT EXISTS; CREATE OR
-- REPLACE FUNCTION; ENABLE/FORCE ROW LEVEL SECURITY, REVOKE and GRANT are
-- no-ops when already in force. Re-applying changes nothing.
--
-- THE CONSTRAINT, TWO CLAUSES (founder ruling R-2026-09-15-04, correcting the
-- 2026-09-15 wording "derives from ward_public, never the base tables"):
--   1. the generator READS only published surfaces;
--   2. the generator WRITES only public.snapshot_current and the heartbeat.
-- The first wording was at the wrong level: public.lga_rollup is a published
-- surface with its own control (the k-floor and the 0.40 dominance rule), so
-- reading it would not be an ungated route. The real defect in v2:280 is that
-- calling app.refresh_lga_rollup() from here would make the generator a WRITER
-- of a published surface, inside the public read path, holding base-table locks
-- in the snapshot transaction. 008 already states the principle for the other
-- two mirrors: app.project_facility is "the single writer of
-- public.facility_public and public.ward_public".
--
-- WHAT IS OUT, AND STAYS RECORDED.
--   - public.lga_rollup: no refresh call and no payload key. v2:225 defers the
--     payload key to Stage 3 and snapshot-shape.json's envelope has none, so a
--     refresh here would compute something nothing reads. v2's finding 1 --
--     app.refresh_lga_rollup() has no production caller -- is real and stays
--     OPEN; any scheduled caller solves it, not this one.
--     (003's comments at 98-101 and 129-132 name "app.lga_rollup"; the table is
--     public.lga_rollup. 003 is applied and not edited; corrected here.)
--   - The schedule: 017, with condition F's analogue asserting the job exists,
--     is active and is on schedule. F can only assert a mechanism that exists.
--
-- READS FAIL LOUDLY, NEVER EMPTY (R-2026-09-15-05). public.facility_public and
-- public.ward_public are RLS-enabled and FORCEd (007), with SELECT policies for
-- anon and authenticated only. A role that cannot bypass RLS reads ZERO rows
-- from them, silently. So the function carries `SET row_security = off` as an
-- ATTRIBUTE: with it, Postgres raises "query would be affected by row-level
-- security policy for table facility_public" at the first read instead of
-- applying a policy (observed 2026-09-15, PostgreSQL 17.6). It asks the actual
-- question -- would a policy have applied to this read -- rather than a proxy
-- such as rolbypassrls.
-- WHAT HAPPENS WITHOUT IT, OBSERVED, and narrower than first stated. As built,
-- snapshot_current has zero policies, so a non-bypass owner's INSERT is refused
-- too ("new row violates row-level security policy for table snapshot_current"):
-- today the empty read would fail at the WRITE, naming the wrong table. An EMPTY
-- snapshot is published only if a policy ever lets the generator's role write
-- (planted in tests/db/snapshot.test.ts, which reproduces it). The attribute
-- fails at the defect, names the mirror, and does not depend on the write-side
-- table staying policy-free.
-- Local `postgres`, which owns this function, is rolsuper f / rolbypassrls t
-- (observed); hosted values are the founder's check.
-- The pairing: row_security = off catches the GENERATOR losing its bypass;
-- tests/db/rls_enabled_everywhere.test.ts catches RLS being dropped from a MIRROR.
--
-- ROWS DROPPED BETWEEN READ AND ENCODE ARE REFUSED. Each mirror is read once, in
-- one statement (one snapshot), and counted from that read; the encoded array
-- must hold the same number of rows or the function raises SNAPSHOT_ROWS_DROPPED.
-- This check cannot see the RLS hazard -- under it, the read and the count are
-- both zero -- and it is not aimed at it; row_security = off is.
--
-- READER: service_role ONLY (R-2026-09-15-04). v1:258 made the mirrors
-- defence-in-depth rather than the serving path; the serving path is the static
-- file at the edge. An anon-readable snapshot_current would be a second serving
-- path around the CDN, with no s-maxage, disagreeing with the edge on freshness.
-- RLS is enabled and FORCEd with ZERO policies; every client role is revoked by
-- name, because Supabase's default privileges grant ALL on new public tables to
-- anon, authenticated AND service_role (observed 2026-09-15 in pg_default_acl:
-- arwdDxtm for all three, from both postgres and supabase_admin; 007 section 5
-- names the first two). service_role is revoked too, then granted SELECT alone,
-- so the reader holds exactly what it needs and no write.
--
-- EXECUTE: OWNER ONLY (R-2026-09-15-05). service_role has no USAGE on schema app
-- (observed locally, and hosted in runbook step 6 on 2026-09-13), so v2:217's
-- "EXECUTE granted to service_role" is a grant nobody can exercise. The caller is
-- decided in 017: pg_cron runs as the owner; an external caller needs a route
-- that 017 must choose deliberately.
--
-- RETENTION: APPEND, BOUNDED, PRUNED IN THE GENERATOR'S OWN TRANSACTION. A
-- separate pruning job would be a second orphan needing a caller -- the defect
-- this repository already has once (finding 1). The window is
-- app.snapshot_retention(), 24 hours: the default ruled absent a measured
-- argument. The detection latency is measured in Stage 1's planted positive
-- (v2:223); if it argues otherwise, this constant changes, with that reason.
-- History is kept because the heartbeat says the generator is stale NOW; the
-- rows say when it stopped and for how long.
--
-- v COMES FROM THE IDENTITY SEQUENCE, NEVER max(v)+1, which is a
-- read-modify-write that can collide. A GAP IN v IS NOT A MISSING SNAPSHOT:
-- identity sequences are non-transactional, so a value consumed by a generator
-- call that rolled back is never reissued (as 005 records for its id column).
-- A content hash was rejected: identical across two runs on a quiet night, so
-- "v has not moved" could not tell a dead generator from a quiet one.
-- ============================================================


-- ============================================================
-- 1. The heartbeat column.
-- ============================================================
ALTER TABLE app.system_heartbeat ADD COLUMN IF NOT EXISTS last_snapshot_at timestamptz;


-- ============================================================
-- 2. public.snapshot_current -- read by service_role only.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.snapshot_current (
    v            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    generated_at timestamptz NOT NULL,
    -- The envelope of packages/fixtures/snapshot-shape.json:
    -- {v, generated_at, server_now, facilities, wards}, rows as arrays in the
    -- fixture's column order. The column order is asserted against the
    -- fixture by tests/db/snapshot.test.ts, over a generated payload.
    payload      jsonb NOT NULL
);

ALTER TABLE public.snapshot_current REPLICA IDENTITY DEFAULT;

ALTER TABLE public.snapshot_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_current FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.snapshot_current FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON public.snapshot_current FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT SELECT ON public.snapshot_current TO service_role';
    END IF;
END $$;


-- ============================================================
-- 3. The retention window, one named constant.
-- ============================================================
CREATE OR REPLACE FUNCTION app.snapshot_retention()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $FN$
    SELECT interval '24 hours'
$FN$;

COMMENT ON FUNCTION app.snapshot_retention() IS
    'How long app.regenerate_snapshot() keeps public.snapshot_current rows. '
    '24 hours: the ruled default absent a measured detection latency.';


-- ============================================================
-- 4. app.regenerate_snapshot()
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

-- EXECUTE: owner only. Revoke by name as well as from PUBLIC (015's treatment).
REVOKE ALL ON FUNCTION app.regenerate_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.snapshot_retention() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION app.regenerate_snapshot() FROM %I', r);
            EXECUTE format('REVOKE ALL ON FUNCTION app.snapshot_retention() FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 5. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('016_snapshot.sql', now())
ON CONFLICT (filename) DO NOTHING;
