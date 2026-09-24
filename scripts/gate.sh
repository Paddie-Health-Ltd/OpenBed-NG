#!/usr/bin/env bash
# ============================================================
# scripts/gate.sh
# ============================================================
# Runs the local pre-merge checks and EXITS NON-ZERO if any fails.
#
# WHAT THIS IS NOT, and read this before relying on it.
#
# IT IS NOT A CONTROL. Bundle 7 already records that a pre-commit hook enforces
# nothing on a contributor's machine, and neither does this: anyone can skip it,
# and nothing makes them run it. The controls are GitHub secret-scanning push
# protection -- a repository setting enforced server-side at push time, which is
# the PREVENTION control -- and the seven required checks on `main`.
#
# WHY IT EXISTS ANYWAY. On 2026-09-10 `lint_no_secrets.sh` correctly flagged a
# new test file carrying a password-bearing Postgres URL, and the commit went
# ahead regardless, because the command sequence chained `git commit` after a
# `grep` of the test output -- and `grep` succeeds whether or not the suite did.
# The guard reached. The verdict was correct. THE PROCESS CONSUMING IT DID NOT
# ACT ON IT. That is the same shape as every defect this sweep is closing, one
# layer up in the process rather than in the code.
#
# So: one command, one exit status, nothing to misread.
#
# DO NOT INVOKE THIS DIRECTLY IN ORDER TO COMMIT. Use `bash scripts/commit.sh`,
# which runs this and commits only on exit 0. Chaining `gate.sh && git commit`
# by hand is the two-step sequence that produced the defect above, and it
# produced it a SECOND time on 2026-09-10 after this file already existed --
# the gate ran, printed FAILED, and `git commit` sat on the next line rather
# than after `&&`. A verdict something else must remember to consume is not a
# control. That is the category test-conventions.md section 8 counts to five
# instances inside this repository's own guards -- and this file plus the
# 2026-09-10 repeat are the same category one layer up, in the process.
#
# WHY `set -e`, IN A SCRIPT WHOSE JOB IS TO KEEP GOING (founder ruling
# R-2026-09-15-03). Until then this ran `set -uo pipefail`, because it reports
# every failing check rather than stopping at the first. That caught the failures
# it COUNTED and nothing else: a failed `cd`, a typo, a missing file between two
# checks ran on silently. So each check's status is now captured explicitly
# (`rc=0; "$@" || rc=$?` in run() below), which reports intended failures and
# keeps going, while `-e` aborts on anything that is not a counted check.
# tests/compliance/runner_aggregation.test.ts plants both.
#
# A LIMIT OF `-e`, observed 2026-09-15: a failing `$(...)` inside an ARGUMENT
# (`echo "x: $(false)"`) does not abort. A value this script depends on is
# assigned on its own line, where a failure does.
#
# Usage: bash scripts/gate.sh [--fast]
#   --fast   Skip the e2e phase, which needs a running Supabase stack.
# Exit: 0 all clear, 1 a check failed, other non-zero: the gate itself broke.
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAST=0
if [ "${1:-}" = "--fast" ]; then
    FAST=1
fi

FAILED=()
run () {  # $1 label, rest: command
    local label="$1"; shift
    local rc=0
    "$@" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -eq 0 ]; then
        printf '  %-34s ok\n' "$label"
    else
        printf '  %-34s FAILED (exit %s)\n' "$label" "$rc"
        FAILED+=("$label")
    fi
}

echo "gate.sh: local pre-merge checks"
run "build"              npm run build
run "typecheck"          npm run typecheck
run "eslint"             npx eslint .
run "tests (db+compliance)" npm run test
run "secret scan"        bash scripts/lint_no_secrets.sh
run "migration lints"    bash scripts/lint_migrations_all.sh
run "bundle: service-role" bash scripts/lint_no_service_role_in_bundle.sh
run "bundle: updated_at"  bash scripts/lint_no_updated_at_filter.sh
run "bundle: from-allowlist" bash scripts/lint_from_allowlist.sh
run "bundle: fonts"      bash scripts/lint_no_third_party_fonts.sh
run "grep exit codes"    bash scripts/lint_grep_exit_codes.sh
run "audit-log columns"  bash scripts/lint_audit_log_columns.sh
if [ "$FAST" -eq 0 ]; then
    run "golden path + ratchet" npm run test:e2e
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
    echo
    echo "gate.sh: FAILED — ${#FAILED[@]} check(s) did not pass: ${FAILED[*]}"
    echo "  Re-run the named check on its own to see its output."
    exit 1
fi
echo
echo "gate.sh: PASS (all checks)"
