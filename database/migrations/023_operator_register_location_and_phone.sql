-- ============================================================
-- 023_operator_register_location_and_phone.sql
-- ============================================================
-- Bundle 3, PR 3.4b-app C (R-2026-09-24-98 BZ-2, issued as R-PROVISIONAL-2026-09-24-BZ).
-- The admin app's edit form could not show a facility's saved latitude, longitude or
-- public phone: no operator read returned them, so the form made the operator retype
-- all three to fix any field. public_phone_e164 is the number the public page shows
-- for an emergency call, and a retype can silently change it; a mistyped latitude or
-- longitude silently moves the facility (BZ-1). The root cause is that the page cannot
-- see what is saved, so this shows it.
--
-- WHAT IT CHANGES, and nothing else: public.operator_register() gains three keys on
-- each facility object -- lat, lng and public_phone_e164 -- inserted after 'state'.
-- The body is 021's verbatim with those three lines added; the signature, the return
-- type (jsonb), the ORDER BY, the envelope and every other key are untouched.
-- tests/db/migration_023_round_trip.test.ts asserts the body is 021's with exactly
-- those three lines inserted.
--
-- NO NEW PERSONAL DATA IS EXPOSED. All three are already PUBLIC OUTPUT for a listed
-- facility: app.project_facility writes lat, lng and public_phone_e164 into
-- public.facility_public (008:109-110), and the snapshot's facility columns carry the
-- same three (packages/fixtures/snapshot-shape.json). They are facility facts, not a
-- person's: the contact's details stay behind operator_get_contact, unchanged. And the
-- register is readable only by the one active operator (app.assert_operator).
--
-- GRANTS ARE UNCHANGED, and so is fence 6. CREATE OR REPLACE with the same signature
-- keeps the function's owner and ACL; the revoke-then-grant below re-runs 021's
-- section 7 loop for this one signature anyway, idempotently, so the fact is stated
-- where the body changes. packages/fixtures/function-grants.json does not change
-- (public.operator_register() stays EXECUTE: authenticated), so fence 6 -- who can
-- execute what, read by scripts/readback_function_grants.sh -- reads the same before
-- and after the apply.
--
-- The -45 gate is unaffected: this writes no row of any table.
--
-- Idempotency: CREATE OR REPLACE; the grant block is repeatable; the ledger insert is
-- ON CONFLICT DO NOTHING.
-- ============================================================


-- ============================================================
-- 1. The register, with each facility's location and public phone.
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
-- 3. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('023_operator_register_location_and_phone.sql', now())
ON CONFLICT (filename) DO NOTHING;
