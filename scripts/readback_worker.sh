#!/usr/bin/env bash
# ============================================================
# scripts/readback_worker.sh
# ============================================================
# THE api.openbed.ng WORKER'S READ-BACK: probes 1 to 3 and the stamp of
# docs/runbook-cloudflare-worker-proxy.md (R-2026-09-23-70). Probe 4, the deployed
# source equalling the repository's, is read by Cowork through the Cloudflare
# connector, and nothing here can stand in for it. Why these are a script and not
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
api_probe POST /rest/v1/rpc/my_facility_wards -H 'Content-Type: application/json' -d '{}'
rb_expect "probe 1 status" "$RB_CODE" 401
rb_expect "probe 1 sb-project-ref" "$(rb_header sb-project-ref)" "$REF"
rb_expect "probe 1 x-openbed-proxy" "$(rb_header x-openbed-proxy)" "forwarded"

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

echo
echo "=== the stamp: $API/__openbed/version, against this checkout's HEAD $RB_HEAD ==="
api_probe GET /__openbed/version
rb_stamp
rb_expect "stamp commit" "$RB_COMMIT" "$RB_HEAD"
rb_expect "stamp dirty" "$RB_DIRTY" "false"
api_probe HEAD /__openbed/version
rb_expect "stamp HEAD status" "$RB_CODE" 200
rb_expect "stamp HEAD x-openbed-proxy" "$(rb_header x-openbed-proxy)" "stamp"

rb_verdict "probes 1 to 3 and the stamp read as they must. Probe 4, the deployed source, is Cowork's, read through the Cloudflare connector."
