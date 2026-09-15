-- ============================================================
-- 014_publish_ward_status.down.sql
-- ============================================================
-- Symmetric reversal of 014. The function first, then the index. Dropping a
-- function drops its grants with it, so there is no separate REVOKE step.
--
-- The event and audit rows the function wrote are NOT removed, and cannot be:
-- 010 makes both tables append-only. Reversing 014 removes the ability to
-- publish; it does not rewrite history.
-- ============================================================

DROP FUNCTION IF EXISTS public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamptz);
DROP INDEX IF EXISTS app.ward_status_event_client_mutation_uidx;

DELETE FROM app.schema_migrations WHERE filename = '014_publish_ward_status.sql';
