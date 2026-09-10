#!/usr/bin/env bash
# ============================================================
# scripts/run_e2e.sh
# ============================================================
# The golden path in two phases: GENERATE, then GATE.
#
# PHASE 1 runs `tests/e2e/golden-path.test.ts` and is ALLOWED TO BE RED. Every
# step past the frontier is a real assertion against code a later stage brings,
# so a fully green phase 1 would mean the whole of gate 2 is delivered.
#
# PHASE 2 runs `tests/e2e/ratchet.test.ts`, which reads phase 1's junit and
# asserts the incompleteness is exactly the shape `tests/e2e/frontier.json`
# declares. THIS is the phase that gates, and it must be ZERO-RED.
#
# WHY THE `|| true` IS NOT A STANDARD O EVASION, since it looks exactly like one.
# Phase 1 is not a reported test suite -- it is CORPUS GENERATION, standing to the
# ratchet as the built bundle stands to bundle-guards, and
# `.claude/rules/test-conventions.md` section 8 is why both phases run in one job:
# a guard whose corpus is generated must generate it in the same job, or the
# ACCEPT leg is vacuous in CI while passing locally off a stale artefact.
# Nothing is hidden by the `|| true`, because phase 2 asserts PER-STEP identity
# and the named failure message: a step that regresses reds, a step that starts
# passing reds, a step that fails for a different reason than the frontier names
# reds, and an empty run reds. `continue-on-error` is banned in ci.yml and is not
# used here.
#
# Usage: bash scripts/run_e2e.sh
# Exit: whatever the ratchet exits. Phase 1's status is deliberately not the gate.
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== phase 1/2: golden path (corpus generation — expected to be partially red) ==="
npx vitest run --project e2e tests/e2e/golden-path.test.ts \
    --reporter=default --reporter=junit --outputFile=junit-e2e.xml || true

if [ ! -f "$ROOT/junit-e2e.xml" ]; then
    echo "ERROR: phase 1 produced no junit-e2e.xml — the golden path did not run at all." >&2
    echo "       The ratchet would then be gating over nothing. Fix the run, do not skip it." >&2
    exit 2
fi

echo
echo "=== phase 2/2: ratchet (the gate) ==="
npx vitest run --project e2e tests/e2e/ratchet.test.ts \
    --reporter=default --reporter=junit --outputFile=junit-ratchet.xml
RATCHET_ST=$?

echo
echo "=== Standard O attestation for the RATCHET (never for phase 1) ==="
node scripts/attest_counts.mjs junit-ratchet.xml
exit "$RATCHET_ST"
