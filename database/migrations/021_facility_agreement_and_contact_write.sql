-- ============================================================
-- 021_facility_agreement_and_contact_write.sql
-- ============================================================
-- Bundle 3, PR 3.4b-db (R-2026-09-24-75 BC-5, as restructured by R-2026-09-24-76
-- BD-1; issued as R-PROVISIONAL-2026-09-24-BC and -BD).
-- The admin app could list no facility: operator_set_facility_listed requires a
-- contact row and a recorded agreement, and nothing wrote either. This adds the two
-- writes, and moves the agreement off the contact row first.
--
-- WHY THE AGREEMENT LEAVES THE CONTACT ROW (BD-1, the CLCO's structural change).
-- app.facility_contact is a named person's personal data, and 003 makes it erasable
-- on request. Until this migration it also held agreement_accepted_at: the only
-- evidence that the FACILITY accepted the data-sharing agreement, which is the basis
-- for processing that facility's ward data. Erasing the person would have erased the
-- basis. So the agreement becomes its own row, app.facility_agreement, which no
-- contact erasure touches.
--
-- WHAT IT ADDS:
--   1. app.facility_agreement: one row per facility. accepted_on is a DATE (the day
--      the agreement was signed, not a moment); version is a short label;
--      signatory_role is a job title such as "CMD", never a name; withdrawn_on is set
--      by a founder runbook step and never by a function (BD-2 2). RLS enabled and
--      forced, no client grant, no policy, like every app table.
--   2. app.facility_contact.version, bumped by its own trigger. It is the contact's
--      stale-edit token. It is NOT facility.version: an UPDATE of app.facility fires
--      the projection (008), so bumping it would move facility_public.updated_at for a
--      change no visitor can see. The trigger function is a new app.bump_row_version()
--      rather than 020's app.bump_facility_version(), so this migration holds no hard
--      dependency on 020's objects and 020's round trip still reverses cleanly.
--   3. public.operator_record_contact and public.operator_record_agreement: two
--      writes, because they are two facts. public.operator_get_contact: the operator's
--      read of both, for the facility detail view only (no audit row in v1; BD-2 1).
--   4. The gates restated to read the two tables: operator_set_facility_listed and
--      app.provision_begin need a contact row AND an agreement row that is not
--      withdrawn. Each body is 020's, with only the agreement check replaced.
--   5. The operator's register as an envelope, {server_now, facilities}, so the admin
--      app computes freshness against the database's clock and never the operator's
--      device (BC-5 c). server_now is built OUTSIDE the facility aggregate: with no
--      facility at all, which is day one, a per-row column would have carried no
--      clock. It is a NEW function, public.operator_register(), and 020's
--      operator_list_facilities() is dropped. Changing that function's return type in
--      place would make 020 fail on re-apply ("cannot change return type of existing
--      function"), breaking tests/db/migration_idempotency.test.ts's invariant that
--      every forward migration re-applies cleanly over the later ones. Nothing but
--      tests called the old name. Its grants follow its creation below (BD-1 e).
--      R-2026-09-24-78 BF-1 c asked for one read path by keeping the old function
--      with its grant revoked; R-2026-09-24-79 BG-1 accepted DROPPING it instead. Kept,
--      it would be broken: its 020 body reads facility_contact.agreement_accepted_at
--      (020:698), which this migration drops, so it would error on any call. A
--      re-apply of 020 recreates it and a re-apply of this drops it again, so 020
--      still re-applies unchanged. The down migration restores it with its grant.
--   6. A withdrawn agreement takes the facility off the public output BY ITSELF
--      (R-2026-09-24-82 BJ-1). The data-sharing agreement is the basis for publishing
--      a facility's data, so its withdrawal cannot wait on someone remembering to
--      unlist. Both public membership predicates gain "no withdrawn agreement", and a
--      trigger on app.facility_agreement re-projects the facility through 008's
--      app.trg_project(), so setting withdrawn_on empties its mirror rows in the same
--      transaction; the rollup stops counting it at its next refresh (every five
--      minutes, 017). The page follows in about two minutes (020's B2).
--
-- EVERY PUBLIC MEMBERSHIP PREDICATE, enumerated from the live catalogue on 2026-09-24
-- (every function in app, public and graphql_public whose source reads listed_at or
-- names a mirror; no view and no materialized view exists). Exactly two decide which
-- facilities reach public output, and both gain the predicate in section 6:
--   - app.project_facility(uuid): the only writer of public.facility_public and
--     public.ward_public;
--   - app.refresh_lga_rollup(): the only writer of public.lga_rollup.
-- app.regenerate_snapshot() and public.publish_ward_status read the mirrors only, so
-- they inherit the first. operator_create_facility, operator_register and
-- operator_set_facility_listed read listed_at for the operator, not the public.
--
-- NOTHING IS MOVED, AND NOTHING IS INVENTED. BD-1 b asks for existing
-- agreement_accepted_at values to be moved, behind a pre-check that refuses when any
-- exist. Both cannot act: the pre-check refuses exactly when there is something to
-- move, and a moved agreement would need a version that was never recorded. So the
-- pre-check below is the whole of it (agreed by R-2026-09-24-78 BF-1 a). Hosted holds
-- no facility (runbook step 4b, read 2026-09-21), so it holds no contact row. The down
-- migration mirrors this, restoring the column empty and refusing while any
-- agreement row exists, so neither direction loses or invents an agreement.
--
-- APPLYING THIS CHANGES NO PUBLIC OUTPUT. No projected table is written, and no
-- facility row is updated. The contact is never projected. The agreement is, from
-- section 6 on, but its trigger fires only on agreement rows and applying this writes
-- none. The restated predicates exclude only a facility with a WITHDRAWN agreement,
-- and on apply there is no agreement row at all: hosted holds no facility (step 4b),
-- and the seed holds no agreement. Nothing is re-projected by the apply, and a later
-- refresh of the rollup computes the same cells as under 020 (both shown in
-- tests/db/migration_021_round_trip.test.ts; -71 B1).
--
-- Idempotency: the pre-check reads a column only while it exists; CREATE TABLE IF NOT
-- EXISTS; ADD COLUMN IF NOT EXISTS; DROP COLUMN IF EXISTS; DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER; CREATE OR REPLACE for every function; DROP FUNCTION IF
-- EXISTS for 020's list, which a re-apply of 020 recreates and a re-apply of this
-- drops again; the grants are re-run; the ledger insert is ON CONFLICT DO NOTHING.
--
-- Deployment ordering gate: 020 must be applied first. USING it on hosted is gated by
-- -45: no facility and no ward account is created there until step 4b reads clear.
-- ============================================================


-- ============================================================
-- 0. Pre-check: no agreement may be sitting on a contact row.
-- ============================================================
DO $$
DECLARE
    n integer;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'app' AND table_name = 'facility_contact'
                  AND column_name = 'agreement_accepted_at') THEN
        EXECUTE 'SELECT count(*) FROM app.facility_contact WHERE agreement_accepted_at IS NOT NULL' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'AGREEMENT_ON_CONTACT_ROWS'
                USING DETAIL = format('%s facility_contact row(s) carry agreement_accepted_at, and moving one would need a version never recorded. Record each through operator_record_agreement after this migration, by hand.', n);
        END IF;
    END IF;
END $$;


-- ============================================================
-- 1. app.facility_agreement -- the facility's acceptance, off the person's row.
-- ============================================================
CREATE TABLE IF NOT EXISTS app.facility_agreement (
    facility_id      uuid PRIMARY KEY REFERENCES app.facility(id) ON DELETE RESTRICT,
    accepted_on      date NOT NULL,
    version          text NOT NULL,
    -- A job title such as "CMD" or "Matron". Never a name: the agreement row must
    -- stay free of personal data, so that no erasure request ever reaches it.
    signatory_role   text,
    recorded_at      timestamptz NOT NULL DEFAULT now(),
    -- The operator session that recorded it, from the JWT as in 014 and 020. NULL
    -- only for a row written by a founder SQL step, which has no session: an honest
    -- absence, never an invented id.
    recorded_session uuid,
    -- Set by the founder's withdrawal runbook step, never by a function (BD-2 2). The
    -- row is never deleted: a withdrawn agreement is still the record of what was
    -- accepted, and when.
    withdrawn_on     date,

    CONSTRAINT facility_agreement_version_is_a_label
        CHECK (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    CONSTRAINT facility_agreement_signatory_role_is_short
        CHECK (signatory_role IS NULL OR length(signatory_role) BETWEEN 1 AND 64),
    CONSTRAINT facility_agreement_withdrawn_after_accepted
        CHECK (withdrawn_on IS NULL OR withdrawn_on >= accepted_on)
);

COMMENT ON TABLE app.facility_agreement IS
    'The facility''s acceptance of the data-sharing agreement: the basis for '
    'processing its ward data. Moved off app.facility_contact by 021 (R-2026-09-24-76 '
    'BD-1) so that erasing the contact person never erases it. Not append-only, but '
    'no function deletes or overwrites it; withdrawal sets withdrawn_on.';

ALTER TABLE app.facility_agreement ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.facility_agreement FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.facility_agreement FROM PUBLIC;
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON app.facility_agreement FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 2. The contact loses the agreement and gains its own version.
-- ============================================================
ALTER TABLE app.facility_contact DROP COLUMN IF EXISTS agreement_accepted_at;
ALTER TABLE app.facility_contact ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN app.facility_contact.version IS
    'The contact''s stale-edit token, incremented by trg_facility_contact_version on '
    'every UPDATE. Never facility.version: an UPDATE of app.facility re-projects the '
    'public mirrors.';

CREATE OR REPLACE FUNCTION app.bump_row_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $FN$
BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$FN$;
REVOKE ALL ON FUNCTION app.bump_row_version() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_facility_contact_version ON app.facility_contact;
CREATE TRIGGER trg_facility_contact_version
    BEFORE UPDATE ON app.facility_contact
    FOR EACH ROW EXECUTE FUNCTION app.bump_row_version();


-- ============================================================
-- 3. The gates, restated to read the two tables (BD-1 d).
-- ============================================================
-- Each body is 020's, copied from that file, with only the agreement check replaced:
-- a contact row, then an agreement row, then that agreement not withdrawn, each
-- refused by name. tests/db/migration_021_round_trip.test.ts holds the difference to
-- exactly those lines.

CREATE OR REPLACE FUNCTION public.operator_set_facility_listed(
    p_facility_id      text,
    p_expected_version integer
)
RETURNS TABLE (facility_id uuid, version integer, listed_at timestamptz)
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
    v_listed  timestamptz;
BEGIN
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;

    SELECT * INTO v_old FROM app.facility f WHERE f.id = v_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;
    IF v_old.listed_at IS NOT NULL THEN
        -- Already listed: a repeat is an answer, not a second write.
        RETURN QUERY SELECT v_id, v_old.version, v_old.listed_at;
        RETURN;
    END IF;
    IF v_old.version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'VERSION_CONFLICT' USING DETAIL = format('current_version=%s', v_old.version);
    END IF;

    -- THE PRECONDITIONS (-71 B), each refused by name, in the order an operator
    -- meets them. Listing is the act that makes a facility public, so it requires
    -- what the -45 gate requires of a facility that is public.
    IF NOT v_old.is_active THEN
        RAISE EXCEPTION 'FACILITY_INACTIVE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = v_id) THEN
        RAISE EXCEPTION 'NO_FACILITY_CONTACT';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = v_id) THEN
        RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';
    END IF;
    IF EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = v_id AND a.withdrawn_on IS NOT NULL) THEN
        RAISE EXCEPTION 'AGREEMENT_WITHDRAWN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.ward_status ws WHERE ws.facility_id = v_id) THEN
        RAISE EXCEPTION 'NO_CATEGORY';
    END IF;

    UPDATE app.facility f SET listed_at = now()
     WHERE f.id = v_id
    RETURNING f.version, f.listed_at INTO v_version, v_listed;

    INSERT INTO app.audit_log (facility_id, action, old_value, new_value, version, session_id)
    VALUES (v_id, 'facility.list',
            jsonb_build_object('listed', false), jsonb_build_object('listed', true),
            v_version, v_session);

    RETURN QUERY SELECT v_id, v_version, v_listed;
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
-- 4. The two writes (BC-5 a, BD-1 c) and the operator's read (BD-1 f).
-- ============================================================
-- Text parameters, never app-typed, as in 020. Each write leaves one audit row
-- naming WHICH fields changed and the version, never their values: nothing a
-- person's row holds is copied into the append-only audit trail.

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

CREATE OR REPLACE FUNCTION public.operator_record_agreement(
    p_facility_id    text,
    p_accepted_on    date,
    p_version        text,
    p_signatory_role text
)
RETURNS TABLE (facility_id uuid, recorded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid     uuid := app.assert_operator();
    v_session uuid := app.operator_session(v_uid);
    v_id      uuid;
    v_role    text := nullif(btrim(p_signatory_role), '');
    v_old     app.facility_agreement;
    v_new     uuid;
BEGIN
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;
    IF NOT EXISTS (SELECT 1 FROM app.facility f WHERE f.id = v_id) THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;
    IF p_accepted_on IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_accepted_on';
    END IF;
    IF p_version IS NULL OR p_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$' THEN
        RAISE EXCEPTION 'AGREEMENT_VERSION_NOT_A_LABEL';
    END IF;
    -- By the Lagos calendar: the day the agreement was signed, where it was signed.
    IF p_accepted_on > (now() AT TIME ZONE 'Africa/Lagos')::date THEN
        RAISE EXCEPTION 'AGREEMENT_DATE_IN_FUTURE';
    END IF;
    IF v_role IS NOT NULL AND length(v_role) > 64 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_signatory_role';
    END IF;

    INSERT INTO app.facility_agreement (facility_id, accepted_on, version, signatory_role, recorded_session)
    VALUES (v_id, p_accepted_on, p_version, v_role, v_session)
    ON CONFLICT (facility_id) DO NOTHING
    RETURNING facility_agreement.facility_id INTO v_new;

    IF v_new IS NOT NULL THEN
        INSERT INTO app.audit_log (facility_id, action, new_value, session_id)
        VALUES (v_id, 'facility_agreement.record',
                jsonb_build_object('fields', to_jsonb(ARRAY['accepted_on', 'version']
                    || CASE WHEN v_role IS NOT NULL THEN ARRAY['signatory_role'] ELSE ARRAY[]::text[] END)),
                v_session);
        RETURN QUERY SELECT v_id, true;
        RETURN;
    END IF;

    -- No expected-version parameter (R-2026-09-24-78 BF-1 b): nothing here is ever
    -- overwritten, so there is no stale write for one to guard.
    -- An agreement exists. An identical repeat is an answer; anything else is never
    -- overwritten here, withdrawn or not. A new version is a founder step (BD-1 c).
    SELECT * INTO v_old FROM app.facility_agreement a WHERE a.facility_id = v_id;
    IF v_old.accepted_on = p_accepted_on AND v_old.version = p_version
       AND v_old.signatory_role IS NOT DISTINCT FROM v_role THEN
        RETURN QUERY SELECT v_id, false;
        RETURN;
    END IF;
    RAISE EXCEPTION 'AGREEMENT_ALREADY_RECORDED';
END;
$FN$;

CREATE OR REPLACE FUNCTION public.operator_get_contact(p_facility_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_uid uuid := app.assert_operator();
    v_id  uuid;
BEGIN
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;
    IF NOT EXISTS (SELECT 1 FROM app.facility f WHERE f.id = v_id) THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;
    -- For the facility detail view only. The register keeps has_contact as yes/no and
    -- agreement_state as none/recorded/withdrawn (BD-1 f; -81 BI-1). No audit row in
    -- v1 (BD-2 1): revisit when a second PLATFORM_ADMIN account exists.
    RETURN jsonb_build_object(
        'contact', (SELECT jsonb_build_object(
                        'full_name', c.full_name,
                        'job_title', c.job_title,
                        'email', c.email,
                        'mobile_e164', c.mobile_e164,
                        'sms_opt_in', c.sms_opt_in_at IS NOT NULL,
                        'unreachable_since', c.unreachable_since,
                        'version', c.version)
                      FROM app.facility_contact c WHERE c.facility_id = v_id),
        'agreement', (SELECT jsonb_build_object(
                          'accepted_on', a.accepted_on,
                          'version', a.version,
                          'signatory_role', a.signatory_role,
                          'withdrawn_on', a.withdrawn_on)
                        FROM app.facility_agreement a WHERE a.facility_id = v_id));
END;
$FN$;


-- ============================================================
-- 5. The register, as an envelope carrying the database clock (BC-5 c).
-- ============================================================
-- A new function, not 020's list with a new return type: see the header, point 5.
-- Creating it gives it Supabase's default grants, and the revokes in section 6 follow
-- in the same transaction (BD-1 e); packages/fixtures/function-grants.json proves the
-- result on hosted, through scripts/readback_function_grants.sh.
DROP FUNCTION IF EXISTS public.operator_list_facilities() RESTRICT;
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


-- ============================================================
-- 6. A withdrawn agreement leaves the public output by itself (R-2026-09-24-82 BJ-1).
-- ============================================================
-- The two public membership predicates are 020's bodies verbatim, each with ONE line
-- added after `listed_at IS NOT NULL`: no withdrawn agreement. A facility with no
-- agreement row is unaffected -- the predicate is "no withdrawn agreement", not "has
-- one" -- which is what keeps B1 (see the header). The down migration restores 020's
-- bodies byte for byte; tests/db/migration_021_round_trip.test.ts compares both by value.
CREATE OR REPLACE FUNCTION app.project_facility(p_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_visible boolean;
BEGIN
    -- Visible means: the facility exists, is active, is not in quiet mode, and is
    -- LISTED (020; R-2026-09-23-71 B). A facility row that has been deleted yields
    -- NULL, which coalesces to false and therefore removes its mirror rows -- the
    -- correct behaviour.
    SELECT f.is_active AND NOT f.quiet_mode
           AND f.listed_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NOT NULL)
      INTO v_visible
      FROM app.facility f
     WHERE f.id = p_facility_id;

    v_visible := coalesce(v_visible, false);

    IF NOT v_visible THEN
        -- QUIET, INACTIVE OR GONE: no row, not a filtered row. See the header
        -- for why a DELETE is safe here and a tombstone would not be.
        DELETE FROM public.ward_public     WHERE facility_id = p_facility_id;
        DELETE FROM public.facility_public WHERE facility_id = p_facility_id;
        RETURN;
    END IF;

    -- ---- facility_public ------------------------------------------------
    INSERT INTO public.facility_public
        (facility_id, name, lga, state, lat, lng, public_phone_e164, updated_at)
    SELECT f.id, f.name, f.lga, f.state, f.lat, f.lng, f.public_phone_e164, f.updated_at
      FROM app.facility f
     WHERE f.id = p_facility_id
    ON CONFLICT (facility_id) DO UPDATE SET
        name              = EXCLUDED.name,
        lga               = EXCLUDED.lga,
        state             = EXCLUDED.state,
        lat               = EXCLUDED.lat,
        lng               = EXCLUDED.lng,
        public_phone_e164 = EXCLUDED.public_phone_e164,
        updated_at        = EXCLUDED.updated_at;

    -- ---- ward_public ----------------------------------------------------
    -- accepting_effective composes two things, and both are deliberate:
    --   (a) offering = 'OFFERED'  -- a ward the facility does not offer is never
    --       accepting, whatever its stored claim says. Mirrored by
    --       acceptingEffectiveForWard() in packages/gate/src/gate.ts.
    --   (b) accepting AND gate IS NULL -- the ward's claim, reduced by the gate.
    --       The gate can close; it can never open. The only route to `true` here
    --       is the ward having claimed `true`.
    INSERT INTO public.ward_public
        (facility_id, category, offering, bed_count,
         accepting_effective, gated_by, state, source, monitoring_state, updated_at)
    SELECT
        ws.facility_id,
        ws.category,
        ws.offering,
        ws.bed_count,
        (ws.offering = 'OFFERED'
             AND ws.accepting
             AND app.gate(ws.category, ops.anaesthetist, ops.obstetrician, ops.paediatrician) IS NULL),
        app.gate(ws.category, ops.anaesthetist, ops.obstetrician, ops.paediatrician),
        ws.state,
        ws.source,
        ws.monitoring_state,
        ws.updated_at
      FROM app.ward_status ws
      -- LEFT JOIN, not JOIN. A facility with no facility_ops row must still
      -- publish its wards, ungated: no recorded duty cover is not the same thing
      -- as recorded absence of cover. An inner join here would make every ward at
      -- such a facility silently vanish from the public dashboard.
      LEFT JOIN app.facility_ops ops ON ops.facility_id = ws.facility_id
     WHERE ws.facility_id = p_facility_id
    ON CONFLICT (facility_id, category) DO UPDATE SET
        offering            = EXCLUDED.offering,
        bed_count           = EXCLUDED.bed_count,
        accepting_effective = EXCLUDED.accepting_effective,
        gated_by            = EXCLUDED.gated_by,
        state               = EXCLUDED.state,
        source              = EXCLUDED.source,
        monitoring_state    = EXCLUDED.monitoring_state,
        updated_at          = EXCLUDED.updated_at;

    -- Remove mirror rows whose source ward_status row is gone.
    DELETE FROM public.ward_public wp
     WHERE wp.facility_id = p_facility_id
       AND NOT EXISTS (
           SELECT 1 FROM app.ward_status ws
            WHERE ws.facility_id = wp.facility_id
              AND ws.category    = wp.category
       );
END;
$FN$;

CREATE OR REPLACE FUNCTION app.refresh_lga_rollup()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $FN$
DECLARE
    v_rows integer;
BEGIN
    -- Full recompute. A cell that no longer clears the k-floor must DISAPPEAR,
    -- and an incremental update would leave it behind -- which is precisely the
    -- disclosure the floor exists to prevent.
    DELETE FROM public.lga_rollup;

    WITH contrib AS (
        -- One row per (cell, facility). THE SET.
        SELECT
            f.state,
            f.lga,
            ws.category,
            f.id AS facility_id,
            sum(coalesce(ws.bed_count, 0))::integer AS beds
          FROM app.facility f
          JOIN app.ward_status ws ON ws.facility_id = f.id
         WHERE f.quiet_mode
           AND f.is_active
           AND f.listed_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NOT NULL)
           AND ws.offering = 'OFFERED'
         GROUP BY f.state, f.lga, ws.category, f.id
    ),
    agg AS (
        SELECT
            c.state,
            c.lga,
            c.category,
            count(DISTINCT c.facility_id)::integer AS facility_count,
            sum(c.beds)::integer                   AS total_beds,
            max(c.beds)::integer                   AS max_facility_beds
          FROM contrib c
         GROUP BY c.state, c.lga, c.category
    )
    INSERT INTO public.lga_rollup (state, lga, category, facility_count, total_beds, updated_at)
    SELECT a.state, a.lga, a.category, a.facility_count, a.total_beds, now()
      FROM agg a
     WHERE CASE
               -- 1. K-FLOOR. Fewer than 5 contributing facilities: suppress.
               --    Stable over time, which is what makes it safe: a cell that is
               --    always absent tells an observer nothing.
               WHEN a.facility_count < 5 THEN false

               -- 2. ALL-ZERO. PUBLISH, and return before any division is reached.
               --
               --    This arm MUST precede arm 3. CASE evaluates its conditions in
               --    order and stops at the first true one, so arm 3's division is
               --    unreachable when total_beds = 0.
               --
               --    Published rather than suppressed because suppressing would not
               --    hide it: if all-zero were the only condition beyond the k-floor
               --    that removed a cell, the cell would be present on normal days
               --    and absent on zero days, and the absence would be the signal.
               --    Suppression buys nothing and costs the most useful thing the
               --    rollup can say.
               WHEN a.total_beds = 0 THEN true

               -- 3. DOMINANCE. Reachable only when total_beds > 0.
               --    NULLIF is belt-and-braces on top of the ordering above: if
               --    anyone ever reorders these arms, this yields NULL (row not
               --    selected) rather than raising division_by_zero and taking the
               --    whole refresh down.
               WHEN a.max_facility_beds::numeric / nullif(a.total_beds, 0) <= 0.40 THEN true

               ELSE false
           END;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$FN$;

-- The mirrors move in the SAME TRANSACTION as the withdrawal: this is 008's projection
-- path, app.trg_project(), which resolves facility_id for every table but app.facility.
-- Not a second projection routine. AFTER ROW and not deferrable, like the other three,
-- which tests/db/projection_trigger_state.test.ts holds.
DROP TRIGGER IF EXISTS trg_facility_agreement_project ON app.facility_agreement;
CREATE TRIGGER trg_facility_agreement_project
    AFTER INSERT OR UPDATE OR DELETE ON app.facility_agreement
    FOR EACH ROW EXECUTE FUNCTION app.trg_project();


-- ============================================================
-- 7. EXECUTE: authenticated only, for every public function this migration writes.
-- ============================================================
-- REVOKE FROM PUBLIC is not enough: Supabase's default ACL grants EXECUTE on public
-- functions to anon, authenticated and service_role BY NAME (014; observed again in
-- tests/db/function_grants.test.ts).
DO $$
DECLARE
    f text;
    r text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.operator_record_contact(text, text, text, text, text, boolean, integer)',
        'public.operator_record_agreement(text, date, text, text)',
        'public.operator_get_contact(text)',
        'public.operator_register()',
        'public.operator_set_facility_listed(text, integer)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
            END IF;
        END LOOP;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
        END IF;
    END LOOP;
    -- The restated gate and the new trigger function: executable by no client role.
    FOREACH f IN ARRAY ARRAY['app.provision_begin(uuid, text, text)', 'app.bump_row_version()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
            END IF;
        END LOOP;
    END LOOP;
END $$;


-- ============================================================
-- 8. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('021_facility_agreement_and_contact_write.sql', now())
ON CONFLICT (filename) DO NOTHING;
