import { sql, endPool, pauseScheduledJobs, assertScheduledJobsPaused } from './db.js';
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

  pauseScheduledJobs();
  await assertScheduledJobsPaused('the db run');
}

/**
 * THE TWO pg_cron JOBS 017 SCHEDULES ARE PAUSED FOR THE WHOLE db RUN
 * (R-2026-09-16-10, R-2026-09-16-11). Not optional: this is the flake fix.
 *
 * WHY. openbed_regenerate_snapshot writes app.system_heartbeat every minute, and
 * tests/db/migration_idempotency.test.ts hashes every app table before and after
 * re-applying the migrations. With the job live, 2 of 83 consecutive runs of that
 * test went red, each spanning a job run; with a '1 seconds' job, 4 of 4 red
 * unpaused and 4 of 4 green paused (observed 2026-09-16).
 *
 * WHERE THE PAUSE COMES FROM. scripts/seed.sh applies
 * database/local/pause_scheduled_jobs.sql straight after the migrations, which
 * closes the window from migration to test. This setup applies the SAME file
 * again, so a database migrated without the seed is paused too, and then checks
 * the result independently. One implementation, two call sites; the file's
 * header carries the reasons.
 *
 * WHY THE PAUSE HOLDS FOR THE WHOLE RUN. migration_idempotency re-applies 017
 * mid-suite, and cron.schedule upserts by name WITHOUT resetting `active`
 * (observed 2026-09-16). Nothing later in the run un-pauses it.
 *
 * WHAT THIS DOES NOT DO. It does not stand in for condition F.
 * tests/db/snapshot_schedule_state.test.ts never reads these ambient rows' `active`
 * flag; it asserts what 017 produces from its own rolled-back re-application.
 *
 * SIDE EFFECT ON A LOCAL STACK. The pause is committed and stays until
 * `npm run db:reset` re-applies 017 -- after which the seed pauses the jobs again.
 * A local stack therefore never runs them; hosted always does.
 *
 * LOUD, NEVER SKIPPED (section 6). The file raises OPENBED_JOBS_NOT_PAUSED rather
 * than letting the suite run with live jobs.
 */

export async function teardown(): Promise<void> {
  await endPool();
}
