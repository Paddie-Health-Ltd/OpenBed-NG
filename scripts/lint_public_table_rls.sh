#!/usr/bin/env bash
# ============================================================
# scripts/lint_public_table_rls.sh
# ============================================================
# Every table created in schema `public` must ENABLE and FORCE row level security
# in the SAME migration that creates it (R-2026-09-22-56 C).
#
# WHY IN THE SAME FILE. A table created in one migration and secured in a later one
# is unprotected for every deployment between them, and on a hosted project that
# window is however long it takes the next migration to be applied. 018 merged on
# 2026-09-21 and was applied hosted on 2026-09-22.
#
# WHY THIS LINT EXISTS AT ALL, and it is the reason worth reading. The hosted
# project carries an event trigger, `ensure_rls`, which enables RLS for tables
# created in `public`. Local does not. So a migration that forgets these statements
# produces a hosted database that is SILENTLY STRICTER than the local one the whole
# suite runs against -- the tests would be passing over a database looser than
# production, and the omission would never surface as a failure anywhere.
#
# WHY ENABLE IS NOT ENOUGH. Without FORCE, the table OWNER bypasses its own
# policies -- and the projection trigger runs as a SECURITY DEFINER function owned
# by that same role. ENABLE alone reads as protection and is not.
#
# NOT ASSERTED HERE, deliberately (method note 12):
#   - THE LIVE CATALOGUE. tests/db/rls_enabled_everywhere.test.ts asserts
#     relrowsecurity AND relforcerowsecurity over every real table in `public`, and
#     pins the table set by identity. THE TWO ARE COMPLEMENTS, NOT DUPLICATES: that
#     test can only see what has been applied to a database, and sees it only after
#     the fact; this lint catches the statement in review, before it reaches any
#     database, and catches it in a down migration too.
#   - THAT THE POLICIES ARE CORRECT. RLS enabled with a permissive policy is a
#     different defect with its own tests. This says only that the switch is on.
#   - ANYTHING ABOUT SCHEMA `app`. Its 16 tables deliberately carry no RLS: no
#     client role holds any grant on them and `app` is not an exposed schema, so
#     enabling RLS there would protect against a caller that cannot arrive. A lint
#     that fired on them would be switched off within a week.
#
# Usage: bash scripts/lint_public_table_rls.sh [ROOT]
#   ROOT defaults to the repository root. The argument exists so tests/compliance/
#   can point this script at a scratch tree containing a planted violation -- do not
#   remove it because it looks unused.
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MIG_DIR="$ROOT/database/migrations"
[ -d "$MIG_DIR" ] || { echo "ERROR: no migration directory at $MIG_DIR" >&2; exit 2; }

# PORTABILITY: `mapfile` is bash 4+, and macOS ships bash 3.2.
#
# DOWN MIGRATIONS ARE IN THE CORPUS, deliberately: a down migration that re-creates
# a public table without RLS opens exactly the same hole as a forward one.
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" | sort)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no migrations found in $MIG_DIR" >&2; exit 2; }

CREATE_RE='CREATE[[:space:]]+TABLE([[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS)?[[:space:]]+'
VIOLATIONS=0
PAIRED=""

for f in "${FILES[@]}"; do
    # Strip string literals and comments first, so the rule can be DESCRIBED in a
    # banner or a COMMENT ON without tripping the lint that enforces it. Nothing is
    # deleted, only blanked.
    BLANKED="$(sed -e "s/'[^']*'//g" -e 's/--.*//' "$f")"

    # A table created with no schema qualifier lands wherever search_path points,
    # which on this project is not knowable from the file.
    st=0
    unq="$(printf '%s\n' "$BLANKED" | grep -nEi "${CREATE_RE}[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(")" || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the unqualified CREATE TABLE scan exited $st on $f -- it did not run" >&2; exit 2 ;;
    esac
    if [ -n "$unq" ]; then
        echo "FAIL: a table is created without a schema qualifier, so it lands wherever search_path points: $(basename "$f"): $unq"
        VIOLATIONS=$((VIOLATIONS+1))
    fi

    st=0
    created="$(printf '%s\n' "$BLANKED" | grep -oEi "${CREATE_RE}public\.[A-Za-z_][A-Za-z0-9_]*")" || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the CREATE TABLE scan exited $st on $f -- it did not run" >&2; exit 2 ;;
    esac

    while IFS= read -r _c; do
        [ -n "$_c" ] || continue
        t="$(printf '%s' "$_c" | sed -E 's/.*[Pp][Uu][Bb][Ll][Ii][Cc]\.//')"

        est=0
        printf '%s\n' "$BLANKED" \
          | grep -qEi "ALTER[[:space:]]+TABLE[[:space:]]+(ONLY[[:space:]]+)?public\.$t[[:space:]]+ENABLE[[:space:]]+ROW[[:space:]]+LEVEL[[:space:]]+SECURITY" || est=$?
        case "$est" in
            0) ;;
            1) echo "FAIL: public.$t is created in $(basename "$f") and never ENABLEs row level security"
               echo "  A public table with RLS off is readable by anon the moment PostgREST exposes the schema."
               VIOLATIONS=$((VIOLATIONS+1)) ;;
            *) echo "ERROR: the ENABLE ROW LEVEL SECURITY scan exited $est on $f -- it did not run" >&2; exit 2 ;;
        esac

        fst=0
        printf '%s\n' "$BLANKED" \
          | grep -qEi "ALTER[[:space:]]+TABLE[[:space:]]+(ONLY[[:space:]]+)?public\.$t[[:space:]]+FORCE[[:space:]]+ROW[[:space:]]+LEVEL[[:space:]]+SECURITY" || fst=$?
        case "$fst" in
            0) ;;
            1) echo "FAIL: public.$t ENABLEs row level security in $(basename "$f") but never FORCEs it"
               echo "  Without FORCE the table owner bypasses its own policies, and the projection trigger is a SECURITY DEFINER function owned by that role."
               VIOLATIONS=$((VIOLATIONS+1)) ;;
            *) echo "ERROR: the FORCE ROW LEVEL SECURITY scan exited $fst on $f -- it did not run" >&2; exit 2 ;;
        esac

        if [ "$est" -eq 0 ] && [ "$fst" -eq 0 ]; then
            PAIRED="$PAIRED $t"
        fi
    done <<EOF
$created
EOF
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_public_table_rls.sh: FAILED ($VIOLATIONS)"; exit 1; }

# THE PASS LINE NAMES THE TABLES IT PAIRED, never just a count. A detector whose
# regex stopped matching would report a clean corpus and an empty list, and those
# two outcomes must not look the same. tests/compliance/lint_public_table_rls.test.ts
# asserts the four real names appear here.
echo "lint_public_table_rls.sh: PASS (${#FILES[@]} migrations; public tables paired:$PAIRED)"
