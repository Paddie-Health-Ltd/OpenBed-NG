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
# Usage:
#   bash scripts/get_publishable_key.sh [PROJECT_REF]
#
# Exit: 0 and the key on stdout; non-zero with a message on stderr otherwise.
# ============================================================
set -euo pipefail

PROJECT_REF="${1:-klrlpxysjsjpdkeqdhvl}"

command -v jq >/dev/null 2>&1 || {
    echo "ERROR: jq is required (brew install jq)." >&2
    exit 2
}

# stderr is discarded rather than shown: a CLI error message could echo request
# context. A failure is reported by this script in its own words.
raw="$(npx --yes supabase projects api-keys --project-ref "$PROJECT_REF" 2>/dev/null)" || {
    echo "ERROR: could not reach the Supabase Management API." >&2
    echo "  Run 'npx supabase login' first, and check the project ref." >&2
    exit 2
}

# THE PUBLISHABLE KEY ONLY. There is deliberately no fallback to the legacy
# `anon` JWT.
#
# The fallback existed until 2026-09-09 and was removed the same day legacy keys
# were disabled, because from that moment it could only ever return a DEAD key --
# silently, on stdout, indistinguishable from a good one. Every probe that took
# its key from here would then fail at authentication with 401, before PostgREST
# consulted a schema, and the operator would read that 401 as the security
# boundary holding. It is the same false-negative shape as a "not 200" rotation
# check: the assertion passes for a reason unrelated to what it guards.
#
# A missing key is a stop condition, not a thing to work around.
key="$(printf '%s' "$raw" | jq -r '
    [.keys[]? | select(.type == "publishable") | .api_key] | first // empty
')"

if [ -z "$key" ]; then
    echo "ERROR: no publishable (sb_publishable_) key for project $PROJECT_REF." >&2
    echo "  This script does NOT fall back to the legacy anon JWT: legacy keys" >&2
    echo "  were disabled on 2026-09-09, so that fallback could only ever hand" >&2
    echo "  you a dead key and turn a 401 into a false 'boundary held'." >&2
    echo "  Create a publishable key in the dashboard (API Keys) and re-run." >&2
    exit 1
fi

printf '%s\n' "$key"
