import { describe, expect, test } from 'vitest';
import { withRole } from '../setup/db.js';
import { rollupPublishable, K_FLOOR, MAX_FACILITY_SHARE } from '../../packages/gate/src/rollup.js';
import type { TransactionSql } from 'postgres';

/**
 * THE LGA ROLLUP K-FLOOR -- and, like the gate, a rule implemented twice.
 *
 * SQL: app.refresh_lga_rollup() (migration 009).
 * TypeScript: rollupPublishable() (packages/gate/src/rollup.ts).
 *
 * Every case below is asserted against BOTH inside one `test.each` block, for the
 * same reason the gate truth table is: two blocks could drift while both stayed
 * green.
 *
 * THE `sum = 0` CASE IS THE POINT OF THIS FILE.
 *
 * With the obvious single-conjunction formulation --
 * `count >= 5 && max / total <= 0.40` -- an all-zero cell makes Postgres THROW
 * `division_by_zero` and JavaScript return `NaN`, and `NaN <= 0.40` is `false`.
 * So SQL takes the whole refresh down while the mirror silently suppresses the
 * cell: two layers disagreeing, in opposite directions, neither reporting a
 * problem. It is the same shape as the tri-state bug.
 *
 * The ordered branch in both implementations is what closes it, and this test is
 * what proves the branch is still ordered.
 */

interface Case {
  name: string;
  beds: number[];
  lga: string;
  expected: boolean;
  why: string;
}

const CASES: Case[] = [
  {
    name: 'below the k-floor',
    beds: [2, 2, 2, 2],
    lga: 'KFloorFour',
    expected: false,
    why: '4 facilities is fewer than the k-floor of 5',
  },
  {
    name: 'exactly at the k-floor',
    beds: [3, 3, 3, 3, 3],
    lga: 'KFloorFive',
    expected: true,
    why: '5 facilities, evenly balanced at 20% each',
  },
  {
    name: 'all-zero cell PUBLISHES and never divides',
    beds: [0, 0, 0, 0, 0],
    lga: 'KFloorZero',
    expected: true,
    why: 'sum = 0 is answered before the ratio is reached; SQL must not raise and TS must not return NaN',
  },
  {
    name: 'one facility dominates',
    beds: [50, 2, 2, 2, 2],
    lga: 'KFloorDominant',
    expected: false,
    why: '50/58 is about 86%, far over the 40% ceiling',
  },
  {
    name: 'exactly at the 40% boundary',
    beds: [8, 3, 3, 3, 3],
    lga: 'KFloorEdge',
    expected: true,
    why: '8/20 is exactly 40%, and the rule is <=, so it publishes',
  },
  {
    name: 'a hair over the 40% boundary',
    beds: [9, 3, 3, 3, 3],
    lga: 'KFloorOver',
    expected: false,
    why: '9/21 is about 43%',
  },
];

async function seedCell(tx: TransactionSql, lga: string, beds: number[]): Promise<void> {
  for (const [i, count] of beds.entries()) {
    const rows = await tx.unsafe<{ id: string }[]>(`
      insert into app.facility (name, lga, state, lat, lng, public_phone_e164, quiet_mode)
      values ('K ${lga} ${i}', '${lga}', 'Lagos', 6.6, 3.35, '+2348000000095', true)
      returning id
    `);
    await tx.unsafe(`
      insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
      values ('${rows[0]?.id}', 'ICU_ADULT', 'OFFERED', ${count}, true, 'ACTIVE')
    `);
  }
}

describe('lga_rollup k-floor', () => {
  test.each(CASES)('$name — $why', async (c) => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`select app.refresh_lga_rollup()`);
      const rows = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public.lga_rollup where lga = '${c.lga}'`,
      );
      const sqlPublished = (rows[0]?.n ?? 0) > 0;

      const total = c.beds.reduce((a, b) => a + b, 0);
      const tsPublished = rollupPublishable({
        facilityCount: c.beds.length,
        totalBeds: total,
        maxFacilityBeds: Math.max(...c.beds),
      });

      expect(sqlPublished, 'SQL refresh_lga_rollup disagreed with the expectation').toBe(c.expected);
      expect(tsPublished, 'TypeScript rollupPublishable disagreed with the expectation').toBe(c.expected);
    }, (tx) => seedCell(tx, c.lga, c.beds));
  });

  test('the all-zero cell is published with total_beds = 0, not omitted', async () => {
    // Stronger than "a row exists": the row must carry the zero, because the
    // clinically useful statement is "nothing available across this LGA".
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`select app.refresh_lga_rollup()`);
      const rows = await tx.unsafe<{ facility_count: number; total_beds: number }[]>(
        `select facility_count, total_beds from public.lga_rollup where lga = 'ZeroCell'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0]?.facility_count).toBe(5);
      expect(rows[0]?.total_beds).toBe(0);
    }, (tx) => seedCell(tx, 'ZeroCell', [0, 0, 0, 0, 0]));
  });

  test('a visible facility never contributes to the rollup', async () => {
    // A rollup mixing quiet and visible facilities would let an attacker subtract
    // the visible ones -- whose exact counts are published in ward_public -- and
    // recover the quiet one. Quiet mode would be theatre.
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`select app.refresh_lga_rollup()`);
      const rows = await tx.unsafe<{ total_beds: number }[]>(
        `select total_beds from public.lga_rollup where lga = 'MixedCell'`,
      );
      // Five quiet facilities at 3 beds each = 15. The visible one's 400 must not
      // appear, and its presence must not be inferable from the total.
      // (400 rather than a rounder 999 because app.ward_status caps bed_count at
      // 500 as a typo guard -- which rejected the first draft of this fixture.)
      expect(rows[0]?.total_beds).toBe(15);
    }, async (tx) => {
      await seedCell(tx, 'MixedCell', [3, 3, 3, 3, 3]);
      const vis = await tx.unsafe<{ id: string }[]>(`
        insert into app.facility (name, lga, state, lat, lng, public_phone_e164, quiet_mode)
        values ('Visible In Mixed', 'MixedCell', 'Lagos', 6.6, 3.35, '+2348000000094', false)
        returning id
      `);
      await tx.unsafe(`
        insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
        values ('${vis[0]?.id}', 'ICU_ADULT', 'OFFERED', 400, true, 'ACTIVE')
      `);
    });
  });

  test('the shared constants match the values the SQL hard-codes', () => {
    // If someone changes the floor in 009 and not here, the two implementations
    // diverge silently for every cell of exactly 5 facilities. Cheap to assert.
    expect(K_FLOOR).toBe(5);
    expect(MAX_FACILITY_SHARE).toBe(0.4);
  });
});
