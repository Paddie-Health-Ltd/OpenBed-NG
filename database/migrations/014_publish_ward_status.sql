-- ============================================================
-- 014_publish_ward_status.sql
-- ============================================================
-- Stage 1. The write path: public.publish_ward_status() and the idempotency
-- index it relies on. The snapshot (snapshot_current, regenerate_snapshot, the
-- heartbeat's last_snapshot_at) is 015, not this file -- founder ruling
-- 2026-09-14, recorded with its reasons in the dated "Superseded" section of
-- the v2 sprint kickoff, which is where the kickoff's own "014 is one index"
-- is corrected.
--
-- Empirical state at base: 001-013 applied. publish_ward_status,
-- regenerate_snapshot and snapshot_current exist in none of them;
-- client_mutation_id (004) has no index and no unique constraint.
--
-- THE RETURN CONTRACT CARRIES TWO FACTS, NEVER ONE FIELD FOR BOTH (founder
-- ruling (b), 2026-09-14). Finding F1: the ward's CLAIM and what the PUBLIC SEES
-- are different values in this schema -- the gate derives at read time and can
-- only reduce. A nurse who publishes needs both: that her claim was recorded
-- (claim_*), and what the public will actually see (public_*). If the gate
-- reduced her, a single field would tell her she is advertising beds she is not.
-- It also means a granularity floor, if one is ever adopted in the projection
-- writer, changes the VALUE of public_bed_count and nothing else: no signature
-- change, no drop and recreate, no re-grant, no console change.
--
-- HOW THE PUBLIC FIELDS ARE OBTAINED: read back from public.ward_public, in the
-- same transaction, after the UPDATE. Not recomputed.
--   - Not stale. The 008 projection triggers are plain AFTER ... FOR EACH ROW
--     triggers, not deferred, so app.project_facility has rewritten ward_public
--     before this function's next statement runs.
--   - Recomputing would duplicate the projection's COMPOSITION (offering AND
--     accepting AND gate IS NULL) and its VISIBILITY rule (active and not quiet).
--     The gate itself is already single; those two are not, and a floor added to
--     the projection writer would never reach a recomputation.
--   - ABSENCE IS A VALUE. A quiet or inactive facility has NO ward_public row --
--     the projection deletes it. public_listed = false says so. bed_count NULL
--     cannot, because NULL already means "never reported".
--
-- THE CATEGORY, OFFERING AND REASON PARAMETERS ARE text, NOT app ENUMS -- and
-- that is forced, not stylistic. 001's revoke wall gives `authenticated` no
-- USAGE on schema app. PostgREST's RPC query names each parameter's type, so a
-- public function with an app-typed parameter is refused before it runs:
-- observed 2026-09-14 on the golden path, both publish steps returning 42501
-- "permission denied for schema app". Result columns typed app.* are fine --
-- my_facility_wards() returns them over HTTP. So the enums are cast INSIDE this
-- definer function, and an unknown value is refused as INVALID_ARGUMENT naming
-- the parameter. Granting USAGE on app instead would dismantle the revoke wall.
--
-- ORDER OF CHECKS, and why it is this order:
--   1. identity: NOT_AUTHENTICATED / NOT_A_MEMBER / ACCOUNT_DEACTIVATED
--      (app.assert_member), then INSUFFICIENT_ROLE;
--   2. INVALID_ARGUMENT for an unknown category, offering or reason, then
--      WARD_SCOPE_DENIED;
--   3. SESSION_ID_IS_ACCOUNT_ID -- CTO condition (2) of the ward-identity memo,
--      which 005 says belongs to this writer because no CHECK can call auth.uid();
--   4. MISSING_MUTATION_CONTEXT -- without a client_mutation_id and a composed_at
--      neither idempotency nor staleness can be enforced;
--   5. NO_SUCH_WARD, taking the row lock;
--   6. REPLAY -- the same client_mutation_id for this ward returns the current
--      contract and writes nothing. It is checked BEFORE the version and
--      composed_at checks, so a genuine retry is never refused as a conflict or
--      as stale;
--   7. FUTURE_MUTATION, STALE_MUTATION, ZERO_REQUIRES_REASON, VERSION_CONFLICT.
--
-- ONLY WARD_STAFF PUBLISHES HERE. app.assert_member('WARD_STAFF') admits a
-- FACILITY_ADMIN too, and this function refuses one explicitly. Admin publish
-- carries source = 'ADMIN' and a mandatory admin_note (Stage 2); recording an
-- admin's write as source = 'WARD' would tell the public tile a ward confirmed a
-- number no ward confirmed.
--
-- A WARD PUBLISH NEVER CLEARS UNDER_REVIEW (004: an admin challenge bumps
-- version precisely so a nurse write cannot silently clear it). It moves
-- monitoring_state PENDING -> ACTIVE (002: a ward is PENDING until its first
-- successful update) and leaves PAUSED alone.
--
-- AN OVERSIZED AUDIT VALUE IS REJECTED, NEVER TRUNCATED. old_value and new_value
-- are three short fields; 005's CHECK rejects anything over 256 characters of
-- normalised jsonb, and nothing here trims to fit.
--
-- THE INDEX IS NOT A TIME SERIES. It is unique on (ward_status_id,
-- client_mutation_id) and supports equality lookups for replay only -- 012's
-- warning against an index that makes a facility-level history fast is
-- respected. NULL client_mutation_id values stay distinct under a unique index,
-- so the seeded event row with no client_mutation_id is unaffected.
--
-- HOSTED ASYMMETRY, named rather than implied. The three mirrors FORCE ROW LEVEL
-- SECURITY (007). Reading ward_public here needs the function owner to bypass
-- it -- the same privilege the projection's own upsert into ward_public needs,
-- in the same transaction. Locally postgres is a superuser and hosted it is not;
-- if the owner could not bypass RLS hosted, the projection would already fail
-- loudly before this read.
--
-- Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS; CREATE OR REPLACE FUNCTION;
-- grants re-applied by name.
--
-- Deployment ordering gate: after 013. 013 re-asserted every revocation over the
-- objects that existed when it ran, which does not include this function, so
-- this file carries its own by-name REVOKE and GRANT.
--
-- Object ledger:
--   app.ward_status_event_client_mutation_uidx   UNIQUE, partial
--   public.publish_ward_status(...)              SECURITY DEFINER, search_path='',
--                                                EXECUTE -> authenticated only
-- ============================================================


-- ============================================================
-- 1. The idempotency index (finding 2).
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS ward_status_event_client_mutation_uidx
    ON app.ward_status_event (ward_status_id, client_mutation_id)
    WHERE client_mutation_id IS NOT NULL;


-- ============================================================
-- 2. public.publish_ward_status()
-- ============================================================
-- No p_facility_id. The facility is resolved from auth.uid(), exactly as
-- my_facility_wards() does it: there is nothing to point at another facility.
CREATE OR REPLACE FUNCTION public.publish_ward_status(
    p_category           text,
    p_offering           text,
    p_bed_count          integer,
    p_accepting          boolean,
    p_reason             text,
    p_expected_version   integer,
    p_client_mutation_id text,
    p_composed_at        timestamptz
)
RETURNS TABLE (
    version                    integer,
    updated_at                 timestamptz,
    claim_offering             app.ward_offering,
    claim_bed_count            integer,
    claim_accepting            boolean,
    public_listed              boolean,
    public_bed_count           integer,
    public_accepting_effective boolean,
    public_gated_by            app.gate_reason
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid           uuid;
    v_role          app.app_role;
    v_facility      uuid;
    v_ward_category app.ward_category;
    v_category      app.ward_category;
    v_offering      app.ward_offering;
    v_reason        app.zero_reason;
    v_session       uuid;
    v_ws            app.ward_status%ROWTYPE;
    v_new           app.ward_status%ROWTYPE;
BEGIN
    -- 1. Identity.
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    SELECT u.facility_id, u.role, u.ward_category
      INTO v_facility, v_role, v_ward_category
      FROM app.ward_account u
     WHERE u.id = v_uid;

    PERFORM app.assert_member(v_facility, 'WARD_STAFF');

    IF v_role IS DISTINCT FROM 'WARD_STAFF' THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE'
              USING ERRCODE = '42501',
                    DETAIL  = 'publish_ward_status is ward staff only; admin publish is Stage 2';
    END IF;

    -- 2. The enums, cast here because the caller cannot name them (see header).
    BEGIN
        v_category := p_category::app.ward_category;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING ERRCODE = 'P0001', DETAIL = 'p_category';
    END;
    BEGIN
        v_offering := p_offering::app.ward_offering;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING ERRCODE = 'P0001', DETAIL = 'p_offering';
    END;
    BEGIN
        v_reason := p_reason::app.zero_reason;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING ERRCODE = 'P0001', DETAIL = 'p_reason';
    END;
    IF v_category IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING ERRCODE = 'P0001', DETAIL = 'p_category';
    END IF;
    IF v_offering IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING ERRCODE = 'P0001', DETAIL = 'p_offering';
    END IF;

    IF v_ward_category IS DISTINCT FROM v_category THEN
        RAISE EXCEPTION 'WARD_SCOPE_DENIED' USING ERRCODE = '42501';
    END IF;

    -- 3. The audit correlation id is GoTrue's session id, never the account id.
    v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
    IF v_session IS NOT NULL AND v_session = v_uid THEN
        RAISE EXCEPTION 'SESSION_ID_IS_ACCOUNT_ID' USING ERRCODE = '42501';
    END IF;

    -- 4. Without these, idempotency and staleness are unenforceable.
    IF nullif(btrim(p_client_mutation_id), '') IS NULL OR p_composed_at IS NULL THEN
        RAISE EXCEPTION 'MISSING_MUTATION_CONTEXT' USING ERRCODE = 'P0001';
    END IF;

    -- 5. The ward, locked. A concurrent retry of the same mutation waits here and
    --    then finds the event the first one wrote.
    SELECT ws.*
      INTO v_ws
      FROM app.ward_status ws
     WHERE ws.facility_id = v_facility
       AND ws.category    = v_category
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_SUCH_WARD' USING ERRCODE = 'P0001';
    END IF;

    -- 6. Replay: return what is true now, write nothing.
    IF NOT EXISTS (
        SELECT 1
          FROM app.ward_status_event e
         WHERE e.ward_status_id     = v_ws.id
           AND e.client_mutation_id = p_client_mutation_id
    ) THEN
        -- 7. The rules.
        IF p_composed_at > now() + interval '30 seconds' THEN
            RAISE EXCEPTION 'FUTURE_MUTATION' USING ERRCODE = 'P0001';
        END IF;
        IF now() - p_composed_at > interval '2 minutes' THEN
            RAISE EXCEPTION 'STALE_MUTATION' USING ERRCODE = 'P0001';
        END IF;
        IF v_offering = 'OFFERED' AND p_bed_count = 0 AND v_reason IS NULL THEN
            RAISE EXCEPTION 'ZERO_REQUIRES_REASON' USING ERRCODE = 'P0001';
        END IF;

        UPDATE app.ward_status ws
           SET offering         = v_offering,
               bed_count        = p_bed_count,
               accepting        = p_accepting,
               source           = 'WARD',
               monitoring_state = CASE WHEN ws.monitoring_state = 'PENDING'
                                       THEN 'ACTIVE'::app.monitoring_state
                                       ELSE ws.monitoring_state END,
               version          = ws.version + 1
         WHERE ws.id      = v_ws.id
           AND ws.version = p_expected_version
        RETURNING ws.* INTO v_new;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'VERSION_CONFLICT'
                  USING ERRCODE = 'P0001',
                        DETAIL  = format('current_version=%s', v_ws.version);
        END IF;

        INSERT INTO app.ward_status_event
            (ward_status_id, facility_id, category, offering, bed_count, accepting,
             state, source, reason_code, version, client_mutation_id, composed_at)
        VALUES
            (v_new.id, v_new.facility_id, v_new.category, v_new.offering, v_new.bed_count,
             v_new.accepting, v_new.state, v_new.source, v_reason, v_new.version,
             p_client_mutation_id, p_composed_at);

        INSERT INTO app.audit_log
            (facility_id, ward_category, action, old_value, new_value, version, session_id)
        VALUES
            (v_new.facility_id, v_new.category, 'ward_status.publish',
             jsonb_build_object('offering', v_ws.offering, 'bed_count', v_ws.bed_count, 'accepting', v_ws.accepting),
             jsonb_build_object('offering', v_new.offering, 'bed_count', v_new.bed_count, 'accepting', v_new.accepting),
             v_new.version, v_session);
    END IF;

    -- The contract. claim_* from the ward's own row; public_* read back from the
    -- mirror the projection has just written.
    RETURN QUERY
    SELECT ws.version,
           ws.updated_at,
           ws.offering,
           ws.bed_count,
           ws.accepting,
           (wp.facility_id IS NOT NULL),
           wp.bed_count,
           wp.accepting_effective,
           wp.gated_by
      FROM app.ward_status ws
      LEFT JOIN public.ward_public wp
             ON wp.facility_id = ws.facility_id
            AND wp.category    = ws.category
     WHERE ws.id = v_ws.id;
END;
$FN$;

-- Same treatment as 011's RPCs: REVOKE FROM PUBLIC is not enough, because
-- Supabase's default ACL grants EXECUTE on public functions to anon,
-- authenticated and service_role BY NAME.
REVOKE ALL ON FUNCTION public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamptz) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamptz) FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamptz) TO authenticated';
    END IF;
END $$;


-- ============================================================
-- 3. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('014_publish_ward_status.sql', now())
ON CONFLICT (filename) DO NOTHING;
