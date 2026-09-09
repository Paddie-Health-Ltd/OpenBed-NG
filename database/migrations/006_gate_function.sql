-- ============================================================
-- 006_gate_function.sql
-- ============================================================
-- Sprint 1, Bundle 1. THE SINGLE DERIVATION SITE for the duty-cover safety gate.
--
-- Empirical state at base: 001-005 applied. app.tri_state, app.ward_category and
-- app.gate_reason exist (002). app.facility_ops exists with three tri_state
-- columns, each NOT NULL DEFAULT 'UNKNOWN' (003 section 3).
--
-- WHAT THIS FUNCTION IS FOR (finding F1).
--   A ward's `accepting` flag is the ward's own claim and is stored untouched
--   forever in app.ward_status. The safety gate -- anaesthetist off duty closes
--   Theatre and Surgical, paediatrician closes NICU and SCBU, obstetrician
--   closes Maternity -- is derived at READ time, HERE, in exactly one place, and
--   written only into the public projection by 008.
--
--   THE GATE REDUCES ONLY. A 'YES' can never promote a ward that said it is not
--   accepting. accepting_effective = accepting AND gate IS NULL, which is
--   monotone in exactly one direction by construction.
--
-- WHY NOT A TRIGGER ON app.ward_status: the anaesthetist goes off duty at 22:00
-- and the trigger clobbers the ward's claim; at 06:00 they are back and there is
-- nothing to restore, because the claim was destroyed.
-- WHY NOT A GENERATED COLUMN: a generated column cannot read another table.
-- WHY NOT APPLICATION-LAYER ONLY: that is a rendering preference, not a safety
-- rule, and it drifts the moment a second reader exists.
--
-- SIGNATURE -- A DELIBERATE DEVIATION FROM THE KICKOFF'S LITERAL `gate(category, ops)`.
--   Three scalar tri_state arguments, not a composite app.facility_ops row type.
--   A composite argument changes this function's signature every time a column is
--   added to that table, which is hostile to IMMUTABLE and to a TypeScript
--   mirror, and forces every test to build a full table row to exercise one
--   branch. app.gate_for_facility() below restores the ergonomic form for the
--   trigger. Semantics are identical.
--
-- THE MIRROR. packages/gate/src/gate.ts implements this function again, in
-- TypeScript, for the client. The two are asserted against ONE fixture
-- (packages/fixtures/truth-table.json) inside ONE test.each block in
-- tests/db/gate_truth_table.test.ts. Two blocks could be edited apart, skipped
-- apart, and drift while both stayed green. If you change the mapping here,
-- change it there in the same commit -- and the truth table will fail until you
-- do.
--
-- Idempotency: CREATE OR REPLACE FUNCTION. Re-apply is a no-op.
--
-- Deployment ordering gate: 008's projection trigger calls
-- app.gate_for_facility(). This file must land first, and it does by number.
--
-- Object ledger -- 2 functions:
--   app.gate(ward_category, tri_state, tri_state, tri_state) -> gate_reason  IMMUTABLE
--   app.gate_for_facility(ward_category, uuid)               -> gate_reason  STABLE
--   Both: SET search_path = '', EXECUTE revoked from PUBLIC.
-- ============================================================


-- ============================================================
-- 1. app.gate() -- the derivation.
-- ============================================================
CREATE OR REPLACE FUNCTION app.gate(
    p_category      app.ward_category,
    p_anaesthetist  app.tri_state,
    p_obstetrician  app.tri_state,
    p_paediatrician app.tri_state
)
RETURNS app.gate_reason
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
-- A caller-controlled search_path against a function other code depends on is
-- privilege escalation. Empty, with every name fully qualified.
SET search_path = ''
AS $FN$
    -- FINDING F2, IN ITS SQL FORM.
    --
    -- `IS NOT DISTINCT FROM 'NO'` rather than `= 'NO'`, and NEVER a bare NOT.
    --
    -- The columns feeding this are NOT NULL, so in normal operation the two
    -- forms agree. They diverge exactly when an argument arrives NULL -- from an
    -- outer join against a facility with no ops row, say -- and then `= 'NO'`
    -- yields NULL, a CASE arm that is not TRUE is skipped, and the branch is
    -- silently not taken. IS NOT DISTINCT FROM is total: it returns false for
    -- NULL and the row gets the ungated answer, which is the safe direction and,
    -- more importantly, the SAME answer the TypeScript mirror gives.
    --
    -- The failure this forecloses is not "the gate is wrong". It is "the gate is
    -- wrong in SQL only, while the client says something else, and neither
    -- errors."
    SELECT CASE
        WHEN p_category IN ('THEATRE', 'SURGICAL')
             AND p_anaesthetist IS NOT DISTINCT FROM 'NO'::app.tri_state
            THEN 'NO_ANAESTHETIST_ON_DUTY'::app.gate_reason

        -- All four paediatric-facing categories. DEFAULT PENDING CLINICIAN
        -- CONFIRMATION: transcription of the existing rule to the categories
        -- added 2026-09-09, not a new rule. A paediatric ICU with no
        -- paediatrician on duty is not paediatric capacity, by the argument that
        -- gates Theatre on the anaesthetist. Whether one flag is the right
        -- granularity across neonatal and paediatric intensive care is open;
        -- one flag is the conservative reading and preserves current behaviour.
        WHEN p_category IN ('NICU', 'SCBU', 'PAEDIATRIC', 'ICU_PAEDIATRIC')
             AND p_paediatrician IS NOT DISTINCT FROM 'NO'::app.tri_state
            THEN 'NO_PAEDIATRICIAN_ON_DUTY'::app.gate_reason

        WHEN p_category = 'MATERNITY'
             AND p_obstetrician IS NOT DISTINCT FROM 'NO'::app.tri_state
            THEN 'NO_OBSTETRICIAN_ON_DUTY'::app.gate_reason

        -- A_AND_E, ICU_ADULT and MEDICAL_ADULT are ungated: no duty flag closes
        -- them.
        -- 'UNKNOWN' and 'YES' both fall through to NULL for every category --
        -- that is the whole of finding F2. On day one every flag in the system is
        -- 'UNKNOWN', and this arm is what keeps every hospital in Lagos open.
        ELSE NULL
    END;
$FN$;

COMMENT ON FUNCTION app.gate(app.ward_category, app.tri_state, app.tri_state, app.tri_state) IS
    'The single derivation site for the duty-cover safety gate. Returns a '
    'gate_reason when the category is closed by an explicit NO on the relevant '
    'duty flag, else NULL. UNKNOWN and YES both return NULL. Reduces only -- it '
    'can never promote a ward that said it is not accepting. Mirrored in '
    'packages/gate/src/gate.ts; the two are asserted against one fixture in one '
    'test block so they cannot drift.';


-- ============================================================
-- 2. app.gate_for_facility() -- ergonomic wrapper for the trigger.
-- ============================================================
-- STABLE, not IMMUTABLE: it reads a table.
--
-- LEFT JOIN semantics matter. A facility with no app.facility_ops row yields
-- three NULLs, which app.gate() treats as ungated. That is correct and
-- deliberate: a facility that has never recorded duty cover has not said anyone
-- is off duty, and the absence of a claim must never read as a negative claim.
-- It is the table-level restatement of the tri-state rule.
CREATE OR REPLACE FUNCTION app.gate_for_facility(
    p_category    app.ward_category,
    p_facility_id uuid
)
RETURNS app.gate_reason
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = ''
AS $FN$
    SELECT app.gate(
        p_category,
        ops.anaesthetist,
        ops.obstetrician,
        ops.paediatrician
    )
    FROM (SELECT p_facility_id AS fid) f
    LEFT JOIN app.facility_ops ops ON ops.facility_id = f.fid;
$FN$;

COMMENT ON FUNCTION app.gate_for_facility(app.ward_category, uuid) IS
    'app.gate() applied to a facility''s current duty flags. A facility with no '
    'facility_ops row is ungated: no recorded cover is not the same as recorded '
    'absence of cover.';


-- ============================================================
-- 3. Grants.
-- ============================================================
-- 001 already revoked ALL on functions in `app` from anon, authenticated and
-- PUBLIC via ALTER DEFAULT PRIVILEGES. Restated explicitly because a default
-- privilege applies only to objects created by the role that set it (see the
-- KNOWN LIMIT in 001's header), and because an explicit revocation is auditable
-- by tests/db/rls_rpc_execute_allowlist.test.ts without that test having to
-- reason about who owns what.
REVOKE ALL ON FUNCTION app.gate(app.ward_category, app.tri_state, app.tri_state, app.tri_state) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.gate_for_facility(app.ward_category, uuid) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION app.gate(app.ward_category, app.tri_state, app.tri_state, app.tri_state) FROM anon';
        EXECUTE 'REVOKE ALL ON FUNCTION app.gate_for_facility(app.ward_category, uuid) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION app.gate(app.ward_category, app.tri_state, app.tri_state, app.tri_state) FROM authenticated';
        EXECUTE 'REVOKE ALL ON FUNCTION app.gate_for_facility(app.ward_category, uuid) FROM authenticated';
    END IF;
END $$;


-- ============================================================
-- 4. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('006_gate_function.sql', now())
ON CONFLICT (filename) DO NOTHING;
