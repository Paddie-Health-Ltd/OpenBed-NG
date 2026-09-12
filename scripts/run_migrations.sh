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
# Exit codes -- and 3 is distinct from 2 on purpose:
#   0  success
#   2  bad usage, or the repository/migrations could not be read
#   3  THE DATABASE COULD NOT BE QUERIED. Nothing was applied and no migration
#      count is reported. "you typed the wrong flag" must not share a code with
#      "the database is unreachable", because only one of those may ever be
#      retried by pressing on.
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

# ============================================================
# THREE STATES, AND ONLY ONE OF THEM MAY BE EMPTY.
# ============================================================
# On 2026-09-12 this script printed `13 migration(s) pending.` and exited 0
# against a host that does not resolve. That string is the DOCUMENTED STOP
# CONDITION for the hosted apply, so a total connection failure produced the
# exact signal that says "go ahead". Two sites did it, and they failed in
# OPPOSITE directions:
#
#   ledger_exists()   2>/dev/null discarded psql's error, empty stdout read as
#                     "the ledger does not exist yet"          -> 13 pending
#   is_applied()      empty stdout, and `[ "" != "0" ]` is TRUE, so every file
#                     read as "already applied"                ->  0 pending
#
# The second was never hit and is the worse of the two: it says the apply is
# already done. Both were command substitutions whose value was consumed by a
# `[ ... ]` test, which throws the exit status away -- so `set -e` never saw
# either one.
#
# The states are now separated by hand:
#
#   connected, value present -> DB_SCALAR holds it
#   connected, value absent  -> DB_SCALAR is empty. THE ONLY LEGITIMATE EMPTY.
#   could not run            -> ERROR, exit 3, no count reported at all
#
DB_SCALAR=""

psql_scalar() {
    local sql="$1" st=0 out

    # `local out` IS DECLARED SEPARATELY FROM THE ASSIGNMENT, deliberately.
    # `local out=$(cmd)` makes the exit status that of `local`, which always
    # succeeds -- the status of the command inside is lost, which is a smaller
    # version of the very defect this function exists to close.
    #
    # AND THERE IS NO 2>/dev/null. psql's own error is the single most useful
    # thing on the screen when the connection is the problem, and discarding it
    # is what turned a DNS failure into a migration count. It was never needed
    # on the normal path either: on a virgin database `to_regclass` returns NULL
    # and writes nothing to stderr.
    out=$("${PSQL[@]}" -tAc "$sql") || st=$?

    if [ "$st" -ne 0 ]; then
        echo "ERROR: psql exited $st -- the database was not queried." >&2
        echo "  psql's own error, if it printed one, is immediately above this message." >&2
        echo "  query: $sql" >&2
        echo "" >&2
        echo "  NO MIGRATION COUNT IS REPORTED, and nothing was applied. A count taken" >&2
        echo "  over a failed connection is indistinguishable from one taken against a" >&2
        echo "  virgin database, and that count is the stop condition for the hosted" >&2
        echo "  apply. Fix the connection and run this again." >&2
        # THIS MESSAGE DELIBERATELY DOES NOT QUOTE THE PENDING LINE VERBATIM.
        # The first draft explained itself by writing out the exact string the
        # dry run prints when the apply may proceed -- so a failure report
        # contained, in full, the sentence that means "go". An operator scanning
        # the log, or grepping it, would have found it there. An error message
        # must not be mistakable for the signal it is reporting the absence of.
        exit 3
    fi

    DB_SCALAR="$(printf '%s' "$out" | tr -d '[:space:]')"
}

# WHY THE RESULT COMES BACK IN A GLOBAL AND NOT THROUGH $( ).
#
# `exit` inside a command substitution terminates the SUBSHELL, not the script.
# Had psql_scalar been called as `x=$(psql_scalar ...)`, its exit 3 would have
# killed the subshell and the caller would have carried on with whatever was on
# stdout -- rebuilding the exact defect inside its own repair. A global has no
# status for a call site to forget to check, because there is no call site
# status at all.

assert_connected() {
    # PROVE THE CHANNEL BEFORE TRUSTING AN EMPTY ANSWER.
    #
    # psql_scalar distinguishes "could not run" from "ran and returned nothing"
    # by EXIT STATUS -- which is right for a connection that fails, because psql
    # exits non-zero. It is not enough on its own: anything that exits 0 and
    # prints nothing looks exactly like a successful query against a virgin
    # database. `OPENBED_PSQL` is a documented escape hatch a developer sets by
    # hand, and set to a command that ignores its arguments it would produce a
    # full pending count from a database that was never contacted -- the same
    # defect one level down from the one being fixed.
    #
    # SELECT 1 has exactly one correct answer and no legitimate empty result, so
    # an empty answer to it means the other end is not a database. After this
    # passes, an empty `to_regclass` can be believed.
    psql_scalar "SELECT 1"
    if [ "$DB_SCALAR" != "1" ]; then
        echo "ERROR: the configured psql exited 0 but did not answer SELECT 1." >&2
        echo "  It returned: '$DB_SCALAR'" >&2
        echo "  Whatever is on the other end is not a working database connection, so an" >&2
        echo "  empty ledger lookup cannot be read as a database with no ledger. Check" >&2
        echo "  OPENBED_PSQL / DATABASE_URL. Nothing was applied." >&2
        exit 3
    fi
}

ledger_present() {
    psql_scalar "SELECT to_regclass('app.schema_migrations')"
    # to_regclass returns NULL for a relation that does not exist and psql -tA
    # prints NULL as nothing at all. That is the one meaning empty may carry
    # here; every other route to it -- DNS, auth, a dropped socket, a killed
    # container -- exited above.
    [ -n "$DB_SCALAR" ]
}

applied_count() {
    psql_scalar "SELECT COUNT(*) FROM app.schema_migrations WHERE filename = '$1'"
    # COUNT(*) ALWAYS returns exactly one row. Empty cannot mean "no rows"; it
    # means the query did not really run. The old code read that as "already
    # applied" and would have reported 0 pending over a database it never
    # reached.
    if [ -z "$DB_SCALAR" ]; then
        echo "ERROR: COUNT(*) returned no value for $1 -- the ledger query did not run." >&2
        echo "  A count query that returns nothing has not counted anything. No migration" >&2
        echo "  state is reported." >&2
        exit 3
    fi
}

# Before either path reads anything from the database, establish that there IS a
# database. One round trip, and it is what makes every empty answer below mean
# what it says.
assert_connected

# ---------------- dry run ----------------
if [ "$DRY_RUN" -eq 1 ]; then
    pending=0
    echo "DRY RUN -- nothing will be applied."

    # HOISTED OUT OF THE LOOP. This was one round trip per migration file --
    # thirteen queries where one answers the question, and thirteen separate
    # windows in which a connection could drop and be misread.
    if ledger_present; then HAVE_LEDGER=1; else HAVE_LEDGER=0; fi

    for f in "${FILES[@]}"; do
        base="$(basename "$f")"
        if [ "$HAVE_LEDGER" -eq 1 ]; then
            applied_count "$base"
        else
            # No ledger means nothing can have been applied. This is the only
            # place a count is assumed rather than read, and it is sound because
            # ledger_present has already proved the database ANSWERED.
            DB_SCALAR=0
        fi

        if [ "$DB_SCALAR" != "0" ]; then
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
if ! ledger_present; then
    echo "Bootstrapping app.schema_migrations..."
    "${PSQL_TX[@]}" < "$MIG_DIR/$BOOTSTRAP"
    "${PSQL[@]}" -c "INSERT INTO app.schema_migrations (filename) VALUES ('$BOOTSTRAP') ON CONFLICT DO NOTHING;"
fi

# ---------------- apply ----------------
applied=0
for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    # The ledger is guaranteed to exist by here: either it already did, or the
    # bootstrap above created it under `set -e`.
    applied_count "$base"
    if [ "$DB_SCALAR" != "0" ]; then
        echo "Skipping (already applied): $base"
        continue
    fi
    echo "Applying $base..."
    "${PSQL_TX[@]}" < "$f"
    "${PSQL[@]}" -c "INSERT INTO app.schema_migrations (filename) VALUES ('$base') ON CONFLICT (filename) DO NOTHING;"
    applied=$((applied + 1))
done

echo "Migrations complete ($applied applied this run)."
