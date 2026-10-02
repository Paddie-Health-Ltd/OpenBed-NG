#!/usr/bin/env bash
# ============================================================
# scripts/readback_worker_limits.sh
# ============================================================
# THE HOSTED PROOF THAT api.openbed.ng'S VERIFY LIMIT IS LIVE (R-2026-09-30-177 FA-3 i;
# re-sized by R-2026-09-30-178 FB-1 f; sent over ONE CONNECTION by R-2026-09-30-180 FD-1).
# Run ONCE, at W3's hosted step b, after scripts/readback_worker.sh. It is NEVER part of the
# routine read-back, because it spends the caller's own limit: it sends 3L junk
# GET /auth/v1/verify requests in ONE curl invocation, where L is LIMIT_VERIFY's
# `simple.limit` in supabase-proxy/wrangler.json (read from there, never a literal), and
# reads who answered each one from the Worker's `x-openbed-proxy` header. Three times the
# limit, not the limit plus a few, because counting is permissive and eventually
# consistent, so a limited answer needs room to appear.
#
# WHY ONE CONNECTION. Cloudflare's own words (developers.cloudflare.com/workers/runtime-apis/
# bindings/rate-limit/): the counters "are cached on the same machine that your Worker runs
# in, and updated asynchronously in the background", and the API is "permissive, eventually
# consistent, and intentionally designed to not be used as an accurate accounting system".
# A new connection for every request, as this script made until 2026-10-01, lands each
# request on a machine whose count has not caught up. On 2026-10-01 that proof STOPPED
# twice at the founder's hosted run (15 verifies, all forwarded, none limited, the loop
# taking 16 s and then 17 s), and a diagnostic Cowork authorised, the same 15 verifies in a
# single curl invocation, read 6 forwarded and then 9 `limited`: the Worker was right and
# the proof's design was wrong. A real browser or ward handset keeps its connection, which
# is the client this limit is sized for, so this is the client the proof must be. A
# client that opens a new connection per request can exceed the limit until the counts
# catch up, and this script does not claim otherwise. THE PROOF CHECKS THAT IT STAYED ON
# ONE CONNECTION: every request after the first must report `num_connects` 0, or the count
# was split across machines and the read is WRONG.
#
# WHAT IT SPENDS. At most 3L tokens of Supabase's shared per-IP verify bucket, and only if
# the call is slow enough to cross windows: the first L are forwarded in the first 10-second
# window, and the Worker answers the rest itself and spends nothing. Supabase's verify
# bucket BURSTS TO A FIXED 30 that no setting changes (GoTrue's apilimiter.go,
# `SetBurst(30)`), and its REFILL is what W3 hosted step a raises; the sleep below also lets
# that burst refill first. So the proof is safe only AFTER step a has raised the refill: at
# the dashboard's default it could use half the burst every ward on this address shares.
#
# IT SLEEPS 61 SECONDS BEFORE SENDING, so that probe 7 of readback_worker.sh, or any link
# opened from the same network a moment ago, counted in an EARLIER 10-second window and
# cannot make the first L read `limited`, and so that Supabase's verify burst has refilled.
# READBACK_LIMITS_SLEEP overrides the 61 (the test harness sets it to 0); it is not for use
# on hosted.
#
# IT NEEDS curl 7.84.0 OR LATER, the first release whose -w prints a response header
# (`%header{name}`). An older curl prints that variable BLANK and exits 0, which would read
# every answer as neither forwarded nor limited, so the version is read FIRST, before the
# sleep, and an older one is an ERROR with nothing sent.
#
# THE VERDICT.
#   PASS  the first L all read `forwarded`, and at least one later answer reads a 429
#         marked `limited`; and every request after the first reused the first connection.
#   STOP  (exit 1)
#         - a 429 WITHOUT `limited`: that is Supabase's own bucket, not the Worker's;
#         - `limited` on any of the first L: the limit is lower than wrangler.json says;
#         - any answer that reads neither `forwarded` nor `limited`;
#         - a request after the first that opened a NEW connection (`connection reuse`):
#           the count was split across machines, so the read proves nothing;
#         - no 429 at all. Over one connection a miss is a real STOP the first time, for
#           Cowork: paste the whole output back. The STOP prints the call's elapsed seconds:
#           a call longer than about 10 seconds can cross a window boundary, and that
#           number says whether it did.
#   ERROR (exit 2) a curl failure or a curl older than 7.84.0, a curl that printed fewer
#         result lines than requests (rb_fetch_times), a wrangler.json with no usable
#         limit, or a sleep override that is not a whole number: nothing was proved.
#
# Usage: bash scripts/readback_worker_limits.sh https://api.openbed.ng [ROOT]
#   ROOT is the deploy checkout; it is the test seam.
# Exit: 0 PASS; 1 STOP; 2 nothing was checked, or a check could not run.
#
# NOT ASSERTED HERE, deliberately: that a given address is limited at EVERY Cloudflare
# location, or for a client that opens a new connection per request. Counters are per
# machine and eventually consistent, so this proves the limit is live for a client on one
# connection, at the location that served this run, from this address, and nothing wider.
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

# curl's -w prints a response header only from 7.84.0 (%header{}). Read the version line the way
# readback_admin.sh does, and refuse BEFORE the sleep and before anything is sent: an older curl
# prints the variable blank and exits 0. The line is read on its own line, where a failure aborts.
CURL_LINE="$(curl --version | sed -n 1p)"
cver="${CURL_LINE#curl }"
cmajor="${cver%%.*}"
cminor="${cver#*.}"
cminor="${cminor%%[!0-9]*}"
case "$CURL_LINE" in curl\ *) ;; *) cmajor=bad ;; esac
case "$cmajor" in ''|*[!0-9]*) cmajor=bad ;; esac
case "$cminor" in ''|*[!0-9]*) cminor=bad ;; esac
cok=0
if [ "$cmajor" != bad ] && [ "$cminor" != bad ]; then
    if [ "$cmajor" -gt 7 ] || { [ "$cmajor" -eq 7 ] && [ "$cminor" -ge 84 ]; }; then cok=1; fi
fi
if [ "$cok" -ne 1 ]; then
    echo "ERROR: the -w option's %header{} needs curl 7.84.0 or later, and this curl reads $CURL_LINE, so the proof cannot read the Worker's answers; nothing was sent"
    exit 2
fi

TOTAL=$((LIMIT * 3))
echo "=== LIMIT_VERIFY is $LIMIT per 10 seconds (supabase-proxy/wrangler.json): sleeping ${PAUSE}s, then sending $TOTAL verify requests over ONE connection ==="
sleep "$PAUSE"

limited_seen=0
SECONDS=0
api_probe GET /auth/v1/verify --rb-times "$TOTAL" -G --data-urlencode 'token=probe' --data-urlencode 'type=magiclink' --data-urlencode "redirect_to=$ADMIN_ORIGIN/"
elapsed="$SECONDS"
i=1
while [ "$i" -le "$TOTAL" ]; do
    code="${RB_T_CODE[$((i - 1))]}"
    who="${RB_T_WHO[$((i - 1))]}"
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

# Every request after the first must have reused the first one's connection (`num_connects` 0).
# A request on a new connection can land on a machine whose count has not caught up, so the
# count was split and nothing below it proves anything. Read BEFORE the no-429 check, which a
# split count explains and which must not be reported on top of it.
split=0
i=2
while [ "$i" -le "$TOTAL" ]; do
    if [ "${RB_T_CONNECTS[$((i - 1))]}" != 0 ]; then
        split=$((split + 1))
    fi
    i=$((i + 1))
done
if [ "$split" -eq 0 ]; then
    rb_ok "connection reuse" "every one of the $((TOTAL - 1)) requests after the first reused its connection"
else
    rb_wrong "connection reuse" "$split of the $((TOTAL - 1)) requests after the first opened a new connection" "none: the requests did not share one connection, so the count was split across machines and proves nothing"
fi

if [ "$limited_seen" -eq 0 ] && [ "$RB_OK" = 1 ]; then
    rb_wrong "a limited answer" "none in $TOTAL requests over one connection, the call took ${elapsed}s" "at least one 429 marked 'limited' after the first $LIMIT. Over one connection a miss is a real STOP the first time: paste this whole output back for Cowork (a call over about 10s can cross a window boundary: the elapsed seconds say whether it did)"
fi

rb_verdict "the first $LIMIT verify requests were forwarded and a later one was limited by the Worker, over one connection, so LIMIT_VERIFY is live for a client on one connection at this address and location."
