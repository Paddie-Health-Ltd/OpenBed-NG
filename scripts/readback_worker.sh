#!/usr/bin/env bash
# ============================================================
# scripts/readback_worker.sh
# ============================================================
# THE api.openbed.ng WORKER'S READ-BACK: probes 1 to 3 (with 1b, the HEFAMAA write's
# path, R-2026-09-27-144 DT k), probes 5, 5b, 6 and 7 (R-2026-09-30-177 FA-1: no
# service the Worker must not reach, no websocket upgrade, and the sign-in link's
# redirect), probe 8 (R-2026-10-02-FF FF-5: the request the sensor sends), and the stamp
# of docs/runbook-cloudflare-worker-proxy.md (R-2026-09-23-70). Probe 4, the deployed source equalling the repository's, is read by
# Cowork through the Cloudflare connector, and nothing here can stand in for it.
#
# PROBES 5, 5b, 6 AND 7 (FA-1 c, d):
#   5   GET /realtime/v1/websocket with a websocket upgrade, over HTTP/1.1: refused by
#       the Worker. Over HTTP/2, curl's default, curl drops Upgrade and Connection, and
#       without the two Sec-WebSocket headers Cloudflare's own edge answers 400 before
#       the Worker runs, so all four headers are sent.
#   5b  the SAME four headers on GET /auth/v1/settings, a LISTED path, with the tracked
#       key: refused by the Worker, because the handler refuses any request carrying
#       Upgrade before it reads the allow-list. This is the only hosted test of that
#       rule, and it is an ordinary probe of a listed path, not a refusal probe.
#   6   GET /storage/v1/object/public/probe: a service the Worker never reaches.
#   7   GET /auth/v1/verify with a junk token and redirect_to the admin origin: forwarded,
#       a 3xx, and a Location whose origin is EXACTLY the admin origin. The Site URL
#       (the ward console) is what GoTrue falls back to when it loses redirect_to, so
#       a Worker that drops the parameter reads WRONG here. Probe 7 spends one token
#       of the shared verify bucket per run.
#   8   GET /auth/v1/settings with the tracked key as `apikey` in the QUERY, and no header:
#       exactly the request the second sensor monitor (docs/runbook-sensor.md section 1) makes,
#       because UptimeRobot's Free plan cannot send a custom header. It must read 200 (so the
#       hosted gateway accepts a publishable key in the query: NOT CONFIRMED before this probe
#       reads it, and why the monitor is created only after this reads PASS), `forwarded`, and
#       a body carrying GoTrue's own `disable_signup`, which the Worker's refusal, Cloudflare's
#       error pages and the site's HTML cannot contain. These are rb_expect reads, not legs.
#       The key is never printed: rb_curl_error names the URL without the -G data.
#       Restated 2026-10-03 (R-2026-10-03-FH FH-1 c, -184): probe 8 is CONFIRMED on hosted. It
#       read 200, `forwarded`, with `disable_signup` found, on the founder's W4 run of
#       2026-10-03 (read back by Cowork), so the hosted gateway DOES take a publishable key
#       from the query. Until then the parenthesis above read "(so the hosted gateway accepts a
#       publishable key in the query: NOT CONFIRMED before this probe reads it, and why the
#       monitor is created only after this reads PASS)". That was true before the reading and
#       is not now; the sentence is kept as it was, and this one supersedes it.
#   And `limits_bound` in the stamp: all three rate-limit bindings must read true. The
#   bindings are invisible in the dashboard and Worker logging is off, so this is the
#   only place a missing one is visible. Why these are a script and not
# pasted fences, and the contract every read-back keeps, is in
# scripts/readback_common.sh.
#
# EVERY PROBE PROVES WHO ANSWERED BY A HEADER, never by a body shape (-70 C1). The
# Worker marks each answer `x-openbed-proxy: forwarded`, `refused` or `stamp`.
# Hosted's no-key answer comes from Supabase's gateway, with a body this repository
# does not control. The one body read here is probe 3's, which the Worker itself
# writes.
#
# PROBE 2's HEAD HALF READS 405, AS OBSERVED ON HOSTED ON 2026-09-23 (the -70 H5 note).
# The runbook said 200 until then, a value written without being observed. Supabase
# does not serve HEAD on /auth/v1/settings, so the 405 carrying `forwarded` is what
# proves the Worker forwarded it, and the GET half is what proves the key is accepted.
#
# Usage: bash scripts/readback_worker.sh https://api.openbed.ng [ROOT]
#   Run it from the deploy checkout the Worker was deployed from: the stamp is
#   compared with that checkout's HEAD. The tracked publishable key and the project
#   ref are read from that checkout. ROOT is the test seam.
# Exit: 0 PASS; 1 STOP; 2 nothing was checked, or a check could not run.
# ============================================================
set -euo pipefail

API="${1:-}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck source=readback_common.sh
source "$(dirname "$0")/readback_common.sh"

rb_require_url readback_worker.sh 'https://api.openbed.ng' "$API"
API="${API%/}"
rb_head "$ROOT"

kst=0
KEY="$(node -e 'process.stdout.write(require(process.argv[1]).production)' "$ROOT/packages/origins/publishable-keys.json" 2>/dev/null)" || kst=$?
if [ "$kst" -ne 0 ] || [ -z "$KEY" ]; then
    echo "ERROR: could not read the tracked publishable key from $ROOT/packages/origins/publishable-keys.json (node exited $kst) -- nothing was checked"
    exit 2
fi
fst=0
REF="$(node -e 'process.stdout.write(new URL(require(process.argv[1]).supabaseDirect.production).hostname.split(".")[0])' "$ROOT/packages/origins/origins.json" 2>/dev/null)" || fst=$?
if [ "$fst" -ne 0 ] || [ -z "$REF" ]; then
    echo "ERROR: could not read the Supabase project ref from $ROOT/packages/origins/origins.json (node exited $fst) -- nothing was checked"
    exit 2
fi

echo "=== probe 1: no key -- forwarded, and refused by Supabase's gateway ==="
api_probe POST /rest/v1/rpc/my_reporting_wards -H 'Content-Type: application/json' -d '{}'
rb_expect "probe 1 status" "$RB_CODE" 401
rb_expect "probe 1 sb-project-ref" "$(rb_header sb-project-ref)" "$REF"
rb_expect "probe 1 x-openbed-proxy" "$(rb_header x-openbed-proxy)" "forwarded"

echo
echo "=== probe 1b: the HEFAMAA write, no key -- forwarded, and refused by Supabase's gateway (R-2026-09-27-144 DT k) ==="
api_probe POST /rest/v1/rpc/operator_record_registration -H 'Content-Type: application/json' -d '{}'
rb_expect "probe 1b status" "$RB_CODE" 401
rb_expect "probe 1b sb-project-ref" "$(rb_header sb-project-ref)" "$REF"
rb_expect "probe 1b x-openbed-proxy" "$(rb_header x-openbed-proxy)" "forwarded"

echo
echo "=== probe 2: the tracked key -- forwarded, and accepted ==="
api_probe GET /auth/v1/settings -H "apikey: $KEY"
rb_expect "probe 2 GET status" "$RB_CODE" 200
rb_expect "probe 2 GET x-openbed-proxy" "$(rb_header x-openbed-proxy)" "forwarded"
api_probe HEAD /auth/v1/settings -H "apikey: $KEY"
rb_expect "probe 2 HEAD status" "$RB_CODE" 405
rb_expect "probe 2 HEAD x-openbed-proxy" "$(rb_header x-openbed-proxy)" "forwarded"

echo
echo "=== probe 3: off the list -- refused by the Worker, and Supabase never asked ==="
api_probe GET /rest/v1/
rb_expect "probe 3 status" "$RB_CODE" 404
rb_expect "probe 3 x-openbed-proxy" "$(rb_header x-openbed-proxy)" "refused"
rb_expect_contains "probe 3 body" "$(rb_body 200)" '{"message":"not forwarded by the OpenBed proxy"}'

# The admin origin probe 7 must land on. Held equal to TARGETS.admin in
# scripts/readback_signin_link.mjs by tests/compliance/readback_scripts.test.ts.
ADMIN_ORIGIN='https://admin.openbed.ng'

echo
echo "=== probe 5: a websocket upgrade on a service the Worker never reaches -- refused by the Worker ==="
api_probe GET /realtime/v1/websocket --http1.1 -H 'Upgrade: websocket' -H 'Connection: Upgrade' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='
rb_expect "probe 5 status" "$RB_CODE" 404
rb_expect "probe 5 x-openbed-proxy" "$(rb_header x-openbed-proxy)" "refused"
rb_expect_contains "probe 5 body" "$(rb_body 200)" '{"message":"not forwarded by the OpenBed proxy"}'

echo
echo "=== probe 5b: the same upgrade on a LISTED path, with the tracked key -- refused by the Worker, never forwarded ==="
api_probe GET /auth/v1/settings --http1.1 -H "apikey: $KEY" -H 'Upgrade: websocket' -H 'Connection: Upgrade' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='
rb_expect "probe 5b status" "$RB_CODE" 404
rb_expect "probe 5b x-openbed-proxy" "$(rb_header x-openbed-proxy)" "refused"
rb_expect_contains "probe 5b body" "$(rb_body 200)" '{"message":"not forwarded by the OpenBed proxy"}'

echo
echo "=== probe 6: Storage -- a service the Worker never reaches, refused by the Worker ==="
api_probe GET /storage/v1/object/public/probe
rb_expect "probe 6 status" "$RB_CODE" 404
rb_expect "probe 6 x-openbed-proxy" "$(rb_header x-openbed-proxy)" "refused"
rb_expect_contains "probe 6 body" "$(rb_body 200)" '{"message":"not forwarded by the OpenBed proxy"}'

echo
echo "=== probe 7: the sign-in link's redirect -- forwarded, a 3xx, landing on exactly $ADMIN_ORIGIN (spends one verify token) ==="
api_probe GET /auth/v1/verify -G --data-urlencode 'token=probe' --data-urlencode 'type=magiclink' --data-urlencode "redirect_to=$ADMIN_ORIGIN/"
rb_expect_prefix "probe 7 status" "$RB_CODE" 3
rb_expect "probe 7 x-openbed-proxy" "$(rb_header x-openbed-proxy)" "forwarded"
rb_location_origin
rb_expect "probe 7 Location origin" "$RB_LOCATION_ORIGIN" "$ADMIN_ORIGIN"

echo
echo "=== probe 8: the sensor's request -- the tracked key in the QUERY, no header: the gateway takes it, forwarded, and GoTrue's own body (R-2026-10-02-FF FF-5) ==="
api_probe GET /auth/v1/settings -G --data-urlencode "apikey=$KEY"
rb_expect "probe 8 the gateway took the key from the query" "$RB_CODE" 200
rb_expect "probe 8 the Worker forwarded it, not answered it" "$(rb_header x-openbed-proxy)" "forwarded"
# The keyword is read from the first 16 KiB, never printed: GoTrue writes its provider list before it, and
# the observed value of a contains-check is the whole body.
case "$(rb_body 16384)" in
    *'"disable_signup"'*) KEYWORD=found ;;
    *) KEYWORD=absent ;;
esac
rb_expect "probe 8 the body carries GoTrue's disable_signup keyword" "$KEYWORD" "found"

echo
echo "=== the stamp: $API/__openbed/version, against this checkout's HEAD $RB_HEAD ==="
api_probe GET /__openbed/version
rb_stamp
rb_expect "stamp commit" "$RB_COMMIT" "$RB_HEAD"
rb_expect "stamp dirty" "$RB_DIRTY" "false"
rb_expect "stamp limits_bound otp" "$RB_LIMITS_OTP" "true"
rb_expect "stamp limits_bound verify" "$RB_LIMITS_VERIFY" "true"
rb_expect "stamp limits_bound refresh" "$RB_LIMITS_REFRESH" "true"
api_probe HEAD /__openbed/version
rb_expect "stamp HEAD status" "$RB_CODE" 200
rb_expect "stamp HEAD x-openbed-proxy" "$(rb_header x-openbed-proxy)" "stamp"

rb_verdict "probes 1 to 3, 5, 5b, 6, 7 and 8 and the stamp read as they must. Probe 4, the deployed source, is Cowork's, read through the Cloudflare connector."
