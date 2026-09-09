-- ============================================================
-- database/seed/001_synthetic_seed.sql
-- ============================================================
-- SYNTHETIC DATA ONLY. Loaded by scripts/seed.sh, which REFUSES to run against a
-- non-local database.
--
-- THIS IS NOT A MIGRATION AND IS NOT LEDGERED, deliberately. Seed data that
-- rides the migration ledger reaches every environment the ledger reaches. The
-- sibling project's history is the argument: a synthetic-data constraint went in
-- as migration 006 and had to be taken out again by migration 013.
--
-- NOTHING HERE IS REAL. No real facility name, no real coordinates for a real
-- hospital, no real phone number. Names are "Synthetic ... Hospital"; numbers are
-- in a deliberately implausible +234800 range; coordinates are inside the Nigeria
-- bounding box but not on any particular building. The kickoff's rule is that the
-- facility list and real duty numbers are NEVER committed, and this file is the
-- most likely place for that rule to erode.
--
-- THE SIX SHAPES the Bundle 1 definition of done requires, all present:
--   1. a quiet facility                       -> SYN-Q1..Q6 (six, so the k-floor
--                                                 of 5 is exercisable both ways)
--   2. a facility with anaesthetist = 'NO'    -> SYN-GATED
--   3. a facility with all flags 'UNKNOWN'    -> SYN-OPEN
--   4. a ward at zero with a reason           -> SYN-OPEN / NICU
--   5. a NOT_OFFERED ward                     -> SYN-OPEN / SCBU
--   6. a never-updated ward                   -> SYN-OPEN / MATERNITY (PENDING)
--
-- Idempotent: fixed UUIDs plus ON CONFLICT DO NOTHING, so re-running adds
-- nothing. `npm run db:reset` drops everything first in any case.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SYN-OPEN -- all duty flags UNKNOWN. The day-one facility.
-- ============================================================
-- The most important row in this file. Every flag is at its default 'UNKNOWN',
-- which is the state EVERY real facility will be in on the first day. If the
-- gate ever treats UNKNOWN as closed, this facility goes dark and takes the
-- whole city with it.
INSERT INTO app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode)
VALUES ('a0000000-0000-4000-8000-000000000001',
        'Synthetic Central Hospital (SYN-OPEN)', 'Ikeja', 'Lagos',
        6.6018, 3.3515, '+2348000000001', false)
ON CONFLICT (id) DO NOTHING;

-- Flags left entirely at their NOT NULL DEFAULT 'UNKNOWN'. Not written out
-- explicitly, so that the DEFAULT itself is what the seed exercises.
INSERT INTO app.facility_ops (facility_id)
VALUES ('a0000000-0000-4000-8000-000000000001')
ON CONFLICT (facility_id) DO NOTHING;

INSERT INTO app.ward_status
    (id, facility_id, category, offering, bed_count, accepting, monitoring_state, source)
VALUES
    -- Ordinary reporting wards.
    ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','A_AND_E','OFFERED',4,true,'ACTIVE','WARD'),
    ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','ICU_ADULT','OFFERED',1,true,'ACTIVE','WARD'),
    ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','THEATRE','OFFERED',2,true,'ACTIVE','WARD'),

    -- SHAPE 4: at zero, WITH a reason. The reason itself lives on the event row
    -- below, never here -- there is no reason_code column on this table.
    ('b0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','NICU','OFFERED',0,true,'ACTIVE','WARD'),

    -- SHAPE 5: NOT_OFFERED. This facility has no SCBU at all. bed_count must be
    -- NULL -- the CHECK constraint in 004 enforces it -- and the tile must say
    -- "not offered", never "0 beds".
    ('b0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','SCBU','NOT_OFFERED',NULL,true,'PENDING','WARD'),

    -- SHAPE 6: offered but NEVER UPDATED. bed_count IS NULL and monitoring_state
    -- is PENDING. The tile reads "not yet reporting" and NO silence alert ever
    -- fires -- staleness is only meaningful for a ward that has demonstrated
    -- someone can and will update it. This is what makes the first night generate
    -- zero alerts by construction rather than by special case.
    ('b0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001','MATERNITY','OFFERED',NULL,true,'PENDING','WARD')
ON CONFLICT (facility_id, category) DO NOTHING;

-- The zero reason for NICU. PRIVATE: it exists only on the event table and is
-- asserted absent from every anon-readable relation.
INSERT INTO app.ward_status_event
    (ward_status_id, facility_id, category, offering, bed_count, accepting,
     state, source, reason_code, version, composed_at)
VALUES
    ('b0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001',
     'NICU','OFFERED',0,true,'OK','WARD','STAFF_SHORTAGE',1, now())
ON CONFLICT DO NOTHING;


-- ============================================================
-- 2. SYN-GATED -- anaesthetist = 'NO'. SHAPE 2.
-- ============================================================
-- THEATRE and SURGICAL are gated. Both wards still claim accepting = true, and
-- that claim is preserved untouched (finding F1) -- only the projection reduces.
-- NICU here is NOT gated, which is the cross-gate case: an anaesthetist being
-- off duty must not close a neonatal unit.
INSERT INTO app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode)
VALUES ('a0000000-0000-4000-8000-000000000002',
        'Synthetic Riverside Hospital (SYN-GATED)', 'Surulere', 'Lagos',
        6.4969, 3.3481, '+2348000000002', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.facility_ops (facility_id, anaesthetist, obstetrician, paediatrician)
VALUES ('a0000000-0000-4000-8000-000000000002', 'NO', 'YES', 'UNKNOWN')
ON CONFLICT (facility_id) DO NOTHING;

INSERT INTO app.ward_status
    (id, facility_id, category, offering, bed_count, accepting, monitoring_state, source)
VALUES
    ('b0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000002','THEATRE','OFFERED',3,true,'ACTIVE','WARD'),
    ('b0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000002','SURGICAL','OFFERED',5,true,'ACTIVE','WARD'),
    ('b0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000002','NICU','OFFERED',2,true,'ACTIVE','WARD'),
    -- MATERNITY with obstetrician = 'YES': ungated, and a live check that a YES
    -- neither gates nor promotes.
    ('b0000000-0000-4000-8000-000000000014','a0000000-0000-4000-8000-000000000002','MATERNITY','OFFERED',1,true,'ACTIVE','WARD'),
    -- A ward that says it is NOT accepting while the flag says YES. The gate
    -- reduces only: this must stay closed.
    ('b0000000-0000-4000-8000-000000000015','a0000000-0000-4000-8000-000000000002','A_AND_E','OFFERED',7,false,'ACTIVE','WARD')
ON CONFLICT (facility_id, category) DO NOTHING;


-- ============================================================
-- 3. SYN-Q1..Q6 -- SHAPE 1: quiet facilities.
-- ============================================================
-- SIX, not one, and in TWO different LGAs, so both sides of the k-floor are
-- exercisable from the seed alone:
--   Alimosho  -- 5 quiet facilities -> clears the floor, cell publishes
--   Kosofe    -- 1 quiet facility   -> below the floor, nothing publishes
--
-- A quiet facility must have NO ROW in either public mirror. Not a filtered row,
-- not a redacted row. Its contribution reaches public.lga_rollup only.
DO $$
DECLARE
    i        integer;
    v_id     uuid;
    v_lga    text;
    v_beds   integer;
BEGIN
    FOR i IN 1..6 LOOP
        v_id  := ('a0000000-0000-4000-8000-00000000010' || i::text)::uuid;
        -- Five in Alimosho, one in Kosofe.
        v_lga := CASE WHEN i <= 5 THEN 'Alimosho' ELSE 'Kosofe' END;
        -- Balanced counts so no single facility exceeds 40% of the total: the
        -- cell must publish for the k-floor reason, not fail for the dominance
        -- reason. A dominance case is constructed in the tests instead, where the
        -- numbers can be stated next to the assertion.
        v_beds := 3;

        INSERT INTO app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode)
        VALUES (v_id, 'Synthetic Quiet Hospital ' || i::text || ' (SYN-Q' || i::text || ')',
                v_lga, 'Lagos', 6.60 + (i * 0.01), 3.30 + (i * 0.01),
                '+23480000001' || i::text, true)
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO app.facility_ops (facility_id) VALUES (v_id)
        ON CONFLICT (facility_id) DO NOTHING;

        INSERT INTO app.ward_status
            (facility_id, category, offering, bed_count, accepting, monitoring_state, source)
        VALUES (v_id, 'ICU_ADULT', 'OFFERED', v_beds, true, 'ACTIVE', 'WARD')
        ON CONFLICT (facility_id, category) DO NOTHING;
    END LOOP;
END $$;

-- Populate the rollup from the quiet facilities just inserted.
SELECT app.refresh_lga_rollup();

COMMIT;
