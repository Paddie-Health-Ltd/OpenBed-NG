-- ============================================================
-- 011_read_rpcs_capped.sql
-- ============================================================
-- Sprint 1, Bundle 1. The authenticated read surface: app.assert_member() and
-- two hard-capped RPCs.
--
-- WARD-LEVEL IDENTITY (decision, 2026-09-08). auth.uid() now resolves a WARD
-- ACCOUNT rather than a person. THIS FILE'S BEHAVIOUR IS UNCHANGED, and that is
-- the CTO's claim made checkable: the RLS negative suite must pass with no edits
-- beyond the table rename. If it needed more, the claim was wrong.
--
-- app.assert_member() keeps its signature. Ward-scope enforcement on WRITES -- a
-- WARD_STAFF account may only write its own ward -- needs a p_category argument
-- that no current caller passes, so it is Bundle 3 work. Adding it here would
-- change six call sites and break the very observable the decision asks for.
--
-- Empirical state at base: 001-010 applied. auth.uid() exists (verified:
-- `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='auth'` returns uid, jwt, role).
--
-- EVERY FUNCTION IN THIS FILE FOLLOWS THE SAME THREE RULES, and each of them is
-- individually fatal to omit (decision A3):
--   1. SECURITY DEFINER functions default to EXECUTE for PUBLIC, and PUBLIC
--      INCLUDES anon. Every one is explicitly REVOKEd from PUBLIC and then
--      GRANTed to authenticated. This is the most commonly missed hole in a
--      Supabase project and it bypasses every policy ever written, because a
--      definer function runs as its owner.
--   2. SET search_path = '' with fully-qualified names. Without it a
--      caller-controlled search_path against a definer function is privilege
--      escalation.
--   3. Membership is asserted from auth.uid(), NEVER from an argument.
--
-- THE CAPS ARE STRUCTURAL, NOT VALIDATED.
--   `LIMIT least(coalesce(p_limit, 200), 200)` -- 200 is a ceiling that no
--   argument can raise, not a default that a large argument overrides.
--   30-day window, enforced by clamping p_since forward rather than by rejecting.
--   AND THERE IS NO OFFSET PARAMETER IN EITHER SIGNATURE. Absence is the control:
--   a validated offset is one code change away from being a paging loop, and a
--   paging loop over ward_status_event is the facility-level time series the
--   kickoff forbids. You cannot pass what the function does not accept.
--
-- Idempotency: CREATE OR REPLACE FUNCTION throughout.
--
-- Deployment ordering gate: none. No client calls these yet.
--
-- Function ledger -- 3 functions:
--   app.assert_member(uuid, app.app_role)   SECURITY DEFINER, search_path=''
--   public.my_facility_wards()              SECURITY DEFINER, EXECUTE -> authenticated
--   public.ward_status_history(...)         SECURITY DEFINER, EXECUTE -> authenticated
--   EXECUTE for PUBLIC/anon: NONE. tests/db/rls_rpc_execute_allowlist.test.ts
--   asserts that set is empty against an allowlist that is deliberately empty.
-- ============================================================


-- ============================================================
-- 1. app.assert_member() -- called at the top of every RPC.
-- ============================================================
-- B1 -> B2 SEAM. This is a WORKING membership check, not a placeholder: it reads
-- auth.uid(), resolves the account, and enforces facility scope and role.
-- Bundle 2 EXTENDS it with device binding and shift re-identification; it does
-- not replace it, and the error contract below is fixed from here.
--
-- ERROR CONTRACT (fixed now, relied on by every later bundle):
--   42501  -- role/authorisation violation. Maps to HTTP 403.
--   P0001  -- business-rule violation, with a stable machine-readable code as the
--            first token of the message. Clients map codes; nothing keys off text.
CREATE OR REPLACE FUNCTION app.assert_member(
    p_facility_id uuid,
    p_required    app.app_role
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_uid      uuid;
    v_role     app.app_role;
    v_facility uuid;
    v_active   boolean;
BEGIN
    -- NEVER trust p_facility_id on its own. It is what the caller WANTS to act
    -- on; auth.uid() is who they ARE. The check below is that the two agree.
    v_uid := auth.uid();

    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    SELECT u.role, u.facility_id, u.is_active
      INTO v_role, v_facility, v_active
      FROM app.ward_account u
     WHERE u.id = v_uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = '42501';
    END IF;

    -- Deactivation blocks immediately. A facility admin's deactivate action must
    -- take effect on the next request, not at the next token expiry -- an
    -- orphaned account at a hospital is a security failure and a data-protection
    -- failure at the same time.
    IF NOT v_active THEN
        RAISE EXCEPTION 'ACCOUNT_DEACTIVATED' USING ERRCODE = '42501';
    END IF;

    -- Platform admins are facility-independent.
    IF v_role = 'PLATFORM_ADMIN' THEN
        RETURN v_uid;
    END IF;

    IF p_facility_id IS NOT NULL AND v_facility IS DISTINCT FROM p_facility_id THEN
        RAISE EXCEPTION 'CROSS_FACILITY_DENIED' USING ERRCODE = '42501';
    END IF;

    -- A FACILITY_ADMIN may do anything a WARD_STAFF may do. No other widening.
    IF v_role = p_required
       OR (p_required = 'WARD_STAFF' AND v_role = 'FACILITY_ADMIN') THEN
        RETURN v_uid;
    END IF;

    RAISE EXCEPTION 'INSUFFICIENT_ROLE' USING ERRCODE = '42501';
END;
$FN$;

REVOKE ALL ON FUNCTION app.assert_member(uuid, app.app_role) FROM PUBLIC;


-- ============================================================
-- 2. public.my_facility_wards() -- the ward console's read.
-- ============================================================
-- Returns the caller's own facility's wards, INCLUDING the private reason_code
-- for the latest event. This is the RPC that exists because reason_code was
-- relocated off app.ward_status (finding F1): the console needs it, the public
-- mirror must never carry it, so it is read here under an authorisation check
-- rather than published.
--
-- No arguments. It cannot be pointed at another facility, because there is
-- nothing to point.
CREATE OR REPLACE FUNCTION public.my_facility_wards()
RETURNS TABLE (
    category         app.ward_category,
    offering         app.ward_offering,
    bed_count        integer,
    accepting        boolean,
    state            app.status_state,
    source           app.status_source,
    monitoring_state app.monitoring_state,
    version          integer,
    reason_code      app.zero_reason,
    gated_by         app.gate_reason,
    updated_at       timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_uid      uuid;
    v_facility uuid;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    SELECT u.facility_id INTO v_facility FROM app.ward_account u WHERE u.id = v_uid;
    PERFORM app.assert_member(v_facility, 'WARD_STAFF');

    RETURN QUERY
    SELECT
        ws.category,
        ws.offering,
        ws.bed_count,
        ws.accepting,
        ws.state,
        ws.source,
        ws.monitoring_state,
        ws.version,
        -- The reason attached to the most recent event for this ward.
        (SELECT e.reason_code
           FROM app.ward_status_event e
          WHERE e.ward_status_id = ws.id
          ORDER BY e.id DESC
          LIMIT 1),
        app.gate_for_facility(ws.category, ws.facility_id),
        ws.updated_at
      FROM app.ward_status ws
     WHERE ws.facility_id = v_facility
     ORDER BY ws.category;
END;
$FN$;

-- REVOKE FROM PUBLIC IS NOT ENOUGH HERE. Supabase's default ACL on functions in
-- `public` grants EXECUTE to anon, authenticated and service_role BY NAME, so the
-- function arrives anon-executable and a revoke from PUBLIC leaves that intact.
-- 001 section 4 stops it for functions created after it; these are revoked by
-- name as well, so the guarantee does not depend on which role owns the default.
REVOKE ALL ON FUNCTION public.my_facility_wards() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.my_facility_wards() FROM %I', r);
        END IF;
    END LOOP;
    -- Then grant back to exactly the one role that needs it.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.my_facility_wards() TO authenticated';
    END IF;
END $$;


-- ============================================================
-- 3. public.ward_status_history() -- capped, and capped structurally.
-- ============================================================
-- The single most dangerous function in the system to get wrong, because a
-- table called ward_status_event makes a 7-day occupancy chart the most natural
-- thing in the world to offer -- and that chart is exactly what the kickoff
-- forbids, because facilities that fear being graded stop telling the truth.
--
-- NOTE THE SIGNATURE: no p_offset, no p_facility_id, no p_format. A caller can
-- read at most 200 rows of at most 30 days of THEIR OWN facility's history. They
-- cannot page, so they cannot assemble a series; they cannot name another
-- facility, so they cannot compare.
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

    -- CLAMPED, NOT REJECTED. A caller asking for a year gets 30 days, silently
    -- and correctly. Rejecting would tempt a client author to retry in 30-day
    -- slices, which is the paging loop this cap exists to prevent.
    v_since := greatest(coalesce(p_since, now() - interval '30 days'),
                        now() - interval '30 days');

    RETURN QUERY
    SELECT e.bed_count, e.accepting, e.offering, e.reason_code, e.source, e.created_at
      FROM app.ward_status_event e
     WHERE e.facility_id = v_facility
       AND e.category    = p_category
       AND e.created_at >= v_since
     ORDER BY e.created_at DESC
     -- A ceiling no argument can raise. `least(..., 200)` rather than a default
     -- that a bigger argument overrides.
     LIMIT least(coalesce(p_limit, 200), 200);
END;
$FN$;

-- Same treatment as my_facility_wards() above; see the note there.
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


-- ============================================================
-- 4. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('011_read_rpcs_capped.sql', now())
ON CONFLICT (filename) DO NOTHING;
