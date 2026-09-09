-- ============================================================
-- 006_gate_function.down.sql
-- ============================================================
-- Symmetric reversal of 006. The wrapper is dropped before the function it
-- calls. RESTRICT (the default) means a still-attached 008 trigger raises rather
-- than being silently cascaded away.
-- ============================================================

DROP FUNCTION IF EXISTS app.gate_for_facility(app.ward_category, uuid);
DROP FUNCTION IF EXISTS app.gate(app.ward_category, app.tri_state, app.tri_state, app.tri_state);

DELETE FROM app.schema_migrations WHERE filename = '006_gate_function.sql';
