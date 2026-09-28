#!/usr/bin/env bash
# ============================================================
# scripts/lint_sql_no_bare_not_duty_flag.sh
# ============================================================
# FINDING F2, SQL SIDE. No bare `NOT <duty flag>`, and no negated equality on a
# duty flag, in any migration. .down files included.
#
# The ESLint no-restricted-syntax rule in eslint.config.mjs covers the TypeScript
# mirror. THIS IS ITS SQL TWIN.
#
# TWO PASSES PER FILE since R-2026-09-28-162 (EL-1). The name predates pass B and
# is kept: renaming a guard cited across the record buys nothing but churn.
#
#   PASS A -- the bare NOT. String literals blanked, `--` comments stripped.
#   PASS B -- the negated equality. `--` comments stripped, LITERALS KEPT, because
#     the thing matched is `'NO'`. Pass A's pattern cannot run on literal-kept
#     text: it would fire on 003:179's COMMENT ON COLUMN, which quotes
#     `not anaesthetist` inside a literal.
#
# A DUTY-FLAG NAME is ([a-z_]+\.)?[a-z_]*(anaesthetist|obstetrician|paediatrician)[a-z_]*,
# case-insensitive: bare, qualified, the p_-prefixed parameters of app.gate()
# (006:59-63), and suffixed names such as `anaesthetist_on_duty`, the boolean
# regression this guard exists for (003:160). Until EL-1 the name was the bare
# word only, and `NOT p_anaesthetist` passed: the underscore is a word character.
#
# WHAT COMPILES AND WHAT DOES NOT, against `app.tri_state NOT NULL` (observed on
# local PostgreSQL 17.6, 2026-09-28, over YES/UNKNOWN/NO/NULL in a rolled-back
# transaction; Cowork observed the same on PostgreSQL 16):
#   - a bare `NOT flag` does NOT compile: "argument of NOT must be type boolean,
#     not type app.tri_state". Pass A guards it anyway, because the column type is
#     a decision a future migration could undo -- a boolean or nullable flag, or a
#     cast, brings the silent drop straight back -- and because the JavaScript half
#     (`!flag`) still compiles, which is what eslint.config.mjs guards.
#   - `NOT flag = 'NO'` DOES compile. NOT binds looser than =, so it parses as
#     NOT (flag = 'NO'), and it drops a NULL flag expression: it returned
#     YES,UNKNOWN. Pass B catches it (pass A does too, on the `NOT flag`).
#   - `NOT flag IS DISTINCT FROM 'NO'` compiles and is CORRECT: it parses as
#     NOT (flag IS DISTINCT FROM 'NO') and is total. Pass A flags it anyway. That
#     is an ACCEPTED FALSE POSITIVE, named here and planted in the test: write
#     `flag IS NOT DISTINCT FROM 'NO'`, which says the same thing.
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
# PASS B CATCHES, with optional whitespace and an optional ::type on either side:
#   flag <> 'NO'   flag != 'NO'   'NO' <> flag   'NO' != flag
#   NOT (flag = 'NO'   NOT flag = 'NO'   NOT ('NO' = flag   NOT 'NO' = flag
# Classified under code-pipeline Clause 5 as GUARD-AHEAD-OF-SUBJECT: there are
# zero occurrences in 001 to 026 today (006 uses IS NOT DISTINCT FROM at :90,
# :101 and :105). Pass A is LIVE in the same sense it always was: it guards a
# shape the type system refuses today.
#
# COMMENTS ARE STRIPPED BEFORE MATCHING, and that is not a loosening -- it is what
# makes the guard usable. Migration 003 describes the prohibition, quoting the
# wrong form so a reader knows what to avoid. A lint that fires on its own
# documentation is a lint people delete. Line numbers are preserved because
# nothing is deleted, only blanked. `/* */` BLOCKS ARE NOT STRIPPED: no migration
# from 001 to 026 holds one, so a block comment quoting a wrong form is read as
# code and caught. Quote a wrong form in a `--` comment instead.
#
# NOT ASSERTED HERE, deliberately: that every duty-flag comparison is SEMANTICALLY
# correct. This is a syntactic guard against named wrong shapes. The semantics are
# established by the 60-row truth table (3 flag states x 10 categories x 2 claim
# values) in tests/db/gate_truth_table.test.ts, run against both derivation sites.
#
# NOT ASSERTED HERE either -- shapes pass B still MISSES, each of which is the
# silent drop on a NULL flag expression:
#   - a NOT ( ... ) split across lines: the match is line by line;
#   - a compound NOT (a = 'X' AND flag = 'NO'): the flag is not first in the parens;
#   - `flag NOT IN ('NO')`;
#   - a parenthesised flag, `(flag) <> 'NO'`;
#   - dynamic SQL in EXECUTE strings, whose quotes are doubled (`''NO''`);
#   - a `--` inside a string literal, which pass B's comment strip reads as a
#     comment, truncating the line: a false negative.
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

FLAG='([a-z_]+\.)?[a-z_]*(anaesthetist|obstetrician|paediatrician)[a-z_]*'
Q="'"
S='[[:space:]]*'
CAST='(::[a-z_.]+)?'
BARE_NOT="\bNOT[[:space:]]+${FLAG}\b"
NEGATED="\b${FLAG}${S}${CAST}${S}(<>|!=)${S}${Q}NO${Q}"
NEGATED="${NEGATED}|${Q}NO${Q}${S}${CAST}${S}(<>|!=)${S}${FLAG}\b"
NEGATED="${NEGATED}|\bNOT${S}\(${S}${FLAG}${S}${CAST}${S}=${S}${Q}NO${Q}"
NEGATED="${NEGATED}|\bNOT[[:space:]]+${FLAG}${S}${CAST}${S}=${S}${Q}NO${Q}"
NEGATED="${NEGATED}|\bNOT${S}\(${S}${Q}NO${Q}${S}${CAST}${S}=${S}${FLAG}\b"
NEGATED="${NEGATED}|\bNOT[[:space:]]+${Q}NO${Q}${S}${CAST}${S}=${S}${FLAG}\b"

# scan <file> <pattern> <sed expression...>: the matching lines, numbered.
# `|| true` would collapse grep's exit 2 (could not run) into its 1 (no match),
# so a file this could not read reported clean; only 0 and 1 are verdicts.
#
# THE READ IS ITS OWN STEP (R-2026-09-28-162). This was `sed ... "$f" | grep`,
# under a comment saying pipefail makes the status the FIRST failure in the
# pipeline. It is the LAST non-zero one: a sed that could not read the file
# exited non-zero, grep read nothing and exited 1, and the pipeline reported 1 --
# no match. An unreadable migration read PASS. Observed 2026-09-28 with a mode-000
# file, on this script and on main's copy of it.
#
# `exit 2` here leaves only the $(...) subshell. The caller assigns the result on
# a line of its own, where `set -e` turns that status into the script's exit.
scan () {
    local f="$1" pattern="$2"; shift 2
    local st=0 text out
    text=$(sed "$@" "$f") || st=$?
    case "$st" in
        0) ;;
        *) echo "ERROR: the duty-flag read exited $st on $f -- the file was not scanned" >&2; exit 2 ;;
    esac
    out=$(printf '%s\n' "$text" | grep -nEi "$pattern") || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the duty-flag scan exited $st on $f -- it did not run" >&2; exit 2 ;;
    esac
    printf '%s' "$out"
}

VIOLATIONS=0
for f in "${FILES[@]}"; do
    hit=0
    out=$(scan "$f" "$BARE_NOT" -e "s/'[^']*'//g" -e 's/--.*//')
    if [ -n "$out" ]; then
        echo "FAIL: bare NOT on a tri-state duty flag: $(basename "$f"):"
        echo "$out" | sed 's/^/  /'
        hit=1
    fi
    out=$(scan "$f" "$NEGATED" -e 's/--.*//')
    if [ -n "$out" ]; then
        echo "FAIL: negated equality on a tri-state duty flag: $(basename "$f"):"
        echo "$out" | sed 's/^/  /'
        hit=1
    fi
    VIOLATIONS=$((VIOLATIONS+hit))
done

[ "$VIOLATIONS" -eq 0 ] || {
    echo "lint_sql_no_bare_not_duty_flag.sh: FAILED ($VIOLATIONS file(s))"
    echo "  Duty flags are three-state. Use IS NOT DISTINCT FROM 'NO', or IS DISTINCT FROM 'NO' for the complement."
    echo "  A negated equality -- <> 'NO', != 'NO', NOT (flag = 'NO') -- drops a NULL flag expression."
    exit 1
}
echo "lint_sql_no_bare_not_duty_flag.sh: PASS (${#FILES[@]} migrations)"
