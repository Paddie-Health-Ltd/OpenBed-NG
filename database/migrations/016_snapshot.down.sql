-- ============================================================
-- 016_snapshot.down.sql
-- ============================================================
-- Symmetric reversal of 016: drop the generator, the retention constant and
-- public.snapshot_current, and remove app.system_heartbeat.last_snapshot_at.
--
-- Every stored snapshot is lost. That is what a symmetric reversal means; the
-- edge keeps serving its last file until it expires, and the heartbeat column
-- that would have shown the generator stopping is gone with it.
-- ============================================================

DROP FUNCTION IF EXISTS app.regenerate_snapshot();
DROP FUNCTION IF EXISTS app.snapshot_retention();

DROP TABLE IF EXISTS public.snapshot_current;

ALTER TABLE app.system_heartbeat DROP COLUMN IF EXISTS last_snapshot_at;

DELETE FROM app.schema_migrations WHERE filename = '016_snapshot.sql';
