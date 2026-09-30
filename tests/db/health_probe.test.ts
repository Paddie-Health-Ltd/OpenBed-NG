import { afterAll, describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { SCHEDULED_JOBS, assertScheduledJobsPaused, withRole } from '../setup/db.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import { SNAPSHOT_JOB, decideHealth, type ProbeInput } from '../../packages/snapshot/src/health.js';

/**
 * MIGRATION 027: app.scheduler_status() and public.health_probe() (R-2026-09-29-173 EW-1,
 * EW-2 g). The probe is the one function service_role may execute in this repository, and
 * /api/health's whole reading of the scheduler.
 *
 * EVERY TEST RUNS INSIDE withRole()'s ALWAYS-ROLLED-BACK TRANSACTION. That is not only
 * tidiness here, it is what makes the test possible at all: every openbed_ job is paused
 * for the whole db run (tests/setup/global-setup.ts), pg_cron cannot see an uncommitted
 * change, and a committed cron.alter_job would race the real scheduler. Switching the
 * snapshot job on INSIDE the transaction changes what the probe reads and cannot make
 * pg_cron run anything. assertScheduledJobsPaused is called before and after the block that
 * does it, to show the pause held and nothing committed.
 *
 * withRole runs its setup BEFORE `SET LOCAL ROLE` (tests/setup/db.ts), so every later step
 * that needs the owner's privileges runs after an explicit RESET ROLE, and the probe is
 * read after `SET LOCAL ROLE service_role` again, as the Function reads it.
 *
 * WHAT IS ASSERTED:
 *   - THE PROBE'S RESULT, FED TO THE PURE DECISION, GIVES 200 for a freshly generated
 *     snapshot and an active job -- and 503 job_inactive when the job is switched off, and
 *     503 snapshot_stale when generated_at is BANNER * 60 + 1 seconds back. Red first
 *     against a probe returning no job rows (the decision then reads job_absent).
 *   - THE GRANTS: service_role can execute health_probe and nothing else in this
 *     migration; anon and authenticated are refused with 42501; app.scheduler_status is
 *     not reachable by any client role.
 *   - IT READS THE ROW /beds.json SERVES: the newest by v, not the newest by time.
 *   - AN EMPTY snapshot_current IS NULL, NEVER FRESH.
 *   - THE RUN LOOKUP: the latest FINISHED run only, over two days only.
 *   - IT IS READ-ONLY: STABLE, a definer with an empty search_path, and calling it changes
 *     no row it reads.
 *
 * NOT ASSERTED HERE, deliberately: that HOSTED pg_cron lets the migration role's definer
 * read cron.job_run_details. It is asserted locally, and the local PostgreSQL 17.6 and
 * pg_cron are the stack's, not the hosted project's. The hosted read is the founder's
 * read-back after the apply (health_probe read as service_role), and until it is read the
 * claim is unproven there. The same applies to role attributes, which the runbook names.
 */

const BANNER_S = SHAPE.freshnessBands.snapshotBannerAfterMinutes * 60;

type Row = Record<string, unknown>;

async function probe(tx: TransactionSql): Promise<Row> {
  const [row] = await tx.unsafe<{ p: Row }[]>('select public.health_probe() as p');
  if (!row) throw new Error('health_probe returned no row');
  return row.p;
}
const answered = (body: unknown): ProbeInput => ({ outcome: 'answered', status: 200, body });

async function jobId(tx: TransactionSql, name: string): Promise<number> {
  const [row] = await tx.unsafe<{ jobid: string }[]>('select jobid from cron.job where jobname = $1 and username = current_user', [name] as never[]);
  if (!row) throw new Error(`${name} is not scheduled`);
  return Number(row.jobid);
}
async function setJobActive(tx: TransactionSql, name: string, active: boolean): Promise<void> {
  await tx.unsafe('select cron.alter_job($1::bigint, active := $2)', [await jobId(tx, name), active] as never[]);
}

/** Owner-privileged setup: switch the snapshot job on and generate a snapshot. */
async function freshSnapshot(tx: TransactionSql): Promise<void> {
  await setJobActive(tx, SNAPSHOT_JOB, true);
  await tx.unsafe('select app.regenerate_snapshot()');
}

/** A rolled-back read of health_probe as service_role, after `setup` as the owner. */
const asServiceRole = <T>(fn: (tx: TransactionSql) => Promise<T>, setup?: (tx: TransactionSql) => Promise<void>): Promise<T> =>
  withRole('service_role', null, fn, setup);

describe('health_probe read as service_role, fed to the decision', () => {
  test('a freshly generated snapshot with an active job yields 200; then inactive gives 503 job_inactive; then stale gives 503 snapshot_stale', async () => {
    await assertScheduledJobsPaused('the start of the health_probe transaction test');
    const results = await asServiceRole(
      async (tx) => {
        const out: Record<string, ReturnType<typeof decideHealth>> = {};
        out.fresh = decideHealth(answered(await probe(tx)));

        await tx.unsafe('reset role');
        await setJobActive(tx, SNAPSHOT_JOB, false);
        await tx.unsafe('set local role service_role');
        out.inactive = decideHealth(answered(await probe(tx)));

        await tx.unsafe('reset role');
        await setJobActive(tx, SNAPSHOT_JOB, true);
        await tx.unsafe(`update public.snapshot_current set generated_at = now() - make_interval(secs => ${BANNER_S + 1})`);
        await tx.unsafe('set local role service_role');
        out.stale = decideHealth(answered(await probe(tx)));
        return out;
      },
      freshSnapshot,
    );
    expect({ status: results.fresh?.status, reasons: results.fresh?.reasons }).toEqual({ status: 200, reasons: [] });
    expect(results.fresh?.body.job).toMatchObject({ name: SNAPSHOT_JOB, active: true });
    expect({ status: results.inactive?.status, reasons: results.inactive?.reasons }).toEqual({ status: 503, reasons: ['job_inactive'] });
    expect({ status: results.stale?.status, reasons: results.stale?.reasons }).toEqual({ status: 503, reasons: ['snapshot_stale'] });
    expect(results.stale?.body.snapshot_age_s).toBe(BANNER_S + 1);
    await assertScheduledJobsPaused('the end of the health_probe transaction test: nothing may have committed');
  });

  test('the probe names all five openbed_ jobs, and only openbed_ jobs', async () => {
    const p = await asServiceRole(probe);
    const names = (p.jobs as { name: string }[]).map((j) => j.name);
    expect(names).toEqual([...SCHEDULED_JOBS]);
  });

  test('a job that is not an openbed_ job is not reported', async () => {
    const p = await asServiceRole(probe, async (tx) => {
      await tx.unsafe(`select cron.schedule('zz_not_ours', '0 3 * * *', 'select 1')`);
      await tx.unsafe(`select cron.schedule('openbedXnot_ours', '0 3 * * *', 'select 1')`);
    });
    const names = (p.jobs as { name: string }[]).map((j) => j.name);
    expect(names).not.toContain('zz_not_ours');
    expect(names, 'the underscore in the name filter matched any character').not.toContain('openbedXnot_ours');
    expect(names).toEqual([...SCHEDULED_JOBS]);
  });
});

describe('what the probe reads', () => {
  test('generated_at is the newest row BY v, the row /beds.json serves, not the newest by time', async () => {
    const { p, older } = await asServiceRole(
      async (tx) => {
        const [o] = await tx.unsafe<{ g: string }[]>(`select generated_at::text as g from public.snapshot_current order by v desc limit 1`);
        return { p: await probe(tx), older: o?.g };
      },
      async (tx) => {
        await tx.unsafe('select app.regenerate_snapshot()');
        await tx.unsafe(
          `insert into public.snapshot_current (v, generated_at, payload) overriding system value
           select max(v) + 1, now() - interval '1 day', '{}'::jsonb from public.snapshot_current`,
        );
      },
    );
    expect(older).toBeDefined();
    expect(Date.parse(String(p.generated_at))).toBe(Date.parse(String(older)));
    expect(Date.parse(String(p.server_now)) - Date.parse(String(p.generated_at))).toBeGreaterThanOrEqual(23 * 3600 * 1000);
  });

  test('an empty snapshot_current reads generated_at NULL, never a value, and the decision is 503 snapshot_stale', async () => {
    const p = await asServiceRole(probe, async (tx) => {
      await setJobActive(tx, SNAPSHOT_JOB, true);
      await tx.unsafe('delete from public.snapshot_current');
    });
    expect(p.generated_at).toBeNull();
    const d = decideHealth(answered(p));
    expect({ status: d.status, reasons: d.reasons }).toEqual({ status: 503, reasons: ['snapshot_stale'] });
  });

  test('the heartbeat is carried, on the database\'s clock, beside server_now', async () => {
    const p = await asServiceRole(probe, async (tx) => {
      await tx.unsafe('select app.regenerate_snapshot()');
    });
    expect(typeof p.server_now).toBe('string');
    expect(Date.parse(String(p.last_snapshot_at))).toBe(Date.parse(String(p.generated_at)));
  });

  test('the latest FINISHED run, over two days: the unfinished, the older and the too-old runs are not it', async () => {
    const p = await asServiceRole(probe, async (tx) => {
      const id = await jobId(tx, SNAPSHOT_JOB);
      const plant = async (status: string, startAgo: string, finished: boolean): Promise<void> => {
        await tx.unsafe(
          `insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
           select $1::bigint, coalesce(max(runid), 0) + 1, 1, 'postgres', current_user, 'select 1', $2, '',
                  now() - $3::interval, case when $4::boolean then now() - $3::interval + interval '1 second' end
             from cron.job_run_details`,
          [id, status, startAgo, finished] as never[],
        );
      };
      await plant('failed', '3 days', true); // too old for the lookup
      await plant('succeeded', '2 hours', true); // older finished run
      await plant('failed', '1 hour', true); // THE latest finished run (highest runid that finished)
      await plant('running', '5 minutes', false); // higher runid, not finished
    });
    const j = (p.jobs as { name: string; last_status: string | null; last_start_time: string | null }[]).find((x) => x.name === SNAPSHOT_JOB);
    expect(j?.last_status).toBe('failed');
    const startedAgoS = (Date.parse(String(p.server_now)) - Date.parse(String(j?.last_start_time))) / 1000;
    expect(startedAgoS).toBeGreaterThan(3500);
    expect(startedAgoS).toBeLessThan(3700);
  });

  test('a job whose only run is older than two days reads no last run', async () => {
    const p = await asServiceRole(probe, async (tx) => {
      const id = await jobId(tx, SNAPSHOT_JOB);
      await tx.unsafe(
        `insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
         select $1::bigint, coalesce(max(runid), 0) + 1, 1, 'postgres', current_user, 'select 1', 'failed', '',
                now() - interval '3 days', now() - interval '3 days' + interval '1 second'
           from cron.job_run_details`,
        [id] as never[],
      );
    });
    const j = (p.jobs as { name: string; last_status: string | null }[]).find((x) => x.name === SNAPSHOT_JOB);
    expect(j?.last_status).toBeNull();
  });
});

describe('who may call it', () => {
  test.each([['anon'], ['authenticated']] as const)('%s call to health_probe is rejected with 42501', async (role) => {
    await expect(withRole(role, role === 'authenticated' ? { sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated' } : null, probe)).rejects.toMatchObject({ code: '42501' });
  });

  test('service_role call to app.scheduler_status is rejected: no client role reaches the app schema', async () => {
    await expect(asServiceRole(async (tx) => tx.unsafe('select app.scheduler_status()'))).rejects.toMatchObject({ code: '42501' });
  });

  test('EXECUTE on the two functions is exactly: service_role on the wrapper, no client role on the read', async () => {
    const rows = await withRole('postgres', null, (tx) =>
      tx.unsafe<{ fn: string; role: string; ok: boolean }[]>(
        `select f.fn, r.role, has_function_privilege(r.role, f.fn, 'EXECUTE') as ok
           from unnest(array['public.health_probe()', 'app.scheduler_status()']) as f(fn)
          cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)
          order by f.fn, r.role`,
      ),
    );
    const granted = rows.filter((r) => r.ok).map((r) => `${r.fn} -> ${r.role}`);
    expect(granted).toEqual(['public.health_probe() -> service_role']);
    const [pub] = await withRole('postgres', null, (tx) =>
      tx.unsafe<{ p: boolean }[]>(`select coalesce(bool_or(a.grantee = 0), false) as p from pg_proc f, aclexplode(f.proacl) a where f.oid in ('public.health_probe()'::regprocedure, 'app.scheduler_status()'::regprocedure)`),
    );
    expect(pub?.p, 'PUBLIC holds EXECUTE on one of them').toBe(false);
  });
});

describe('the probe is read-only', () => {
  test('both are STABLE definers with an empty search_path', async () => {
    const rows = await withRole('postgres', null, (tx) =>
      tx.unsafe<{ fn: string; volatility: string; definer: boolean; config: string[] | null }[]>(
        `select n.nspname || '.' || p.proname || '()' as fn, p.provolatile::text as volatility, p.prosecdef as definer, p.proconfig as config
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.oid in ('public.health_probe()'::regprocedure, 'app.scheduler_status()'::regprocedure) order by 1`,
      ),
    );
    expect(rows.map((r) => [r.fn, r.volatility, r.definer, r.config])).toEqual([
      ['app.scheduler_status()', 's', true, ['search_path=""']],
      ['public.health_probe()', 's', true, ['search_path=""']],
    ]);
  });

  test('calling it changes nothing it reads', async () => {
    const counts = async (tx: TransactionSql): Promise<Row> => {
      const [r] = await tx.unsafe<Row[]>(
        `select (select count(*) from public.snapshot_current) as snaps,
                (select count(*) from cron.job_run_details) as runs,
                (select md5(string_agg(jobname || active::text || schedule, ',' order by jobname)) from cron.job) as jobs,
                (select last_snapshot_at::text from app.system_heartbeat where id) as hb`,
      );
      return r as Row;
    };
    const { before, after } = await asServiceRole(async (tx) => {
      await tx.unsafe('reset role');
      const before = await counts(tx);
      await tx.unsafe('set local role service_role');
      await probe(tx);
      await probe(tx);
      await tx.unsafe('reset role');
      return { before, after: await counts(tx) };
    }, freshSnapshot);
    expect(after).toEqual(before);
  });
});

afterAll(async () => {
  await assertScheduledJobsPaused('the end of tests/db/health_probe.test.ts');
});
