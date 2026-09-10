#!/usr/bin/env bash
# ============================================================
# scripts/lint_no_service_role_in_bundle.sh
# ============================================================
# No service-role credential may reach a BUILT CLIENT BUNDLE.
#
# In a public repository, a leaked service_role key is a total compromise of the
# one credential in this system that cannot be rotated quietly -- and it bypasses
# every RLS policy by design. The realistic path to it is not malice: it is an
# assistant or a developer blocked by the security boundary reaching for the
# service key "temporarily" and landing it in a client-imported module or a
# NEXT_PUBLIC_ / VITE_ variable.
#
# SCOPE IS BUILT CLIENT OUTPUT ONLY, AND THAT IS DELIBERATE.
#   apps/*/dist/**  and  apps/*/.next/static/**
#
# Bundle 4's snapshot generator is LEGITIMATELY service-role and legitimately
# server-side. A source-scoped grep would fail on it, someone would widen the
# guard under deadline pressure, and the widened guard is what ships. Scoping to
# built client output now -- before that argument happens -- is what keeps the
# guard narrow enough to survive.
#
# CLASSIFICATION (Clause 5): GUARD-AHEAD-OF-SUBJECT. It runs and is non-vacuous
# from commit one against the Bundle 1 dashboard stub, but the code it is aimed
# at -- a real Supabase client -- arrives in Bundle 4.
#
# Usage: bash scripts/lint_no_service_role_in_bundle.sh [ROOT]
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(
    find "$ROOT/apps" \( -path '*/dist/*' -o -path '*/.next/static/*' \) \
         -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.html' -o -name '*.json' \) 2>/dev/null | sort
)

# ANTI-VACUITY. An empty corpus means the apps were not built, and a guard that
# greps nothing must not report clean -- that is exactly how this class of guard
# rots into a green light that examines an empty directory.
if [ "${#FILES[@]}" -eq 0 ]; then
    echo "ERROR: no built client bundles found under $ROOT/apps." >&2
    echo "  Run 'npm run build' first. A bundle guard over an empty corpus is not a pass." >&2
    exit 2
fi

PATTERN='service_role|SUPABASE_SERVICE|SERVICE_ROLE_KEY|sb_secret_'
VIOLATIONS=0
for f in "${FILES[@]}"; do
    # grep exits 2 when it COULD NOT RUN. `if out=$(grep ...)` puts that on the
    # clean branch, so an unreadable bundle would have reported NO service-role
    # credential. Separated by hand; anything but 0 or 1 is fatal and loud.
    st=0
    out=$(grep -nE "$PATTERN" "$f") || st=$?
    case "$st" in
        0)  echo "FAIL: service-role credential reachable from a built client bundle: ${f#"$ROOT"/}"
            printf '%s\n' "$out" | cut -c1-160 | sed 's/^/  /'
            VIOLATIONS=$((VIOLATIONS+1)) ;;
        1)  ;;
        *)  echo "ERROR: grep exited $st on $f -- the bundle scan did not run" >&2; exit 2 ;;
    esac
done

[ "$VIOLATIONS" -eq 0 ] || {
    echo "lint_no_service_role_in_bundle.sh: FAILED ($VIOLATIONS file(s))"
    echo "  A service-role credential in a client bundle is a total compromise."
    exit 1
}
echo "lint_no_service_role_in_bundle.sh: PASS (${#FILES[@]} built files scanned)"
