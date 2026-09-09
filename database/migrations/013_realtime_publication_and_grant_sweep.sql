-- ============================================================
-- 013_realtime_publication_and_grant_sweep.sql
-- ============================================================
-- Sprint 1, Bundle 1. Publish the three mirrors to Realtime, and re-assert every
-- revocation from 001 now that all objects exist.
--
-- Empirical state at base: 001-012 applied. The supabase_realtime publication
-- exists (created by the Supabase platform, not by this repository).
--
-- WHY A SWEEP AT THE END.
--   001's ALTER DEFAULT PRIVILEGES protects objects created AFTER it by the
--   migrating role. It does not retroactively cover anything, and it does not
--   cover objects created by another role. Twelve migrations later, this file
--   re-derives the intended end state over everything that now exists. 001 is the
--   wall; this is the inspection. Both are cheap and neither is sufficient alone.
--
-- REALTIME AND THE THREE MIRRORS.
--   Realtime is retained for AUTHENTICATED ward and admin devices only. The
--   public dashboard does NOT open a Realtime connection -- it polls a static
--   snapshot -- because the free tier refuses connections past 200 concurrent,
--   which is roughly one WhatsApp forward, and because a dropped WebSocket looks
--   open to JavaScript until a write fails while Supabase Realtime has no
--   gap-fill: events missed while disconnected are gone permanently. A tile could
--   sit green and structurally incapable of being correct.
--
--   REPLICA IDENTITY STAYS DEFAULT ON ALL THREE. Realtime DELETE events are NOT
--   RLS-filtered; DEFAULT ships only the primary key, FULL ships the whole old
--   row. 008 relies on exactly this to make quiet-mode DELETEs safe. Setting FULL
--   on any of these would turn a safe deletion into a disclosure of the quiet
--   facility's last known bed counts to every subscriber.
--   tests/db/config_drift.test.ts asserts no published table has
--   relreplident = 'f'.
--
-- Idempotency: publication membership guarded on pg_publication_tables; the
-- revocations are naturally idempotent.
--
-- Deployment ordering gate: LAST. It asserts over everything, so it must run
-- after everything.
--
-- Ledger:
--   supabase_realtime += public.facility_public, public.ward_public, public.lga_rollup
--   Total published tables from this repository: 3, and the config-drift test
--   asserts the publication contains EXACTLY these three.
-- ============================================================


-- ============================================================
-- 1. Publish the three mirrors.
-- ============================================================
DO $$
DECLARE
    t text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        -- A bare Postgres container has no such publication. Skip rather than
        -- fail: this migration must remain applicable outside a Supabase stack.
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

-- Restated explicitly. DEFAULT is the Postgres default, so these are no-ops
-- today -- and that is the point: they are here so that a future migration
-- setting FULL collides with a line that says, in the file, that it must not.
ALTER TABLE public.facility_public REPLICA IDENTITY DEFAULT;
ALTER TABLE public.ward_public     REPLICA IDENTITY DEFAULT;
ALTER TABLE public.lga_rollup      REPLICA IDENTITY DEFAULT;


-- ============================================================
-- 2. Grant sweep -- re-assert 001 over every object that now exists.
-- ============================================================
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', r);
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', r);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM %I', r);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM %I', r);
        END IF;
    END LOOP;
END $$;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;

-- Re-assert the mirrors' privilege set: EXACTLY {SELECT} for anon and
-- authenticated, nothing for PUBLIC. The projection trigger writes them as a
-- definer function; no client role writes them directly.
--
-- REVOKE ALL then GRANT SELECT, for the reason spelled out in 007 section 5: an
-- enumerated revoke list leaves TRIGGER and REFERENCES behind, because Supabase's
-- default privileges hand a new public table the full set.
REVOKE ALL ON public.facility_public, public.ward_public, public.lga_rollup FROM PUBLIC;

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


-- ============================================================
-- 3. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('013_realtime_publication_and_grant_sweep.sql', now())
ON CONFLICT (filename) DO NOTHING;
