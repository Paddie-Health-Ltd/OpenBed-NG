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
# CLASSIFICATION (Clause 5): GUARD-AHEAD-OF-SUBJECT. The public search path is
# built in Bundle 4. It runs over the Bundle 1 stub today.
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
    # unreadable source file reported no 4am freshness filter.
    st=0
    out=$(grep -nE "updated_at|updatedAt" "$f" \
          | grep -Ei '\.(filter|lt|gt|gte|lte|neq|eq)\(|where|WHERE' \
          | grep -v 'OPENBED-FRESHNESS-ORDER-ONLY') || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the freshness-filter scan exited $st on $f -- it did not run" >&2; exit 2 ;;
    esac
    if [ -n "$out" ]; then
        echo "FAIL: ${f#"$ROOT"/}"
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
