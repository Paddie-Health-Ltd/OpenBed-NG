-- ============================================================
-- 004_app_ward_status_tables.down.sql
-- ============================================================
-- Symmetric reversal of 004. Triggers first, then tables in reverse dependency
-- order. app.touch_updated_at() is NOT dropped here -- 003 created it and 003's
-- down migration owns it.
-- ============================================================

DROP TRIGGER IF EXISTS trg_system_heartbeat_touch ON app.system_heartbeat;
DROP TRIGGER IF EXISTS trg_ward_status_touch      ON app.ward_status;

DROP TABLE IF EXISTS app.system_heartbeat;
DROP TABLE IF EXISTS app.ward_alert_state;
DROP TABLE IF EXISTS app.challenge;
DROP TABLE IF EXISTS app.ward_status_event;
DROP TABLE IF EXISTS app.ward_status;

DELETE FROM app.schema_migrations WHERE filename = '004_app_ward_status_tables.sql';
