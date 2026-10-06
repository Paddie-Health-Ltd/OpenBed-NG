-- ============================================================
-- 029_facility_reporting_approval.sql
-- ============================================================
-- THE APPROVED REPORTING MODEL, RECORDED, KEPT AS HISTORY, AND RECONCILED AGAINST THE
-- LOGINS (R-2026-09-30-201 GA, issued as R-PROVISIONAL-2026-10-06-GA; ruling FX P2, adopted
-- by the founder on 2026-10-06; the design report is
-- docs/approved-reporting-model-design-report-2026-10-06.md, merged in #121, and the
-- founder's six decisions on it are ruling FZ). What a facility's management approved in
-- Part A of the Schedule 1 it signed -- one sign-in for the whole facility, or one for each
-- ward -- was stored nowhere: the reporting model was only DERIVED from the active logins.
-- This records the approval, keeps every approval, and compares the logins against the
-- latest one.
--
-- Empirical state at base: 001-028 applied locally; hosted at 028
-- (database/migrations/applied-hosted.json, recorded 2026-09-30). app.facility_agreement
-- holds one row per facility, the acceptance record, and no function overwrites it, so a
-- changed approval cannot live on it. 026 holds the latest definition of app.provision_begin
-- and of public.operator_register at base (027 and 028 touch neither), and those are the two
-- bodies this file restates.
--
-- WHAT IT CHANGES, and nothing else:
--   a. The enum app.reporting_model ('FACILITY', 'WARD'), created inside a DO block
--      guarded on pg_type, as 002's types are.
--   b. The table app.facility_reporting_approval: an identity id, the facility, the model,
--      the date approved, the agreement version (copied from the acceptance row, never a
--      parameter), a job title at most (never a name), and the recording time and session.
--      One row per approval, and the row with the highest id for a facility is the one in
--      force. Row level security enabled and forced, no policy, no client grant. Its CHECK
--      constraints are named reporting_approval_..., not facility_...: the admin app's label
--      test (tests/compliance/admin_render.test.ts) demands a sentence for every CHECK
--      whose name starts facility_, and this table's refusals are named by the
--      function instead.
--   c. APPEND-ONLY, by the pattern of 010, which is not edited: UPDATE, DELETE and
--      TRUNCATE revoked from the client roles, a row-level BEFORE UPDATE OR DELETE trigger,
--      and, beyond 010, a statement-level BEFORE TRUNCATE trigger, so the table's owner is
--      stopped too (the founder's decision 5). Both call app.raise_append_only() and are
--      ENABLE ALWAYS. A wrong entry is corrected by recording the right one.
--   d. public.operator_record_reporting_approval(text, text, date, text): the operator's
--      write, on the pattern of public.operator_record_agreement. It refuses an approval
--      dated before the acceptance date (APPROVAL_BEFORE_AGREEMENT) or after today by the
--      Lagos calendar (APPROVAL_DATE_IN_FUTURE), a facility with no agreement, and a
--      withdrawn one. An identical repeat of the latest approval appends nothing and
--      returns recorded = false; anything else appends. One audit_log row per append,
--      action reporting_approval.record, naming the model and never the title.
--   e. app.provision_begin: 026's body, with one gate added to each reporting branch,
--      after the "already active" exit and before REPORTING_MODEL_CONFLICT (the founder's
--      decision 2). A reporting login that contradicts the latest approval, or any
--      reporting login at a facility with no approval, is refused REPORTING_MODEL_NOT_APPROVED
--      with a DETAIL that says which. Signature, return shape and owner-only grants unchanged.
--   f. public.operator_register(): 026's body, with three keys added to each facility
--      (approved_model, approved_on, reporting_approval_state) and the derived model
--      computed once, in a lateral join, for both reporting_model and the state beside it.
--      reporting_model keeps its value. The state is one of four strings, or JSON null when
--      the facility has neither an approval nor a login (the founder's decision 3).
--
-- RETENTION. Permanent, with the acceptance record (the founder's decision 1). The table
-- holds a date, a version label, a closed two-value model and a job title, and no personal
-- data, so no erasure path exists or is needed. Its facility key is ON DELETE RESTRICT, and
-- no job or function deletes a row.
--
-- NOT DONE HERE, deliberately: no row is inserted and nothing is backfilled. Deriving
-- facility one's approval from its active logins would record the very thing the approval
-- exists to check them against; the operator enters it from the signed Schedule 1. 010 is
-- not edited, and nothing here changes what the owner can do to app.audit_log or
-- app.ward_status_event. FACILITY_ADMIN is unchanged. No hosted step is taken: the hosted
-- apply is a founder step, by the runbook's section 5.
--
-- Idempotency: the enum is created inside a DO block guarded on pg_type; CREATE TABLE and
-- CREATE INDEX use IF NOT EXISTS; each trigger is created inside a DO block guarded on
-- pg_trigger and ENABLE ALWAYS is unconditional; CREATE OR REPLACE for every function;
-- the revoke loops are repeatable and re-run the grant; the ledger insert is ON CONFLICT
-- DO NOTHING. It inserts no row, so the digest is unchanged by a second application.
-- ============================================================


-- ============================================================
-- a. The enum.
-- ============================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'reporting_model' AND n.nspname = 'app') THEN
        CREATE TYPE app.reporting_model AS ENUM ('FACILITY', 'WARD');
    END IF;
END $$;


-- ============================================================
-- b. The table.
-- ============================================================
CREATE TABLE IF NOT EXISTS app.facility_reporting_approval (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facility_id       uuid NOT NULL REFERENCES app.facility(id) ON DELETE RESTRICT,
    model             app.reporting_model NOT NULL,
    approved_on       date NOT NULL,
    -- Copied from app.facility_agreement.version by the function, so it cannot be mistyped
    -- and cannot name a version the facility did not accept.
    agreement_version text NOT NULL,
    -- A job title such as "CMD" or "Matron". Never a name: the row holds no personal data.
    approved_by_role  text,
    recorded_at       timestamptz NOT NULL DEFAULT now(),
    -- The operator session that recorded it, from the JWT as in 014 and 020. NULL only for
    -- a row written by founder SQL, which has no session: an honest absence.
    recorded_session  uuid,

    CONSTRAINT reporting_approval_version_is_a_label
        CHECK (agreement_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    CONSTRAINT reporting_approval_role_is_short
        CHECK (approved_by_role IS NULL OR length(approved_by_role) BETWEEN 1 AND 64)
);

COMMENT ON TABLE app.facility_reporting_approval IS
    'The reporting model a facility''s management approved in Schedule 1, one row per '
    'approval, append-only; the row with the highest id for a facility is in force. Kept '
    'off app.facility_agreement, which is the acceptance record and is never overwritten '
    '(029, ruling FX P2). Holds no personal data: a job title at most, never a name. '
    'Retained permanently, with the acceptance record.';

-- The latest approval for a facility is read on every register load and every gate.
CREATE INDEX IF NOT EXISTS reporting_approval_latest
    ON app.facility_reporting_approval (facility_id, id DESC);

ALTER TABLE app.facility_reporting_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.facility_reporting_approval FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.facility_reporting_approval FROM PUBLIC;
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON app.facility_reporting_approval FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- c. Append-only, by 010's pattern, and the owner's TRUNCATE too.
-- ============================================================
-- 010's revoke, stated again where the table is created: no client role may update,
-- delete or truncate. The triggers below stop the owner, whom a revoke does not.
REVOKE UPDATE, DELETE, TRUNCATE ON app.facility_reporting_approval FROM PUBLIC;
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON app.facility_reporting_approval FROM %I', r);
        END IF;
    END LOOP;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_facility_reporting_approval_append_only') THEN
        EXECUTE 'CREATE TRIGGER trg_facility_reporting_approval_append_only
                     BEFORE UPDATE OR DELETE ON app.facility_reporting_approval
                     FOR EACH ROW EXECUTE FUNCTION app.raise_append_only()';
    END IF;
    -- Separate statement, and unconditional, as 010's: a trigger that exists without
    -- ENABLE ALWAYS is upgraded, not skipped, and ALWAYS is what survives
    -- session_replication_role = 'replica'.
    EXECUTE 'ALTER TABLE app.facility_reporting_approval ENABLE ALWAYS TRIGGER trg_facility_reporting_approval_append_only';
END $$;

-- TRUNCATE is a statement, not a row, so the row-level trigger above never sees it. 010's
-- two triggers are row-level only; whether the owner can truncate those two tables is read
-- on the local stack and reported with this change, and is not acted on here. This table
-- is stopped at the statement.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_facility_reporting_approval_no_truncate') THEN
        EXECUTE 'CREATE TRIGGER trg_facility_reporting_approval_no_truncate
                     BEFORE TRUNCATE ON app.facility_reporting_approval
                     FOR EACH STATEMENT EXECUTE FUNCTION app.raise_append_only()';
    END IF;
    EXECUTE 'ALTER TABLE app.facility_reporting_approval ENABLE ALWAYS TRIGGER trg_facility_reporting_approval_no_truncate';
END $$;


-- ============================================================
-- d. public.operator_record_reporting_approval(): the operator's write.
-- ============================================================
CREATE OR REPLACE FUNCTION public.operator_record_reporting_approval(
    p_facility_id      text,
    p_model            text,
    p_approved_on      date,
    p_approved_by_role text
)
RETURNS TABLE (facility_id uuid, recorded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid       uuid := app.assert_operator();
    v_session   uuid := app.operator_session(v_uid);
    v_id        uuid;
    v_model     app.reporting_model;
    v_role      text := nullif(btrim(p_approved_by_role), '');
    v_accepted  date;
    v_withdrawn date;
    v_version   text;
    v_latest    app.facility_reporting_approval;
BEGIN
    -- The arguments first, each refused by name with the parameter in DETAIL, so that no
    -- CHECK or cast error reaches the caller (021's rule).
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;
    BEGIN
        v_model := p_model::app.reporting_model;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_model';
    END;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END IF;
    IF v_model IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_model';
    END IF;
    IF p_approved_on IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_approved_on';
    END IF;

    -- The facility row, locked FOR UPDATE before anything else is read. Two approvals at
    -- once, or an approval and a login activation at once (026's trigger takes the same
    -- lock), are then ordered, and "latest" means the same to both.
    PERFORM 1 FROM app.facility f WHERE f.id = v_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;

    -- The acceptance row: there is nothing to approve under without one, and a withdrawn
    -- agreement is final. The version is read from it and is never a parameter.
    SELECT a.accepted_on, a.withdrawn_on, a.version
      INTO v_accepted, v_withdrawn, v_version
      FROM app.facility_agreement a
     WHERE a.facility_id = v_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';
    END IF;
    IF v_withdrawn IS NOT NULL THEN
        RAISE EXCEPTION 'AGREEMENT_WITHDRAWN';
    END IF;

    -- By the Lagos calendar, as 021 does for the acceptance date. A cross-table CHECK is
    -- not available, so the lower bound is enforced here, where the acceptance row is read
    -- (the founder's decision 4).
    IF p_approved_on > (now() AT TIME ZONE 'Africa/Lagos')::date THEN
        RAISE EXCEPTION 'APPROVAL_DATE_IN_FUTURE';
    END IF;
    IF p_approved_on < v_accepted THEN
        RAISE EXCEPTION 'APPROVAL_BEFORE_AGREEMENT';
    END IF;
    IF v_role IS NOT NULL AND length(v_role) > 64 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_approved_by_role';
    END IF;

    -- An identical repeat of the latest approval appends nothing. Anything else appends,
    -- a corrected date or title included: the table is append-only, so a correction has
    -- no other path, and the earlier row stays.
    SELECT * INTO v_latest
      FROM app.facility_reporting_approval r
     WHERE r.facility_id = v_id
     ORDER BY r.id DESC
     LIMIT 1;
    IF FOUND AND v_latest.model = v_model AND v_latest.approved_on = p_approved_on
       AND v_latest.approved_by_role IS NOT DISTINCT FROM v_role THEN
        RETURN QUERY SELECT v_id, false;
        RETURN;
    END IF;

    INSERT INTO app.facility_reporting_approval
        (facility_id, model, approved_on, agreement_version, approved_by_role, recorded_session)
    VALUES (v_id, v_model, p_approved_on, v_version, v_role, v_session);

    -- The model only, never the title: the audit row is built to hold no identity, and the
    -- values are a few characters of jsonb, far inside its 256-character cap.
    INSERT INTO app.audit_log (facility_id, action, old_value, new_value, session_id)
    VALUES (v_id, 'reporting_approval.record',
            CASE WHEN v_latest.id IS NULL THEN NULL ELSE jsonb_build_object('model', v_latest.model) END,
            jsonb_build_object('model', v_model),
            v_session);

    RETURN QUERY SELECT v_id, true;
END;
$FN$;

DO $$
DECLARE
    r text;
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.operator_record_reporting_approval(text, text, date, text) FROM PUBLIC';
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.operator_record_reporting_approval(text, text, date, text) FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.operator_record_reporting_approval(text, text, date, text) TO authenticated';
    END IF;
END $$;


-- ============================================================
-- e. app.provision_begin: 026's body, the approval gate added to each reporting branch.
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
    v_approved app.reporting_model;
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
        -- 029 (GA; ruling FX P2, the founder's decision 2): the LATEST approval decides which
        -- kind of reporting login this facility may have. A login that contradicts it is
        -- refused, and so is any reporting login at a facility with no approval, with one
        -- code and a DETAIL that says which. After the "already active" exit above, so a
        -- re-run for a login that exists still returns complete; before
        -- REPORTING_MODEL_CONFLICT, which stays as the backstop.
        SELECT r.model INTO v_approved
          FROM app.facility_reporting_approval r
         WHERE r.facility_id = p_facility
         ORDER BY r.id DESC
         LIMIT 1;
        IF v_approved IS NULL THEN
            RAISE EXCEPTION 'REPORTING_MODEL_NOT_APPROVED'
                  USING DETAIL = 'no reporting model is approved for this facility';
        ELSIF v_approved IS DISTINCT FROM 'WARD' THEN
            RAISE EXCEPTION 'REPORTING_MODEL_NOT_APPROVED'
                  USING DETAIL = format('the latest approval is %s reporting, and this login is a ward login', v_approved);
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
        -- 029 (GA; ruling FX P2, the founder's decision 2): the LATEST approval decides which
        -- kind of reporting login this facility may have. A login that contradicts it is
        -- refused, and so is any reporting login at a facility with no approval, with one
        -- code and a DETAIL that says which. After the "already active" exit above, so a
        -- re-run for a login that exists still returns complete; before
        -- REPORTING_MODEL_CONFLICT, which stays as the backstop.
        SELECT r.model INTO v_approved
          FROM app.facility_reporting_approval r
         WHERE r.facility_id = p_facility
         ORDER BY r.id DESC
         LIMIT 1;
        IF v_approved IS NULL THEN
            RAISE EXCEPTION 'REPORTING_MODEL_NOT_APPROVED'
                  USING DETAIL = 'no reporting model is approved for this facility';
        ELSIF v_approved IS DISTINCT FROM 'FACILITY' THEN
            RAISE EXCEPTION 'REPORTING_MODEL_NOT_APPROVED'
                  USING DETAIL = format('the latest approval is %s reporting, and this login is a facility-level login', v_approved);
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

-- Owner only, as 020 left them. A replaced function keeps its ACL; this is re-run
-- so the fact is stated where the body changes.
DO $$
DECLARE
    r text;
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION app.provision_begin(uuid, text, text) FROM PUBLIC';
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION app.provision_begin(uuid, text, text) FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- f. public.operator_register(): 026's body, with the approval keys and the one derived model.
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
                       -- the two kinds from being active at one facility together. Since 029 it is
                       -- read from the lateral dm below, so the state beside it compares the same value.
                       'reporting_model', dm.m,
                       -- 029 (GA; ruling FX P2): the model the latest approval records, the date it was
                       -- approved, and the four states, computed here and nowhere else. Compared
                       -- against the LATEST approval only. JSON null in the state means no approval
                       -- and no login (the founder's decision 3); it is not a fifth state.
                       'approved_model', ap.model,
                       'approved_on', ap.approved_on,
                       'reporting_approval_state', CASE
                           WHEN ap.model IS NULL AND dm.m = 'NONE' THEN NULL
                           WHEN ap.model IS NULL THEN 'APPROVAL_NOT_RECORDED'
                           WHEN dm.m = 'NONE' THEN 'NOT_YET_PROVISIONED'
                           WHEN ap.model::text = dm.m THEN 'MATCHES'
                           ELSE 'MISMATCH' END,
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
              -- 029: the latest approval for the facility, if any. Highest id wins.
              LEFT JOIN LATERAL (
                    SELECT r.model, r.approved_on
                      FROM app.facility_reporting_approval r
                     WHERE r.facility_id = f.id
                     ORDER BY r.id DESC
                     LIMIT 1) ap ON true
              -- 029: the model the active logins make, computed once for both keys that use it.
              CROSS JOIN LATERAL (
                    SELECT CASE
                        WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                      WHERE u.facility_id = f.id AND u.role = 'FACILITY_REPORTER' AND u.is_active) THEN 'FACILITY'
                        WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                      WHERE u.facility_id = f.id AND u.role = 'WARD_STAFF' AND u.is_active) THEN 'WARD'
                        ELSE 'NONE' END AS m) dm
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
VALUES ('029_facility_reporting_approval.sql', now())
ON CONFLICT (filename) DO NOTHING;
