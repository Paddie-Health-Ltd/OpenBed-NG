#!/usr/bin/env bash
# ============================================================
# scripts/lint_from_allowlist.sh
# ============================================================
# Client code may address ONLY the public mirrors and capped RPCs named in the
# allowlist fixture, and may never select '*'.
#
# `.select('*')` is banned because it is how a private column reaches a client the
# day after someone adds one: the query does not change, the payload does. Naming
# columns makes widening the surface a visible edit.
#
# THE ALLOWLIST IS NOT HARDCODED HERE. It is read from
# `packages/fixtures/public-relations.json`, by key -- the `mirrors` and `rpcs`
# arrays -- which `tests/db/config_drift.test.ts` IMPORTS and asserts equals the
# supabase_realtime publication membership. That link is what stops the lint's
# idea of "public" drifting away from the database's.
#
# FINDING 6, fixed 2026-09-10. That paragraph was FALSE when written. The parser
# was a fixed alternation naming all five relations inline, so the fixture was a
# filter input rather than the source of names, and a sixth relation added to the
# fixture would have been rejected as un-allowlisted. It failed closed, so it was
# never dangerous -- but Stage 1 adds a sixth name, and a header that is false in
# a way that matters is worse than one that is merely false.
#
# Parsed with node rather than sed/awk, deliberately: the fixture also holds
# `exposedSchemas` and a prose `comment`, so an all-strings extraction would pull
# in "public", "graphql_public" and every word of the comment. node is present on
# both paths that run this -- the bundle-guards CI job runs `npm ci` first, and
# the scratch-tree guard-over-a-guard runs under vitest.
#
# NOT ASSERTED HERE, deliberately: RPC call sites. This lint matches `.from(` and
# `.select('*')` only, so `.rpc('publish_ward_status')` is entirely outside its
# coverage -- the allowlist's `rpcs` array constrains what may be NAMED, not how
# an RPC is invoked. Extending to `.rpc(` would need its own plant leg and is not
# smuggled in under this one.
#
# NOT ASSERTED HERE, deliberately: anything outside $ROOT/apps. The snapshot
# generator under `packages/` is scanned by `scripts/lint_no_updated_at_filter.sh`
# instead, which is the guard that matters for it.
#
# CLASSIFICATION (Clause 5): GUARD-AHEAD-OF-SUBJECT for the from() half -- no
# client issues a query until Bundle 4. The ALLOWLIST ITSELF is live from Bundle 1
# and already tied to the schema.
#
# Usage: bash scripts/lint_from_allowlist.sh [ROOT]
# Exit: 0 clean, 1 violation, 2 usage, empty corpus, or a check that COULD NOT RUN.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
ALLOWLIST_JSON="$ROOT/packages/fixtures/public-relations.json"
[ -f "$ALLOWLIST_JSON" ] || { echo "ERROR: allowlist not found at $ALLOWLIST_JSON" >&2; exit 2; }

# READ THE ALLOWLIST BY KEY. Anything other than a clean parse is fatal and loud:
# a lint that cannot read its own allowlist must never proceed to a verdict.
PARSE_ST=0
ALLOWED=$(node -e '
  const fs = require("fs");
  let j;
  try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
  catch (e) { process.stderr.write("allowlist is not valid JSON: " + e.message); process.exit(3); }
  if (!Array.isArray(j.mirrors) || !Array.isArray(j.rpcs)) {
    process.stderr.write("allowlist must hold BOTH a mirrors array and an rpcs array");
    process.exit(4);
  }
  const names = [...j.mirrors, ...j.rpcs].filter((n) => typeof n === "string" && n.length > 0);
  process.stdout.write([...new Set(names)].sort().join("\n"));
' "$ALLOWLIST_JSON" 2>&1) || PARSE_ST=$?
case "$PARSE_ST" in
    0) ;;
    *) echo "ERROR: could not read $ALLOWLIST_JSON (node exited $PARSE_ST): $ALLOWED" >&2; exit 2 ;;
esac
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
# grep exits 0 for match, 1 for no match and 2 for COULD NOT RUN. A caller that
# branches on truthiness alone silently reinterprets exit 2 -- and in one
# direction that means a guard failing OPEN. No fork, no pipe, no third exit
# code. bash 3.2 compatible.
list_has_line() {
    local list=$'\n'"$1"$'\n'
    local needle=$'\n'"$2"$'\n'
    case "$list" in
        *"$needle"*) return 0 ;;
    esac
    return 1
}

# THE SAME DISCIPLINE FOR THE TWO GREPS THAT READ FILES, which the previous
# version did not apply to itself. Both branched on grep's truthiness, so an
# unreadable file or a fork that did not happen reported CLEAN. A check that
# could not run must never report a verdict.
grep_or_die() {  # $1 pattern, $2 file; echoes matches, exit 0 match / 1 no match
    local out st=0
    out=$(grep -nE "$1" "$2") || st=$?
    case "$st" in
        0) printf '%s' "$out"; return 0 ;;
        1) return 1 ;;
        *) echo "ERROR: grep exited $st on $2 — the check did not run" >&2; exit 2 ;;
    esac
}

for f in "${FILES[@]}"; do
    if out=$(grep_or_die "\.select\((['\"])\*\1\)" "$f"); then
        echo "FAIL: ${f#"$ROOT"/}: .select('*') is banned — name the columns"
        printf '%s\n' "$out" | sed 's/^/  /'
        VIOLATIONS=$((VIOLATIONS+1))
    fi

    hits=""
    if hits=$(grep_or_die "\.from\(['\"][^'\"]+['\"]\)" "$f"); then
        while IFS= read -r hit; do
            [ -z "$hit" ] && continue
            name=$(printf '%s' "$hit" | sed -E "s/.*\.from\(['\"]([^'\"]+)['\"]\).*/\1/")
            if ! list_has_line "$ALLOWED" "$name"; then
                echo "FAIL: ${f#"$ROOT"/}: .from('$name') is not on the public allowlist"
                echo "  $hit"
                VIOLATIONS=$((VIOLATIONS+1))
            fi
        done <<< "$hits"
    fi
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_from_allowlist.sh: FAILED ($VIOLATIONS)"; exit 1; }
# `wc -l` counts newlines, so a list without a trailing newline reports one
# short. `grep -c ''` counts lines. A guard that misreports its own corpus size is
# a guard whose output nobody trusts.
echo "lint_from_allowlist.sh: PASS (${#FILES[@]} files, $(printf '%s\n' "$ALLOWED" | grep -c '') allowed relations)"
