#!/usr/bin/env bash
# ============================================================
# scripts/attest_run.sh
# ============================================================
# ONE COMMAND THAT RUNS A RED-DISPOSITION ATTESTATION AND KEEPS ALL OF ITS OUTPUT
# (R-2026-10-07 GI, addenda 1 E and 2).
#
# Usage: bash scripts/attest_run.sh db | compliance
#   db          npm run db:reset, then the db project through vitest to junit-db.xml, then attest_counts.
#   compliance  npm run build, then the compliance project to junit-compliance.xml, then attest_counts.
#               OPENBED_RECORDS_DIR is honoured as the caller set it: unset skips the one declared
#               records leg, set runs it. The script never sets it.
# Needs, for db: DATABASE_URL exported (the local stack's URL), as npm run db:reset needs it. It is
# not defaulted here, because a password-bearing URL in a tracked file is exactly what the secret scan
# exists to refuse.
# Exit: 0 GREEN (ZERO-RED), 1 RED or could not be attested, 2 usage or a missing precondition.
#
# WHY IT EXISTS. On 2026-10-07 an attestation run of mine ended with the db project having collected
# zero tests, and the cause was never seen: my own wrapper filtered the reset's output and sent the
# collector's to nowhere. A zero-collected run is one of the quietest failures this repository has: vitest
# writes an empty-but-closed JUnit file and prints the reason only on the console, so the only thing that
# explains it is the output a wrapper threw away. This script throws nothing away.
#
# WHAT IT HOLDS:
#   - EVERY phase's output, reset or build and then the collector and then attest_counts, streams to the
#     terminal AND to one full log under .gate-logs (gitignored; cited here without backticks because it is
#     not a tracked path). The log is truncated at the start of each run and never filtered.
#   - THE PREVIOUS JUnit FILE IS REMOVED FIRST. A vitest start failure, a wrong project name, a crash before
#     the reporter opens its file: none of them touches the JUnit, so a stale green file would be attested as
#     if this run had written it.
#   - ON ANY ABORT it prints, after a line reading ATTESTATION: RED, what failed and with what exit code, the
#     collector's own error lines verbatim from the log (the lines naming an error, bounded), the last 40
#     lines of the log, and the log's path. Zero tests collected is an abort. An unhandled error with every
#     test passing is an abort: attest_counts reads it as errored=1, and this script does not second-guess it.
#     "Error lines" means any line containing error, Error, ERROR or FAIL, or vitest's No test files found,
#     bounded at 40. It is deliberately broad. Its first version listed named banners (Unhandled Error,
#     Error:, and so on) and came back EMPTY for the one failure this script was written for: on 2026-10-07
#     supabase db reset failed with {"_tag":"Error","error":{"code":"LegacyDbSetupError","message":
#     "error running container: exit 1"}}, a line with the word Error and no colon after it. Only the log
#     tail showed it. A filter that has to know what the failure will say is the filtering this script exists to end.
#   - attest_counts.mjs is run as it is. This script does not interpret a JUnit file.
#
# STATUS IS CAPTURED, NOT PIPED AWAY. Each phase is `cmd 2>&1 | tee -a log || rc=$?` under pipefail, so a
# failing command's status survives the tee. That is bash: run this with bash, never paste it into zsh, whose
# PIPESTATUS is empty (test-conventions section 8).
#
# NOT ASSERTED HERE, deliberately: that the failure is diagnosed. This script shows the collector's own words;
# it does not parse them into a cause, and a cause that matches no keyword is still in the tail and the log.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${1:-}"
case "$PROJECT" in
    db|compliance) ;;
    *) echo "ERROR: usage: bash scripts/attest_run.sh db|compliance" >&2; exit 2 ;;
esac
if [ "$PROJECT" = "db" ] && [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL is not set -- npm run db:reset needs the local stack's URL exported" >&2
    exit 2
fi

cd "$ROOT"
LOG_DIR=".gate-logs"
LOG="$LOG_DIR/attest-$PROJECT.log"
JUNIT="junit-$PROJECT.xml"
mkdir -p "$LOG_DIR"
: > "$LOG"
rm -f -- "$JUNIT"

note() { printf '%s\n' "$*" | tee -a "$LOG"; }

RUN_RC=0
run() {
    local label="$1"
    shift
    note "=== $label: $*"
    RUN_RC=0
    "$@" 2>&1 | tee -a "$LOG" || RUN_RC=$?
}

abort() {
    echo ""
    echo "ATTESTATION: RED -- $1"
    echo "--- the collector's own error lines, verbatim, from the log:"
    awk '/[Ee]rror|ERROR|FAIL|No test files found/{print; n++; if (n >= 40) exit}' "$LOG"
    echo "--- the last 40 lines of the log:"
    tail -n 40 "$LOG"
    echo "Full log: $LOG"
    exit 1
}

if [ "$PROJECT" = "db" ]; then
    run "reset" npm run db:reset
    [ "$RUN_RC" -eq 0 ] || abort "ERROR: db:reset failed (exit $RUN_RC) -- the db project was not run"
else
    run "build" npm run build
    [ "$RUN_RC" -eq 0 ] || abort "ERROR: npm run build failed (exit $RUN_RC) -- the compliance project was not run"
fi

run "collect" npx vitest run --project "$PROJECT" --reporter=default --reporter=junit "--outputFile=$JUNIT"
COLLECT_RC=$RUN_RC
run "attest" node scripts/attest_counts.mjs "$JUNIT"
ATTEST_RC=$RUN_RC

[ "$COLLECT_RC" -eq 0 ] || abort "ERROR: the collector (vitest) exited $COLLECT_RC (attest_counts exited $ATTEST_RC)"
[ "$ATTEST_RC" -eq 0 ] || abort "ERROR: attest_counts exited $ATTEST_RC -- the run is RED or could not be attested"

note ""
note "ATTESTATION: GREEN -- $PROJECT (ZERO-RED)"
note "Full log: $LOG"
