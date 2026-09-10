#!/usr/bin/env bash
# ============================================================
# scripts/lint_no_replica_identity_full.sh
# ============================================================
# No migration may set REPLICA IDENTITY FULL on anything.
#
# WHY THIS IS ITS OWN LINT rather than only a database assertion. Realtime DELETE
# events are NOT RLS-filtered, and REPLICA IDENTITY FULL ships the ENTIRE OLD ROW
# in the delete payload. Migration 008 removes a quiet facility's rows from the
# public mirrors by DELETE, and that is safe ONLY because DEFAULT ships nothing
# but the primary key. FULL silently converts that deletion into a broadcast of
# the quiet facility's last known bed counts to every subscriber.
#
# tests/db/config_drift.test.ts asserts the live catalogue. This lint catches the
# statement in review, before it is ever applied -- and it catches it in a down
# migration or a comment-free one-liner that the catalogue check would only see
# after the fact.
#
# Usage: bash scripts/lint_no_replica_identity_full.sh [ROOT]
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
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" | sort)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no migrations found in $MIG_DIR" >&2; exit 2; }

VIOLATIONS=0
for f in "${FILES[@]}"; do
    # Strip string literals and comments first, so the prohibition can be
    # DESCRIBED in a banner or a COMMENT ON without tripping the lint that
    # enforces it. Line numbers survive because nothing is deleted, only blanked.
    # `|| true` collapsed grep's exit 2 (could not run) into its 1 (no match),
    # so a file this could not read reported clean. pipefail makes $st the first
    # failure in the pipeline; only 0 and 1 are verdicts.
    st=0
    out=$(sed -e "s/'[^']*'//g" -e 's/--.*//' "$f" \
          | grep -nEi 'REPLICA[[:space:]]+IDENTITY[[:space:]]+FULL') || st=$?
    case "$st" in
        0|1) ;;
        *) echo "ERROR: the REPLICA IDENTITY scan exited $st on $f -- it did not run" >&2; exit 2 ;;
    esac
    [ -n "$out" ] && { echo "FAIL: $(basename "$f"): $out"; VIOLATIONS=$((VIOLATIONS+1)); }
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_no_replica_identity_full.sh: FAILED ($VIOLATIONS)"; exit 1; }
echo "lint_no_replica_identity_full.sh: PASS (${#FILES[@]} migrations)"
