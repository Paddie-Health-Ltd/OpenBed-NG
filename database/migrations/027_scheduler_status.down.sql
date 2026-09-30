-- ============================================================
-- 027_scheduler_status.down.sql
-- ============================================================
-- FULL SYMMETRIC REVERSAL to the exact 026 state: both functions dropped, the
-- service_role grant with the function that carried it, and the ledger row removed.
-- 027 adds no table, column, job or data, so there is nothing to refuse on.
--
-- Idempotency: DROP FUNCTION IF EXISTS, RESTRICT and never CASCADE, the public wrapper
-- first because it calls the app function; the ledger DELETE matches at most one row.
-- ============================================================


-- ============================================================
-- 1. The wrapper, then the read.
-- ============================================================
DROP FUNCTION IF EXISTS public.health_probe() RESTRICT;
DROP FUNCTION IF EXISTS app.scheduler_status() RESTRICT;


-- ============================================================
-- 2. The ledger row.
-- ============================================================
DELETE FROM app.schema_migrations WHERE filename = '027_scheduler_status.sql';
