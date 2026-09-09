-- ============================================================
-- 007_public_projection_tables.sql
-- ============================================================
-- Sprint 1, Bundle 1. The three public projection tables -- the ONLY relations an
-- anonymous client can address.
--
-- Empirical state at base: 001-006 applied. `app` holds 11 tables and 2 gate
-- functions; `public` holds nothing of ours.
--
-- Empirical anchors:
--   - supabase/config.toml [api] schemas = ["public", "graphql_public"]. These
--     three tables are in `public` and are therefore reachable by PostgREST. That
--     is the point: they are the publication surface.
--   - 006: app.gate() / app.gate_for_facility(), whose output lands in
--     ward_public.gated_by and is folded into ward_public.accepting_effective.
--
-- REAL TABLES, NOT VIEWS, AND THE REASON IS TWOFOLD.
--   1. Realtime cannot publish a view. 013 adds all three to the
--      supabase_realtime publication.
--   2. A table's column list can be asserted in CI.
--      tests/db/rls_anon_column_containment.test.ts asserts ward_public's column
--      list equals a FROZEN list exactly -- not a subset, equality -- so adding a
--      column to the public surface is a deliberate act that fails a test until
--      the test is updated with it. A view would make that a moving target.
--
-- THE FROZEN COLUMN LIST for public.ward_public is, exactly:
--   facility_id, category, offering, bed_count, accepting_effective,
--   gated_by, state, source, monitoring_state, updated_at
-- Ten columns. NOTE WHAT IS ABSENT: `reason_code`. Zero reasons are private and
-- live only on app.ward_status_event (finding F1). If you add a column here, add
-- it to the frozen list in that test in the same commit and say why in the PR.
--
-- REPLICA IDENTITY IS SET EXPLICITLY ON ALL THREE, and never to FULL.
--   Realtime DELETE events are NOT RLS-filtered, and REPLICA IDENTITY FULL ships
--   the entire old row in the payload. With DEFAULT, a DELETE ships only the
--   primary key. That is what makes quiet mode safe to implement as a DELETE
--   from the mirror in 008 -- see that file's header for the full argument.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS; policies guarded on pg_policies.
--
-- Deployment ordering gate: 008 populates these. Between this file and that one
-- the mirrors exist and are empty, which reads to a client as "no facilities" --
-- correct, and not a failure state.
--
-- Policy scope ledger -- 3 tables, 3 policies, all SELECT, all to anon+authenticated:
--   public.facility_public  -- facility_public_anon_select
--   public.ward_public      -- ward_public_anon_select
--   public.lga_rollup       -- lga_rollup_anon_select
--   Total: 3 policies. NO INSERT, UPDATE or DELETE policy exists on any of them
--   for any client role, and no write GRANT is issued. A missing policy is a
--   denial under RLS, so the absence IS the control; the explicit REVOKEs in
--   section 5 are the second line.
-- ============================================================


-- ============================================================
-- 1. public.facility_public
-- ============================================================
-- A quiet facility has NO ROW HERE. Not a filtered row, not a redacted row --
-- no row. Enforced in the projection (008), not by a policy.
CREATE TABLE IF NOT EXISTS public.facility_public (
    facility_id       uuid PRIMARY KEY,
    name              text NOT NULL,
    lga               text NOT NULL,
    state             text NOT NULL,

    -- The client does haversine locally against these, which is why the USER's
    -- coordinates never leave the device -- not in a query string, not in a
    -- payload. A few hundred facilities is one payload; there is no PostGIS and
    -- no server-side distance query to leak a location to.
    lat               double precision NOT NULL,
    lng               double precision NOT NULL,

    -- Call is the only full-width primary action on a tile. E.164 so a tel: link
    -- works from a roaming or dual-SIM handset.
    public_phone_e164 text NOT NULL,

    updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.facility_public REPLICA IDENTITY DEFAULT;

COMMENT ON TABLE public.facility_public IS
    'Publication mirror of app.facility. Quiet facilities are absent entirely. '
    'Written only by the projection trigger in 008; no client role holds a write '
    'grant.';


-- ============================================================
-- 2. public.ward_public -- the frozen surface.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ward_public (
    facility_id          uuid NOT NULL,
    category             app.ward_category NOT NULL,

    offering             app.ward_offering NOT NULL,

    -- NULL means never reported. The client renders "not yet reporting", NOT
    -- "0 beds". Publishing zero for a ward nobody has updated states a claim the
    -- facility never made.
    bed_count            integer,

    -- DERIVED: app.ward_status.accepting AND app.gate(...) IS NULL.
    -- The ward's own claim lives in `app` and is never edited. This column is the
    -- only place the gate is applied, and it reduces only.
    accepting_effective  boolean NOT NULL,

    -- PUBLIC reason, of type app.gate_reason. Deliberately NOT the same type as
    -- the private app.zero_reason a ward enters by hand, and deliberately worded
    -- differently, because the two collide by name and someone will render the
    -- private one because the switch matched.
    gated_by             app.gate_reason,

    state                app.status_state     NOT NULL,
    source               app.status_source    NOT NULL,
    monitoring_state     app.monitoring_state NOT NULL,

    -- Server-stamped. The client computes freshness from this against
    -- `server_now` carried in the snapshot, never against the device clock
    -- (finding F3).
    updated_at           timestamptz NOT NULL,

    PRIMARY KEY (facility_id, category)
);

ALTER TABLE public.ward_public REPLICA IDENTITY DEFAULT;

COMMENT ON TABLE public.ward_public IS
    'Publication mirror of app.ward_status with the duty-cover gate applied.

     THE COLUMN LIST IS FROZEN and asserted for exact equality by
     tests/db/rls_anon_column_containment.test.ts. Adding a column here widens
     the anonymous read surface of the whole system, so it must be a deliberate
     act that updates that test in the same commit.

     There is no reason_code column and there must never be one: a zero reason is
     the ward''s private explanation and lives only on app.ward_status_event, so
     that even a catastrophic policy error leaks a bed count rather than a reason.';

COMMENT ON COLUMN public.ward_public.gated_by IS
    'PUBLIC gate reason, derived from a public duty flag. Never confuse with '
    'app.zero_reason, which is ward-entered and private.';


-- ============================================================
-- 3. public.lga_rollup -- quiet facilities ONLY.
-- ============================================================
-- Populated by app.refresh_lga_rollup() in 009, which carries the k-floor and
-- the dominance rule. See that file for why the membership is quiet-only:
-- a rollup mixing quiet and visible facilities lets an attacker subtract the
-- visible ones and recover the quiet one exactly, which would make quiet mode
-- theatre.
CREATE TABLE IF NOT EXISTS public.lga_rollup (
    state          text NOT NULL,
    lga            text NOT NULL,
    category       app.ward_category NOT NULL,

    -- Number of DISTINCT quiet facilities contributing. Must be >= 5 for the row
    -- to exist at all.
    facility_count integer NOT NULL,

    -- Sum of bed_count across those same facilities. This is the DENOMINATOR of
    -- the dominance rule -- and it ranges over exactly the set facility_count
    -- counts. Two different sets would make the control incoherent.
    total_beds     integer NOT NULL,

    updated_at     timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (state, lga, category),

    CONSTRAINT lga_rollup_k_floor CHECK (facility_count >= 5),
    CONSTRAINT lga_rollup_beds_non_negative CHECK (total_beds >= 0)
);

ALTER TABLE public.lga_rollup REPLICA IDENTITY DEFAULT;

COMMENT ON TABLE public.lga_rollup IS
    'Coarse availability for QUIET facilities only, aggregated per (state, lga, '
    'category). Never mixes quiet and visible facilities. The k-floor of 5 is a '
    'CHECK constraint, not only a query predicate, so a row that would identify a '
    'facility cannot be inserted even by a future bug in the refresh function.';


-- ============================================================
-- 4. RLS: enabled, with a read-only policy for anonymous callers.
-- ============================================================
ALTER TABLE public.facility_public ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ward_public     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lga_rollup      ENABLE ROW LEVEL SECURITY;

-- FORCE so the table owner is subject to its own policies too. Without it, a
-- definer function owned by the table owner bypasses RLS silently.
ALTER TABLE public.facility_public FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ward_public     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lga_rollup      FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='facility_public' AND policyname='facility_public_anon_select') THEN
        EXECUTE $POLICY$
            CREATE POLICY facility_public_anon_select ON public.facility_public
                FOR SELECT TO anon, authenticated USING (true)
        $POLICY$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ward_public' AND policyname='ward_public_anon_select') THEN
        EXECUTE $POLICY$
            CREATE POLICY ward_public_anon_select ON public.ward_public
                FOR SELECT TO anon, authenticated USING (true)
        $POLICY$;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lga_rollup' AND policyname='lga_rollup_anon_select') THEN
        EXECUTE $POLICY$
            CREATE POLICY lga_rollup_anon_select ON public.lga_rollup
                FOR SELECT TO anon, authenticated USING (true)
        $POLICY$;
    END IF;
END $$;


-- ============================================================
-- 5. Grants: SELECT only, and writes explicitly revoked.
-- ============================================================
-- USING (true) above is correct and is NOT a hole. Every row in these tables is
-- publishable by construction -- the projection decides what gets written, and a
-- quiet facility's rows are never written at all. Trying to express quiet mode as
-- a row predicate here would be the mistake: RLS is row-level, and the
-- requirements in this system are column and aggregation requirements.
-- REVOKE ALL FIRST, THEN GRANT EXACTLY SELECT. The order and the completeness
-- both matter, and an enumerated revoke list is what got this wrong once already.
--
-- A fresh Supabase project carries
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated
-- so a new table in `public` arrives with the FULL privilege set for anon
-- already attached. An enumerated `REVOKE INSERT, UPDATE, DELETE, TRUNCATE`
-- looks exhaustive and is not: it leaves TRIGGER and REFERENCES behind. TRIGGER
-- on a public table would let the grantee attach a trigger to the table the whole
-- dashboard reads.
--
-- Found by tests/db/rls_anon_column_containment.test.ts, which asserts the
-- privilege set is exactly {SELECT} rather than merely that SELECT is present.
-- `REVOKE ALL` then `GRANT SELECT` is total, and stays total when Postgres adds
-- a privilege type that nobody here has heard of yet.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON public.facility_public, public.ward_public, public.lga_rollup FROM %I', r);
            EXECUTE format('GRANT SELECT ON public.facility_public, public.ward_public, public.lga_rollup TO %I', r);
        END IF;
    END LOOP;
END $$;

REVOKE ALL ON public.facility_public, public.ward_public, public.lga_rollup FROM PUBLIC;


-- ============================================================
-- 6. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('007_public_projection_tables.sql', now())
ON CONFLICT (filename) DO NOTHING;
