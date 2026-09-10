#!/usr/bin/env bash
# ============================================================
# scripts/lint_no_piped_grep_q.sh
# ============================================================
# No script in scripts/ may BRANCH on a grep.
#
# WHY THIS IS A GUARD AND NOT A STYLE PREFERENCE. grep has THREE exit codes:
# 0 match, 1 no match, and 2 COULD NOT RUN -- an unreadable input, a resource
# failure, a fork that did not happen. Branching on truthiness alone silently
# reinterprets the third as whichever of the first two sits on that branch:
#
#   `check || fail`   -- exit 2 is reported as a VIOLATION that does not exist.
#   `if check; then`  -- exit 2 is reported as CLEAN. The guard fails OPEN.
#
# Both were live here. `lint_migration_header.sh` reported
# `006_gate_function.sql: no '-- ===' banner block` in CI on 2026-09-10, for a
# file whose first byte is `-` and whose banner is 58 lines. And
# `lint_audit_log_columns.sh` -- the guard for CTO condition (1), no
# identity-bearing column on the audit log -- would have reported "clean" for a
# forbidden column if its grep had failed to run.
#
# WHAT THIS GUARD COVERED UNTIL 2026-09-10, AND WHAT IT DID NOT -- read this
# before narrowing it again. It matched `*'|'*grep*-q*`: PIPED, and QUIET. Both
# halves of that were too narrow, and the second was the worse mistake.
#
# The filename says `grep_q`, and `-q` is irrelevant to the defect. `-q` only
# suppresses OUTPUT; the three exit codes are grep's always. `if out=$(grep -nE
# ... "$f"); then` fails open exactly as `if grep -q ... ; then` does, and it is
# the form these scripts actually used. SIX live instances were found on
# 2026-09-10 BY INSPECTION, NOT BY THIS GUARD, none of them quiet:
#
#   lint_no_service_role_in_bundle.sh  `if out=$(grep -nE "$PATTERN" "$f")`
#   lint_no_secrets.sh                 `out=$(grep ... || true)`
#   lint_audit_log_columns.sh          `out=$(sed ... | grep ... || true)`
#   lint_no_replica_identity_full.sh   same
#   lint_sql_no_bare_not_duty_flag.sh  same
#   lint_no_updated_at_filter.sh       same, three stages
#
# The first is the guard that stops a service-role key reaching a browser bundle
# and the second is the secret scan. Both failed OPEN. `|| true` is the same
# defect wearing a different face: it swallows exit 2 along with exit 1.
#
# The defect was never the bash. It was that the 2026-09-10 sweep's own
# completeness was never checked -- a mechanism present and not reaching, one
# level up from the mechanisms it was sweeping for.
#
# COVERED NOW: any `grep` on a line in a BRANCH POSITION, quiet or not, piped or
# not.
#
#   `if` / `elif` / `while` / `until`  -- FAILS OPEN
#   `grep ... && action`               -- FAILS OPEN
#   `grep ... || action`               -- FALSE VIOLATION
#   `grep ... || true`                 -- FAILS OPEN (the commonest carrier)
#
# DELIBERATELY NOT A VIOLATION -- and this is the whole reason the positive
# control is not decorative. The prescribed idiom CAPTURES the exit code instead
# of branching on it:
#
#   st=0
#   grep -qF "$needle" "$f" || st=$?
#   case "$st" in 0) ;; 1) fail "..." ;; *) echo "ERROR: grep exited $st" >&2; exit 2 ;; esac
#
# The `|| st=$?` there is an ASSIGNMENT, not a branch, and it is the correct
# answer. `scripts/lint_migration_header.sh` uses it, so the ACCEPT leg over the
# real corpus proves the exemption works rather than proving nothing. A bare
# `out=$(... | grep ...)` with no branch on the line is also fine: it is only a
# verdict once something acts on the status.
#
# HOW THIS IS ENFORCED IN CI, stated exactly. There is no separate CI step for
# it. It runs in the `compliance-tests` job through the ACCEPT leg of
# `tests/compliance/lint_no_piped_grep_q.test.ts`, which invokes this script
# against the real repository root and requires exit 0. That is real enforcement,
# but it is worth saying, because a reader scanning `.github/workflows/ci.yml`
# for this filename will not find it.
#
# CLASSIFICATION (Clause 5): LIVE. The scripts it guards exist now.
#
# NOT ASSERTED HERE, deliberately -- three boundaries, named rather than implied:
#
#   1. That a script which CAPTURES grep's status then handles it actually
#      separates exit 2 from exit 1 in the branch that follows. That is a
#      semantic property of a conditional, not a textual one, and a lint claiming
#      to check it would be theatre (Clause 4).
#   2. A grep whose status is captured correctly and then MIShandled -- treating
#      `$st` of 2 as a finding in the case arm. Textually identical to the
#      correct form.
#   3. THIS FILE ITSELF, which is skipped: its own `case` patterns contain the
#      banned text. The compensating control is a leg in the test file asserting
#      this script invokes no grep at all -- it is pure bash `case` matching, no
#      fork, no pipe, and so no third exit code to misread.
#
# Usage: bash scripts/lint_no_piped_grep_q.sh [ROOT]
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
DIR="$ROOT/scripts"
[ -d "$DIR" ] || { echo "ERROR: no scripts directory at $DIR" >&2; exit 2; }

# CORPUS WIDENED 2026-09-10 from lint_*.sh to every shell script in scripts/.
# run_migrations.sh, seed.sh, get_publishable_key.sh and run_e2e.sh were outside
# it, and a boundary nobody states is the same family of defect as the one this
# guard is about.
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$DIR" -maxdepth 1 -type f -name "*.sh" | sort)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no shell scripts found in $DIR" >&2; exit 2; }

VIOLATIONS=0
for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    [ "$base" = "lint_no_piped_grep_q.sh" ] && continue

    n=0
    while IFS= read -r line; do
        n=$((n + 1))
        # Strip a leading comment: a line whose first non-blank character is `#`
        # is documentation, and every one of these scripts documents the banned
        # shape in its own header.
        trimmed="${line#"${line%%[![:space:]]*}"}"
        case "$trimmed" in \#*) continue ;; esac

        # Candidate: a grep appears somewhere on the line. NOT restricted to
        # `-q` -- see the header. `-q` suppresses output; it has nothing to do
        # with the three exit codes, and every live instance found was non-quiet.
        # `grep ` with the space: grep as a COMMAND WORD. Substring matching on
        # `grep` alone flags `grep_or_die`, the helper whose whole purpose is to
        # do the exit-code separation correctly -- a guard that reds on the fix
        # is one people route around.
        case "$trimmed" in
            *'grep '*) ;;
            *) continue ;;
        esac

        why=""
        case "$trimmed" in
            if*|elif*|while*|until*)
                why="branches directly on a grep — FAILS OPEN: exit 2 (could not run) lands on the clean branch" ;;
        esac

        if [ -z "$why" ]; then
            case "$trimmed" in
                *'&&'*)
                    why="chains a grep with && — FAILS OPEN: exit 2 silently skips the action" ;;
            esac
        fi

        if [ -z "$why" ]; then
            case "$trimmed" in
                *'||'*)
                    # The RHS decides it. `|| st=$?` CAPTURES the status and is the
                    # prescribed idiom; `|| fail ...` BRANCHES on it and is the defect.
                    rhs="${trimmed##*'||'}"
                    rhs="${rhs#"${rhs%%[![:space:]]*}"}"
                    rhs="${rhs%"${rhs##*[![:space:]]}"}"
                    rhs="${rhs%;}"
                    case "$rhs" in
                        [a-zA-Z_]*'=$?') ;;
                        true|true\)) why="swallows a grep's status with || true — FAILS OPEN: exit 2 becomes an empty result set, which reads as no findings" ;;
                        *) why="branches on a grep with || — exit 2 is decided by whichever side it lands on, and neither is a verdict" ;;
                    esac
                    ;;
            esac
        fi

        if [ -n "$why" ]; then
            echo "FAIL: $base:$n: $why"
            echo "      Capture the status instead:  st=0; grep -q ... || st=\$?  then branch on \$st,"
            echo "      making anything other than 0 or 1 fatal and loud."
            echo "      $trimmed"
            VIOLATIONS=$((VIOLATIONS + 1))
        fi
    done < "$f"
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_no_piped_grep_q.sh: FAILED ($VIOLATIONS)"; exit 1; }
echo "lint_no_piped_grep_q.sh: PASS (${#FILES[@]} shell scripts scanned)"
