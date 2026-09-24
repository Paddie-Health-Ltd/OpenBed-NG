import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * THE QUERIES scripts/readback_public_output.sh RUNS ON HOSTED, RUN HERE AGAINST A
 * REAL SCHEMA (R-2026-09-24-73 BA-2).
 *
 * The script reads each public table as "count:digest", and a hosted apply passes
 * only if every digest is unchanged. tests/compliance/readback_scripts.test.ts
 * proves the script's logic over a psql stub, and a stub cannot say whether the SQL
 * notices a change. This file can. It takes the three Q_ literals out of the script
 * text, so what runs here is exactly what hosted runs, and makes the changes each
 * query must and must not notice, inside a rolled-back transaction.
 *
 * THE CHANGE THAT MATTERS MOST is a no-op UPDATE of a listed facility. It changes
 * nothing but fires the projection, which moves facility_public.updated_at. That is
 * precisely what 020's backfill claims not to do (-71 B1), so the facility_public
 * digest must see it.
 *
 * NOT ASSERTED HERE, deliberately: the hosted answers. This shows only that the
 * queries discriminate; what hosted reads is the founder's run.
 */

const SCRIPT = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'readback_public_output.sh'), 'utf8');

/** A Q_ literal from the script, refused if bash would alter it inside double quotes. */
function query(name: string): string {
  const m = new RegExp(`^Q_${name}="(.*)"$`, 'm').exec(SCRIPT);
  if (m === null) throw new Error(`scripts/readback_public_output.sh carries no Q_${name}= line`);
  const q = m[1]!;
  expect(q, `Q_${name} holds a character bash expands inside double quotes, so hosted would run other SQL than this test`).not.toMatch(/[$`"\\](?!n')/);
  return q;
}

const Q = {
  facility_public: query('FACILITY_PUBLIC'),
  ward_public: query('WARD_PUBLIC'),
  lga_rollup: query('LGA_ROLLUP'),
};

async function read(tx: TransactionSql, table: keyof typeof Q): Promise<string> {
  const rows = await tx.unsafe(Q[table]);
  return String(Object.values(rows[0]!)[0]);
}

describe('scripts/readback_public_output.sh — its queries, against the real schema', () => {
  test('real queries are accepted — each answers a count and a 12-digit digest', async () => {
    const answers = await withRole('postgres', null, async (tx) => Promise.all((Object.keys(Q) as (keyof typeof Q)[]).map((t) => read(tx, t))));
    for (const a of answers) expect(a).toMatch(/^[0-9]+:[0-9a-f]{12}$/);
  });

  test('plant — a no-op UPDATE of a listed facility fires the projection, and the facility_public digest sees it', async () => {
    const [was, is] = await withRole('postgres', null, async (tx) => {
      const [f] = await tx`select facility_id from public.facility_public order by facility_id limit 1`;
      expect(f, 'the seed projects no facility, so this plant has nothing to move').toBeDefined();
      const before = await read(tx, 'facility_public');
      const moved = await tx`update app.facility set name = name where id = ${f!['facility_id']} returning id`;
      expect(moved.length, 'the plant updated no facility').toBe(1);
      return [before, await read(tx, 'facility_public')];
    });
    expect(was.split(':')[0], 'the plant changed the row count, so it does not isolate updated_at').toBe(is.split(':')[0]);
    expect(is).not.toBe(was);
  });

  test('plant — a changed ward_public row changes the ward_public digest', async () => {
    const [was, is] = await withRole('postgres', null, async (tx) => {
      const before = await read(tx, 'ward_public');
      const moved = await tx`update public.ward_public set updated_at = updated_at - interval '1 day' where ctid = (select ctid from public.ward_public limit 1) returning 1`;
      expect(moved.length, 'the seed projects no ward, so this plant has nothing to move').toBe(1);
      return [before, await read(tx, 'ward_public')];
    });
    expect(is).not.toBe(was);
  });

  test('plant — lga_rollup: a new row and a changed total are seen, and updated_at alone is not', async () => {
    const [afterInsert, afterTouch, afterTotal] = await withRole('postgres', null, async (tx) => {
      const before = await read(tx, 'lga_rollup');
      await tx`insert into public.lga_rollup (state, lga, category, facility_count, total_beds) values ('Readback', 'Readback-LGA', 'MATERNITY', 5, 10)`;
      const inserted = await read(tx, 'lga_rollup');
      expect(inserted, 'a new rollup row was not seen').not.toBe(before);
      await tx`update public.lga_rollup set updated_at = updated_at + interval '1 hour' where lga = 'Readback-LGA'`;
      const touched = await read(tx, 'lga_rollup');
      await tx`update public.lga_rollup set total_beds = 11 where lga = 'Readback-LGA'`;
      return [inserted, touched, await read(tx, 'lga_rollup')];
    });
    expect(afterTouch, 'the five-minute refresh rewriting updated_at would read as a change').toBe(afterInsert);
    expect(afterTotal, 'a changed total was not seen').not.toBe(afterTouch);
  });
});
