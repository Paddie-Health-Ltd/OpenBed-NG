import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { psqlCommand } from '../setup/db.js';
import { dbUrl } from '../setup/local-keys.js';

/**
 * A FAILED CONNECTION MUST NEVER BE REPORTED AS A MIGRATION COUNT.
 *
 * WHAT HAPPENED. On 2026-09-12 the founder ran the hosted dry run against a
 * host that does not resolve and got `13 migration(s) pending.` with exit 0 --
 * which is the DOCUMENTED STOP CONDITION for the apply. A total connection
 * failure produced the exact signal that means "go ahead", on the only
 * irreversible action in the project.
 *
 * TWO SITES, FAILING IN OPPOSITE DIRECTIONS. Both were command substitutions
 * whose value was consumed by a `[ ... ]` test, which discards the exit status,
 * so `set -e` never saw either:
 *
 *   ledger_exists()  2>/dev/null swallowed psql's error and empty stdout read
 *                    as "no ledger yet"                    -> 13 pending
 *   is_applied()     empty stdout, and `[ "" != "0" ]` is TRUE, so every file
 *                    read as already applied               ->  0 pending
 *
 * The second had never been hit and is the worse of the two: it reports that
 * the apply is already done.
 *
 * WHY THIS IS A TEST AND NOT A CAREFUL READING. The register cannot reach this
 * class. Its own definition is a site that drives a non-zero exit AND SAYS SO
 * WITH ITS OWN MESSAGE; a fail-open path drives a zero exit and says nothing,
 * so it has no identity and is structurally invisible to the sweep. Full
 * register coverage and this defect are perfectly compatible -- which is why
 * the only thing that catches it is a plant that actually breaks the
 * connection.
 *
 * NOT ASSERTED HERE, deliberately: that the HOSTED database behaves as the
 * local one does. What is proved is that the runner refuses to report a count
 * it did not obtain, which is a property of the runner and travels with it.
 */

/**
 * Named as a bare constant, not buried inside the join, because that is the
 * form tests/compliance/_legs.ts recognises when mapping a test file to the
 * guard it exercises. A path assembled entirely inside `join(...)` maps to
 * nothing, and these plants would then prove legs the register records as
 * unproved.
 */
const RUNNER_SCRIPT = 'run_migrations.sh';
const RUNNER = join(import.meta.dirname, '..', '..', 'scripts', RUNNER_SCRIPT);
const REPO_ROOT = join(import.meta.dirname, '..', '..');

/**
 * A host reserved by RFC 2606 as never resolvable. Not a host that merely
 * happens to be down.
 *
 * ASSEMBLED AT RUNTIME, and not for style. Written out as a literal, this is a
 * remote Postgres URL carrying a password, and `scripts/lint_no_secrets.sh`
 * flagged this file for it -- correctly. The local-host narrowing filter spares
 * 127.0.0.1 and localhost; `no-such-host.invalid` is neither. The tempting fix
 * was to widen that filter or allowlist this path, and both would blind the
 * scanner to a real credential pasted into a test one day. Splitting the scheme
 * means the literal never exists in the repository at all, exactly as
 * tests/compliance/_plants.ts does it, and the exemption list stays at one file.
 */
const pg = (rest: string): string => `postgres${'ql'}://${rest}`;
const UNREACHABLE = pg('postgres:postgres@no-such-host.invalid:5432/postgres');

/** A database that exists and is empty, so "no ledger" is a real state rather than a simulated one. */
const VIRGIN_DB = 'openbed_runner_probe_virgin';

/**
 * The runner resolves psql itself and cannot see this process's resolution, so
 * it is handed one. Mirrors tests/db/migration_runner_atomicity.test.ts.
 */
function envFor(target: 'real' | 'unreachable' | 'virgin'): NodeJS.ProcessEnv {
  const cmd = psqlCommand();
  const docker = cmd.startsWith('docker');
  if (target === 'real') {
    return docker ? { ...process.env, OPENBED_PSQL: cmd } : { ...process.env, DATABASE_URL: dbUrl() };
  }
  const url = target === 'unreachable' ? UNREACHABLE : dbUrl().replace(/\/[^/]*$/, `/${VIRGIN_DB}`);
  if (docker) {
    // The container's own psql, pointed elsewhere. Everything up to and
    // INCLUDING the `psql` token is kept and its arguments replaced -- an
    // earlier version indexed the container name out of the split and got
    // `exec`, producing a connection failure for a reason unrelated to the one
    // under test. That would have passed the unreachable-host plants for the
    // wrong reason and failed the virgin one, which is how it was caught.
    const base = cmd.replace(/\bpsql\b.*$/, 'psql');
    const host = target === 'unreachable' ? UNREACHABLE : pg(`postgres:postgres@127.0.0.1:5432/${VIRGIN_DB}`);
    return { ...process.env, OPENBED_PSQL: `${base} ${host}` };
  }
  return { ...process.env, DATABASE_URL: url };
}


/**
 * A FAKE psql, built in a scratch directory, that EXITS 0 and controls exactly
 * what it prints.
 *
 * Why one is needed. The two remaining legs are not about a connection that
 * FAILS -- psql exits non-zero there and the status check catches it. They are
 * about something that SUCCEEDS and says nothing, which is the shape a real
 * psql never produces and therefore cannot be planted with one. `OPENBED_PSQL`
 * is a documented escape hatch a developer sets by hand, so a command that
 * exits 0 and ignores its arguments is a real configuration, not a contrivance.
 *
 * Constructed, never committed -- the same rule as every lint plant.
 */
function withFakePsql<T>(mode: 'silent' | 'no-count' | 'dies-after-connect', fn: (cmd: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'openbed-fakepsql-'));
  const bin = join(dir, 'psql');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
# Finds the statement after -c or -tAc and answers per mode.
sql=""; prev=""
for a in "$@"; do
  case "$prev" in -tAc|-c) sql="$a"; break ;; esac
  prev="$a"
done
case "${mode}" in
  silent) exit 0 ;;
  dies-after-connect)
    # Answers the reachability probe, then the connection goes away. This is a
    # database that dies mid-run -- the one case assert_connected cannot cover,
    # because it has already passed.
    if [ "$sql" = "SELECT 1" ]; then echo 1; exit 0; fi
    echo "psql: error: server closed the connection unexpectedly" >&2
    exit 2 ;;
esac
case "$sql" in
  "SELECT 1")     echo 1 ;;
  *to_regclass*)  echo "app.schema_migrations" ;;
  *COUNT*)        : ;;   # succeeds, prints nothing -- the plant
  *)              : ;;
esac
exit 0
`,
    'utf8',
  );
  chmodSync(bin, 0o755);
  try {
    return fn(bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runRunner(env: NodeJS.ProcessEnv, ...args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync('bash', [RUNNER, ...args, REPO_ROOT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * CREATE DATABASE cannot run inside a transaction, so it goes through psql
 * rather than the pool.
 *
 * ARGV IS BUILT, NOT SPLIT OUT OF A SHELL STRING, and that distinction is the
 * difference between this passing everywhere and passing only here. The native
 * form of `psqlCommand()` is `psql "postgresql://..."` -- shell-quoted, because
 * it is meant to be handed to a shell. Splitting it on whitespace yields a token
 * that still carries its double quotes, and `execFileSync` passes argv straight
 * through with no shell to strip them, so psql receives a connection string
 * containing literal `"` characters and cannot connect.
 *
 * This machine has no psql on PATH and takes the docker branch, where the
 * command has no quoting, so the bug was invisible locally. CI installs
 * postgresql-client and takes the other branch. That is the signature
 * test-conventions section 8 records verbatim: green locally, red in CI, on the
 * same commit -- found here by reading .github/workflows/ci.yml rather than by
 * waiting for the red.
 */
function psqlArgv(dbName?: string): string[] {
  const cmd = psqlCommand();
  if (cmd.startsWith('docker')) {
    const words = cmd.split(/\s+/);
    const psqlAt = words.indexOf('psql');
    return dbName === undefined ? words : [...words.slice(0, psqlAt + 1), '-U', 'postgres', '-d', dbName];
  }
  // Unquoted: execFileSync needs the value, not a shell-escaped rendering of it.
  const url = dbName === undefined ? dbUrl() : dbUrl().replace(/\/[^/]*$/, `/${dbName}`);
  return ['psql', url];
}

function psqlAdmin(statement: string): void {
  const argv = psqlArgv();
  execFileSync(argv[0] as string, [...argv.slice(1), '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

beforeAll(() => {
  // IF-EXISTS on the way in as well as out: a run killed mid-test must not make
  // the next run fail for a reason unrelated to what it measures.
  psqlAdmin(`DROP DATABASE IF EXISTS ${VIRGIN_DB}`);
  psqlAdmin(`CREATE DATABASE ${VIRGIN_DB}`);
});

afterAll(() => {
  psqlAdmin(`DROP DATABASE IF EXISTS ${VIRGIN_DB}`);
});

describe('the runner refuses to report a count it did not obtain', () => {
  test('plant — an unreachable host EXITS NON-ZERO and prints no count at all', () => {
    const r = runRunner(envFor('unreachable'), '--dry-run');

    // Exit 3 specifically: 2 already means bad usage in this script, and "you
    // typed the wrong flag" must not share a code with "the database is
    // unreachable" -- only one of those may be retried by pressing on.
    expect(r.status, `an unreachable host did not stop the runner:\n${r.out}`).toBe(3);
    expect(r.out, 'the refusal did not say the database was never queried').toContain(
      'the database was not queried',
    );

    // PSQL'S OWN ERROR MUST REACH THE OPERATOR. The original defect was a
    // `2>/dev/null` on the ledger query, and removing it is half the fix -- but
    // nothing asserted the removal until this line: restoring the redirect
    // reddened no test at all. "could not translate host name" is psql's
    // wording and may change; `psql: error:` is its stable prefix, and what is
    // being asserted is that the diagnosis is not swallowed, not its phrasing.
    expect(r.out, "psql's own error was suppressed — the operator is told the query failed but not why").toContain(
      'psql: error:',
    );

    // THE ASSERTION THAT MATTERS MOST. Not "it said something sensible" -- that
    // the go-ahead signal is absent from the output entirely. The first draft of
    // the FATAL message explained itself by quoting the pending line verbatim,
    // so a failure report contained, in full, the sentence that means "go".
    // An error must not be mistakable for the signal whose absence it reports.
    expect(r.out, 'a pending count appeared in the output of a failed connection').not.toContain('pending');
    expect(r.out, 'the runner printed a migration count it could not have obtained').not.toContain('migration(s)');
  });

  test('plant — an unreachable host is refused on the APPLY path too, not only the dry run', () => {
    // The dry run is what the founder hit, but the apply path reads the same
    // ledger through the same helper. A fix that covered only --dry-run would
    // leave the irreversible path fail-open.
    const r = runRunner(envFor('unreachable'));
    expect(r.status, `an unreachable host did not stop the apply:\n${r.out}`).toBe(3);
    expect(r.out, 'nothing should have been applied or bootstrapped').not.toContain('Migrations complete');
    expect(r.out, 'the runner attempted a bootstrap over a dead connection').not.toContain('Bootstrapping');
  });

  test('a reachable database with NO ledger reports every migration pending', () => {
    // The one legitimate empty. `to_regclass` returns NULL, psql -tA prints
    // nothing, and that must still mean "virgin" rather than being swept up by
    // the new refusal -- a fix that made every empty fatal would break the
    // bootstrap this script exists to perform.
    const r = runRunner(envFor('virgin'), '--dry-run');
    expect(r.status, `a virgin database was refused:\n${r.out}`).toBe(0);
    expect(r.out, `a virgin database did not report a full set of pending migrations:\n${r.out}`).toContain(
      '13 migration(s) pending.',
    );
  });

  test('positive control — the real database with a full ledger reports none pending', () => {
    // test-conventions section 2, the fourth way a leg goes wrong. A runner that
    // refused ordinary input would be worked around within a day, and the plants
    // above would keep passing while it was.
    const r = runRunner(envFor('real'), '--dry-run');
    expect(r.status, `an ordinary dry run was refused:\n${r.out}`).toBe(0);
    expect(r.out, `the ordinary dry run changed:\n${r.out}`).toContain('0 migration(s) pending.');
  });
});

describe('a command that succeeds and says nothing is not a database', () => {
  test('plant — psql exits 0 but cannot answer SELECT 1: refused before any count', () => {
    // The defect one level down from the original. Exit status alone does not
    // separate "ran and returned nothing" from "is not a database at all", and
    // an empty `to_regclass` reads as a virgin database either way -- so this
    // would have produced a full pending count over a connection that never
    // existed. Proving the channel first is what makes the later empty
    // trustworthy.
    withFakePsql('silent', (bin) => {
      const r = runRunner({ ...process.env, OPENBED_PSQL: bin }, '--dry-run');
      expect(r.status, `a psql that answers nothing was accepted:\n${r.out}`).toBe(3);
      expect(r.out, 'the refusal did not name the probe that failed').toContain('did not answer SELECT 1');
      expect(r.out, 'a pending count was printed over a non-database').not.toContain('pending');
    });
  });

  test('plant — a COUNT that returns nothing is fatal, not "already applied"', () => {
    // The second original site, isolated. The connection is proved good and the
    // ledger is proved present, so nothing earlier can fire; only the count
    // comes back empty. The old code read that as `[ "" != "0" ]` -> true ->
    // "already applied", and would have reported ZERO pending -- the apply is
    // already done -- over a database it never really questioned.
    withFakePsql('no-count', (bin) => {
      const r = runRunner({ ...process.env, OPENBED_PSQL: bin }, '--dry-run');
      expect(r.status, `an empty COUNT was accepted:\n${r.out}`).toBe(3);
      expect(r.out, 'the refusal did not name the count query').toContain('COUNT(*) returned no value');
      expect(r.out, 'the runner reported migration state it never obtained').not.toContain('pending');
      expect(r.out, 'an unanswered count was reported as already applied').not.toContain('already applied');
    });
  });

  test('plant — a connection that dies AFTER the reachability probe is fatal', () => {
    // The one case assert_connected cannot reach, because it has already
    // passed. Without psql_scalar checking the status of every later query, a
    // database that goes away mid-run leaves an empty ledger lookup that reads
    // as "virgin" -- a full pending count from a connection that existed for
    // exactly one round trip. Neutering psql_scalar's status check reds this
    // test and no other.
    withFakePsql('dies-after-connect', (bin) => {
      const r = runRunner({ ...process.env, OPENBED_PSQL: bin }, '--dry-run');
      expect(r.status, `a mid-run disconnection was accepted:\n${r.out}`).toBe(3);
      expect(r.out, 'the refusal did not say the database was never queried').toContain(
        'the database was not queried',
      );
      expect(r.out, 'a pending count survived a mid-run disconnection').not.toContain('pending');
    });
  });
});
