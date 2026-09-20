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

# PHASE 1 RUNS THE DIRECTORY, NOT A NAME (R-2026-09-20-30 C2).
#
# Until 2026-09-20 this line named `tests/e2e/golden-path.test.ts` and phase 2 named
# `tests/e2e/ratchet.test.ts`. Any OTHER file in tests/e2e/ was therefore never
# executed -- by CI or by anyone -- while the required `golden-path` check reported
# success. A test that does not run reports exactly what a test that ran and passed
# reports, and this harness was the thing deciding which ones ran. It is the
# green-light-examining-nothing shape inside the runner itself.
#
# So the corpus is now DISCOVERED: every tests/e2e/*.test.ts except the ratchet,
# which is phase 2 and must not also be phase 1's input. Adding a file to that
# directory is enough to make it run.
E2E_FILES=()
while IFS= read -r _f; do E2E_FILES+=("$_f"); done < <(
    find "$ROOT/tests/e2e" -maxdepth 1 -type f -name '*.test.ts' ! -name 'ratchet.test.ts' 2>/dev/null | sort
)

# THE TWO LOAD-BEARING FILES ARE ASSERTED TO EXIST. This also subsumes an
# empty-corpus check: golden-path.test.ts is itself a phase-1 file, so a corpus of
# zero is impossible once this passes. A separate empty-corpus branch would be a leg
# no plant could ever reach, which is its own defect (test-conventions section 2b). Discovery alone would turn a
# deleted golden path into a smaller, greener run: the ratchet would gate over a
# corpus that no longer contains the steps it ratchets. Missing is fatal and named.
for _required in tests/e2e/golden-path.test.ts tests/e2e/ratchet.test.ts; do
    if [ ! -f "$ROOT/$_required" ]; then
        echo "ERROR: $_required is missing — the golden path and the ratchet are named in the frontier and in this runner." >&2
        echo "       A run without it is smaller and greener, not passing. Restore it or change the frontier deliberately." >&2
        exit 2
    fi
done

echo "=== phase 1/2: golden path (corpus generation — expected to be partially red) ==="
echo "    phase 1 corpus (${#E2E_FILES[@]} file(s)):"
printf '      %s\n' "${E2E_FILES[@]}"
npx vitest run --project e2e "${E2E_FILES[@]}" \
    --reporter=default --reporter=junit --outputFile=junit-e2e.xml || true

if [ ! -f "$ROOT/junit-e2e.xml" ]; then
    echo "ERROR: phase 1 produced no junit-e2e.xml — the golden path did not run at all." >&2
    echo "       The ratchet would then be gating over nothing. Fix the run, do not skip it." >&2
    exit 2
fi

echo
echo "=== phase 2/2: ratchet (the gate) ==="
# CAPTURE, DO NOT LET `set -e` ABORT. This was `<vitest>` on one line and
# `RATCHET_ST=$?` on the next -- and under `set -e` that assignment is
# UNREACHABLE whenever vitest fails, so RATCHET_ST was always 0 and the Standard
# O attestation below was skipped on exactly the runs that needed it. The gate
# still held, but only by `set -e` propagation: one `|| true` on the vitest line
# would have turned it green with nothing to show. Same idiom as the grep fix --
# capture the status, then act on it.
RATCHET_ST=0
npx vitest run --project e2e tests/e2e/ratchet.test.ts \
    --reporter=default --reporter=junit --outputFile=junit-ratchet.xml || RATCHET_ST=$?

echo
echo "=== Standard O attestation for the RATCHET (never for phase 1) ==="
node scripts/attest_counts.mjs junit-ratchet.xml
exit "$RATCHET_ST"
