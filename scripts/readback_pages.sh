#!/usr/bin/env bash
# ============================================================
# scripts/readback_pages.sh
# ============================================================
# THE PUBLIC DASHBOARD'S DEPLOY READ-BACKS 4, 6 AND 8, THE PRIVACY NOTICE AT /privacy
# (R-2026-09-26-136 DL-1 e), THE HEALTH ENDPOINT AT /api/health
# (R-2026-09-29-173 EW-2 h), THE ABOUT AND HOW-IT-WORKS PAGES
# (R-2026-09-30-190 FN-4), AND THE SERVE-TIME STAMP
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
# THE FACILITY FLAG CHECK (R-2026-10-09 GO, GO-1), after read-back 6, is a hand-run read-back of the snapshot that host
# served at that moment, and not CI: its true claim is "this runs when the founder runs this script and reads the
# snapshot the host served then". It prints a FLAG line, by facility id only, for each listed facility with no ward row
# or with every ward NOT_OFFERED. A FLAG never changes the verdict or the exit status; a snapshot that cannot be
# checked after read-back 6 passed is ERROR, exit 2, and so is one that lists no facility (the helper is
# scripts/readback_facility_flags.mjs). It does not run when read-back 6 read WRONG, and says so.
# CLASSIFICATION (Clause 5): the About and How-it-works checks and the robots-file selection
# are GUARD-AHEAD-OF-SUBJECT until the founder deploys the pages (R-2026-09-30-190 FN-4): the
# checks run and are non-vacuous (a deployment without the pages reads WRONG), and the
# deploy that makes them read ok comes after the merge. They expect the state the search
# setting ships, which is public (FN-A). Every other check here is LIVE.
# Exit: 0 PASS; 1 STOP (a check read WRONG); 2 nothing was checked, or a check could
#       not run.
#
# NOT HERE, and the runbook says how to read each: in a browser, read-backs 5 and 5b
# and the polling check. Read-back 7 (the /robots.txt body) IS here, against the file the
# search setting selects (R-2026-09-30-190 FN-3).
# ============================================================
set -euo pipefail

SITE="${1:-}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck source=readback_common.sh
source "$(dirname "$0")/readback_common.sh"

rb_require_url readback_pages.sh 'https://HASH.openbed-public-dashboard.pages.dev' "$SITE"
# The dashboard's custom domain, where zone settings apply (R-2026-09-25-119 CU-5 b).
DOMAIN='https://openbed.ng'
SITE="${SITE%/}"
PAUSE="${READBACK_SERVED_AT_SLEEP:-5}"
rb_head "$ROOT"
# The one search setting this checkout ships: the robots file read-back 7 compares against
# and the meta robots tag the About and How-it-works pages must carry (FN-3, FN-4).
rb_search_state

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
# Whether read-back 6's status and body prefix read ok, from the checks themselves and not from a second statement
# of what they check: the facility flag check below runs only if both did (R-2026-10-09 GO, GO-1 e).
w6=$RB_WRONG_COUNT
rb_expect "read-back 6 status" "$RB_CODE" 200
rb6_status_wrong=$((RB_WRONG_COUNT - w6))
rb_expect "read-back 6 content-type" "$(rb_header content-type)" "$JSON_CT"
rb_expect "read-back 6 x-robots-tag" "$(rb_header x-robots-tag)" "$ROBOTS"
# Set by the Function itself (packages/snapshot/src/serve.ts): Pages is understood not to
# apply _headers to a Function's response (R-2026-09-24-93 BU-2 d).
rb_expect "read-back 6 x-content-type-options" "$(rb_header x-content-type-options)" "$NOSNIFF"
# An {"error": body fails whatever the status line said.
w6=$RB_WRONG_COUNT
rb_expect_prefix "read-back 6 body" "$(rb_body 120)" '{"v":'
rb6_body_wrong=$((RB_WRONG_COUNT - w6))

# THE FACILITY FLAGS (R-2026-10-09 GO, GO-1). Straight after read-back 6, on the body it just fetched: the next
# probe overwrites that body. One FLAG line per listed facility the public page could show no ward of, by id only.
# A FLAG is a data warning, never a verdict: rb_flag cannot clear RB_OK. The check reads this one fetch of $SITE and
# makes no other, on this host or any other.
echo
echo "=== the facility flags: the snapshot read-back 6 just read, one FLAG per listed facility with no ward other than NOT_OFFERED ==="
if [ "$rb6_status_wrong" -ne 0 ] || [ "$rb6_body_wrong" -ne 0 ]; then
    rb_flag "facility check" "not run, read-back 6 was WRONG"
else
    flag_st=0
    flag_out="$(node "$ROOT/scripts/readback_facility_flags.mjs" "$RB_TMP/body" "$ROOT/packages/fixtures/snapshot-shape.json")" || flag_st=$?
    if [ "$flag_st" -ne 0 ]; then
        echo "ERROR: the facility check could not run on a snapshot that passed read-back 6 (exit $flag_st: $flag_out) -- this read-back has no verdict"
        exit 2
    fi
    while IFS=$'\t' read -r flag_id flag_why; do
        [ -n "$flag_id" ] || continue
        rb_flag "facility $flag_id" "$flag_why"
    done <<< "$flag_out"
fi

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
echo "=== the page's security headers and scripts: GET $SITE/ as a browser, against this checkout's tracked apps/public-dashboard/public/_headers ==="
# As a browser (R-2026-09-25-119 CU-5): Web Analytics injected its beacon only for one.
page_probe /
rb_expect "page status" "$RB_CODE" 200
rb_expect "page content-security-policy" "$(rb_header content-security-policy)" "$CSP_WANT"
rb_expect "page referrer-policy" "$(rb_header referrer-policy)" "$REFERRER_WANT"
rb_expect "page x-content-type-options" "$(rb_header x-content-type-options)" "$SNIFF_WANT"
rb_scripts "page scripts"

echo
echo "=== the same on the custom domain: GET $DOMAIN/ as a browser (zone settings apply only there) ==="
SITE_BEFORE="$SITE"
SITE="$DOMAIN"
page_probe /
rb_expect "openbed.ng status" "$RB_CODE" 200
rb_expect "openbed.ng content-security-policy" "$(rb_header content-security-policy)" "$CSP_WANT"
rb_expect "openbed.ng referrer-policy" "$(rb_header referrer-policy)" "$REFERRER_WANT"
rb_expect "openbed.ng x-content-type-options" "$(rb_header x-content-type-options)" "$SNIFF_WANT"
rb_scripts "openbed.ng scripts"
SITE="$SITE_BEFORE"

echo
echo "=== read-back 7: /robots.txt on $SITE and on $DOMAIN, byte for byte this checkout's $RB_ROBOTS_SOURCE (the file the search setting, $RB_SEARCH, selects) ==="
# Cloudflare's managed robots.txt prepended its own block on the custom domain only,
# and its "Allow: /" won over our "Disallow: /" (R-2026-09-25-119 CU-4 b).
page_probe /robots.txt
rb_same_bytes "read-back 7 robots.txt" "$ROOT/$RB_ROBOTS_SOURCE"
SITE="$DOMAIN"
page_probe /robots.txt
rb_same_bytes "read-back 7 openbed.ng robots.txt" "$ROOT/$RB_ROBOTS_SOURCE"
SITE="$SITE_BEFORE"

echo
echo "=== /favicon.ico on $SITE and on $DOMAIN: byte for byte this checkout's apps/public-dashboard/public/favicon.ico, and never the SPA's HTML ==="
# Until the design pass the SPA fallback answered /favicon.ico with 200 text/html
# (R-2026-09-23-70; resolved by R-2026-09-26-122 CX-3). The byte comparison is the exact
# signal: the page's HTML can never equal the tracked icon. The content-type check is
# CX-3's own wording.
for host in "$SITE_BEFORE" "$DOMAIN"; do
    SITE="$host"
    label="favicon.ico"
    [ "$host" = "$DOMAIN" ] && label="openbed.ng favicon.ico"
    site_probe GET /favicon.ico
    rb_expect "$label status" "$RB_CODE" 200
    rb_same_bytes "$label" "$ROOT/apps/public-dashboard/public/favicon.ico"
    ct="$(rb_header content-type)"
    case "$ct" in
        text/html*) rb_wrong "$label content-type" "$ct" "must not be text/html: that is the SPA fallback, not the icon" ;;
        *) rb_ok "$label content-type" "$ct" ;;
    esac
done
SITE="$SITE_BEFORE"

echo
echo "=== /api/health: GET and HEAD on $SITE and on $DOMAIN, 200 with the marker and the robots tag (R-2026-09-29-173 EW-2 h) ==="
# The SPA fallback answers a route or method with no handler with 200 text/html and none of
# these headers (the HEAD /beds.json finding of 2026-09-21), so a 200 proves nothing here:
# the marker is the exact signal, and a 503 fail is a STOP that names the check. This reads
# the route's answer on the day of the deploy; that the snapshot job is alive is exactly
# what a 503 says, and it is not a deploy fault to be waved through.
for host in "$SITE_BEFORE" "$DOMAIN"; do
    SITE="$host"
    label="health"
    [ "$host" = "$DOMAIN" ] && label="openbed.ng health"
    for m in GET HEAD; do
        site_probe "$m" /api/health
        rb_expect "$label $m status" "$RB_CODE" 200
        rb_expect "$label $m x-openbed-health" "$(rb_header x-openbed-health)" "ok"
        rb_expect "$label $m x-robots-tag" "$(rb_header x-robots-tag)" "$ROBOTS"
        rb_expect "$label $m x-content-type-options" "$(rb_header x-content-type-options)" "$NOSNIFF"
        # The monitor keys on the KEYWORD in the GET body (R-2026-09-30-174 EX-2 c), which no
        # header can stand in for: a fallback page can carry a header, never this word.
        if [ "$m" = GET ]; then
            rb_matches 'openbed-ok'
            if [ "$RB_COUNT" -gt 0 ]; then rb_ok "$label $m body" "openbed-ok"; else rb_wrong "$label $m body" "(absent)" "the monitor keys on openbed-ok in the GET body"; fi
        fi
    done
done
SITE="$SITE_BEFORE"

echo
echo "=== a self-hosted font: the stylesheet $SITE/ links, and one woff2 it names, served as font/woff2 ==="
# The design pass's fonts are woff2 files the build copies into /assets (D1). A font
# served as anything but font/woff2 fails silently under X-Content-Type-Options: nosniff.
page_probe /
rb_matches '/assets/[A-Za-z0-9_.-]+[.]css'
if [ "$RB_COUNT" -eq 0 ]; then
    rb_wrong "page stylesheet" "(none)" "the page must link its built stylesheet"
else
    css_path="${RB_MATCHES%%$'\n'*}"
    rb_ok "page stylesheet" "$css_path"
    site_probe GET "$css_path"
    rb_matches '/assets/[A-Za-z0-9_.-]+[.]woff2'
    if [ "$RB_COUNT" -eq 0 ]; then
        rb_wrong "stylesheet fonts" "(none)" "the stylesheet must name its self-hosted woff2 fonts"
    else
        font_path="${RB_MATCHES%%$'\n'*}"
        rb_ok "stylesheet fonts" "$RB_COUNT woff2, first $font_path"
        site_probe GET "$font_path"
        rb_expect "font status" "$RB_CODE" 200
        rb_expect "font content-type" "$(rb_header content-type)" "font/woff2"
    fi
fi

echo
echo "=== the privacy notice: GET /privacy on $SITE and on $DOMAIN, as a browser -- the notice, never the SPA index (R-2026-09-26-136 DL-1 e) ==="
# Pages serves privacy.html at /privacy. A deployment without it answers /privacy with the
# SPA fallback: 200 text/html, the dashboard's index. So a 200 proves nothing here; the
# body must be the notice (its controller and its version) and must NOT carry the
# index's #app root, and the notice page carries no script at all.
for host in "$SITE_BEFORE" "$DOMAIN"; do
    SITE="$host"
    label="privacy"
    [ "$host" = "$DOMAIN" ] && label="openbed.ng privacy"
    page_probe /privacy
    rb_expect "$label status" "$RB_CODE" 200
    ct="$(rb_header content-type)"
    case "$ct" in
        text/html*) rb_ok "$label content-type" "$ct" ;;
        *) rb_wrong "$label content-type" "$ct" "must be text/html" ;;
    esac
    rb_matches 'Paddie Health Ltd'
    if [ "$RB_COUNT" -gt 0 ]; then rb_ok "$label controller" "Paddie Health Ltd"; else rb_wrong "$label controller" "(absent)" "the notice names Paddie Health Ltd"; fi
    # Version 1.2 since R-2026-10-09 GO, GO-3 c: a deployment still serving 1.1 (or 1.0) reads WRONG here.
    rb_matches 'Version 1[.]2'
    if [ "$RB_COUNT" -gt 0 ]; then rb_ok "$label version" "Version 1.2"; else rb_wrong "$label version" "(absent)" "the notice states Version 1.2"; fi
    rb_matches 'id="app"'
    if [ "$RB_COUNT" -eq 0 ]; then rb_ok "$label is not the SPA index" "no #app root"; else rb_wrong "$label is not the SPA index" "id=\"app\"" "that is the dashboard's index answering for a missing page"; fi
    rb_matches '<script'
    if [ "$RB_COUNT" -eq 0 ]; then rb_ok "$label scripts" "none"; else rb_wrong "$label scripts" "<script" "the notice page carries no script"; fi
done
SITE="$SITE_BEFORE"

echo
echo "=== the About and How-it-works pages: GET /about and /how-it-works on $SITE and on $DOMAIN, as a browser -- their own pages, never the SPA index (R-2026-09-30-190 FN-4) ==="
# Pages serves about.html at /about and how-it-works.html at /how-it-works. A deployment
# without them answers both with the SPA fallback: 200 text/html, the dashboard's index. So a
# 200 proves nothing here; the body must carry the page's own H1 and NOT the index's #app root,
# and the meta robots tag must be the one the search setting ($RB_SEARCH) selects.
for host in "$SITE_BEFORE" "$DOMAIN"; do
    SITE="$host"
    for page in about:About\ OpenBed how-it-works:How\ OpenBed\ works; do
        route="${page%%:*}"
        heading="${page#*:}"
        label="$route"
        [ "$host" = "$DOMAIN" ] && label="openbed.ng $route"
        page_probe "/$route"
        rb_expect "$label status" "$RB_CODE" 200
        ct="$(rb_header content-type)"
        case "$ct" in
            text/html*) rb_ok "$label content-type" "$ct" ;;
            *) rb_wrong "$label content-type" "$ct" "must be text/html" ;;
        esac
        rb_matches "<h1>$heading</h1>"
        if [ "$RB_COUNT" -gt 0 ]; then rb_ok "$label heading" "$heading"; else rb_wrong "$label heading" "(absent)" "the page must carry its own H1, $heading"; fi
        rb_matches 'id="app"'
        if [ "$RB_COUNT" -eq 0 ]; then rb_ok "$label is not the SPA index" "no #app root"; else rb_wrong "$label is not the SPA index" "id=\"app\"" "that is the dashboard's index answering for a missing page"; fi
        rb_matches '<meta name="robots" content="[^"]*"'
        rb_expect "$label meta robots (the $RB_SEARCH state)" "${RB_MATCHES:-(absent)}" "<meta name=\"robots\" content=\"$RB_META_ROBOTS\""
    done
done
SITE="$SITE_BEFORE"

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

rb_verdict "read-backs 4, 6, 7 and 8, the page's security headers and scripts on both hosts, the favicon on both hosts, the health endpoint on both hosts, the privacy notice on both hosts, the About and How-it-works pages on both hosts, a self-hosted font, and the serve-time stamp read as they must."
