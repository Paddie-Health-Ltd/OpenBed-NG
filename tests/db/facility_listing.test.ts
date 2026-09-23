import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * AN UNLISTED FACILITY REACHES NO PUBLIC OUTPUT — NOT THE MIRRORS, AND NOT THE ROLLUP
 * (R-2026-09-23-71 B, migration 020).
 *
 * `app.facility.listed_at` NULL means unlisted: a facility still being onboarded. It
 * is a SEPARATE state from `quiet_mode`, and the reason is the rollup. A quiet
 * facility writes no mirror row but DOES feed public.lga_rollup. So an onboarding
 * facility started quiet would enter a public aggregate with a count of 0 from wards
 * that never reported, and would count toward the k=5 floor, letting a cell clear k
 * with fewer real reporters.
 *
 * THE SITES, enumerated from the live schema rather than assumed. Exactly two SQL
 * predicates decide which facilities reach public output, and both now require
 * `listed_at IS NOT NULL`:
 *   - app.project_facility() (008, restated in 020): the only writer of
 *     public.facility_public and public.ward_public;
 *   - app.refresh_lga_rollup() (017, restated in 020): the only writer of
 *     public.lga_rollup.
 * app.regenerate_snapshot() (019) reads only the mirrors, so it inherits the first.
 *
 * THE ROLLUP LEG USES THE CASE THE RULING NAMES. Four listed quiet facilities and
 * the facility under test share one LGA. The cell clears k=5 only if the facility
 * under test is counted, so a rollup row appearing IS the unlisted facility being
 * counted toward the floor.
 *
 * EACH PREDICATE IS PLANTED AWAY IN TURN. The site's statement is taken from 020's
 * text, the predicate removed, and the result applied inside a rolled-back
 * transaction. The leak must appear. Each plant first confirms its needle was in
 * the statement, so a plant that changed nothing cannot pass as a guard with a hole.
 */

const MIG = join(import.meta.dirname, '..', '..', 'database', 'migrations', '020_operator_functions_and_listing.sql');
const LGA = 'Listing-Under-Test';
const FAC = 'eeeeeeee-0000-4000-8000-000000000020';
const PEERS = [1, 2, 3, 4].map((n) => `eeeeeeee-0000-4000-8000-00000000002${n}`);
const PREDICATE = 'AND f.listed_at IS NOT NULL';

/** The complete CREATE OR REPLACE statement for one function, as 020 writes it. */
function statementFor(fn: string): string {
  const text = readFileSync(MIG, 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`020 carries no CREATE OR REPLACE for ${fn}`);
  return m[0];
}

async function seed(tx: TransactionSql, listed: boolean, quiet: boolean): Promise<void> {
  // Four listed QUIET peers: the rollup cell stays below k=5 unless the facility
  // under test is counted.
  for (const [i, id] of PEERS.entries()) {
    await tx.unsafe(`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode, listed_at)
      values ('${id}', 'Peer ${i + 1}', '${LGA}', 'Lagos', 6.5, 3.4, '+23480000001${i}0', true, now())`);
    await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, bed_count) values ('${id}', 'ICU_ADULT', 'OFFERED', 2)`);
  }
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode, listed_at)
    values ('${FAC}', 'Under Test', '${LGA}', 'Lagos', 6.5, 3.4, '+2348000000200', ${quiet}, ${listed ? 'now()' : 'NULL'})`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, bed_count) values ('${FAC}', 'ICU_ADULT', 'OFFERED', 2)`);
}

async function publicRows(tx: TransactionSql): Promise<{ facility: number; ward: number; rollup: number }> {
  await tx.unsafe('select app.refresh_lga_rollup()');
  const [f] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.facility_public where facility_id = '${FAC}'`);
  const [w] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.ward_public where facility_id = '${FAC}'`);
  const [r] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.lga_rollup where lga = '${LGA}'`);
  return { facility: f?.n ?? -1, ward: w?.n ?? -1, rollup: r?.n ?? -1 };
}

describe('listing: an unlisted facility reaches no public output', () => {
  test.each([
    // listed, quiet -> mirrors, rollup
    [false, false, { facility: 0, ward: 0, rollup: 0 }],
    [false, true, { facility: 0, ward: 0, rollup: 0 }],
    [true, false, { facility: 1, ward: 1, rollup: 0 }],
    [true, true, { facility: 0, ward: 0, rollup: 1 }],
  ])('listed=%s quiet=%s — mirrors and rollup are exactly as listing and quiet mode say', async (listed, quiet, expected) => {
    await withRole('postgres', null, async (tx) => {
      expect(await publicRows(tx)).toEqual(expected);
    }, (tx) => seed(tx, listed, quiet));
  });

  test('the positive control — the listed quiet case really does clear k=5, so the rollup legs can see a fifth facility', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe('select app.refresh_lga_rollup()');
      const [row] = await tx.unsafe<{ facility_count: number }[]>(`select facility_count from public.lga_rollup where lga = '${LGA}'`);
      expect(row?.facility_count).toBe(5);
    }, (tx) => seed(tx, true, true));
  });

  test.each([
    ['app.project_facility', false, false, 'ward'],
    ['app.refresh_lga_rollup', false, true, 'rollup'],
  ] as const)('plant — %s without its listing predicate leaks the unlisted facility', async (fn, listed, quiet, leak) => {
    const statement = statementFor(fn);
    expect(statement, `the predicate is not in 020's ${fn}, so this plant would change nothing`).toContain(PREDICATE);
    const planted = statement.replace(PREDICATE, '');
    expect(planted).not.toBe(statement);
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(planted);
      // The facility was inserted before the plant; re-project it through the
      // planted body so the mirror half is exercised.
      await tx.unsafe(`select app.project_facility('${FAC}')`);
      const rows = await publicRows(tx);
      expect(rows[leak], `${fn} without its predicate did not leak — the plant did not reach the executed path`).toBeGreaterThan(0);
    }, (tx) => seed(tx, listed, quiet));
  });

  test('listing a facility publishes it in the same transaction, and quiet mode stays orthogonal', async () => {
    await withRole('postgres', null, async (tx) => {
      expect((await publicRows(tx)).ward).toBe(0);
      await tx.unsafe(`update app.facility set listed_at = now() where id = '${FAC}'`);
      expect((await publicRows(tx)).ward).toBe(1);
      await tx.unsafe(`update app.facility set quiet_mode = true where id = '${FAC}'`);
      expect(await publicRows(tx)).toEqual({ facility: 0, ward: 0, rollup: 1 });
    }, (tx) => seed(tx, false, false));
  });
});
