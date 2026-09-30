import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 027 ADDS TWO FUNCTIONS AND NOTHING ELSE, AND ITS REVERSAL REMOVES THEM
 * (R-2026-09-29-173 EW-1 e), in the idiom of tests/db/migration_025_round_trip.test.ts.
 *
 * The state compared is what 027 makes and nothing more: whether each function exists,
 * a digest of its definition and ACL, who may execute it, and the ledger row.
 *   - in 027: both functions, service_role holding EXECUTE on the wrapper alone, one ledger row;
 *   - after the down: neither function, no grant, no ledger row -- 026's state exactly;
 *   - down, up, up: the 027 state, identically: CREATE OR REPLACE leaves one definition,
 *     the revoke loops are repeatable, and the ledger insert adds no second row;
 *   - down twice: the second is a no-op, not an error.
 *
 * NOT ASSERTED HERE, deliberately: that the down leaves pg_cron untouched by comparing the
 * cron schema. 027 schedules, alters and unschedules nothing (its header says so), and
 * tests/db/health_probe.test.ts asserts that calling the probe changes no cron row.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION, with every migration above 027
 * reversed first (none exists today; the list is derived so the leg holds when one does).
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const LEDGER = '027_scheduler_status.sql';
const FORWARD = join(MIG_DIR, LEDGER);
const DOWN = join(MIG_DIR, '027_scheduler_status.down.sql');

async function apply(tx: TransactionSql, path: string): Promise<void> {
  await tx.unsafe(readFileSync(path, 'utf8'));
}

const LATER = readdirSync(MIG_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql') && f > LEDGER).sort();

const inTx = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> =>
  withRole('postgres', null, async (tx) => {
    for (const f of LATER.slice().reverse()) await apply(tx, join(MIG_DIR, f.replace(/\.sql$/, '.down.sql')));
    return fn(tx);
  });

interface State {
  functions: string[];
  digest: string | null;
  executable: string[];
  ledger: number;
}

async function state(tx: TransactionSql): Promise<State> {
  const fns = await tx.unsafe<{ fn: string; def: string; acl: string | null }[]>(`
    select n.nspname || '.' || p.proname || '()' as fn, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (('public', 'health_probe'), ('app', 'scheduler_status'))
     order by 1`);
  const exec = await tx.unsafe<{ fn: string; role: string }[]>(`
    select n.nspname || '.' || p.proname || '()' as fn, r.role
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)
     where (n.nspname, p.proname) in (('public', 'health_probe'), ('app', 'scheduler_status'))
       and has_function_privilege(r.role, p.oid, 'EXECUTE')
     order by 1, 2`);
  const [m] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  const digest = fns.length === 0 ? null : (await tx.unsafe<{ d: string }[]>('select md5($1) as d', [fns.map((f) => `${f.fn}${f.def}${f.acl ?? ''}`).join('|')] as never[]))[0]?.d ?? null;
  return { functions: fns.map((f) => f.fn), digest, executable: exec.map((e) => `${e.fn} -> ${e.role}`), ledger: m?.n ?? -1 };
}

const IN_027: Omit<State, 'digest'> = {
  functions: ['app.scheduler_status()', 'public.health_probe()'],
  executable: ['public.health_probe() -> service_role'],
  ledger: 1,
};

describe('migration 027 round trip', () => {
  test('the database starts in the 027 state: both functions, service_role on the wrapper alone, one ledger row', async () => {
    const s = await inTx(state);
    expect({ ...s, digest: undefined }).toEqual({ ...IN_027, digest: undefined });
    expect(s.digest).not.toBeNull();
  });

  test('down removes both functions, every grant and the ledger row: the 026 state', async () => {
    expect(
      await inTx(async (tx) => {
        await apply(tx, DOWN);
        return state(tx);
      }),
    ).toEqual({ functions: [], digest: null, executable: [], ledger: 0 });
  });

  test('down twice is a no-op, not an error', async () => {
    expect(
      await inTx(async (tx) => {
        await apply(tx, DOWN);
        await apply(tx, DOWN);
        return state(tx);
      }),
    ).toEqual({ functions: [], digest: null, executable: [], ledger: 0 });
  });

  test('up, down, up returns the 027 state with the SAME definitions and ACLs', async () => {
    const [start, after] = await inTx(async (tx) => {
      const start = await state(tx);
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return [start, await state(tx)] as const;
    });
    expect(after).toEqual(start);
    expect(after.ledger).toBe(1);
  });
});
