#!/usr/bin/env bash
# ============================================================
# scripts/readback_worker_limits.sh
# ============================================================
# THE HOSTED PROOF THAT api.openbed.ng'S VERIFY LIMIT IS LIVE (R-2026-09-30-177 FA-3 i).
# Run ONCE, at W3's hosted step b, after scripts/readback_worker.sh. It is NEVER part
# of the routine read-back, because it spends the caller's own limit: it sends L+5
# junk GET /auth/v1/verify requests in one loop, where L is LIMIT_VERIFY's
# `simple.limit` in supabase-proxy/wrangler.json (read from there, never a literal), and
# reads who answered each one from the Worker's `x-openbed-proxy` header.
#
# WHAT IT SPENDS. Up to L+5 tokens of Supabase's shared per-IP verify bucket (the first L
# are forwarded; the Worker answers the rest itself and spends nothing). It must run only
# AFTER the Supabase bucket has been raised (W3 hosted step a): at the dashboard's
# default of 30 it would use two thirds of the bucket every ward on this address shares.
#
# IT SLEEPS 61 SECONDS BEFORE SENDING, so that probe 7 of readback_worker.sh, or any link
# opened from the same network a moment ago, counted in an EARLIER 60-second window and
# cannot make the first L read `limited`. READBACK_LIMITS_SLEEP overrides the 61 (the
# test harness sets it to 0); it is not for use on hosted.
#
# THE VERDICT.
#   PASS  the first L all read `forwarded`, and at least one later answer reads a 429
#         marked `limited`.
#   STOP  (exit 1)
#         - a 429 WITHOUT `limited`: that is Supabase's own bucket, not the Worker's;
#         - `limited` on any of the first L: the limit is lower than wrangler.json says;
#         - any answer that reads neither `forwarded` nor `limited`;
#         - no 429 at all. Counting is permissive and eventually consistent, and counters
#           are local to each Cloudflare location, so wait 2 minutes and run it once
#           more. A SECOND run with no 429 is a real STOP for Cowork.
#   ERROR (exit 2) a curl failure (rb_fetch), a wrangler.json with no usable limit, or a
#         sleep override that is not a whole number: nothing was proved.
#
# Usage: bash scripts/readback_worker_limits.sh https://api.openbed.ng [ROOT]
#   ROOT is the deploy checkout; it is the test seam.
# Exit: 0 PASS; 1 STOP; 2 nothing was checked, or a check could not run.
#
# NOT ASSERTED HERE, deliberately: that a given address is limited at EVERY Cloudflare
# location. Counters are per location and eventually consistent, so this proves the limit
# is live at the location that served this run, from this address, and nothing wider.
# ============================================================
set -euo pipefail

API="${1:-}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck source=readback_common.sh
source "$(dirname "$0")/readback_common.sh"

rb_require_url readback_worker_limits.sh 'https://api.openbed.ng' "$API"
API="${API%/}"

# The admin origin, as in readback_worker.sh probe 7: held equal to TARGETS.admin in
# scripts/readback_signin_link.mjs by tests/compliance/readback_scripts.test.ts.
ADMIN_ORIGIN='https://admin.openbed.ng'

lst=0
LIMIT="$(node -e '
const fs = require("fs");
const w = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const b = (w.ratelimits || []).find((x) => x.name === "LIMIT_VERIFY");
const n = b && b.simple && b.simple.limit;
if (!Number.isInteger(n) || n < 1) process.exit(3);
process.stdout.write(String(n));
' "$ROOT/supabase-proxy/wrangler.json" 2>/dev/null)" || lst=$?
if [ "$lst" -ne 0 ] || [ -z "$LIMIT" ]; then
    echo "ERROR: could not read LIMIT_VERIFY's simple.limit from $ROOT/supabase-proxy/wrangler.json (node exited $lst) -- nothing was sent"
    exit 2
fi

PAUSE="${READBACK_LIMITS_SLEEP:-61}"
case "$PAUSE" in
    ''|*[!0-9]*)
        echo "ERROR: READBACK_LIMITS_SLEEP='$PAUSE' is not a whole number of seconds -- nothing was sent"
        exit 2 ;;
esac

TOTAL=$((LIMIT + 5))
echo "=== LIMIT_VERIFY is $LIMIT a minute (supabase-proxy/wrangler.json): sleeping ${PAUSE}s, then sending $TOTAL verify requests ==="
sleep "$PAUSE"

limited_seen=0
i=1
while [ "$i" -le "$TOTAL" ]; do
    api_probe GET /auth/v1/verify -G --data-urlencode 'token=probe' --data-urlencode 'type=magiclink' --data-urlencode "redirect_to=$ADMIN_ORIGIN/"
    code="$RB_CODE"
    who="$(rb_header x-openbed-proxy)"
    label="request $i of $TOTAL"
    if [ "$code" = "429" ] && [ "$who" != "limited" ]; then
        rb_wrong "$label" "$code, x-openbed-proxy '$who'" "a 429 must read 'limited': this one is Supabase's own bucket, not the Worker's"
    elif [ "$who" = "limited" ]; then
        if [ "$code" != "429" ]; then
            rb_wrong "$label" "$code, x-openbed-proxy 'limited'" "a limited answer must be a 429"
        elif [ "$i" -le "$LIMIT" ]; then
            rb_wrong "$label" "$code, x-openbed-proxy 'limited'" "must be 'forwarded': one of the first $LIMIT was limited, so the limit is lower than wrangler.json says"
        else
            limited_seen=1
            rb_ok "$label" "$code, x-openbed-proxy 'limited'"
        fi
    elif [ "$who" = "forwarded" ]; then
        rb_ok "$label" "$code, x-openbed-proxy 'forwarded'"
    else
        rb_wrong "$label" "$code, x-openbed-proxy '$who'" "must be 'forwarded', or 'limited' after the first $LIMIT"
    fi
    i=$((i + 1))
done

if [ "$limited_seen" -eq 0 ] && [ "$RB_OK" = 1 ]; then
    rb_wrong "a limited answer" "none in $TOTAL requests" "at least one 429 marked 'limited' after the first $LIMIT. Counting is eventually consistent: wait 2 minutes and run this once more. A second run with no 429 is a real STOP for Cowork"
fi

rb_verdict "the first $LIMIT verify requests were forwarded and a later one was limited by the Worker, so LIMIT_VERIFY is live at this address and location."
