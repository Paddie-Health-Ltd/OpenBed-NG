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
# THIS FILE OWNS THE CORPUS, THE ANTI-VACUITY LEG AND THE VERDICT.
# The MATCHING lives in scripts/scan_bundle_credentials.mjs, because deciding
# what is a credential now requires a real JavaScript parse -- see that file's
# header for the three tiers and for what this guard does not prove.
#
# WHY A PARSE. Until 2026-09-10 this was a word grep over raw bundle text, so it
# fired on any library that DOCUMENTS the hazard it guards. @supabase/supabase-js
# produced 24 hits and none was a credential. A guard that reds on a JSDoc
# warning is a guard someone switches off.
#
# SCOPE IS BUILT CLIENT OUTPUT ONLY, AND THAT IS DELIBERATE.
#   apps/*/dist/**  and  apps/*/.next/static/**
#   Extensions: .js .mjs .cjs .html .json
#
# That list is a CLAIM ABOUT COVERAGE, and test-conventions.md section 2(d)
# requires the claim be asserted rather than described: a planted credential in
# every declared extension, in every declared location, must be rejected. See
# tests/compliance/bundle_guards.test.ts. A corpus that is merely non-empty
# proves nothing about the corners it never reached.
#
# Bundle 4's snapshot generator is LEGITIMATELY service-role and legitimately
# server-side. A source-scoped grep would fail on it, someone would widen the
# guard under deadline pressure, and the widened guard is what ships. Scoping to
# built client output now -- before that argument happens -- is what keeps the
# guard narrow enough to survive.
#
# CLASSIFICATION (Clause 5): GUARD-AHEAD-OF-SUBJECT. It runs and is non-vacuous
# against the built dashboard and ward-console bundles, but the code it is aimed
# at -- a real authenticated client fetch -- arrives with the ward console's
# first screen.
#
# Usage: bash scripts/lint_no_service_role_in_bundle.sh [ROOT]
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(
    find "$ROOT/apps" \( -path '*/dist/*' -o -path '*/.next/static/*' \) \
         -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.html' -o -name '*.json' \) 2>/dev/null | sort
)

# ANTI-VACUITY. An empty corpus means the apps were not built, and a guard that
# scans nothing must not report clean -- that is exactly how this class of guard
# rots into a green light over an empty directory.
if [ "${#FILES[@]}" -eq 0 ]; then
    echo "ERROR: no built client bundles found under $ROOT/apps." >&2
    echo "  Run 'npm run build' first. A bundle guard over an empty corpus is not a pass." >&2
    exit 2
fi

# The scanner has three outcomes and they are separated by hand, for the same
# reason grep's three were: whichever branch "could not run" lands on is what it
# silently becomes. Anything but 0 or 1 is fatal and loud.
st=0
node "$HERE/scan_bundle_credentials.mjs" "${FILES[@]}" || st=$?
case "$st" in
    0)  ;;
    1)  echo "lint_no_service_role_in_bundle.sh: FAILED — a credential is reachable from a built client bundle"
        echo "  A service-role credential in a client bundle is a total compromise."
        exit 1 ;;
    *)  echo "ERROR: the bundle scan did not run (scanner exited $st)" >&2
        exit 2 ;;
esac
echo "lint_no_service_role_in_bundle.sh: PASS (${#FILES[@]} built files scanned)"
