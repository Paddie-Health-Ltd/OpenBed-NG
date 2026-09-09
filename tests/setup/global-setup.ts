import { sql, endPool } from './db.js';
import { dbUrl } from './local-keys.js';

/**
 * Verifies the database is reachable AND migrated before any `db` test runs.
 *
 * LOUD FAILURE IS THE POINT (see .claude/rules/test-conventions.md section 6).
 * If this throws, every db test errors with one legible message. The alternative
 * -- a per-test skip when the connection fails -- reports the same green as a
 * suite that ran, and this suite is the only evidence the security boundary
 * holds.
 */
export async function setup(): Promise<void> {
  const db = sql();
  try {
    await db`select 1`;
  } catch (e) {
    throw new Error(
      `Cannot reach the database at ${dbUrl()}.\n` +
        `  Start it with:  npm run db:start\n` +
        `  Then migrate:   npm run db:migrate\n` +
        `Original error: ${String(e)}`,
    );
  }

  const [ledger] = await db<{ n: number }[]>`
    select count(*)::int as n
    from pg_tables where schemaname = 'app' and tablename = 'schema_migrations'
  `;
  if (!ledger || ledger.n === 0) {
    throw new Error(
      `Database is reachable but not migrated: app.schema_migrations does not exist.\n` +
        `  Run:  npm run db:reset`,
    );
  }
}

export async function teardown(): Promise<void> {
  await endPool();
}
