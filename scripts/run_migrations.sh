#!/usr/bin/env bash
# ============================================================
# scripts/run_migrations.sh
# ============================================================
# Apply database/migrations/*.sql in lexical order, skipping files already
# recorded in app.schema_migrations.
#
# Ported from PH-Doc-Assistant-v1 scripts/run_migrations.sh with one substantive
# change: THE LEDGER LIVES IN `app`, NOT `public`.
#
#   Rationale. That project has no PostgREST, so a `public.schema_migrations`
#   table was unreachable by any anonymous caller. This project publishes an
#   `anon` credential in the browser bundle, and `public` is the schema PostgREST
#   exposes. A ledger in `public` would let an anonymous client enumerate every
#   migration filename -- which is a map of the schema, in a repository that also
#   explains what each migration does. Moving it into `app` keeps it physically
#   unreachable, consistent with the two-schema boundary.
#
# ============================================================
# ATOMICITY -- READ THIS BEFORE CHANGING EITHER psql FLAG.
# ============================================================
# Each migration file is applied with BOTH `--single-transaction` AND
# `-v ON_ERROR_STOP=1`. THE TWO ARE ONLY SAFE TOGETHER, and removing either
# silently reopens a hole:
#
#   * Without --single-transaction, psql autocommits statement by statement. A
#     migration failing at statement 7 of 12 leaves 1-6 COMMITTED and the file
#     unledgered -- a half-applied schema.
#
#   * Without ON_ERROR_STOP, an error inside a --single-transaction run aborts
#     the transaction, every later statement fails, the closing COMMIT becomes a
#     ROLLBACK -- AND PSQL STILL EXITS 0. This script would report the migration
#     applied while the database received nothing. That is the worst shape of
#     failure: silent success.
#
# With both, a migration file is ATOMIC. And because every migration ends by
# inserting its own filename into app.schema_migrations, the DDL and its ledger
# row commit together: the schema and the ledger cannot disagree about that file.
#
# Verified safe for this corpus: the only CONCURRENTLY and ALTER TYPE ... ADD
# VALUE occurrences in database/migrations/ are inside comments, so every
# executable statement here is transactional in PG17. If a future migration needs
# non-transactional DDL, it needs its own runner path and a note saying why.
#
# RESIDUAL WINDOW, stated rather than left to be discovered: the belt-and-braces
# `INSERT ... ON CONFLICT DO NOTHING` this script runs AFTER the file is a second,
# separate statement. If the connection drops between the file committing and
# that insert, the file is applied and already self-ledgered, so the insert was
# redundant anyway. Recovery in every case is: run it again.
#
# NO HOST CHECK, DELIBERATELY -- and see scripts/seed.sh for the other half.
# This script applies DDL to whatever DATABASE_URL names, INCLUDING THE HOSTED
# PROJECT: that is how migrations 001-013 reach production, so a local-only guard
# here would break the one workflow it exists to serve. seed.sh takes the same
# variable and refuses any non-local host, because what IT writes is synthetic
# facilities. The difference is about WHAT IS BEING WRITTEN, not about how much
# the two scripts are trusted, and a reader who reverses it will either break the
# hosted apply or seed invented hospitals into a real database.
#
# Usage:
#   bash scripts/run_migrations.sh [--dry-run] [ROOT]
#
#   --dry-run   List the migrations that WOULD apply, then stop. Run this first
#               against any database you cannot reset.
#   ROOT        Repository root to read migrations from. Defaults to this
#               script's parent. The argument exists so tests can point the
#               runner at a scratch tree holding a planted migration -- the same
#               seam every lint in scripts/ carries. Do not remove it because it
#               looks unused: tests/db/migration_runner_atomicity.test.ts is what
#               proves the rollback above actually happens.
#
# Exit 0 on success; non-zero on any failure.
# ============================================================

set -euo pipefail

DRY_RUN=0
ROOT_ARG=""
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) sed -n '1,60p' "$0"; exit 0 ;;
        -*)        echo "ERROR: unknown option $1" >&2; exit 2 ;;
        *)         ROOT_ARG="$1"; shift ;;
    esac
done

ROOT="${ROOT_ARG:-$(cd "$(dirname "$0")/.." && pwd)}"
MIG_DIR="$ROOT/database/migrations"
BOOTSTRAP="001_app_schema_and_migration_ledger.sql"

if [ ! -d "$MIG_DIR" ]; then
    echo "ERROR: migration directory not found at $MIG_DIR" >&2
    exit 2
fi

# How psql is invoked. Three ways, in precedence order.
#
#   1. OPENBED_PSQL -- an explicit invocation, word-split. This exists because a
#      developer machine may have Docker and no local psql; the Supabase database
#      container carries one. Example:
#        export OPENBED_PSQL="docker exec -i supabase_db_OpenBed-NG psql -U postgres -d postgres"
#      Every SQL file is fed on STDIN rather than via -f precisely so this form
#      works: the container cannot see a path on the host filesystem.
#   2. DATABASE_URL.
#   3. PG* environment variables.
if [[ -n "${OPENBED_PSQL:-}" ]]; then
    read -r -a PSQL <<< "$OPENBED_PSQL"
    PSQL+=(-v ON_ERROR_STOP=1)
elif [[ -n "${DATABASE_URL:-}" ]]; then
    command -v psql >/dev/null 2>&1 || { echo "ERROR: psql not on PATH. Install postgresql-client, or set OPENBED_PSQL." >&2; exit 2; }
    PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
else
    command -v psql >/dev/null 2>&1 || { echo "ERROR: psql not on PATH. Install postgresql-client, or set OPENBED_PSQL." >&2; exit 2; }
    : "${PGHOST:=127.0.0.1}"
    : "${PGPORT:=54322}"
    : "${PGUSER:=postgres}"
    : "${PGDATABASE:=postgres}"
    export PGPASSWORD="${PGPASSWORD:?set PGPASSWORD or DATABASE_URL}"
    PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1)
fi

# File application only. Single statements (-c, -tAc) need no wrapper.
PSQL_TX=("${PSQL[@]}" --single-transaction)

# The forward runner MUST exclude *.down.sql. A lexical sort places
# 007_x.down.sql BEFORE 007_x.sql, which would apply a rollback as a forward
# migration and corrupt the ledger. `find -not -name` rather than `grep -v`
# because grep exits non-zero on an empty match, tripping the pipeline under
# `set -o pipefail`. (Retained verbatim from the source script -- the reasoning
# is the reason the line looks the way it does.)
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" -not -name "*.down.sql" 2>/dev/null | sort)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no forward migrations found in $MIG_DIR" >&2; exit 2; }

ledger_exists() {
    "${PSQL[@]}" -tAc "SELECT to_regclass('app.schema_migrations')" 2>/dev/null | tr -d '[:space:]'
}

is_applied() {
    local base="$1"
    [ -z "$(ledger_exists)" ] && { echo 0; return; }
    "${PSQL[@]}" -tAc "SELECT COUNT(*) FROM app.schema_migrations WHERE filename = '$base'" | tr -d '[:space:]'
}

# ---------------- dry run ----------------
if [ "$DRY_RUN" -eq 1 ]; then
    pending=0
    echo "DRY RUN -- nothing will be applied."
    for f in "${FILES[@]}"; do
        base="$(basename "$f")"
        if [ "$(is_applied "$base")" != "0" ]; then
            echo "  already applied : $base"
        else
            echo "  WOULD APPLY     : $base"
            pending=$((pending + 1))
        fi
    done
    echo "$pending migration(s) pending."
    exit 0
fi

# ---------------- bootstrap ----------------
# 001 creates the `app` schema, the revoke wall and the ledger itself, so it
# cannot be recorded by a ledger that does not exist yet. Apply it by hand on a
# virgin database, then record it.
if [ -z "$(ledger_exists)" ]; then
    echo "Bootstrapping app.schema_migrations..."
    "${PSQL_TX[@]}" < "$MIG_DIR/$BOOTSTRAP"
    "${PSQL[@]}" -c "INSERT INTO app.schema_migrations (filename) VALUES ('$BOOTSTRAP') ON CONFLICT DO NOTHING;"
fi

# ---------------- apply ----------------
applied=0
for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    if [ "$(is_applied "$base")" != "0" ]; then
        echo "Skipping (already applied): $base"
        continue
    fi
    echo "Applying $base..."
    "${PSQL_TX[@]}" < "$f"
    "${PSQL[@]}" -c "INSERT INTO app.schema_migrations (filename) VALUES ('$base') ON CONFLICT (filename) DO NOTHING;"
    applied=$((applied + 1))
done

echo "Migrations complete ($applied applied this run)."
