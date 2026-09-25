#!/usr/bin/env bash
# ============================================================
# scripts/readback_admin.sh
# ============================================================
# THE ADMIN APP'S DEPLOY READ-BACK (R-2026-09-24-97; the PR 3.4b-app C design report,
# section 6.3, with BY-2 a). docs/runbook-admin-deploy.md runs it at H6 step 2. The
# contract every read-back keeps is in scripts/readback_common.sh.
#
# CLOUDFLARE ACCESS SITS IN FRONT OF THIS APP (R-2026-09-24-89 BQ-2), so there are
# two halves, and the FAILING HALF RUNS FIRST:
#
#   STEP 1 -- NO TOKEN. admin.openbed.ng, the project's production pages.dev host and
#   the deployment URL must each answer with ACCESS, never with the app: a redirect to
#   a *.cloudflareaccess.com login, or a 403. ANY 200 IS WRONG, and so is a version
#   stamp or the app's bundle in the body: the page is being served around Access.
#   The pages.dev hosts are probed because Access on the custom domain alone leaves
#   them open (BQ-2 a). The project name is read from apps/admin/wrangler.toml.
#
#   STEP 2 -- WITH THE SERVICE TOKEN. The stamp on the deployment and on
#   admin.openbed.ng names this checkout's HEAD; the page's security headers are what
#   this checkout's tracked _headers sets, as rendered; the page loads one bundle,
#   holding one publishable key.
#
#   STEP 3 -- THE API. The deployed key is accepted and a wrong one refused (the ward
#   console's two halves), and the Worker FORWARDS an operator call: with no key,
#   operator_register must be forwarded and refused by Supabase with 401, the answer
#   readback_worker.sh's probe 1 observed for my_facility_wards. A Worker `refused`
#   there means H5, the Worker redeploy with the admin entries, has not landed.
#
# THE SERVICE TOKEN (BQ-2 b). Read ONLY from the environment, as
# OPENBED_ACCESS_CLIENT_ID and OPENBED_ACCESS_CLIENT_SECRET; never an argument, never
# tracked, never printed. It is written, with mode 600, to a header file inside this
# run's own temporary directory (removed on exit by readback_common.sh's trap) and
# passed as `curl -H @file`, so it is not in any process's argument list either. A
# missing token is an ERROR with exit 2, never a PASS: step 2 did not run.
#
# --local (R-2026-09-24-97 BY-2 a). PR C merges on LOCAL evidence, because the admin
# Pages project and Access are created at H6. With --local the URL must be a local
# host, served by `wrangler pages dev`. Step 2 runs in full without a token. Step 1,
# the token half and the Worker probe are NOT RUN, and neither are the two key halves:
# the local stack answers /auth/v1/settings with 200 for ANY key (observed 2026-09-24),
# so neither half could fail there. Instead the bundle's key is held to the tracked
# production key. The output says what did not run, and the verdict says LOCAL. It is
# never evidence that admin is live: that is H6 steps 2, 6 and 7.
#
# NOT ASSERTED HERE, deliberately (method note 12): what Access answers exactly. The
# two accepted forms are the documented ones, [unverified] on this project until H6;
# anything else reads WRONG, which is the safe direction.
#
# Usage: bash scripts/readback_admin.sh [--local] DEPLOYMENT-URL [ROOT]
#   DEPLOYMENT-URL is https://<hash>.openbed-admin.pages.dev (as wrangler printed it),
#   or with --local http://127.0.0.1:<port>. ROOT is the test seam.
# Exit: 0 PASS; 1 STOP; 2 nothing was checked, or a check could not run.
# ============================================================
set -euo pipefail

LOCAL=0
if [ "${1:-}" = "--local" ]; then LOCAL=1; shift; fi
SITE="${1:-}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
API="https://api.openbed.ng"
# shellcheck source=readback_common.sh
source "$(dirname "$0")/readback_common.sh"

if [ "$LOCAL" = 1 ]; then
    case "$SITE" in
        http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) ;;
        *)
            echo "ERROR: --local takes only a local address (http://127.0.0.1:PORT), and '$SITE' is not one -- nothing was probed"
            exit 2 ;;
    esac
else
    rb_require_url readback_admin.sh 'https://HASH.openbed-admin.pages.dev' "$SITE"
fi
SITE="${SITE%/}"
rb_head "$ROOT"

PROJECT="$(sed -n 's/^name *= *"\([^"]*\)".*/\1/p' "$ROOT/apps/admin/wrangler.toml" 2>/dev/null)"
if [ -z "$PROJECT" ]; then
    echo "ERROR: apps/admin/wrangler.toml names no Pages project in this checkout, so the hosts to probe are unknown -- nothing was checked"
    exit 2
fi

# The page's security headers, read from this checkout's tracked _headers as rendered.
CSP_WANT="$(rb_tracked_header admin content-security-policy)"
REFERRER_WANT="$(rb_tracked_header admin referrer-policy)"
SNIFF_WANT="$(rb_tracked_header admin x-content-type-options)"

# access_gate LABEL -- the last response must be Access's, never the app's.
access_gate() {
    local label="$1" location
    location="$(rb_header location)"
    case "$RB_CODE" in
        301|302|303|307)
            case "$location" in
                https://*.cloudflareaccess.com/*) rb_ok "$label" "$RB_CODE to Access" ;;
                *) rb_wrong "$label" "$RB_CODE to '$location'" "must redirect to a *.cloudflareaccess.com login" ;;
            esac ;;
        403) rb_ok "$label" "403 from Access" ;;
        *) rb_wrong "$label" "$RB_CODE" "must be Access's redirect or 403 -- a page served without the token is served around Access" ;;
    esac
    rb_stamp
    if [ "$RB_COMMIT" != "(not a stamp)" ]; then rb_wrong "$label body" "a version stamp" "must not be the app's stamp"; fi
    rb_matches 'assets/index-[A-Za-z0-9_-]*\.js'
    if [ "$RB_COUNT" != 0 ]; then rb_wrong "$label body" "the app's bundle" "must not be the app shell"; fi
}

if [ "$LOCAL" = 1 ]; then
    echo "=== step 1: NOT RUN (local) -- Access and its service token exist only on the hosted project (H6) ==="
else
    echo "=== step 1: no Access token -- every host must answer with Access, never the app ==="
    SITE_BEFORE="$SITE"
    for host in "https://admin.openbed.ng" "https://$PROJECT.pages.dev" "$SITE_BEFORE"; do
        SITE="$host"
        site_probe GET /version.json
        access_gate "step 1 $host/version.json"
        site_probe GET /
        access_gate "step 1 $host/"
    done
    SITE="$SITE_BEFORE"
fi

ACCESS=()
if [ "$LOCAL" = 0 ]; then
    if [ -z "${OPENBED_ACCESS_CLIENT_ID:-}" ] || [ -z "${OPENBED_ACCESS_CLIENT_SECRET:-}" ]; then
        echo "ERROR: OPENBED_ACCESS_CLIENT_ID and OPENBED_ACCESS_CLIENT_SECRET must both be set in the environment -- the token half cannot run, so this read-back has no verdict"
        exit 2
    fi
    ver="$(curl --version | sed -n '1s/^curl \([0-9]*\)\.\([0-9]*\).*/\1 \2/p')"
    major="${ver% *}"
    minor="${ver#* }"
    if [ -z "$ver" ] || [ "$major" -lt 7 ] || { [ "$major" -eq 7 ] && [ "$minor" -lt 55 ]; }; then
        echo "ERROR: this curl cannot read headers from a file (-H @file needs 7.55 or later), so the token would have to go on the command line -- nothing was sent"
        exit 2
    fi
    (umask 077 && printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' "$OPENBED_ACCESS_CLIENT_ID" "$OPENBED_ACCESS_CLIENT_SECRET" > "$RB_TMP/access-headers")
    ACCESS=(-H "@$RB_TMP/access-headers")
fi

echo
echo "=== step 2: $SITE/version.json, against this checkout's HEAD $RB_HEAD ==="
site_probe GET /version.json ${ACCESS[@]+"${ACCESS[@]}"}
rb_stamp
rb_expect "step 2 commit" "$RB_COMMIT" "$RB_HEAD"
rb_expect "step 2 dirty" "$RB_DIRTY" "false"
if [ "$LOCAL" = 0 ]; then
    SITE_BEFORE="$SITE"
    SITE="https://admin.openbed.ng"
    site_probe GET /version.json ${ACCESS[@]+"${ACCESS[@]}"}
    rb_stamp
    rb_expect "step 2 admin.openbed.ng commit" "$RB_COMMIT" "$RB_HEAD"
    SITE="$SITE_BEFORE"
fi

site_probe GET / ${ACCESS[@]+"${ACCESS[@]}"}
rb_expect "step 2 content-security-policy" "$(rb_header content-security-policy)" "$CSP_WANT"
rb_expect "step 2 referrer-policy" "$(rb_header referrer-policy)" "$REFERRER_WANT"
rb_expect "step 2 x-content-type-options" "$(rb_header x-content-type-options)" "$SNIFF_WANT"
rb_matches 'assets/index-[A-Za-z0-9_-]*\.js'
BUNDLE="$RB_MATCHES"
rb_expect "step 2 bundles the page loads" "$RB_COUNT" 1
if [ "$RB_COUNT" != 1 ]; then rb_verdict "unreachable"; fi
echo "  bundle: $BUNDLE"

site_probe GET "/$BUNDLE" ${ACCESS[@]+"${ACCESS[@]}"}
rb_matches 'sb_publishable_[A-Za-z0-9_-]*'
DEPLOYED_KEY="$RB_MATCHES"
rb_expect "step 2 publishable keys in the deployed bundle" "$RB_COUNT" 1
if [ "$RB_COUNT" != 1 ]; then rb_verdict "unreachable"; fi

echo
echo "=== step 3: the API ==="
if [ "$LOCAL" = 1 ]; then
    # The bundle's key, held to the tracked production key: the one key half a local
    # run CAN read, since the bundle is this checkout's own build.
    st=0
    TRACKED_KEY="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).production)' "$ROOT/packages/origins/publishable-keys.json")" || st=$?
    if [ "$st" -ne 0 ] || [ -z "$TRACKED_KEY" ]; then
        echo "ERROR: could not read packages/origins/publishable-keys.json (node exited $st) -- the key check did not run, so this read-back has no verdict"
        exit 2
    fi
    rb_expect "step 3 the bundle's key is the tracked production key" "$DEPLOYED_KEY" "$TRACKED_KEY"
    # NOT RUN, and why: the local stack does not enforce the key on /auth/v1/settings --
    # observed 2026-09-24, a deliberately wrong key answers 200 there. Both halves would
    # pass whatever key was sent, which is a probe that cannot fail.
    echo "  NOT RUN (local): the live and dead key halves -- the local stack answers /auth/v1/settings with 200 for ANY key (observed 2026-09-24), so neither half could fail here"
    echo "  NOT RUN (local): the Worker probe -- there is no Worker in front of the local API"
    echo
    # Restated 2026-09-25 (R-2026-09-25-113): admin went live that day, at H6. Until
    # then this line ended "admin is not live until H6 steps 2, 6 and 7 read as they must."
    echo "LOCAL RUN: step 1, the token half, both key halves and the Worker probe were NOT RUN. This is not a production verdict, and a local PASS is never evidence of what hosted admin serves: only the hosted read-back (H6 step 2) is."
    rb_verdict "LOCAL -- the local build's stamp names this checkout, and it ships this checkout's rendered headers and the tracked production key."
fi

api_probe GET /auth/v1/settings -H "apikey: $DEPLOYED_KEY"
LIVE_CODE="$RB_CODE"
rb_expect "step 3 live half status" "$LIVE_CODE" 200
rb_expect_prefix "step 3 live half body" "$(rb_body 60)" '{"external":'

api_probe GET /auth/v1/settings -H "apikey: sb_publishable_DELIBERATELY_WRONG_FOR_THE_FAILING_HALF"
DEAD_CODE="$RB_CODE"
rb_expect "step 3 dead half status" "$DEAD_CODE" 401
rb_expect_contains "step 3 dead half body" "$(rb_body 200)" '"message":"Invalid API key"'

# The Worker forwards an operator call (H5). With no key, forwarded and refused by
# Supabase with 401: the answer readback_worker.sh's probe 1 reads for my_facility_wards.
api_probe POST /rest/v1/rpc/operator_register -H 'Content-Type: application/json' -d '{}'
rb_expect "step 3 operator call status" "$RB_CODE" 401
rb_expect "step 3 operator call x-openbed-proxy" "$(rb_header x-openbed-proxy)" "forwarded"

rb_verdict "Access answers every host without the token; with it, the stamp names this checkout and the page ships this checkout's headers and key; the key is accepted, a wrong one refused, and the Worker forwards the operator calls."
