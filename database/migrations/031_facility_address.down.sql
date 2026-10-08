-- ============================================================
-- 031_facility_address.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 030 state (R-2026-09-30-214 GN): the two replaced operator
-- functions return to the seven- and eight-argument shapes 020 wrote, with 020's bodies
-- verbatim; app.project_facility() is 021's body, public.operator_register() is 029's, and
-- app.regenerate_snapshot() is 019's, each verbatim; the address column goes from both tables,
-- with its CHECK; and the ledger row goes.
--
-- Order matters. The functions that NAME the address column are restored BEFORE the column is
-- dropped, so no live function ever references a column that is gone.
--
-- DESTRUCTIVE: dropping the columns discards every address entered. It exists so the migration
-- sequence is reversible in development and CI, where the database is rebuilt from zero.
-- Running it against a database that holds real addresses loses them.
--
-- Idempotency: DROP FUNCTION IF EXISTS, CREATE OR REPLACE, DROP CONSTRAINT IF EXISTS and
-- DROP COLUMN IF EXISTS throughout; the revoke/grant block is repeatable; the ledger DELETE
-- matches at most one row. No CASCADE is used anywhere: a dependent object makes the drop fail
-- loudly rather than going with it.
-- ============================================================

-- a. The new operator functions go, and 020's come back.
DROP FUNCTION IF EXISTS public.operator_create_facility(text, text, text, text, double precision, double precision, text, text);
DROP FUNCTION IF EXISTS public.operator_edit_facility(text, integer, text, text, text, double precision, double precision, text, text);

CREATE OR REPLACE FUNCTION public.operator_create_facility(
    p_id                text,
    p_name              text,
    p_lga               text,
    p_state             text,
    p_lat               double precision,
    p_lng               double precision,
    p_public_phone_e164 text
)
RETURNS TABLE (facility_id uuid, version integer, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid     uuid := app.assert_operator();
    v_session uuid := app.operator_session(v_uid);
    v_id      uuid;
    v_new     uuid;
    v_old     app.facility;
BEGIN
    BEGIN
        v_id := p_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_id';
    END;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_id';
    END IF;

    -- J2: the client-generated id is the idempotency key. ON CONFLICT DO NOTHING
    -- means a concurrent double submit waits on the key rather than surfacing 23505.
    INSERT INTO app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    VALUES (v_id, p_name, p_lga, p_state, p_lat, p_lng, p_public_phone_e164, NULL)
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_new;

    IF v_new IS NULL THEN
        SELECT * INTO v_old FROM app.facility f WHERE f.id = v_id;
        IF v_old.name IS DISTINCT FROM p_name OR v_old.lga IS DISTINCT FROM p_lga
           OR v_old.state IS DISTINCT FROM p_state OR v_old.lat IS DISTINCT FROM p_lat
           OR v_old.lng IS DISTINCT FROM p_lng
           OR v_old.public_phone_e164 IS DISTINCT FROM p_public_phone_e164 THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'
                  USING DETAIL = 'this facility id already exists with different fields';
        END IF;
        RETURN QUERY SELECT v_old.id, v_old.version, false;
        RETURN;
    END IF;

    -- The duty-flags row in the same transaction, every flag UNKNOWN. A facility
    -- with no row reads as ungated through 006's LEFT JOIN; this makes the unknown
    -- explicit rather than absent.
    INSERT INTO app.facility_ops (facility_id) VALUES (v_id);

    INSERT INTO app.audit_log (facility_id, action, new_value, version, session_id)
    VALUES (v_id, 'facility.create',
            jsonb_build_object('fields', jsonb_build_array('name', 'lga', 'state', 'lat', 'lng', 'public_phone_e164'),
                               'listed', false),
            1, v_session);

    RETURN QUERY SELECT v_id, 1, true;
END;
$FN$;

CREATE OR REPLACE FUNCTION public.operator_edit_facility(
    p_facility_id       text,
    p_expected_version  integer,
    p_name              text,
    p_lga               text,
    p_state             text,
    p_lat               double precision,
    p_lng               double precision,
    p_public_phone_e164 text
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
    v_fields  jsonb := '[]'::jsonb;
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
    -- J1: the integer version, compared exactly. Never updated_at.
    IF v_old.version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'VERSION_CONFLICT' USING DETAIL = format('current_version=%s', v_old.version);
    END IF;

    IF v_old.name IS DISTINCT FROM p_name THEN v_fields := v_fields || '"name"'; END IF;
    IF v_old.lga IS DISTINCT FROM p_lga THEN v_fields := v_fields || '"lga"'; END IF;
    IF v_old.state IS DISTINCT FROM p_state THEN v_fields := v_fields || '"state"'; END IF;
    IF v_old.lat IS DISTINCT FROM p_lat THEN v_fields := v_fields || '"lat"'; END IF;
    IF v_old.lng IS DISTINCT FROM p_lng THEN v_fields := v_fields || '"lng"'; END IF;
    IF v_old.public_phone_e164 IS DISTINCT FROM p_public_phone_e164 THEN v_fields := v_fields || '"public_phone_e164"'; END IF;

    UPDATE app.facility f
       SET name = p_name, lga = p_lga, state = p_state, lat = p_lat, lng = p_lng,
           public_phone_e164 = p_public_phone_e164
     WHERE f.id = v_id
    RETURNING f.version INTO v_version;

    INSERT INTO app.audit_log (facility_id, action, old_value, new_value, version, session_id)
    VALUES (v_id, 'facility.edit',
            jsonb_build_object('version', v_old.version),
            jsonb_build_object('fields', v_fields, 'version', v_version),
            v_version, v_session);

    RETURN QUERY SELECT v_id, v_version;
END;
$FN$;

DO $$
DECLARE
    f text;
    r text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.operator_create_facility(text, text, text, text, double precision, double precision, text)',
        'public.operator_edit_facility(text, integer, text, text, text, double precision, double precision, text)'
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
END $$;


-- b. The projection, the register and the snapshot generator return to their predecessors.
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
           AND EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NULL)
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

CREATE OR REPLACE FUNCTION app.regenerate_snapshot()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $FN$
DECLARE
    v_now         timestamptz := now();
    v_v           bigint;
    v_facilities  jsonb;
    v_wards       jsonb;
    v_fac_read    bigint;
    v_ward_read   bigint;
BEGIN
    -- ONE READ: both mirrors, in one statement, so both come from one snapshot
    -- (019). Each is still counted from its own read, and the counts below
    -- still refuse an encode-side edit that drops rows.
    WITH fsrc AS MATERIALIZED (
        SELECT * FROM public.facility_public
    ), fenc AS (
        SELECT coalesce(jsonb_agg(jsonb_build_array(
                   fsrc.facility_id, fsrc.name, fsrc.lga, fsrc.state, fsrc.lat, fsrc.lng,
                   fsrc.public_phone_e164, fsrc.updated_at
               ) ORDER BY fsrc.facility_id), '[]'::jsonb) AS rows
          FROM fsrc
    ), src AS MATERIALIZED (
        SELECT * FROM public.ward_public
    ), enc AS (
        SELECT coalesce(jsonb_agg(jsonb_build_array(
                   src.facility_id, src.category, src.offering, src.bed_count,
                   src.accepting_effective, src.gated_by, src.state, src.source,
                   src.monitoring_state, src.updated_at
               ) ORDER BY src.facility_id, src.category), '[]'::jsonb) AS rows
          FROM src
    )
    SELECT (SELECT count(*) FROM fsrc), fenc.rows, (SELECT count(*) FROM src), enc.rows
      INTO v_fac_read, v_facilities, v_ward_read, v_wards
      FROM fenc, enc;

    IF jsonb_array_length(v_facilities) <> v_fac_read THEN
        RAISE EXCEPTION 'SNAPSHOT_ROWS_DROPPED'
              USING ERRCODE = 'P0001',
                    DETAIL  = format('public.facility_public read %s rows; the payload encoded %s',
                                     v_fac_read, jsonb_array_length(v_facilities));
    END IF;
    IF jsonb_array_length(v_wards) <> v_ward_read THEN
        RAISE EXCEPTION 'SNAPSHOT_ROWS_DROPPED'
              USING ERRCODE = 'P0001',
                    DETAIL  = format('public.ward_public read %s rows; the payload encoded %s',
                                     v_ward_read, jsonb_array_length(v_wards));
    END IF;

    -- WRITE 1: the snapshot row. v from the identity sequence, carried into the
    -- payload so the edge file names its own version.
    v_v := nextval(pg_catalog.pg_get_serial_sequence('public.snapshot_current', 'v'));
    INSERT INTO public.snapshot_current (v, generated_at, payload)
    OVERRIDING SYSTEM VALUE
    VALUES (
        v_v,
        v_now,
        jsonb_build_object(
            'v',            v_v,
            'generated_at', v_now,
            'server_now',   v_now,
            'facilities',   v_facilities,
            'wards',        v_wards
        )
    );

    -- WRITE 2: the heartbeat, in the same transaction, so a regeneration can
    -- never be claimed that did not commit.
    UPDATE app.system_heartbeat SET last_snapshot_at = v_now WHERE id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SNAPSHOT_HEARTBEAT_MISSING'
              USING ERRCODE = 'P0001',
                    DETAIL  = 'app.system_heartbeat has no row; 004 seeds one';
    END IF;

    -- WRITE 1, continued: prune past the window, in the same transaction.
    DELETE FROM public.snapshot_current
     WHERE generated_at < v_now - app.snapshot_retention();

    RETURN v_v;
END;
$FN$;

REVOKE ALL ON FUNCTION app.regenerate_snapshot() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION app.regenerate_snapshot() FROM %I', r);
        END IF;
    END LOOP;
END $$;


-- c. The column and its CHECK, now that nothing names them.
ALTER TABLE app.facility DROP CONSTRAINT IF EXISTS facility_address_form;
ALTER TABLE public.facility_public DROP COLUMN IF EXISTS address;
ALTER TABLE app.facility DROP COLUMN IF EXISTS address;

DELETE FROM app.schema_migrations WHERE filename = '031_facility_address.sql';
