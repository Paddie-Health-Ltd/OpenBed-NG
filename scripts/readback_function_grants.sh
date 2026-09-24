#!/usr/bin/env bash
# ============================================================
# scripts/readback_function_grants.sh
# ============================================================
# WHO CAN EXECUTE WHAT, READ ON THE DATABASE IT IS POINTED AT, AND HELD TO THE ONE
# SOURCE (R-2026-09-24-74 BB-2). First run as fence 6 of 020's apply in
# docs/runbook-supabase-project-creation.md.
#
# WHY IT EXISTS. Supabase's default privileges grant EXECUTE on a new function to
# anon, authenticated and service_role. 020 is correct only if its REVOKEs removed
# those grants on hosted, and that is a claim about a running system that no local
# test can reach. So this reads, for every function in the schemas the fixture
# names, which of the three roles can execute it (has_function_privilege, which
# counts PUBLIC and role membership), and compares with
# packages/fixtures/function-grants.json. The D3 closed-list test derives its list
# from the same file, so there is no second copy to drift.
#
# THE COMPARISON IS EXACT, in both directions:
#   - a role with EXECUTE that the fixture does not give it is WRONG;
#   - a role the fixture gives EXECUTE that does not have it is WRONG;
#   - a function the database has and the fixture lacks is WRONG, and so is a
#     function the fixture lists and the database lacks.
# The last two mean a function hosted has and local lacks (one Supabase added,
# say) reads STOP. That STOP is safe, since this only reads, but it needs a ruling.
#
# THE IDENTITY of a function is schema.name(argument types), printed with
# search_path set to pg_catalog, so the types are qualified the same way everywhere.
# The query is the Q_GRANTS literal below. tests/db/function_grants.test.ts runs that
# exact literal against a real schema, and plants grants into it.
#
# ZERO FUNCTIONS READ IS AN ERROR, never a PASS: a query that found nothing reads
# exactly like a surface with no grants.
#
# The contract every read-back keeps is in scripts/readback_common.sh. DATABASE_URL
# is read from the environment; the fence sets it with `read -rs` and unsets it.
#
# NOT ASSERTED HERE, deliberately: table and column grants. That is the widened
# grant sweep in runbook step 6.
#
# Usage: bash scripts/readback_function_grants.sh [ROOT]
#   ROOT is the checkout whose fixture is read; it defaults to this one. It is the
#   test seam.
# Exit: 0 PASS; 1 STOP; 2 nothing was read, or a reading could not run.
# ============================================================
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck source=readback_common.sh
source "$(dirname "$0")/readback_common.sh"

if [ -z "${DATABASE_URL:-}" ]; then
    echo "STOP: DATABASE_URL is not set, so nothing was read."
    echo "  Run this from the runbook fence that sets it with read -rs."
    exit 2
fi

FIXTURE="$ROOT/packages/fixtures/function-grants.json"

Q_GRANTS="select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')|' || concat_ws(',', case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon' end, case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated' end, case when has_function_privilege('service_role', p.oid, 'EXECUTE') then 'service_role' end) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app', 'graphql_public', 'public') order by 1"

echo "=== EXECUTE on every function in app, graphql_public and public, against $FIXTURE ==="
st=0
psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "set search_path to pg_catalog" -c "$Q_GRANTS" > "$RB_TMP/grants" || st=$?
if [ "$st" -ne 0 ]; then
    echo "ERROR: psql exited $st reading the function grants -- 127 means psql is not on PATH (step P). The reading did not run, so it has no verdict"
    exit 2
fi

# node pairs each function with the fixture: one "identity<TAB>observed<TAB>expected"
# line per function, "none" for no role, and a marker for a side that lacks it.
st=0
node -e '
const fs = require("fs");
let fx;
try { fx = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { process.exit(3); }
if (!fx || typeof fx.functions !== "object") process.exit(3);
const seen = new Map();
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
  if (line === "") continue;
  const m = /^([a-z_]+\.[a-z_0-9]+\([^|]*\))\|((?:anon|authenticated|service_role)(?:,(?:anon|authenticated|service_role))*)?$/.exec(line);
  if (!m) { process.stdout.write(line); process.exit(4); }
  seen.set(m[1], m[2] ? m[2] : "none");
}
if (seen.size === 0) process.exit(5);
const want = (id) => (fx.functions[id].execute.length ? fx.functions[id].execute.join(",") : "none");
const ids = [...new Set([...seen.keys(), ...Object.keys(fx.functions)])].sort();
for (const id of ids) {
  const observed = seen.has(id) ? seen.get(id) : "(no such function on this database)";
  const expected = id in fx.functions ? want(id) : "(not in the fixture)";
  process.stdout.write(id + "\t" + observed + "\t" + expected + "\n");
}
' "$RB_TMP/grants" "$FIXTURE" > "$RB_TMP/pairs" || st=$?
case "$st" in
    0) ;;
    3) echo "ERROR: could not read $FIXTURE -- the reading did not run, so it has no verdict"; exit 2 ;;
    4) echo "ERROR: psql answered a line that is not a function and its roles: '$(cat "$RB_TMP/pairs")' -- the reading did not run, so it has no verdict"; exit 2 ;;
    5) echo "ERROR: the query read no functions at all -- the reading did not run, so it has no verdict"; exit 2 ;;
    *) echo "ERROR: node exited $st comparing the function grants -- the reading did not run, so it has no verdict"; exit 2 ;;
esac

while IFS=$'\t' read -r id observed expected; do
    rb_expect "$id EXECUTE" "$observed" "$expected"
done < "$RB_TMP/pairs"

if [ "$RB_OK" != 1 ]; then
    echo
    echo "A function's EXECUTE grants are not what the fixture says. Run nothing further; paste this whole output back."
fi
rb_verdict "every function in app, graphql_public and public is executable by exactly the roles packages/fixtures/function-grants.json names."
