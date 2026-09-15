-- ============================================================
-- 015_ward_status_history_text_category.down.sql
-- ============================================================
-- Symmetric reversal of 015: drop the text signature and restore 011's
-- app-typed function, with 011's grants, exactly as 011 created them.
--
-- REVERSING THIS REINTRODUCES THE DEFECT 015 FIXES. The restored signature takes
-- app.ward_category, which no client can pass through PostgREST (42501,
-- "permission denied for schema app"). That is what a symmetric reversal means;
-- it is stated here so nobody runs it believing the function stays callable.
-- ============================================================

DROP FUNCTION IF EXISTS public.ward_status_history(text, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.ward_status_history(
    p_category app.ward_category,
    p_since    timestamptz DEFAULT NULL,
    p_limit    integer     DEFAULT 50
)
RETURNS TABLE (
    bed_count   integer,
    accepting   boolean,
    offering    app.ward_offering,
    reason_code app.zero_reason,
    source      app.status_source,
    created_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_uid      uuid;
    v_facility uuid;
    v_since    timestamptz;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    SELECT u.facility_id INTO v_facility FROM app.ward_account u WHERE u.id = v_uid;
    PERFORM app.assert_member(v_facility, 'WARD_STAFF');

    v_since := greatest(coalesce(p_since, now() - interval '30 days'),
                        now() - interval '30 days');

    RETURN QUERY
    SELECT e.bed_count, e.accepting, e.offering, e.reason_code, e.source, e.created_at
      FROM app.ward_status_event e
     WHERE e.facility_id = v_facility
       AND e.category    = p_category
       AND e.created_at >= v_since
     ORDER BY e.created_at DESC
     LIMIT least(coalesce(p_limit, 200), 200);
END;
$FN$;

REVOKE ALL ON FUNCTION public.ward_status_history(app.ward_category, timestamptz, integer) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.ward_status_history(app.ward_category, timestamptz, integer) FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.ward_status_history(app.ward_category, timestamptz, integer) TO authenticated';
    END IF;
END $$;

DELETE FROM app.schema_migrations WHERE filename = '015_ward_status_history_text_category.sql';
