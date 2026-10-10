#!/usr/bin/env bash
# ============================================================
# scripts/readback_common.sh
# ============================================================
# THE SHARED MACHINERY OF THE DEPLOY READ-BACKS: scripts/readback_pages.sh,
# scripts/readback_ward_console.sh and scripts/readback_worker.sh source this file.
# It is never run on its own.
#
# WHY THE READ-BACKS ARE SCRIPTS AND NOT RUNBOOK FENCES (R-2026-09-23-70, the H4
# note). On 2026-09-23 three pastes into an interactive shell failed in one day:
#   - a heredoc ran a pull request body's backticks as commands;
#   - `read -r DEPLOY_URL` consumed the next pasted line, so every probe ran against
#     an empty host and a good deploy read as a failed one;
#   - zsh garbled a long paste.
# A script runs under bash with `set -euo pipefail`. The rules a pasted block needed
# (no `exit`, no variable called `path` or `status`, a `read` for the URL) therefore
# no longer apply, and no paste can break them.
#
# THE CONTRACT EVERY READ-BACK KEEPS:
#   - A MISSING, EMPTY OR NON-https URL IS REFUSED with a STOP line and exit 2
#     BEFORE ANY REQUEST IS MADE. This is the failing half of H4's false STOP, where
#     an empty host was probed and the answer was read as the deployment's.
#   - A URL WHOSE FIRST LABEL IS STILL THE RUNBOOK'S PLACEHOLDER `HASH` IS AN ERROR,
#     exit 2, before any request (R-2026-09-25-113 CO-2). At H6 step 2 the fence was
#     run as written, and the HASH-host lines read WRONG against a deployment that
#     does not exist: a STOP about a deploy nobody named. A placeholder is not a
#     deployment, so there is no verdict to give.
#   - EVERY CHECK PRINTS WHAT IT OBSERVED, then `ok` or `WRONG` with the value it
#     must have. The last line is exactly one verdict: `PASS:` (exit 0) or `STOP:`
#     (exit 1).
#   - A CHECK THAT COULD NOT RUN IS NEITHER. If curl, git or node fails, the script
#     prints ERROR and exits 2 (test-conventions, 2026-09-10: a check that could not
#     run never reports a verdict).
#   - EVERY REQUEST TO api.openbed.ng GOES THROUGH `api_probe METHOD PATH`, one per
#     line with a literal path. That is the form tests/compliance/proxy_allow_list.test.ts
#     reads, to hold each probe against supabase-proxy/allow-list.json. Requests to
#     a Pages deployment go through `site_probe`.
#
# THERE IS NO GREP HERE. Headers are read with `case`, JSON and body searches with
# node, and the status with `curl -w`, so there is no third exit code to fall
# through (test-conventions, 2026-09-10).
#
# NOT ASSERTED HERE, deliberately: that the hosted answers stay as observed. Each
# expected value is written in the script that checks it, as observed on a date. If
# hosted changes, the read-back reads WRONG and STOPs at the edge, which is loud.
# ============================================================
set -euo pipefail

RB_OK=1
# How many checks have read WRONG so far. rb_wrong adds one and nothing else reads it except a script that
# wants to know whether the checks it just made all read ok, without restating what they check.
RB_WRONG_COUNT=0
RB_CODE=""
RB_HEAD=""
RB_COMMIT=""
RB_DIRTY=""
RB_LIMITS_OTP=""
RB_LIMITS_VERIFY=""
RB_LIMITS_REFRESH=""
RB_LOCATION_ORIGIN=""
RB_MATCHES=""
RB_TMP="$(mktemp -d)"
trap 'rm -rf "$RB_TMP"' EXIT

# rb_require_url SCRIPT EXAMPLE URL -- refuse before anything is fetched.
rb_require_url() {
    local script="$1" example="$2" url="${3:-}"
    case "$url" in
        "")
            echo "STOP: no URL was given, so nothing was probed."
            echo "  Usage: bash scripts/$script $example"
            exit 2 ;;
        https://|*[[:space:]]*)
            echo "STOP: '$url' is not a usable https:// URL, so nothing was probed."
            echo "  Usage: bash scripts/$script $example"
            exit 2 ;;
        https://HASH|https://HASH[./:]*)
            echo "ERROR: '$url' still holds the runbook's placeholder HASH -- paste the deployment URL wrangler printed in its place. Nothing was probed, so this read-back has no verdict"
            exit 2 ;;
        https://*) ;;
        *)
            echo "STOP: '$url' is not an https:// URL, so nothing was probed."
            echo "  Usage: bash scripts/$script $example"
            exit 2 ;;
    esac
}

# rb_head ROOT -- the commit this checkout is at, which every stamp must name.
rb_head() {
    local st=0
    RB_HEAD="$(git -C "$1" rev-parse HEAD 2>/dev/null)" || st=$?
    if [ "$st" -ne 0 ]; then
        echo "ERROR: git could not read HEAD in $1 (git exited $st) -- run this from the deploy checkout; nothing was checked"
        exit 2
    fi
}

# EVERY curl THAT MAKES A REQUEST STARTS WITH `-q` (R-2026-09-30-181 FE-5): curl then ignores the
# caller's ~/.curlrc. Without it a `location` line there would follow the 303 the proof reads, and a
# `silent` or `write-out` line would change what -w prints. The stubs in the tests refuse a curl whose
# first argument is not `-q`, so removing it from any one site is red.
# rb_fetch METHOD URL [curl arguments...] -- one request. The status goes to RB_CODE;
# the headers and the body go to files that rb_header and rb_body read.
rb_fetch() {
    local method="$1" url="$2" st=0
    shift 2
    : > "$RB_TMP/headers"
    : > "$RB_TMP/body"
    if [ "$method" = HEAD ]; then
        # -I, never -X HEAD: -X HEAD waits for a body a correct HEAD never sends.
        RB_CODE="$(curl -q -sS -m 12 -I -D "$RB_TMP/headers" -o "$RB_TMP/body" -w '%{http_code}' "$@" "$url")" || st=$?
    else
        RB_CODE="$(curl -q -sS -m 12 -X "$method" -D "$RB_TMP/headers" -o "$RB_TMP/body" -w '%{http_code}' "$@" "$url")" || st=$?
    fi
    if [ "$st" -ne 0 ]; then
        rb_curl_error "$method" "$url" "$st"
    fi
}

# rb_curl_error METHOD URL ST -- a curl that exited non-zero: the check did not run. The one
# place the message lives, so rb_fetch and rb_fetch_times cannot say it two ways. Called
# directly, never inside $(...): an exit in a command substitution ends only the substitution.
rb_curl_error() {
    local method="$1" url="$2" st="$3"
    echo "ERROR: curl exited $st on $method $url -- the check did not run, so this read-back has no verdict"
    exit 2
}

# rb_fetch_times METHOD URL TIMES [curl arguments...] -- TIMES requests to the same URL in
# ONE curl invocation (R-2026-09-30-180 FD-1 a), so that they share one connection. A curl
# per request opens a new connection each time, and Cloudflare caches each rate-limit count
# on the machine that runs the Worker and syncs it asynchronously, so those requests land
# on machines whose counts have not caught up and prove nothing about a limit. Each URL gets
# its own `-o /dev/null`, and the extra arguments (a `-G` with its `--data-urlencode`s)
# apply to every URL. `--fail-early` is what makes a failed URL part way through an ERROR:
# without it curl prints 000 for that URL, goes on, and exits 0 when the last URL succeeds.
# The results are four arrays, one element per request: RB_T_CODE, RB_T_WHO (the Worker's
# x-openbed-proxy header, empty when absent), RB_T_CONNECTS (`%{num_connects}`: 1 on the
# first request of a fresh process, 0 on a reused connection) and RB_T_TIME. The separator is
# `|` and not a tab, because a tab collapses an empty header field into its neighbours under
# IFS word-splitting and the fields would shift.
rb_fetch_times() {
    local method="$1" url="$2" times="$3" st=0 out line code who connects secs got=0 i=1 args=()
    shift 3
    while [ "$i" -le "$times" ]; do
        args+=(-o /dev/null "$url")
        i=$((i + 1))
    done
    out="$(curl -q -sS -m 12 --fail-early -X "$method" -w '%{http_code}|%header{x-openbed-proxy}|%{num_connects}|%{time_total}\n' "$@" "${args[@]}")" || st=$?
    if [ "$st" -ne 0 ]; then
        rb_curl_error "$method" "$url" "$st"
    fi
    RB_T_CODE=()
    RB_T_WHO=()
    RB_T_CONNECTS=()
    RB_T_TIME=()
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        IFS='|' read -r code who connects secs <<<"$line"
        RB_T_CODE[got]="$code"
        RB_T_WHO[got]="$who"
        RB_T_CONNECTS[got]="$connects"
        RB_T_TIME[got]="$secs"
        got=$((got + 1))
    done <<<"$out"
    if [ "$got" -ne "$times" ]; then
        echo "ERROR: curl printed $got result lines for $times requests sent in one call, so the connection check has nothing to read -- nothing was proved"
        exit 2
    fi
}

# site_probe METHOD PATH [curl arguments...] -- a request to the deployment under test.
site_probe() {
    local method="$1" path_part="$2"
    shift 2
    rb_fetch "$method" "$SITE$path_part" "$@"
}

# THE READ-BACKS SEE WHAT A BROWSER SEES (R-2026-09-25-119 CU-5). On 2026-09-25 two
# Cloudflare zone settings were changing what our hosts served, and every read-back
# missed both: Web Analytics injected a beacon <script> into the HTML ONLY for a
# browser-like request, so a plain curl saw a clean page; and a managed robots.txt
# block was prepended on the custom domain only. So every page and robots.txt fetch
# presents as a browser, and the page checks run on the custom domain as well as on
# the deployment. The values are defined here, once.
RB_BROWSER_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
RB_BROWSER_ACCEPT='text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

# page_probe PATH [curl arguments...] -- GET a page from the host under test, as a browser.
page_probe() {
    local path_part="$1"
    shift
    site_probe GET "$path_part" -H "User-Agent: $RB_BROWSER_UA" -H "Accept: $RB_BROWSER_ACCEPT" "$@"
}

# api_probe METHOD PATH [curl arguments...] -- a request to api.openbed.ng. Written one
# per line with a literal path, because the allow-list guard reads these lines.
api_probe() {
    local method="$1" path_part="$2"
    shift 2
    if [ "${1:-}" = --rb-times ]; then
        # `--rb-times N`: N requests in one curl call, over one connection (rb_fetch_times).
        local times="${2:-}"
        shift 2
        rb_fetch_times "$method" "$API$path_part" "$times" "$@"
    else
        rb_fetch "$method" "$API$path_part" "$@"
    fi
}

# rb_header NAME -- the value of a response header (case-insensitive), or empty.
rb_header() {
    local want="$1" line name found=""
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        name="${line%%:*}"
        if [ "$name" = "$line" ]; then continue; fi
        name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
        if [ "$name" = "$want" ]; then
            found="${line#*:}"
            found="${found# }"
        fi
    done < "$RB_TMP/headers"
    printf '%s' "$found"
}

# rb_tracked_header APP NAME TARGET -- the value THIS CHECKOUT's tracked
# apps/APP/public/_headers sets for NAME on /*, AS RENDERED by scripts/render_headers.mjs
# for TARGET (PR 3.4b-app B, BP-10; R-2026-09-24-94 BV-2). The expected security
# headers are read from the file that ships, never retyped here, and the API origin is
# filled from packages/origins/origins.json exactly as the build fills it -- so a
# deployed CSP is held to the derivation, not to a copy of it. TARGET is `production`
# for every read of hosted, and `local` only for readback_admin.sh --local, whose
# server serves an `npm run build:local` build (R-2026-09-25-117 CS-2). Until
# 2026-09-25 this took no target, and the rendering named BOTH api origins, as every
# build did. Assign it on its OWN line: a failing
# $(...) inside an argument does not abort under -e (test-conventions section 8), and
# a missing file, a refused render or a missing header must stop the read-back with no
# verdict.
rb_tracked_header() {
    local file="$ROOT/apps/$1/public/_headers" want="$2" target="$3" line name inall=0 found="" rendered st=0
    if [ ! -f "$file" ]; then
        echo "ERROR: this checkout holds no tracked _headers file for the app at $file, so the expected $want cannot be read" >&2
        exit 2
    fi
    rendered="$(node "$ROOT/scripts/render_headers.mjs" --target "$target" "$file")" || st=$?
    if [ "$st" -ne 0 ]; then
        echo "ERROR: scripts/render_headers.mjs could not render $file (exit $st), so the expected $want is unknown -- this read-back has no verdict" >&2
        exit 2
    fi
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|'#'*) continue ;; esac
        case "$line" in
            [![:space:]]*) if [ "$line" = '/*' ]; then inall=1; else inall=0; fi; continue ;;
        esac
        [ "$inall" = 1 ] || continue
        line="${line#"${line%%[![:space:]]*}"}"
        name="$(printf '%s' "${line%%:*}" | tr '[:upper:]' '[:lower:]')"
        if [ "$name" = "$want" ]; then found="${line#*:}"; found="${found# }"; fi
    done <<< "$rendered"
    if [ -z "$found" ]; then
        echo "ERROR: $file sets no $want on /*, so the expected value cannot be read -- this read-back has no verdict" >&2
        exit 2
    fi
    printf '%s' "$found"
}

# rb_body N -- the first N bytes of the last response body.
rb_body() {
    head -c "$1" "$RB_TMP/body"
}

# rb_stamp -- RB_COMMIT and RB_DIRTY from the last body, or "(not a stamp)" when the
# body is not a {commit, dirty} object (the SPA fallback's HTML, for one). Also
# RB_LIMITS_OTP, RB_LIMITS_VERIFY and RB_LIMITS_REFRESH from the Worker's `limits_bound`
# (R-2026-09-30-177 FA-3 f): `true` or `false` as served, or "(absent)" when the stamp
# carries no such boolean, which is what a Worker from before W3 serves. Only
# readback_worker.sh reads them; the other callers' stamps have none.
rb_stamp() {
    local st=0 out
    out="$(node -e '
const fs = require("fs");
let s;
try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(3); }
if (s === null || typeof s.commit !== "string" || typeof s.dirty !== "boolean") process.exit(3);
const lb = (s.limits_bound !== null && typeof s.limits_bound === "object") ? s.limits_bound : {};
const b = (k) => (typeof lb[k] === "boolean" ? String(lb[k]) : "(absent)");
process.stdout.write([s.commit, s.dirty, b("otp"), b("verify"), b("refresh")].join(" "));
' "$RB_TMP/body")" || st=$?
    case "$st" in
        0) read -r RB_COMMIT RB_DIRTY RB_LIMITS_OTP RB_LIMITS_VERIFY RB_LIMITS_REFRESH <<<"$out" ;;
        3) RB_COMMIT="(not a stamp)"; RB_DIRTY="(not a stamp)"
           RB_LIMITS_OTP="(not a stamp)"; RB_LIMITS_VERIFY="(not a stamp)"; RB_LIMITS_REFRESH="(not a stamp)" ;;
        *) echo "ERROR: node exited $st reading a version stamp -- the check did not run, so this read-back has no verdict"
           exit 2 ;;
    esac
}

# rb_location_origin -- RB_LOCATION_ORIGIN: the origin of the last response's Location
# header, "(absent)" when there is none, "(relative)" when it is not an absolute URL.
# Probe 7 reads it, because the redirect's whole point is where it lands. Called
# directly, never inside $(...): the ERROR below must end the script, and an exit in a
# command substitution ends only the substitution.
rb_location_origin() {
    local loc st=0
    loc="$(rb_header location)"
    if [ -z "$loc" ]; then
        RB_LOCATION_ORIGIN="(absent)"
        return 0
    fi
    RB_LOCATION_ORIGIN="$(node -e '
try { const u = new URL(process.argv[1]); process.stdout.write(u.origin === "null" ? "(relative)" : u.origin); }
catch { process.stdout.write("(relative)"); }
' "$loc")" || st=$?
    if [ "$st" -ne 0 ]; then
        echo "ERROR: node exited $st reading a Location header -- the check did not run, so this read-back has no verdict"
        exit 2
    fi
}

# rb_matches REGEX -- every distinct match in the last body, one per line, into
# RB_MATCHES; RB_COUNT is how many.
rb_matches() {
    local st=0
    RB_MATCHES="$(node -e '
const fs = require("fs");
const found = [...new Set(fs.readFileSync(process.argv[1], "utf8").match(new RegExp(process.argv[2], "g")) ?? [])];
process.stdout.write(found.join("\n"));
' "$RB_TMP/body" "$1")" || st=$?
    if [ "$st" -ne 0 ]; then
        echo "ERROR: node exited $st searching a response body -- the check did not run, so this read-back has no verdict"
        exit 2
    fi
    RB_COUNT=0
    if [ -n "$RB_MATCHES" ]; then
        RB_COUNT="$(printf '%s\n' "$RB_MATCHES" | wc -l | tr -d ' ')"
    fi
}

# rb_search_state -- the one search setting this checkout ships (packages/origins/src/search.ts,
# R-2026-09-30-190 FN-3), read through the module itself, never retyped here: RB_SEARCH is
# "hidden" or "public", RB_META_ROBOTS the content its meta robots tag must carry, and
# RB_ROBOTS_SOURCE the tracked robots file the built robots.txt must equal (repo-relative).
# The node code carries the marker OPENBED_RB_SEARCH so a test can fail this one call alone.
rb_search_state() {
    local st=0 out
    out="$(node --experimental-strip-types --no-warnings -e '
// OPENBED_RB_SEARCH
import(require("url").pathToFileURL(process.argv[1]).href).then((m) => {
  process.stdout.write([m.SEARCH_VISIBILITY, m.robotsMetaContent(m.SEARCH_VISIBILITY), m.robotsTxtSource(m.SEARCH_VISIBILITY)].join("\n"));
});
' "$ROOT/packages/origins/src/search.ts")" || st=$?
    if [ "$st" -ne 0 ]; then
        echo "ERROR: node exited $st reading the search setting -- the check did not run, so this read-back has no verdict"
        exit 2
    fi
    RB_SEARCH=""
    RB_META_ROBOTS=""
    RB_ROBOTS_SOURCE=""
    { IFS= read -r RB_SEARCH; IFS= read -r RB_META_ROBOTS; IFS= read -r RB_ROBOTS_SOURCE; } <<< "$out" || true
    case "$RB_SEARCH" in
        hidden|public) ;;
        *) echo "ERROR: the search setting read '$RB_SEARCH', which is neither hidden nor public -- the check did not run, so this read-back has no verdict"
           exit 2 ;;
    esac
    if [ -z "$RB_META_ROBOTS" ] || [ -z "$RB_ROBOTS_SOURCE" ]; then
        echo "ERROR: the search setting answered without a robots tag or a robots file -- the check did not run, so this read-back has no verdict"
        exit 2
    fi
}

# rb_scripts LABEL -- EVERY <script> element in the last body, listed. Any src that is
# not same-origin with $SITE, and any inline script, reads WRONG naming it
# (R-2026-09-25-119 CU-5 a). The page's own bundle is a same-origin src; nothing else
# belongs there, because script-src is 'self'. The node code below carries the marker
# OPENBED_RB_SCRIPTS so a test can fail this one call alone.
rb_scripts() {
    local label="$1" st=0 out line bad=""
    out="$(node -e '
// OPENBED_RB_SCRIPTS
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
const site = new URL(process.argv[2]).origin;
const found = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
for (const [, attrs, inner] of found) {
  const src = /\bsrc\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\s>"\x27]+))/i.exec(attrs) || [];
  const value = src[1] ?? src[2] ?? src[3];
  if (value === undefined) { console.log("inline " + JSON.stringify(inner.trim().slice(0, 60))); continue; }
  let origin;
  try { origin = new URL(value, site + "/").origin; } catch { origin = "(unparseable)"; }
  console.log((origin === site ? "same " : "other ") + value);
}
' "$RB_TMP/body" "$SITE")" || st=$?
    if [ "$st" -ne 0 ]; then
        echo "ERROR: node exited $st listing the page's scripts -- the check did not run, so this read-back has no verdict"
        exit 2
    fi
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        echo "  script: ${line#* }"
        case "$line" in
            same\ *) ;;
            *) bad="${bad:+$bad, }${line#* }" ;;
        esac
    done <<< "$out"
    if [ -z "$bad" ]; then
        rb_ok "$label" "every script is this host's own"
    else
        rb_wrong "$label" "$bad" "must be none: every <script> must be a same-origin src (script-src 'self'), never inline or another host's"
    fi
}

# rb_same_bytes LABEL FILE -- the last body must equal FILE byte for byte. cmp's three
# exit codes are separated by hand: 1 is a difference, anything but 0 or 1 means the
# comparison did not run (test-conventions, 2026-09-10).
rb_same_bytes() {
    local label="$1" file="$2" st=0
    if [ ! -f "$file" ]; then
        echo "ERROR: this checkout holds no $file to compare against -- the check did not run, so this read-back has no verdict"
        exit 2
    fi
    cmp -s "$RB_TMP/body" "$file" || st=$?
    case "$st" in
        0) rb_ok "$label" "byte for byte this checkout's ${file#"$ROOT"/}" ;;
        1) rb_wrong "$label" "$(head -c 120 "$RB_TMP/body" | tr '\n' ' ')…" "must equal this checkout's ${file#"$ROOT"/} byte for byte" ;;
        *) echo "ERROR: cmp exited $st comparing a response body with $file -- the check did not run, so this read-back has no verdict"
           exit 2 ;;
    esac
}

rb_ok() { echo "  ok     $1: $2"; }
rb_wrong() { echo "  WRONG  $1: read '$2', $3"; RB_OK=0; RB_WRONG_COUNT=$((RB_WRONG_COUNT + 1)); }

# rb_flag LABEL TEXT -- a THIRD kind of result (R-2026-10-09 GO, GO-1 a): a data warning for a person to read.
# It prints "  FLAG   LABEL: TEXT" and NEVER touches RB_OK, so it can neither turn a PASS into a STOP nor hide
# a WRONG. A deploy fault is `WRONG`; a flag says the snapshot the host served holds something to look at.
rb_flag() { echo "  FLAG   $1: $2"; }

# rb_expect LABEL OBSERVED EXPECTED -- exact equality.
rb_expect() {
    if [ "$2" = "$3" ]; then rb_ok "$1" "$2"; else rb_wrong "$1" "$2" "must be '$3'"; fi
}

# rb_expect_prefix LABEL OBSERVED PREFIX
rb_expect_prefix() {
    case "$2" in
        "$3"*) rb_ok "$1" "$2" ;;
        *) rb_wrong "$1" "$2" "must begin '$3'" ;;
    esac
}

# rb_expect_contains LABEL OBSERVED NEEDLE
rb_expect_contains() {
    case "$2" in
        *"$3"*) rb_ok "$1" "$2" ;;
        *) rb_wrong "$1" "$2" "must contain '$3'" ;;
    esac
}

# rb_verdict PASS-TEXT -- the one last line.
rb_verdict() {
    echo
    if [ "$RB_OK" = 1 ]; then
        echo "PASS: $1"
        exit 0
    fi
    echo "STOP: a line above reads WRONG. Do not report this deploy as good; paste this whole output back."
    exit 1
}
