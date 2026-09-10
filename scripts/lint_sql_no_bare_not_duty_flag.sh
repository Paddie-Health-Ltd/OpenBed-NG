#!/usr/bin/env bash
# ============================================================
# scripts/lint_sql_no_bare_not_duty_flag.sh
# ============================================================
# FINDING F2, SQL SIDE. No bare `NOT <duty flag>` in any migration.
#
# The ESLint no-restricted-syntax rule in eslint.config.mjs covers the TypeScript
# mirror. THIS IS ITS SQL TWIN, and the SQL failure is the worse of the two:
#
#   `not anaesthetist` on a NULL evaluates to NULL, which is not TRUE, so the row
#   SILENTLY DROPS OUT of any filtered query -- while the JavaScript version of
#   the same expression reports it truthy. The two layers disagree and neither
#   errors.
#
# The correct forms are `= 'NO'`, `IS NOT DISTINCT FROM 'NO'`, `is false` and
# `is not false`.
#
# COMMENTS AND STRING LITERALS ARE STRIPPED BEFORE MATCHING, and that is not a
# loosening -- it is what makes the guard usable. Migration 003 carries a
# COMMENT ON COLUMN that DESCRIBES the prohibition, quoting the wrong form so a
# reader knows what to avoid. A lint that fires on its own documentation is a lint
# people delete. sed removes `'...'` literals and `--` comments first, so only
# executable SQL is matched. Line numbers are preserved because nothing is
# deleted, only blanked.
#
# NOT ASSERTED HERE, deliberately: that every duty-flag comparison is SEMANTICALLY
# correct. This is a syntactic guard against one specific wrong shape. The
# semantics are established by the 48-row truth table in
# tests/db/gate_truth_table.test.ts, run against both derivation sites.
#
# Usage: bash scripts/lint_sql_no_bare_not_duty_flag.sh [ROOT]
#   ROOT defaults to the repository root; the argument exists so
#   tests/compliance/ can aim this script at a scratch tree holding a planted
#   violation. Do not remove it because it looks unused.
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MIG_DIR="$ROOT/database/migrations"
[ -d "$MIG_DIR" ] || { echo "ERROR: no migration directory at $MIG_DIR" >&2; exit 2; }

# PORTABILITY: `mapfile` is bash 4+, and macOS ships bash 3.2.
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" | sort)
# ANTI-VACUITY: a lint that scanned nothing must fail, not report clean.
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no migrations found in $MIG_DIR" >&2; exit 2; }

DUTY='(anaesthetist|obstetrician|paediatrician)'
VIOLATIONS=0
for f in "${FILES[@]}"; do
    # `|| true` collapsed grep's exit 2 (could not run) into its 1 (no match),
    # so a file this could not read reported clean. pipefail makes $st the first
    # failure in the pipeline; only 0 and 1 are verdicts.
    st=0
    out=$(sed -e "s/'[^']*'//g" -e 's/--.*//' "$f" \
          | grep -nEi "\bNOT[[:space:]]+([a-z_]+\.)?${DUTY}\b") || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the duty-flag scan exited $st on $f -- it did not run" >&2; exit 2 ;;
    esac
    if [ -n "$out" ]; then
        echo "FAIL: bare NOT on a tri-state duty flag: $(basename "$f"):"
        echo "$out" | sed 's/^/  /'
        VIOLATIONS=$((VIOLATIONS+1))
    fi
done

[ "$VIOLATIONS" -eq 0 ] || {
    echo "lint_sql_no_bare_not_duty_flag.sh: FAILED ($VIOLATIONS file(s))"
    echo "  Duty flags are three-state. Use = 'NO' or IS NOT DISTINCT FROM 'NO'."
    exit 1
}
echo "lint_sql_no_bare_not_duty_flag.sh: PASS (${#FILES[@]} migrations)"
