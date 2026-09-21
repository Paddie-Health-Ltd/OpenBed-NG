-- ============================================================
-- 018_close_mirror_read_and_push_surfaces.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 017 state: the three mirrors go back into
-- supabase_realtime, and SELECT on exactly those three is granted back to
-- exactly anon and authenticated. Nothing broader.
--
-- ------------------------------------------------------------
-- WHY THIS REVERSES WHEN 013'S DOWN DELIBERATELY DOES NOT.
-- ------------------------------------------------------------
-- Read this before concluding the two files disagree about the same hazard.
-- They do not; they are about different shapes of reversal.
--
--   013's forward migration ran a SWEEP: it re-asserted 001's revocations over
--   every object that existed by then. What a sweep removes is an UNENUMERATED
--   DEFAULT SET -- whatever privileges happened to be attached. Its reversal
--   would therefore have to GRANT anon access to the `app` schema, which 013
--   never took away and which nothing should ever hand back. That reversal
--   OVERSHOOTS, and 013's down file says so and withholds it.
--
--   018's forward migration revokes an ENUMERATED SET: SELECT, on three named
--   relations, from two named roles. {SELECT} is the whole of what those roles
--   held on those relations. Restoring precisely that CANNOT overshoot, because
--   there is nothing outside it to overshoot into.
--
-- The rule underneath both: a reversal restores what its forward removed, and
-- may not restore more. 013 could not satisfy that and said so; 018 can.
--
-- ------------------------------------------------------------
-- WHAT APPLYING THIS DOES, STATED PLAINLY.
-- ------------------------------------------------------------
-- On the hosted project this RE-OPENS anonymous and authenticated read of
-- public.facility_public, public.ward_public and public.lga_rollup to any holder
-- of the published key -- which is every visitor, because that key ships in the
-- browser bundle. It re-opens Realtime events from those tables on the same
-- terms.
--
-- ward_public carries per-ward bed counts and their update times, and the
-- accumulation boundary of Sprint A1 exists because a caller who can poll that
-- table can build the history the project does not publish.
--
--   WHILE THIS REVERSAL IS APPLIED, NO FACILITY AGREEMENT MAY CARRY A
--   HISTORY-IS-PRIVATE COMMITMENT. That is not a caution about tidiness. It is
--   the commitment the boundary exists to make true, and this file makes it
--   false for as long as it is in effect.
--
-- ------------------------------------------------------------
-- THE USE RULE.
-- ------------------------------------------------------------
-- This reversal is NEVER applied to the hosted project without a founder ruling
-- naming the reason. Applying it locally, or in a test that puts it back, is
-- ordinary and is what the round-trip test in tests/db does.
--
-- The same rule is recorded beside the hosted-apply step in
-- docs/runbook-supabase-project-creation.md, because that is where someone about
-- to run it will be reading -- not here.
--
-- A FILE CANNOT ENFORCE THIS, and no check in this repository can either: a
-- reversal is applied by a human with a database URL. What is written here is
-- the reason, placed where that human will see it.
--
-- Idempotency: publication membership is guarded on pg_publication_tables; GRANT
-- on an already-granted privilege is a no-op.
-- ============================================================


-- ============================================================
-- 1. Restore publication membership -- the PUSH surface.
-- ============================================================
DO $$
DECLARE
    t text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE NOTICE 'publication supabase_realtime not present; skipping';
        RETURN;
    END IF;

    FOREACH t IN ARRAY ARRAY['facility_public', 'ward_public', 'lga_rollup'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 2. Restore SELECT -- the READ surface. EXACTLY {SELECT}, exactly two roles.
-- ============================================================
-- GRANT SELECT, not GRANT ALL, and not a REVOKE ALL first. 007 needed the
-- revoke-then-grant form because it was taming Supabase's default privileges on
-- a NEW table. These tables are not new and their privilege set is known: the
-- forward migration removed SELECT and nothing else, so SELECT is all there is
-- to put back. Widening this line is the overshoot the header refuses.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format(
                'GRANT SELECT ON public.facility_public, public.ward_public, public.lga_rollup TO %I',
                r
            );
        END IF;
    END LOOP;
END $$;


DELETE FROM app.schema_migrations WHERE filename = '018_close_mirror_read_and_push_surfaces.sql';
