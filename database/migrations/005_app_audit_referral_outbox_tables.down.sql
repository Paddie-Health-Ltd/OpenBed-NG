-- ============================================================
-- 005_app_audit_referral_outbox_tables.down.sql
-- ============================================================
-- Symmetric reversal of 005, in reverse dependency order:
-- notification_outbox -> alert -> referral -> audit_log.
-- ============================================================

DROP TABLE IF EXISTS app.notification_outbox;
DROP TABLE IF EXISTS app.alert;
DROP TABLE IF EXISTS app.referral;
DROP TABLE IF EXISTS app.audit_log;

DELETE FROM app.schema_migrations WHERE filename = '005_app_audit_referral_outbox_tables.sql';
