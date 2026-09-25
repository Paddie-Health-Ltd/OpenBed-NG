#!/usr/bin/env bash
# ============================================================
# scripts/readback_pages.sh
# ============================================================
# THE PUBLIC DASHBOARD'S DEPLOY READ-BACKS 4, 6 AND 8, AND THE SERVE-TIME STAMP
# (docs/runbook-cloudflare-pages-beds-json.md, "Reporting back"). Until the
# R-2026-09-23-70 H4 note these were pasted fences; why they are a script now, and
# the contract every read-back keeps, is in scripts/readback_common.sh.
#
# Usage: bash scripts/readback_pages.sh DEPLOYMENT-URL [ROOT]
#   DEPLOYMENT-URL is the https://<hash>.openbed-public-dashboard.pages.dev address
#   wrangler printed. Run this from the deploy checkout you deployed from, BEFORE
#   refreshing it: every stamp is compared with that checkout's HEAD. ROOT exists so
#   the tests can aim this at a scratch checkout; do not remove it because it looks
#   unused. READBACK_SERVED_AT_SLEEP (default 5) is the pause between the two
#   serve-time reads.
# Exit: 0 PASS; 1 STOP (a check read WRONG); 2 nothing was checked, or a check could
#       not run.
#
# NOT HERE, and the runbook says how to read each: read-back 7 (the /robots.txt
# body), and, in a browser, read-backs 5 and 5b and the polling check.
# ============================================================
set -euo pipefail

SITE="${1:-}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck source=readback_common.sh
source "$(dirname "$0")/readback_common.sh"

rb_require_url readback_pages.sh 'https://HASH.openbed-public-dashboard.pages.dev' "$SITE"
SITE="${SITE%/}"
PAUSE="${READBACK_SERVED_AT_SLEEP:-5}"
rb_head "$ROOT"

JSON_CT='application/json; charset=utf-8'
CACHE='public, s-maxage=30, stale-while-revalidate=300'
ROBOTS='noindex, nofollow'
NOSNIFF='nosniff'
# The page's security headers, read from this checkout's tracked _headers (BP-10).
CSP_WANT="$(rb_tracked_header public-dashboard content-security-policy production)"
REFERRER_WANT="$(rb_tracked_header public-dashboard referrer-policy production)"
SNIFF_WANT="$(rb_tracked_header public-dashboard x-content-type-options production)"
ISO='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'

echo "=== read-back 4: $SITE/version.json, against this checkout's HEAD $RB_HEAD ==="
site_probe GET /version.json
# HTML here is the SPA fallback answering for a missing stamp: a failed deployment.
rb_expect_prefix "read-back 4 body" "$(rb_body 60)" '{'
rb_stamp
rb_expect "read-back 4 commit" "$RB_COMMIT" "$RB_HEAD"
rb_expect "read-back 4 dirty" "$RB_DIRTY" "false"
ast=0
git -C "$ROOT" merge-base --is-ancestor "$RB_HEAD" origin/main || ast=$?
case "$ast" in
    0|1) rb_expect "read-back 4 ancestor check exit (0 means on origin/main)" "$ast" 0 ;;
    *) echo "ERROR: the ancestor check did not run (git merge-base exited $ast) -- this read-back has no verdict"
       exit 2 ;;
esac

echo
echo "=== read-back 6: GET $SITE/beds.json ==="
site_probe GET /beds.json
rb_expect "read-back 6 status" "$RB_CODE" 200
rb_expect "read-back 6 content-type" "$(rb_header content-type)" "$JSON_CT"
rb_expect "read-back 6 x-robots-tag" "$(rb_header x-robots-tag)" "$ROBOTS"
# Set by the Function itself (packages/snapshot/src/serve.ts): Pages is understood not to
# apply _headers to a Function's response (R-2026-09-24-93 BU-2 d).
rb_expect "read-back 6 x-content-type-options" "$(rb_header x-content-type-options)" "$NOSNIFF"
# An {"error": body fails whatever the status line said.
rb_expect_prefix "read-back 6 body" "$(rb_body 120)" '{"v":'

echo
echo "=== read-back 8: GET and HEAD on $SITE/beds.json, each against the exact values ==="
for m in GET HEAD; do
    site_probe "$m" /beds.json
    rb_expect "read-back 8 $m status" "$RB_CODE" 200
    rb_expect "read-back 8 $m content-type" "$(rb_header content-type)" "$JSON_CT"
    rb_expect "read-back 8 $m cache-control" "$(rb_header cache-control)" "$CACHE"
    rb_expect "read-back 8 $m x-robots-tag" "$(rb_header x-robots-tag)" "$ROBOTS"
    rb_expect "read-back 8 $m x-content-type-options" "$(rb_header x-content-type-options)" "$NOSNIFF"
done

echo
echo "=== the page's security headers: GET $SITE/, against this checkout's tracked apps/public-dashboard/public/_headers ==="
site_probe GET /
rb_expect "page status" "$RB_CODE" 200
rb_expect "page content-security-policy" "$(rb_header content-security-policy)" "$CSP_WANT"
rb_expect "page referrer-policy" "$(rb_header referrer-policy)" "$REFERRER_WANT"
rb_expect "page x-content-type-options" "$(rb_header x-content-type-options)" "$SNIFF_WANT"

echo
echo "=== the serve-time stamp: two GETs of $SITE/beds.json, ${PAUSE}s apart ==="
site_probe GET /beds.json
FIRST="$(rb_header x-openbed-served-at)"
sleep "$PAUSE"
site_probe GET /beds.json
SECOND="$(rb_header x-openbed-served-at)"
for pair in "first read:$FIRST" "second read:$SECOND"; do
    label="${pair%%:*}"
    value="${pair#*:}"
    if [[ "$value" =~ $ISO ]]; then
        rb_ok "serve-time stamp, $label" "$value"
    else
        rb_wrong "serve-time stamp, $label" "$value" "must be an ISO time ending Z"
    fi
done
if [[ "$SECOND" > "$FIRST" ]]; then
    rb_ok "serve-time stamp advances" "$FIRST -> $SECOND"
else
    rb_wrong "serve-time stamp advances" "$FIRST -> $SECOND" "the second must be later than the first"
fi

rb_verdict "read-backs 4, 6 and 8, the page's security headers and the serve-time stamp read as they must."
