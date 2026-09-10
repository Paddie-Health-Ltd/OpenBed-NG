#!/usr/bin/env bash
# ============================================================
# scripts/lint_no_drop_cascade.sh
# ============================================================
# Ported from PH-Doc-Assistant-v1 scripts/lint_no_drop_cascade.sh.
#
# Fails if a FORWARD migration contains `DROP TABLE ... CASCADE` without an
# `OPENBED-CASCADE-OVERRIDE` annotation on the same line or the line above.
#
# .down.sql files are excluded: a legitimate reversal drops the tables it created.
# Forward-migration CASCADE is the corruption vector -- it silently removes
# dependent objects (a projection trigger, a foreign key, a published table's
# publication membership) that nothing else in the migration mentions.
#
# Usage: bash scripts/lint_no_drop_cascade.sh [ROOT]
#   ROOT defaults to the repository root. The argument exists so
#   tests/compliance/ can point this script at a scratch tree containing a
#   planted violation -- do not remove it because it looks unused.
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MIG_DIR="$ROOT/database/migrations"
[ -d "$MIG_DIR" ] || { echo "ERROR: no migration directory at $MIG_DIR" >&2; exit 2; }

# PORTABILITY: `mapfile` is bash 4+, and macOS ships bash 3.2. Contributors on a
# Mac would see this lint fail for a reason unrelated to what it guards -- which
# is how a guard becomes something people disable. The read loop below is
# equivalent and runs everywhere.
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" -not -name "*.down.sql" | sort)
# ANTI-VACUITY: a lint that scanned nothing must fail, not report clean.
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no forward migrations found in $MIG_DIR" >&2; exit 2; }

VIOLATIONS=0
for f in "${FILES[@]}"; do
    out=$(awk '
        toupper($0) ~ /DROP[[:space:]]+TABLE[[:space:]].*CASCADE/ {
            if ($0 !~ /OPENBED-CASCADE-OVERRIDE/ && prev !~ /OPENBED-CASCADE-OVERRIDE/)
                printf "%s:%d: DROP TABLE ... CASCADE without OPENBED-CASCADE-OVERRIDE\n", FILENAME, NR
        }
        { prev = $0 }
    ' "$f")
    # The message names the RULE, not just the hit. A guard that prints a file
    # and a grep dump tells a reader at 2am nothing about which rule fired, and
    # it gives a test nothing to assert on but a filename.
    [ -n "$out" ] && { echo "FAIL: DROP TABLE ... CASCADE without an OPENBED-CASCADE-OVERRIDE: $out"; VIOLATIONS=$((VIOLATIONS+1)); }
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_no_drop_cascade.sh: FAILED ($VIOLATIONS file(s))"; exit 1; }
echo "lint_no_drop_cascade.sh: PASS (${#FILES[@]} forward migrations)"
