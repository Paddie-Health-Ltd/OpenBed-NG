-- ============================================================
-- 012_indexes.down.sql
-- ============================================================
-- Symmetric reversal of 012: all seven indexes, reverse creation order.
-- ============================================================

DROP INDEX IF EXISTS app.referral_receiving_facility_state_created_idx;
DROP INDEX IF EXISTS app.audit_log_occurred_at_brin;
DROP INDEX IF EXISTS app.ward_status_event_created_at_brin;
DROP INDEX IF EXISTS app.ward_status_sweep_idx;
DROP INDEX IF EXISTS public.facility_public_lga_idx;
DROP INDEX IF EXISTS public.ward_public_updated_at_idx;
DROP INDEX IF EXISTS public.ward_public_category_accepting_idx;

DELETE FROM app.schema_migrations WHERE filename = '012_indexes.sql';
