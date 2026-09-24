import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 023 ADDS EXACTLY THREE KEYS TO THE OPERATOR REGISTER, REVERSES TO EXACTLY
 * THE 021 BODY, AND CHANGES NO GRANT AND NO PUBLIC OUTPUT (R-2026-09-24-98 BZ-2), in
 * the idiom of tests/db/migration_022_round_trip.test.ts.
 *
 * The state compared:
 *   - public.operator_register() BY VALUE, against 023's text and 021's;
 *   - who may EXECUTE it: authenticated only, before and after, and after the down --
 *     the fact behind "fence 6 reads the same" in 023's header;
 *   - the ledger row.
 *
 * THE BODY MOVES ONLY WHERE BZ-2 a SAYS: 023's is 021's with the three keys lat, lng
 * and public_phone_e164 inserted after 'state', asserted as an exact replace, so no
 * other line of the register can move under cover of this one. What the keys CARRY is
 * asserted by behaviour below, against the facility's own columns.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION (BL-1), as scripts/run_migrations.sh
 * applies each file with --single-transaction, so nothing here is committed. 023 is the
 * newest migration, so there is nothing above it to reverse first.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD = join(MIG_DIR, '023_operator_register_location_and_phone.sql');
const DOWN = join(MIG_DIR, '023_operator_register_location_and_phone.down.sql');
const LEDGER = '023_operator_register_location_and_phone.sql';
const F021 = '021_facility_agreement_and_contact_write.sql';

async function apply(tx: TransactionSql, path: string, text = readFileSync(path, 'utf8')): Promise<void> {
  await tx.unsafe(text);
}

const inTx = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> => withRole('postgres', null, fn);

/** The body between `AS $FN$` and `$FN$;` of one function, as a file writes it. */
function bodyFrom(file: string, fn: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?AS \\$FN\\$([\\s\\S]*?)^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`no body for ${fn} in ${file}`);
  return m[1] ?? '';
}

interface State {
  register: string;
  execute: { anon: boolean; authenticated: boolean; service_role: boolean };
  ledger: number;
}

async function state(tx: TransactionSql): Promise<State> {
  const [p] = await tx.unsafe<{ src: string }[]>(`select prosrc as src from pg_proc where oid = to_regprocedure('public.operator_register()')`);
  const [g] = await tx.unsafe<{ anon: boolean; authenticated: boolean; service_role: boolean }[]>(`
    select has_function_privilege('anon', 'public.operator_register()', 'EXECUTE') as anon,
           has_function_privilege('authenticated', 'public.operator_register()', 'EXECUTE') as authenticated,
           has_function_privilege('service_role', 'public.operator_register()', 'EXECUTE') as service_role`);
  const [l] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return {
    register: p?.src ?? '',
    execute: { anon: g?.anon ?? true, authenticated: g?.authenticated ?? false, service_role: g?.service_role ?? true },
    ledger: l?.n ?? -1,
  };
}

const AUTHENTICATED_ONLY = { anon: false, authenticated: true, service_role: false };
const STATE_023: State = { register: bodyFrom(LEDGER, 'public.operator_register'), execute: AUTHENTICATED_ONLY, ledger: 1 };
const STATE_021: State = { register: bodyFrom(F021, 'public.operator_register'), execute: AUTHENTICATED_ONLY, ledger: 0 };

/** BZ-2 a's three keys, as 023 inserts them after 'state'. */
const STATE_LINE = "                       'state', f.state,\n";
const KEYS =
  "                       'lat', f.lat,\n" +
  "                       'lng', f.lng,\n" +
  "                       'public_phone_e164', f.public_phone_e164,\n";

async function publicOutput(tx: TransactionSql): Promise<unknown[]> {
  const f = await tx.unsafe('select * from public.facility_public order by facility_id');
  const w = await tx.unsafe('select * from public.ward_public order by facility_id, category');
  const r = await tx.unsafe('select * from public.lga_rollup order by state, lga, category');
  return [[...f], [...w], [...r]];
}

describe('migration 023 round trip', () => {
  test('the database starts in the 023 state, and the bodies discriminate', async () => {
    expect(STATE_021.register).not.toBe(STATE_023.register);
    expect(await inTx(state)).toEqual(STATE_023);
  });

  test("023's register is 021's with exactly the three keys inserted after 'state'", () => {
    expect(STATE_021.register.split(STATE_LINE).length - 1, "021's 'state' line is not in the body exactly once").toBe(1);
    expect(STATE_021.register.replace(STATE_LINE, STATE_LINE + KEYS), 'operator_register moved beyond the three keys').toBe(STATE_023.register);
  });

  test("down restores EXACTLY the 021 state — 021's body, authenticated-only EXECUTE, no ledger row", async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(s, 'the reversal did not land on 021 exactly').toEqual(STATE_021);
  });

  test('up after down restores EXACTLY the 023 state — idempotent over 022 and over itself', async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return state(tx);
    });
    expect(s).toEqual(STATE_023);
  });

  test('neither the down nor a re-apply writes a public row', async () => {
    const r = await inTx(async (tx) => {
      const before = await publicOutput(tx);
      await apply(tx, FORWARD);
      const reapplied = await publicOutput(tx);
      await apply(tx, DOWN);
      return { before, reapplied, down: await publicOutput(tx) };
    });
    expect((r.before[0] as unknown[]).length, 'the seed projected no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    expect(r.reapplied, 'a re-apply of 023 changed the public output').toEqual(r.before);
    expect(r.down, 'the down changed the public output').toEqual(r.before);
  });

  test("the register carries each facility's own lat, lng and public_phone_e164, and 021's did not", async () => {
    const r = await inTx(async (tx) => {
      // An operator, inside the rolled-back transaction, for app.assert_operator.
      const [op] = await tx.unsafe<{ id: string }[]>(`insert into app.ward_account (id, role) values (gen_random_uuid(), 'PLATFORM_ADMIN') returning id`);
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: op?.id, session_id: '00000000-0000-4000-8000-00000000c0de' })] as never[]);
      const facilities = await tx.unsafe<{ id: string; lat: number; lng: number; public_phone_e164: string }[]>('select id, lat, lng, public_phone_e164 from app.facility');
      const [after] = await tx.unsafe<{ r: { facilities: Record<string, unknown>[] } }[]>('select public.operator_register() as r');
      await apply(tx, DOWN);
      const [before] = await tx.unsafe<{ r: { facilities: Record<string, unknown>[] } }[]>('select public.operator_register() as r');
      return { facilities, after: after?.r.facilities ?? [], before: before?.r.facilities ?? [] };
    });
    expect(r.facilities.length, 'the seed has no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    for (const f of r.facilities) {
      const row = r.after.find((x) => x['facility_id'] === f.id);
      expect(row, `facility ${f.id} is missing from the register`).toBeDefined();
      expect(row?.['lat']).toBe(f.lat);
      expect(row?.['lng']).toBe(f.lng);
      expect(row?.['public_phone_e164']).toBe(f.public_phone_e164);
    }
    for (const row of r.before) {
      expect(row, "021's register already carried a key 023 adds, so the test does not discriminate").not.toHaveProperty('public_phone_e164');
    }
  });

  test('plant — a reversal that leaves 023\'s body is rejected by the exact-state assertion', async () => {
    const original = readFileSync(DOWN, 'utf8');
    const needle = 'CREATE OR REPLACE FUNCTION public.operator_register()';
    expect(original, "the plant's target is not in the down file").toContain(needle);
    const tampered = original.replace(needle, 'CREATE OR REPLACE FUNCTION public.zz_not_the_register()');
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN, tampered);
      return state(tx);
    });
    expect(s, 'the tampered reversal still produced the 021 state — the plant did not reach an executed statement').not.toEqual(STATE_021);
  });
});
