#!/usr/bin/env bash
# ============================================================
# scripts/get_extra_search_path.sh
# ============================================================
# Prints ONE value: the hosted project's PostgREST `db_extra_search_path`.
# Nothing else. No other field of the response ever reaches stdout or stderr.
#
# ============================================================
# WHY THIS SCRIPT EXISTS. IT IS NOT A CONVENIENCE WRAPPER.
# ============================================================
# The only place that setting can be read is the Management API endpoint
# GET /v1/projects/<ref>/postgrest, and that endpoint returns the WHOLE PostgREST
# configuration. Supabase's own OpenAPI schema for it,
# PostgrestConfigWithJWTSecretResponse (read 2026-09-13), lists db_schema,
# max_rows, db_extra_search_path, db_pool, db_pool_acquisition_timeout -- and
# jwt_secret. A JWT secret is a signing credential and is treated here exactly as
# the service_role key.
#
# So a bare call against that endpoint, pasted into a transcript, is the
# 2026-09-09 incident replayed at a different endpoint: that day a bare
# `api-keys` call dumped the service_role key into a session transcript and it
# had to be rotated. The fix then was structural, not remembered -- the filter
# lives inside scripts/get_publishable_key.sh and the bare subcommand appears
# nowhere in this repository's documentation. This is the same move, for the
# same reason. The bare call against /postgrest appears nowhere in the docs;
# docs/runbook-supabase-project-creation.md step 2 cites this script instead.
#
# It exists for one runbook checkbox: step 2, "extra_search_path does not
# include app". Step 6's bare-name 404s cannot discharge it -- objects in that
# list never get endpoints, so a 404 looks the same whether or not app is in it.
# Reading the setting is the only probe that discriminates.
#
# ============================================================
# THE RESPONSE SHAPE IS NOW CONFIRMED AGAINST A LIVE CALL, 2026-09-13.
# ============================================================
# This script was written, tested and merged against a response shape taken from
# Supabase's documentation, with no live capture -- the precise setup under which
# scripts/get_publishable_key.sh failed at the first pipe on ITS first
# execution. Its own first live execution, the founder's, against project
# klrlpxysjsjpdkeqdhvl on 2026-09-13, succeeded: it printed `public, extensions`
# and the runbook caller printed PASS. This time the documented shape matched the
# real response.
#
# WHAT THAT CONFIRMS, and nothing wider: ONE response, from ONE project, through
# ONE CLI-free Management API call. The URL path and the token curl read from
# stdin were accepted (a 2xx -- --fail did not fire); the body was exactly one
# JSON object; db_extra_search_path was present, a string, and of the shape the
# check below accepts.
#
# WHAT IT DOES NOT CONFIRM:
#   - That Supabase will not change the shape. That is why the object check, the
#     type check and the shape check all stay: they are what turns a future
#     change into a refusal in this script's own words instead of a wrong value.
#   - The other five documented fields -- db_schema, max_rows, db_pool,
#     db_pool_acquisition_timeout and jwt_secret. By design none was read or
#     printed, so their presence and types remain documentation-derived, and
#     packages/fixtures/supabase-postgrest-config-response.documented.json keeps
#     its name because that is still true of its field set.
#
# So the tests prove one thing they did not before: the shape they are built on
# matched the live endpoint for the one field this script reads. They still say
# nothing about next month's response.
#
# CLASSIFICATION (Clause 5): LIVE. Its subject, the hosted project, exists.
#
# ============================================================
# WHAT KEEPS EVERY OTHER FIELD OFF STDOUT, AND WHAT DOES NOT
# ============================================================
# STRUCTURAL, and this is the guarantee: the response must be exactly one JSON
# object; db_extra_search_path must be present AND a string (an object or array
# there could carry other fields inside it, so any other type is refused); and
# only that field, by name, is selected. Nothing from the response is ever
# echoed on a refusal.
#
# THE SHAPE CHECK IS A SECOND GUARD, NOT THE GUARANTEE. Before printing, the
# value must look like a search path: a comma-separated list of identifiers,
# optionally double-quoted, bounded in length. That rejects a JSON fragment, a
# dotted JWT, a URL, a newline. IT CANNOT distinguish a secret the server itself
# placed inside this field: a long run of letters and digits is also a valid
# identifier. Stated rather than implied, so nobody reads the regex as the
# thing standing between jwt_secret and stdout.
#
# THE TOKEN. SUPABASE_ACCESS_TOKEN, the same management token as runbook step 1.
# It never enters any process's argv, where `ps` can read it: the Authorization
# header is written by the printf BUILTIN into curl's stdin, and curl reads it
# with `--header @-` (curl 7.55+; observed on curl 8.7.1, 2026-09-13).
#
# THE CALLER IS WHERE AN EMPTY VALUE IS STOPPED. This script exits non-zero and
# prints nothing on every failure, but a caller's `ESP="$(...)"` swallows the
# status. So the runbook's step 2 caller refuses an empty ESP before judging
# anything, exactly as step 6 does for the publishable key.
#
# AN EMPTY SETTING IS REFUSED TOO, deliberately. An empty list cannot contain
# app -- but empty output is also precisely what a broken filter produces, and
# a probe whose pass looks like its failure is the defect this repository keeps
# finding. So an empty value exits 1 with its own message, and that message is
# what gets recorded.
#
# THE SEAM. OPENBED_CURL replaces `curl`, word-split exactly as
# OPENBED_SUPABASE_CLI is in scripts/get_publishable_key.sh, so
# tests/compliance/get_extra_search_path.test.ts can stub the HTTP call. It is
# not a bypass: whatever it returns passes the same checks.
#
# Usage:
#   read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
#   bash scripts/get_extra_search_path.sh [PROJECT_REF]
#
# Exit: 0 and the value on stdout; 1 the response held no usable value; 2 the
#       token, curl or jq was missing or could not run. STDOUT IS EMPTY ON EVERY
#       NON-ZERO EXIT.
# ============================================================
set -euo pipefail

PROJECT_REF="${1:-klrlpxysjsjpdkeqdhvl}"

command -v jq >/dev/null 2>&1 || {
    echo "ERROR: jq is required (brew install jq)." >&2
    exit 2
}

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    echo "ERROR: SUPABASE_ACCESS_TOKEN is not set, so the Management API was not called." >&2
    echo "  Set it with: read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN" >&2
    echo "  (never inline -- an inline export writes the token into shell history)." >&2
    exit 2
fi

if [[ -n "${OPENBED_CURL:-}" ]]; then
    read -r -a CURL <<< "$OPENBED_CURL"
else
    CURL=(curl)
fi

URL="https://api.supabase.com/v1/projects/$PROJECT_REF/postgrest"

# --fail: a non-2xx status is a non-zero exit with NO body, so an error page can
# never be mistaken for a config. curl's stderr is discarded: it is not needed to
# diagnose, and nothing about a request that carried a token is worth printing.
raw=""
curl_st=0
raw="$(printf 'Authorization: Bearer %s\n' "$SUPABASE_ACCESS_TOKEN" \
        | "${CURL[@]}" -sS --fail --max-time 12 --header @- "$URL" 2>/dev/null)" || curl_st=$?
if [ "$curl_st" -ne 0 ]; then
    echo "ERROR: could not read the PostgREST config from the Supabase Management API." >&2
    echo "  curl exited $curl_st (22 means an HTTP error status: check the token and the project ref)." >&2
    echo "  Nothing from any response is printed: this endpoint returns jwt_secret." >&2
    exit 2
fi

# THE RESPONSE MUST BE ONE TOP-LEVEL JSON OBJECT, checked before anything is read
# from it. jq's exit codes are separated by hand, as in get_publishable_key.sh:
# 0 an object; 1 valid JSON that is not exactly one object (an array, empty
# output, several documents); 5 not JSON at all. Anything else means jq did not
# run, and must never be reported as a verdict about the response.
shape_st=0
jq -e -n '[inputs] | length == 1 and (.[0] | type == "object")' >/dev/null 2>&1 <<< "$raw" || shape_st=$?
case "$shape_st" in
    0)  ;;
    5)  echo "ERROR: the response is not JSON, so nothing was read from it." >&2
        echo "  Nothing from the response is printed: this endpoint returns jwt_secret." >&2
        exit 1 ;;
    1)  echo "ERROR: the response is not a single top-level JSON object, so nothing was read from it." >&2
        echo "  Nothing from the response is printed: this endpoint returns jwt_secret." >&2
        exit 1 ;;
    *)  echo "ERROR: jq exited $shape_st checking the response shape -- the check did not run." >&2
        exit 2 ;;
esac

# THE FIELD MUST BE PRESENT AND A STRING. null, a number, and above all an object
# or array are refused: a container there could hold other fields, and `-r` would
# print them.
type_st=0
jq -e -n '[inputs][0] | has("db_extra_search_path") and (.db_extra_search_path | type == "string")' >/dev/null 2>&1 <<< "$raw" || type_st=$?
case "$type_st" in
    0)  ;;
    1)  echo "ERROR: the response has no string db_extra_search_path, so nothing was read from it." >&2
        echo "  Nothing from the response is printed: this endpoint returns jwt_secret." >&2
        exit 1 ;;
    *)  echo "ERROR: jq exited $type_st checking the field type -- the check did not run." >&2
        exit 2 ;;
esac

# ONE FIELD, BY NAME.
val=""
sel_st=0
val="$(jq -j -n '[inputs][0].db_extra_search_path' 2>/dev/null <<< "$raw")" || sel_st=$?
if [ "$sel_st" -ne 0 ]; then
    echo "ERROR: jq exited $sel_st selecting db_extra_search_path -- the selection did not run." >&2
    exit 2
fi

if [ -z "$val" ]; then
    echo "ERROR: db_extra_search_path is present and EMPTY, so nothing was printed." >&2
    echo "  An empty list cannot contain app. It is refused anyway, because empty output is" >&2
    echo "  also exactly what a broken filter produces. Record THIS MESSAGE as the result." >&2
    exit 1
fi

# THE SHAPE, BEFORE PRINTING -- the second guard described in the header, and no
# more than that. bash's own regex: no fork, and it cannot fail to run.
#
# SEPARATORS ARE A LITERAL SPACE, NEVER [[:space:]]. The first draft used
# [[:space:]], which in a bash regex matches a NEWLINE -- so "public,\nextensions"
# passed and a two-line value reached stdout, where a caller's `ESP="$(...)"`
# would hold it as one. The plant in tests/compliance/get_extra_search_path.test.ts
# caught it before this ever ran against the hosted project. A quoted identifier
# excludes control characters for the same reason.
IDENT='("[^"[:cntrl:]]{1,63}"|[A-Za-z_][A-Za-z0-9_$]{0,62})'
SEARCH_PATH_RE="^ *${IDENT}( *, *${IDENT})* *\$"
if [ "${#val}" -gt 1024 ] || ! [[ "$val" =~ $SEARCH_PATH_RE ]]; then
    echo "ERROR: db_extra_search_path has an unexpected shape, so it was not printed." >&2
    exit 1
fi

printf '%s\n' "$val"
