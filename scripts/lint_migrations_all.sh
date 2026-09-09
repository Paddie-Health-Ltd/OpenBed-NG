#!/usr/bin/env bash
# ============================================================
# scripts/lint_migrations_all.sh
# ============================================================
# Runs every migration lint and reports ALL failures rather than stopping at the
# first. A run that stops at the first failure makes a five-problem branch take
# five round trips.
#
# Usage: bash scripts/lint_migrations_all.sh [ROOT]
# Exit: 0 if all pass, 1 if any failed.
# ============================================================
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

LINTS=(
    lint_no_drop_cascade.sh
    lint_migration_header.sh
    lint_no_replica_identity_full.sh
    lint_sql_no_bare_not_duty_flag.sh
)

FAILED=()
for lint in "${LINTS[@]}"; do
    if ! bash "$HERE/$lint" "$ROOT"; then
        FAILED+=("$lint")
    fi
done

if [ "${#FAILED[@]}" -gt 0 ]; then
    echo
    echo "lint_migrations_all.sh: FAILED — ${FAILED[*]}"
    exit 1
fi
echo
echo "lint_migrations_all.sh: all ${#LINTS[@]} migration lints passed"
