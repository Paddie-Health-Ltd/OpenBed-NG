import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import { dbUrl, apiUrl, anonKey } from './local-keys.js';

/**
 * Shared database harness for the `db` project.
 *
 * TWO HAZARDS THIS FILE EXISTS TO CLOSE, both specific to postgres.js and both
 * silent when they bite.
 *
 * 1. THE POOL LEAKS ROLES. `postgres.js` pools connections and a bare `SET ROLE`
 *    persists on a connection after it is returned to the pool. A later test
 *    picking up that connection then runs as `anon` without asking, and either
 *    fails mysteriously or -- much worse -- PASSES an assertion that was meant
 *    to run as someone else. `max: 1` plus `withRole()`'s `SET LOCAL` inside a
 *    transaction makes the role reset at commit, structurally.
 *
 * 2. THE PROCESS HANGS. An un-ended pool keeps the event loop alive and vitest
 *    never exits. tests/setup/global-setup.ts calls `endPool()` in teardown.
 */

let pool: ReturnType<typeof postgres> | null = null;

export function sql(): ReturnType<typeof postgres> {
  pool ??= postgres(dbUrl(), {
    // See hazard 1. Do not raise this without replacing withRole().
    max: 1,
    onnotice: () => {},
    // Fail fast and loudly. A `db` test that cannot reach the database must
    // FAIL, never skip: a skipped test reports the same green as a passing one,
    // and this suite is the only evidence the security boundary holds.
    connect_timeout: 10,
  });
  return pool;
}

export async function endPool(): Promise<void> {
  if (pool) {
    await pool.end({ timeout: 5 });
    pool = null;
  }
}

/** Postgres roles a Supabase project ships. */
export type PgRole = 'anon' | 'authenticated' | 'service_role' | 'postgres';

/**
 * Run `fn` inside a transaction as `role`, with optional JWT claims visible to
 * `auth.uid()`.
 *
 * `SET LOCAL` scopes both to the transaction, so the role cannot escape into the
 * next test even if `fn` throws. This is the direct analogue of the sibling
 * project's `SET LOCAL ROLE audit_reader` idiom.
 *
 * The transaction is ALWAYS rolled back: these tests probe a boundary, and a
 * probe that leaves rows behind changes the corpus every later assertion runs
 * against.
 */
export async function withRole<T>(
  role: PgRole,
  claims: Record<string, unknown> | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
  /**
   * Optional fixture setup, run INSIDE the transaction but BEFORE the role
   * switch -- so it runs with full privileges and is rolled back with everything
   * else. Needed because most negative tests must first create the very rows
   * whose access they are about to deny: `anon` cannot insert a ward_account to
   * then fail to read.
   */
  setup?: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<T> {
  const db = sql();
  const sentinel = Symbol('rollback');
  try {
    return await db.begin(async (tx) => {
      if (setup) await setup(tx);
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      if (claims) {
        await tx.unsafe(`SET LOCAL request.jwt.claims = '${JSON.stringify(claims).replace(/'/g, "''")}'`);
      }
      const out = await fn(tx);
      // Force a rollback by throwing a value we recognise on the way out.
      throw { [sentinel as unknown as string]: true, out };
    });
  } catch (e) {
    if (e && typeof e === 'object' && 'out' in e && (e as Record<string, unknown>)[sentinel as unknown as string]) {
      return (e as { out: T }).out;
    }
    throw e;
  }
}

/** Result of an anonymous PostgREST request. */
export interface RestResult {
  status: number;
  body: unknown;
}

/**
 * A REAL anonymous HTTP request through PostgREST, with the published anon key
 * -- the same shape of request a browser makes.
 *
 * This is the leg that a purely in-database test (pgTAP, or psql as `anon`)
 * cannot perform, and it is where the exposed-schemas list is actually enforced:
 * `app` is absent from `[api] schemas` in supabase/config.toml, so PostgREST
 * refuses with PGRST106 before any RLS policy is consulted.
 *
 * @param profile Sets `Accept-Profile`, i.e. asks PostgREST for a named schema.
 *                Used to prove that asking for `app` is refused.
 */
export async function anonRest(
  path: string,
  opts: { profile?: string; method?: string } = {},
): Promise<RestResult> {
  const headers: Record<string, string> = {
    apikey: anonKey(),
    Authorization: `Bearer ${anonKey()}`,
    'Content-Type': 'application/json',
  };
  if (opts.profile) {
    headers[opts.method && opts.method !== 'GET' ? 'Content-Profile' : 'Accept-Profile'] = opts.profile;
  }
  const res = await fetch(`${apiUrl()}/rest/v1/${path}`, {
    method: opts.method ?? 'GET',
    headers,
  });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

/** PostgREST error code from a failed response body, or null. */
export function restErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'code' in body) {
    const code = (body as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * The psql invocation to apply a SQL FILE, resolved the same way
 * `scripts/run_migrations.sh` resolves it.
 *
 * Three ways, in precedence order, and the third is why this helper exists: a
 * developer machine may have Docker and no local psql, and the Supabase
 * container carries one. Without the fallback these tests pass in CI (where the
 * workflow installs postgresql-client) and fail on the machine of anyone who
 * followed the README, which is the wrong way round for a guard.
 *
 * Files are fed on STDIN rather than via -f so the containerised form works --
 * the container cannot see a path on the host filesystem.
 */
export function psqlCommand(): string {
  const injected = process.env['OPENBED_PSQL'];
  if (injected) return injected;

  try {
    execFileSync('bash', ['-c', 'command -v psql'], { stdio: 'ignore' });
    return `psql ${JSON.stringify(dbUrl())}`;
  } catch {
    // No local psql. Find the Supabase database container by name rather than
    // hardcoding a project slug.
    const name = execFileSync('bash', ['-c',
      "docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1"],
      { encoding: 'utf8' }).trim();
    if (!name) {
      throw new Error(
        'No psql on PATH, no OPENBED_PSQL set, and no running supabase_db_* container.\n' +
        '  Start the database with `npm run db:start`, or install postgresql-client.',
      );
    }
    return `docker exec -i ${name} psql -U postgres -d postgres`;
  }
}
