import { describe, expect, test, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, psqlCommand } from '../setup/db.js';
import { dbUrl } from '../setup/local-keys.js';

/**
 * A MIGRATION APPLIES ATOMICALLY, OR NOT AT ALL.
 *
 * `scripts/run_migrations.sh` passes each file to psql with BOTH
 * `--single-transaction` AND `-v ON_ERROR_STOP=1`. The two are only safe
 * together, and this file is what proves the pair actually behaves:
 *
 *   * Without --single-transaction, psql autocommits statement by statement, so
 *     a file failing at statement 7 of 12 leaves 1-6 COMMITTED and unledgered.
 *   * Without ON_ERROR_STOP, the aborted transaction rolls back, every later
 *     statement fails, the closing COMMIT becomes a ROLLBACK -- and psql STILL
 *     EXITS 0. The runner would report the migration applied over a database
 *     that received nothing. Silent success, the worst shape.
 *
 * WHY A TEST RATHER THAN A DEMONSTRATION. Someone ran this once and watched it
 * roll back; that is evidence with a shelf life. This is the one script whose
 * failure mode is a half-applied production schema, and the flags it depends on
 * are two easily-deleted words in a bash array.
 *
 * The plants run against the live local database on purpose -- a rollback proved
 * against a toy schema is not the claim being made. Every probe object is
 * dropped in afterEach whatever the outcome.
 */

const RUNNER = join(import.meta.dirname, '..', '..', 'scripts', 'run_migrations.sh');
const PROBE = '900_atomicity_probe.sql';

/** Builds a scratch repo root holding exactly one planted migration. */
function scratchWith(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), 'openbed-runner-'));
  mkdirSync(join(root, 'database', 'migrations'), { recursive: true });
  writeFileSync(join(root, 'database', 'migrations', PROBE), contents, 'utf8');
  return root;
}

/**
 * The runner resolves psql itself, from OPENBED_PSQL / DATABASE_URL / PG* -- it
 * cannot see this process's resolution, so hand it the right one. A containerised
 * psql goes in OPENBED_PSQL (which the runner word-splits); a real one goes in
 * DATABASE_URL, because a quoted URL inside OPENBED_PSQL would not survive that
 * split.
 */
function runnerEnv(): NodeJS.ProcessEnv {
  const cmd = psqlCommand();
  return cmd.startsWith('docker')
    ? { ...process.env, OPENBED_PSQL: cmd }
    : { ...process.env, DATABASE_URL: dbUrl() };
}

function runRunner(root: string, ...flags: string[]): { status: number; out: string } {
  try {
    const out = execFileSync('bash', [RUNNER, ...flags, root],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: runnerEnv() });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

async function objectExists(table: string): Promise<boolean> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from pg_tables where schemaname='app' and tablename=${table}
  `;
  return (row?.n ?? 0) > 0;
}

async function ledgered(): Promise<boolean> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from app.schema_migrations where filename=${PROBE}
  `;
  return (row?.n ?? 0) > 0;
}

afterEach(() => {
  const psql = psqlCommand();
  execFileSync('bash', ['-c',
    `${psql} -c 'DROP TABLE IF EXISTS app.atomicity_probe_a, app.atomicity_probe_b' >/dev/null 2>&1 || true`]);
  execFileSync('bash', ['-c',
    `${psql} -c "DELETE FROM app.schema_migrations WHERE filename='${PROBE}'" >/dev/null 2>&1 || true`]);
});

describe('migration runner atomicity', () => {
  test('plant — a migration that fails midway applies NOTHING and ledgers NOTHING', async () => {
    // Statement 1 succeeds, statement 2 raises, statement 3 would succeed.
    // Without --single-transaction, table _a would survive.
    const root = scratchWith(
      `CREATE TABLE app.atomicity_probe_a (id int);\n` +
      `SELECT * FROM app.table_that_does_not_exist;\n` +
      `CREATE TABLE app.atomicity_probe_b (id int);\n` +
      `INSERT INTO app.schema_migrations (filename) VALUES ('${PROBE}') ON CONFLICT DO NOTHING;\n`,
    );
    try {
      const res = runRunner(root);

      expect(res.status, `runner reported success over a failed migration:\n${res.out}`).not.toBe(0);
      expect(await objectExists('atomicity_probe_a'),
        'the FIRST statement survived — the file was not applied in one transaction').toBe(false);
      expect(await objectExists('atomicity_probe_b'), 'a post-error statement applied').toBe(false);
      expect(await ledgered(), 'a failed migration was recorded as applied').toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('positive control — a valid migration applies AND ledgers', async () => {
    // A guard that rejected everything would satisfy the plant perfectly while
    // making the runner useless. This is the leg that stops that.
    const root = scratchWith(
      `CREATE TABLE IF NOT EXISTS app.atomicity_probe_a (id int);\n` +
      `INSERT INTO app.schema_migrations (filename) VALUES ('${PROBE}') ON CONFLICT DO NOTHING;\n`,
    );
    try {
      const res = runRunner(root);
      expect(res.status, res.out).toBe(0);
      expect(await objectExists('atomicity_probe_a')).toBe(true);
      expect(await ledgered(), 'a successful migration was not ledgered').toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--dry-run applies nothing and reports what would run', async () => {
    const root = scratchWith(
      `CREATE TABLE app.atomicity_probe_a (id int);\n` +
      `INSERT INTO app.schema_migrations (filename) VALUES ('${PROBE}') ON CONFLICT DO NOTHING;\n`,
    );
    try {
      const res = runRunner(root, '--dry-run');
      expect(res.status, res.out).toBe(0);
      const out = res.out;
      expect(out).toContain('WOULD APPLY');
      expect(out).toContain(PROBE);
      expect(await objectExists('atomicity_probe_a'), '--dry-run applied a migration').toBe(false);
      expect(await ledgered(), '--dry-run wrote to the ledger').toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the runner still carries both flags — neither is safe alone', () => {
    // Keyed to the source, because the protection is two words in a bash array
    // and this is the file that would otherwise notice their absence too late.
    const src = execFileSync('bash', ['-c', `cat ${JSON.stringify(RUNNER)}`], { encoding: 'utf8' });
    expect(src, 'run_migrations.sh lost --single-transaction').toContain('--single-transaction');
    expect(src, 'run_migrations.sh lost ON_ERROR_STOP=1').toContain('ON_ERROR_STOP=1');
  });
});
