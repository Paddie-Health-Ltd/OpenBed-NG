#!/usr/bin/env bash
# ============================================================
# scripts/edge_guard.sh
# ============================================================
# THE EDGE GUARD OF THE TWO DEPLOY WRAPPERS (R-2026-09-30-217 GP, GP-3):
# scripts/deploy_pages.sh and scripts/deploy_worker.sh source this file and call
# `edge_guard <wrapper name>` once, after their own checks and before the first build,
# stamp or upload. It is never run on its own.
#
# THE DEFECT IT EXISTS FOR (evidence kind: RELAYED. The founder ran it on 2026-10-10 and
# Cowork relayed it; the implementer observed none of it). A deploy of the public dashboard
# failed three times before anything was uploaded:
#   - `GET /accounts` answered 429, with a Cloudflare Ray ID ending -LOS;
#   - then, with CLOUDFLARE_ACCOUNT_ID set, `POST /pages/assets/check-missing` answered 429
#     twice, once on home Wi-Fi and once on a phone hotspot, each Ray ID ending -LOS.
# The fourth attempt, through a VPN whose trace read colo=LHR and loc=GB, uploaded: 8 files
# uploaded, 9 already present. Cowork's ruling: the cause is Cloudflare's Lagos edge answering
# API calls from Nigerian networks with an HTML 429; it is not the `GET /accounts` call, which
# setting the account id skips without fixing. Before this file a 429 arrived in the middle of
# a deploy, after the build, and read as a fault in the deploy.
#
# WHAT IT DOES. It fetches https://www.cloudflare.com/cdn-cgi/trace, reads the `colo` and
# `loc` lines, and PRINTS BOTH in every run. Two kinds of outcome, with the wrappers' own two exit codes:
#   - EXIT 1, REFUSED, before any build: colo is LOS (the Lagos edge), or loc is NG (Nigeria). The
#     check ran and the answer was no. It prints the reason and the ordered sentence, EDGE_REFUSAL below.
#   - EXIT 2, THE CHECK COULD NOT RUN, before any build: the trace cannot be fetched (curl exits
#     non-zero), or the answer is not a trace: no colo line, no loc line, either one twice, an empty
#     value, or a value with a character outside A-Z, a-z and 0-9 (an HTML 429 page is this case). It
#     prints the reason and EDGE_UNREAD below, to stderr, as the wrappers' other exit-2 lines do.
# Neither falls through to the upload.
#
# *Restated 2026-10-10 (R-2026-09-30-218 GQ-5 b). Until then all four exited 1, as R-2026-09-30-217 GP-3
# ordered ("refuse the same way"), and this paragraph said the wrappers' exit 2 was deliberately not used.
# Cowork ruled that an edge that cannot be read means the check could not run, which is exit 2 in
# the wrappers and in the file-reading guards (the repository's rule for a check that did not run), and that a Lagos or Nigerian edge stays a refusal,
# exit 1. A caller that branches on the status now tells "this network is refused" from "the network
# could not be asked".*
#
# CLASSIFICATION (Clause 5): LIVE. Its subject, the two wrappers, exists. Its true
# present-tense claim is: it executes in every test run over a curl stubbed on PATH, and
# stops each of the four cases above; it reads the real trace only when the founder runs a
# deploy. It is not run in CI against Cloudflare.
#
# THERE IS NO OVERRIDE, deliberately: no environment variable names another URL or turns the
# check off, because such a seam is how a guard gets switched off at 2am. The tests stub `curl`
# on PATH instead. Running `npx wrangler` by hand bypasses it, as it bypasses the wrappers
# (their headers say so): this removes the accident, not the deliberate act.
#
# NOT ASSERTED HERE, deliberately:
#   - that the colo this trace request reaches is the colo that answers wrangler's API calls.
#     INFERRED, not observed: the trace is www.cloudflare.com and wrangler's calls go to
#     api.cloudflare.com, two hostnames on the same network. The founder's four attempts fit it
#     and do not prove it.
#   - whether the trigger is the client's country or the colo. The four attempts cannot tell
#     them apart, because they moved together; the guard refuses on either, as ordered.
#   - that EVERY deploy from a Lagos edge fails. It does not, and this guard is stricter than the
#     failure it prevents, by the ruling's design. Evidence kind: MINE, read in the admin runbook:
#     on 2026-09-25 two attempts drew a 429 with Ray IDs ending -LOS and the third attempt of the
#     same sitting deployed (docs/runbook-admin-deploy.md); the public dashboard on 2026-09-26
#     and admin on 2026-09-27 record "No 429", and the runbooks do not record their colo. A 429
#     from that edge is intermittent in the records, and a refusal here is not.
#   - that the trace is true. A proxy, a captive portal or a VPN that answers the trace
#     differently from the API is not seen from here.
#   - that a deploy from an accepted edge will succeed. Cloudflare may refuse for other
#     reasons; this reads one signal.
# ============================================================
set -euo pipefail

EDGE_TRACE_URL="https://www.cloudflare.com/cdn-cgi/trace"
EDGE_REFUSAL="Cloudflare's Lagos edge refuses deploys from Nigerian networks (R-2026-09-30-217 GP). Connect a VPN exiting outside Nigeria, check colo is not LOS, and run this again."
EDGE_UNREAD="The check could not run, so nothing was built or uploaded. Check the connection, or connect a VPN exiting outside Nigeria, and run this again."

edge_guard() {
    local who="${1:?edge_guard needs the name of the wrapper that calls it}"
    local body cst=0
    # `-q` first so curl ignores the caller's ~/.curlrc (R-2026-09-30-181 FE-5); a failure to
    # reach the trace is captured, never branched on as a verdict by a pipe.
    body="$(curl -q -sS -m 12 "$EDGE_TRACE_URL" 2>&1)" || cst=$?
    if [ "$cst" -ne 0 ]; then
        echo "$who: edge trace reads colo=unread loc=unread"
        echo "REFUSING: the Cloudflare edge trace could not be fetched (curl exited $cst), so the edge this deploy would reach cannot be read" >&2
        echo "  curl said: ${body:0:120}" >&2
        echo "  $EDGE_UNREAD" >&2
        exit 2
    fi

    local colo="" loc="" ncolo=0 nloc=0 line ok=1
    local cr=$'\r'
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%"$cr"}"
        case "$line" in
            colo=*) colo="${line#colo=}"; ncolo=$((ncolo + 1)) ;;
            loc=*) loc="${line#loc=}"; nloc=$((nloc + 1)) ;;
        esac
    done <<< "$body"
    if [ "$ncolo" -ne 1 ] || [ "$nloc" -ne 1 ]; then ok=0; fi
    case "$colo" in '' | *[!A-Za-z0-9]*) ok=0 ;; esac
    case "$loc" in '' | *[!A-Za-z0-9]*) ok=0 ;; esac
    if [ "${#colo}" -gt 8 ] || [ "${#loc}" -gt 8 ]; then ok=0; fi
    if [ "$ok" -ne 1 ]; then
        # Nothing from the body is echoed: it came off the network and is not a trace.
        echo "$who: edge trace reads colo=unread loc=unread"
        echo "REFUSING: the Cloudflare edge trace is not a trace carrying one colo and one loc, so the edge this deploy would reach cannot be read" >&2
        echo "  $EDGE_UNREAD" >&2
        exit 2
    fi

    echo "$who: edge trace reads colo=$colo loc=$loc"
    local colo_up loc_up
    colo_up="$(printf '%s' "$colo" | tr 'a-z' 'A-Z')"
    loc_up="$(printf '%s' "$loc" | tr 'a-z' 'A-Z')"
    if [ "$colo_up" = "LOS" ] || [ "$loc_up" = "NG" ]; then
        echo "REFUSING: the edge trace reads colo=$colo loc=$loc, which is Lagos or Nigeria"
        echo "  $EDGE_REFUSAL"
        exit 1
    fi
}
