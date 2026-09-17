#!/usr/bin/env bash
# ============================================================
# scripts/lint_sql_no_bare_not_duty_flag.sh
# ============================================================
# FINDING F2, SQL SIDE. No bare `NOT <duty flag>` in any migration.
#
# The ESLint no-restricted-syntax rule in eslint.config.mjs covers the TypeScript
# mirror. THIS IS ITS SQL TWIN.
#
# WHAT IT ACTUALLY CATCHES, restated 2026-09-17 (R-2026-09-17-04). This header used
# to justify the guard by the silent-drop hazard: `not anaesthetist` on a NULL
# evaluates to NULL, so the row drops out of a filtered query while JavaScript
# reports it truthy. That is the failure of a NULLABLE BOOLEAN -- the shape finding
# F2 rejected. The duty flags are `app.tri_state NOT NULL`, and against that type
# a bare NOT does not drop anything: it does not compile. Observed on local
# PostgreSQL 17.6: "argument of NOT must be type boolean, not type app.tri_state".
#
# So the shape this lint matches cannot reach production today; the type system
# refuses it first. It is guarded anyway, for two reasons that do hold:
#   - the column type is a decision, and a future migration could undo it -- a
#     boolean or nullable flag, or a cast, brings the silent drop straight back;
#   - the JavaScript half of the divergence is still live and still silent
#     (`!flag` compiles), which is what eslint.config.mjs guards.
#
# THE CORRECT FORM is `IS NOT DISTINCT FROM 'NO'`, and its complement is
# `IS DISTINCT FROM 'NO'`. Both are total: they never yield NULL.
#   - `= 'NO'` selects the same rows in positive position, including in a WHERE
#     clause or a CASE arm, because NULL and false both skip. It is acceptable
#     ONLY there. Negated -- `<> 'NO'`, `NOT (x = 'NO')` -- it yields NULL for a
#     NULL flag expression (an outer join with no ops row, say) and the row
#     silently drops, which is the hazard this guard exists for, by the front
#     door. Observed 2026-09-17 over YES/UNKNOWN/NO/NULL: `<> 'NO'` returned
#     YES,UNKNOWN; `IS DISTINCT FROM 'NO'` returned YES,UNKNOWN,NULL.
#   - `is false` / `is not false` are NOT correct forms, and this list named them
#     until 2026-09-17. They do not compile against the enum ("argument of IS
#     FALSE must be type boolean").
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
# semantics are established by the 60-row truth table (3 flag states x 10
# categories x 2 claim values) in tests/db/gate_truth_table.test.ts, run against
# both derivation sites.
#
# NOT ASSERTED HERE either: the negated-equality forms `NOT (anaesthetist = 'NO')`
# and `anaesthetist <> 'NO'`. The pattern requires NOT immediately before a flag
# identifier, so neither matches, and both are the silent drop on a NULL flag
# expression (see THE CORRECT FORM above). Nothing in this repository catches them.
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
    echo "  Duty flags are three-state. Use IS NOT DISTINCT FROM 'NO', or IS DISTINCT FROM 'NO' for the complement."
    exit 1
}
echo "lint_sql_no_bare_not_duty_flag.sh: PASS (${#FILES[@]} migrations)"
