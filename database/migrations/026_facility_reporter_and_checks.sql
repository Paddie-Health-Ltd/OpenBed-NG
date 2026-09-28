-- ============================================================
-- 026_facility_reporter_and_checks.sql
-- ============================================================
-- THE FACILITY-LEVEL LOGIN, ENFORCED; AND THREE SMALL SCHEMA FIXES
-- (R-2026-09-27-144 DT, issued as R-PROVISIONAL-2026-09-27-DT; the reporting model is
-- the founder's, R-2026-09-27-141 DQ-3: one facility-level login where one nurse in
-- charge knows every bed on each shift, otherwise one login per ward, and either way
-- ONE REPORTING SOURCE PER WARD). 025 added the value 'FACILITY_REPORTER' alone,
-- because PostgreSQL refuses to use an enum value in the transaction that added it;
-- everything here that names the value is applied in this file's own transaction.
--
-- Empirical state at base: 001-025 applied locally; hosted at 024
-- (database/migrations/applied-hosted.json). No FACILITY_REPORTER row exists anywhere.
--
-- WHAT IT CHANGES, and nothing else (the letters are DT's):
--   0. Pre-checks, each refusing by name with its count: rows the new scope CHECKs
--      would refuse (SCOPE_CHECK_VIOLATIONS), and contact emails the new form CHECK
--      would refuse (CONTACT_EMAIL_MALFORMED). Hosted holds the operator only.
--   a. ward_account_scope_matches_role and invite_scope_matches_role are dropped and
--      added again with a fourth arm: FACILITY_REPORTER holds a facility and no
--      category. 003 stays frozen; database/migrations/README.md notes it beside 003.
--   b. ward_account_one_active_reporter: at most one ACTIVE reporting login per
--      facility, the shape of ward_account_one_active_per_ward (020).
--   c. ONE REPORTING SOURCE PER WARD, IN THE DATABASE: the trigger
--      trg_ward_account_one_reporting_source refuses REPORTING_MODEL_CONFLICT when an
--      active WARD_STAFF and an active FACILITY_REPORTER would both hold one facility.
--      It fires on INSERT and on UPDATE OF role, facility_id, is_active, so
--      reactivation (022's path) is covered as well as provisioning. It locks the
--      facility row FOR UPDATE first, which serialises concurrent provisioning at one
--      facility; its check is a separate statement, so under READ COMMITTED it reads
--      what a writer it waited for committed. UNDER REPEATABLE READ THAT READ WOULD
--      NOT SEE THE OTHER WRITER, so the trigger refuses to run at that level
--      (REPORTING_MODEL_CHECK_ISOLATION) rather than pass without looking. At
--      SERIALIZABLE, PostgreSQL's own conflict detection aborts one of two such writers.
--      A lock is not an UPDATE: trg_facility_version does not fire.
--   d. app.assert_member: p_required = 'WARD_STAFF' admits FACILITY_REPORTER, as it
--      admits FACILITY_ADMIN. Its three callers, each resolving the facility from
--      auth.uid() and never from an argument: public.my_reporting_wards() (f; reads
--      its own facility's wards), public.ward_status_history() (reads one category's
--      events at its own facility; 015) and public.publish_ward_status() (writes one
--      ward at its own facility, behind its own role check).
--   e. public.publish_ward_status: admits WARD_STAFF (its own category only;
--      WARD_SCOPE_DENIED otherwise, unchanged) and FACILITY_REPORTER (any category at
--      its own facility; NO_SUCH_WARD where the facility has none). FACILITY_ADMIN is
--      still refused INSUFFICIENT_ROLE. The event's source stays 'WARD': the claim is
--      the facility's own nursing staff's, which is what source WARD means publicly.
--      THE ORDER OF CHECKS IS 014's, UNCHANGED:
--        1. identity: NOT_AUTHENTICATED / NOT_A_MEMBER / ACCOUNT_DEACTIVATED
--           (app.assert_member), then INSUFFICIENT_ROLE;
--        2. INVALID_ARGUMENT for an unknown category, offering or reason, then
--           WARD_SCOPE_DENIED (a ward login only);
--        3. SESSION_ID_IS_ACCOUNT_ID;
--        4. MISSING_MUTATION_CONTEXT;
--        5. NO_SUCH_WARD, taking the row lock;
--        6. REPLAY;
--        7. FUTURE_MUTATION, STALE_MUTATION, ZERO_REQUIRES_REASON, VERSION_CONFLICT.
--      014's header line "ONLY WARD_STAFF PUBLISHES HERE" is superseded by this
--      paragraph; 014 is frozen, and the README notes it.
--   f. can_publish, DECIDED BY THE SERVER, on a RENAMED read (R-2026-09-27-145 DU,
--      which amends DT f): public.my_reporting_wards() returns 011's columns, in 011's
--      order, with can_publish boolean last -- WARD_STAFF -> its own category;
--      FACILITY_REPORTER -> true; FACILITY_ADMIN -> false; PLATFORM_ADMIN still reads
--      zero rows -- and public.my_facility_wards() is DROPPED. EXECUTE on the new
--      name follows 011's revoke-by-name and single grant.
--      WHY A NEW NAME, NOT A NEW RETURN TYPE: the rename 021 made for the operator's
--      register (021's header, point 5), for the same reason. 011 is frozen and
--      re-applies over this file in tests/db/migration_idempotency.test.ts, and
--      CREATE OR REPLACE refuses to change an existing function's return type
--      ("cannot change return type of existing function"). DT f prescribed DROP and
--      CREATE of my_facility_wards() itself; DU records that as Cowork's slip. With
--      the rename, a re-apply of 011 recreates my_facility_wards() with its grant,
--      and a re-apply of this file drops it again, so the final state holds only
--      my_reporting_wards() -- asserted after the re-apply by that test.
--      Every dependent moves to the new name in the same change (DU-2); the ward
--      console changes only the name it fetches (DU-3). No SQL object depends on
--      either function.
--   g. app.provision_begin: an explicit branch per role -- WARD_STAFF,
--      FACILITY_REPORTER, PLATFORM_ADMIN -- and an ELSE that refuses
--      ROLE_NOT_PROVISIONED_IN_V1 (FACILITY_ADMIN). 022's ELSE treated EVERY role that
--      was not WARD_STAFF as PLATFORM_ADMIN: a FACILITY_REPORTER passed there would
--      have lost its facility, skipped the gates, and read 'complete' while an
--      operator existed. The reporter branch needs a facility and no category, runs
--      the same invite gate as a ward (NO_FACILITY_CONTACT, AGREEMENT_NOT_RECORDED,
--      AGREEMENT_WITHDRAWN), needs at least one ward (NO_CATEGORY), reads 'complete'
--      when an active reporter exists, and refuses REPORTING_MODEL_CONFLICT before any
--      invite opens. The ward branch gains the same conflict the other way round.
--      app.provision_complete: 024's body with one more constraint named, so a second
--      active reporter is REPORTER_ALREADY_EXISTS and never a raw 23505 (022's rule).
--      Reactivation and 024's LOGIN_ERASED refusal apply to the reporter unchanged.
--   h. audit_log_login_erase_ward_only gains the arm (role FACILITY_REPORTER, no
--      category). WITHOUT IT THE ERASURE FAILS WHOLE: app.erase_lapsed_ward_logins()
--      (024) already selects every role but PLATFORM_ADMIN, so a lapsed reporter's
--      audit insert would be refused and the day's run would roll back, erasing no
--      login at all. app.check_withdrawn_facility_accounts() has no role filter and
--      counts an active reporter as it is.
--   i. public.operator_register(): per ward, has_account and provisioning_incomplete
--      count the facility's reporting login; per facility, reporting_model ('FACILITY',
--      'WARD' or 'NONE') and reporter_login ('active', 'setup incomplete' or 'none');
--      and retention_alert, which resolves R-2026-09-27-137 DM-2 e.
--   j. The contact email's form, in the database (resolves R-2026-09-27-140 DP-2):
--      facility_contact_email_form, and operator_record_contact refuses a non-null
--      email outside it INVALID_ARGUMENT, DETAIL p_email, before the CHECK could raise.
--   k. app.facility.hefamaa_reg_no (the founder's decision, 2026-09-27): optional,
--      operator-only, never public -- app.project_facility is unchanged, and
--      packages/fixtures/forbidden-columns.json names it. Written only by the new
--      public.operator_record_registration().
--
-- GRANTS. public.operator_record_registration(text, integer, text) and
-- public.my_reporting_wards(): EXECUTE to authenticated only, revoked by name from
-- PUBLIC, anon and service_role (a new function arrives with Supabase's default ACL).
-- public.my_facility_wards() is dropped, and its grant with it.
-- app.enforce_one_reporting_source(): owner only. Every replaced function keeps its
-- ACL (CREATE OR REPLACE), and its revoke is re-run where its body changes.
-- packages/fixtures/function-grants.json lists the two new functions.
--
-- NOT DONE HERE, deliberately:
--   - A job that has never run, or that was unscheduled, raises no retention_alert:
--     the alert reads runs that happened. 017 and 024's runbook sections read
--     cron.job itself.
--   - A facility with both kinds of login (a mix of models) stays refused: it is a
--     VERSION row, not v1.
--
-- Idempotency: the pre-checks read only; each CHECK is dropped if it exists and
-- added again; CREATE UNIQUE INDEX IF NOT EXISTS; DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER; ADD COLUMN IF NOT EXISTS; DROP FUNCTION IF EXISTS for
-- my_facility_wards(); CREATE OR REPLACE for every function; the revoke loops are
-- repeatable; the ledger insert is ON CONFLICT DO NOTHING.
-- ============================================================


-- ============================================================
-- 0. The pre-checks. Each refuses by name, with its count, before anything changes.
-- ============================================================
DO $$
DECLARE
    n_acct   integer;
    n_invite integer;
    n_email  integer;
BEGIN
    SELECT count(*) INTO n_acct FROM app.ward_account
     WHERE NOT (   (role = 'WARD_STAFF'        AND facility_id IS NOT NULL AND ward_category IS NOT NULL)
                OR (role = 'FACILITY_ADMIN'    AND facility_id IS NOT NULL AND ward_category IS NULL)
                OR (role = 'PLATFORM_ADMIN'    AND facility_id IS NULL     AND ward_category IS NULL)
                OR (role = 'FACILITY_REPORTER' AND facility_id IS NOT NULL AND ward_category IS NULL));
    SELECT count(*) INTO n_invite FROM app.invite
     WHERE NOT (   (role = 'WARD_STAFF'        AND facility_id IS NOT NULL AND ward_category IS NOT NULL)
                OR (role = 'FACILITY_ADMIN'    AND facility_id IS NOT NULL AND ward_category IS NULL)
                OR (role = 'PLATFORM_ADMIN'    AND facility_id IS NULL     AND ward_category IS NULL)
                OR (role = 'FACILITY_REPORTER' AND facility_id IS NOT NULL AND ward_category IS NULL));
    IF n_acct > 0 OR n_invite > 0 THEN
        RAISE EXCEPTION 'SCOPE_CHECK_VIOLATIONS'
              USING DETAIL = format('%s ward_account row(s) and %s invite row(s) fit no arm of the new scope CHECKs', n_acct, n_invite);
    END IF;

    SELECT count(*) INTO n_email FROM app.facility_contact
     WHERE email IS NOT NULL AND email !~ '^[^@[:space:]]+@[^@[:space:]]+$';
    IF n_email > 0 THEN
        RAISE EXCEPTION 'CONTACT_EMAIL_MALFORMED'
              USING DETAIL = format('%s facility_contact row(s) hold an email the new form CHECK refuses', n_email),
                    HINT = 'correct each through operator_record_contact first';
    END IF;
END $$;


-- ============================================================
-- a. The scope CHECKs, with the reporter's arm. 003 is frozen.
-- ============================================================
ALTER TABLE app.ward_account DROP CONSTRAINT IF EXISTS ward_account_scope_matches_role;
ALTER TABLE app.ward_account ADD CONSTRAINT ward_account_scope_matches_role
    CHECK (
         (role = 'WARD_STAFF'        AND facility_id IS NOT NULL AND ward_category IS NOT NULL)
      OR (role = 'FACILITY_ADMIN'    AND facility_id IS NOT NULL AND ward_category IS NULL)
      OR (role = 'PLATFORM_ADMIN'    AND facility_id IS NULL     AND ward_category IS NULL)
      OR (role = 'FACILITY_REPORTER' AND facility_id IS NOT NULL AND ward_category IS NULL)
    );

ALTER TABLE app.invite DROP CONSTRAINT IF EXISTS invite_scope_matches_role;
ALTER TABLE app.invite ADD CONSTRAINT invite_scope_matches_role
    CHECK (
         (role = 'WARD_STAFF'        AND facility_id IS NOT NULL AND ward_category IS NOT NULL)
      OR (role = 'FACILITY_ADMIN'    AND facility_id IS NOT NULL AND ward_category IS NULL)
      OR (role = 'PLATFORM_ADMIN'    AND facility_id IS NULL     AND ward_category IS NULL)
      OR (role = 'FACILITY_REPORTER' AND facility_id IS NOT NULL AND ward_category IS NULL)
    );


-- ============================================================
-- b. At most one active reporting login per facility.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS ward_account_one_active_reporter
    ON app.ward_account (facility_id)
    WHERE role = 'FACILITY_REPORTER' AND is_active;


-- ============================================================
-- c. One reporting source per ward: the trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION app.enforce_one_reporting_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $FN$
BEGIN
    IF NEW.is_active AND NEW.role IN ('WARD_STAFF', 'FACILITY_REPORTER') THEN
        -- See the header: the check below is only sound where its read sees a
        -- writer this transaction waited for.
        IF current_setting('transaction_isolation') = 'repeatable read' THEN
            RAISE EXCEPTION 'REPORTING_MODEL_CHECK_ISOLATION'
                  USING DETAIL = 'the one-reporting-source check cannot see a concurrent writer under REPEATABLE READ; use READ COMMITTED';
        END IF;
        -- Serialises every activation at this facility.
        PERFORM 1 FROM app.facility f WHERE f.id = NEW.facility_id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM app.ward_account u
                    WHERE u.facility_id = NEW.facility_id
                      AND u.is_active
                      AND u.id <> NEW.id
                      AND u.role IN ('WARD_STAFF', 'FACILITY_REPORTER')
                      AND u.role <> NEW.role) THEN
            RAISE EXCEPTION 'REPORTING_MODEL_CONFLICT'
                  USING DETAIL = format('an active %s login already reports for this facility',
                                        CASE NEW.role WHEN 'WARD_STAFF' THEN 'facility-level' ELSE 'ward' END),
                        HINT = 'one reporting source per ward: deactivate the other kind of login first';
        END IF;
    END IF;
    RETURN NEW;
END;
$FN$;
REVOKE ALL ON FUNCTION app.enforce_one_reporting_source() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_ward_account_one_reporting_source ON app.ward_account;
CREATE TRIGGER trg_ward_account_one_reporting_source
    BEFORE INSERT OR UPDATE OF role, facility_id, is_active ON app.ward_account
    FOR EACH ROW EXECUTE FUNCTION app.enforce_one_reporting_source();


-- ============================================================
-- d. app.assert_member: 011's body, the reporter admitted where WARD_STAFF is required.
-- ============================================================
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

    -- A FACILITY_ADMIN may do anything a WARD_STAFF may do, and so may a
    -- FACILITY_REPORTER (026; R-2026-09-27-144 DT d): every caller that requires
    -- WARD_STAFF reads or writes within the caller's own facility, resolved from
    -- auth.uid(). No other widening.
    IF v_role = p_required
       OR (p_required = 'WARD_STAFF' AND v_role IN ('FACILITY_ADMIN', 'FACILITY_REPORTER')) THEN
        RETURN v_uid;
    END IF;

    RAISE EXCEPTION 'INSUFFICIENT_ROLE' USING ERRCODE = '42501';
END;
$FN$;

REVOKE ALL ON FUNCTION app.assert_member(uuid, app.app_role) FROM PUBLIC;


-- ============================================================
-- e. public.publish_ward_status: 014's body, the reporter admitted (see the header).
-- ============================================================
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
    replayed                   boolean,
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
    v_replayed      boolean := true;
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

    -- 026 (DT e): a ward login, or the facility's reporting login. FACILITY_ADMIN is
    -- still refused: an admin's write is source ADMIN, and Stage 2.
    IF v_role IS DISTINCT FROM 'WARD_STAFF' AND v_role IS DISTINCT FROM 'FACILITY_REPORTER' THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE'
              USING ERRCODE = '42501',
                    DETAIL  = 'publish_ward_status is ward staff or the facility reporter only; admin publish is Stage 2';
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

    -- A ward login publishes its own ward only. The reporter holds no category
    -- (ward_account_scope_matches_role) and publishes any ward at its own facility;
    -- step 5 refuses a category the facility does not have, NO_SUCH_WARD.
    IF v_role = 'WARD_STAFF' AND v_ward_category IS DISTINCT FROM v_category THEN
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
        v_replayed := false;
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
           v_replayed,
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
-- f. public.my_reporting_wards(), with can_publish decided by the server; and
--    public.my_facility_wards() dropped (R-2026-09-27-145 DU-1; 021's rename).
-- ============================================================
DROP FUNCTION IF EXISTS public.my_facility_wards() RESTRICT;
CREATE OR REPLACE FUNCTION public.my_reporting_wards()
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
    updated_at       timestamptz,
    can_publish      boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_uid           uuid;
    v_facility      uuid;
    v_role          app.app_role;
    v_ward_category app.ward_category;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    SELECT u.facility_id, u.role, u.ward_category
      INTO v_facility, v_role, v_ward_category
      FROM app.ward_account u
     WHERE u.id = v_uid;
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
        ws.updated_at,
        -- Whether publish_ward_status would admit THIS login for THIS row, as its
        -- role and scope checks decide it. Nothing on the client guesses.
        CASE v_role
            WHEN 'WARD_STAFF'        THEN ws.category = v_ward_category
            WHEN 'FACILITY_REPORTER' THEN true
            WHEN 'FACILITY_ADMIN'    THEN false
            ELSE false
        END
      FROM app.ward_status ws
     WHERE ws.facility_id = v_facility
     ORDER BY ws.category;
END;
$FN$;

-- 011's treatment: a new function arrives with Supabase's default ACL, so EXECUTE is
-- revoked by name and granted back to exactly the one role that needs it.
REVOKE ALL ON FUNCTION public.my_reporting_wards() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.my_reporting_wards() FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.my_reporting_wards() TO authenticated';
    END IF;
END $$;


-- ============================================================
-- g. app.provision_begin: one branch per role, and no ELSE that means the operator.
-- ============================================================
CREATE OR REPLACE FUNCTION app.provision_begin(
    p_facility uuid,
    p_category text,
    p_role     text
)
RETURNS TABLE (status text, invite_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_role     app.app_role;
    v_category app.ward_category;
    v_invite   uuid;
BEGIN
    BEGIN
        v_role := p_role::app.app_role;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_role';
    END;

    IF v_role = 'WARD_STAFF' THEN
        BEGIN
            v_category := p_category::app.ward_category;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_category';
        END;
        IF p_facility IS NULL OR v_category IS NULL THEN
            RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'a WARD_STAFF invite needs a facility and a category';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.facility f WHERE f.id = p_facility) THEN
            RAISE EXCEPTION 'NO_SUCH_FACILITY';
        END IF;
        -- I: the invite gate (-45; AJ D5), in the database and not the UI.
        IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = p_facility) THEN
            RAISE EXCEPTION 'NO_FACILITY_CONTACT';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = p_facility) THEN
            RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';
        END IF;
        IF EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = p_facility AND a.withdrawn_on IS NOT NULL) THEN
            RAISE EXCEPTION 'AGREEMENT_WITHDRAWN';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.ward_status ws WHERE ws.facility_id = p_facility AND ws.category = v_category) THEN
            RAISE EXCEPTION 'NO_SUCH_WARD';
        END IF;
        -- J4: a ward that already has its account is complete. Nothing is opened,
        -- and the script calls no Auth admin endpoint.
        IF EXISTS (SELECT 1 FROM app.ward_account u
                    WHERE u.facility_id = p_facility AND u.ward_category = v_category
                      AND u.role = 'WARD_STAFF' AND u.is_active) THEN
            RETURN QUERY SELECT 'complete'::text, NULL::uuid;
            RETURN;
        END IF;
        -- 026 (DT c): one reporting source per ward. Refused before an invite opens;
        -- the trigger refuses the same at the account.
        IF EXISTS (SELECT 1 FROM app.ward_account u
                    WHERE u.facility_id = p_facility AND u.role = 'FACILITY_REPORTER' AND u.is_active) THEN
            RAISE EXCEPTION 'REPORTING_MODEL_CONFLICT'
                  USING DETAIL = 'this facility reports through its facility-level login';
        END IF;
    ELSIF v_role = 'FACILITY_REPORTER' THEN
        -- 026 (DT g): one login for the facility. It holds no category (the scope
        -- CHECKs), and it passes the same invite gate as a ward.
        IF nullif(btrim(p_category), '') IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'a FACILITY_REPORTER invite takes no category';
        END IF;
        IF p_facility IS NULL THEN
            RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'a FACILITY_REPORTER invite needs a facility';
        END IF;
        v_category := NULL;
        IF NOT EXISTS (SELECT 1 FROM app.facility f WHERE f.id = p_facility) THEN
            RAISE EXCEPTION 'NO_SUCH_FACILITY';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = p_facility) THEN
            RAISE EXCEPTION 'NO_FACILITY_CONTACT';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = p_facility) THEN
            RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';
        END IF;
        IF EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = p_facility AND a.withdrawn_on IS NOT NULL) THEN
            RAISE EXCEPTION 'AGREEMENT_WITHDRAWN';
        END IF;
        -- A reporter with no ward to report has nothing to publish.
        IF NOT EXISTS (SELECT 1 FROM app.ward_status ws WHERE ws.facility_id = p_facility) THEN
            RAISE EXCEPTION 'NO_CATEGORY';
        END IF;
        -- J4's rule for the reporter: an active one is complete, and nothing opens.
        IF EXISTS (SELECT 1 FROM app.ward_account u
                    WHERE u.facility_id = p_facility AND u.role = 'FACILITY_REPORTER' AND u.is_active) THEN
            RETURN QUERY SELECT 'complete'::text, NULL::uuid;
            RETURN;
        END IF;
        IF EXISTS (SELECT 1 FROM app.ward_account u
                    WHERE u.facility_id = p_facility AND u.role = 'WARD_STAFF' AND u.is_active) THEN
            RAISE EXCEPTION 'REPORTING_MODEL_CONFLICT'
                  USING DETAIL = 'this facility reports through per-ward logins';
        END IF;
    ELSIF v_role = 'PLATFORM_ADMIN' THEN
        -- No facility, no category (003's scope CHECK), no gate.
        p_facility := NULL;
        v_category := NULL;
        -- R-2026-09-24-90 BR-1 b: an active operator is complete. Nothing is opened,
        -- and the script calls no Auth admin endpoint.
        IF EXISTS (SELECT 1 FROM app.ward_account u
                    WHERE u.role = 'PLATFORM_ADMIN' AND u.is_active) THEN
            RETURN QUERY SELECT 'complete'::text, NULL::uuid;
            RETURN;
        END IF;
    ELSE
        -- FACILITY_ADMIN, and any role a later value adds: refused by name, never
        -- provisioned as some other role.
        RAISE EXCEPTION 'ROLE_NOT_PROVISIONED_IN_V1' USING DETAIL = v_role::text;
    END IF;

    INSERT INTO app.invite (facility_id, ward_category, role)
    VALUES (p_facility, v_category, v_role)
    ON CONFLICT (facility_id, ward_category, role) WHERE accepted_at IS NULL DO NOTHING
    RETURNING id INTO v_invite;

    IF v_invite IS NULL THEN
        SELECT i.id INTO v_invite FROM app.invite i
         WHERE i.facility_id IS NOT DISTINCT FROM p_facility
           AND i.ward_category IS NOT DISTINCT FROM v_category
           AND i.role = v_role AND i.accepted_at IS NULL;
    ELSE
        INSERT INTO app.audit_log (facility_id, ward_category, action, new_value)
        VALUES (p_facility, v_category, 'invite.open', jsonb_build_object('role', v_role));
    END IF;

    RETURN QUERY SELECT 'open'::text, v_invite;
END;
$FN$;


-- ============================================================
-- g. app.provision_complete: 024's body, the reporter's index named.
-- ============================================================
CREATE OR REPLACE FUNCTION app.provision_complete(
    p_invite_id uuid,
    p_user_id   uuid
)
RETURNS TABLE (status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_inv  app.invite;
    v_acct app.ward_account;
    v_constraint text;
BEGIN
    SELECT * INTO v_inv FROM app.invite i WHERE i.id = p_invite_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_SUCH_INVITE';
    END IF;

    SELECT * INTO v_acct FROM app.ward_account u WHERE u.id = p_user_id;
    IF FOUND THEN
        -- R-2026-09-26-136 DL-2 b (024): AN ERASED LOGIN NEVER COMES BACK. Its Auth user
        -- was deleted under the retention schedule; an Auth user bearing the same id
        -- again is not that login, and reactivating the row would restore an account
        -- the privacy notice says was deleted. A new login is provisioned instead.
        -- Checked before scope, because no scope makes it valid.
        IF v_acct.login_erased_at IS NOT NULL THEN
            RAISE EXCEPTION 'LOGIN_ERASED'
                  USING DETAIL = 'this login was erased under the retention schedule and cannot be reactivated',
                        HINT = 'provision a new login';
        END IF;
        IF v_acct.facility_id IS DISTINCT FROM v_inv.facility_id
           OR v_acct.ward_category IS DISTINCT FROM v_inv.ward_category
           OR v_acct.role IS DISTINCT FROM v_inv.role THEN
            RAISE EXCEPTION 'ACCOUNT_SCOPE_CONFLICT'
                  USING DETAIL = 'this Auth user already holds an account with another scope';
        END IF;
        -- BR-1 c: the same scope, switched off. Reactivated, and only against an OPEN
        -- invite, which is to say only after begin's gates ran for it.
        IF NOT v_acct.is_active THEN
            IF v_inv.accepted_at IS NOT NULL THEN
                RAISE EXCEPTION 'INVITE_ALREADY_ACCEPTED';
            END IF;
            BEGIN
                UPDATE app.ward_account u SET is_active = true, deactivated_at = NULL
                 WHERE u.id = p_user_id;
            EXCEPTION WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
                IF v_constraint = 'ward_account_one_active_per_ward' THEN
                    -- J3: one active account per ward. Replacing a ward's address means
                    -- deactivating the old account first.
                    RAISE EXCEPTION 'WARD_ALREADY_HAS_AN_ACCOUNT'
                          USING DETAIL = 'deactivate the ward''s current account before provisioning another';
                ELSIF v_constraint = 'ward_account_one_active_operator' THEN
                    -- BR-1 a: one active operator. A second is BD-2 1's trigger: a ruling and a
                    -- migration, never a script run.
                    RAISE EXCEPTION 'OPERATOR_ALREADY_EXISTS'
                          USING DETAIL = 'an active PLATFORM_ADMIN account already exists';
                ELSIF v_constraint = 'ward_account_one_active_reporter' THEN
                    -- 026 (DT b): one active reporting login per facility.
                    RAISE EXCEPTION 'REPORTER_ALREADY_EXISTS'
                          USING DETAIL = 'deactivate the facility''s current reporting login before provisioning another';
                END IF;
                RAISE;
            END;
            UPDATE app.invite i SET accepted_at = now() WHERE i.id = p_invite_id;
            INSERT INTO app.audit_log (facility_id, ward_category, action, new_value)
            VALUES (v_inv.facility_id, v_inv.ward_category, 'ward_account.reactivate',
                    jsonb_build_object('role', v_inv.role));
            RETURN QUERY SELECT 'reactivated'::text;
            RETURN;
        END IF;
        -- The same account for the same scope: a repeat, not a second write.
        IF v_inv.accepted_at IS NULL THEN
            UPDATE app.invite i SET accepted_at = now() WHERE i.id = p_invite_id;
        END IF;
        RETURN QUERY SELECT 'complete'::text;
        RETURN;
    END IF;

    IF v_inv.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITE_ALREADY_ACCEPTED';
    END IF;

    BEGIN
        INSERT INTO app.ward_account (id, facility_id, ward_category, role)
        VALUES (p_user_id, v_inv.facility_id, v_inv.ward_category, v_inv.role);
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'ward_account_one_active_per_ward' THEN
            -- J3: one active account per ward. Replacing a ward's address means
            -- deactivating the old account first.
            RAISE EXCEPTION 'WARD_ALREADY_HAS_AN_ACCOUNT'
                  USING DETAIL = 'deactivate the ward''s current account before provisioning another';
        ELSIF v_constraint = 'ward_account_one_active_operator' THEN
            -- BR-1 a: one active operator. A second is BD-2 1's trigger: a ruling and a
            -- migration, never a script run.
            RAISE EXCEPTION 'OPERATOR_ALREADY_EXISTS'
                  USING DETAIL = 'an active PLATFORM_ADMIN account already exists';
        ELSIF v_constraint = 'ward_account_one_active_reporter' THEN
            -- 026 (DT b): one active reporting login per facility.
            RAISE EXCEPTION 'REPORTER_ALREADY_EXISTS'
                  USING DETAIL = 'deactivate the facility''s current reporting login before provisioning another';
        END IF;
        RAISE;
    END;

    UPDATE app.invite i SET accepted_at = now() WHERE i.id = p_invite_id;

    INSERT INTO app.audit_log (facility_id, ward_category, action, new_value)
    VALUES (v_inv.facility_id, v_inv.ward_category, 'ward_account.provision',
            jsonb_build_object('role', v_inv.role));

    RETURN QUERY SELECT 'complete'::text;
END;
$FN$;

-- Owner only, as 020 left them. A replaced function keeps its ACL; this is re-run
-- so the fact is stated where the bodies change.
DO $$
DECLARE
    f text;
    r text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'app.enforce_one_reporting_source()',
        'app.provision_begin(uuid, text, text)',
        'app.provision_complete(uuid, uuid)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
            END IF;
        END LOOP;
    END LOOP;
END $$;


-- ============================================================
-- h. The erasure audit row: the reporter's arm.
-- ============================================================
ALTER TABLE app.audit_log DROP CONSTRAINT IF EXISTS audit_log_login_erase_ward_only;
ALTER TABLE app.audit_log ADD CONSTRAINT audit_log_login_erase_ward_only
    CHECK (
        action IS DISTINCT FROM 'ward_account.login_erase'
        OR (
            facility_id IS NOT NULL
            AND old_value IS NULL
            AND version IS NULL
            AND session_id IS NULL
            AND CASE
                    WHEN jsonb_typeof(new_value) = 'object' THEN
                        (new_value - 'role') = '{}'::jsonb
                        AND (   (new_value ->> 'role' = 'WARD_STAFF'        AND ward_category IS NOT NULL)
                             OR (new_value ->> 'role' = 'FACILITY_ADMIN'    AND ward_category IS NULL)
                             OR (new_value ->> 'role' = 'FACILITY_REPORTER' AND ward_category IS NULL))
                    ELSE false
                END
        )
    );


-- ============================================================
-- j. The contact email's form.
-- ============================================================
ALTER TABLE app.facility_contact DROP CONSTRAINT IF EXISTS facility_contact_email_form;
ALTER TABLE app.facility_contact ADD CONSTRAINT facility_contact_email_form
    CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+$');

CREATE OR REPLACE FUNCTION public.operator_record_contact(
    p_facility_id      text,
    p_full_name        text,
    p_job_title        text,
    p_email            text,
    p_mobile_e164      text,
    p_sms_opt_in       boolean,
    p_expected_version integer
)
RETURNS TABLE (facility_id uuid, contact_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid     uuid := app.assert_operator();
    v_session uuid := app.operator_session(v_uid);
    v_id      uuid;
    v_email   text := nullif(btrim(p_email), '');
    v_mobile  text := nullif(btrim(p_mobile_e164), '');
    v_name    text := nullif(btrim(p_full_name), '');
    v_title   text := nullif(btrim(p_job_title), '');
    v_sms     boolean := coalesce(p_sms_opt_in, false);
    v_old     app.facility_contact;
    v_fields  text[] := ARRAY[]::text[];
    v_version integer;
BEGIN
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;
    IF NOT EXISTS (SELECT 1 FROM app.facility f WHERE f.id = v_id) THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_full_name';
    END IF;
    IF v_title IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_job_title';
    END IF;

    -- 003's CHECKs, refused by name before they could raise their own.
    IF v_email IS NULL AND v_mobile IS NULL THEN
        RAISE EXCEPTION 'NO_CONTACT_CHANNEL';
    END IF;
    -- 026 (R-2026-09-27-140 DP-2; DT j): the form, as facility_contact_email_form
    -- checks it -- one @, no whitespace, a non-empty part on each side.
    IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_email';
    END IF;
    IF v_mobile IS NOT NULL AND v_mobile !~ '^\+[1-9][0-9]{7,14}$' THEN
        RAISE EXCEPTION 'MOBILE_NOT_E164';
    END IF;
    IF v_mobile IS NOT NULL AND NOT v_sms THEN
        RAISE EXCEPTION 'MOBILE_REQUIRES_SMS_OPT_IN';
    END IF;

    SELECT * INTO v_old FROM app.facility_contact c WHERE c.facility_id = v_id FOR UPDATE;

    IF NOT FOUND THEN
        IF p_expected_version IS NOT NULL THEN
            RAISE EXCEPTION 'VERSION_CONFLICT' USING DETAIL = 'current_version=none';
        END IF;
        INSERT INTO app.facility_contact (facility_id, full_name, job_title, email, mobile_e164, sms_opt_in_at)
        VALUES (v_id, v_name, v_title, v_email, v_mobile, CASE WHEN v_sms THEN now() END)
        ON CONFLICT ON CONSTRAINT facility_contact_one_per_facility DO NOTHING;
        IF FOUND THEN
            v_fields := ARRAY['full_name', 'job_title']
                || CASE WHEN v_email IS NOT NULL THEN ARRAY['email'] ELSE ARRAY[]::text[] END
                || CASE WHEN v_mobile IS NOT NULL THEN ARRAY['mobile_e164'] ELSE ARRAY[]::text[] END
                || CASE WHEN v_sms THEN ARRAY['sms_opt_in'] ELSE ARRAY[]::text[] END;
            INSERT INTO app.audit_log (facility_id, action, new_value, version, session_id)
            VALUES (v_id, 'facility_contact.record',
                    jsonb_build_object('fields', to_jsonb(v_fields), 'version', 1), 1, v_session);
            RETURN QUERY SELECT v_id, 1;
            RETURN;
        END IF;
        -- A concurrent first write landed between the read and the insert: fall
        -- through and treat this call as a repeat or an edit of that row.
        SELECT * INTO v_old FROM app.facility_contact c WHERE c.facility_id = v_id FOR UPDATE;
    END IF;

    -- J2: an identical repeat is an answer, not a write -- checked BEFORE the version,
    -- so a double submit whose first write landed is not a conflict.
    IF v_old.full_name = v_name AND v_old.job_title = v_title
       AND v_old.email IS NOT DISTINCT FROM v_email
       AND v_old.mobile_e164 IS NOT DISTINCT FROM v_mobile
       AND (v_old.sms_opt_in_at IS NOT NULL) = v_sms THEN
        RETURN QUERY SELECT v_id, v_old.version;
        RETURN;
    END IF;

    IF p_expected_version IS DISTINCT FROM v_old.version THEN
        RAISE EXCEPTION 'VERSION_CONFLICT' USING DETAIL = format('current_version=%s', v_old.version);
    END IF;

    IF v_old.full_name IS DISTINCT FROM v_name THEN v_fields := array_append(v_fields, 'full_name'); END IF;
    IF v_old.job_title IS DISTINCT FROM v_title THEN v_fields := array_append(v_fields, 'job_title'); END IF;
    IF v_old.email IS DISTINCT FROM v_email THEN v_fields := array_append(v_fields, 'email'); END IF;
    IF v_old.mobile_e164 IS DISTINCT FROM v_mobile THEN v_fields := array_append(v_fields, 'mobile_e164'); END IF;
    IF (v_old.sms_opt_in_at IS NOT NULL) IS DISTINCT FROM v_sms THEN v_fields := array_append(v_fields, 'sms_opt_in'); END IF;

    UPDATE app.facility_contact c
       SET full_name     = v_name,
           job_title     = v_title,
           email         = v_email,
           mobile_e164   = v_mobile,
           -- Opt-in keeps its first moment across edits; opting out clears it.
           sms_opt_in_at = CASE WHEN v_sms THEN coalesce(v_old.sms_opt_in_at, now()) END,
           -- BD-2 3: a new address has no bounce history.
           unreachable_since = CASE
               WHEN v_old.email IS DISTINCT FROM v_email OR v_old.mobile_e164 IS DISTINCT FROM v_mobile THEN NULL
               ELSE v_old.unreachable_since END
     WHERE c.facility_id = v_id
    RETURNING c.version INTO v_version;

    INSERT INTO app.audit_log (facility_id, action, old_value, new_value, version, session_id)
    VALUES (v_id, 'facility_contact.record',
            jsonb_build_object('version', v_old.version),
            jsonb_build_object('fields', to_jsonb(v_fields), 'version', v_version),
            v_version, v_session);

    RETURN QUERY SELECT v_id, v_version;
END;
$FN$;

DO $$
DECLARE r text;
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.operator_record_contact(text, text, text, text, text, boolean, integer) FROM PUBLIC';
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.operator_record_contact(text, text, text, text, text, boolean, integer) FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.operator_record_contact(text, text, text, text, text, boolean, integer) TO authenticated';
    END IF;
END $$;


-- ============================================================
-- k. The HEFAMAA registration number: the column, and its one writer.
-- ============================================================
ALTER TABLE app.facility ADD COLUMN IF NOT EXISTS hefamaa_reg_no text;

-- Trimmed, 1-64 characters. A regex rather than btrim(), which strips spaces only.
ALTER TABLE app.facility DROP CONSTRAINT IF EXISTS facility_hefamaa_reg_no_form;
ALTER TABLE app.facility ADD CONSTRAINT facility_hefamaa_reg_no_form
    CHECK (hefamaa_reg_no IS NULL
           OR (char_length(hefamaa_reg_no) BETWEEN 1 AND 64
               AND hefamaa_reg_no ~ '^[^[:space:]](.*[^[:space:]])?$'));

COMMENT ON COLUMN app.facility.hefamaa_reg_no IS
    'The facility''s HEFAMAA registration number, as on its certificate (the founder''s '
    'decision, 2026-09-27). Optional, and not a listing gate in v1: federal institutions '
    'may carry none. Operator-only and NEVER PUBLIC: app.project_facility does not copy '
    'it, and packages/fixtures/forbidden-columns.json names it. Written only by '
    'public.operator_record_registration() (026).';

-- A new RPC rather than a change to operator_edit_facility's signature, so the
-- deployed admin keeps working until it is redeployed (DT k).
--
-- THE FUNCTION ACCEPTS EXACTLY WHAT THE COLUMN ACCEPTS, plus NULL to clear it: no
-- trimming, the rule 014 keeps for its enums. A blank or space-padded value is
-- refused INVALID_ARGUMENT by name, before the CHECK could raise 23514; the page
-- decides what an empty field sends.
CREATE OR REPLACE FUNCTION public.operator_record_registration(
    p_facility_id      text,
    p_expected_version integer,
    p_hefamaa_reg_no   text
)
RETURNS TABLE (facility_id uuid, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid     uuid := app.assert_operator();
    v_session uuid := app.operator_session(v_uid);
    v_id      uuid;
    v_old     app.facility;
    v_version integer;
BEGIN
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;
    IF p_hefamaa_reg_no IS NOT NULL
       AND NOT (char_length(p_hefamaa_reg_no) BETWEEN 1 AND 64
                AND p_hefamaa_reg_no ~ '^[^[:space:]](.*[^[:space:]])?$') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_hefamaa_reg_no';
    END IF;

    SELECT * INTO v_old FROM app.facility f WHERE f.id = v_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;

    -- J2: an identical repeat is an answer, not a write -- checked BEFORE the
    -- version, so a double submit whose first write landed is not a conflict.
    IF v_old.hefamaa_reg_no IS NOT DISTINCT FROM p_hefamaa_reg_no THEN
        RETURN QUERY SELECT v_id, v_old.version;
        RETURN;
    END IF;

    -- J1: the integer version, compared exactly.
    IF v_old.version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'VERSION_CONFLICT' USING DETAIL = format('current_version=%s', v_old.version);
    END IF;

    UPDATE app.facility f
       SET hefamaa_reg_no = p_hefamaa_reg_no
     WHERE f.id = v_id
    RETURNING f.version INTO v_version;

    -- The number is a facility's, not a person's, and the only value this row
    -- carries (DT k).
    INSERT INTO app.audit_log (facility_id, action, old_value, new_value, version, session_id)
    VALUES (v_id, 'facility.registration',
            jsonb_build_object('hefamaa_reg_no', v_old.hefamaa_reg_no),
            jsonb_build_object('hefamaa_reg_no', p_hefamaa_reg_no),
            v_version, v_session);

    RETURN QUERY SELECT v_id, v_version;
END;
$FN$;

REVOKE ALL ON FUNCTION public.operator_record_registration(text, integer, text) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.operator_record_registration(text, integer, text) FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.operator_record_registration(text, integer, text) TO authenticated';
    END IF;
END $$;


-- ============================================================
-- i. public.operator_register(): 023's body, with the reporting model, the HEFAMAA
--    number and the retention alert.
-- ============================================================
CREATE OR REPLACE FUNCTION public.operator_register()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_uid uuid := app.assert_operator();
BEGIN
    -- EVERY facility and EVERY category (AJ D8). Freshness never filters, sorts out
    -- or hides a row here; the operator is shown the stale ones. The bands are the
    -- page's, from freshnessBand(), computed against server_now and never the
    -- operator's device clock. No address or name of a person is returned: the
    -- contact is a yes/no, and "provisioning incomplete" comes from app.invite,
    -- never auth.users (-71 C). server_now is built outside the aggregate, so an
    -- empty register still carries the clock.
    RETURN jsonb_build_object(
        'server_now', now(),
        -- 026 (DT i; resolves R-2026-09-27-137 DM-2 e): each of the three retention
        -- jobs whose most recent FINISHED run did not succeed, with that run's end.
        -- Empty when all are well. The pass signal is status 'succeeded'; a run still
        -- in progress is not an alert, and a job that has never run raises nothing.
        'retention_alert', coalesce((
            SELECT jsonb_agg(jsonb_build_object('job', j.jobname, 'end_time', d.end_time)
                             ORDER BY j.jobname)
              FROM cron.job j
             CROSS JOIN LATERAL (
                   SELECT r.status, r.end_time
                     FROM cron.job_run_details r
                    WHERE r.jobid = j.jobid AND r.end_time IS NOT NULL
                    ORDER BY r.runid DESC
                    LIMIT 1) d
             WHERE j.jobname IN ('openbed_erase_lapsed_ward_logins',
                                 'openbed_prune_ended_auth_sessions',
                                 'openbed_check_withdrawn_facility_accounts')
               AND d.status IS DISTINCT FROM 'succeeded'
        ), '[]'::jsonb),
        'facilities', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'facility_id', f.id,
                       'name', f.name,
                       'lga', f.lga,
                       'state', f.state,
                       'lat', f.lat,
                       'lng', f.lng,
                       'public_phone_e164', f.public_phone_e164,
                       -- 026 (DT k): operator-only, never public.
                       'hefamaa_reg_no', f.hefamaa_reg_no,
                       'version', f.version,
                       'listed_at', f.listed_at,
                       'quiet_mode', f.quiet_mode,
                       'is_active', f.is_active,
                       'has_contact', EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = f.id),
                       -- Three states, never a yes/no (R-2026-09-24-81 BI-1). A yes/no read a
                       -- withdrawn agreement as "none", so the operator recorded one and met
                       -- AGREEMENT_ALREADY_RECORDED, a dead end that hid the withdrawal.
                       -- "withdrawn" is withdrawn_on IS NOT NULL, the test both gates refuse
                       -- AGREEMENT_WITHDRAWN on. One row per facility (the primary key).
                       'agreement_state', coalesce((SELECT CASE WHEN a.withdrawn_on IS NULL THEN 'recorded'
                                                                ELSE 'withdrawn' END
                                                      FROM app.facility_agreement a
                                                     WHERE a.facility_id = f.id), 'none'),
                       -- 026 (DT i): which reporting model the ACTIVE logins make. 026's trigger keeps
                       -- the two kinds from being active at one facility together.
                       'reporting_model', CASE
                           WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                         WHERE u.facility_id = f.id AND u.role = 'FACILITY_REPORTER' AND u.is_active) THEN 'FACILITY'
                           WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                         WHERE u.facility_id = f.id AND u.role = 'WARD_STAFF' AND u.is_active) THEN 'WARD'
                           ELSE 'NONE' END,
                       'reporter_login', CASE
                           WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                         WHERE u.facility_id = f.id AND u.role = 'FACILITY_REPORTER' AND u.is_active) THEN 'active'
                           WHEN EXISTS (SELECT 1 FROM app.invite i
                                         WHERE i.facility_id = f.id AND i.role = 'FACILITY_REPORTER' AND i.accepted_at IS NULL) THEN 'setup incomplete'
                           ELSE 'none' END,
                       'categories', coalesce((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'category', ws.category,
                                      'offering', ws.offering,
                                      'monitoring_state', ws.monitoring_state,
                                      'bed_count', ws.bed_count,
                                      'accepting', ws.accepting,
                                      'updated_at', ws.updated_at,
                                      -- 026 (DT i): a ward has its account when its own ward
                                      -- login is active, OR the facility's reporting login is.
                                      'has_account', EXISTS (
                                          SELECT 1 FROM app.ward_account u
                                           WHERE u.facility_id = f.id AND u.is_active
                                             AND (   (u.role = 'WARD_STAFF' AND u.ward_category = ws.category)
                                                  OR u.role = 'FACILITY_REPORTER')),
                                      'provisioning_incomplete',
                                          EXISTS (SELECT 1 FROM app.invite i
                                                   WHERE i.facility_id = f.id AND i.accepted_at IS NULL
                                                     AND (   (i.role = 'WARD_STAFF' AND i.ward_category = ws.category)
                                                          OR i.role = 'FACILITY_REPORTER'))
                                          AND NOT EXISTS (SELECT 1 FROM app.ward_account u
                                                   WHERE u.facility_id = f.id AND u.is_active
                                                     AND (   (u.role = 'WARD_STAFF' AND u.ward_category = ws.category)
                                                          OR u.role = 'FACILITY_REPORTER'))
                                  ) ORDER BY ws.category)
                             FROM app.ward_status ws WHERE ws.facility_id = f.id
                       ), '[]'::jsonb)
                   ) ORDER BY f.name, f.id)
              FROM app.facility f
        ), '[]'::jsonb));
END;
$FN$;

DO $$
DECLARE
    r text;
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.operator_register() FROM PUBLIC';
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.operator_register() FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.operator_register() TO authenticated';
    END IF;
END $$;


-- ============================================================
-- Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('026_facility_reporter_and_checks.sql', now())
ON CONFLICT (filename) DO NOTHING;
