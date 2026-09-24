#!/usr/bin/env bash
# ============================================================
# scripts/readback_public_output.sh
# ============================================================
# A HOSTED APPLY MUST CHANGE NO PUBLIC OUTPUT, AND THIS IS THE READING THAT SHOWS IT
# (R-2026-09-24-73 BA-2, first for 020's apply). It is run twice around the apply,
# from runbook step 5 in docs/runbook-supabase-project-creation.md:
#
#   before: bash scripts/readback_public_output.sh https://openbed.ng
#           prints what the public sees and one FINGERPRINT line. No verdict.
#   after:  bash scripts/readback_public_output.sh https://openbed.ng '<fingerprint>'
#           reads it all again: PASS if every part is as it was, otherwise STOP
#           naming each part that moved.
#
# THE FOUR PARTS, and why each is read the way it is:
#   - beds.json: what a visitor actually receives. Only `facilities` and `wards` are
#     kept. The rest of the envelope in packages/fixtures/snapshot-shape.json moves on
#     every generation without anything changing: `v` is an identity (016), and
#     `generated_at` and `server_now` are clocks.
#   - public.facility_public and public.ward_public: every column, updated_at
#     INCLUDED. 020's backfill claims to fire no projection trigger (-71 B1), and a
#     fired trigger would show up as exactly an updated_at that moved.
#   - public.lga_rollup: every column EXCEPT updated_at, which the five-minute
#     refresh rewrites whether anything changed or not (017's refresh_lga_rollup).
# Each table is read as a row count and the first 12 hex digits of an md5 over its
# rows in sorted order. The queries are the Q_ literals below. tests/db runs those
# exact literals against a real database, so what hosted runs is what was tested.
#
# EMPTY IS NOT EVIDENCE. If every count is 0 before and after, the apply created no
# public row, and nothing more can be said: there was nothing for it to change. The
# verdict then says VACUOUS FOR B1, and B1's evidence remains
# tests/db/migration_020_round_trip.test.ts.
#
# The contract every read-back keeps (the refused URL, one verdict, and a check that
# could not run giving ERROR rather than a verdict) is in scripts/readback_common.sh.
# DATABASE_URL is read from the environment, as scripts/run_migrations.sh reads it,
# so the fence that runs this sets it with `read -rs` and unsets it afterwards.
#
# NOT ASSERTED HERE, deliberately: that nothing ELSE public changed, such as grants or
# the functions anon can execute. This compares output, not privileges.
#
# Usage: bash scripts/readback_public_output.sh SITE-ORIGIN [FINGERPRINT]
# Exit: 0 recorded, or PASS; 1 STOP; 2 nothing was read, or a reading could not run.
# ============================================================
set -euo pipefail

SITE="${1:-}"
EXPECTED="${2:-}"
# shellcheck source=readback_common.sh
source "$(dirname "$0")/readback_common.sh"

rb_require_url readback_public_output.sh 'https://openbed.ng' "$SITE"
SITE="${SITE%/}"

if [ -z "${DATABASE_URL:-}" ]; then
    echo "STOP: DATABASE_URL is not set, so nothing was read."
    echo "  Run this from the runbook fence that sets it with read -rs."
    exit 2
fi

FP_SHAPE='^beds\.json=[0-9]+/[0-9]+:[0-9a-f]{12},facility_public=[0-9]+:[0-9a-f]{12},ward_public=[0-9]+:[0-9a-f]{12},lga_rollup=[0-9]+:[0-9a-f]{12}$'
if [ -n "$EXPECTED" ] && ! [[ "$EXPECTED" =~ $FP_SHAPE ]]; then
    echo "STOP: '$EXPECTED' is not a fingerprint this script printed, so nothing was read. Copy the value after 'FINGERPRINT ' from the before-reading, inside single quotes."
    exit 2
fi

Q_FACILITY_PUBLIC="select count(*) || ':' || left(coalesce(md5(string_agg(t::text, E'\n' order by t::text)), md5('')), 12) from (select * from public.facility_public) t"
Q_WARD_PUBLIC="select count(*) || ':' || left(coalesce(md5(string_agg(t::text, E'\n' order by t::text)), md5('')), 12) from (select * from public.ward_public) t"
Q_LGA_ROLLUP="select count(*) || ':' || left(coalesce(md5(string_agg(t::text, E'\n' order by t::text)), md5('')), 12) from (select state, lga, category, facility_count, total_beds from public.lga_rollup) t"

# read_table NAME QUERY -- "count:digest" into RB_PART.
read_table() {
    local name="$1" query="$2" st=0
    RB_PART="$(psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$query")" || st=$?
    if [ "$st" -ne 0 ]; then
        echo "ERROR: psql exited $st reading public.$name -- 127 means psql is not on PATH (step P). The reading did not run, so it has no verdict"
        exit 2
    fi
    if ! [[ "$RB_PART" =~ ^[0-9]+:[0-9a-f]{12}$ ]]; then
        echo "ERROR: psql answered '$RB_PART' for public.$name, which is not a count and a digest -- the reading did not run, so it has no verdict"
        exit 2
    fi
}

echo "=== the public output at $SITE, and the three public tables behind it ==="
site_probe GET /beds.json
BEDS_STATUS="$RB_CODE"
st=0
BEDS="$(node -e '
const fs = require("fs");
const crypto = require("crypto");
let s;
try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { s = null; }
if (s === null || typeof s !== "object" || !Array.isArray(s.facilities) || !Array.isArray(s.wards)) {
  process.stdout.write("not-a-snapshot");
} else {
  const digest = crypto.createHash("sha256").update(JSON.stringify({ facilities: s.facilities, wards: s.wards })).digest("hex").slice(0, 12);
  process.stdout.write(s.facilities.length + "/" + s.wards.length + ":" + digest);
}
' "$RB_TMP/body")" || st=$?
if [ "$st" -ne 0 ]; then
    echo "ERROR: node exited $st summarising beds.json -- the reading did not run, so it has no verdict"
    exit 2
fi
if [ "$BEDS_STATUS" != 200 ]; then BEDS="status-$BEDS_STATUS"; fi

read_table facility_public "$Q_FACILITY_PUBLIC"
FACILITY_PUBLIC="$RB_PART"
read_table ward_public "$Q_WARD_PUBLIC"
WARD_PUBLIC="$RB_PART"
read_table lga_rollup "$Q_LGA_ROLLUP"
LGA_ROLLUP="$RB_PART"

echo "  beds.json        facilities/wards:digest  $BEDS"
echo "  facility_public  rows:digest              $FACILITY_PUBLIC"
echo "  ward_public      rows:digest              $WARD_PUBLIC"
echo "  lga_rollup       rows:digest              $LGA_ROLLUP   (updated_at left out)"
NOW="beds.json=$BEDS,facility_public=$FACILITY_PUBLIC,ward_public=$WARD_PUBLIC,lga_rollup=$LGA_ROLLUP"

if [ -z "$EXPECTED" ]; then
    if ! [[ "$BEDS" =~ ^[0-9]+/[0-9]+:[0-9a-f]{12}$ ]]; then
        echo
        echo "STOP: $SITE/beds.json did not answer a snapshot (read '$BEDS'), so this reading is no baseline. Do not apply."
        exit 1
    fi
    echo "FINGERPRINT $NOW"
    echo
    echo "RECORDED: the reading before the apply. Keep the FINGERPRINT line. After the apply, run:"
    echo "  bash scripts/readback_public_output.sh $SITE '$NOW'"
    exit 0
fi

echo
echo "=== against the reading taken before the apply ==="
ALL_ZERO=1
IFS=, read -r -a WAS <<< "$EXPECTED"
IFS=, read -r -a IS <<< "$NOW"
for i in 0 1 2 3; do
    part="${WAS[$i]%%=*}"
    rb_expect "$part" "${IS[$i]#*=}" "${WAS[$i]#*=}"
    for v in "${WAS[$i]#*=}" "${IS[$i]#*=}"; do
        case "${v%%:*}" in
            0|0/0) ;;
            *) ALL_ZERO=0 ;;
        esac
    done
done

if [ "$RB_OK" != 1 ]; then
    echo
    echo "The public output changed across the apply. Run nothing further; paste this whole output back."
    rb_verdict "unreachable"
fi
if [ "$ALL_ZERO" = 1 ]; then
    echo
    echo "NOTE: every count, before and after, is 0."
    echo
    echo "PASS (VACUOUS FOR B1): the apply created no public row. With nothing public before it, this cannot show that it changed none."
    exit 0
fi
rb_verdict "the public output reads exactly as it did before the apply."
