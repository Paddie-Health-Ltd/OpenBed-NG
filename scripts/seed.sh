#!/usr/bin/env bash
# ============================================================
# scripts/seed.sh
# ============================================================
# Load database/seed/*.sql -- SYNTHETIC DATA ONLY.
#
# Seeds are NOT migrations and are NOT ledgered, deliberately. The sibling
# project's history is the argument: a synthetic-data constraint went in as
# migration 006 and had to be removed again by migration 013, because seed data
# that rides the migration ledger reaches every environment the ledger reaches.
# Keeping the two runners separate means production can never load a fixture.
#
# Refuses to run against anything that is not obviously a local database, because
# the seed inserts facilities and ward rows that would be indistinguishable from
# real ones in a hosted project.
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED_DIR="$ROOT/database/seed"

URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# Guard: local only. `--i-know-what-i-am-doing` is deliberately absent; there is
# no legitimate reason to seed synthetic facilities into a remote database.
#
# THE ASYMMETRY WITH run_migrations.sh IS DELIBERATE, AND EASY TO GET BACKWARDS.
# That script takes the SAME DATABASE_URL, writes DDL rather than rows, and has
# NO host check -- correctly, because applying migrations to the hosted project
# is exactly what it is for. This one refuses anything but a local host, because
# what it writes is INVENTED HOSPITALS. Copying the check into the migration
# runner breaks the hosted apply; removing it from here puts synthetic facilities
# in a real database. Neither is a tidy-up.
# ANCHORED ON THE HOST, NOT ON A SUBSTRING OF THE WHOLE URL.
#
# This was `*127.0.0.1*|*localhost*|*@db:*`, matched against the entire URL, so
# a URL with credentials whose host is `localhost.attacker.example.com` READ AS
# LOCAL -- the substring is there, in a domain that is not. Same for a host such as
# `my127.0.0.1.example.net`, or either string appearing in the password or the
# database name. The host is extracted first and matched whole.
# SCHEME FIRST, THEN CREDENTIALS. Order matters and the other way round is a
# bug I shipped and caught one turn later: `${URL#*@}` on a URL with NO
# credentials leaves the string untouched, so `postgresql://localhost:5432/db`
# -- an entirely ordinary form -- parsed its host as `postgresql` and was
# REFUSED. It failed closed, so nothing unsafe passed, but a legitimate local
# URL stopped working.
#
# NO REFUSAL PRINTS THE URL (R-2026-09-29-170, ET-1 f). The refusal used to print
# the URL up to its query, credentials included. Nor does any print the host it
# read: credentials are stripped at the FIRST `@`, so a password holding a raw `@`
# leaves a fragment of itself in what this parse calls the host.
#
# A URL, AND NOTHING ELSE (ET-1 b). A bare `localhost`, `db` or `127.0.0.1` passed
# the host check, and psql then read it as a DATABASE NAME and took the host from
# PGHOST. scripts/provision_target.mjs refuses any other scheme the same way.
case "$URL" in
    postgresql://*|postgres://*) ;;
    *)
        echo "REFUSING: DATABASE_URL must begin with postgresql:// or postgres:// -- anything else psql reads as a database name, and takes the host from its environment." >&2
        exit 2
        ;;
esac
# NO QUERY AT ALL (ET-1 a). A host or hostaddr parameter overrides the authority
# this check reads, and the check used to strip the query before reading the host,
# so a local authority carrying one reached psql whole. Refused before any host is
# read, as the secret scan refuses any `?` on a URL it would call local.
case "$URL" in
    *\?*)
        echo "REFUSING: DATABASE_URL carries a query string -- a host or hostaddr parameter there overrides the host this check reads, so no query is accepted." >&2
        exit 2
        ;;
esac
REST="${URL#*://}"            # strip scheme
REST="${REST#*@}"             # strip credentials IF PRESENT (no-op without an @)
AUTH="${REST%%/*}"            # strip path
# A HOST LIST IS NEVER LOCAL (R-2026-09-29-169, ES-2). libpq tries each host of a
# comma list in turn, with the same password, so the port strip below read only
# the FIRST: a local first host with a port, then a remote one, passed this check.
# Refused here, before any host is read.
case "$AUTH" in
    *,*)
        echo "REFUSING: DATABASE_URL names more than one host -- libpq falls through to the next host with the same password, so a local first host proves nothing." >&2
        exit 2
        ;;
esac
HOST="${AUTH%%:*}"            # strip port
case "$HOST" in
    127.0.0.1|localhost|db|0.0.0.0|'[::1]'|::1) ;;
    *)
        echo "REFUSING: seed data is synthetic and must never reach a non-local database." >&2
        exit 2
        ;;
esac

if [ ! -d "$SEED_DIR" ]; then
    echo "ERROR: seed directory not found at $SEED_DIR" >&2
    exit 2
fi

shopt -s nullglob
files=("$SEED_DIR"/*.sql)
if [ ${#files[@]} -eq 0 ]; then
    echo "ERROR: no seed files found in $SEED_DIR" >&2
    exit 2
fi

# Same OPENBED_PSQL escape hatch as scripts/run_migrations.sh; see the comment
# there. Files go on STDIN so a containerised psql can read them.
#
# THE HATCH STAYS, BUT IT NAMES NO HOST (ET-1 e). It exists to reach a local
# container, as run_migrations.sh's `docker exec -i ... psql -U postgres` example
# does, so a value carrying a URL or a host keyword is refused: the check above
# never read it.
#
# SEED'S OWN psql SEES ONLY THE URL THE CHECK READ (ET-1 c and d). libpq takes
# PGHOST, PGHOSTADDR and a service named by PGSERVICE from the environment where
# the connection string leaves them unset, and PGHOSTADDR beside a local URL
# redirects the connection. They are REMOVED, not refused, so a developer who
# exports them is not stopped. `-X` keeps ~/.psqlrc, $PSQLRC and the system psqlrc
# from running a \connect after the check. `env -u` is in macOS's and GNU's env.
if [[ -n "${OPENBED_PSQL:-}" ]]; then
    case "$OPENBED_PSQL" in
        *://*|*host=*|*hostaddr=*)
            echo "REFUSING: OPENBED_PSQL names a URL or a host -- the hatch exists to reach a local container, and the host check never read it." >&2
            exit 2
            ;;
    esac
    read -r -a PSQL <<< "$OPENBED_PSQL"
    PSQL+=(-v ON_ERROR_STOP=1)
else
    command -v psql >/dev/null 2>&1 || { echo "ERROR: psql not on PATH. Install postgresql-client, or set OPENBED_PSQL." >&2; exit 2; }
    PSQL=(env -u PGHOST -u PGHOSTADDR -u PGSERVICE -u PGSERVICEFILE psql -X "$URL" -v ON_ERROR_STOP=1)
fi

# PAUSE 017's pg_cron JOBS BEFORE ANY SEED FILE (R-2026-09-16-11). Here, after the
# host check above, because this script is the one that cannot reach hosted, and
# it runs straight after the migrations on every local and CI database. The
# seed's own app.refresh_lga_rollup() call would otherwise race the live rollup
# job. The file's header carries the reasons and the observations.
echo "Pausing the 017 pg_cron jobs (local only)..."
"${PSQL[@]}" < "$ROOT/database/local/pause_scheduled_jobs.sql"

for f in $(printf '%s\n' "${files[@]}" | sort); do
    echo "Seeding $(basename "$f")..."
    "${PSQL[@]}" < "$f"
done

echo "Seed complete (${#files[@]} file(s))."
