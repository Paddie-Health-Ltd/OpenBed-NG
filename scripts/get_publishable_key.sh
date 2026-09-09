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

# Prefer the new-style publishable key. Fall back to the legacy `anon` JWT only
# if the project still has legacy keys enabled -- which, after the 2026-09-09
# rotation, it should not.
key="$(printf '%s' "$raw" | jq -r '
    ( [.keys[]? | select(.type == "publishable") | .api_key] | first )
    // ( [.keys[]? | select(.name == "anon")     | .api_key] | first )
    // empty
')"

if [ -z "$key" ]; then
    echo "ERROR: no publishable or anon key found for project $PROJECT_REF." >&2
    exit 1
fi

printf '%s\n' "$key"
