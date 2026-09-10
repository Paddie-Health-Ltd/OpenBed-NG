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
# ANCHORED ON THE HOST, NOT ON A SUBSTRING OF THE WHOLE URL.
#
# This was `*127.0.0.1*|*localhost*|*@db:*`, matched against the entire URL, so
# `postgresql://u:p@localhost.attacker.example.com/app` READ AS LOCAL -- the
# substring is there, in a domain that is not. Same for a host such as
# `my127.0.0.1.example.net`, or either string appearing in the password or the
# database name. The host is extracted first and matched whole.
HOSTPORT="${URL#*@}"          # strip scheme and credentials
HOST="${HOSTPORT%%/*}"        # strip path
HOST="${HOST%%\?*}"           # strip query
HOST="${HOST%%:*}"            # strip port
case "$HOST" in
    127.0.0.1|localhost|db|0.0.0.0|'[::1]'|::1) ;;
    *)
        echo "REFUSING: seed data is synthetic and must never reach a non-local database." >&2
        echo "  DATABASE_URL points at: ${URL%%\?*}" >&2
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
if [[ -n "${OPENBED_PSQL:-}" ]]; then
    read -r -a PSQL <<< "$OPENBED_PSQL"
    PSQL+=(-v ON_ERROR_STOP=1)
else
    command -v psql >/dev/null 2>&1 || { echo "ERROR: psql not on PATH. Install postgresql-client, or set OPENBED_PSQL." >&2; exit 2; }
    PSQL=(psql "$URL" -v ON_ERROR_STOP=1)
fi

for f in $(printf '%s\n' "${files[@]}" | sort); do
    echo "Seeding $(basename "$f")..."
    "${PSQL[@]}" < "$f"
done

echo "Seed complete (${#files[@]} file(s))."
