#!/usr/bin/env bash
# ============================================================
# scripts/get_publishable_key.sh
# ============================================================
# Prints ONE key: the hosted project's publishable (anon-equivalent) key.
# Nothing else. No secret ever reaches stdout.
#
# ============================================================
# WHY THIS SCRIPT EXISTS. IT IS NOT A CONVENIENCE WRAPPER.
# ============================================================
# On 2026-09-09 the bare subcommand was run to "fetch the anon key":
#
#     supabase projects api-keys --project-ref <ref>
#
# It does not fetch the anon key. It dumps EVERY key the project has, including
# the full legacy `service_role` JWT -- the one credential in this system that
# bypasses every RLS policy by design and, per SECURITY.md, cannot be rotated
# quietly. That output landed in a session transcript, and the key had to be
# rotated.
#
# The lesson was not "remember to add a jq filter". A filter written into a
# runbook is a symptom fix: the next person types the subcommand. So the bare
# subcommand appears NOWHERE in this repository's documentation, and this script
# is what the runbook cites instead. Structural, not remembered -- the same move
# as disabling squash merging so a commit-level record cannot be lost by habit.
#
# THE PUBLISHABLE KEY IS NOT A SECRET. It ships in the browser bundle by design,
# and the entire RLS boundary is built on the assumption that an attacker holds
# it. That is precisely why it is safe to print and why nothing else here is.
#
# ============================================================
# IT HAD NEVER WORKED. READ THIS BEFORE TRUSTING IT AGAIN.
# ============================================================
# Its first real use, on 2026-09-13, failed at the first pipe with
# `jq: parse error: Invalid numeric literal`. The runbook had cited it as the
# only sanctioned way to obtain this key since 2026-09-09, and nothing had ever
# run it. Two defects, both invisible until then:
#
#   1. The CLI prints a TABLE unless asked for JSON. The call now passes
#      `-o json`, observed working in the founder's live call on CLI 2.117.0.
#   2. The response is a TOP-LEVEL ARRAY. There was never a `keys` wrapper, so
#      `.keys[]?` quietly produced nothing and the script announced that no
#      publishable key existed -- sending the operator to create a key that was
#      already there.
#
# The filter was written against an imagined response body and no execution
# ever contradicted it. That is the Self-Check Protocol's clause about
# third-party behaviour in the version actually installed, applied to a response
# shape rather than a function signature.
#
# THIS HEADER USED TO CLAIM "A failure is reported by this script in its own
# words." It was not true. The `|| {...}` caught only a non-zero CLI exit, the
# CLI succeeded -- it printed a table -- and the failure surfaced as jq's error
# from inside a command substitution. Every failure below is now reported here,
# and stdout carries the key or nothing.
#
# SELECTION IS BY PREFIX, NOT BY FIELD VALUE. The captured field names are
# api_key, description, hash, id, name, prefix and type, but the VALUE of `type`
# has never been observed. `sb_publishable_` is the key's own prefix: it
# survives a response-shape change, and it CANNOT RETURN A SECRET KEY OR A
# LEGACY service_role JWT BY CONSTRUCTION. Given this script's incident history,
# that is the property that matters most.
#
# THE CALLER IS WHERE AN EMPTY KEY IS STOPPED. This script exits non-zero and
# prints nothing on failure, but a caller's `KEY="$(...)"` swallows the status
# and leaves KEY empty -- and an empty key makes every boundary probe return
# 401, which reads as "the key is wrong". No script can reach past its caller's
# command substitution, so docs/runbook-supabase-project-creation.md step 6
# refuses an empty or malformed KEY before any curl runs.
#
# THE SEAM. OPENBED_SUPABASE_CLI replaces `npx --yes supabase`, word-split
# exactly as OPENBED_PSQL is in scripts/run_migrations.sh, so
# tests/compliance/get_publishable_key.test.ts can stub the CLI. It is not a
# bypass: whatever it returns passes the same validation, and the only value
# that can ever be printed is non-secret by design.
#
# Usage:
#   bash scripts/get_publishable_key.sh [PROJECT_REF]
#
# Exit: 0 and the key on stdout; 1 the response held no usable key; 2 the CLI or
#       jq could not be run. STDOUT IS EMPTY ON EVERY NON-ZERO EXIT.
# ============================================================
set -euo pipefail

PROJECT_REF="${1:-klrlpxysjsjpdkeqdhvl}"

command -v jq >/dev/null 2>&1 || {
    echo "ERROR: jq is required (brew install jq)." >&2
    exit 2
}

if [[ -n "${OPENBED_SUPABASE_CLI:-}" ]]; then
    read -r -a CLI <<< "$OPENBED_SUPABASE_CLI"
else
    CLI=(npx --yes supabase)
fi

# stderr is discarded rather than shown: a CLI error message could echo request
# context. And NEVER --reveal: it prints secret keys in full, and nothing here
# needs one.
raw=""
cli_st=0
raw="$("${CLI[@]}" projects api-keys --project-ref "$PROJECT_REF" -o json 2>/dev/null)" || cli_st=$?
if [ "$cli_st" -ne 0 ]; then
    echo "ERROR: could not reach the Supabase Management API." >&2
    echo "  The CLI exited $cli_st. Run 'npx supabase login' first, and check the project ref." >&2
    exit 2
fi

# THE RESPONSE MUST BE ONE TOP-LEVEL JSON ARRAY, CHECKED BEFORE ANYTHING IS READ
# FROM IT. jq's exit codes are separated by hand, because whichever branch
# "could not run" lands on is what it silently becomes. Observed on jq 1.7.1 on
# 2026-09-13: 0 an array; 1 valid JSON that is not exactly one array (an object,
# empty output, several documents); 5 not JSON at all, which is what the default
# table produces. Anything else means jq itself did not run.
# tests/compliance/get_publishable_key.test.ts plants each case, so a jq that
# changes these codes reds a named test rather than misreporting.
shape_st=0
jq -e -n '[inputs] | length == 1 and (.[0] | type == "array")' >/dev/null 2>&1 <<< "$raw" || shape_st=$?
case "$shape_st" in
    0)  ;;
    5)  echo "ERROR: the CLI response is not JSON, so no key was read." >&2
        echo "  The CLI prints a table unless given '-o json'. If a CLI upgrade changed that" >&2
        echo "  flag, this is the line to fix. Nothing from the response is printed: it can" >&2
        echo "  contain secret keys." >&2
        exit 1 ;;
    1)  echo "ERROR: the CLI response is not a single top-level JSON array, so no key was read." >&2
        echo "  Empty output, an object wrapper and several documents all land here. Nothing" >&2
        echo "  from the response is printed: it can contain secret keys." >&2
        exit 1 ;;
    *)  echo "ERROR: jq exited $shape_st checking the response shape -- the check did not run." >&2
        exit 2 ;;
esac

# THE PUBLISHABLE KEY ONLY, BY ITS OWN PREFIX. There is deliberately no fallback
# to the legacy `anon` JWT.
#
# The fallback existed until 2026-09-09 and was removed the same day legacy keys
# were disabled, because from that moment it could only ever return a DEAD key --
# silently, on stdout, indistinguishable from a good one. Every probe that took
# its key from here would then fail at authentication with 401, before PostgREST
# consulted a schema, and the operator would read that 401 as the security
# boundary holding. It is the same false-negative shape as a "not 200" rotation
# check: the assertion passes for a reason unrelated to what it guards.
#
# If several publishable keys exist, the first is taken. All of them carry the
# same permissions, so the choice has no security consequence.
key=""
sel_st=0
key="$(jq -r -n '[inputs][0] | [.[] | .api_key? | strings | select(startswith("sb_publishable_"))] | first // empty' 2>/dev/null <<< "$raw")" || sel_st=$?
if [ "$sel_st" -ne 0 ]; then
    echo "ERROR: jq exited $sel_st selecting the key -- the selection did not run." >&2
    exit 2
fi

# A missing key is a stop condition, not a thing to work around.
if [ -z "$key" ]; then
    echo "ERROR: no publishable (sb_publishable_) key for project $PROJECT_REF." >&2
    echo "  This script does NOT fall back to the legacy anon JWT: legacy keys" >&2
    echo "  were disabled on 2026-09-09, so that fallback could only ever hand" >&2
    echo "  you a dead key and turn a 401 into a false 'boundary held'." >&2
    echo "  Create a publishable key in the dashboard (API Keys) and re-run." >&2
    exit 1
fi

# THE SHAPE, BEFORE PRINTING. A prefix match proves where the value came from,
# not that it is a whole key, and a truncated value must never reach a caller as
# though it were one. bash's own regex: no fork, and it cannot fail to run.
if ! [[ "$key" =~ ^sb_publishable_[A-Za-z0-9_-]{16,}$ ]]; then
    echo "ERROR: the publishable key in the response has an unexpected shape, so it was not printed." >&2
    exit 1
fi

printf '%s\n' "$key"
