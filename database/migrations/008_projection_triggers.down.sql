-- ============================================================
-- 008_projection_triggers.down.sql
-- ============================================================
-- Symmetric reversal of 008: triggers first (so nothing fires mid-teardown),
-- then the shim, then the projection routine.
--
-- Mirror CONTENTS are deliberately not cleared. The tables belong to 007 and its
-- down migration drops them; emptying them here would be a side effect 008 never
-- caused going forward.
-- ============================================================

DROP TRIGGER IF EXISTS trg_facility_project     ON app.facility;
DROP TRIGGER IF EXISTS trg_facility_ops_project ON app.facility_ops;
DROP TRIGGER IF EXISTS trg_ward_status_project  ON app.ward_status;

DROP FUNCTION IF EXISTS app.trg_project();
DROP FUNCTION IF EXISTS app.project_facility(uuid);

DELETE FROM app.schema_migrations WHERE filename = '008_projection_triggers.sql';
