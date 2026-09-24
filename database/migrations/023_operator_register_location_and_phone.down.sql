-- ============================================================
-- 023_operator_register_location_and_phone.down.sql
-- ============================================================
-- Reverses 023 (R-2026-09-24-98 BZ-2 c): public.operator_register() returns to 021's
-- body VERBATIM, without lat, lng and public_phone_e164, and the ledger row goes.
-- The grants are re-stated as 021 left them. No table, row or grant is otherwise
-- touched. tests/db/migration_023_round_trip.test.ts asserts the result is exactly the
-- 021 state. Never applied on hosted on anyone's own authority.
-- ============================================================


-- ============================================================
-- 1. The register, as 021 wrote it.
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
-- 2. EXECUTE: authenticated only, as 021 left it.
-- ============================================================
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
-- 3. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '023_operator_register_location_and_phone.sql';
