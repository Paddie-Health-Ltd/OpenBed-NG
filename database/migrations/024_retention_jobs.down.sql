-- ============================================================
-- 024_retention_jobs.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 023 state: the three jobs unscheduled by name,
-- the three functions dropped (the third by R-2026-09-27-137 DM-2 b), 022's app.provision_complete returned VERBATIM
-- (copied from 022's file, not retyped), the two CHECKs and the login_erased_at
-- column dropped, 003's comment on app.facility_contact restored VERBATIM (copied
-- from 003's file), and the ledger row removed.
--
-- IT REFUSES WHILE ANY LOGIN IS MARKED ERASED. From the first erasure,
-- login_erased_at and its CHECK are the only thing between a reused Auth user id and
-- a silently reactivated login the privacy notice says was deleted; 022's
-- provision_complete, which this restores, would reactivate it. Reversing past an
-- erasure is a founder decision, taken by hand -- the shape of 022's
-- OPERATOR_INDEX_IN_USE.
--
-- The audit rows 'ward_account.login_erase' stay: app.audit_log is append-only
-- (010), and each satisfies 005's constraints without 024's CHECK.
--
-- Idempotency: the refusal reads only; each unschedule is guarded by name; DROP
-- FUNCTION / CONSTRAINT / COLUMN IF EXISTS; CREATE OR REPLACE; COMMENT ON replaces;
-- the ledger DELETE matches at most one row. Dropped RESTRICT, never CASCADE.
-- ============================================================


-- ============================================================
-- 0. Refuse while any login is marked erased.
-- ============================================================
DO $$
DECLARE n integer;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'app' AND table_name = 'ward_account' AND column_name = 'login_erased_at') THEN
        EXECUTE 'SELECT count(*) FROM app.ward_account WHERE login_erased_at IS NOT NULL' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'LOGINS_ERASED'
                  USING DETAIL = format('%s ward_account row(s) are marked erased; reversing 024 would drop the only guard against reactivating one. Not reversed.', n);
        END IF;
    END IF;
END $$;


-- ============================================================
-- 1. The three jobs, by name.
-- ============================================================
DO $$
DECLARE j text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        FOREACH j IN ARRAY ARRAY['openbed_check_withdrawn_facility_accounts', 'openbed_erase_lapsed_ward_logins', 'openbed_prune_ended_auth_sessions'] LOOP
            IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j AND username = current_user) THEN
                PERFORM cron.unschedule(j);
            END IF;
        END LOOP;
    END IF;
END $$;


-- ============================================================
-- 2. The three functions.
-- ============================================================
DROP FUNCTION IF EXISTS app.check_withdrawn_facility_accounts();
DROP FUNCTION IF EXISTS app.erase_lapsed_ward_logins();
DROP FUNCTION IF EXISTS app.prune_ended_auth_sessions();


-- ============================================================
-- 3. 022's app.provision_complete, verbatim.
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


-- ============================================================
-- 4. The two CHECKs and the column.
-- ============================================================
ALTER TABLE app.audit_log DROP CONSTRAINT IF EXISTS audit_log_login_erase_ward_only;
ALTER TABLE app.ward_account DROP CONSTRAINT IF EXISTS ward_account_erased_never_active;
ALTER TABLE app.ward_account DROP COLUMN IF EXISTS login_erased_at;


-- ============================================================
-- 5. 003's comment on app.facility_contact, verbatim.
-- ============================================================
COMMENT ON TABLE app.facility_contact IS
    'One invited human per facility (CMD or matron), business-contact data on a '
    'contract basis. DELIBERATELY NOT append-only -- this row must stay deletable '
    'on request, which is why 010 names it as outside the append-only set. '
    'Nothing here ever reaches app.audit_log, app.ward_status_event, or any public '
    'mirror.';


-- ============================================================
-- 6. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '024_retention_jobs.sql';
