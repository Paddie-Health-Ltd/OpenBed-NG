import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * A WITHDRAWN AGREEMENT TAKES A FACILITY OFF THE PUBLIC OUTPUT BY ITSELF
 * (R-2026-09-24-82 BJ-1, migration 021).
 *
 * A withdrawn data-sharing agreement ends the basis for publishing the facility's
 * data, so its removal must not wait for someone to remember to unlist it. Setting
 * app.facility_agreement.withdrawn_on is enough: the mirrors drop the facility in the
 * same transaction, and the rollup stops counting it at its next refresh.
 *
 * THE SITES, enumerated from the live catalogue on 2026-09-24 (every function in app,
 * public and graphql_public whose source reads listed_at or names a mirror; no view
 * and no materialized view exists). Exactly two decide which facilities reach public
 * output, and both gain `no withdrawn agreement`:
 *   - app.project_facility(): the only writer of public.facility_public and
 *     public.ward_public;
 *   - app.refresh_lga_rollup(): the only writer of public.lga_rollup.
 * app.regenerate_snapshot() and publish_ward_status read the mirrors only, so they
 * inherit the first. operator_create_facility, operator_register and
 * operator_set_facility_listed read listed_at for the operator, not for the public.
 *
 * THE MIRRORS MOVE IN THE SAME TRANSACTION because 021 puts a trigger on
 * app.facility_agreement that calls 008's app.trg_project() -- the same projection
 * path the other three tables use, not a second one. No leg here calls
 * app.project_facility() itself after the withdrawal.
 *
 * THE ROLLUP LEG USES THE K-FLOOR, as tests/db/facility_listing.test.ts does. Four
 * listed quiet peers and the facility under test share one LGA, so the cell clears
 * k=5 only while the facility under test is counted. The cell disappearing after the
 * withdrawal IS the facility no longer contributing.
 *
 * EACH SITE IS PLANTED AWAY IN TURN, from 021's own text, inside a rolled-back
 * transaction, and the leak must appear. So is the trigger. Each plant first confirms
 * its needle was in the statement, so a plant that changed nothing cannot pass as a
 * guard with a hole.
 *
 * NOT ASSERTED HERE, deliberately: how long the page takes to follow. The mirrors move
 * at once; the snapshot (every minute), the edge cache and the page's poll add about
 * two minutes (020's B2). That path is outside the database and is read back with
 * /beds.json in the withdrawal step, not here.
 */

const MIG = join(import.meta.dirname, '..', '..', 'database', 'migrations', '021_facility_agreement_and_contact_write.sql');
const LGA = 'Withdrawal-Under-Test';
const FAC = 'eeeeeeee-0000-4000-8000-000000000021';
const PEERS = [1, 2, 3, 4].map((n) => `eeeeeeee-0000-4000-8000-00000000003${n}`);
const PREDICATE = 'AND NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NOT NULL)';
const WITHDRAW = `update app.facility_agreement set withdrawn_on = '2026-09-10' where facility_id = '${FAC}'`;

/** The complete CREATE OR REPLACE statement for one function, as 021 writes it. */
function statementFor(fn: string): string {
  const text = readFileSync(MIG, 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`021 carries no CREATE OR REPLACE for ${fn}`);
  return m[0];
}

/** Four listed quiet peers and the facility under test, all listed, each with an agreement. */
async function seed(tx: TransactionSql, quiet: boolean): Promise<void> {
  for (const [i, id] of PEERS.entries()) {
    await tx.unsafe(`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode, listed_at)
      values ('${id}', 'Peer ${i + 1}', '${LGA}', 'Lagos', 6.5, 3.4, '+23480000003${i}0', true, now())`);
    await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, bed_count) values ('${id}', 'ICU_ADULT', 'OFFERED', 2)`);
    await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${id}', '2026-09-01', 'v1.0')`);
  }
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode, listed_at)
    values ('${FAC}', 'Under Test', '${LGA}', 'Lagos', 6.5, 3.4, '+2348000000210', ${quiet}, now())`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, bed_count) values ('${FAC}', 'ICU_ADULT', 'OFFERED', 2)`);
  await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
}

/** The mirror rows for the facility under test, read as they stand: nothing re-projects here. */
async function mirrorRows(tx: TransactionSql): Promise<{ facility: number; ward: number }> {
  const [f] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.facility_public where facility_id = '${FAC}'`);
  const [w] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.ward_public where facility_id = '${FAC}'`);
  return { facility: f?.n ?? -1, ward: w?.n ?? -1 };
}

/** The test LGA's rollup cells after a refresh. */
async function rollupCells(tx: TransactionSql): Promise<number[]> {
  await tx.unsafe('select app.refresh_lga_rollup()');
  const rows = await tx.unsafe<{ facility_count: number }[]>(`select facility_count from public.lga_rollup where lga = '${LGA}'`);
  return rows.map((r) => r.facility_count);
}

describe('withdrawal: a withdrawn agreement reaches no public output', () => {
  test('mirrors — a listed facility with a published ward is public, and the withdrawal UPDATE alone removes it in the same transaction', async () => {
    await withRole('postgres', null, async (tx) => {
      expect(await mirrorRows(tx), 'the facility under test was never public, so its removal would prove nothing').toEqual({ facility: 1, ward: 1 });
      await tx.unsafe(WITHDRAW);
      expect(await mirrorRows(tx), 'a withdrawn agreement left the facility in the public mirrors').toEqual({ facility: 0, ward: 0 });
    }, (tx) => seed(tx, false));
  });

  test('rollup — the facility is the fifth of five, so the cell exists before the withdrawal and not after', async () => {
    await withRole('postgres', null, async (tx) => {
      expect(await rollupCells(tx), 'the positive control: the cell clears k=5 with the facility under test counted').toEqual([5]);
      await tx.unsafe(WITHDRAW);
      expect(await rollupCells(tx), 'a withdrawn facility still counts toward a public rollup cell').toEqual([]);
    }, (tx) => seed(tx, true));
  });

  test('a facility with no agreement row at all is unaffected — the predicate is "no withdrawn agreement", not "has one"', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`delete from app.facility_agreement where facility_id = '${FAC}'`);
      expect(await mirrorRows(tx)).toEqual({ facility: 1, ward: 1 });
    }, (tx) => seed(tx, false));
  });

  test.each([
    ['app.project_facility', false],
    ['app.refresh_lga_rollup', true],
  ] as const)('plant — %s without its withdrawal predicate leaks the withdrawn facility', async (fn, quiet) => {
    const statement = statementFor(fn);
    expect(statement, `the predicate is not in 021's ${fn}, so this plant would change nothing`).toContain(PREDICATE);
    const planted = statement.replace(PREDICATE, '');
    expect(planted).not.toBe(statement);
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(planted);
      await tx.unsafe(WITHDRAW);
      const leaked = quiet ? (await rollupCells(tx)).length : (await mirrorRows(tx)).ward;
      expect(leaked, `${fn} without its predicate did not leak — the plant did not reach the executed path`).toBeGreaterThan(0);
    }, (tx) => seed(tx, quiet));
  });

  test('plant — without the agreement trigger, the withdrawal leaves the mirrors untouched in its transaction', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe('drop trigger trg_facility_agreement_project on app.facility_agreement');
      await tx.unsafe(WITHDRAW);
      expect((await mirrorRows(tx)).ward, 'the mirrors moved without the trigger, so the trigger is not what moves them').toBe(1);
    }, (tx) => seed(tx, false));
  });
});
