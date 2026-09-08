-- ============================================================
-- 002_enums.down.sql
-- ============================================================
-- Symmetric reversal of 002: drop all 14 types in reverse creation order.
--
-- RESTRICT (the Postgres default for DROP TYPE) is relied on rather than
-- CASCADE. A type still referenced by a column raises, which is correct: it
-- means 003..013 have not been reversed yet, and reversing this file first would
-- otherwise drop columns out from under tables through a cascade nobody asked
-- for.
--
-- Ledger row is removed last so a failed drop leaves the migration still
-- recorded as applied -- the ledger must never claim a reversal that did not
-- complete.
-- ============================================================

DROP TYPE IF EXISTS app.notification_channel;
DROP TYPE IF EXISTS app.alert_state;
DROP TYPE IF EXISTS app.alert_cause;

DROP TYPE IF EXISTS app.refusal_reason;
DROP TYPE IF EXISTS app.referral_state;

DROP TYPE IF EXISTS app.app_role;

DROP TYPE IF EXISTS app.status_source;
DROP TYPE IF EXISTS app.status_state;

DROP TYPE IF EXISTS app.zero_reason;

DROP TYPE IF EXISTS app.monitoring_state;
DROP TYPE IF EXISTS app.ward_offering;

DROP TYPE IF EXISTS app.gate_reason;
DROP TYPE IF EXISTS app.ward_category;
DROP TYPE IF EXISTS app.tri_state;

DELETE FROM app.schema_migrations WHERE filename = '002_enums.sql';
