-- ============================================================
-- 028_operator_scheduler_status.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 027 state: the operator's wrapper dropped, its
-- authenticated grant with it, and the ledger row removed. app.scheduler_status() and
-- public.health_probe() are 027's and are not touched. 028 adds no table, column, job
-- or data, so there is nothing to refuse on.
--
-- Idempotency: DROP FUNCTION IF EXISTS, RESTRICT and never CASCADE; the ledger DELETE
-- matches at most one row.
-- ============================================================


-- ============================================================
-- 1. The wrapper.
-- ============================================================
DROP FUNCTION IF EXISTS public.operator_scheduler_status() RESTRICT;


-- ============================================================
-- 2. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '028_operator_scheduler_status.sql';
