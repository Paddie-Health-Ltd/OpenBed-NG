#!/usr/bin/env bash
# ============================================================
# scripts/lint_no_updated_at_filter.sh
# ============================================================
# FRESHNESS MAY REORDER. IT MAY NEVER FILTER.
#
# Fails if `updated_at` appears inside a WHERE / .filter() / .lt() / .gt() /
# .gte() / .lte() on the public search path.
#
# THE 4AM BUG. At 04:00 every ward in the system is stale, because nobody updates
# a bed board overnight. Any freshness filter therefore empties the ENTIRE result
# set at exactly the hour the tool matters most -- and it does so silently,
# looking like "no beds available" rather than like a bug. It will pass every test
# written against the spec, because the spec is what causes it.
#
# This guard is crude on purpose. It is a grep, it will occasionally need an
# explicit ORDER-BY annotation, and it is the control most likely to actually
# catch the regression a future contributor introduces -- because the regression
# looks like a sensible optimisation when they write it.
#
# The legitimate use is ORDER BY. Annotate those lines with
# `OPENBED-FRESHNESS-ORDER-ONLY` and this lint accepts them; the annotation is
# grep-able, so how many exist is itself reviewable.
#
# CLASSIFICATION (Clause 5): LIVE since R-2026-10-09 GO. The public search path this guard
# names, ordering and filtering the dashboard's results, exists: apps/public-dashboard/src/search.ts
# builds the eligible hospitals and orders them, and apps/public-dashboard/src/main.ts draws them.
# This script scans both, among every client source file under apps/ and packages/ (its PASS line
# prints how many). Until that change this was GUARD-AHEAD-OF-SUBJECT: it ran over a /beds.json
# fetch-and-render path that filtered on nothing, with its true subject still to come.
#
# WHAT THIS GREP IS NOT. It reads one line at a time and looks for a timestamp beside a filter
# call, so a filter on a band (a `.filter` that drops the SUPPRESSED rows) has no timestamp on its
# line and PASSES. It is therefore NOT the control that proves the page never empties by age.
# THAT CONTROL IS BEHAVIOURAL: tests/compliance/search_freshness.test.ts renders the real page over
# a payload whose every ward is SUPPRESSED, then one whose every age is unknown, then the 4am case,
# and asserts every hospital's name and call link is on the page. The script itself is unchanged by
# the reclassification, except for this header.
#
# Usage: bash scripts/lint_no_updated_at_filter.sh [ROOT]
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(
    find "$ROOT/apps" "$ROOT/packages" -type f \( -name '*.ts' -o -name '*.tsx' \) \
         -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null | sort
)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no client source found under $ROOT/apps or $ROOT/packages" >&2; exit 2; }

VIOLATIONS=0
for f in "${FILES[@]}"; do
    # `|| true` on a three-stage pipeline hid grep's exit 2 at every stage, so an
    # unreadable source file reported no 4am freshness filter. REMOVING `|| true`
    # DID NOT FIX IT, although this comment said so until R-2026-09-28-163: under
    # pipefail the pipeline reports its LAST non-zero status, so the later greps'
    # 1 still hid the first grep's 2, and a mode-000 file read PASS.
    #
    # THE FIRST GREP IS THE READ, so it runs on its own and its 0, 1 or 2 is
    # captured on its own. Its output is then filtered from printf, which has
    # nothing to fail to read.
    st=0
    hits=$(grep -nE "updated_at|updatedAt" "$f") || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the updated_at read exited $st on $f -- the file was not scanned" >&2; exit 2 ;;
    esac
    st=0
    out=$(printf '%s\n' "$hits" | grep -Ei '\.(filter|lt|gt|gte|lte|neq|eq)\(|where|WHERE' | grep -v 'OPENBED-FRESHNESS-ORDER-ONLY') || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the freshness-filter scan exited $st on $f -- it did not run" >&2; exit 2 ;;
    esac
    if [ -n "$out" ]; then
        echo "FAIL: updated_at used as a FILTER on the public search path: ${f#"$ROOT"/}"
        echo "$out" | sed 's/^/  /'
        VIOLATIONS=$((VIOLATIONS+1))
    fi
done

[ "$VIOLATIONS" -eq 0 ] || {
    echo "lint_no_updated_at_filter.sh: FAILED ($VIOLATIONS file(s))"
    echo "  Freshness may reorder results; it may never remove them. At 4am a"
    echo "  freshness filter returns nothing at all."
    exit 1
}
echo "lint_no_updated_at_filter.sh: PASS (${#FILES[@]} source files scanned)"
