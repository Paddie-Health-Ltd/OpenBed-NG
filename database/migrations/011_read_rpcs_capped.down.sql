-- ============================================================
-- 011_read_rpcs_capped.down.sql
-- ============================================================
-- Symmetric reversal of 011. Public RPCs first (they call assert_member), then
-- assert_member itself. Dropping a function drops its grants with it, so there is
-- no separate REVOKE step.
-- ============================================================

DROP FUNCTION IF EXISTS public.ward_status_history(app.ward_category, timestamptz, integer);
DROP FUNCTION IF EXISTS public.my_facility_wards();
DROP FUNCTION IF EXISTS app.assert_member(uuid, app.app_role);

DELETE FROM app.schema_migrations WHERE filename = '011_read_rpcs_capped.sql';
