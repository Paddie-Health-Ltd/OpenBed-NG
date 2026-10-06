-- ============================================================
-- 029_facility_reporting_approval.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 028 state. The operator's write goes;
-- public.operator_register() and app.provision_begin return to 026's bodies, so the
-- register loses its three keys and the gate leaves the two reporting branches; and the
-- table, with its triggers and index, and the enum go.
--
-- IT REFUSES WHILE ANY APPROVAL IS RECORDED. The forward migration inserts no row and
-- invents none; this refuses to reverse over a row it would have to lose. The table is
-- append-only by design and retained permanently (the founder's decision 1), so to reverse
-- past a recorded approval is a founder decision, taken by hand, not a script's.
--
-- The two bodies below are 026's VERBATIM, copied from that file and not retyped, so the
-- reversal restores exactly what 029 replaced. app.raise_append_only() is 010's and stays.
--
-- Idempotency: the refusal reads the table only while it exists; DROP ... IF EXISTS
-- throughout and RESTRICT, never CASCADE; CREATE OR REPLACE; the revoke loops are
-- repeatable; the ledger DELETE matches at most one row.
-- ============================================================


-- ============================================================
-- 0. Refuse while an approval is recorded.
-- ============================================================
DO $$
DECLARE
    n integer;
BEGIN
    IF to_regclass('app.facility_reporting_approval') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM app.facility_reporting_approval' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'REPORTING_APPROVALS_RECORDED'
                USING DETAIL = format('%s app.facility_reporting_approval row(s) exist; reversing 029 would lose them. Not reversed.', n);
        END IF;
    END IF;
END $$;


-- ============================================================
-- 1. The operator's write.
-- ============================================================
DROP FUNCTION IF EXISTS public.operator_record_reporting_approval(text, text, date, text) RESTRICT;


-- ============================================================
-- 2. public.operator_register(): 026's body, verbatim.
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
-- 3. app.provision_begin: 026's body, verbatim.
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
-- 4. The table (its triggers and index go with it), then the enum.
-- ============================================================
DROP TABLE IF EXISTS app.facility_reporting_approval RESTRICT;
DROP TYPE IF EXISTS app.reporting_model RESTRICT;


-- ============================================================
-- 5. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '029_facility_reporting_approval.sql';
