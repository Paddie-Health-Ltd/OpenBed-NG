#!/usr/bin/env bash
# ============================================================
# scripts/lint_no_piped_grep_q.sh
# ============================================================
# No lint script may branch on `<writer> | grep -q`.
#
# WHY THIS IS A GUARD AND NOT A STYLE PREFERENCE. grep has THREE exit codes:
# 0 match, 1 no match, and 2 COULD NOT RUN -- an unreadable input, a resource
# failure, a fork that did not happen. Every call site in this repository
# branched on truthiness alone, which silently reinterprets the third:
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
# The replacement is pure-bash `case` matching: no fork, no pipe, and no third
# exit code to misread. Where a check must genuinely read a file, grep stays and
# its exit codes are separated explicitly -- 1 is a finding, anything else is
# fatal and loud.
#
# HOW THIS IS ENFORCED IN CI, stated exactly. There is no separate CI step for
# it. It runs in the `compliance-tests` job through the ACCEPT leg of
# tests/compliance/lint_no_piped_grep_q.test.ts, which invokes this script
# against the real repository root and requires exit 0. That is the same wiring
# lint_audit_log_columns.sh already has, and it is real enforcement -- but it is
# worth saying, because a reader scanning .github/workflows/ci.yml for this
# filename will not find it.
#
# CLASSIFICATION (Clause 5): LIVE. The scripts it guards exist now, and the
# defect it bans was removed from three of them in the same change.
#
# NOT ASSERTED HERE, deliberately: that a script separates grep's exit 2 where
# it DOES read a file -- that is a semantic property of a conditional, not a
# textual one, and a lint claiming to check it would be theatre. This bans the
# one shape that is mechanically detectable and was the actual carrier.
#
# Usage: bash scripts/lint_no_piped_grep_q.sh [ROOT]
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
DIR="$ROOT/scripts"
[ -d "$DIR" ] || { echo "ERROR: no scripts directory at $DIR" >&2; exit 2; }

FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$DIR" -maxdepth 1 -type f -name "lint_*.sh" | sort)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no lint scripts found in $DIR" >&2; exit 2; }

VIOLATIONS=0
for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    [ "$base" = "lint_no_piped_grep_q.sh" ] && continue

    n=0
    while IFS= read -r line; do
        n=$((n + 1))
        # Strip a leading comment: a line whose first non-blank character is `#`
        # is documentation, and this file's own header would otherwise trip it.
        trimmed="${line#"${line%%[![:space:]]*}"}"
        case "$trimmed" in \#*) continue ;; esac

        case "$trimmed" in
            *'|'*grep*-q*)
                echo "FAIL: $base:$n: pipes into \`grep -q\` -- grep's exit 2 (could not run) is"
                echo "      indistinguishable from 1 (no match) here. Use bash \`case\` matching."
                echo "      $trimmed"
                VIOLATIONS=$((VIOLATIONS + 1))
                ;;
        esac
    done < "$f"
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_no_piped_grep_q.sh: FAILED ($VIOLATIONS)"; exit 1; }
echo "lint_no_piped_grep_q.sh: PASS (${#FILES[@]} lint scripts scanned)"
