-- ============================================================
-- 024_retention_jobs.sql
-- ============================================================
-- THE RETENTION SCHEDULE'S TWO DATABASE JOBS, AND THE G1 COMMENT (R-2026-09-26-136
-- DL-2, issued as R-PROVISIONAL-2026-09-26-DL; DL-2 a amended by the founder the same
-- day; amended by R-2026-09-27-137 DM-1 and DM-2). The privacy notice
-- (docs/legal/privacy-notice-v1.0.md) promises two things this database must do on
-- its own:
--   * a ward's sign-in address is deleted within 30 days of its account being closed;
--   * sign-in sessions are deleted 30 days after they end.
-- Both are pg_cron jobs, run as postgres, as 017's are.
--
-- THE THRESHOLD IS 29 DAYS, AND THE RUN IS DAILY (DM-1). A daily job at a 30-day
-- threshold deletes on day 30 or 31, which breaks the notice's "within 30 days". At
-- 29 days, the first daily run after the threshold falls within 30 days of the event,
-- so every deletion lands within 30 days of it.
--
-- Empirical state at base: 001-023 applied locally; hosted at 023
-- (database/migrations/applied-hosted.json). Read locally 2026-09-27 (Supabase CLI
-- 2.117.0, gotrue v2.196.0, PostgreSQL 17.6, pg_cron 1.6.4):
--   auth.sessions.refreshed_at is timestamp WITHOUT time zone; created_at and
--     updated_at are timestamptz.
--   auth.refresh_tokens.user_id is varchar with NO foreign key; only session_id
--     references auth.sessions (ON DELETE CASCADE).
--   auth.sessions, auth.identities, auth.one_time_tokens and auth.mfa_factors
--     reference auth.users ON DELETE CASCADE. identities and one_time_tokens carry
--     the address.
--   postgres holds DELETE on auth.users, auth.sessions and auth.refresh_tokens;
--     hosted, Cowork's read-only check of 2026-09-26 observed the same three.
--
-- WHAT IT CHANGES, and nothing else:
--   1. app.ward_account.login_erased_at, and a CHECK that an erased row is never
--      active. The row stays (it holds no address: its id is the Auth user's id, and
--      that user is what is erased). The CHECK makes DL-2 b structural: an erased
--      login cannot come back by any path, the reactivate branch or a hand-run UPDATE.
--   2. app.audit_log CHECK audit_log_login_erase_ward_only. An erasure's audit row
--      names the WARD, never the account (DL-2 a as amended): 005 removed subject_id
--      because it "accepted ANY identifier: an account id", and its column guards
--      cannot see inside jsonb -- the loophole 005's own header names. For this one
--      action the CHECK admits exactly {"role": <a ward-level role>} and the ward's
--      subject, so an account id, an Auth user id or an address in new_value is
--      refused by the database.
--   3. app.erase_lapsed_ward_logins(): see its header.
--   4. app.prune_ended_auth_sessions(): see its header.
--   4b. app.check_withdrawn_facility_accounts() (DM-2): see its header.
--   5. app.provision_complete: 022's body verbatim, with one refusal added ahead of
--      the reactivate branch -- LOGIN_ERASED, hint 'provision a new login'.
--   6. Three pg_cron jobs, daily: openbed_erase_lapsed_ward_logins at 02:17 UTC,
--      openbed_prune_ended_auth_sessions at 02:27 UTC and
--      openbed_check_withdrawn_facility_accounts at 02:37 UTC.
--   7. COMMENT ON TABLE app.facility_contact, restated for G1 (the founder's
--      decision, 2026-09-26): legitimate interests, not contract. 003 is frozen, so
--      the comment changes here; database/migrations/README.md notes it beside 003.
--
-- GRANTS. The three new functions are owner-only: EXECUTE revoked from PUBLIC, anon,
-- authenticated and service_role, and packages/fixtures/function-grants.json lists
-- them with execute []. provision_complete keeps 022's ACL (CREATE OR REPLACE keeps
-- it; the revoke is re-run anyway).
--
-- NOT DONE HERE, deliberately: auth.audit_log_entries is not pruned. It stores IP
-- addresses with no pruning of its own, and it is off on hosted (Cowork's reading,
-- 2026-09-26: 0 rows while the operator has signed in). 024's runbook section reads
-- it as a fence, and any row there is a STOP to report rather than something this
-- file deletes.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS; each CHECK is dropped if it exists and
-- added again; CREATE OR REPLACE for the four functions; the revoke loop is
-- repeatable; cron.schedule upserts by name for the calling role and leaves
-- `active` as it found it (017's observation) -- the duplicate case is asserted
-- by tests/db/retention_jobs.test.ts, which applies this file twice in a
-- rolled-back transaction and counts rows per job name; COMMENT ON replaces; the
-- ledger insert is ON CONFLICT DO NOTHING.
-- ============================================================


-- ============================================================
-- 1. An erased login is marked, and an erased row is never active.
-- ============================================================
ALTER TABLE app.ward_account ADD COLUMN IF NOT EXISTS login_erased_at timestamptz;

ALTER TABLE app.ward_account DROP CONSTRAINT IF EXISTS ward_account_erased_never_active;
ALTER TABLE app.ward_account ADD CONSTRAINT ward_account_erased_never_active
    CHECK (login_erased_at IS NULL OR NOT is_active);

COMMENT ON COLUMN app.ward_account.login_erased_at IS
    'When this account''s Auth user (its sign-in address) was erased by '
    'app.erase_lapsed_ward_logins() under the retention schedule (024). An erased row '
    'is never active again (ward_account_erased_never_active); a ward that needs a '
    'login again is provisioned a new one.';


-- ============================================================
-- 2. An erasure's audit row names the ward, never the account (DL-2 a, amended).
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
-- 3. app.erase_lapsed_ward_logins()
-- ============================================================
-- For every app.ward_account below PLATFORM_ADMIN that has been deactivated for more
-- than 29 days (DM-1: the daily run then deletes within 30) and not yet erased: its Auth user is deleted, the row is marked
-- login_erased_at, and one audit row is written naming the ward. An active account
-- is never touched, and neither is a PLATFORM_ADMIN.
--
-- THE AUTH ROWS ARE DELETED EXPLICITLY, NOT BY CASCADE (DL-2 c's rule, applied here
-- too): auth.refresh_tokens.user_id has no foreign key, so deleting the user alone
-- would leave its refresh tokens. The order is refresh tokens (by user and by
-- session), sessions, then the user. identities and one_time_tokens go by their
-- ON DELETE CASCADE to auth.users, which the tests confirm locally and 024's
-- runbook section reads on hosted before the apply.
--
-- A missed withdrawal step is no longer reported here: until DM-2 this function
-- RAISEd a WARNING for it, and a WARNING inside a pg_cron job reaches only the
-- server log (observed 2026-09-27). It is app.check_withdrawn_facility_accounts()'s,
-- whose failing run cron.job_run_details records.
--
-- Returns the number of logins erased in this run.
CREATE OR REPLACE FUNCTION app.erase_lapsed_ward_logins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $FN$
DECLARE
    v_acct   record;
    v_erased integer := 0;
BEGIN
    FOR v_acct IN
        SELECT u.id, u.facility_id, u.ward_category, u.role
          FROM app.ward_account u
         WHERE u.role <> 'PLATFORM_ADMIN'
           AND NOT u.is_active
           AND u.deactivated_at < now() - interval '29 days'
           AND u.login_erased_at IS NULL
         ORDER BY u.deactivated_at
           FOR UPDATE
    LOOP
        DELETE FROM auth.refresh_tokens t
         WHERE t.user_id = v_acct.id::text
            OR t.session_id IN (SELECT s.id FROM auth.sessions s WHERE s.user_id = v_acct.id);
        DELETE FROM auth.sessions s WHERE s.user_id = v_acct.id;
        DELETE FROM auth.users a WHERE a.id = v_acct.id;

        UPDATE app.ward_account u SET login_erased_at = now() WHERE u.id = v_acct.id;

        INSERT INTO app.audit_log (facility_id, ward_category, action, new_value)
        VALUES (v_acct.facility_id, v_acct.ward_category, 'ward_account.login_erase',
                jsonb_build_object('role', v_acct.role));
        v_erased := v_erased + 1;
    END LOOP;

    RETURN v_erased;
END;
$FN$;

COMMENT ON FUNCTION app.erase_lapsed_ward_logins() IS
    'The retention schedule''s login erasure (024): deletes the Auth user of every '
    'ward_account below PLATFORM_ADMIN deactivated more than 29 days ago, marks it '
    'login_erased_at, and writes one ward-level audit row each. Run daily at 02:17 UTC '
    'by the pg_cron job openbed_erase_lapsed_ward_logins, so every login is erased '
    'within 30 days of its deactivation (R-2026-09-27-137 DM-1).';


-- ============================================================
-- 4. app.prune_ended_auth_sessions()
-- ============================================================
-- A session ends within 24 hours of its creation (the timebox) or 8 hours after its
-- last use (the inactivity timeout), but this does not rely on either setting
-- (DL-2 c): a session's end is taken as the LATER of created_at + 24 hours and its
-- last use, and it is deleted once that is more than 29 days ago -- so the daily run
-- deletes it within 30 days of its end (DM-1).
--
-- refreshed_at IS timestamp WITHOUT time zone, and GoTrue writes it in UTC. It is
-- read AT TIME ZONE 'UTC' so the comparison does not depend on the session's
-- TimeZone setting; mixing it into greatest() bare would cast it through whatever
-- TimeZone the job runs under. (A correction to DL-2 c's expression, which mixed
-- the two types.)
--
-- The sessions' refresh tokens are deleted explicitly, first; the cascade from
-- auth.sessions is not relied on.
--
-- Returns the number of sessions deleted in this run.
CREATE OR REPLACE FUNCTION app.prune_ended_auth_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $FN$
DECLARE
    v_ids    uuid[];
    v_pruned integer;
BEGIN
    SELECT coalesce(array_agg(s.id), ARRAY[]::uuid[]) INTO v_ids
      FROM auth.sessions s
     WHERE greatest(s.created_at + interval '24 hours',
                    coalesce(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at))
           < now() - interval '29 days';

    DELETE FROM auth.refresh_tokens t WHERE t.session_id = ANY (v_ids);
    DELETE FROM auth.sessions s WHERE s.id = ANY (v_ids);
    GET DIAGNOSTICS v_pruned = ROW_COUNT;
    RETURN v_pruned;
END;
$FN$;

COMMENT ON FUNCTION app.prune_ended_auth_sessions() IS
    'The retention schedule''s session pruning (024): deletes every auth.sessions row '
    '(and its refresh tokens, explicitly) whose end -- the later of created_at + 24 '
    'hours and its last use -- is more than 29 days ago. Run daily at 02:27 UTC by '
    'the pg_cron job openbed_prune_ended_auth_sessions, so every session is deleted '
    'within 30 days of its end (R-2026-09-27-137 DM-1).';


-- ============================================================
-- 4b. app.check_withdrawn_facility_accounts() (R-2026-09-27-137 DM-2 a)
-- ============================================================
-- A MISSED WITHDRAWAL STEP IS SEEN, NOT LOGGED. An account still ACTIVE at a facility
-- whose agreement was withdrawn more than 30 days ago means runbook 12.5 step 2 (the
-- deactivation) was missed. This RAISEs an EXCEPTION naming the count, so the pg_cron
-- run is recorded in cron.job_run_details as `failed`, with the message. It deletes
-- nothing and writes nothing: erasing an active login is a founder decision, not a
-- job's. Until DM-2 this was a WARNING inside the erasure, and a WARNING in a pg_cron
-- job reaches only the server log (observed locally, 2026-09-27).
--
-- Returns 0 when no such account exists.
CREATE OR REPLACE FUNCTION app.check_withdrawn_facility_accounts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $FN$
DECLARE
    v_missed integer;
BEGIN
    SELECT count(*) INTO v_missed
      FROM app.ward_account u
      JOIN app.facility_agreement a ON a.facility_id = u.facility_id
     WHERE u.is_active
       AND a.withdrawn_on < ((now() - interval '30 days') AT TIME ZONE 'UTC')::date;
    IF v_missed > 0 THEN
        RAISE EXCEPTION 'WITHDRAWN_FACILITY_ACTIVE_ACCOUNTS: % active account(s) at a facility whose agreement was withdrawn more than 30 days ago; runbook 12.5 step 2 was missed. Nothing was erased for them.', v_missed;
    END IF;
    RETURN 0;
END;
$FN$;

COMMENT ON FUNCTION app.check_withdrawn_facility_accounts() IS
    'Fails, naming the count, while any account is still active at a facility whose '
    'agreement was withdrawn more than 30 days ago (a missed runbook 12.5 step 2); '
    'deletes nothing. Run daily at 02:37 UTC by the pg_cron job '
    'openbed_check_withdrawn_facility_accounts, whose failed run cron.job_run_details '
    'records (R-2026-09-27-137 DM-2).';


-- ============================================================
-- 5. app.provision_complete: 022's body verbatim, with LOGIN_ERASED ahead of the
--    reactivate branch (DL-2 b).
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

-- Owner only: the three new functions, and provision_complete as 022 left it.
DO $$
DECLARE
    f text;
    r text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'app.check_withdrawn_facility_accounts()',
        'app.erase_lapsed_ward_logins()',
        'app.prune_ended_auth_sessions()',
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
-- 6. The three jobs. By-name cron.schedule upserts; see Idempotency above.
-- ============================================================
SELECT cron.schedule('openbed_erase_lapsed_ward_logins', '17 2 * * *', 'select app.erase_lapsed_ward_logins()');
SELECT cron.schedule('openbed_prune_ended_auth_sessions', '27 2 * * *', 'select app.prune_ended_auth_sessions()');
SELECT cron.schedule('openbed_check_withdrawn_facility_accounts', '37 2 * * *', 'select app.check_withdrawn_facility_accounts()');


-- ============================================================
-- 7. The G1 comment (the founder's decision, 2026-09-26). 003 is frozen.
-- ============================================================
COMMENT ON TABLE app.facility_contact IS
    'One invited human per facility (CMD or matron): business-contact data held on the legitimate-interests basis (NDPA s.25(1)(f)), not contract: the contact is not a party to the facility agreement (G1, founder''s decision 2026-09-26). DELIBERATELY NOT append-only -- this row must stay deletable on request, which is why 010 names it as outside the append-only set. Nothing here ever reaches app.audit_log, app.ward_status_event, or any public mirror.';


-- ============================================================
-- 8. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('024_retention_jobs.sql', now())
ON CONFLICT (filename) DO NOTHING;
