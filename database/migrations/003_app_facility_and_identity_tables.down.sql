-- ============================================================
-- 003_app_facility_and_identity_tables.down.sql
-- ============================================================
-- Symmetric reversal of 003: triggers, then tables in reverse dependency order,
-- then the shared trigger function.
--
-- No CASCADE anywhere. A table still referenced by 004/005 raises, which is the
-- correct outcome: it means those migrations have not been reversed yet.
-- ============================================================

DROP TRIGGER IF EXISTS trg_facility_contact_touch ON app.facility_contact;
DROP TRIGGER IF EXISTS trg_facility_ops_touch     ON app.facility_ops;
DROP TRIGGER IF EXISTS trg_facility_touch         ON app.facility;

DROP TABLE IF EXISTS app.invite;
DROP TABLE IF EXISTS app.device;
DROP TABLE IF EXISTS app.facility_contact;
DROP TABLE IF EXISTS app.ward_account;
DROP TABLE IF EXISTS app.facility_ops;
DROP TABLE IF EXISTS app.facility;

-- Dropped last: 004 attaches trg_ward_status_touch and trg_system_heartbeat_touch
-- to this same function, so it cannot go until those are gone. RESTRICT (the
-- default) makes that a loud error rather than a cascade.
DROP FUNCTION IF EXISTS app.touch_updated_at();

DELETE FROM app.schema_migrations WHERE filename = '003_app_facility_and_identity_tables.sql';
