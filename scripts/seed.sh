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
# THE HATCH NAMES ITS WHOLE SHAPE, NOT A LIST OF BAD WORDS (R-2026-09-29-171, EU-1).
# Its one stated reason (scripts/run_migrations.sh's comment, and tests/setup/db.ts's
# psqlCommand) is a machine with Docker and no local psql, reaching the local stack's
# database container. So the value must be exactly
#     docker exec -i supabase_db_<project> psql [-U <name>] [-d <name>]
# with -U and -d each at most once, in either order, and nothing else. ET-1 e refused
# `://`, `host=` and `hostaddr=`, and a deny-list is always one word short: `-h`,
# `--host`, `env PGHOST=...`, `docker exec -e`, `docker -H`, `-d service=...` all
# passed it, and were run. A rule that pins a shape pins the whole line.
#   - A value holding a newline is refused first: `read -r -a` reads only the first
#     line, so anything after it would never be checked, and never run either.
#   - The word count is read before any word, so an empty split cannot trip `set -u`
#     on bash 3.2 (macOS). A whitespace-only value splits into no words and is refused.
#   - The words are matched under LC_ALL=C with anchored `[[ =~ ]]`, never grep.
#     <container> is the local stack's naming, which tests/setup/db.ts searches for.
#   - The refusal is fixed text. It prints none of the value's own words.
#
# THE HATCH RUNS AS SEED'S OWN psql DOES: under `env -u` for PGHOST, PGHOSTADDR,
# PGSERVICE and PGSERVICEFILE, and with `-X` and ON_ERROR_STOP appended. docker exec
# forwards no host variable into the container without `-e`, which the shape refuses;
# the `env -u` makes that observable to a stub, rather than a property of docker.
#
# scripts/run_migrations.sh IS NOT TOUCHED. Its hatch reaches hosted by design: see the
# asymmetry above (lines 28-34). Copying this check there would break the hosted apply.
#
# A BEHAVIOUR CHANGE: any other OPENBED_PSQL value now stops this script, including an
# absolute path to a local psql. That developer unsets OPENBED_PSQL; the branch below
# already runs psql from PATH, against the URL the check read.
#
# NOT ASSERTED HERE, deliberately:
#   - Which Docker daemon the docker CLI reaches. DOCKER_HOST, DOCKER_CONTEXT and the
#     current context in the docker config choose it, and refusing the `-H` and
#     `--context` words does not cover them. DOCKER_HOST is left alone because rootless
#     setups need it. Recorded, not a register row.
#   - The environment inside the container. The hatch reaches whatever database a
#     container named supabase_db_* on that daemon points psql at. Hosted OpenBed is
#     managed Supabase and never a container, so it is not reached directly; a container
#     deliberately configured to point elsewhere is.
#
# SEED'S OWN psql SEES ONLY THE URL THE CHECK READ (ET-1 c and d). libpq takes
# PGHOST, PGHOSTADDR and a service named by PGSERVICE from the environment where
# the connection string leaves them unset, and PGHOSTADDR beside a local URL
# redirects the connection. They are REMOVED, not refused, so a developer who
# exports them is not stopped. `-X` keeps ~/.psqlrc, $PSQLRC and the system psqlrc
# from running a \connect after the check. `env -u` is in macOS's and GNU's env.
CONTAINER_RE='^supabase_db_[A-Za-z0-9][A-Za-z0-9_.-]*$'
NAME_RE='^[A-Za-z_][A-Za-z0-9_]*$'

# 0 when "$@" is exactly the hatch's shape, 1 otherwise.
hatch_shape_ok() {
    local LC_ALL=C
    local n=$#
    [ "$n" -ge 5 ] || return 1
    local w=("$@")
    [[ ${w[0]} == docker && ${w[1]} == exec && ${w[2]} == -i && ${w[4]} == psql ]] || return 1
    [[ ${w[3]} =~ $CONTAINER_RE ]] || return 1
    local i=5 seen_u=0 seen_d=0
    while [ "$i" -lt "$n" ]; do
        case "${w[$i]}" in
            -U) [ "$seen_u" -eq 0 ] || return 1; seen_u=1 ;;
            -d) [ "$seen_d" -eq 0 ] || return 1; seen_d=1 ;;
            *) return 1 ;;
        esac
        [ $((i + 1)) -lt "$n" ] || return 1
        [[ ${w[$((i + 1))]} =~ $NAME_RE ]] || return 1
        i=$((i + 2))
    done
    return 0
}

if [[ -n "${OPENBED_PSQL:-}" ]]; then
    shape=1
    case "$OPENBED_PSQL" in
        *$'\n'*) shape=0 ;;
    esac
    W=()
    if [ "$shape" -eq 1 ]; then
        read -r -a W <<< "$OPENBED_PSQL"
        if [ "${#W[@]}" -eq 0 ] || ! hatch_shape_ok "${W[@]}"; then
            shape=0
        fi
    fi
    if [ "$shape" -ne 1 ]; then
        echo "REFUSING: OPENBED_PSQL must be exactly: docker exec -i supabase_db_<project> psql [-U <name>] [-d <name>] -- the hatch reaches a local container only, and the host check never read it." >&2
        exit 2
    fi
    PSQL=(env -u PGHOST -u PGHOSTADDR -u PGSERVICE -u PGSERVICEFILE "${W[@]}" -X -v ON_ERROR_STOP=1)
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
