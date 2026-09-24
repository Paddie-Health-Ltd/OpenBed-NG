-- ============================================================
-- 021_facility_agreement_and_contact_write.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 020 state. The two writes, the read and the
-- register go; 020's operator_list_facilities() returns; the two gates return to 020's bodies,
-- which read agreement_accepted_at on the contact row; that column comes back; the
-- contact's version and its trigger go, with app.bump_row_version(); and
-- app.facility_agreement goes.
--
-- IT REFUSES WHILE ANY AGREEMENT IS RECORDED. The forward migration refused to apply
-- over an agreement it would have had to invent a version for; this refuses to
-- reverse over one it would have to lose, or copy back onto a person's erasable row.
-- Neither direction invents or drops an agreement. To reverse past a recorded
-- agreement is a founder decision, taken by hand, not a script's.
--
-- The three bodies below are 020's VERBATIM, copied from that file and not retyped,
-- so the reversal restores exactly what 021 replaced.
--
-- Idempotency: the refusal reads the table only while it exists; DROP ... IF EXISTS
-- throughout; ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE; the ledger DELETE matches
-- at most one row. Everything is dropped RESTRICT, never CASCADE.
-- ============================================================


-- ============================================================
-- 0. Refuse while an agreement is recorded.
-- ============================================================
DO $$
DECLARE
    n integer;
BEGIN
    IF to_regclass('app.facility_agreement') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM app.facility_agreement' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'AGREEMENTS_RECORDED'
                USING DETAIL = format('%s app.facility_agreement row(s) exist; reversing 021 would lose them. Not reversed.', n);
        END IF;
    END IF;
END $$;


-- ============================================================
-- 1. The two writes and the read.
-- ============================================================
DROP FUNCTION IF EXISTS public.operator_record_contact(text, text, text, text, text, boolean, integer) RESTRICT;
DROP FUNCTION IF EXISTS public.operator_record_agreement(text, date, text, text) RESTRICT;
DROP FUNCTION IF EXISTS public.operator_get_contact(text) RESTRICT;
DROP FUNCTION IF EXISTS public.operator_register() RESTRICT;


-- ============================================================
-- 2. The column the 020 bodies read, restored before the bodies.
-- ============================================================
ALTER TABLE app.facility_contact ADD COLUMN IF NOT EXISTS agreement_accepted_at timestamptz;


-- ============================================================
-- 3. The list and the two gates, 020's verbatim.
-- ============================================================
CREATE OR REPLACE FUNCTION public.operator_list_facilities()
RETURNS TABLE (
    facility_id        uuid,
    name               text,
    lga                text,
    state              text,
    version            integer,
    listed_at          timestamptz,
    quiet_mode         boolean,
    is_active          boolean,
    has_contact        boolean,
    agreement_recorded boolean,
    categories         jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid uuid := app.assert_operator();
BEGIN
    -- EVERY facility and EVERY category (AJ D8). Freshness never filters, sorts out
    -- or hides a row here; the operator is shown the stale ones. The bands are the
    -- page's, from freshnessBand(). No address or name of a person is returned: the
    -- contact is a yes/no, and "provisioning incomplete" comes from app.invite,
    -- never auth.users (-71 C).
    RETURN QUERY
    SELECT f.id, f.name, f.lga, f.state, f.version, f.listed_at, f.quiet_mode, f.is_active,
           EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = f.id),
           EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = f.id AND c.agreement_accepted_at IS NOT NULL),
           coalesce((
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
      FROM app.facility f
     ORDER BY f.name, f.id;
END;
$FN$;

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
    IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = v_id AND c.agreement_accepted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';
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
        IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = p_facility AND c.agreement_accepted_at IS NOT NULL) THEN
            RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';
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

DO $$
DECLARE
    f text;
    r text;
BEGIN
    FOREACH f IN ARRAY ARRAY['public.operator_list_facilities()', 'public.operator_set_facility_listed(text, integer)'] LOOP
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
END $$;


-- ============================================================
-- 4. The contact's version, its trigger, and the trigger function.
-- ============================================================
DROP TRIGGER IF EXISTS trg_facility_contact_version ON app.facility_contact;
ALTER TABLE app.facility_contact DROP COLUMN IF EXISTS version;
DROP FUNCTION IF EXISTS app.bump_row_version() RESTRICT;


-- ============================================================
-- 5. The agreement table (empty: section 0 refused otherwise).
-- ============================================================
DROP TABLE IF EXISTS app.facility_agreement RESTRICT;


-- ============================================================
-- 6. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '021_facility_agreement_and_contact_write.sql';
