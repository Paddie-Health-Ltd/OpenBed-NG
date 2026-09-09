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
# Usage:
#   export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   bash scripts/run_migrations.sh
#
# Exit 0 on success; non-zero on any failure (ON_ERROR_STOP=1 -- a migration that
# raises stops the run and is NOT ledgered).
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

# Bootstrap: 001 creates the `app` schema, the revoke wall and the ledger itself,
# so it cannot be recorded by a ledger that does not exist yet. Apply it by hand
# on a virgin database, then record it.
tbl="$("${PSQL[@]}" -tAc "SELECT to_regclass('app.schema_migrations')" 2>/dev/null | tr -d '[:space:]' || true)"
if [[ -z "$tbl" ]]; then
    echo "Bootstrapping app.schema_migrations..."
    "${PSQL[@]}" < "$MIG_DIR/$BOOTSTRAP"
    "${PSQL[@]}" -c "INSERT INTO app.schema_migrations (filename) VALUES ('$BOOTSTRAP') ON CONFLICT DO NOTHING;"
fi

# The forward runner MUST exclude *.down.sql. A lexical sort places
# 007_x.down.sql BEFORE 007_x.sql, which would apply a rollback as a forward
# migration and corrupt the ledger. `find -not -name` rather than `grep -v`
# because grep exits non-zero on an empty match, tripping the pipeline under
# `set -o pipefail`. (Retained verbatim from the source script -- the reasoning
# is the reason the line looks the way it does.)
applied=0
for f in $(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" -not -name "*.down.sql" 2>/dev/null | sort); do
    base="$(basename "$f")"
    n="$("${PSQL[@]}" -tAc "SELECT COUNT(*) FROM app.schema_migrations WHERE filename = '$base'" | tr -d '[:space:]')"
    if [[ "${n:-0}" != "0" ]]; then
        echo "Skipping (already applied): $base"
        continue
    fi
    echo "Applying $base..."
    "${PSQL[@]}" < "$f"
    "${PSQL[@]}" -c "INSERT INTO app.schema_migrations (filename) VALUES ('$base') ON CONFLICT (filename) DO NOTHING;"
    applied=$((applied + 1))
done

echo "Migrations complete ($applied applied this run)."
