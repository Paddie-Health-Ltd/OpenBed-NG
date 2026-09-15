-- ============================================================
-- 015_ward_status_history_text_category.sql
-- ============================================================
-- Stage 1. The repair of 011's public.ward_status_history, whose category
-- parameter was typed app.ward_category -- a type no client can name.
--
-- WHY THIS EXISTS. 001's revoke wall gives `authenticated` no USAGE on schema
-- app, and PostgREST's RPC query names each parameter's type. A public function
-- with an app-typed parameter is therefore refused before it runs, with 42501
-- "permission denied for schema app". Found 2026-09-14 while building 014, whose
-- publish steps failed exactly that way on the golden path; 011's function had
-- the same shape and had never been called over HTTP. Founder ruling the same
-- day: fix it now, as 015, in the same pull request as 014. The snapshot, which
-- had been numbered 015, is 016.
--
-- Empirical state at base: 001-014 applied. public.ward_status_history exists
-- with signature (app.ward_category, timestamptz, integer), EXECUTE held by its
-- owner and authenticated only (PUBLIC, anon and service_role revoked by 011).
--
-- INTERNAL CALLERS, CHECKED BEFORE THE DROP. Internal SQL resolves app types
-- fine, so a caller would break silently on a signature change. On 2026-09-14:
-- no function body (pg_proc.prosrc) and no view references ward_status_history,
-- and nothing in the repository calls it except tests, which pass untyped
-- literals that resolve against a text parameter unchanged.
--
-- DROP, THEN CREATE -- NOT CREATE OR REPLACE ALONE. CREATE OR REPLACE cannot
-- change a parameter's type; it would create a second overload beside 011's
-- (observed 2026-09-14: two pg_proc rows). That PostgREST would then refuse the
-- call as ambiguous (PGRST203) was asserted in the founder's ruling and never
-- tested; the drop makes it moot, and it is not a finding. The old signature is
-- dropped by name first. Re-applying 011 recreates the old overload
-- and re-applying this file drops it again, so re-application converges.
--
-- THE REFUSAL COMES FROM THE CAST, AND FROM NOTHING ELSE (condition A). There is
-- no list of categories in this body and no upper, lower or trim: the enum is
-- the single source of truth, and the function accepts exactly what the enum
-- accepts. An unknown value fails the cast (invalid_text_representation) and is
-- refused as INVALID_ARGUMENT naming the parameter. A NULL category keeps 011's
-- behaviour: no rows.
--
-- EVERYTHING ELSE IS 011's, UNCHANGED: the membership check from auth.uid(), the
-- 30-day clamp, the 200-row ceiling no argument can raise, and no offset
-- parameter. The result columns stay app-typed; result types are not the
-- problem, and my_facility_wards() returns app types over HTTP.
--
-- Idempotency: DROP FUNCTION IF EXISTS on the old signature; CREATE OR REPLACE
-- on the new one; grants re-applied by name.
--
-- Deployment ordering gate: after 014. No client calls this function yet.
--
-- Object ledger:
--   public.ward_status_history(app.ward_category, timestamptz, integer)  DROPPED
--   public.ward_status_history(text, timestamptz, integer)               SECURITY DEFINER,
--                                                                        search_path='',
--                                                                        EXECUTE -> authenticated only
-- ============================================================


-- ============================================================
-- 1. The old, uncallable signature.
-- ============================================================
DROP FUNCTION IF EXISTS public.ward_status_history(app.ward_category, timestamptz, integer);


-- ============================================================
-- 2. public.ward_status_history(text, ...)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ward_status_history(
    p_category text,
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
    v_category app.ward_category;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    SELECT u.facility_id INTO v_facility FROM app.ward_account u WHERE u.id = v_uid;
    PERFORM app.assert_member(v_facility, 'WARD_STAFF');

    -- The cast is the whole validation (see header, condition A).
    BEGIN
        v_category := p_category::app.ward_category;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING ERRCODE = 'P0001', DETAIL = 'p_category';
    END;

    -- CLAMPED, NOT REJECTED. A caller asking for a year gets 30 days, silently
    -- and correctly. Rejecting would tempt a client author to retry in 30-day
    -- slices, which is the paging loop this cap exists to prevent.
    v_since := greatest(coalesce(p_since, now() - interval '30 days'),
                        now() - interval '30 days');

    RETURN QUERY
    SELECT e.bed_count, e.accepting, e.offering, e.reason_code, e.source, e.created_at
      FROM app.ward_status_event e
     WHERE e.facility_id = v_facility
       AND e.category    = v_category
       AND e.created_at >= v_since
     ORDER BY e.created_at DESC
     -- A ceiling no argument can raise. `least(..., 200)` rather than a default
     -- that a bigger argument overrides.
     LIMIT least(coalesce(p_limit, 200), 200);
END;
$FN$;

-- 011's treatment: REVOKE FROM PUBLIC is not enough, because Supabase's default
-- ACL grants EXECUTE on public functions to anon, authenticated and service_role
-- BY NAME. Revoke all three by name, then grant back to exactly one.
REVOKE ALL ON FUNCTION public.ward_status_history(text, timestamptz, integer) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.ward_status_history(text, timestamptz, integer) FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.ward_status_history(text, timestamptz, integer) TO authenticated';
    END IF;
END $$;


-- ============================================================
-- 3. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('015_ward_status_history_text_category.sql', now())
ON CONFLICT (filename) DO NOTHING;
