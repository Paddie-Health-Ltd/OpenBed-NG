#!/usr/bin/env bash
# ============================================================
# scripts/neuter.sh
# ============================================================
# NEUTER HARNESS. For each neuter in a spec: plant a change into a tracked file,
# optionally push it somewhere live (the APPLY command), run the named tests,
# report which went red, then restore the file and re-run APPLY, and confirm
# both the file and the optional PROBE are back where they started.
#
# WHY TRACKED (founder ruling R-2026-09-15-03, item 4). This began as a
# scratchpad script for migrations 014 and 015. An untracked instrument cannot
# be pinned, reviewed, versioned or neutered, and this session's finding is that
# verification instruments produce false results: its first N13 run passed two
# test paths as one zsh string, vitest selected nothing, and the harness said
# nothing. The plant half is scripts/neuter_plant.mjs.
#
# RUN IT AS `bash scripts/neuter.sh ...`, NEVER PASTED INTO AN INTERACTIVE SHELL,
# and read its exit status from bash. The 015 run's final exit code printed
# empty because it was read from zsh through `PIPESTATUS`, which zsh does not
# set at all (zsh's array is `pipestatus`, and it is 1-indexed).
#
# EXIT, and the three are kept distinct because they mean different things:
#   0  every neuter turned at least one test red, and every restore verified
#   1  NEUTER SURVIVED: some neuter left every selected test green -- the
#      control did not notice the change it exists to catch. That is a finding.
#   2  the harness could not produce a verdict: usage, a spec refusal, a plant
#      that did not land, zero tests selected, an APPLY that failed, a PROBE
#      that did not move on the plant or did not return on the restore.
#
# HARD FAILURES ABORT THE WHOLE RUN. A trap restores the target file from its
# backup on any exit, so an abort never leaves a tracked file planted.
#
# Usage: bash scripts/neuter.sh <spec.json> [ROOT] [NAME...]
#   ROOT defaults to the repository; plants and restores happen under it, and
#   vitest runs from it. It is the seam the harness's own tests aim at a
#   scratch tree (test-conventions.md §2).
# Environment passed to APPLY and PROBE: NEUTER_FILE (absolute target path),
#   NEUTER_ROOT, NEUTER_DB_URL (DATABASE_URL, else the local stack).
#
# CLASSIFICATION (Clause 5): LIVE. Its subject -- the repository's tests -- exists.
# ============================================================
set -euo pipefail

SPEC="${1:-}"
[ -n "$SPEC" ] || { echo "ERROR: no neuter spec given. Usage: bash scripts/neuter.sh <spec.json> [ROOT] [NAME...]" >&2; exit 2; }
shift
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
if [ "$#" -gt 0 ] && [ -d "$1" ]; then
    ROOT="$(cd "$1" && pwd)"
    shift
fi
PLANT="$HERE/neuter_plant.mjs"
VITEST="$ROOT/node_modules/.bin/vitest"
[ -x "$VITEST" ] || { echo "ERROR: no vitest at $VITEST -- the harness cannot run tests there" >&2; exit 2; }

export NEUTER_ROOT="$ROOT"
export NEUTER_DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/openbed-neuter.XXXXXX")"
TARGET=""
BACKUP=""

restore_on_exit() {
    local st=$?
    if [ -n "$BACKUP" ] && [ -f "$BACKUP" ]; then
        cp "$BACKUP" "$TARGET"
        echo "neuter.sh: restored $TARGET from backup on exit (status $st)" >&2
    fi
    rm -rf "$WORK"
    exit "$st"
}
trap restore_on_exit EXIT

names=()
if [ "$#" -gt 0 ]; then
    names=("$@")
else
    list="$(node "$PLANT" names "$SPEC")"
    while IFS= read -r _n; do names+=("$_n"); done <<< "$list"
fi
[ "${#names[@]}" -gt 0 ] || { echo "ERROR: no neuters selected from $SPEC" >&2; exit 2; }

digest() { shasum -a 256 "$1" | cut -d' ' -f1; }

run_hook() { # $1 label, $2 command string (may be empty)
    local label="$1" command="$2"
    [ -n "$command" ] || return 0
    local hst=0
    (cd "$ROOT" && bash -c "$command") > "$WORK/hook.log" 2>&1 || hst=$?
    if [ "$hst" -ne 0 ]; then
        echo "ERROR: the $label hook command failed (exit $hst) for neuter $NAME -- nothing was measured" >&2
        tail -5 "$WORK/hook.log" >&2
        exit 2
    fi
}

probe_value() { # $1 command string
    local pst=0 out
    out="$(cd "$ROOT" && bash -c "$1" 2>&1)" || pst=$?
    if [ "$pst" -ne 0 ]; then
        echo "ERROR: the PROBE command failed (exit $pst) for neuter $NAME: $out" >&2
        exit 2
    fi
    printf '%s' "$out"
}

SURVIVED=()
for NAME in "${names[@]}"; do
    desc="$(node "$PLANT" describe "$SPEC" "$NAME")"
    FILE=""; PROJECT=""; APPLY=""; PROBE=""; TESTS=()
    while IFS=$'\t' read -r key val; do
        case "$key" in
            FILE) FILE="$val" ;;
            PROJECT) PROJECT="$val" ;;
            APPLY) APPLY="$val" ;;
            PROBE) PROBE="$val" ;;
            TEST) TESTS+=("$val") ;;
        esac
    done <<< "$desc"

    TARGET="$ROOT/$FILE"
    export NEUTER_FILE="$TARGET"
    [ -f "$TARGET" ] || { echo "ERROR: neuter $NAME targets $FILE, which does not exist under $ROOT" >&2; exit 2; }

    orig_digest="$(digest "$TARGET")"
    orig_probe=""
    [ -z "$PROBE" ] || orig_probe="$(probe_value "$PROBE")"

    BACKUP="$WORK/$NAME.orig"
    cp "$TARGET" "$BACKUP"

    node "$PLANT" apply "$SPEC" "$NAME" "$ROOT" > /dev/null
    [ "$(digest "$TARGET")" != "$orig_digest" ] || { echo "ERROR: PLANT DID NOT LAND -- $FILE is unchanged after planting $NAME" >&2; exit 2; }

    run_hook APPLY "$APPLY"
    if [ -n "$PROBE" ]; then
        planted_probe="$(probe_value "$PROBE")"
        [ "$planted_probe" != "$orig_probe" ] || { echo "ERROR: the plant for $NAME did not reach its target -- the PROBE is unchanged after APPLY" >&2; exit 2; }
    fi

    log="$WORK/$NAME.log"
    vargs=(run)
    [ -z "$PROJECT" ] || vargs+=(--project "$PROJECT")
    vst=0
    (cd "$ROOT" && "$VITEST" "${vargs[@]}" "${TESTS[@]}") > "$log.raw" 2>&1 || vst=$?
    sed 's/\x1b\[[0-9;]*m//g' "$log.raw" > "$log"

    tests_line="$(sed -n 's/^ *Tests  *//p' "$log" | tail -1)"
    total="$(printf '%s' "$tests_line" | sed -n 's/.*(\([0-9][0-9]*\)).*/\1/p')"
    if [ -z "$tests_line" ] || [ -z "$total" ] || [ "$total" -eq 0 ]; then
        echo "ERROR: zero tests selected for neuter $NAME -- the run tested nothing. Files: ${TESTS[*]}" >&2
        tail -15 "$log" >&2
        exit 2
    fi
    failed="$(printf '%s' "$tests_line" | sed -n 's/^\([0-9][0-9]*\) failed.*/\1/p')"
    failed="${failed:-0}"

    cp "$BACKUP" "$TARGET"
    run_hook APPLY "$APPLY"
    [ "$(digest "$TARGET")" = "$orig_digest" ] || { echo "ERROR: restore failed for $NAME -- $FILE differs from its original after restore" >&2; exit 2; }
    if [ -n "$PROBE" ]; then
        restored_probe="$(probe_value "$PROBE")"
        [ "$restored_probe" = "$orig_probe" ] || { echo "ERROR: restore failed for $NAME -- the PROBE did not return to its original value" >&2; exit 2; }
    fi
    rm -f "$BACKUP"
    BACKUP=""

    echo "== $NAME: Tests $tests_line  (vitest exit $vst)"
    sed -n 's/^ *× \(.*\)$/    x \1/p' "$log" | sed -E 's/ [0-9]+ms$//' | cut -c1-160
    if [ "$failed" -eq 0 ]; then
        echo "   NEUTER SURVIVED: $NAME left every selected test green"
        SURVIVED+=("$NAME")
    fi
done

if [ "${#SURVIVED[@]}" -gt 0 ]; then
    echo "neuter.sh: FAILED -- ${#SURVIVED[@]} neuter(s) survived: ${SURVIVED[*]}"
    exit 1
fi
echo "neuter.sh: ALL ${#names[@]} NEUTERS RED; every restore verified."
