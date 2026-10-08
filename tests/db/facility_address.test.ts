import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * THE FACILITY'S STREET ADDRESS, END TO END IN THE DATABASE (migration 031; R-2026-09-30-214 GN).
 *
 * GUARD CLASS: LIVE. The column, the two operator functions, the register, the projection and
 * the snapshot generator all exist in 031 now, and every leg below runs against them.
 *
 * The address is PUBLIC on purpose (GN): entered by the operator because it is shown. This
 * file proves, in order:
 *   - the CHECK `facility_address_form` refuses each shape the letter forbids, one plant per
 *     shape, INCLUDING an interior line break (a regex ending `(.*[^[:space:]])?$` lets one
 *     through, because `.` matches a newline in a Postgres regex);
 *   - create REQUIRES the address and edit CARRIES it, each refused INVALID_ARGUMENT with
 *     DETAIL = 'p_address' before the CHECK can fire;
 *   - the audit row names the FIELD and never carries the value, so the 256-character cap
 *     cannot refuse a 200-character address (it would, were the value stored);
 *   - the old arities are GONE (addendum 1: replaced, not overloaded), so a caller still on
 *     the old shape gets "function does not exist" and not a silent success;
 *   - the register, the public mirror and the snapshot carry the address, and the snapshot
 *     carries it ONLY in the optional `facility_extras` envelope key, with the facility rows
 *     still 8 values wide (the compatibility constraint; see snapshot_compat_as_at_6866161).
 *
 * NOT ASSERTED HERE, deliberately: that a hosted project has applied 031. That is a step in
 * docs/runbook-supabase-project-creation.md, read by the founder; no test can see it.
 */

const MIG = join(import.meta.dirname, '..', '..', 'database', 'migrations', '031_facility_address.sql');

const OP = '0a000000-0000-4000-8000-000000000031';
const FAC = '0a000000-0000-4000-8000-0000000000f1';
const ADDRESS = '12 Example Street, Off Sample Avenue, Ikeja';

interface Refusal {
  code: string | undefined;
  message: string;
  detail: string | undefined;
  constraint: string | undefined;
}

async function refusal(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message: string; detail?: string; constraint_name?: string };
    return { code: x.code, message: x.message, detail: x.detail, constraint: x.constraint_name };
  }
  throw new Error('expected a refusal, and the call succeeded');
}

const claims = (sub: string): Record<string, unknown> => ({ sub, role: 'authenticated', session_id: randomUUID() });

/** An operator and one LEGACY facility: listed, with an agreement, and NO address. */
async function accounts(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`insert into app.ward_account (id, role) values ('${OP}', 'PLATFORM_ADMIN')`);
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC}', 'Existing Facility', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000301', now())`);
  await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'ICU_ADULT', 'OFFERED')`);
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const CREATE = (id: string, address: string | null = ADDRESS, name = 'New Facility'): string =>
  `select * from public.operator_create_facility('${id}', ${q(name)}, 'Surulere', 'Lagos', 6.5, 3.36, '+2348000000302', ${address === null ? 'NULL' : q(address)})`;

const EDIT = (version: number, address: string | null, name = 'Existing Facility'): string =>
  `select * from public.operator_edit_facility('${FAC}', ${version}, ${q(name)}, 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000301', ${address === null ? 'NULL' : q(address)})`;

// ---------------------------------------------------------------------------------------
// The CHECK. Each rejection is its own plant.
// ---------------------------------------------------------------------------------------

const REJECTED: [string, string][] = [
  ['an empty string', ''],
  ['whitespace only', '   '],
  ['a leading space', ' 12 Example Street'],
  ['a trailing space', '12 Example Street '],
  ['201 characters', 'x'.repeat(201)],
  ['a trailing newline', '12 Example Street\n'],
  ['a leading newline', '\n12 Example Street'],
  ['an interior LF', '12 Example\nStreet'],
  ['an interior CR', '12 Example\rStreet'],
  ['an interior CRLF', '12 Example\r\nStreet'],
  ['an interior vertical tab', '12 Example\u000bStreet'],
  ['an interior form feed', '12 Example\u000cStreet'],
  ['an interior NEL (U+0085)', '12 Example\u0085Street'],
  ['an interior line separator (U+2028)', '12 Example Street'],
  ['an interior paragraph separator (U+2029)', '12 Example Street'],
];

const ACCEPTED: [string, string | null][] = [
  ['NULL (a legacy facility has none)', null],
  ['one character', 'x'],
  ['exactly 200 characters', 'x'.repeat(200)],
  ['the most ordinary address', ADDRESS],
  ['an interior tab and commas', '5 Sample Road,\tBlock B, Ikeja'],
];

describe('the address CHECK, facility_address_form', () => {
  test.each(REJECTED)('plant — %s is rejected by the CHECK', async (_name, value) => {
    const r = await refusal(
      withRole('postgres', null, (tx) => tx.unsafe(`update app.facility set address = $1 where id = '${FAC}'`, [value] as never[]), accounts),
    );
    expect(r.code, `the value was not refused as a CHECK violation: ${r.message}`).toBe('23514');
    expect(r.constraint).toBe('facility_address_form');
  });

  test.each(ACCEPTED)('%s is accepted', async (_name, value) => {
    await withRole(
      'postgres',
      null,
      async (tx) => {
        await tx.unsafe(`update app.facility set address = $1 where id = '${FAC}'`, [value] as never[]);
        const [row] = await tx.unsafe<{ address: string | null }[]>(`select address from app.facility where id = '${FAC}'`);
        expect(row?.address).toBe(value);
      },
      accounts,
    );
  });

  test('anti-vacuity — the plant table is not empty and covers the interior line breaks', () => {
    expect(REJECTED.length).toBeGreaterThanOrEqual(15);
    expect(REJECTED.filter(([n]) => n.startsWith('an interior')).length).toBeGreaterThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------------------
// create REQUIRES the address.
// ---------------------------------------------------------------------------------------

describe('operator_create_facility with an address', () => {
  test('an operator creates a facility with its address, and the audit row names the field and not the value', async () => {
    const id = randomUUID();
    const long = `${'a'.repeat(190)} Road`;
    await withRole(
      'authenticated',
      claims(OP),
      async (tx) => {
        const [row] = await tx.unsafe<{ facility_id: string; version: number; created: boolean }[]>(CREATE(id, long));
        expect(row).toEqual({ facility_id: id, version: 1, created: true });
        await tx.unsafe('RESET ROLE');
        const [f] = await tx.unsafe<{ address: string }[]>(`select address from app.facility where id = '${id}'`);
        expect(f?.address).toBe(long);
        const [a] = await tx.unsafe<{ new_value: { fields: string[] }; text: string }[]>(
          `select new_value, new_value::text as text from app.audit_log where action = 'facility.create' and facility_id = '${id}'`,
        );
        expect(a?.new_value.fields, 'the audit row does not name the address field').toContain('address');
        expect(a?.text, 'the audit row carries the address VALUE').not.toContain('aaaaaaaaaa');
        expect(a?.text.length, 'the audit value is over the 256-character cap').toBeLessThanOrEqual(256);
      },
      accounts,
    );
  });

  test.each<[string, string | null]>([
    ['NULL', null],
    ['empty', ''],
    ['whitespace only', '   '],
    ['untrimmed', ' 1 Example Street'],
    ['201 characters', 'x'.repeat(201)],
    ['an interior newline', '1 Example\nStreet'],
  ])('missing-context — an address that is %s is refused INVALID_ARGUMENT naming p_address, before the CHECK', async (_n, value) => {
    const r = await refusal(withRole('authenticated', claims(OP), (tx) => tx.unsafe(CREATE(randomUUID(), value)), accounts));
    expect(r.message).toBe('INVALID_ARGUMENT');
    expect(r.detail).toBe('p_address');
  });

  test('J2 — a repeat with the same address returns the same row; a DIFFERENT address is IDEMPOTENCY_CONFLICT', async () => {
    const id = randomUUID();
    await withRole(
      'authenticated',
      claims(OP),
      async (tx) => {
        const [first] = await tx.unsafe<{ created: boolean }[]>(CREATE(id));
        const [second] = await tx.unsafe<{ created: boolean }[]>(CREATE(id));
        expect(first?.created).toBe(true);
        expect(second?.created).toBe(false);
      },
      accounts,
    );
    const r = await refusal(
      withRole(
        'authenticated',
        claims(OP),
        async (tx) => {
          await tx.unsafe(CREATE(id));
          await tx.unsafe(CREATE(id, '99 A Different Street'));
        },
        accounts,
      ),
    );
    expect(r.message, 'the idempotency comparison ignores the address').toBe('IDEMPOTENCY_CONFLICT');
  });

  test('the OLD seven-argument create is gone — a caller still on it gets "does not exist", not a success', async () => {
    const r = await refusal(
      withRole(
        'authenticated',
        claims(OP),
        // OLD_ARITY_ON_PURPOSE: the seven-argument create is what the previous admin bundle calls; it must not exist.
        (tx) => tx.unsafe(`select * from public.operator_create_facility('${randomUUID()}', 'Old Shape', 'Surulere', 'Lagos', 6.5, 3.36, '+2348000000302')`),
        accounts,
      ),
    );
    expect(r.code).toBe('42883');
  });
});

// ---------------------------------------------------------------------------------------
// edit CARRIES the address.
// ---------------------------------------------------------------------------------------

describe('operator_edit_facility with an address', () => {
  test('setting the address on a legacy facility bumps the version, names only `address` in the audit, and carries no text', async () => {
    await withRole(
      'authenticated',
      claims(OP),
      async (tx) => {
        const [row] = await tx.unsafe<{ version: number }[]>(EDIT(1, ADDRESS));
        expect(row?.version).toBe(2);
        await tx.unsafe('RESET ROLE');
        const [f] = await tx.unsafe<{ address: string }[]>(`select address from app.facility where id = '${FAC}'`);
        expect(f?.address).toBe(ADDRESS);
        const [a] = await tx.unsafe<{ new_value: { fields: string[]; version: number }; text: string }[]>(
          `select new_value, new_value::text as text from app.audit_log where action = 'facility.edit' and facility_id = '${FAC}'`,
        );
        expect(a?.new_value).toEqual({ fields: ['address'], version: 2 });
        expect(a?.text).not.toContain('Example Street');
      },
      accounts,
    );
  });

  test.each<[string, string | null]>([
    ['NULL', null],
    ['empty', ''],
    ['untrimmed', '1 Example Street '],
    ['201 characters', 'x'.repeat(201)],
    ['an interior line separator', '1 Example Street'],
  ])('an address that is %s is refused INVALID_ARGUMENT naming p_address, and nothing is written', async (_n, value) => {
    const r = await refusal(
      withRole(
        'authenticated',
        claims(OP),
        async (tx) => {
          await tx.unsafe(EDIT(1, value));
        },
        accounts,
      ),
    );
    expect(r.message).toBe('INVALID_ARGUMENT');
    expect(r.detail).toBe('p_address');
  });

  test('J1 — the stale-version refusal is unchanged by the new argument', async () => {
    const r = await refusal(
      withRole(
        'authenticated',
        claims(OP),
        async (tx) => {
          await tx.unsafe(EDIT(1, ADDRESS));
          await tx.unsafe(EDIT(1, '2 Another Street'));
        },
        accounts,
      ),
    );
    expect(r.message).toBe('VERSION_CONFLICT');
    expect(r.detail).toBe('current_version=2');
  });

  test('the OLD eight-argument edit is gone', async () => {
    const r = await refusal(
      withRole(
        'authenticated',
        claims(OP),
        // OLD_ARITY_ON_PURPOSE: the eight-argument edit is what the previous admin bundle calls; it must not exist.
        (tx) => tx.unsafe(`select * from public.operator_edit_facility('${FAC}', 1, 'Renamed', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000301')`),
        accounts,
      ),
    );
    expect(r.code).toBe('42883');
  });
});

// ---------------------------------------------------------------------------------------
// The register, the mirror, the snapshot.
// ---------------------------------------------------------------------------------------

describe('the address reaches the operator register, the public mirror and the snapshot', () => {
  test('operator_register carries the `address` key for every facility: null for a legacy row, the value after an edit', async () => {
    const r = await withRole(
      'authenticated',
      claims(OP),
      async (tx) => {
        const [legacy] = await tx.unsafe<{ r: { facilities: Record<string, unknown>[] } }[]>('select public.operator_register() as r');
        await tx.unsafe(EDIT(1, ADDRESS));
        const [after] = await tx.unsafe<{ r: { facilities: Record<string, unknown>[] } }[]>('select public.operator_register() as r');
        return { legacy: legacy?.r.facilities ?? [], after: after?.r.facilities ?? [] };
      },
      accounts,
    );
    const l = r.legacy.find((x) => x['facility_id'] === FAC);
    expect(l, 'the fixture facility is missing from the register').toBeDefined();
    expect(l, 'the key is absent, so the admin would read the row as unreadable').toHaveProperty('address');
    expect(l?.['address']).toBeNull();
    expect(r.after.find((x) => x['facility_id'] === FAC)?.['address']).toBe(ADDRESS);
  });

  test('facility_public follows app.facility: NULL until an address is set, then the address', async () => {
    await withRole(
      'postgres',
      null,
      async (tx) => {
        await tx.unsafe(`update app.facility set name = name where id = '${FAC}'`);
        const [before] = await tx.unsafe<{ address: string | null; n: number }[]>(
          `select address, count(*) over ()::int as n from public.facility_public where facility_id = '${FAC}'`,
        );
        expect(before?.n, 'the fixture facility is not public, so this leg would pass vacuously').toBe(1);
        expect(before?.address).toBeNull();
        await tx.unsafe(`update app.facility set address = ${q(ADDRESS)} where id = '${FAC}'`);
        const [after] = await tx.unsafe<{ address: string | null }[]>(`select address from public.facility_public where facility_id = '${FAC}'`);
        expect(after?.address).toBe(ADDRESS);
      },
      accounts,
    );
  });

  async function payloadAfter(tx: TransactionSql): Promise<Record<string, unknown>> {
    await tx.unsafe('select app.regenerate_snapshot()');
    const [row] = await tx.unsafe<{ payload: Record<string, unknown> }[]>('select payload from public.snapshot_current order by v desc limit 1');
    return row?.payload ?? {};
  }

  test('the snapshot carries the address ONLY in `facility_extras`; facility rows stay 8 values wide', async () => {
    await withRole(
      'postgres',
      null,
      async (tx) => {
        await tx.unsafe(`update app.facility set address = ${q(ADDRESS)} where id = '${FAC}'`);
        const p = await payloadAfter(tx);
        expect(Object.keys(p).sort()).toEqual(['facilities', 'facility_extras', 'generated_at', 'server_now', 'v', 'wards']);
        const facilities = p['facilities'] as unknown[][];
        expect(facilities.length, 'no facility in the payload, so the arity check would pass vacuously').toBeGreaterThan(0);
        for (const row of facilities) expect(row, 'a facility row is not 8 values: an open page would show the outage').toHaveLength(8);
        expect(p['facility_extras']).toEqual([[FAC, ADDRESS]]);
      },
      accounts,
    );
  });

  test('a facility with no address is ABSENT from `facility_extras`, and the key is present and empty', async () => {
    await withRole(
      'postgres',
      null,
      async (tx) => {
        const p = await payloadAfter(tx);
        expect(p).toHaveProperty('facility_extras');
        expect(p['facility_extras']).toEqual([]);
      },
      accounts,
    );
  });

  test('plant — an encoder that drops an addressed row is refused SNAPSHOT_ROWS_DROPPED', async () => {
    const text = readFileSync(MIG, 'utf8');
    const m = /^CREATE OR REPLACE FUNCTION app\.regenerate_snapshot\(\)[\s\S]*?^\$FN\$;$/m.exec(text);
    expect(m, '031 carries no regenerate_snapshot to plant against').not.toBeNull();
    const needle = 'FROM fsrc WHERE fsrc.address IS NOT NULL\n    )';
    expect(m?.[0], "the plant's needle is not in 031's regenerate_snapshot, so the plant would change nothing").toContain(needle);
    const planted = (m?.[0] ?? '').replace(needle, 'FROM fsrc WHERE fsrc.address IS NOT NULL AND false\n    )');
    expect(planted).not.toBe(m?.[0]);
    const r = await refusal(
      withRole(
        'postgres',
        null,
        async (tx) => {
          await tx.unsafe(`update app.facility set address = ${q(ADDRESS)} where id = '${FAC}'`);
          await tx.unsafe(planted);
          await tx.unsafe('select app.regenerate_snapshot()');
        },
        accounts,
      ),
    );
    expect(r.message).toBe('SNAPSHOT_ROWS_DROPPED');
  });
});
