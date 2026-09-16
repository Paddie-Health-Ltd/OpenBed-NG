import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import type { TransactionSql } from 'postgres';
import { withRole, sql, scheduledJobPauseViolations, SCHEDULED_JOBS, PAUSE_SCHEDULED_JOBS_SQL } from '../setup/db.js';

/**
 * THE PAUSE ON 017's pg_cron JOBS IS REAL, AND ITS CHECKER CAN FAIL (R-2026-09-16-11).
 *
 * THE CONTROL. database/local/pause_scheduled_jobs.sql pauses
 * openbed_refresh_lga_rollup and openbed_regenerate_snapshot and waits out any run
 * in flight. scripts/seed.sh applies it straight after the migrations; the db and
 * e2e test setups apply it again and then check the result with
 * scheduledJobPauseViolations() (tests/setup/db.ts). The golden path's
 * snapshot-regenerates step calls the same checker before relying on the pause.
 * Without the pause, a live job races migration_idempotency's digest and the
 * seed's own rollup refresh, and it would satisfy that golden-path step's
 * heartbeat and payload checks with a regeneration the step did not make.
 *
 * WHAT IS ASSERTED.
 *   - The checker: the ambient rows of this run read paused (real); a reactivated
 *     job and an unscheduled job are each reported by name (plants); with no
 *     pg_cron rows at all it reports both missing, never nothing (anti-vacuity).
 *   - The file: it pauses two active jobs (real); it raises
 *     OPENBED_JOBS_NOT_PAUSED when pg_cron is absent, when a job is missing, and
 *     when a run is still in flight at its deadline (plants); a `running` row
 *     older than its recency window does not hold it (positive control).
 *
 * This is the PAUSE control, not condition F. Reading the ambient `active` flag is
 * this file's subject; tests/db/snapshot_schedule_state.test.ts never reads it.
 *
 * Every plant runs inside withRole()'s rolled-back transaction, with the settle
 * shortened through openbed.pause_settle_seconds so a leg does not wait two
 * seconds for nothing. cron.alter_job, cron.unschedule, DROP EXTENSION and an
 * INSERT into cron.job_run_details all roll back (observed 2026-09-16).
 *
 * NOT ASSERTED HERE, deliberately: that psql COMMITS the pause before the wait —
 * inside one transaction the file cannot show its own statement boundary; psql's
 * per-statement autocommit is what scripts/seed.sh and pauseScheduledJobs() rely
 * on, and the pause taking effect within seconds of a commit was observed, not
 * asserted.
 */

const FILE = readFileSync(PAUSE_SCHEDULED_JOBS_SQL, 'utf8');

async function applyPauseFile(tx: TransactionSql, settle = '0', deadline?: string): Promise<void> {
  await tx.unsafe(`set local openbed.pause_settle_seconds = '${settle}'`);
  if (deadline) await tx.unsafe(`set local openbed.pause_deadline_seconds = '${deadline}'`);
  await tx.unsafe(FILE);
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as { message: string }).message;
  }
  throw new Error('expected the pause file to raise, and it did not');
}

async function activeByName(tx: TransactionSql): Promise<Record<string, boolean>> {
  const rows = await tx.unsafe<{ jobname: string; active: boolean }[]>(
    `select jobname, active from cron.job where jobname like 'openbed_%' order by jobname`,
  );
  return Object.fromEntries(rows.map((r) => [r.jobname, r.active]));
}

describe('the 017 pg_cron jobs are paused for the run — R-2026-09-16-11', () => {
  test('real — the db run\'s two jobs are paused', async () => {
    expect(await scheduledJobPauseViolations(sql()), 'the db run is racing a live pg_cron job').toEqual([]);
  });

  test.each([...SCHEDULED_JOBS])('plant — a reactivated %s is reported', async (name) => {
    const r = await withRole('postgres', null, async (tx) => ({ state: await activeByName(tx), v: await scheduledJobPauseViolations(tx) }), async (tx) => {
      await tx.unsafe('select cron.alter_job(jobid, active := true) from cron.job where jobname = $1', [name] as never[]);
    });
    expect(r.state[name], 'the plant did not land: the job is not active').toBe(true);
    expect(r.v).toContain(`${name} is active`);
  });

  test.each([...SCHEDULED_JOBS])('plant — an unscheduled %s is reported', async (name) => {
    const r = await withRole('postgres', null, async (tx) => ({ state: await activeByName(tx), v: await scheduledJobPauseViolations(tx) }), async (tx) => {
      await tx.unsafe('select cron.unschedule($1)', [name] as never[]);
    });
    expect(Object.keys(r.state), 'the plant did not land: the job is still scheduled').not.toContain(name);
    expect(r.v).toContain(`${name} is not scheduled`);
  });

  test('anti-vacuity — with no pg_cron rows the checker reports both jobs missing, not nothing', async () => {
    const v = await withRole('postgres', null, (tx) => scheduledJobPauseViolations(tx), async (tx) => {
      for (const name of SCHEDULED_JOBS) await tx.unsafe('select cron.unschedule($1)', [name] as never[]);
    });
    expect(v).toEqual(SCHEDULED_JOBS.map((n) => `${n} is not scheduled`));
  });

  test('real — the pause file pauses two active jobs', async () => {
    const r = await withRole('postgres', null, async (tx) => {
      const before = await activeByName(tx);
      await applyPauseFile(tx);
      return { before, after: await activeByName(tx), v: await scheduledJobPauseViolations(tx) };
    }, async (tx) => {
      await tx.unsafe(`select cron.alter_job(jobid, active := true) from cron.job where jobname like 'openbed_%'`);
    });
    expect(r.before, 'the plant did not land: the jobs were not both active before the file ran').toEqual({ openbed_refresh_lga_rollup: true, openbed_regenerate_snapshot: true });
    expect(r.after).toEqual({ openbed_refresh_lga_rollup: false, openbed_regenerate_snapshot: false });
    expect(r.v).toEqual([]);
  });

  test('plant — the pause file RAISES when pg_cron is not installed', async () => {
    const message = await withRole('postgres', null, async (tx) => {
      const [c] = await tx.unsafe<{ present: boolean }[]>(`select to_regclass('cron.job') is not null as present`);
      if (c?.present) throw new Error('the plant did not land: cron.job still exists');
      return refusal(() => applyPauseFile(tx));
    }, async (tx) => {
      await tx.unsafe('drop extension pg_cron');
    });
    expect(message).toContain('OPENBED_JOBS_NOT_PAUSED: pg_cron is not installed (no cron.job)');
  });

  test('plant — the pause file RAISES when a job is missing', async () => {
    const message = await withRole('postgres', null, async (tx) => {
      const state = await activeByName(tx);
      if ('openbed_refresh_lga_rollup' in state) throw new Error('the plant did not land: the rollup job is still scheduled');
      return refusal(() => applyPauseFile(tx));
    }, async (tx) => {
      await tx.unsafe(`select cron.unschedule('openbed_refresh_lga_rollup')`);
    });
    expect(message).toContain('OPENBED_JOBS_NOT_PAUSED: expected openbed_refresh_lga_rollup, openbed_regenerate_snapshot paused, found openbed_regenerate_snapshot:active=false');
  });

  test('plant — the pause file RAISES at its deadline while a run is in flight', async () => {
    const message = await withRole('postgres', null, async (tx) => {
      const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from cron.job_run_details where runid = 2147480001 and status = 'running'`);
      if (n?.n !== 1) throw new Error('the plant did not land: no in-flight run row');
      return refusal(() => applyPauseFile(tx, '0', '1'));
    }, async (tx) => {
      await tx.unsafe(`
        insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, start_time)
        select jobid, 2147480001, 1, 'postgres', 'postgres', command, 'running', now()
          from cron.job where jobname = 'openbed_regenerate_snapshot'`);
    });
    expect(message).toContain('OPENBED_JOBS_NOT_PAUSED: a run is still in flight at the deadline: openbed_regenerate_snapshot runid=2147480001 running');
  });

  test('positive control — a `running` row older than the recency window does not hold the pause', async () => {
    const r = await withRole('postgres', null, async (tx) => {
      const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from cron.job_run_details where runid = 2147480002 and status = 'running'`);
      await applyPauseFile(tx, '0', '1');
      return { planted: n?.n, v: await scheduledJobPauseViolations(tx) };
    }, async (tx) => {
      await tx.unsafe(`
        insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, start_time)
        select jobid, 2147480002, 1, 'postgres', 'postgres', command, 'running', now() - interval '1 hour'
          from cron.job where jobname = 'openbed_regenerate_snapshot'`);
    });
    expect(r.planted, 'the plant did not land: no stale running row').toBe(1);
    expect(r.v).toEqual([]);
  });
});
