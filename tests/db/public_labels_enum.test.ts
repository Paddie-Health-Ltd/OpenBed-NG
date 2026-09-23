import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { sql, withRole } from '../setup/db.js';
import TABLE from '../../packages/labels/public-labels.json';

/**
 * THE PUBLIC LABEL TABLE AGAINST THE CATALOGUE (R-2026-09-23-68 C2), and the state
 * machine "not offered at this facility" rests on.
 *
 * The second derivation of tests/compliance/public_labels.test.ts, which reads the
 * migrations as text. This reads what the database actually holds: the enum-typed
 * columns of public.ward_public and public.facility_public from information_schema,
 * and each enum's values from pg_enum. A migration form the text parser does not
 * understand still lands here. Both sides import the one table and neither restates
 * it (test-conventions, the shared-fixture link).
 *
 * THE NOT_OFFERED CHAIN, observed rather than inferred: a ward_status row created
 * with its defaults reaches the public mirror as PENDING + NOT_OFFERED -- which the
 * page renders "not currently reporting" -- and a ward that PUBLISHES NOT_OFFERED
 * reaches it as ACTIVE + NOT_OFFERED, which the page renders "not offered at this
 * facility". The compliance file holds publish_ward_status to being the only way out
 * of PENDING.
 *
 * NOT ASSERTED HERE, deliberately: hosted. Enum values are migration-defined and the
 * hosted ledger is frozen at the same files; this runs against the local stack only.
 */

interface LabelTable {
  labels: Record<string, Record<string, string>>;
  not_yet_displayed: Record<string, { values: string[] }>;
}
const LT = TABLE as LabelTable;

function decided(type: string): string[] | undefined {
  return LT.labels[type] ? Object.keys(LT.labels[type]) : LT.not_yet_displayed[type]?.values;
}

describe('public label table — catalogue', () => {
  test('every value of every enum the public mirrors carry is decided in the table, and nothing else is', async () => {
    const db = sql();
    const columns = await db<{ column_name: string; udt_name: string }[]>`
      select column_name, udt_name from information_schema.columns
       where table_schema = 'public' and table_name in ('ward_public', 'facility_public') and udt_schema = 'app'
       order by column_name`;
    expect(columns.length, 'no enum-typed column was found, so this checked nothing').toBeGreaterThan(0);

    const types = [...new Set(columns.map((c) => c.udt_name))].sort();
    expect([...Object.keys(LT.labels), ...Object.keys(LT.not_yet_displayed)].sort(), 'the table and the mirrors disagree on which enums reach the page').toEqual(types);

    for (const type of types) {
      const rows = await db<{ v: string }[]>`
        select e.enumlabel as v from pg_enum e
          join pg_type t on t.oid = e.enumtypid
          join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'app' and t.typname = ${type}
         order by e.enumsortorder`;
      expect(rows.length, `app.${type} has no values in pg_enum`).toBeGreaterThan(0);
      expect([...(decided(type) ?? [])].sort(), `app.${type}: the table and pg_enum disagree`).toEqual(rows.map((r) => r.v).sort());
    }
  });
});

const FAC = '99999999-0000-4000-8000-000000000068';
const U_ICU = '99999999-0000-4000-8000-0000000000c1';

async function seedDefaultWard(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC}', 'Labels Synthetic', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000068', now())`);
  // Only the key columns: offering, bed_count, accepting and monitoring_state take
  // their DEFAULTS -- the state a provisioned ward is in before anyone has spoken.
  await tx.unsafe(`insert into app.ward_status (facility_id, category) values ('${FAC}', 'ICU_ADULT')`);
  await tx.unsafe(`
    insert into app.ward_account (id, facility_id, ward_category, role)
    values ('${U_ICU}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF')`);
}

async function mirror(tx: TransactionSql): Promise<{ offering: string; monitoring_state: string; bed_count: number | null }> {
  const rows = await tx.unsafe<{ offering: string; monitoring_state: string; bed_count: number | null }[]>(
    `select offering::text as offering, monitoring_state::text as monitoring_state, bed_count
       from public.ward_public where facility_id = '${FAC}' and category = 'ICU_ADULT'`,
  );
  const row = rows[0];
  if (!row) throw new Error('the ward never reached public.ward_public, so nothing about its state was observed');
  return row;
}

describe('"not offered" is shown only once it has been stated', () => {
  test('a ward with its defaults reaches the mirror as PENDING + NOT_OFFERED -- the untouched default, which the page does not read as a statement', async () => {
    const row = await withRole('postgres', null, mirror, seedDefaultWard);
    expect(row).toEqual({ offering: 'NOT_OFFERED', monitoring_state: 'PENDING', bed_count: null });
  });

  test('ward staff publishing NOT_OFFERED reach the mirror as ACTIVE + NOT_OFFERED -- a stated offering', async () => {
    const row = await withRole(
      'authenticated',
      { sub: U_ICU, role: 'authenticated', session_id: randomUUID() },
      async (tx) => {
        await tx.unsafe(
          `select * from public.publish_ward_status('ICU_ADULT', 'NOT_OFFERED', null, false, null, 1, '${randomUUID()}', '${new Date().toISOString()}')`,
        );
        await tx.unsafe('RESET ROLE');
        return mirror(tx);
      },
      seedDefaultWard,
    );
    expect(row).toEqual({ offering: 'NOT_OFFERED', monitoring_state: 'ACTIVE', bed_count: null });
  });
});
