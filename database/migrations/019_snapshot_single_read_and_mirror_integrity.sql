-- ============================================================
-- 019_snapshot_single_read_and_mirror_integrity.sql
-- ============================================================
-- Bundle 3, PR 3.2 (R-2026-09-23-66, issued as R-PROVISIONAL-2026-09-23-AT).
-- A ward can no longer reach the public payload without the facility it belongs
-- to, and a facility can no longer be named with nothing.
--
-- THE DEFECT. apps/public-dashboard rendered `(unknown facility) — ICU_ADULT: 6
-- beds` for a ward whose facility was absent from /beds.json: a count with no
-- callable identity, rendered as if actionable (R-2026-09-21-44 E). The founder
-- ruled it fixed AT SOURCE, and the source has two causes:
--
--   1. THE GENERATOR READ THE TWO MIRRORS IN TWO STATEMENTS. 016's
--      app.regenerate_snapshot() read public.facility_public in one statement and
--      public.ward_public in the next. It is VOLATILE plpgsql under READ
--      COMMITTED, so each statement takes a fresh snapshot, and a projection that
--      commits between them -- app.project_facility() (008) writes the facility
--      and then its wards in ONE transaction -- lands in the second read and not
--      the first. The payload then carries wards whose facility is not in it.
--      pg_cron runs the generator every minute (017), so the window recurs.
--      016's own claim that "the two cannot disagree" is about each mirror's read
--      against its own encoded array, and it HOLDS; 016 never claimed the two
--      mirrors agree with EACH OTHER, and nothing enforced it. This migration
--      reads both in ONE statement, so both come from one snapshot. Demonstrated
--      deterministically, red on 016's body and green on this one, in
--      tests/db/snapshot_single_read.test.ts.
--
--   2. NOTHING TIED A WARD ROW TO A FACILITY ROW. public.ward_public had no
--      foreign key (007), and "the projection is the only writer" is a
--      convention: service_role holds INSERT, UPDATE and DELETE on both mirrors.
--      This adds ward_public(facility_id) -> facility_public(facility_id), NOT
--      DEFERRABLE, NO ACTION. 008 writes the facility before its wards and
--      deletes the wards before the facility, so the projection satisfies it as
--      written.
--
-- AND A NAME THAT IS NOT A NAME. app.facility.name was NOT NULL with no content
-- check (003), so a blank name rendered ` — ICU_ADULT: 6 beds`. CHECK
-- facility_name_not_blank requires one non-space character. The ruling's text
-- was `btrim(name) <> ''`; OBSERVED 2026-09-23 on the local stack (PostgreSQL
-- 17.6, en_US.UTF-8), btrim with no second argument strips ONLY spaces, so a
-- tab-only, newline-only or no-break-space-only name passes it. The regex form
-- below refused all five blank plants there. Whether [:space:] includes U+00A0
-- on the hosted project depends on its ctype, which is not observed here.
--
-- WHY THE GENERATOR DOES NOT REFUSE AN ORPHAN (R-2026-09-23-66 A4). An assertion
-- that raised on a ward with no facility would look like the safe direction and
-- is not: a failed run shows only in cron.job_run_details, the previous
-- snapshots are kept until a success (016's retention prunes only inside a
-- successful run), serve.ts serves the newest row with no age check, and the
-- page shows no age. The public would be served frozen counts with no hint that
-- they had stopped moving. The FK and the single read make the orphan
-- unreachable instead, and the page drops any that arrive anyway.
--
-- Empirical state at base: 001-018 applied, hosted and local. Hosted
-- app.facility and both mirrors held 0 rows at the 018 apply (R-2026-09-22-52),
-- so the pre-checks below are expected to find nothing there.
--
-- Idempotency: the pre-checks only read; each constraint is added only if
-- pg_constraint does not already hold it; VALIDATE on a validated constraint is
-- a no-op; CREATE OR REPLACE keeps the generator's owner and ACL, and the
-- REVOKEs are no-ops when repeated. Re-applying changes neither structure nor
-- rows.
--
-- Deployment ordering gate: after 016 (the generator it replaces), 007 (the
-- mirrors) and 008 (the projection that must satisfy the FK). The hosted apply
-- is the founder's, through docs/runbook-supabase-project-creation.md step 5,
-- under the frozen boundary and the R-2026-09-21-45 gate.
--
-- Object ledger -- 1 function replaced, 2 constraints:
--   app.regenerate_snapshot()        CREATE OR REPLACE; one read statement.
--   ward_public_facility_id_fkey     FK on public.ward_public, NOT DEFERRABLE.
--   facility_name_not_blank          CHECK on app.facility, NOT VALID then
--                                    VALIDATE (a stated form only: the runner
--                                    applies each file in one transaction, so
--                                    the split buys no shorter lock).
-- ============================================================


-- ============================================================
-- 1. Pre-checks. They read, name what they find, and change nothing.
-- ============================================================
DO $$
DECLARE
    v_orphans text;
    v_blank   text;
BEGIN
    SELECT string_agg(format('(%s, %s)', w.facility_id, w.category), ', '
                      ORDER BY w.facility_id, w.category)
      INTO v_orphans
      FROM public.ward_public w
     WHERE NOT EXISTS (SELECT 1 FROM public.facility_public f
                        WHERE f.facility_id = w.facility_id);
    IF v_orphans IS NOT NULL THEN
        RAISE EXCEPTION 'MIRROR_ORPHANS'
              USING ERRCODE = 'P0001',
                    DETAIL  = format('public.ward_public rows with no public.facility_public row: %s',
                                     v_orphans),
                    HINT    = 'Find why the projection left them before adding the foreign key; do not delete them to make this pass.';
    END IF;

    SELECT string_agg(f.id::text, ', ' ORDER BY f.id)
      INTO v_blank
      FROM app.facility f
     WHERE f.name !~ '[^[:space:]]';
    IF v_blank IS NOT NULL THEN
        RAISE EXCEPTION 'FACILITY_NAME_BLANK'
              USING ERRCODE = 'P0001',
                    DETAIL  = format('app.facility rows whose name is blank: %s', v_blank),
                    HINT    = 'Give each facility its real name before adding the check.';
    END IF;
END $$;


-- ============================================================
-- 2. The foreign key.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ward_public_facility_id_fkey'
                      AND conrelid = 'public.ward_public'::regclass) THEN
        ALTER TABLE public.ward_public
            ADD CONSTRAINT ward_public_facility_id_fkey
            FOREIGN KEY (facility_id) REFERENCES public.facility_public (facility_id)
            NOT DEFERRABLE;
    END IF;
END $$;


-- ============================================================
-- 3. The facility name check.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'facility_name_not_blank'
                      AND conrelid = 'app.facility'::regclass) THEN
        ALTER TABLE app.facility
            ADD CONSTRAINT facility_name_not_blank CHECK (name ~ '[^[:space:]]') NOT VALID;
    END IF;
END $$;
ALTER TABLE app.facility VALIDATE CONSTRAINT facility_name_not_blank;


-- ============================================================
-- 4. app.regenerate_snapshot() -- both mirrors in ONE statement.
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
    -- ONE READ: both mirrors, in one statement, so both come from one snapshot
    -- (019). Each is still counted from its own read, and the counts below
    -- still refuse an encode-side edit that drops rows.
    WITH fsrc AS MATERIALIZED (
        SELECT * FROM public.facility_public
    ), fenc AS (
        SELECT coalesce(jsonb_agg(jsonb_build_array(
                   fsrc.facility_id, fsrc.name, fsrc.lga, fsrc.state, fsrc.lat, fsrc.lng,
                   fsrc.public_phone_e164, fsrc.updated_at
               ) ORDER BY fsrc.facility_id), '[]'::jsonb) AS rows
          FROM fsrc
    ), src AS MATERIALIZED (
        SELECT * FROM public.ward_public
    ), enc AS (
        SELECT coalesce(jsonb_agg(jsonb_build_array(
                   src.facility_id, src.category, src.offering, src.bed_count,
                   src.accepting_effective, src.gated_by, src.state, src.source,
                   src.monitoring_state, src.updated_at
               ) ORDER BY src.facility_id, src.category), '[]'::jsonb) AS rows
          FROM src
    )
    SELECT (SELECT count(*) FROM fsrc), fenc.rows, (SELECT count(*) FROM src), enc.rows
      INTO v_fac_read, v_facilities, v_ward_read, v_wards
      FROM fenc, enc;

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
    'Reads only public.facility_public and public.ward_public, in ONE statement so '
    'both come from one snapshot (019); writes only public.snapshot_current and '
    'app.system_heartbeat.last_snapshot_at, in one transaction. row_security = off: '
    'a caller that cannot bypass RLS fails loudly rather than publishing an empty '
    'snapshot. It does not refuse an orphaned ward: see 019''s header for why.';

-- EXECUTE: owner only, restated. CREATE OR REPLACE keeps the ACL; this is the
-- statement of it, so the file reads complete on its own.
REVOKE ALL ON FUNCTION app.regenerate_snapshot() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION app.regenerate_snapshot() FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 5. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('019_snapshot_single_read_and_mirror_integrity.sql', now())
ON CONFLICT (filename) DO NOTHING;
