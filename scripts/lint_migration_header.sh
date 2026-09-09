#!/usr/bin/env bash
# ============================================================
# scripts/lint_migration_header.sh
# ============================================================
# Every forward migration carries the house banner and registers itself.
#
# Checks, per forward migration:
#   1. Opens with a `-- ===` banner block.
#   2. The banner names the file itself -- so a copy-pasted header that still
#      cites its source file is caught.
#   3. Contains an "Idempotency:" note.
#   4. Ends by inserting its own filename into app.schema_migrations.
#   5. A paired .down.sql exists.
#
# Check 2 and check 4 are the load-bearing ones: both catch the same real
# mistake, which is a migration created by copying its predecessor. A wrong
# filename in the ledger INSERT means the runner re-applies the file forever.
#
# Usage: bash scripts/lint_migration_header.sh [ROOT]
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
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no forward migrations found in $MIG_DIR" >&2; exit 2; }

VIOLATIONS=0
fail() { echo "FAIL: $1"; VIOLATIONS=$((VIOLATIONS+1)); }

for f in "${FILES[@]}"; do
    base="$(basename "$f")"

    # THE LEADING COMMENT BLOCK ONLY -- every line from the top of the file up to
    # the first line that is not a comment and not blank.
    #
    # An earlier version of this lint used `head -40`, and a plant in
    # tests/compliance/lint_migration_header.test.ts showed why that was wrong: on
    # a short migration the ledger INSERT falls inside the first 40 lines and
    # satisfies the filename check ALL BY ITSELF, so a file with no banner at all
    # passed. The check was measuring the wrong region of the file.
    banner=$(awk '/^[[:space:]]*(--|$)/ { print; next } { exit }' "$f")

    printf '%s\n' "$banner" | grep -q -- '-- ===' || fail "$base: no '-- ===' banner block at the top of the file"
    printf '%s\n' "$banner" | grep -qF "$base"    || fail "$base: banner does not name this file (copied header?)"
    printf '%s\n' "$banner" | grep -q 'Idempotency:' || fail "$base: no 'Idempotency:' note in the banner"
    grep -qF "VALUES ('$base'" "$f"                || fail "$base: does not register itself in app.schema_migrations"
    [ -f "${f%.sql}.down.sql" ]                    || fail "$base: no paired .down.sql"
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_migration_header.sh: FAILED ($VIOLATIONS)"; exit 1; }
echo "lint_migration_header.sh: PASS (${#FILES[@]} forward migrations)"
