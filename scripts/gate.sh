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
# So: one command, one exit status, nothing to misread. `bash scripts/gate.sh &&
# git commit ...` cannot proceed past a red check the way a piped grep can.
#
# Usage: bash scripts/gate.sh [--fast]
#   --fast   Skip the e2e phase, which needs a running Supabase stack.
# Exit: 0 all clear, 1 a check failed.
# ============================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

FAILED=()
run () {  # $1 label, rest: command
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then
        printf '  %-34s ok\n' "$label"
    else
        printf '  %-34s FAILED\n' "$label"
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
run "grep exit codes"    bash scripts/lint_grep_exit_codes.sh
run "audit-log columns"  bash scripts/lint_audit_log_columns.sh
[ "$FAST" -eq 1 ] || run "golden path + ratchet" npm run test:e2e

if [ "${#FAILED[@]}" -gt 0 ]; then
    echo
    echo "gate.sh: FAILED — ${#FAILED[@]} check(s) did not pass: ${FAILED[*]}"
    echo "  Re-run the named check on its own to see its output."
    exit 1
fi
echo
echo "gate.sh: PASS (all checks)"
