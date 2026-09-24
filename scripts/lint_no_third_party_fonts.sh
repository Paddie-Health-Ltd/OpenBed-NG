#!/usr/bin/env bash
# ============================================================
# scripts/lint_no_third_party_fonts.sh
# ============================================================
# NO THIRD-PARTY FONT HOST IN ANY BUILT APP (R-2026-09-24-88 BP-10; PR 3.4b-app B).
#
# A page that loads fonts.googleapis.com or fonts.gstatic.com hands every visitor's IP
# address and page to a third party on load, and widens each app's CSP to a host it
# does not otherwise need. The apps use the system font stack (BP-10: "self-hosting for
# v1 settled by using none"), so the right number of such hosts is zero.
#
# THE CORPUS IS EVERY DEPLOYABLE APP'S BUILT OUTPUT: each apps/*/ directory holding a
# wrangler.toml, and within it the directory its `pages_build_output_dir` names (read,
# never assumed to be dist). The file types are js, mjs, cjs, html AND css. A font host
# sits in CSS as often as in markup, and the service-role bundle guard's corpus has no
# css because a key does not sit there: a description broader than its filter is the
# gap test-conventions section 2(d) names. tests/compliance/bundle_guards.test.ts
# asserts this declared matrix by identity, one plant per type.
#
# ANTI-VACUITY, per app. An app whose output directory holds no file of those types was
# not built, and a guard over an unbuilt app must not report clean: exit 2, naming it.
#
# Usage: bash scripts/lint_no_third_party_fonts.sh [ROOT]
# Exit: 0 clean, 1 a font host found, 2 usage, an unbuilt app, or grep could not run.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

FILES=()
APPS=0
while IFS= read -r _toml; do
    _app="$(dirname "$_toml")"
    APPS=$((APPS + 1))
    _out="$(sed -n 's/^pages_build_output_dir *= *"\(\.\/\)\{0,1\}\([^"]*\)".*/\2/p' "$_toml")"
    if [ -z "$_out" ]; then
        echo "ERROR: $_toml names no pages_build_output_dir, so its built output cannot be found." >&2
        exit 2
    fi
    _n=0
    while IFS= read -r _f; do FILES+=("$_f"); _n=$((_n + 1)); done < <(
        find "$_app/$_out" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.html' -o -name '*.css' \) 2>/dev/null | sort
    )
    if [ "$_n" -eq 0 ]; then
        echo "ERROR: $_app has no built output in $_app/$_out. Run 'npm run build' first: a font guard over an unbuilt app is not a pass." >&2
        exit 2
    fi
done < <(find "$ROOT/apps" -mindepth 2 -maxdepth 2 -type f -name wrangler.toml 2>/dev/null | sort)

if [ "$APPS" -eq 0 ]; then
    echo "ERROR: no deployable app (apps/*/wrangler.toml) under $ROOT. A font guard over no app is not a pass." >&2
    exit 2
fi

# grep has three outcomes, separated by hand: 0 a match, 1 none, anything else it
# could not run -- which must never read as clean (test-conventions section 8).
st=0
hits="$(grep -nE 'fonts\.googleapis\.com|fonts\.gstatic\.com' "${FILES[@]}")" || st=$?
case "$st" in
    0)  printf '%s\n' "$hits"
        echo "lint_no_third_party_fonts.sh: FAILED ($(printf '%s\n' "$hits" | cut -d: -f1 | sort -u | wc -l | tr -d ' ') file(s)) -- a third-party font host is in a built app"
        exit 1 ;;
    1)  echo "lint_no_third_party_fonts.sh: PASS (${#FILES[@]} built files in $APPS app(s), no third-party font host)" ;;
    *)  echo "ERROR: grep exited $st over the built apps -- the check did not run" >&2
        exit 2 ;;
esac
