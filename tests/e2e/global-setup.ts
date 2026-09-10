import { endPool, sql } from '../setup/db.js';
import { gotrueVersion } from '../setup/auth.js';
import { apiUrl } from '../setup/local-keys.js';
import { resetE2eCorpus, seedE2eCorpus, assertE2eCorpus, provisionE2eWardAccounts } from './_harness.js';

/**
 * Verifies the whole stack is reachable AND migrated, then builds the E2E corpus.
 *
 * LOUD FAILURE IS THE POINT (test-conventions section 6). If this throws, every
 * step errors with one legible message. The alternative -- a per-step skip when
 * the stack is down -- reports the same green as a suite that ran, and this suite
 * is the evidence the golden path holds end to end.
 *
 * It also prints the GoTrue version on every run. The magic-link steps assert a
 * property of a specific GoTrue build, and a claim about local auth that does not
 * carry the version it is true of is not a claim anyone can check later.
 */
export async function setup(): Promise<void> {
  const db = sql();

  try {
    await db`select 1`;
  } catch (e) {
    throw new Error(
      `Cannot reach the database at the configured DATABASE_URL.\n` +
        `  Start it with:  npm run db:start\n  Then migrate:   npm run db:reset\n` +
        `Original error: ${String(e)}`,
    );
  }

  const [ledger] = await db<{ n: number }[]>`
    select count(*)::int as n from pg_tables where schemaname = 'app' and tablename = 'schema_migrations'
  `;
  if (!ledger || ledger.n === 0) {
    throw new Error('Database is reachable but not migrated: app.schema_migrations does not exist.\n  Run:  npm run db:reset');
  }

  let version: string;
  try {
    version = await gotrueVersion();
  } catch (e) {
    throw new Error(
      `Cannot reach GoTrue at ${apiUrl()}/auth/v1/health. The magic-link steps cannot run and MUST NOT be skipped.\n` +
        `Original error: ${String(e)}`,
    );
  }
  // Printed every run, deliberately. See the header.
  console.log(`[e2e] GoTrue ${version} at ${apiUrl()}`);

  await resetE2eCorpus();
  await seedE2eCorpus();
  await assertE2eCorpus();
  provisionE2eWardAccounts();
}

export async function teardown(): Promise<void> {
  try {
    await resetE2eCorpus();
  } finally {
    await endPool();
  }
}
