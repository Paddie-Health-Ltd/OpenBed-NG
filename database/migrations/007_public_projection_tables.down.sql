-- ============================================================
-- 007_public_projection_tables.down.sql
-- ============================================================
-- Symmetric reversal of 007: policies dropped in reverse creation order, then
-- grants revoked, then the tables.
--
-- 013 adds these tables to the supabase_realtime publication; dropping a
-- published table removes it from the publication automatically, so there is no
-- separate step here. 013's own down migration handles the ordinary case.
-- ============================================================

DROP POLICY IF EXISTS lga_rollup_anon_select      ON public.lga_rollup;
DROP POLICY IF EXISTS ward_public_anon_select     ON public.ward_public;
DROP POLICY IF EXISTS facility_public_anon_select ON public.facility_public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON public.facility_public, public.ward_public, public.lga_rollup FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON public.facility_public, public.ward_public, public.lga_rollup FROM authenticated';
    END IF;
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;

DROP TABLE IF EXISTS public.lga_rollup;
DROP TABLE IF EXISTS public.ward_public;
DROP TABLE IF EXISTS public.facility_public;

DELETE FROM app.schema_migrations WHERE filename = '007_public_projection_tables.sql';
