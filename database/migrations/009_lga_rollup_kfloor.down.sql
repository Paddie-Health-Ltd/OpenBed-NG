-- ============================================================
-- 009_lga_rollup_kfloor.down.sql
-- ============================================================
-- Symmetric reversal of 009.
--
-- The rollup CONTENTS are cleared as well as the function dropped, and that is
-- deliberate rather than tidy-up: leaving aggregate rows in an anon-readable
-- table with no function left to refresh them would publish a frozen snapshot of
-- quiet facilities forever, with nothing to correct it.
-- ============================================================

DELETE FROM public.lga_rollup;

DROP FUNCTION IF EXISTS app.refresh_lga_rollup();

DELETE FROM app.schema_migrations WHERE filename = '009_lga_rollup_kfloor.sql';
