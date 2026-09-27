-- ============================================================
-- 026_facility_reporter_and_checks.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 025 state. Every function 026 replaced is
-- returned VERBATIM, copied from the file that last wrote it and not retyped:
-- app.assert_member and public.my_facility_wards() (011), public.publish_ward_status
-- (014), public.operator_record_contact (021), app.provision_begin (022),
-- public.operator_register (023) and app.provision_complete (024).
-- public.my_facility_wards() is created again from 011's text with 011's grant, and
-- public.my_reporting_wards() is dropped (the reverse of R-2026-09-27-145 DU-1's
-- rename). public.operator_record_registration and app.enforce_one_reporting_source
-- are dropped with the trigger; the reporter's
-- index, the email CHECK, the HEFAMAA CHECK and column go; the two scope CHECKs return
-- to 003's three arms and the erasure CHECK to 024's two; and the ledger row goes.
--
-- IT REFUSES, BY NAME, WHILE DATA DEPENDS ON 026:
--   REPORTER_ROWS_EXIST      -- an app.ward_account or app.invite row holds
--                               FACILITY_REPORTER: 003's CHECKs would refuse it.
--   REPORTER_ERASURES_EXIST  -- an erasure audit row names FACILITY_REPORTER: 024's
--                               CHECK would refuse it, and app.audit_log is
--                               append-only (010), so the row cannot go instead.
--   HEFAMAA_NUMBERS_RECORDED -- a facility holds a registration number: dropping the
--                               column would lose it. Reversing past recorded data is
--                               a founder decision, taken by hand.
--
-- The audit rows 026's functions wrote ('facility.registration', and provisioning
-- rows naming the reporter) stay: app.audit_log is append-only, and each satisfies
-- 005's constraints without 026.
--
-- Idempotency: the refusals read only; CREATE OR REPLACE; DROP FUNCTION / TRIGGER /
-- INDEX / CONSTRAINT / COLUMN IF EXISTS; each CHECK is dropped if it exists and added
-- again; the revoke loops are repeatable; the ledger DELETE matches at most one row.
-- Dropped RESTRICT, never CASCADE.
-- ============================================================


-- ============================================================
-- 0. The refusals.
-- ============================================================
DO $$
DECLARE
    n_acct    integer;
    n_invite  integer;
    n_erase   integer;
    n_hefamaa integer := 0;
BEGIN
    SELECT count(*) INTO n_acct FROM app.ward_account WHERE role::text = 'FACILITY_REPORTER';
    SELECT count(*) INTO n_invite FROM app.invite WHERE role::text = 'FACILITY_REPORTER';
    IF n_acct > 0 OR n_invite > 0 THEN
        RAISE EXCEPTION 'REPORTER_ROWS_EXIST'
              USING DETAIL = format('%s ward_account row(s) and %s invite row(s) hold FACILITY_REPORTER; 003''s scope CHECKs would refuse them. Not reversed.', n_acct, n_invite);
    END IF;
    SELECT count(*) INTO n_erase FROM app.audit_log
     WHERE action = 'ward_account.login_erase' AND new_value ->> 'role' = 'FACILITY_REPORTER';
    IF n_erase > 0 THEN
        RAISE EXCEPTION 'REPORTER_ERASURES_EXIST'
              USING DETAIL = format('%s append-only erasure audit row(s) name FACILITY_REPORTER; 024''s CHECK would refuse them. Not reversed.', n_erase);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'app' AND table_name = 'facility' AND column_name = 'hefamaa_reg_no') THEN
        EXECUTE 'SELECT count(*) FROM app.facility WHERE hefamaa_reg_no IS NOT NULL' INTO n_hefamaa;
    END IF;
    IF n_hefamaa > 0 THEN
        RAISE EXCEPTION 'HEFAMAA_NUMBERS_RECORDED'
              USING DETAIL = format('%s facility row(s) hold a HEFAMAA registration number; dropping the column would lose it. Not reversed.', n_hefamaa);
    END IF;
END $$;


-- ============================================================
-- 1. 023's public.operator_register(), verbatim, with 021's grant.
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
        'facilities', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'facility_id', f.id,
                       'name', f.name,
                       'lga', f.lga,
                       'state', f.state,
                       'lat', f.lat,
                       'lng', f.lng,
                       'public_phone_e164', f.public_phone_e164,
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
                       'categories', coalesce((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'category', ws.category,
                                      'offering', ws.offering,
                                      'monitoring_state', ws.monitoring_state,
                                      'bed_count', ws.bed_count,
                                      'accepting', ws.accepting,
                                      'updated_at', ws.updated_at,
                                      'has_account', EXISTS (
                                          SELECT 1 FROM app.ward_account u
                                           WHERE u.facility_id = f.id AND u.ward_category = ws.category
                                             AND u.role = 'WARD_STAFF' AND u.is_active),
                                      'provisioning_incomplete',
                                          EXISTS (SELECT 1 FROM app.invite i
                                                   WHERE i.facility_id = f.id AND i.ward_category = ws.category
                                                     AND i.role = 'WARD_STAFF' AND i.accepted_at IS NULL)
                                          AND NOT EXISTS (SELECT 1 FROM app.ward_account u
                                                   WHERE u.facility_id = f.id AND u.ward_category = ws.category
                                                     AND u.role = 'WARD_STAFF' AND u.is_active)
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
-- 2. The HEFAMAA writer, CHECK and column.
-- ============================================================
DROP FUNCTION IF EXISTS public.operator_record_registration(text, integer, text) RESTRICT;
ALTER TABLE app.facility DROP CONSTRAINT IF EXISTS facility_hefamaa_reg_no_form;
ALTER TABLE app.facility DROP COLUMN IF EXISTS hefamaa_reg_no RESTRICT;


-- ============================================================
-- 3. 021's public.operator_record_contact, verbatim; the email CHECK dropped.
-- ============================================================
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

ALTER TABLE app.facility_contact DROP CONSTRAINT IF EXISTS facility_contact_email_form;


-- ============================================================
-- 4. 024's erasure CHECK, with its two roles.
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
                        AND (   (new_value ->> 'role' = 'WARD_STAFF'     AND ward_category IS NOT NULL)
                             OR (new_value ->> 'role' = 'FACILITY_ADMIN' AND ward_category IS NULL))
                    ELSE false
                END
        )
    );


-- ============================================================
-- 5. 024's app.provision_complete and 022's app.provision_begin, verbatim.
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

    IF v_role = 'FACILITY_ADMIN' THEN
        RAISE EXCEPTION 'ROLE_NOT_PROVISIONED_IN_V1' USING DETAIL = 'FACILITY_ADMIN';
    END IF;

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
    ELSE
        -- PLATFORM_ADMIN: no facility, no category (003's scope CHECK), no gate.
        p_facility := NULL;
        v_category := NULL;
        -- R-2026-09-24-90 BR-1 b: an active operator is complete. Nothing is opened,
        -- and the script calls no Auth admin endpoint.
        IF EXISTS (SELECT 1 FROM app.ward_account u
                    WHERE u.role = 'PLATFORM_ADMIN' AND u.is_active) THEN
            RETURN QUERY SELECT 'complete'::text, NULL::uuid;
            RETURN;
        END IF;
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

DO $$
DECLARE
    f text;
    r text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
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
-- 6. The rename, reversed: public.my_reporting_wards() dropped, and 011's
--    public.my_facility_wards() created again, verbatim, with 011's grant.
-- ============================================================
DROP FUNCTION IF EXISTS public.my_reporting_wards() RESTRICT;
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

REVOKE ALL ON FUNCTION public.my_facility_wards() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.my_facility_wards() FROM %I', r);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.my_facility_wards() TO authenticated';
    END IF;
END $$;


-- ============================================================
-- 7. 014's public.publish_ward_status and 011's app.assert_member, verbatim.
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


-- ============================================================
-- 8. The trigger and its function; the reporter's index.
-- ============================================================
DROP TRIGGER IF EXISTS trg_ward_account_one_reporting_source ON app.ward_account;
DROP FUNCTION IF EXISTS app.enforce_one_reporting_source() RESTRICT;
DROP INDEX IF EXISTS app.ward_account_one_active_reporter RESTRICT;


-- ============================================================
-- 9. 003's three-arm scope CHECKs.
-- ============================================================
ALTER TABLE app.ward_account DROP CONSTRAINT IF EXISTS ward_account_scope_matches_role;
ALTER TABLE app.ward_account ADD CONSTRAINT ward_account_scope_matches_role
    CHECK (
         (role = 'WARD_STAFF'     AND facility_id IS NOT NULL AND ward_category IS NOT NULL)
      OR (role = 'FACILITY_ADMIN' AND facility_id IS NOT NULL AND ward_category IS NULL)
      OR (role = 'PLATFORM_ADMIN' AND facility_id IS NULL     AND ward_category IS NULL)
    );

ALTER TABLE app.invite DROP CONSTRAINT IF EXISTS invite_scope_matches_role;
ALTER TABLE app.invite ADD CONSTRAINT invite_scope_matches_role
    CHECK (
         (role = 'WARD_STAFF'     AND facility_id IS NOT NULL AND ward_category IS NOT NULL)
      OR (role = 'FACILITY_ADMIN' AND facility_id IS NOT NULL AND ward_category IS NULL)
      OR (role = 'PLATFORM_ADMIN' AND facility_id IS NULL     AND ward_category IS NULL)
    );


-- ============================================================
-- 10. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '026_facility_reporter_and_checks.sql';
