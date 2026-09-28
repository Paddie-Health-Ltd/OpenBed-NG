#!/usr/bin/env bash
# ============================================================
# scripts/lint_grep_exit_codes.sh
# ============================================================
# No script in scripts/ may BRANCH on a grep.
#
# RENAMED 2026-09-10 from lint_no_piped_grep_q.sh. That name described a strictly
# narrower and different class than this now guards -- neither `piped` nor `-q` is
# part of the defect, and the instance that escaped had neither. A guard whose
# name is narrower than its behaviour is how the next person concludes it does not
# cover their case and writes the exemption instead of the fix.
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
# answer -- WHEN GREP READS THE INPUT ITSELF. `scripts/lint_migration_header.sh`
# uses it, so the ACCEPT leg over the real corpus proves the exemption works
# rather than proving nothing. A bare `out=$(... | grep ...)` with no status
# captured on the line is outside this guard: it is only a verdict once something
# acts on the status.
#
# THE PIPELINE ARM (R-2026-09-28-163, EM-3 a). `|| st=$?` after a PIPELINE into
# grep captures the status of the pipeline, and under pipefail that is the LAST
# non-zero status, not the first. In `out=$(sed ... "$f" | grep ...) || st=$?` a
# sed that could not read the file exits non-zero, grep reads nothing and exits
# 1, and the capture records 1: no match. An unreadable file reads clean. Three
# lints carried exactly this, under comments saying pipefail makes the status the
# FIRST failure -- a belief this header used to teach by calling the capture
# correct without qualification. So the arm flags a status-capturing line on
# which a grep stands after a single `|`, UNLESS the pipeline's first stage is
# `printf` or `echo` and every stage between it and the last grep is a grep:
# printf reading a variable has nothing to fail to read, and each grep's own 2 is
# then the status that surfaces. The fix is to read the input in its own step,
# with its own status, and feed grep from printf.
#
# LINES ARE JOINED FIRST. Physical lines ending in `\` are joined into one
# logical line before any arm looks at it, and a finding is reported at the
# logical line's FIRST physical line. Unjoined, `sed ... "$f" \` and
# `| grep ...) || st=$?` are two lines, and the second looks like a capture with
# nothing upstream. Comment lines are skipped before joining.
#
# HOW THIS IS ENFORCED IN CI, stated exactly. There is no separate CI step for
# it. It runs in the `compliance-tests` job through the ACCEPT leg of
# `tests/compliance/lint_grep_exit_codes.test.ts`, which invokes this script
# against the real repository root and requires exit 0. That is real enforcement,
# but it is worth saying, because a reader scanning `.github/workflows/ci.yml`
# for this filename will not find it.
#
# CLASSIFICATION (Clause 5): LIVE. The scripts it guards exist now.
#
# NOT ASSERTED HERE, deliberately -- four boundaries, named rather than implied:
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
#   4. What the pipeline arm still MISSES, each of which can hide an upstream
#      read failure behind grep's 1:
#      - a pipeline built across a function boundary (a function whose output
#        is piped into grep);
#      - a process substitution, `grep ... <(sed ... "$f")`;
#      - a here-string, `grep ... <<< "$(sed ... "$f")"`;
#      - a command substitution inside printf's arguments,
#        `printf '%s\n' "$(cat "$f")" | grep`: printf is the first stage, and the
#        read inside its argument is not a stage;
#      - a `$(` that spans bare newlines without `\`, which is never joined;
#      - a status captured by anything other than `|| <name>=$?`.
#
# Usage: bash scripts/lint_grep_exit_codes.sh [ROOT]
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

# ---- THE PIPELINE ARM'S SCANNER: pure bash, no fork, no grep. ------------------
# A logical line is walked one character at a time. Single and double quotes and
# backslashes are tracked, and each `$(` opens a segment on a stack. When a
# segment closes it is judged on its own, and it is replaced in its parent by a
# placeholder, so a substitution inside printf's arguments is not a stage of the
# parent pipeline. Within a segment, a single `|` outside quotes separates stages;
# `||` does not.
SEP=$'\037'

# trim <text>: prints it without leading or trailing whitespace.
trim () {
    local t="${1#"${1%%[![:space:]]*}"}"
    printf '%s' "${t%"${t##*[![:space:]]}"}"
}

# segment_hides <segment>: 0 when a grep after a single `|` is fed by anything
# other than printf or echo followed only by greps.
segment_hides () {
    local rest="$1" idx=0 k last=0 t first
    local -a stages
    while :; do
        case "$rest" in
            *"$SEP"*) stages[idx]="${rest%%"$SEP"*}"; rest="${rest#*"$SEP"}"; idx=$((idx + 1)) ;;
            *) stages[idx]="$rest"; break ;;
        esac
    done
    k=1
    while [ "$k" -le "$idx" ]; do
        t="$(trim "${stages[k]}")"
        case "$t" in 'grep '*|grep) last=$k ;; esac
        k=$((k + 1))
    done
    if [ "$last" -eq 0 ]; then return 1; fi
    t="$(trim "${stages[0]}")"
    first="${t%%[[:space:]]*}"
    case "$first" in
        printf|echo)
            k=1
            while [ "$k" -lt "$last" ]; do
                t="$(trim "${stages[k]}")"
                case "$t" in 'grep '*|grep) ;; *) return 0 ;; esac
                k=$((k + 1))
            done
            return 1 ;;
    esac
    return 0
}

# pipe_hides <logical line>: 0 when any segment of it hides an upstream stage.
pipe_hides () {
    local s="$1" n="${#1}" i=0 c nx in_s=0 in_d=0 top=0
    local -a text dq par
    text[0]=""; dq[0]=0; par[0]=0
    while [ "$i" -lt "$n" ]; do
        c="${s:i:1}"
        if [ "$in_s" -eq 1 ]; then
            text[top]="${text[top]}$c"
            if [ "$c" = "'" ]; then in_s=0; fi
            i=$((i + 1)); continue
        fi
        nx="${s:i+1:1}"
        case "$c" in
            \\) text[top]="${text[top]}${s:i:2}"; i=$((i + 2)); continue ;;
            "'") if [ "$in_d" -eq 0 ]; then in_s=1; fi ;;
            '"') in_d=$((1 - in_d)) ;;
            '$')
                if [ "$nx" = "(" ]; then
                    top=$((top + 1)); text[top]=""; dq[top]=$in_d; par[top]=0; in_d=0
                    i=$((i + 2)); continue
                fi ;;
            '(') if [ "$in_d" -eq 0 ]; then par[top]=$((par[top] + 1)); fi ;;
            ')')
                if [ "$in_d" -eq 0 ] && [ "$top" -gt 0 ]; then
                    if [ "${par[top]}" -eq 0 ]; then
                        if segment_hides "${text[top]}"; then return 0; fi
                        in_d=${dq[top]}; top=$((top - 1)); text[top]="${text[top]}X"
                        i=$((i + 1)); continue
                    fi
                    par[top]=$((par[top] - 1))
                fi ;;
            '|')
                if [ "$in_d" -eq 0 ]; then
                    if [ "$nx" = "|" ]; then text[top]="${text[top]}||"; i=$((i + 2)); continue; fi
                    text[top]="${text[top]}$SEP"; i=$((i + 1)); continue
                fi ;;
        esac
        text[top]="${text[top]}$c"
        i=$((i + 1))
    done
    while [ "$top" -ge 0 ]; do
        if segment_hides "${text[top]}"; then return 0; fi
        top=$((top - 1))
    done
    return 1
}

VIOLATIONS=0
for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    [ "$base" = "lint_grep_exit_codes.sh" ] && continue

    n=0
    joining=0
    acc=""
    at=0
    while IFS= read -r line; do
        n=$((n + 1))
        # Strip a leading comment: a line whose first non-blank character is `#`
        # is documentation, and every one of these scripts documents the banned
        # shape in its own header. Skipped BEFORE joining.
        trimmed="${line#"${line%%[![:space:]]*}"}"
        case "$trimmed" in \#*) continue ;; esac

        # JOIN: a line ending in `\` continues onto the next. The logical line is
        # reported at its first physical line.
        case "$trimmed" in
            *\\)
                if [ "$joining" -eq 0 ]; then joining=1; at=$n; acc=""; fi
                acc="$acc${trimmed%\\} "
                continue ;;
        esac
        if [ "$joining" -eq 1 ]; then
            trimmed="$acc$trimmed"
            joining=0
        else
            at=$n
        fi

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
        hint="capture"
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
                        [a-zA-Z_]*'=$?')
                            # A capture. Correct when grep reads the input itself;
                            # after a pipe, the capture records the LAST non-zero
                            # status and hides an upstream stage's failure.
                            if pipe_hides "$trimmed"; then
                                why="captures a piped grep's status — FAILS OPEN: pipefail reports the LAST non-zero status, so grep's 1 hides an upstream stage that failed on its input"
                                hint="read"
                            fi ;;
                        true|true\)) why="swallows a grep's status with || true — FAILS OPEN: exit 2 becomes an empty result set, which reads as no findings" ;;
                        *) why="branches on a grep with || — exit 2 is decided by whichever side it lands on, and neither is a verdict" ;;
                    esac
                    ;;
            esac
        fi

        if [ -n "$why" ]; then
            echo "FAIL: $base:$at: $why"
            case "$hint" in
                read)
                    echo "      Read the input in its own step:  text=\$(sed ... \"\$f\") || st=\$?  and make its non-zero fatal,"
                    echo "      then feed grep from printf and capture grep's own status." ;;
                *)
                    echo "      Capture the status instead:  st=0; grep -q ... || st=\$?  then branch on \$st,"
                    echo "      making anything other than 0 or 1 fatal and loud." ;;
            esac
            echo "      $trimmed"
            VIOLATIONS=$((VIOLATIONS + 1))
        fi
    done < "$f"
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_grep_exit_codes.sh: FAILED ($VIOLATIONS)"; exit 1; }
echo "lint_grep_exit_codes.sh: PASS (${#FILES[@]} shell scripts scanned)"
