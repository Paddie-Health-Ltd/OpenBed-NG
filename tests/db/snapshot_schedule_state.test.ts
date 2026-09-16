import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * THE SCHEDULE EXISTS, ONCE, ACTIVE, ON SCHEDULE, AS postgres -- condition F's
 * analogue for migration 017, which 016's header committed to: "asserting the job
 * exists, is active and is on schedule. F can only assert a mechanism that exists."
 *
 * WHAT IS ASSERTED, per job, for BOTH openbed_regenerate_snapshot and
 * openbed_refresh_lga_rollup (parametrised, never one assumed from the other):
 * exactly one cron.job row for the name; active true; schedule, command and
 * username EQUAL to what 017 sets. Each is a distinct way a job is present and
 * not reaching -- unscheduled, scheduled twice, scheduled but off, scheduled
 * wrong, scheduled as the wrong role -- and each has a plant below that proves
 * the assertion reds.
 *
 * HOW, AND WHY THIS SHAPE (R-2026-09-16-10). The db project's globalSetup pauses
 * both jobs for the whole run (tests/setup/global-setup.ts), so the AMBIENT rows
 * read active=false by design. This file never reads them. Inside a rolled-back
 * transaction it unschedules both jobs, then applies 017's own file TWICE, and
 * asserts the rows that produced: the first application gives the as-migrated
 * state, the second is the duplicate check. Unscheduling first is not optional:
 * cron.schedule upserts by name and KEEPS an existing row's `active`, so
 * re-applying over the paused rows would read false and assert the pause, not
 * the migration (observed 2026-09-16). cron.schedule, cron.unschedule and
 * cron.alter_job all roll back with the transaction (observed 2026-09-16), so
 * nothing here touches the ambient jobs. The migration text is read from the
 * file, never restated; the EXPECTED table below is a deliberate literal that
 * reddens the moment 017 changes a cadence or a command (test-conventions §3).
 *
 * WHY A SECOND ROW IS POSSIBLE AT ALL. cron.job carries UNIQUE (jobname,
 * username), and postgres cannot insert into cron.job directly (permission
 * denied, observed). A same-name job can only exist under ANOTHER role, which is
 * exactly the duplicate that would fire the generator twice -- so the duplicate
 * plant schedules the name as a second role.
 *
 * THE REPAIR (R-2026-09-16-08). 017 redefines app.refresh_lga_rollup() with
 * `SET row_security = off`. Asserted here as an exact proconfig, with a plant (an
 * owner without BYPASSRLS RAISES at the DELETE), a counter-control (the same
 * owner WITHOUT the attribute leaves a below-floor cell published at its exact
 * bed count, silently -- the reason the repair exists, observed 2026-09-16) and a
 * positive control (under postgres the repaired refresh removes that cell).
 *
 * NOT ASSERTED HERE, deliberately: that the jobs are ACTIVE ON HOSTED — the local
 * suite pauses them and asserts what 017 produces, not what a live project is
 * running; the hosted jobs are confirmed at the apply, as a runbook step. A green
 * run of this file is not a live-schedule guarantee.
 *
 * NOT ASSERTED HERE, deliberately: that a job RUNS — execution was observed once
 * locally (cron.job_run_details, status succeeded, 2026-09-16), but asserting it
 * would need a live job and a wait inside a suite whose jobs are paused to stop
 * exactly that kind of interleaving.
 */

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'database', 'migrations', '017_snapshot_schedule.sql');

const EXPECTED = [
  { jobname: 'openbed_regenerate_snapshot', schedule: '* * * * *', command: 'select app.regenerate_snapshot()', username: 'postgres' },
  { jobname: 'openbed_refresh_lga_rollup', schedule: '*/5 * * * *', command: 'select app.refresh_lga_rollup()', username: 'postgres' },
] as const;
type Job = (typeof EXPECTED)[number];

interface JobRow { jobname: string; schedule: string; command: string; username: string; active: boolean }

async function jobRows(tx: TransactionSql, jobname: string): Promise<JobRow[]> {
  return tx.unsafe<JobRow[]>(
    'select jobname, schedule, command, username, active from cron.job where jobname = $1 order by username',
    [jobname] as never[],
  );
}

/**
 * Setup for every schedule test: unschedule both jobs as postgres, confirm they
 * are gone, then apply 017 twice. Runs inside withRole()'s rolled-back transaction.
 */
async function applyMigrationTwiceFromEmpty(tx: TransactionSql): Promise<void> {
  for (const j of EXPECTED) {
    await tx.unsafe('select cron.unschedule(jobname) from cron.job where jobname = $1 and username = current_user', [j.jobname] as never[]);
  }
  const [left] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from cron.job where jobname = any($1)', [EXPECTED.map((j) => j.jobname)] as never[]);
  if (left?.n !== 0) throw new Error(`precondition: ${left?.n} openbed job row(s) survived unscheduling; the re-application would not start from empty`);
  const text = readFileSync(MIGRATION, 'utf8');
  await tx.unsafe(text);
  await tx.unsafe(text);
}

/** Every way one job can differ from what 017 sets. */
async function scheduleViolations(tx: TransactionSql, job: Job): Promise<string[]> {
  const rows = await jobRows(tx, job.jobname);
  const out: string[] = [];
  if (rows.length === 0) return [`${job.jobname} is not scheduled`];
  if (rows.length > 1) out.push(`${job.jobname} is scheduled ${rows.length} times (${rows.map((r) => r.username).join(', ')})`);
  for (const r of rows) {
    if (r.active !== true) out.push(`${job.jobname} is not active (username ${r.username})`);
    if (r.schedule !== job.schedule) out.push(`${job.jobname} schedule is '${r.schedule}', expected '${job.schedule}'`);
    if (r.command !== job.command) out.push(`${job.jobname} command is '${r.command}', expected '${job.command}'`);
    if (r.username !== job.username) out.push(`${job.jobname} runs as '${r.username}', expected '${job.username}'`);
  }
  return out;
}

/** Plants a same-name job under a second role. Must run as postgres, inside the transaction. */
async function scheduleAsSecondRole(tx: TransactionSql, job: Job, command = job.command): Promise<void> {
  await tx.unsafe('create role zz_cron_second nologin');
  await tx.unsafe('grant zz_cron_second to postgres');
  await tx.unsafe('grant usage on schema cron to zz_cron_second');
  await tx.unsafe('set local role zz_cron_second');
  await tx.unsafe('select cron.schedule($1, $2, $3)', [job.jobname, job.schedule, command] as never[]);
  await tx.unsafe('reset role');
}

async function refusal(fn: () => Promise<unknown>): Promise<{ message: string }> {
  try {
    await fn();
  } catch (e) {
    return { message: (e as { message: string }).message };
  }
  throw new Error('expected a refusal and the call succeeded');
}

describe('snapshot schedule state — condition F for 017', () => {
  test('the expected table names two jobs — anti-vacuity, the parametrised legs below are not iterating nothing', () => {
    expect(EXPECTED.map((j) => j.jobname)).toEqual(['openbed_regenerate_snapshot', 'openbed_refresh_lga_rollup']);
  });

  test.each(EXPECTED)('017 schedules $jobname exactly once, active, on schedule, as postgres — even applied twice', async (job) => {
    const r = await withRole('postgres', null, async (tx) => ({ rows: await jobRows(tx, job.jobname), violations: await scheduleViolations(tx, job) }), applyMigrationTwiceFromEmpty);
    expect(r.rows.length, `017 applied twice did not leave one ${job.jobname} row: ${JSON.stringify(r.rows)}`).toBe(1);
    expect(r.violations, `${job.jobname} is not what 017 sets: ${JSON.stringify(r.rows)}`).toEqual([]);
  });

  test.each(EXPECTED)('plant — $jobname unscheduled is caught', async (job) => {
    const r = await withRole('postgres', null, async (tx) => ({ rows: await jobRows(tx, job.jobname), violations: await scheduleViolations(tx, job) }), async (tx) => {
      await applyMigrationTwiceFromEmpty(tx);
      await tx.unsafe('select cron.unschedule($1)', [job.jobname] as never[]);
    });
    expect(r.rows, 'the plant did not land: the job is still scheduled').toEqual([]);
    expect(r.violations).toContain(`${job.jobname} is not scheduled`);
  });

  test.each(EXPECTED)('plant — $jobname present but not active is caught', async (job) => {
    const r = await withRole('postgres', null, async (tx) => ({ rows: await jobRows(tx, job.jobname), violations: await scheduleViolations(tx, job) }), async (tx) => {
      await applyMigrationTwiceFromEmpty(tx);
      await tx.unsafe('select cron.alter_job(jobid, active := false) from cron.job where jobname = $1', [job.jobname] as never[]);
    });
    expect(r.rows.map((x) => x.active), 'the plant did not land: the job is still active').toEqual([false]);
    expect(r.violations).toContain(`${job.jobname} is not active (username postgres)`);
  });

  test.each(EXPECTED)('plant — $jobname with an altered schedule string is caught', async (job) => {
    const r = await withRole('postgres', null, async (tx) => ({ rows: await jobRows(tx, job.jobname), violations: await scheduleViolations(tx, job) }), async (tx) => {
      await applyMigrationTwiceFromEmpty(tx);
      await tx.unsafe(`select cron.alter_job(jobid, schedule := '*/7 * * * *') from cron.job where jobname = $1`, [job.jobname] as never[]);
    });
    expect(r.rows.map((x) => x.schedule), 'the plant did not land: the schedule is unchanged').toEqual(['*/7 * * * *']);
    expect(r.violations).toContain(`${job.jobname} schedule is '*/7 * * * *', expected '${job.schedule}'`);
  });

  test.each(EXPECTED)('plant — $jobname with an altered command is caught', async (job) => {
    const r = await withRole('postgres', null, async (tx) => ({ rows: await jobRows(tx, job.jobname), violations: await scheduleViolations(tx, job) }), async (tx) => {
      await applyMigrationTwiceFromEmpty(tx);
      await tx.unsafe(`select cron.alter_job(jobid, command := 'select 1') from cron.job where jobname = $1`, [job.jobname] as never[]);
    });
    expect(r.rows.map((x) => x.command), 'the plant did not land: the command is unchanged').toEqual(['select 1']);
    expect(r.violations).toContain(`${job.jobname} command is 'select 1', expected '${job.command}'`);
  });

  test.each(EXPECTED)('plant — $jobname scheduled as another role is caught', async (job) => {
    const r = await withRole('postgres', null, async (tx) => ({ rows: await jobRows(tx, job.jobname), violations: await scheduleViolations(tx, job) }), async (tx) => {
      await applyMigrationTwiceFromEmpty(tx);
      await tx.unsafe('select cron.unschedule($1)', [job.jobname] as never[]);
      await scheduleAsSecondRole(tx, job);
    });
    expect(r.rows.map((x) => x.username), 'the plant did not land: the job is not owned by the second role').toEqual(['zz_cron_second']);
    expect(r.violations).toContain(`${job.jobname} runs as 'zz_cron_second', expected 'postgres'`);
  });

  test.each(EXPECTED)('plant — $jobname scheduled twice (a second role) is caught', async (job) => {
    const r = await withRole('postgres', null, async (tx) => ({ rows: await jobRows(tx, job.jobname), violations: await scheduleViolations(tx, job) }), async (tx) => {
      await applyMigrationTwiceFromEmpty(tx);
      await scheduleAsSecondRole(tx, job);
    });
    expect(r.rows.map((x) => x.username), 'the plant did not land: there are not two rows for the name').toEqual(['postgres', 'zz_cron_second']);
    expect(r.violations).toContain(`${job.jobname} is scheduled 2 times (postgres, zz_cron_second)`);
  });
});

/**
 * Hands app.refresh_lga_rollup() to a fresh role WITHOUT BYPASSRLS holding every
 * privilege the refresh needs, so RLS is the only thing between it and
 * public.lga_rollup. The shape of snapshot.test.ts's nonBypassOwner(). Rolled back.
 */
async function nonBypassRollupOwner(tx: TransactionSql): Promise<void> {
  await tx.unsafe('create role zz_rollup_nobypass nologin nobypassrls');
  await tx.unsafe('grant zz_rollup_nobypass to postgres');
  await tx.unsafe('grant usage on schema app, public to zz_rollup_nobypass');
  // ALTER FUNCTION ... OWNER TO needs CREATE on the function's schema.
  await tx.unsafe('grant create on schema app to zz_rollup_nobypass');
  await tx.unsafe('grant select on app.facility, app.ward_status to zz_rollup_nobypass');
  await tx.unsafe('grant select, insert, delete on public.lga_rollup to zz_rollup_nobypass');
  await tx.unsafe('alter function app.refresh_lga_rollup() owner to zz_rollup_nobypass');
}

interface Cell { state: string; lga: string; category: string; total_beds: number }

/**
 * Deactivates one contributing quiet facility of a published cell sitting exactly
 * on the k-floor, so a correct refresh must make that cell VANISH. Returns the
 * cell as published before. Derived from the database, not from seed literals;
 * throws if no such cell exists, because the legs below would then compare nothing.
 */
async function pushCellBelowFloor(tx: TransactionSql): Promise<Cell> {
  const [cell] = await tx.unsafe<Cell[]>(
    'select state, lga, category::text as category, total_beds from public.lga_rollup where facility_count = 5 order by state, lga, category limit 1',
  );
  if (!cell) throw new Error('precondition: no published lga_rollup cell sits on the k-floor (facility_count = 5); the vanishing-cell legs would compare nothing');
  const updated = await tx.unsafe(
    `update app.facility set is_active = false
      where id = (select f.id from app.facility f join app.ward_status ws on ws.facility_id = f.id
                   where f.quiet_mode and f.is_active and ws.offering = 'OFFERED'
                     and f.state = $1 and f.lga = $2 and ws.category::text = $3
                   order by f.id limit 1)`,
    [cell.state, cell.lga, cell.category] as never[],
  );
  if (updated.count !== 1) throw new Error(`precondition: deactivated ${updated.count} facilities in ${cell.lga}/${cell.category}, expected 1`);
  return cell;
}

async function publishedCell(tx: TransactionSql, cell: Cell): Promise<Cell[]> {
  return tx.unsafe<Cell[]>(
    'select state, lga, category::text as category, total_beds from public.lga_rollup where state = $1 and lga = $2 and category::text = $3',
    [cell.state, cell.lga, cell.category] as never[],
  );
}

describe('app.refresh_lga_rollup() row_security repair — 017', () => {
  test('real — app.refresh_lga_rollup carries exactly search_path empty and row_security = off', async () => {
    const [fn] = await withRole('postgres', null, (tx) =>
      tx.unsafe<{ proconfig: string[] | null }[]>(`select proconfig from pg_proc where oid = 'app.refresh_lga_rollup()'::regprocedure`),
    );
    expect(fn?.proconfig, 'the repair is missing or the function carries other settings').toEqual(['search_path=""', 'row_security=off']);
  });

  test('plant — owned by a role without BYPASSRLS, the repaired refresh RAISES at the DELETE', async () => {
    const r = await withRole('postgres', null, async (tx) => {
      const [fn] = await tx.unsafe<{ owner: string; proconfig: string[] }[]>(
        `select pg_get_userbyid(proowner) as owner, proconfig from pg_proc where oid = 'app.refresh_lga_rollup()'::regprocedure`,
      );
      return { fn, refused: await refusal(() => tx.unsafe('select app.refresh_lga_rollup()')) };
    }, nonBypassRollupOwner);
    expect(r.fn, 'the plant did not land: the owner or the attribute is not as planted').toEqual({ owner: 'zz_rollup_nobypass', proconfig: ['search_path=""', 'row_security=off'] });
    expect(r.refused.message).toContain('query would be affected by row-level security policy for table "lga_rollup"');
  });

  test('counter-control — without row_security = off, a non-bypass owner leaves a below-floor cell published at its exact bed count, silently', async () => {
    let before: Cell | undefined;
    const r = await withRole('postgres', null, async (tx) => {
      const [fn] = await tx.unsafe<{ owner: string; proconfig: string[] }[]>(
        `select pg_get_userbyid(proowner) as owner, proconfig from pg_proc where oid = 'app.refresh_lga_rollup()'::regprocedure`,
      );
      const [ret] = await tx.unsafe<{ n: number }[]>('select app.refresh_lga_rollup() as n');
      return { fn, returned: ret?.n, after: await publishedCell(tx, before as Cell) };
    }, async (tx) => {
      before = await pushCellBelowFloor(tx);
      await nonBypassRollupOwner(tx);
      await tx.unsafe('alter function app.refresh_lga_rollup() reset row_security');
    });
    expect(r.fn, 'the plant did not land: the owner or the reset attribute is not as planted').toEqual({ owner: 'zz_rollup_nobypass', proconfig: ['search_path=""'] });
    expect(r.returned, 'the unrepaired refresh did not return silently with zero rows').toBe(0);
    expect(r.after, 'the counter-control did not reproduce the hazard: the below-floor cell is gone').toEqual([before]);
  });

  test('positive control — under postgres, the repaired refresh removes the below-floor cell', async () => {
    let before: Cell | undefined;
    const r = await withRole('postgres', null, async (tx) => {
      const [ret] = await tx.unsafe<{ n: number }[]>('select app.refresh_lga_rollup() as n');
      return { returned: ret?.n, after: await publishedCell(tx, before as Cell) };
    }, async (tx) => {
      before = await pushCellBelowFloor(tx);
    });
    expect(before, 'no cell was pushed below the floor').toBeDefined();
    expect(r.after, `the repaired refresh left ${before?.lga}/${before?.category} published below the k-floor`).toEqual([]);
  });
});
