#!/usr/bin/env bash
# ============================================================
# scripts/lint_migrations_all.sh
# ============================================================
# Runs every migration lint and reports ALL failures rather than stopping at the
# first. A run that stops at the first failure makes a five-problem branch take
# five round trips.
#
# `set -e` WITH EXPLICIT CAPTURE (founder ruling R-2026-09-15-03). Reporting every
# failure needs each lint's status captured (`rc=0; bash lint || rc=$?`), not
# `-e` switched off: without `-e` a failure OUTSIDE the counted lints -- a bad
# path, a failed command between two lints -- ran on silently.
#
# Usage: bash scripts/lint_migrations_all.sh [ROOT]
# Exit: 0 if all pass, 1 if any failed, other non-zero: the aggregator broke.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

LINTS=(
    lint_no_drop_cascade.sh
    lint_migration_header.sh
    lint_no_replica_identity_full.sh
    lint_sql_no_bare_not_duty_flag.sh
    lint_public_table_rls.sh
)

FAILED=()
for lint in "${LINTS[@]}"; do
    rc=0
    bash "$HERE/$lint" "$ROOT" || rc=$?
    if [ "$rc" -ne 0 ]; then
        FAILED+=("$lint")
    fi
done

if [ "${#FAILED[@]}" -gt 0 ]; then
    echo
    echo "lint_migrations_all.sh: FAILED — one or more migration lints reported a violation: ${FAILED[*]}"
    exit 1
fi
echo
echo "lint_migrations_all.sh: all ${#LINTS[@]} migration lints passed"
