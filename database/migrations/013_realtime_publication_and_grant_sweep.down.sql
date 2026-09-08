-- ============================================================
-- 013_realtime_publication_and_grant_sweep.down.sql
-- ============================================================
-- Symmetric reversal of 013: remove the three mirrors from the publication.
--
-- The grant sweep in section 2 of the forward migration is NOT reversed, and
-- that is deliberate rather than an omission. It re-asserted 001's revocations
-- and created no new state of its own; "undoing" it would mean GRANTing anon
-- access to the `app` schema, which 013 never took away and which nothing should
-- ever hand back. A reversal that overshoots is a drift, and this one would be a
-- drift that opens the security boundary.
-- ============================================================

DO $$
DECLARE
    t text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RETURN;
    END IF;

    FOREACH t IN ARRAY ARRAY['lga_rollup', 'ward_public', 'facility_public'] LOOP
        IF EXISTS (
            SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

DELETE FROM app.schema_migrations WHERE filename = '013_realtime_publication_and_grant_sweep.sql';
