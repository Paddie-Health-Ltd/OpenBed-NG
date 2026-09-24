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
#   Every deployable app (each apps/*/ holding a wrangler.toml), and within it the
#   directory its `pages_build_output_dir` names -- READ, never assumed to be dist.
#   Extensions: .js .mjs .cjs .html .json
#
# UNTIL PR 3.4b-app C (R-2026-09-24-97 BY-2 d) THE CORPUS WAS A PATH GLOB,
# `apps/*/dist/**` and `apps/*/.next/static/**`, found by `find -path`. An app whose
# build output was named anything else -- `build/`, say -- was never scanned, and the
# guard reported PASS over the apps it did find. That is the gap PR B closed for the
# font guard (scripts/lint_no_third_party_fonts.sh), and the admin app, the third
# deployable app, is what made it worth closing here too. `.next/static` named a
# framework no app uses; an app that builds there now says so in its wrangler.toml.
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
# A SECOND CORPUS, AND WHY IT GETS FEWER TIERS (2026-09-18, A1 sprint Bundle 1).
#   apps/*/.functions-build/**   Extensions: .js .mjs
#   -- the BUILT Pages Functions output, produced by `npm run build:functions`,
#   required for every app that has a functions/ source directory.
# The paragraph above predicted this exactly. The first server-side credential
# in the project arrived with the /beds.json Pages Function, which reads its key
# from env.SUPABASE_SERVICE_ROLE_KEY -- a NAME, the correct shape of a
# server-side secret. Scanning it with the client rules would red on correct
# code. So the Functions tree is scanned with --server-side: the scanner's
# literal-credential tiers only (a committed key value, a service-role JWT, a
# key assembled from the prefix), never its identifier-name tier. A committed
# VALUE is a total compromise in a public repository whether or not it reaches
# a browser; a NAME is how a server-side secret is supposed to look.
# The client corpus is UNCHANGED and keeps all three tiers.
# tests/compliance/bundle_guards.test.ts asserts the two against each other --
# the same env read is accepted server-side and rejected in a client bundle --
# which is the proof the new corpus did not loosen the old one.
#
# THE SURFACE THIS GUARD COVERS, AND THE ONE IT DOES NOT (method note 12;
# R-2026-09-18-16 C5).
#   COVERS: what reaches a BROWSER -- the built client bundles -- and a
#   credential VALUE committed into what a Pages Function ships.
#   DOES NOT COVER: what reaches the PUBLIC REPOSITORY. That is a different
#   surface. The live example is `.dev.vars`, where `wrangler pages dev` reads the
#   Function's service-role key locally: it is never built into anything this
#   guard scans, so a `.dev.vars` committed to the repository is invisible here BY
#   DESIGN. The repository surface belongs to scripts/lint_no_secrets.sh. Its
#   content scan does not open `.dev.vars` (observed 2026-09-18), and should not:
#   since R-2026-09-18-17 that script carries a LOCATION check instead -- no
#   `.env`, `.env.*`, `.dev.vars` or `.dev.vars.*` file may be tracked, whatever it
#   holds, save the two `.example` templates -- which catches `git add -f` and a deleted ignore line. Its header states what
#   each of the three controls on such a file does and does not do.
#
# CLASSIFICATION (Clause 5), one per corpus, because they differ:
#   client corpus -- LIVE (corrected when the ward console's publish screen
#     shipped). This was misclassified GUARD-AHEAD-OF-SUBJECT from commit
#     fb925b2 / 349e72e onward: the code this corpus is aimed at, "a real
#     authenticated client fetch", is apps/ward-console/src/main.ts's
#     holder.authedFetch('rpc/my_facility_wards', ...) call -- sending
#     apikey + Authorization: Bearer <token>, and dropping the session on a
#     real 401 -- and that has been in the built apps/ward-console/dist bundle
#     since those commits, which predate this correction. The publish screen's
#     holder.authedFetch('rpc/publish_ward_status', ...) call is a SECOND
#     authenticated client fetch over the same corpus; it does not change this
#     classification, because it was already LIVE.
#   server-side corpus -- LIVE. The /beds.json Function exists and holds the
#     service-role credential now.
#
# ANTI-VACUITY, per corpus. No built client output FAILS, as before. An app with
# a functions/ source directory but no built Functions output FAILS. No
# functions/ directory at all is reported by count rather than failed, because a
# scratch tree planting only a client bundle has none -- and the real-corpus test
# asserts the server-side count is non-zero, so a renamed directory cannot turn
# this half vacuous silently.
#
# Usage: bash scripts/lint_no_service_role_in_bundle.sh [ROOT]
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# ANTI-VACUITY, PER APP. An app whose output directory holds no file of those types
# was not built, and a guard over an unbuilt app must not report clean -- that is
# exactly how this class of guard rots into a green light over an empty directory.
# A tree with no deployable app at all is refused the same way.
FILES=()
APPS=0
while IFS= read -r _toml; do
    _app="$(dirname "$_toml")"
    APPS=$((APPS + 1))
    _out="$(sed -n 's/^pages_build_output_dir *= *"\(\.\/\)\{0,1\}\([^"]*\)".*/\2/p' "$_toml")"
    if [ -z "$_out" ]; then
        echo "ERROR: $_toml names no pages_build_output_dir, so its built client bundle cannot be found." >&2
        exit 2
    fi
    _n=0
    while IFS= read -r _f; do FILES+=("$_f"); _n=$((_n + 1)); done < <(
        find "$_app/$_out" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.html' -o -name '*.json' \) 2>/dev/null | sort
    )
    if [ "$_n" -eq 0 ]; then
        echo "ERROR: $_app has no built client bundle in $_app/$_out." >&2
        echo "  Run 'npm run build' first. A bundle guard over an unbuilt app is not a pass." >&2
        exit 2
    fi
done < <(find "$ROOT/apps" -mindepth 2 -maxdepth 2 -type f -name wrangler.toml 2>/dev/null | sort)

if [ "$APPS" -eq 0 ]; then
    echo "ERROR: no deployable app (apps/*/wrangler.toml) under $ROOT, so no built client bundle was found." >&2
    echo "  A bundle guard over no app is not a pass." >&2
    exit 2
fi

# The server-side corpus: the BUILT Pages Functions output, one bundle per app,
# produced by `npm run build:functions` into apps/<app>/.functions-build/. The
# output and not the functions/ source, because the source is an adapter and the
# code it ships -- packages/snapshot/src/serve.ts -- is bundled in at build time.
# A scan of the adapter alone would never see a key committed in what it imports.
#
# ANTI-VACUITY: every app that HAS a functions/ source directory must have a
# non-empty built output. A functions/ directory with no build is exactly the
# "nobody ran the build" failure, and it must not report clean.
SERVER_FILES=()
while IFS= read -r _fn_dir; do
    _app="$(dirname "$_fn_dir")"
    _built=0
    while IFS= read -r _line; do SERVER_FILES+=("$_line"); _built=$((_built + 1)); done < <(
        find "$_app/.functions-build" -type f \( -name '*.js' -o -name '*.mjs' \) 2>/dev/null | sort
    )
    if [ "$_built" -eq 0 ]; then
        echo "ERROR: $_app has a functions/ directory but no built Functions output in $_app/.functions-build." >&2
        echo "  Run 'npm run build' first. A server-side scan over an unbuilt Function is not a pass." >&2
        exit 2
    fi
done < <(find "$ROOT/apps" -mindepth 2 -maxdepth 2 -type d -name functions 2>/dev/null | sort)

# The scanner has three outcomes and they are separated by hand, for the same
# reason grep's three were: whichever branch "could not run" lands on is what it
# silently becomes. Anything but 0 or 1 is fatal and loud. Each corpus is run
# and judged on its own, so a clean client bundle cannot mask a dirty Function.
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

# NO "${SERVER_FILES[@]}" ON AN EMPTY ARRAY: under `set -u` that is an
# unbound-variable error on bash 3.2, the bash macOS ships (see scripts/commit.sh).
sst=0
if [ "${#SERVER_FILES[@]}" -gt 0 ]; then
    node "$HERE/scan_bundle_credentials.mjs" --server-side "${SERVER_FILES[@]}" || sst=$?
fi
case "$sst" in
    0)  ;;
    1)  echo "lint_no_service_role_in_bundle.sh: FAILED — a service-role credential is committed as a literal in server-side code"
        echo "  A Function reads its key from the platform environment by NAME. A committed VALUE is a total compromise."
        exit 1 ;;
    *)  echo "ERROR: the server-side scan did not run (scanner exited $sst)" >&2
        exit 2 ;;
esac
echo "lint_no_service_role_in_bundle.sh: PASS (${#FILES[@]} built files scanned in $APPS app(s); ${#SERVER_FILES[@]} server-side function files scanned)"
