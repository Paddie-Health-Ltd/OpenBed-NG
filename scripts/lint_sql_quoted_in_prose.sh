#!/usr/bin/env bash
# ============================================================
# scripts/lint_sql_quoted_in_prose.sh
# ============================================================
# THE scripts/ SURVEY'S ITEM 2 (R-2026-09-28-162, EL-2 a). Nothing validated SQL
# quoted in prose, and prose SQL is SQL a reader copies.
#
# THE DEFECT, as it happened. database/migrations/README.md's corrections for 002
# and 006 read `IS NOT DISTINCT FROM NO`, `= NO` and `<> NO`: the quotes around
# the 'NO' literal were stripped when that section was written through a
# shell-escaped script in the v1 sweep. Unquoted, NO is an identifier, not a
# value, and the prescribed line does not run.
#
# WHAT IT CATCHES: a comparison -- =, <>, !=, IS DISTINCT FROM, IS NOT DISTINCT
# FROM -- whose right-hand side is an UNQUOTED YES, NO or UNKNOWN.
#   - The literal is matched case-sensitively and as a whole token, with the
#     underscore counted as a word character: `gated_by = NO_ANAESTHETIST_ON_DUTY`
#     is not a hit, and neither is "the answer = no". The keywords IS, NOT,
#     DISTINCT and FROM match in any case, as SQL reads them.
#   - `=> NO` is not a hit: `>` stands between the = and the literal.
#
# CORPUS, three disjoint locations, each counted on its own:
#   1. the tracked *.md files (git ls-files), except .claude/rules/ and the
#      decision record below;
#   2. the tracked files under .claude/rules/;
#   3. the `--` comments in database/migrations/*.sql, read from disk as the other
#      migration lints read them, so a migration not yet added is still read. Only
#      the text from each line's first `--` is scanned: migration CODE is outside
#      this guard, and scripts/lint_sql_no_bare_not_duty_flag.sh reads it.
# ANTI-VACUITY IS PER LOCATION: zero files in any one of the three is exit 2, as
# is a root git cannot list.
#
# A HIT IN A FROZEN MIGRATION'S COMMENT cannot be fixed by editing the migration.
# Its correction goes to database/migrations/README.md, under "Corrections to
# frozen migrations", and the comment is then out of this guard's reach only by a
# ruling that says so.
#
# Classified under code-pipeline Clause 5 as LIVE: the prose it reads exists now,
# and the defect it names was found in it.
#
# NOT ASSERTED HERE, deliberately:
#   - Sprint Kickoffs/decision-2026-09-14-public-private-split.md is OUT OF SCOPE,
#     not allowlisted. It is append-only, and it quotes the broken form as
#     evidence (1148, 1187 and 8837 at 3bac730), as R-2026-09-28-162 does again.
#     A guard over it would demand the record be rewritten, which the record's
#     own rules forbid. The exclusion is one path, EXCLUDED below; a renamed
#     record is scanned under its new name, and the test proves it.
#   - that quoted SQL COMPILES. This matches one shape. Fenced sql blocks and
#     whole statements in prose were listed by R-2026-09-28-162 (EL-2 b), for a
#     ruling, and are not validated here; tests/db/runbook_12_4_12_5_sql_live.test.ts
#     runs the runbook's 12.4 and 12.5 psql lines.
#   - a lower-case unquoted literal (`= no`), which reads as English too often to
#     be refused.
#
# Usage: bash scripts/lint_sql_quoted_in_prose.sh [ROOT]
#   ROOT defaults to the repository root; the argument exists so
#   tests/compliance/ can aim this script at a scratch repository holding a
#   planted violation. Do not remove it because it looks unused.
# Exit: 0 clean, 1 violation, 2 usage, an empty location or a check that did not run.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MIG_DIR="$ROOT/database/migrations"
EXCLUDED='Sprint Kickoffs/decision-2026-09-14-public-private-split.md'

KW_IS='[Ii][Ss]'
KW_NOT='[Nn][Oo][Tt]'
KW_DISTINCT='[Dd][Ii][Ss][Tt][Ii][Nn][Cc][Tt]'
KW_FROM='[Ff][Rr][Oo][Mm]'
OP="(=|<>|!=|(^|[^A-Za-z0-9_])${KW_IS}[[:space:]]+(${KW_NOT}[[:space:]]+)?${KW_DISTINCT}[[:space:]]+${KW_FROM})"
PATTERN="${OP}[[:space:]]*(YES|NO|UNKNOWN)([^A-Za-z0-9_]|\$)"

TMP="$(mktemp)"
COMMENTS="$(mktemp)"
trap 'rm -f "$TMP" "$COMMENTS"' EXIT

# git ls-files -z into a file, not a variable: bash cannot hold a NUL, and a
# process substitution would lose git's exit status.
st=0
git -C "$ROOT" ls-files -z -- '*.md' '.claude/rules/*' > "$TMP" 2>/dev/null || st=$?
case "$st" in
    0) ;;
    *) echo "ERROR: could not list tracked files in $ROOT (git exited $st)" >&2; exit 2 ;;
esac

MD=()
RULES=()
while IFS= read -r -d '' p; do
    case "$p" in
        .claude/rules/*) RULES+=("$p") ;;
        "$EXCLUDED") ;;
        *.md) MD+=("$p") ;;
    esac
done < "$TMP"

[ "${#MD[@]}" -gt 0 ] || { echo "ERROR: no tracked .md files outside .claude/rules in $ROOT" >&2; exit 2; }
[ "${#RULES[@]}" -gt 0 ] || { echo "ERROR: no tracked files under .claude/rules in $ROOT" >&2; exit 2; }
[ -d "$MIG_DIR" ] || { echo "ERROR: no migration directory at $MIG_DIR" >&2; exit 2; }
MIGS=()
while IFS= read -r _line; do MIGS+=("$_line"); done < <(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" | sort)
[ "${#MIGS[@]}" -gt 0 ] || { echo "ERROR: no migrations found in $MIG_DIR" >&2; exit 2; }

VIOLATIONS=0

# scan <label> <file>: one FAIL block per file with a hit. ONE grep site, so a
# could-not-run is one leg with one identity. Only 0 and 1 are verdicts: grep's 2
# means it could not read the file.
scan () {
    local label="$1" path="$2" st=0 out
    out=$(grep -nE "$PATTERN" "$path") || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the prose scan exited $st on $label -- it did not run" >&2; exit 2 ;;
    esac
    if [ -n "$out" ]; then
        echo "FAIL: unquoted tri-state literal in quoted SQL: $label:"
        printf '%s\n' "$out" | sed 's/^/  /'
        VIOLATIONS=$((VIOLATIONS+1))
    fi
}

for p in "${MD[@]}" "${RULES[@]}"; do
    scan "$p" "$ROOT/$p"
done

# A migration line keeps its number and loses everything before its first `--`.
# The read is its own step, into a file: under pipefail a pipeline reports its
# LAST non-zero status, so `awk | grep` would report grep's 1 (no match) for a
# file awk could not read.
for f in "${MIGS[@]}"; do
    st=0
    awk '{ i = index($0, "--"); if (i) print substr($0, i); else print "" }' "$f" > "$COMMENTS" || st=$?
    case "$st" in
        0) ;;
        *) echo "ERROR: the comment read of a migration exited $st on $f" >&2; exit 2 ;;
    esac
    scan "database/migrations/$(basename "$f")" "$COMMENTS"
done

[ "$VIOLATIONS" -eq 0 ] || {
    echo "lint_sql_quoted_in_prose.sh: FAILED ($VIOLATIONS file(s))"
    echo "  Quote the literal: 'NO', 'YES', 'UNKNOWN'. Unquoted, it is an identifier and the SQL does not run."
    echo "  A frozen migration's comment is corrected in database/migrations/README.md, not in the migration."
    exit 1
}
echo "lint_sql_quoted_in_prose.sh: PASS (${#MD[@]} .md files, ${#RULES[@]} rules files, ${#MIGS[@]} migrations)"
