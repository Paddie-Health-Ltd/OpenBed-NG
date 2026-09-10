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
# CHECK 3 ASSERTS THE PRESENCE OF A DECLARATION, NOT IDEMPOTENCY. It greps the
# banner for the string "Idempotency:" -- which is an author's CLAIM about the
# migration, not a property of it. A migration can carry a perfect note and be
# wildly non-idempotent, and this script would pass it.
#
# The PROPERTY is asserted by tests/db/migration_idempotency.test.ts, which
# applies every forward migration a second time and asserts both that it raises
# no error AND that it changes nothing -- structure and row counts. That
# distinction matters because "no error" is the presence axis: a migration can
# re-run cleanly while still mutating, and the silent case is the one that hurts.
#
# Keep the two straight. This lint catches a missing note in review; that test
# catches a migration that would corrupt a re-run after a partial failure, which
# is the recovery path scripts/run_migrations.sh depends on.
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
    banner=$(awk '/^[[:space:]]*(--|$)/ { print; next } { exit }' "$f") || {
        echo "ERROR: awk could not read $f -- the banner check did not run" >&2
        exit 2
    }

    # SUBSTRING MATCHING IN BASH, NOT `printf | grep -q`. READ THIS BEFORE
    # "SIMPLIFYING" IT BACK.
    #
    # These three checks were `printf '%s\n' "$banner" | grep -q ... || fail`.
    # That shape has two independent defects and the second is the one that bit:
    #
    #   1. `|| fail` treats EVERY non-zero as a violation. grep exits 1 for "no
    #      match" and 2 for "could not run" -- a resource failure, an unreadable
    #      input, a fork that did not happen. The lint reported the second as the
    #      first, so a check that never executed was indistinguishable from a
    #      check that found a real problem.
    #   2. Each one forked a subshell and a grep. At ~9 forks per migration and
    #      14 migrations, one invocation forked ~126 processes, and the compliance
    #      suite invokes the lints across ten concurrent vitest workers.
    #
    # On 2026-09-10 this reported `006_gate_function.sql: no '-- ===' banner
    # block` in CI -- for a file whose first byte is `-` and whose banner is 58
    # lines long. The banner was fine; a check failed to run and said "violation".
    #
    # `case` is pure bash: no fork, no pipe, no exit-code ambiguity, and bash 3.2
    # compatible. There is no failure mode left to distinguish, which is why the
    # error branch below exists only for the one check that still reads a file.
    case "$banner" in
        *'-- ==='*) ;;
        *) fail "$base: no '-- ===' banner block at the top of the file" ;;
    esac
    case "$banner" in
        *"$base"*) ;;
        *) fail "$base: banner does not name this file (copied header?)" ;;
    esac
    case "$banner" in
        *'Idempotency:'*) ;;
        *) fail "$base: no 'Idempotency:' note in the banner" ;;
    esac

    # This one must read the file, so grep stays -- but its exit codes are now
    # separated. 1 is a finding; anything else is the check failing to run, and
    # that is loud and fatal rather than a silent false violation.
    st=0
    grep -qF "VALUES ('$base'" "$f" || st=$?
    case "$st" in
        0) ;;
        1) fail "$base: does not register itself in app.schema_migrations" ;;
        *) echo "ERROR: grep exited $st on $f -- the ledger check did not run" >&2
           exit 2 ;;
    esac

    [ -f "${f%.sql}.down.sql" ] || fail "$base: no paired .down.sql"
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_migration_header.sh: FAILED ($VIOLATIONS)"; exit 1; }
echo "lint_migration_header.sh: PASS (${#FILES[@]} forward migrations)"
