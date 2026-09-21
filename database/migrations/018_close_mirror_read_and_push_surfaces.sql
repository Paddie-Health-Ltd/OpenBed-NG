-- ============================================================
-- 018_close_mirror_read_and_push_surfaces.sql
-- ============================================================
-- Sprint A1, Bundle 2. Close the two surfaces an anonymous holder of the
-- published key can still address directly: the READ surface (SELECT on the
-- three public mirrors) and the PUSH surface (Realtime events from them).
--
-- Empirical state at base: 001-017 applied. The three mirrors exist (007), are
-- members of supabase_realtime (013), and carry EXACTLY {SELECT} for anon and
-- authenticated (007 section 5, re-asserted by 013 section 2).
--
-- THE DECISION, AND WHOSE IT IS. R-2026-09-17-09 D put the choice in the
-- founder's hands; it was answered on 2026-09-19: REVOKE (R-2026-09-19-24 B1).
-- This migration was then held behind a second gate -- the EVIDENCE gate of
-- R-2026-09-20-28 B -- because 018 removes the direct read path ON THE PREMISE
-- THAT THE SERVED PATH WORKS, and that premise was not confirmed. The gate
-- lifted on the founder's 2026-09-21 read-back against deployment 76fe917:
-- observations 1-4 all pass on openbed.ng.
--
-- WHAT IS LEFT AFTER THIS.
--   The only public read path is https://openbed.ng/beds.json, served by the
--   Pages Function, which reads public.snapshot_current as service_role. Every
--   other reader of the mirrors is a SECURITY DEFINER function owned by the
--   migrating role -- app.regenerate_snapshot() (016), app.publish_ward_status()
--   (014), app.refresh_lga_rollup() (017) and app.project_facility() (008). None
--   of them reads through anon or authenticated, so none of them is affected.
--   Verified by enumeration before this file was written, not assumed.
--
-- THE RLS POLICIES FROM 007 ARE DELIBERATELY NOT TOUCHED.
--   facility_public_anon_select, ward_public_anon_select and
--   lga_rollup_anon_select become UNREACHABLE once the grant is gone -- a policy
--   only runs for a role that has already passed the privilege check. Unreachable
--   is not wrong, and dropping them here would be a second change wearing this
--   one's clothes: it would also delete the record of what the surface once was,
--   and it would have to be reinstated by hand if this migration is ever
--   reversed. They stay, and this paragraph is why.
--
-- WHAT THIS MIGRATION DOES NOT CLOSE, named so the boundary is not overclaimed:
--   - The `app` schema is not PostgREST-exposed, and that is a HOSTED DASHBOARD
--     setting this repository cannot assert
--     (.claude/rules/test-conventions.md section 4). It is a runbook hand-check.
--   - The mirrors remain readable by service_role and by the migrating role.
--     That is the write path and the generator, not a public surface.
--
-- Idempotency: publication membership is guarded on pg_publication_tables, so a
-- second run finds nothing to drop; REVOKE on an already-revoked privilege is a
-- no-op in Postgres. Re-applying changes neither structure nor rows.
--
-- Deployment ordering gate: after 013, which created the state this reverses
-- part of. 017 is the last applied migration on the hosted project.
--
-- Ledger:
--   supabase_realtime -= public.facility_public, public.ward_public,
--                        public.lga_rollup
--   Total published tables from this repository afterwards: 0.
--   anon          SELECT on all three: REVOKED
--   authenticated SELECT on all three: REVOKED
-- ============================================================


-- ============================================================
-- 1. Remove the three mirrors from the publication -- the PUSH surface.
-- ============================================================
-- The same loop 013's own down file uses, in the same shape and for the same
-- reason: a bare Postgres container has no supabase_realtime publication, and
-- this migration must remain applicable outside a Supabase stack.
DO $$
DECLARE
    t text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE NOTICE 'publication supabase_realtime not present; skipping';
        RETURN;
    END IF;

    FOREACH t IN ARRAY ARRAY['facility_public', 'ward_public', 'lga_rollup'] LOOP
        IF EXISTS (
            SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 2. Revoke SELECT from anon and authenticated -- the READ surface.
-- ============================================================
-- REVOKE SELECT, not REVOKE ALL. The enumerated form is deliberate here and is
-- the opposite of the reasoning in 007 section 5, so read both before changing
-- either:
--
--   007 GRANTS, and a grant must be exhaustive in what it REMOVES first --
--   REVOKE ALL then GRANT SELECT -- because Supabase's default privileges hand a
--   new public table the full set, and an enumerated revoke leaves TRIGGER and
--   REFERENCES behind.
--
--   018 REVOKES, and what it removes is the one privilege 007 and 013 granted.
--   {SELECT} is the whole of what these roles hold on these tables, asserted by
--   tests/db/rls_anon_column_containment.test.ts. Naming it is therefore exact,
--   and it is what makes 018's reversal exact too: the down file restores
--   precisely what this removed and cannot overshoot.
--
-- Per-role guard, matching 013 section 2: anon and authenticated exist on a
-- Supabase stack and may not exist on a bare Postgres.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format(
                'REVOKE SELECT ON public.facility_public, public.ward_public, public.lga_rollup FROM %I',
                r
            );
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 3. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('018_close_mirror_read_and_push_surfaces.sql', now())
ON CONFLICT (filename) DO NOTHING;
