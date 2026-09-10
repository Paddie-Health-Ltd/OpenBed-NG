#!/usr/bin/env bash
# ============================================================
# scripts/lint_audit_log_columns.sh
# ============================================================
# app.audit_log's column list is EXACTLY the list in
# packages/fixtures/audit-log-columns.json. Nothing else, in either direction.
#
# CTO condition (1) of the ward-level identity decision, 2026-09-08. The audit
# log must contain no identity-bearing column. An `ip_address` is personal data
# in its own right, so an audit row capturing one reintroduces exactly what the
# design removed -- through a column nobody flagged.
#
# WHY EQUALITY AND NOT A FORBIDDEN-NAME LIST. A named list only catches names
# somebody already thought of. Set equality catches the column nobody forbade,
# which is the one that actually arrives. The forbidden list below is the LOUD
# leg -- it produces a better failure message and covers the ALTER TABLE vector
# -- but equality is the STRONG leg. Same two-assertion structure, and the same
# ordering of strength, as tests/db/rls_anon_column_containment.test.ts.
#
# NOT ASSERTED HERE, deliberately: the CONTENTS of old_value / new_value. A
# column-list guard is structurally blind to a jsonb payload, so
# `new_value->>'ip'` would pass this script. The controls for that are the
# 256-character CHECK constraints in migration 005 and the Bundle 3 writer, which
# builds the object server-side from enums rather than passing client input
# through. Naming this is the honest boundary of the guard; a reader who assumed
# condition (1) covered it would be wrong.
#
# CLASSIFICATION (Clause 5): GUARD-AHEAD-OF-SUBJECT. The guard executes and is
# non-vacuous over the real migrations today, but the audit WRITER it ultimately
# protects arrives in Bundle 3. Reclassify to LIVE as part of that bundle, not as
# a later tidy-up.
#
# Usage: bash scripts/lint_audit_log_columns.sh [ROOT]
#   ROOT defaults to the repository root; the argument exists so
#   tests/compliance/ can aim this script at a scratch tree holding a plant.
# Exit: 0 clean, 1 violation, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MIG_DIR="$ROOT/database/migrations"
FIXTURE="$ROOT/packages/fixtures/audit-log-columns.json"

[ -d "$MIG_DIR" ] || { echo "ERROR: no migration directory at $MIG_DIR" >&2; exit 2; }
[ -f "$FIXTURE" ]  || { echo "ERROR: column fixture not found at $FIXTURE" >&2; exit 2; }

# Expected columns, in order, from the fixture's "columns" array only.
EXPECTED=$(awk '/"columns"[[:space:]]*:/{f=1;next} f&&/\]/{exit} f{gsub(/[",]/,"");gsub(/^[[:space:]]+|[[:space:]]+$/,"");if($0!="")print}' "$FIXTURE")
[ -n "$EXPECTED" ] || { echo "ERROR: fixture parsed to zero expected columns -- refusing to pass vacuously" >&2; exit 2; }

FORBIDDEN=$(awk '/"forbidden"[[:space:]]*:/{f=1;next} f&&/\]/{exit} f{gsub(/[",]/,"");gsub(/^[[:space:]]+|[[:space:]]+$/,"");if($0!="")print}' "$FIXTURE")
[ -n "$FORBIDDEN" ] || { echo "ERROR: fixture parsed to zero forbidden names -- refusing to pass vacuously" >&2; exit 2; }

# PORTABILITY: `mapfile` is bash 4+, and macOS ships bash 3.2.
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" -not -name "*.down.sql" | sort)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no forward migrations found in $MIG_DIR" >&2; exit 2; }

# Locate the CREATE TABLE block and extract column names: the first token of each
# line inside it that is not a comment, not a CONSTRAINT/CHECK continuation, and
# not the closing paren.
ACTUAL=""
BLOCKS=0
for f in "${FILES[@]}"; do
    block=$(awk '
        /CREATE TABLE (IF NOT EXISTS )?app\.audit_log[[:space:]]*\(/ { inblk=1; next }
        inblk && /^\);/ { inblk=0; next }
        inblk { print }
    ' "$f")
    [ -z "$block" ] && continue
    BLOCKS=$((BLOCKS+1))
    ACTUAL=$(printf '%s\n' "$block" \
        | sed -e 's/--.*//' \
        | awk '{gsub(/^[[:space:]]+/,""); if ($0=="") next;
                if ($1=="CONSTRAINT" || $1=="CHECK" || $1=="UNIQUE" || $1=="PRIMARY" || $1==")") next;
                gsub(/[(,].*$/,"",$1); print $1}')
done

# ANTI-VACUITY: no CREATE TABLE for the audit log means the guard examined
# nothing, which must never report clean.
[ "$BLOCKS" -gt 0 ] || { echo "ERROR: no 'CREATE TABLE app.audit_log' found in $MIG_DIR -- nothing to check" >&2; exit 2; }

VIOLATIONS=0

# EXACT-LINE MEMBERSHIP, IN PURE BASH. Replaces `printf '%s\n' "$list" | grep -qx`.
#
# grep exits 0 for match, 1 for no match and 2 for COULD NOT RUN. Both call sites
# below branch on truthiness alone, so an exit 2 was silently reinterpreted -- and
# in one direction that meant a guard failing OPEN. No fork, no pipe, no third
# exit code. bash 3.2 compatible.
list_has_line() {
    local list=$'\n'"$1"$'\n'
    local needle=$'\n'"$2"$'\n'
    case "$list" in
        *"$needle"*) return 0 ;;
    esac
    return 1
}

# --- Leg 1: SET EQUALITY (the strong leg) ---
missing=$(comm -23 <(printf '%s\n' "$EXPECTED" | sort) <(printf '%s\n' "$ACTUAL" | sort))
extra=$(comm -13 <(printf '%s\n' "$EXPECTED" | sort) <(printf '%s\n' "$ACTUAL" | sort))
if [ -n "$extra" ]; then
    echo "FAIL: app.audit_log has columns not in the fixture:"
    printf '%s\n' "$extra" | sed 's/^/  + /'
    VIOLATIONS=$((VIOLATIONS+1))
fi
if [ -n "$missing" ]; then
    echo "FAIL: the fixture names columns app.audit_log does not have:"
    printf '%s\n' "$missing" | sed 's/^/  - /'
    VIOLATIONS=$((VIOLATIONS+1))
fi

# --- Leg 2: forbidden names (the loud leg) ---
for name in $FORBIDDEN; do
    # WAS FAILING OPEN. As `printf | grep -qx`, a grep exit of 2 -- the check
    # could not run -- took the `else` branch and reported no forbidden column.
    # This is the guard for CTO condition (1): no identity-bearing column on the
    # audit log. A guard that reports "clean" when it did not execute is the
    # defect that guard exists to prevent.
    if list_has_line "$ACTUAL" "$name"; then
        echo "FAIL: forbidden identity-bearing column '$name' on app.audit_log"
        VIOLATIONS=$((VIOLATIONS+1))
    fi
done

# --- Leg 3: no later migration may ALTER a column in ---
for f in "${FILES[@]}"; do
    out=$(sed -e "s/'[^']*'//g" -e 's/--.*//' "$f" \
          | grep -nEi 'ALTER TABLE[[:space:]]+(IF EXISTS[[:space:]]+)?app\.audit_log.*ADD[[:space:]]+COLUMN' || true)
    if [ -n "$out" ]; then
        echo "FAIL: $(basename "$f"): ALTER TABLE app.audit_log ADD COLUMN"
        printf '%s\n' "$out" | sed 's/^/  /'
        VIOLATIONS=$((VIOLATIONS+1))
    fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
    echo
    echo "lint_audit_log_columns.sh: FAILED ($VIOLATIONS)"
    echo "  The audit log must carry no identity-bearing column. If a column genuinely"
    echo "  belongs there, add it to packages/fixtures/audit-log-columns.json in the"
    echo "  same commit and say why in the pull request."
    exit 1
fi
echo "lint_audit_log_columns.sh: PASS ($(printf '%s\n' "$ACTUAL" | grep -c '') columns, exact match)"
