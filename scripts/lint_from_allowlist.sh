#!/usr/bin/env bash
# ============================================================
# scripts/lint_from_allowlist.sh
# ============================================================
# Client code may address ONLY the three public mirrors and the two capped RPCs,
# and may never select '*'.
#
# `.select('*')` is banned because it is how a private column reaches a client the
# day after someone adds one: the query does not change, the payload does. Naming
# columns makes widening the surface a visible edit.
#
# The allowlist is NOT hardcoded here -- it is read from
# packages/fixtures/public-relations.json, which tests/db/config_drift.test.ts
# IMPORTS and asserts equals the supabase_realtime publication membership. That
# link is what stops the lint's idea of "public" drifting away from the
# database's -- and it is an import, not a comment claiming an import.
#
# CLASSIFICATION (Clause 5): GUARD-AHEAD-OF-SUBJECT for the from() half -- no
# client issues a query until Bundle 4. The ALLOWLIST ITSELF is live from Bundle 1
# and already tied to the schema.
#
# Usage: bash scripts/lint_from_allowlist.sh [ROOT]
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
ALLOWLIST_JSON="$ROOT/packages/fixtures/public-relations.json"
[ -f "$ALLOWLIST_JSON" ] || { echo "ERROR: allowlist not found at $ALLOWLIST_JSON" >&2; exit 2; }

# Read the allowed names without a JSON dependency.
ALLOWED=$(tr -d ' \n' < "$ALLOWLIST_JSON" | grep -oE '"(facility_public|ward_public|lga_rollup|my_facility_wards|ward_status_history)"' | tr -d '"' | sort -u)
[ -n "$ALLOWED" ] || { echo "ERROR: allowlist parsed to nothing — refusing to pass vacuously" >&2; exit 2; }

FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(
    find "$ROOT/apps" -type f \( -name '*.ts' -o -name '*.tsx' \) \
         -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null | sort
)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no app source found under $ROOT/apps" >&2; exit 2; }

VIOLATIONS=0

# EXACT-LINE MEMBERSHIP, IN PURE BASH. Replaces `printf '%s\n' "$list" | grep -qx`.
#
# grep exits 0 for match, 1 for no match and 2 for COULD NOT RUN. Both call sites
# below branch on truthiness alone, so an exit 2 was silently reinterpreted -- and
# in one direction that meant a guard failing OPEN. No fork, no pipe, no third
# exit code. bash 3.2 compatible.
list_has_line() {
    local list=$'\n'"$1"$'\n'
    local needle=$'\n'"$2"$'\n'
    case "$list" in
        *"$needle"*) return 0 ;;
    esac
    return 1
}
for f in "${FILES[@]}"; do
    if out=$(grep -nE "\.select\((['\"])\*\1\)" "$f"); then
        echo "FAIL: ${f#"$ROOT"/}: .select('*') is banned — name the columns"
        echo "$out" | sed 's/^/  /'
        VIOLATIONS=$((VIOLATIONS+1))
    fi
    while IFS= read -r hit; do
        [ -z "$hit" ] && continue
        name=$(printf '%s' "$hit" | sed -E "s/.*\.from\(['\"]([^'\"]+)['\"]\).*/\1/")
        if ! list_has_line "$ALLOWED" "$name"; then
            echo "FAIL: ${f#"$ROOT"/}: .from('$name') is not on the public allowlist"
            echo "  $hit"
            VIOLATIONS=$((VIOLATIONS+1))
        fi
    done < <(grep -nE "\.from\(['\"][^'\"]+['\"]\)" "$f" || true)
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_from_allowlist.sh: FAILED ($VIOLATIONS)"; exit 1; }
# `wc -l` counts newlines, so a list without a trailing newline reports one
# short. `grep -c ''` counts lines. A guard that misreports its own corpus size is
# a guard whose output nobody trusts.
echo "lint_from_allowlist.sh: PASS (${#FILES[@]} files, $(printf '%s\n' "$ALLOWED" | grep -c '') allowed relations)"
