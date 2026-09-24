#!/usr/bin/env bash
# ============================================================
# scripts/readback_ward_console.sh
# ============================================================
# THE WARD CONSOLE'S DEPLOY READ-BACK: the stamp (step 2) and the live-key probe
# with both of its halves (step 3) of docs/runbook-ward-console-deploy.md
# (R-2026-09-23-64). Until the R-2026-09-23-70 H4 note these were pasted fences, and
# on H4 the paste produced a false STOP. Why they are a script now, and the contract
# every read-back keeps, is in scripts/readback_common.sh.
#
# WHY THE KEY IS READ OUT OF THE DEPLOYED BUNDLE, NEVER OUT OF THE REPOSITORY. The
# property is that the key the deployment actually ships is accepted. A key read
# from a checkout would prove something about the checkout.
#
# WHY /auth/v1/settings, AND NOT /rest/v1/. Observed 2026-09-23 (R-2026-09-23-64 C):
# at the PostgREST root, a live key and a dead key BOTH answer 401. At
# /auth/v1/settings a live key answers 200 and a dead one 401 "Invalid API key". It
# is a settings read, not a sign-in, so it sends no email and does not touch the
# auth limits that R-2026-09-19-23 D4 forbids exercising.
#
# THE FAILING HALF IS NOT OPTIONAL. The same request is sent with a deliberately
# wrong key, and it must be refused. Without that half, a probe that could never fail
# would read exactly like one that passed.
#
# Usage: bash scripts/readback_ward_console.sh DEPLOYMENT-URL [ROOT]
#   DEPLOYMENT-URL is the https://<hash>.openbed-ward-console.pages.dev address
#   wrangler printed, or https://app.openbed.ng, which serves the same deployment.
#   Run this from the deploy checkout you deployed from. ROOT is the test seam.
# Exit: 0 PASS; 1 STOP; 2 nothing was checked, or a check could not run.
# ============================================================
set -euo pipefail

SITE="${1:-}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
API="https://api.openbed.ng"
# shellcheck source=readback_common.sh
source "$(dirname "$0")/readback_common.sh"

rb_require_url readback_ward_console.sh 'https://HASH.openbed-ward-console.pages.dev' "$SITE"
SITE="${SITE%/}"
rb_head "$ROOT"

echo "=== step 2: $SITE/version.json, against this checkout's HEAD $RB_HEAD ==="
# The page's security headers, read from this checkout's tracked _headers (BP-10).
CSP_WANT="$(rb_tracked_header ward-console content-security-policy)"
REFERRER_WANT="$(rb_tracked_header ward-console referrer-policy)"
SNIFF_WANT="$(rb_tracked_header ward-console x-content-type-options)"

site_probe GET /version.json
rb_stamp
rb_expect "step 2 commit" "$RB_COMMIT" "$RB_HEAD"
rb_expect "step 2 dirty" "$RB_DIRTY" "false"

echo
echo "=== step 3: the live-key probe, both halves ==="
site_probe GET /
# The page's security headers, against this checkout's tracked _headers (BP-10), read
# from the same response the bundle is found in.
rb_expect "step 3 content-security-policy" "$(rb_header content-security-policy)" "$CSP_WANT"
rb_expect "step 3 referrer-policy" "$(rb_header referrer-policy)" "$REFERRER_WANT"
rb_expect "step 3 x-content-type-options" "$(rb_header x-content-type-options)" "$SNIFF_WANT"
rb_matches 'assets/index-[A-Za-z0-9_-]*\.js'
BUNDLE="$RB_MATCHES"
rb_expect "step 3 bundles the page loads" "$RB_COUNT" 1
if [ "$RB_COUNT" != 1 ]; then rb_verdict "unreachable"; fi
echo "  bundle: $BUNDLE"

site_probe GET "/$BUNDLE"
rb_matches 'sb_publishable_[A-Za-z0-9_-]*'
DEPLOYED_KEY="$RB_MATCHES"
rb_expect "step 3 publishable keys in the deployed bundle" "$RB_COUNT" 1
if [ "$RB_COUNT" != 1 ]; then rb_verdict "unreachable"; fi

api_probe GET /auth/v1/settings -H "apikey: $DEPLOYED_KEY"
LIVE_CODE="$RB_CODE"
rb_expect "step 3 live half status" "$LIVE_CODE" 200
rb_expect_prefix "step 3 live half body" "$(rb_body 60)" '{"external":'

api_probe GET /auth/v1/settings -H "apikey: sb_publishable_DELIBERATELY_WRONG_FOR_THE_FAILING_HALF"
DEAD_CODE="$RB_CODE"
rb_expect "step 3 dead half status" "$DEAD_CODE" 401
rb_expect_contains "step 3 dead half body" "$(rb_body 200)" '"message":"Invalid API key"'

rb_verdict "the stamp names this checkout, the deployed key is accepted at the edge, and a wrong key is refused."
