-- ============================================================
-- 022_one_operator_and_reactivation.sql
-- ============================================================
-- Bundle 3, PR 3.4b-app A (R-2026-09-24-90 BR-1, issued as R-PROVISIONAL-2026-09-24-BR;
-- the build word R-2026-09-24-91 BS). Two gaps in the provisioning gates, which
-- scripts/provision_ward_account.mjs goes through from this PR on. BOTH are closed in
-- SQL, because the gates have ONE implementation (-71 C; BP-6 4). A script read-back
-- plus a runbook stop was offered as the alternative and refused as a second gate
-- outside SQL.
--
-- WHAT IT CHANGES, and nothing else:
--   a) AT MOST ONE ACTIVE PLATFORM_ADMIN, by the database. A partial unique index,
--      the shape of 020's ward_account_one_active_per_ward. A second operator is
--      BD-2 1's trigger (the read audit on a contact): it needs a ruling and a
--      migration that drops this index, never a script run. The pre-check below
--      refuses to apply while more than one active PLATFORM_ADMIN exists, and names
--      the count. Hosted holds none.
--   b) app.provision_begin, PLATFORM_ADMIN: with an active PLATFORM_ADMIN it returns
--      'complete' with a NULL invite and opens nothing, so the script makes no Auth
--      admin request (J4's rule, now for the operator too). Until this, 021's body had
--      no such arm: after the first invite was accepted, a re-run opened a new one
--      (the one-open-invite index is partial on accepted_at IS NULL, 020:332-334), and
--      a different address became a second operator silently. The body is 021's
--      verbatim with that one arm added in the PLATFORM_ADMIN branch.
--   c) app.provision_complete, a deactivated account of the same scope: it
--      REACTIVATES, where 020's body reported 'complete' whatever is_active held and
--      left an account that cannot sign in (ACCOUNT_DEACTIVATED, 011:105). It sets
--      is_active and clears deactivated_at together (003's
--      ward_account_deactivated_consistently CHECK), writes its own audit action,
--      'ward_account.reactivate', and returns 'reactivated'. Safe only because begin's
--      gates ran first: a facility whose agreement is withdrawn is refused
--      AGREEMENT_WITHDRAWN at begin and never reaches complete. So reactivation is
--      tied to an OPEN invite; over an accepted one it is INVITE_ALREADY_ACCEPTED.
--      Every unique violation, on the insert and on the reactivating update, is
--      named BY CONSTRAINT, never by guessing the role and never a raw 23505:
--      ward_account_one_active_per_ward -> WARD_ALREADY_HAS_AN_ACCOUNT, and
--      ward_account_one_active_operator -> OPERATOR_ALREADY_EXISTS. Any other
--      constraint is re-raised unchanged.
--
-- GRANTS ARE UNCHANGED, and so is fence 6. Both functions are CREATE OR REPLACE with
-- the same signatures and the same return type (status text; 'reactivated' is a new
-- value, not a new type). PostgreSQL keeps a replaced function's owner and ACL; the
-- owner-only revoke is re-run below anyway, as 020 did. No function is added and
-- none is public, so packages/fixtures/function-grants.json does not change, and
-- fence 6 (who can execute what) reads the same before and after the apply.
--
-- The -45 gate is unaffected: this creates no app.facility and no app.ward_account row.
--
-- Idempotency: the pre-check reads only; CREATE UNIQUE INDEX IF NOT EXISTS; CREATE OR
-- REPLACE for both functions; the revoke loop is repeatable; the ledger insert is
-- ON CONFLICT DO NOTHING.
-- ============================================================


-- ============================================================
-- 1. The pre-check: at most one active PLATFORM_ADMIN before the index exists.
-- ============================================================
DO $$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM app.ward_account WHERE role = 'PLATFORM_ADMIN' AND is_active;
    IF n > 1 THEN
        RAISE EXCEPTION 'PLATFORM_ADMIN_DUPLICATES'
              USING DETAIL = format('%s active PLATFORM_ADMIN accounts exist', n),
                    HINT = 'deactivate all but one first; a second operator needs its own ruling (BD-2 1)';
    END IF;
END $$;


-- ============================================================
-- 2. The index (BR-1 a), the shape of ward_account_one_active_per_ward (020).
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS ward_account_one_active_operator
    ON app.ward_account (role)
    WHERE role = 'PLATFORM_ADMIN' AND is_active;


-- ============================================================
-- 3. app.provision_begin: 021's body, plus the operator's 'complete' arm (BR-1 b).
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

-- ============================================================
-- 4. app.provision_complete: 020's body, with reactivation and the refusals named
--    by constraint (BR-1 c).
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

-- Owner only, as 020 left them. A replaced function keeps its ACL; this is re-run
-- so the fact is stated where the bodies change.
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
-- 5. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('022_one_operator_and_reactivation.sql', now())
ON CONFLICT (filename) DO NOTHING;
