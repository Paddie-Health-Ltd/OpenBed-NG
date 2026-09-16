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

  await pauseScheduledJobs();
}

/**
 * THE TWO pg_cron JOBS 017 SCHEDULES ARE PAUSED FOR THE WHOLE db RUN
 * (R-2026-09-16-10). Not optional: this is the flake fix.
 *
 * WHY. openbed_regenerate_snapshot writes app.system_heartbeat every minute, and
 * tests/db/migration_idempotency.test.ts hashes every app table before and after
 * re-applying the migrations. With the job live, 2 of 83 consecutive runs of that
 * test went red, each spanning a job run (observed 2026-09-16). The rollup job's
 * DELETE-and-recompute of public.lga_rollup would race
 * tests/db/lga_rollup_kfloor.test.ts the same way.
 *
 * WHY THE PAUSE HOLDS FOR THE WHOLE RUN. migration_idempotency re-applies 017
 * mid-suite, and cron.schedule upserts by name WITHOUT resetting `active`: a job
 * paused with cron.alter_job stayed paused when re-scheduled, even with a changed
 * schedule string (observed 2026-09-16). So nothing later in the run un-pauses it.
 *
 * WHAT THIS DOES NOT DO. It does not stand in for condition F.
 * tests/db/snapshot_schedule_state.test.ts never reads these ambient rows' `active`
 * flag; it asserts what 017 produces from its own rolled-back re-application.
 *
 * SIDE EFFECT ON A LOCAL STACK. The pause is committed. The e2e project and any
 * local session afterwards see paused jobs until `npm run db:reset` re-applies
 * 017. CI provisions a database per job, so nothing carries over there.
 *
 * LOUD, NEVER SKIPPED (section 6). A database without the two jobs is a database
 * not migrated to 017, and this throws saying so rather than running the suite
 * with live jobs.
 */
const SCHEDULED_JOBS = ['openbed_refresh_lga_rollup', 'openbed_regenerate_snapshot'];

async function pauseScheduledJobs(): Promise<void> {
  const db = sql();
  const [cron] = await db<{ present: boolean }[]>`select to_regclass('cron.job') is not null as present`;
  if (!cron?.present) {
    throw new Error(
      `pg_cron is not installed (no cron.job): the database is not migrated to 017_snapshot_schedule.sql.\n` +
        `  Run:  npm run db:reset`,
    );
  }
  await db`
    select cron.alter_job(jobid, active := false)
      from cron.job
     where jobname = any(${SCHEDULED_JOBS}) and username = current_user
  `;
  const rows = await db<{ jobname: string; active: boolean }[]>`
    select jobname, active from cron.job
     where jobname = any(${SCHEDULED_JOBS}) and username = current_user
     order by jobname
  `;
  const state = rows.map((r) => `${r.jobname}:active=${r.active}`).join(', ');
  if (rows.length !== SCHEDULED_JOBS.length || rows.some((r) => r.active)) {
    throw new Error(
      `Could not pause the 017 pg_cron jobs before the db run; the suite would race them.\n` +
        `  expected: ${SCHEDULED_JOBS.join(', ')} all active=false\n` +
        `  found:    ${state || 'no rows'}`,
    );
  }
}

export async function teardown(): Promise<void> {
  await endPool();
}
