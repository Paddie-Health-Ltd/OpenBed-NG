import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { sql, withRole } from '../setup/db.js';

/**
 * MIGRATION 025 ADDS ONE ENUM VALUE, AND ITS REVERSAL SAYS THE VALUE STAYS
 * (R-2026-09-27-144 DT, 025), in the idiom of tests/db/migration_024_round_trip.test.ts.
 *
 * PostgreSQL cannot drop an enum value, so 025's down file removes only its ledger
 * row and refuses while any row holds the role. The state compared is therefore the
 * number of 'FACILITY_REPORTER' labels on app.app_role and the ledger row:
 *   - in 025: one label, one ledger row;
 *   - after the down: STILL one label, no ledger row;
 *   - down, up, up: one label -- ADD VALUE IF NOT EXISTS adds no second -- and one
 *     ledger row.
 *
 * THE PREMISE THE SPLIT RESTS ON is asserted too, on a scratch enum type in this
 * session's temporary schema: in one transaction, a value added and then used is
 * refused 55P04 ("unsafe use of new value"), and the same two steps in two
 * transactions succeed. That is PostgreSQL's rule, which is why 025 holds the value
 * alone and 026 -- applied by scripts/run_migrations.sh as the next file, in its own
 * transaction -- holds everything that names it. The leg proves the rule, not 025's
 * bytes; the one-off reading of 025 and 026 concatenated into one transaction is
 * quoted in 025's header.
 *
 * EVERY STATE LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION, with every migration above
 * 025 reversed first.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const LEDGER = '025_facility_reporter_role.sql';
const FORWARD = join(MIG_DIR, LEDGER);
const DOWN = join(MIG_DIR, '025_facility_reporter_role.down.sql');

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
  labels: number;
  ledger: number;
}

async function state(tx: TransactionSql): Promise<State> {
  const [l] = await tx.unsafe<{ n: number }[]>(`
    select count(*)::int as n from pg_enum e
     where e.enumtypid = 'app.app_role'::regtype and e.enumlabel = 'FACILITY_REPORTER'`);
  const [m] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return { labels: l?.n ?? -1, ledger: m?.n ?? -1 };
}

describe('migration 025 round trip', () => {
  test('the database starts in the 025 state: one FACILITY_REPORTER label, one ledger row', async () => {
    expect(await inTx(state)).toEqual({ labels: 1, ledger: 1 });
  });

  test('down removes the ledger row and says the value stays — PostgreSQL cannot drop an enum value', async () => {
    expect(await inTx(async (tx) => {
      await apply(tx, DOWN);
      return state(tx);
    })).toEqual({ labels: 1, ledger: 0 });
  });

  test('up, down, up leaves exactly one FACILITY_REPORTER label and one ledger row', async () => {
    expect(await inTx(async (tx) => {
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return state(tx);
    })).toEqual({ labels: 1, ledger: 1 });
  });

  test('the down REFUSES while a row holds the role, and changes nothing', async () => {
    // Over 026, not with it reversed: 003's three-arm CHECK, which 026's down
    // restores, would refuse the row this plants.
    const r = await withRole('postgres', null, async (tx) => {
      const [f] = await tx.unsafe<{ id: string }[]>(`
        select f.id::text as id from app.facility f
         where not exists (select 1 from app.ward_account u where u.facility_id = f.id and u.is_active)
         order by 1 limit 1`);
      if (f === undefined) throw new Error('precondition: no seeded facility without an active login -- run db:reset');
      await tx.unsafe(`insert into app.ward_account (id, facility_id, role) values (gen_random_uuid(), $1, 'FACILITY_REPORTER')`, [f.id] as never[]);
      await tx.unsafe('savepoint before_down');
      let message = '';
      try {
        await apply(tx, DOWN);
      } catch (e) {
        message = (e as { message: string }).message;
      }
      await tx.unsafe('rollback to savepoint before_down');
      return { message, after: await state(tx) };
    });
    expect(r.message).toBe('FACILITY_REPORTER_IN_USE');
    expect(r.after).toEqual({ labels: 1, ledger: 1 });
  });
});

describe('the premise the 025/026 split rests on: a new enum value cannot be used in the transaction that added it', () => {
  test('in one transaction the use is refused 55P04 "unsafe use of new value"; in two transactions it succeeds', async () => {
    const db = sql();
    await db.unsafe(`create type pg_temp.scratch_enum_025 as enum ('a')`);
    try {
      let refused: { code?: string; message?: string } = {};
      const sentinel = new Error('rollback');
      try {
        await db.begin(async (tx) => {
          await tx.unsafe(`alter type pg_temp.scratch_enum_025 add value 'b'`);
          try {
            await tx.savepoint((sp) => sp.unsafe(`select 'b'::pg_temp.scratch_enum_025`));
          } catch (e) {
            refused = e as { code?: string; message?: string };
          }
          throw sentinel;
        });
      } catch (e) {
        if (e !== sentinel) throw e;
      }
      expect(refused.code, JSON.stringify(refused)).toBe('55P04');
      expect(refused.message).toContain('unsafe use of new value "b"');

      await db.begin((tx) => tx.unsafe(`alter type pg_temp.scratch_enum_025 add value 'b'`));
      const [used] = await db.begin((tx) => tx.unsafe<{ v: string }[]>(`select 'b'::pg_temp.scratch_enum_025::text as v`));
      expect(used?.v, 'the split did not let the committed value be used').toBe('b');
    } finally {
      await db.unsafe('drop type if exists pg_temp.scratch_enum_025');
    }
  });
});
