import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 028 ADDS ONE FUNCTION AND NOTHING ELSE, AND ITS REVERSAL REMOVES IT
 * (R-2026-09-30-175 EY-2), in the idiom of tests/db/migration_027_round_trip.test.ts.
 *
 * The state compared is what 028 makes and nothing more: whether the function exists, a
 * digest of its definition and ACL, who may execute it (has_function_privilege, which
 * counts PUBLIC), and the ledger row.
 *   - in 028: the function, authenticated alone holding EXECUTE, one ledger row;
 *   - after the down: no function, no grant, no ledger row -- 027's state exactly, with
 *     app.scheduler_status() and public.health_probe() still there;
 *   - down, up, up: the 028 state, identically;
 *   - down twice: the second is a no-op, not an error.
 *
 * THE PLANT. The forward text with its REVOKE ... FROM PUBLIC removed leaves EXECUTE with
 * PUBLIC, so anon, authenticated and service_role all read as able to execute, which is the
 * state EY-1's correction is about. It is applied over the down inside the rolled-back
 * transaction, and the leg first asserts the text CHANGED and that the removed statement is
 * the one under test.
 *
 * NOT ASSERTED HERE, deliberately: that the down leaves pg_cron untouched by comparing the
 * cron schema. 028 schedules, alters and unschedules nothing (its header says so).
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION, with every migration above 028
 * reversed first (none exists today; the list is derived so the leg holds when one does).
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const LEDGER = '028_operator_scheduler_status.sql';
const FORWARD = join(MIG_DIR, LEDGER);
const DOWN = join(MIG_DIR, '028_operator_scheduler_status.down.sql');

async function apply(tx: TransactionSql, path: string, text?: string): Promise<void> {
  await tx.unsafe(text ?? readFileSync(path, 'utf8'));
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
  kept: string[];
}

async function state(tx: TransactionSql): Promise<State> {
  const fns = await tx.unsafe<{ fn: string; def: string; acl: string | null }[]>(`
    select n.nspname || '.' || p.proname || '()' as fn, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) = ('public', 'operator_scheduler_status')
     order by 1`);
  const exec = await tx.unsafe<{ fn: string; role: string }[]>(`
    select n.nspname || '.' || p.proname || '()' as fn, r.role
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)
     where (n.nspname, p.proname) = ('public', 'operator_scheduler_status')
       and has_function_privilege(r.role, p.oid, 'EXECUTE')
     order by 1, 2`);
  const kept = await tx.unsafe<{ fn: string }[]>(`
    select n.nspname || '.' || p.proname || '()' as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (('public', 'health_probe'), ('app', 'scheduler_status'))
     order by 1`);
  const [m] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  const digest = fns.length === 0 ? null : (await tx.unsafe<{ d: string }[]>('select md5($1) as d', [fns.map((f) => `${f.fn}${f.def}${f.acl ?? ''}`).join('|')] as never[]))[0]?.d ?? null;
  return {
    functions: fns.map((f) => f.fn),
    digest,
    executable: exec.map((e) => `${e.fn} -> ${e.role}`),
    ledger: m?.n ?? -1,
    kept: kept.map((k) => k.fn),
  };
}

const IN_028: Omit<State, 'digest'> = {
  functions: ['public.operator_scheduler_status()'],
  executable: ['public.operator_scheduler_status() -> authenticated'],
  ledger: 1,
  kept: ['app.scheduler_status()', 'public.health_probe()'],
};
const IN_027: State = { functions: [], digest: null, executable: [], ledger: 0, kept: IN_028.kept };

describe('migration 028 round trip', () => {
  test('the database starts in the 028 state: the function, authenticated alone able to execute it, one ledger row', async () => {
    const s = await inTx(state);
    expect({ ...s, digest: undefined }).toEqual({ ...IN_028, digest: undefined });
    expect(s.digest).not.toBeNull();
  });

  test('down removes the function, its grant and the ledger row, and leaves 027 as it was: the 027 state', async () => {
    expect(
      await inTx(async (tx) => {
        await apply(tx, DOWN);
        return state(tx);
      }),
    ).toEqual(IN_027);
  });

  test('down twice is a no-op, not an error', async () => {
    expect(
      await inTx(async (tx) => {
        await apply(tx, DOWN);
        await apply(tx, DOWN);
        return state(tx);
      }),
    ).toEqual(IN_027);
  });

  test('up, down, up returns the 028 state with the SAME definition and ACL', async () => {
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

  test('plant — the forward with its REVOKE ... FROM PUBLIC removed leaves all three roles able to execute, and is rejected', async () => {
    const original = readFileSync(FORWARD, 'utf8');
    const needle = "EXECUTE 'REVOKE ALL ON FUNCTION public.operator_scheduler_status() FROM PUBLIC';";
    expect(original.split(needle).length - 1, 'the statement under test is not exactly once in the forward').toBe(1);
    const planted = original.replace(needle, 'NULL;');
    expect(planted, 'the plant did not change the text').not.toBe(original);
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      await apply(tx, FORWARD, planted);
      return state(tx);
    });
    expect(s.executable, 'the plant did not reach the executed grant path').toEqual([
      'public.operator_scheduler_status() -> anon',
      'public.operator_scheduler_status() -> authenticated',
      'public.operator_scheduler_status() -> service_role',
    ]);
    expect(s.executable, 'a forward missing its PUBLIC revoke reads as the real 028 state').not.toEqual(IN_028.executable);
  });
});
